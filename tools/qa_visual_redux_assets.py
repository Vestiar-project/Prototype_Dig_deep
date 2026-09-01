#!/usr/bin/env python3
"""Read-only QA for the generated visual-redux miner sheet and terrain atlas."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from PIL import Image, ImageChops, ImageStat


def alpha_metrics(image: Image.Image) -> dict[str, object]:
    if "A" not in image.getbands():
        return {
            "has_alpha": False,
            "alpha_extrema": None,
            "transparent_pixels": 0,
            "partial_alpha_pixels": 0,
            "opaque_pixels": image.width * image.height,
        }
    alpha = image.getchannel("A")
    histogram = alpha.histogram()
    return {
        "has_alpha": True,
        "alpha_extrema": list(alpha.getextrema()),
        "transparent_pixels": histogram[0],
        "partial_alpha_pixels": sum(histogram[1:255]),
        "opaque_pixels": histogram[255],
    }


def content_bbox(image: Image.Image) -> tuple[int, int, int, int] | None:
    if "A" in image.getbands():
        return image.getchannel("A").getbbox()
    rgb = image.convert("RGB")
    threshold = rgb.point(lambda value: 255 if value > 3 else 0)
    return threshold.getbbox()


def alpha_threshold_bbox(image: Image.Image, threshold: int) -> tuple[int, int, int, int] | None:
    if "A" not in image.getbands():
        return content_bbox(image)
    mask = image.getchannel("A").point(lambda value: 255 if value >= threshold else 0)
    return mask.getbbox()


def edge_rms(cell: Image.Image, axis: str, strip_width: int = 3) -> float:
    rgb = cell.convert("RGB")
    if axis == "x":
        first = rgb.crop((0, 0, strip_width, rgb.height))
        second = rgb.crop((rgb.width - strip_width, 0, rgb.width, rgb.height))
    else:
        first = rgb.crop((0, 0, rgb.width, strip_width))
        second = rgb.crop((0, rgb.height - strip_width, rgb.width, rgb.height))
    difference = ImageChops.difference(first, second)
    rms = ImageStat.Stat(difference).rms
    return round(sum(rms) / len(rms), 2)


def inspect_miner(path: Path) -> dict[str, object]:
    with Image.open(path) as source:
        image = source.convert("RGBA") if "A" in source.getbands() else source.copy()
        result: dict[str, object] = {
            "path": str(path),
            "format": source.format,
            "mode": source.mode,
            "size": list(source.size),
            "expected_size": [2560, 3584],
            "size_ok": source.size == (2560, 3584),
            "alpha": alpha_metrics(source),
            "cells": [],
        }
        if source.size != (2560, 3584):
            return result
        cells = []
        for row in range(7):
            for column in range(5):
                cell = image.crop((column * 512, row * 512, (column + 1) * 512, (row + 1) * 512))
                bbox = content_bbox(cell)
                if bbox is None:
                    cell_result = {
                        "row": row,
                        "column": column,
                        "bbox": None,
                        "touches_edge": False,
                    }
                else:
                    left, top, right, bottom = bbox
                    solid_bbox = alpha_threshold_bbox(cell, 32)
                    feet_mask = cell.getchannel("A").crop((0, 420, 512, 512)).point(
                        lambda value: 255 if value >= 32 else 0,
                    )
                    feet_bbox = feet_mask.getbbox()
                    cell_result = {
                        "row": row,
                        "column": column,
                        "bbox": [left, top, right, bottom],
                        "content_width": right - left,
                        "content_height": bottom - top,
                        "baseline_y": bottom,
                        "solid_bbox": list(solid_bbox) if solid_bbox else None,
                        "solid_baseline_y": solid_bbox[3] if solid_bbox else None,
                        "feet_bbox": (
                            [feet_bbox[0], feet_bbox[1] + 420, feet_bbox[2], feet_bbox[3] + 420]
                            if feet_bbox
                            else None
                        ),
                        "feet_center_x": round((feet_bbox[0] + feet_bbox[2]) / 2, 1) if feet_bbox else None,
                        "center_x": round((left + right) / 2, 1),
                        "touches_edge": left == 0 or top == 0 or right == 512 or bottom == 512,
                    }
                cells.append(cell_result)
        result["cells"] = cells
        bboxes = [cell["bbox"] for cell in cells if cell["bbox"]]
        result["summary"] = {
            "nonempty_cells": len(bboxes),
            "edge_touching_cells": sum(1 for cell in cells if cell.get("touches_edge")),
            "baseline_range": [
                min(cell["baseline_y"] for cell in cells if "baseline_y" in cell),
                max(cell["baseline_y"] for cell in cells if "baseline_y" in cell),
            ],
            "center_x_range": [
                min(cell["center_x"] for cell in cells if "center_x" in cell),
                max(cell["center_x"] for cell in cells if "center_x" in cell),
            ],
            "solid_baseline_range": [
                min(cell["solid_baseline_y"] for cell in cells if cell.get("solid_baseline_y") is not None),
                max(cell["solid_baseline_y"] for cell in cells if cell.get("solid_baseline_y") is not None),
            ],
            "feet_center_x_range": [
                min(cell["feet_center_x"] for cell in cells if cell.get("feet_center_x") is not None),
                max(cell["feet_center_x"] for cell in cells if cell.get("feet_center_x") is not None),
            ],
        }
        action_differences = []
        for row in range(7):
            row_cells = [
                image.crop((column * 512, row * 512, (column + 1) * 512, (row + 1) * 512))
                for column in range(5)
            ]
            pairs = []
            for column in range(4):
                difference = ImageChops.difference(row_cells[column], row_cells[column + 1])
                pairs.append({
                    "columns": [column, column + 1],
                    "difference_bbox": list(difference.getbbox()) if difference.getbbox() else None,
                })
            action_differences.append({"row": row, "adjacent_pairs": pairs})
        result["action_differences"] = action_differences
        return result


def inspect_terrain(path: Path) -> dict[str, object]:
    with Image.open(path) as source:
        rgb = source.convert("RGB")
        result: dict[str, object] = {
            "path": str(path),
            "format": source.format,
            "mode": source.mode,
            "size": list(source.size),
            "expected_size": [1536, 1024],
            "size_ok": source.size == (1536, 1024),
            "alpha": alpha_metrics(source),
            "cells": [],
        }
        if source.size != (1536, 1024):
            return result
        cells = []
        names = ["loam", "dirt", "stone", "deepstone", "bedrock", "final_seal"]
        for index, name in enumerate(names):
            column = index % 3
            row = index // 3
            cell = rgb.crop((column * 512, row * 512, (column + 1) * 512, (row + 1) * 512))
            mean = ImageStat.Stat(cell).mean
            cells.append(
                {
                    "name": name,
                    "mean_rgb": [round(value, 1) for value in mean],
                    "x_edge_rms": edge_rms(cell, "x"),
                    "y_edge_rms": edge_rms(cell, "y"),
                }
            )
        result["cells"] = cells

        seal = rgb.crop((1024, 512, 1536, 1024))
        row_scores = []
        pixels = seal.load()
        for y in range(512):
            score = 0
            for x in range(512):
                red, green, blue = pixels[x, y]
                if red >= 125 and green >= 65 and red >= blue * 1.45 and green >= blue * 1.15:
                    score += 1
            row_scores.append(score)
        peak_y = max(range(512), key=row_scores.__getitem__)
        active_rows = [index for index, score in enumerate(row_scores) if score >= 32]
        result["final_seal_core"] = {
            "peak_local_y": peak_y,
            "peak_global_y": peak_y + 512,
            "peak_warm_pixels": row_scores[peak_y],
            "active_local_y_range": [min(active_rows), max(active_rows)] if active_rows else None,
            "target_local_center_y": 256,
            "target_source_band": [242, 269],
        }
        return result


def compare_terrain_cells(candidate_path: Path, reference_path: Path) -> list[dict[str, object]]:
    names = ["loam", "dirt", "stone", "deepstone", "bedrock", "final_seal"]
    with Image.open(candidate_path) as candidate_source, Image.open(reference_path) as reference_source:
        candidate = candidate_source.convert("RGB")
        reference = reference_source.convert("RGB")
        if candidate.size != (1536, 1024) or reference.size != (1536, 1024):
            raise ValueError("Terrain comparison requires two 1536x1024 atlases")
        comparisons = []
        for index, name in enumerate(names):
            column = index % 3
            row = index // 3
            box = (column * 512, row * 512, (column + 1) * 512, (row + 1) * 512)
            difference = ImageChops.difference(candidate.crop(box), reference.crop(box))
            red, green, blue = difference.split()
            mask = ImageChops.lighter(ImageChops.lighter(red, green), blue)
            histogram = mask.histogram()
            mean_absolute_rgb = ImageStat.Stat(difference).mean
            comparisons.append({
                "name": name,
                "identical": mask.getbbox() is None,
                "changed_pixels": 512 * 512 - histogram[0],
                "mean_absolute_rgb": [round(value, 2) for value in mean_absolute_rgb],
            })
        return comparisons


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--miner", required=True, type=Path)
    parser.add_argument("--terrain", required=True, type=Path)
    parser.add_argument("--terrain-reference", type=Path)
    args = parser.parse_args()
    report = {
        "miner": inspect_miner(args.miner.resolve()),
        "terrain": inspect_terrain(args.terrain.resolve()),
    }
    if args.terrain_reference:
        report["terrain_comparison"] = compare_terrain_cells(
            args.terrain.resolve(),
            args.terrain_reference.resolve(),
        )
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
