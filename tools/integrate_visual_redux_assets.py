#!/usr/bin/env python3
"""Validate and install the approved visual-redux raster assets.

The miner source is cropped losslessly into the runtime's 35 fixed 512 px
canvases. The generated final-seal cell is vertically phase-aligned with the
runtime's centered 28 px source band; no painting or resampling is performed.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

from PIL import Image, ImageChops, ImageCms


FRAME_ROWS = [
    [
        "miner_v01_worn_pick_idle.png",
        "miner_v01_worn_pick_step.png",
        "miner_v01_worn_pick_prepare.png",
        "miner_v01_worn_pick_contact.png",
        "miner_v01_worn_pick_recoil.png",
    ],
    [
        "miner_v02_iron_pick_idle.png",
        "miner_v02_iron_pick_step.png",
        "miner_v02_iron_pick_prepare.png",
        "miner_v02_iron_pick_contact.png",
        "miner_v02_iron_pick_recoil.png",
    ],
    [
        "miner_v03_steel_pick_idle.png",
        "miner_v03_steel_pick_step.png",
        "miner_v03_steel_pick_prepare.png",
        "miner_v03_steel_pick_contact.png",
        "miner_v03_steel_pick_recoil.png",
    ],
    [
        "miner_v04_pneumatic_pick_idle.png",
        "miner_v04_pneumatic_pick_step.png",
        "miner_v04_pneumatic_pick_prepare.png",
        "miner_v04_pneumatic_pick_contact.png",
        "miner_v04_pneumatic_pick_recoil.png",
    ],
    [
        "miner_v05_super_pick_idle.png",
        "miner_v05_super_pick_step.png",
        "miner_v05_super_pick_prepare.png",
        "miner_v05_super_pick_contact.png",
        "miner_v05_super_pick_recoil.png",
    ],
    [
        "miner_v06_mining_laser_idle.png",
        "miner_v06_mining_laser_step.png",
        "miner_v06_mining_laser_aim.png",
        "miner_v06_mining_laser_fire.png",
        "miner_v06_mining_laser_recoil.png",
    ],
    [
        "miner_v07_solar_drill_idle.png",
        "miner_v07_solar_drill_step.png",
        "miner_v07_solar_drill_aim.png",
        "miner_v07_solar_drill_fire.png",
        "miner_v07_solar_drill_recoil.png",
    ],
]
SRGB_ICC_PROFILE = ImageCms.ImageCmsProfile(ImageCms.createProfile("sRGB")).tobytes()


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def warm_core_peak_y(cell: Image.Image) -> int:
    rgb = cell.convert("RGB")
    pixels = rgb.load()
    scores: list[int] = []
    for y in range(rgb.height):
        score = 0
        for x in range(rgb.width):
            red, green, blue = pixels[x, y]
            if red >= 125 and green >= 65 and red >= blue * 1.45 and green >= blue * 1.15:
                score += 1
        scores.append(score)
    return max(range(len(scores)), key=scores.__getitem__)


def install_miner_sheet(source_path: Path, output_directory: Path) -> dict[str, object]:
    with Image.open(source_path) as source:
        if source.size != (2560, 3584):
            raise ValueError(f"Miner sheet must be 2560x3584, got {source.size}")
        if source.mode != "RGBA":
            raise ValueError(f"Miner sheet must be RGBA, got {source.mode}")
        output_directory.mkdir(parents=True, exist_ok=True)
        frame_reports = []
        for row, filenames in enumerate(FRAME_ROWS):
            for column, filename in enumerate(filenames):
                cell = source.crop(
                    (column * 512, row * 512, (column + 1) * 512, (row + 1) * 512),
                )
                bbox = cell.getchannel("A").getbbox()
                if bbox is None:
                    raise ValueError(f"Empty miner cell at row {row}, column {column}")
                if bbox[0] == 0 or bbox[1] == 0 or bbox[2] == 512 or bbox[3] == 512:
                    raise ValueError(f"Miner cell touches its boundary at row {row}, column {column}: {bbox}")
                output_path = output_directory / filename
                cell.save(
                    output_path,
                    format="PNG",
                    optimize=True,
                    compress_level=9,
                    icc_profile=source.info.get("icc_profile") or SRGB_ICC_PROFILE,
                )
                frame_reports.append({
                    "filename": filename,
                    "row": row,
                    "column": column,
                    "bbox": list(bbox),
                    "sha256": sha256(output_path),
                })
        return {
            "source_sha256": sha256(source_path),
            "frames": frame_reports,
        }


def install_terrain_atlas(source_path: Path, output_path: Path, seal_shift_y: int) -> dict[str, object]:
    with Image.open(source_path) as source:
        if source.size != (1536, 1024):
            raise ValueError(f"Terrain atlas must be 1536x1024, got {source.size}")
        if source.mode != "RGB":
            raise ValueError(f"Terrain atlas must be RGB, got {source.mode}")
        runtime = source.copy()
        seal = runtime.crop((1024, 512, 1536, 1024))
        source_peak_y = warm_core_peak_y(seal)
        aligned_seal = ImageChops.offset(seal, 0, seal_shift_y)
        aligned_peak_y = warm_core_peak_y(aligned_seal)
        if not 250 <= aligned_peak_y <= 262:
            raise ValueError(
                f"Aligned final-seal core must peak near local y=256, got {aligned_peak_y}",
            )
        runtime.paste(aligned_seal, (1024, 512))
        output_path.parent.mkdir(parents=True, exist_ok=True)
        runtime.save(
            output_path,
            format="PNG",
            optimize=True,
            compress_level=9,
            icc_profile=source.info.get("icc_profile") or SRGB_ICC_PROFILE,
        )
        return {
            "source_sha256": sha256(source_path),
            "runtime_sha256": sha256(output_path),
            "final_seal_source_peak_y": source_peak_y,
            "final_seal_shift_y": seal_shift_y,
            "final_seal_runtime_peak_y": aligned_peak_y,
        }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--miner-sheet", required=True, type=Path)
    parser.add_argument("--terrain-atlas", required=True, type=Path)
    parser.add_argument("--character-output", required=True, type=Path)
    parser.add_argument("--terrain-output", required=True, type=Path)
    parser.add_argument("--seal-shift-y", type=int, default=-16)
    args = parser.parse_args()

    report = {
        "miner": install_miner_sheet(
            args.miner_sheet.resolve(),
            args.character_output.resolve(),
        ),
        "terrain": install_terrain_atlas(
            args.terrain_atlas.resolve(),
            args.terrain_output.resolve(),
            args.seal_shift_y,
        ),
    }
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
