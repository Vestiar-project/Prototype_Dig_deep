"""Build upload-ready visual references for Depth Zero field art.

The game currently draws terrain and ore procedurally on a 28 px canvas grid.
These sheets preserve the renderer's authored palettes, silhouettes and depth
order while presenting them at a useful size for image-generation reference.
"""

from __future__ import annotations

import math
import random
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "docs" / "art-references"
MINER = ROOT / "assets" / "characters" / "miner" / "miner_v01_worn_pick_idle.png"

FONT_REGULAR = Path("C:/Windows/Fonts/arial.ttf")
FONT_BOLD = Path("C:/Windows/Fonts/arialbd.ttf")
FONT_DISPLAY = Path("C:/Windows/Fonts/bahnschrift.ttf")

ORE_TYPES = [
    {
        "id": "copper", "tier": 1, "name": "МЕДЬ", "color": "#c86f43", "accent": "#ffd0a8",
        "depth": "0 м", "material": "кованая плоская лента", "terrain": "loam", "node": (17, 11), "vein": 7,
    },
    {
        "id": "coal", "tier": 2, "name": "УГОЛЬ", "color": "#343943", "accent": "#9ba5b4",
        "depth": "≈20 м", "material": "угловатый растрескавшийся комок", "terrain": "dirt", "node": (16, 14), "vein": 9,
    },
    {
        "id": "iron", "tier": 3, "name": "ЖЕЛЕЗО", "color": "#87949c", "accent": "#e5f0ef",
        "depth": "≈75 м", "material": "полосчатая металлическая пластина", "terrain": "stone", "node": (18, 13), "vein": 9,
    },
    {
        "id": "amber", "tier": 4, "name": "ЯНТАРЬ", "color": "#d88b1f", "accent": "#fff0a1",
        "depth": "≈170 м", "material": "вертикальная смоляная капля", "terrain": "stone", "node": (13, 17), "vein": 7,
    },
    {
        "id": "silver", "tier": 5, "name": "СЕРЕБРО", "color": "#aebbd0", "accent": "#ffffff",
        "depth": "≈280 м", "material": "тонкая игольчатая нить", "terrain": "stone", "node": (20, 9), "vein": 5,
    },
    {
        "id": "gold", "tier": 6, "name": "ЗОЛОТО", "color": "#e0a922", "accent": "#fff6a6",
        "depth": "≈380 м", "material": "кластер округлых самородков", "terrain": "deepstone", "node": (18, 14), "vein": 8,
    },
    {
        "id": "amethyst", "tier": 7, "name": "АМЕТИСТ", "color": "#8153c7", "accent": "#edc7ff",
        "depth": "≈480 м", "material": "друза острых кристаллов", "terrain": "deepstone", "node": (16, 19), "vein": 7,
    },
    {
        "id": "prism_crystal", "tier": 8, "name": "ПРИЗМАЛИТ", "color": "#31a9b6", "accent": "#bffcff",
        "depth": "≈580 м", "material": "бирюзовый гранёный кристалл", "terrain": "deepstone", "node": (17, 20), "vein": 6,
    },
    {
        "id": "void_ore", "tier": 9, "name": "ПУСТОТНАЯ РУДА", "color": "#312458", "accent": "#d56dff",
        "depth": "≈680 м", "material": "чёрная линза с фиолетовым ободом", "terrain": "deepstone", "node": (20, 15), "vein": 10,
    },
    {
        "id": "star_core", "tier": 10, "name": "ЗВЁЗДНОЕ ЯДРО", "color": "#e9586e", "accent": "#fff4dd",
        "depth": "≈770 м", "material": "раскалённая двенадцатилучевая звезда", "terrain": "deepstone", "node": (19, 19), "vein": 9,
    },
]

TERRAIN = {
    "loam": {
        "name": "СУГЛИНОК", "range": "0–10 м от поверхности",
        "bases": ["#654333", "#6b4735", "#704b37", "#754f39", "#7a533b", "#80583e", "#865c40"],
        "light": "#b77b50", "side": "#8e5b40", "shadow": "#3b2924", "strata": "#955c3e",
        "strata_light": "#c17f50", "chip": "#ce8a58", "note": "рыхлый тёплый верх · корни отдельно",
    },
    "dirt": {
        "name": "ЗЕМЛЯ", "range": "≈15–75 м · волнистая граница",
        "bases": ["#51362e", "#563930", "#5b3d31", "#604033", "#654435", "#6a4737", "#704b39"],
        "light": "#8e5d42", "side": "#744937", "shadow": "#332329", "strata": "#81503a",
        "strata_light": "#a96643", "chip": "#b67349", "note": "плотнее суглинка · широкие пласты",
    },
    "stone": {
        "name": "КАМЕНЬ", "range": "основная толща · примерно до 600 м",
        "bases": ["#30373a", "#343a3d", "#383e40", "#3c4244", "#404648", "#444a4c", "#494e50"],
        "light": "#667073", "side": "#50595c", "shadow": "#20262b", "strata": "#665047",
        "strata_light": "#8d604a", "chip": "#747b7a", "note": "графитовый · редкие ржавые пласты",
    },
    "deepstone": {
        "name": "ГЛУБИННЫЙ КАМЕНЬ", "range": "≈600–820 м · давление растёт",
        "bases": ["#1d242a", "#20272d", "#232a30", "#262d33", "#293036", "#2c3339", "#30373d"],
        "light": "#48545a", "side": "#363f46", "shadow": "#111820", "strata": "#4c3937",
        "strata_light": "#75493e", "chip": "#566064", "note": "холодный · более массивный и тёмный",
    },
    "final_seal": {
        "name": "ФИНАЛЬНАЯ ПЕЧАТЬ", "range": "≈825 м · только Солнечный бур",
        "bases": ["#24182f", "#2a1b35", "#30203b", "#362340", "#3b2747", "#422b4d", "#493052"],
        "light": "#8c6b9d", "side": "#5c4269", "shadow": "#110b19", "strata": "#b78542",
        "strata_light": "#ffe69a", "chip": "#d8b661", "note": "цельный золотой сердечник · 3 стадии трещин",
    },
    "bedrock": {
        "name": "КОРЕННАЯ ПОРОДА", "range": "последние 2 ряда · неразрушима",
        "bases": ["#0a1017", "#0c1219", "#0f151c", "#12181f", "#151b22", "#181e25", "#1b2128"],
        "light": "#303940", "side": "#202930", "shadow": "#05090e", "strata": "#352c30",
        "strata_light": "#5d3b39", "chip": "#424b50", "note": "почти чёрная · инертная · отличима от печати",
    },
}

INK = "#081015"
INK_SOFT = "#172126"
PANEL = "#101b1e"
PANEL_2 = "#0c1519"
RUST = "#a75231"
RUST_LIGHT = "#df8144"
BONE = "#e9d6a4"
MUTED = "#a9b6b3"
TEAL = "#4f9a98"


def font(size: int, bold: bool = False, display: bool = False) -> ImageFont.FreeTypeFont:
    path = FONT_DISPLAY if display else FONT_BOLD if bold else FONT_REGULAR
    return ImageFont.truetype(str(path), size=size)


def rgb(value: str) -> tuple[int, int, int]:
    value = value.lstrip("#")
    return tuple(int(value[i:i + 2], 16) for i in (0, 2, 4))


def mix(a: str | tuple[int, int, int], b: str | tuple[int, int, int], t: float) -> tuple[int, int, int]:
    aa = rgb(a) if isinstance(a, str) else a
    bb = rgb(b) if isinstance(b, str) else b
    return tuple(round(aa[i] * (1 - t) + bb[i] * t) for i in range(3))


def rounded_panel(draw: ImageDraw.ImageDraw, box, fill=PANEL, outline=RUST, width=3, radius=14):
    draw.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=width)
    x0, y0, x1, _ = box
    draw.line((x0 + 14, y0 + 5, x1 - 14, y0 + 5), fill=RUST_LIGHT, width=2)


def wrap_text(draw: ImageDraw.ImageDraw, text: str, face, max_width: int, max_lines: int = 2) -> list[str]:
    words = text.split()
    lines: list[str] = []
    current = ""
    for word in words:
        candidate = f"{current} {word}".strip()
        if draw.textbbox((0, 0), candidate, font=face)[2] <= max_width:
            current = candidate
        else:
            if current:
                lines.append(current)
            current = word
            if len(lines) >= max_lines - 1:
                break
    if current and len(lines) < max_lines:
        lines.append(current)
    consumed = " ".join(lines)
    if consumed != text and lines:
        while draw.textbbox((0, 0), lines[-1] + "…", font=face)[2] > max_width and lines[-1]:
            lines[-1] = lines[-1][:-1]
        lines[-1] += "…"
    return lines


def make_background(width: int, height: int) -> Image.Image:
    image = Image.new("RGB", (width, height), rgb("#071014"))
    px = image.load()
    for y in range(height):
        t = y / max(1, height - 1)
        row = mix("#0b2022", "#060b11", t)
        for x in range(width):
            vignette = min(0.22, abs(x - width / 2) / width * 0.16)
            px[x, y] = mix(row, "#020507", vignette)
    draw = ImageDraw.Draw(image)
    for x in range(24, width, 28):
        for y in range(24, height, 28):
            draw.ellipse((x, y, x + 2, y + 2), fill="#143135")
    draw.rounded_rectangle((15, 15, width - 16, height - 16), radius=22, outline="#291d19", width=14)
    draw.rounded_rectangle((23, 23, width - 24, height - 24), radius=17, outline=RUST, width=3)
    return image.convert("RGBA")


def place_miner_anchor(image: Image.Image, x: int, y: int, max_size: tuple[int, int] = (170, 170)) -> None:
    miner = Image.open(MINER).convert("RGBA")
    bbox = miner.getbbox()
    if bbox:
        miner = miner.crop(bbox)
    miner.thumbnail(max_size, Image.Resampling.LANCZOS)
    shadow = Image.new("RGBA", miner.size, (0, 0, 0, 0))
    shadow.putalpha(miner.getchannel("A").filter(ImageFilter.GaussianBlur(8)))
    shadow_color = Image.new("RGBA", miner.size, (0, 0, 0, 150))
    shadow_color.putalpha(shadow.getchannel("A"))
    image.alpha_composite(shadow_color, (x + 5, y + 8))
    image.alpha_composite(miner, (x, y))


def terrain_patch(size: tuple[int, int], terrain_id: str, seed: int, cave: bool = False) -> Image.Image:
    width, height = size
    palette = TERRAIN[terrain_id]
    rng = random.Random(seed)
    texture = Image.new("RGBA", size, (*rgb(palette["bases"][3]), 255))
    draw = ImageDraw.Draw(texture)

    cell = max(22, round(min(width, height) / 12))
    cols = math.ceil(width / cell) + 1
    rows = math.ceil(height / cell) + 1
    for gy in range(rows):
        for gx in range(cols):
            x0 = gx * cell - rng.randint(0, 4)
            y0 = gy * cell - rng.randint(0, 4)
            x1 = min(width, x0 + cell + rng.randint(1, 7))
            y1 = min(height, y0 + cell + rng.randint(1, 7))
            base = palette["bases"][(gx + gy * 2 + rng.randint(0, 3)) % len(palette["bases"])]
            points = [
                (x0 + rng.randint(0, 4), y0 + rng.randint(0, 3)),
                (x1 - rng.randint(0, 5), y0 + rng.randint(0, 5)),
                (x1 - rng.randint(0, 4), y1 - rng.randint(0, 4)),
                (x0 + rng.randint(0, 5), y1 - rng.randint(0, 4)),
            ]
            draw.polygon(points, fill=base)
            if rng.random() > 0.36:
                draw.line((points[0], points[1]), fill=palette["light"], width=2)
            if rng.random() > 0.28:
                draw.line((points[1], points[2]), fill=palette["shadow"], width=2)
            if rng.random() > 0.52:
                cx = (x0 + x1) // 2
                cy = (y0 + y1) // 2
                draw.polygon((points[0], points[1], (cx, cy)), fill=(*mix(base, palette["light"], 0.15), 255))

    spacing = {"loam": 54, "dirt": 70, "stone": 106, "deepstone": 126, "bedrock": 136, "final_seal": 112}[terrain_id]
    for band_y in range(spacing // 2, height, spacing):
        offset = rng.randint(-12, 12)
        points = []
        for x in range(-10, width + 20, 42):
            points.append((x, band_y + offset + rng.randint(-6, 6)))
        draw.line(points, fill=palette["strata"], width=5)
        if terrain_id in {"loam", "dirt"}:
            draw.line([(x, y - 3) for x, y in points], fill=palette["strata_light"], width=2)

    if terrain_id == "final_seal":
        core_y = height // 2
        glow = Image.new("RGBA", size, (0, 0, 0, 0))
        gd = ImageDraw.Draw(glow)
        gd.rectangle((0, core_y - 18, width, core_y + 18), fill=(*rgb("#b78542"), 125))
        glow = glow.filter(ImageFilter.GaussianBlur(18))
        texture.alpha_composite(glow)
        draw = ImageDraw.Draw(texture)
        draw.rectangle((0, core_y - 10, width, core_y + 10), fill="#b78542")
        draw.rectangle((0, core_y - 4, width, core_y + 4), fill="#ffe69a")
        for x in range(24, width, 72):
            draw.line((x - 16, core_y - 24, x, core_y - 10, x + 16, core_y - 24), fill="#d8b661", width=4)
            draw.line((x - 16, core_y + 24, x, core_y + 10, x + 16, core_y + 24), fill="#6a4739", width=4)

    mask = Image.new("L", size, 255)
    md = ImageDraw.Draw(mask)
    for _ in range(9):
        edge = rng.choice(("top", "bottom", "left", "right"))
        if edge in ("top", "bottom"):
            x = rng.randint(4, max(5, width - 20))
            y = 0 if edge == "top" else height
            md.polygon(((x, y), (x + rng.randint(8, 18), y), (x + rng.randint(5, 12), y + (-1 if edge == "bottom" else 1) * rng.randint(3, 9))), fill=0)
        else:
            y = rng.randint(4, max(5, height - 20))
            x = 0 if edge == "left" else width
            md.polygon(((x, y), (x, y + rng.randint(8, 18)), (x + (-1 if edge == "right" else 1) * rng.randint(3, 9), y + rng.randint(5, 12))), fill=0)

    cave_box = None
    if cave:
        cave_box = (round(width * 0.64), round(height * 0.18), round(width * 1.13), round(height * 0.9))
        md.ellipse(cave_box, fill=0)

    texture.putalpha(mask)
    if cave and cave_box:
        edge = Image.new("RGBA", size, (0, 0, 0, 0))
        ed = ImageDraw.Draw(edge)
        ed.arc(cave_box, 92, 268, fill=palette["shadow"], width=18)
        ed.arc((cave_box[0] - 5, cave_box[1] - 5, cave_box[2] - 5, cave_box[3] - 5), 92, 268, fill=palette["side"], width=8)
        ed.arc((cave_box[0] - 9, cave_box[1] - 9, cave_box[2] - 9, cave_box[3] - 9), 92, 210, fill=palette["light"], width=3)
        edge.putalpha(Image.composite(edge.getchannel("A"), Image.new("L", size, 0), mask))
        texture.alpha_composite(edge)

    return texture


def star_points(cx: float, cy: float, outer: float, inner: float, count: int = 6):
    points = []
    for i in range(count * 2):
        angle = -math.pi / 2 + i * math.pi / count
        radius = outer if i % 2 == 0 else inner
        points.append((cx + math.cos(angle) * radius, cy + math.sin(angle) * radius))
    return points


def polygon_for_node(ore_id: str, cx: float, cy: float, w: float, h: float):
    hw, hh = w / 2, h / 2
    if ore_id == "copper":
        return [(cx - hw, cy), (cx - hw * .65, cy - hh * .78), (cx - 1, cy - hh * .48),
                (cx + hw * .4, cy - hh), (cx + hw, cy - 1), (cx + hw * .58, cy + hh * .86),
                (cx + 1, cy + hh * .54), (cx - hw * .55, cy + hh)]
    if ore_id == "coal":
        return [(cx - hw, cy - hh * .16), (cx - hw * .54, cy - hh), (cx + 1, cy - hh * .7),
                (cx + hw * .68, cy - hh), (cx + hw, cy - hh * .18), (cx + hw * .62, cy + hh * .7),
                (cx, cy + hh), (cx - hw * .75, cy + hh * .58)]
    if ore_id == "iron":
        return [(cx - hw, cy - hh * .42), (cx - hw * .58, cy - hh), (cx + hw * .58, cy - hh),
                (cx + hw, cy - hh * .34), (cx + hw, cy + hh * .5), (cx + hw * .48, cy + hh),
                (cx - hw * .68, cy + hh * .78), (cx - hw, cy + hh * .24)]
    if ore_id == "silver":
        return [(cx - hw, cy + 2), (cx - hw * .2, cy - 2), (cx - 1, cy - hh), (cx + 2, cy - 2),
                (cx + hw, cy - 1), (cx + hw * .18, cy + 2), (cx + 1, cy + hh), (cx - 2, cy + 2)]
    if ore_id == "amethyst":
        return [(cx - hw, cy + hh), (cx - hw * .76, cy - hh * .2), (cx - hw * .3, cy - hh),
                (cx, cy - hh * .34), (cx + hw * .38, cy - hh * .92), (cx + hw * .62, cy - hh * .08),
                (cx + hw, cy - hh * .5), (cx + hw * .78, cy + hh)]
    if ore_id == "prism_crystal":
        return [(cx, cy - hh), (cx + hw * .78, cy - hh * .28), (cx + hw, cy + hh * .38),
                (cx, cy + hh), (cx - hw, cy + hh * .28), (cx - hw * .64, cy - hh * .52)]
    if ore_id == "star_core":
        return star_points(cx, cy, hw, hw * .58, 6)
    return None


def draw_node(layer: Image.Image, ore: dict, center: tuple[int, int], scale: float, variant: int) -> None:
    cx, cy = center
    w = ore["node"][0] * scale
    h = ore["node"][1] * scale
    ore_id = ore["id"]
    draw = ImageDraw.Draw(layer)
    outline = max(4, round(5 * scale / 2.4))

    if ore_id in {"amber", "void_ore"}:
        box = (cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2)
        draw.ellipse(box, fill=INK, outline=INK, width=outline)
        inset = outline + 1
        inner = (box[0] + inset, box[1] + inset, box[2] - inset, box[3] - inset)
        draw.ellipse(inner, fill=ore["color"])
        if ore_id == "amber":
            draw.ellipse((cx - w * .2, cy - h * .3, cx + w * .12, cy + h * .18), fill=ore["accent"])
            draw.ellipse((cx + w * .1, cy + h * .05, cx + w * .2, cy + h * .15), fill="#7a431c")
        else:
            draw.ellipse((cx - w * .27, cy - h * .25, cx + w * .29, cy + h * .25), fill="#070811")
            draw.arc((cx - w * .32, cy - h * .32, cx + w * .32, cy + h * .32), 205, 350, fill=ore["accent"], width=max(2, round(scale)))
        return

    if ore_id == "gold":
        radii = [(cx - w * .23, cy, h * .32), (cx + w * .22, cy - h * .08, h * .31), (cx, cy + h * .2, h * .26)]
        for nx, ny, r in radii:
            draw.ellipse((nx - r - outline, ny - r - outline, nx + r + outline, ny + r + outline), fill=INK)
        for nx, ny, r in radii:
            draw.ellipse((nx - r, ny - r, nx + r, ny + r), fill=ore["color"])
            draw.ellipse((nx - r * .45, ny - r * .55, nx + r * .05, ny - r * .05), fill=ore["accent"])
        return

    points = polygon_for_node(ore_id, cx, cy, w, h)
    if not points:
        return
    shadow_points = [(x + 4, y + 5) for x, y in points]
    draw.polygon(shadow_points, fill="#04080b")
    draw.polygon(points, fill=ore["color"], outline=INK, width=outline)

    if ore_id == "coal":
        draw.line((cx - w * .28, cy - h * .25, cx, cy, cx - w * .1, cy + h * .35), fill=ore["accent"], width=max(2, round(scale * .8)))
        draw.line((cx, cy, cx + w * .28, cy - h * .2), fill="#10151a", width=max(2, round(scale)))
    elif ore_id == "iron":
        draw.polygon([(cx - w * .33, cy - h * .32), (cx + w * .3, cy - h * .32), (cx + w * .18, cy - 1), (cx - w * .4, cy - 1)], fill=ore["accent"])
        draw.line((cx - w * .3, cy + h * .25, cx + w * .28, cy + h * .2), fill="#354149", width=max(2, round(scale)))
    elif ore_id == "copper":
        draw.line((cx - w * .2, cy - h * .4, cx + w * .46, cy), fill="#713b2d", width=max(2, round(scale)))
        draw.rectangle((cx - w * .33, cy - 2, cx - w * .15, cy + 3), fill=ore["accent"])
    elif ore_id == "silver":
        draw.line((cx - w * .36, cy, cx + w * .35, cy - 1), fill=ore["accent"], width=max(2, round(scale)))
        draw.line((cx, cy - h * .35, cx + 1, cy + h * .33), fill="#ffffff", width=max(2, round(scale * .75)))
    elif ore_id == "amethyst":
        draw.polygon([(cx - w * .32, cy + h * .34), (cx - w * .14, cy - h * .35), (cx, cy + h * .25)], fill=ore["accent"])
        draw.line((cx + w * .22, cy - h * .35, cx + w * .32, cy + h * .28), fill="#f5d8ff", width=max(2, round(scale * .7)))
    elif ore_id == "prism_crystal":
        draw.polygon([(cx, cy - h * .4), (cx + w * .34, cy - h * .1), (cx, cy)], fill="#d68aff")
        draw.polygon([(cx, cy), (cx + w * .38, cy + h * .12), (cx, cy + h * .36)], fill="#8fffe2")
        draw.line((cx, cy - h * .38, cx, cy + h * .36), fill=ore["accent"], width=max(2, round(scale * .65)))
    elif ore_id == "star_core":
        draw.ellipse((cx - w * .16, cy - w * .16, cx + w * .16, cy + w * .16), fill=ore["accent"])
        draw.ellipse((cx - w * .07, cy - w * .07, cx + w * .07, cy + w * .07), fill="#ffffff")


def ore_preview(size: tuple[int, int], ore: dict, seed: int) -> Image.Image:
    width, height = size
    base = terrain_patch(size, ore["terrain"], seed, cave=False)
    positions = [
        (round(width * .08), round(height * .72)),
        (round(width * .28), round(height * .60)),
        (round(width * .49), round(height * .42)),
        (round(width * .70), round(height * .28)),
        (round(width * .91), round(height * .43)),
    ]
    scale = min(width / 305, height / 205) * 2.35
    glow_tier = max(0, ore["tier"] - 3)

    if glow_tier:
        glow = Image.new("RGBA", size, (0, 0, 0, 0))
        gd = ImageDraw.Draw(glow)
        path = positions
        gd.line(path, fill=(*rgb(ore["color"]), 75 + glow_tier * 7), width=round(ore["vein"] * scale + 18))
        for cx, cy in positions:
            radius = 20 + glow_tier * 2
            gd.ellipse((cx - radius, cy - radius, cx + radius, cy + radius), fill=(*rgb(ore["color"]), 80))
        glow = glow.filter(ImageFilter.GaussianBlur(14 + glow_tier))
        base.alpha_composite(glow)

    layer = Image.new("RGBA", size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    main_width = max(5, round(ore["vein"] * scale / 2.4))
    draw.line(positions, fill=INK, width=main_width + 8, joint="curve")
    draw.line(positions, fill=ore["color"], width=main_width, joint="curve")
    if ore["id"] != "coal":
        highlight = [(x, y - 2) for x, y in positions]
        draw.line(highlight, fill=ore["accent"], width=max(2, main_width // 4), joint="curve")
    if ore["id"] == "void_ore":
        draw.line(positions, fill="#070811", width=max(3, main_width // 2), joint="curve")

    for index, point in enumerate(positions):
        draw_node(layer, ore, point, scale, index)
    base.alpha_composite(layer)
    return base


def draw_header(image: Image.Image, title: str, subtitle: str) -> None:
    draw = ImageDraw.Draw(image)
    draw.text((58, 45), title, font=font(50, display=True), fill=BONE, stroke_width=2, stroke_fill="#030507")
    draw.rectangle((58, 112, 750, 118), fill=RUST)
    draw.text((60, 132), subtitle, font=font(21), fill=MUTED)
    rounded_panel(draw, (1546, 34, 1874, 204), fill="#0c1719", outline="#6e392b", width=2, radius=12)
    draw.text((1566, 51), "ЭТАЛОН ОБЪЁМА", font=font(17, bold=True), fill=RUST_LIGHT)
    draw.text((1566, 77), "актуальный шахтёр", font=font(15), fill=MUTED)
    place_miner_anchor(image, 1694, 48, (142, 142))


def build_ore_sheet() -> Path:
    width, height = 1920, 1390
    image = make_background(width, height)
    draw_header(
        image,
        "ГЛУБИНА НУЛЬ · РУДА",
        "Текущие цвета, силуэты и порядок глубины. Это reference sheet, а не финальный новый арт.",
    )
    draw = ImageDraw.Draw(image)
    card_w, card_h, gap_x = 348, 500, 20
    margin_x, first_y, gap_y = 50, 228, 28
    preview_size = (308, 238)

    for index, ore in enumerate(ORE_TYPES):
        col, row = index % 5, index // 5
        x = margin_x + col * (card_w + gap_x)
        y = first_y + row * (card_h + gap_y)
        rounded_panel(draw, (x, y, x + card_w, y + card_h), fill=PANEL, outline="#6f3b2d", width=2, radius=13)
        draw.rounded_rectangle((x + 16, y + 16, x + 72, y + 48), radius=7, fill="#3b241f", outline=RUST, width=2)
        draw.text((x + 27, y + 20), f"T{ore['tier']}", font=font(20, bold=True), fill=RUST_LIGHT)
        draw.text((x + 84, y + 17), ore["name"], font=font(22, bold=True), fill=BONE)
        draw.text((x + 84, y + 45), ore["depth"], font=font(15), fill=MUTED)

        preview = ore_preview(preview_size, ore, 900 + index * 19)
        image.alpha_composite(preview, (x + 20, y + 82))
        draw.rounded_rectangle((x + 19, y + 81, x + 329, y + 322), radius=8, outline="#243a3b", width=2)
        if ore["tier"] >= 4:
            draw.rounded_rectangle((x + 217, y + 91, x + 318, y + 120), radius=7, fill="#151620", outline=ore["color"], width=2)
            draw.text((x + 229, y + 96), "СВЕЧЕНИЕ", font=font(12, bold=True), fill=ore["accent"])

        lines = wrap_text(draw, ore["material"], font(16), card_w - 40, 2)
        text_y = y + 340
        for line in lines:
            draw.text((x + 20, text_y), line, font=font(16), fill="#d3ded9")
            text_y += 20

        draw.text((x + 20, y + 397), "основной", font=font(12), fill="#83908d")
        draw.rounded_rectangle((x + 20, y + 418, x + 132, y + 446), radius=6, fill=ore["color"], outline=INK, width=2)
        draw.text((x + 31, y + 424), ore["color"].upper(), font=font(13, bold=True), fill="#ffffff" if ore["id"] in {"coal", "void_ore"} else INK)
        draw.text((x + 150, y + 397), "блик", font=font(12), fill="#83908d")
        draw.rounded_rectangle((x + 150, y + 418, x + 262, y + 446), radius=6, fill=ore["accent"], outline=INK, width=2)
        draw.text((x + 161, y + 424), ore["accent"].upper(), font=font(13, bold=True), fill=INK)
        draw.text((x + 20, y + 465), f"узел {ore['node'][0]}×{ore['node'][1]} · жила {ore['vein']} px · 5 нод в примере", font=font(12), fill="#869692")

    footer_y = 1294
    draw.rounded_rectangle((50, footer_y, 1870, 1350), radius=10, fill="#121b1d", outline="#315052", width=2)
    draw.text((72, footer_y + 15), "КЛЮЧЕВОЕ ОГРАНИЧЕНИЕ", font=font(17, bold=True), fill="#7bc6c2")
    draw.text((310, footer_y + 15), "Жила может визуально сцепляться через соседние клетки, но число рудных нод и занимаемых клеток не увеличивать.", font=font(17), fill="#d7e1dc")

    path = OUT / "depth-zero-current-ores-reference.png"
    image.convert("RGB").save(path, quality=95)
    return path


def build_terrain_sheet() -> Path:
    width, height = 1920, 1510
    image = make_background(width, height)
    draw_header(
        image,
        "ГЛУБИНА НУЛЬ · ПОРОДА",
        "Текущая процедурная палитра и логика глубины. Новая версия должна стать объёмнее, но не менять навигацию.",
    )
    draw = ImageDraw.Draw(image)
    terrain_order = ["loam", "dirt", "stone", "deepstone", "final_seal", "bedrock"]
    card_w, card_h = 586, 552
    margin_x, gap_x, first_y, gap_y = 56, 24, 228, 26
    preview_size = (538, 330)

    for index, terrain_id in enumerate(terrain_order):
        palette = TERRAIN[terrain_id]
        col, row = index % 3, index // 3
        x = margin_x + col * (card_w + gap_x)
        y = first_y + row * (card_h + gap_y)
        rounded_panel(draw, (x, y, x + card_w, y + card_h), fill=PANEL, outline="#6f3b2d", width=2, radius=13)
        draw.text((x + 22, y + 18), f"0{index + 1}", font=font(22, bold=True), fill=RUST_LIGHT)
        draw.text((x + 68, y + 16), palette["name"], font=font(23, bold=True), fill=BONE)
        draw.text((x + 68, y + 47), palette["range"], font=font(15), fill=MUTED)

        preview = terrain_patch(preview_size, terrain_id, 1200 + index * 31, cave=True)
        cave_back = Image.new("RGBA", preview_size, (*rgb("#071116"), 255))
        cave_back.alpha_composite(preview)
        image.alpha_composite(cave_back, (x + 24, y + 82))
        draw.rounded_rectangle((x + 23, y + 81, x + 563, y + 414), radius=8, outline="#243a3b", width=2)
        draw.text((x + 36, y + 96), "единая масса · открытая кромка", font=font(13, bold=True), fill="#d6e3de")

        note_lines = wrap_text(draw, palette["note"], font(16), card_w - 48, 2)
        note_y = y + 430
        for line in note_lines:
            draw.text((x + 24, note_y), line, font=font(16), fill="#c8d4d0")
            note_y += 20

        swatch_y = y + 490
        swatch_width = 56
        for swatch_index, color in enumerate(palette["bases"]):
            sx = x + 24 + swatch_index * (swatch_width + 4)
            draw.rounded_rectangle((sx, swatch_y, sx + swatch_width, swatch_y + 30), radius=5, fill=color, outline="#05090c", width=2)
        draw.rounded_rectangle((x + 454, swatch_y, x + 510, swatch_y + 30), radius=5, fill=palette["light"], outline="#05090c", width=2)
        draw.rounded_rectangle((x + 514, swatch_y, x + 562, swatch_y + 30), radius=5, fill=palette["shadow"], outline="#05090c", width=2)
        draw.text((x + 24, y + 524), "база: 7 тонов", font=font(11), fill="#7f8d8a")
        draw.text((x + 452, y + 524), "свет / тень", font=font(11), fill="#7f8d8a")

    footer_y = 1387
    draw.rounded_rectangle((56, footer_y, 1864, 1473), radius=10, fill="#121b1d", outline="#315052", width=2)
    draw.text((80, footer_y + 13), "ПРАВИЛА НОВОГО ПОЛЯ", font=font(17, bold=True), fill="#7bc6c2")
    rules = "вид сбоку в разрезе · свет сверху-слева · мелкие сцепленные 3D-фасеты · сетка 28×28 невидима · глубже = темнее и плотнее · не Minecraft"
    draw.text((80, footer_y + 43), rules, font=font(17), fill="#d7e1dc")

    path = OUT / "depth-zero-current-terrain-reference.png"
    image.convert("RGB").save(path, quality=95)
    return path


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    ore_path = build_ore_sheet()
    terrain_path = build_terrain_sheet()
    print(ore_path)
    print(terrain_path)


if __name__ == "__main__":
    main()
