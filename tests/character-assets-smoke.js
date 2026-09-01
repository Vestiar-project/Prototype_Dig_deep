"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const assetDirectory = path.join(root, "assets", "characters", "miner");
const manifest = JSON.parse(fs.readFileSync(path.join(assetDirectory, "animation_manifest.json"), "utf8"));
const gameSource = fs.readFileSync(path.join(root, "js", "game.js"), "utf8");

assert.equal(manifest.format_version, 1);
assert.equal(manifest.revision, "visual-redux-2");
assert.equal(
  manifest.source_sheet,
  "docs/art-sources/visual-redux-2026-09-01/depth-zero-miner-sprite-sheet-5x7.png",
);
assert.deepEqual(manifest.source_canvas, { width: 2560, height: 3584, format: "PNG", color_mode: "RGBA" });
assert.deepEqual(
  [manifest.sheet_layout.columns, manifest.sheet_layout.rows],
  [5, 7],
);
assert.equal(manifest.sheet_layout.cell_width, 512);
assert.equal(manifest.sheet_layout.cell_height, 512);
assert.equal(manifest.runtime_resample, "none; direct fixed-cell crop");
assert.equal(manifest.canvas.width, 512);
assert.equal(manifest.canvas.height, 512);
assert.equal(manifest.canvas.color_mode, "RGBA");
assert.equal(manifest.canvas.background, "transparent");
assert.equal(manifest.facing, "right");
assert.equal(manifest.baseline_y, 450);
assert.deepEqual(manifest.pivot, { x: 193, y: 450, definition: "center_between_boots" });
assert.equal(manifest.variants.length, 7, "the miner must cover all seven equipment tiers");

const expectedFiles = manifest.variants.flatMap((variant) => variant.frames).sort();
const actualFiles = fs.readdirSync(assetDirectory)
  .filter((filename) => filename.toLocaleLowerCase("en").endsWith(".png"))
  .sort();
assert.equal(expectedFiles.length, 35);
assert.equal(new Set(expectedFiles).size, expectedFiles.length, "character frames must not repeat filenames");
assert.deepEqual(actualFiles, expectedFiles, "the runtime folder must exactly match the character manifest");

for (const filename of actualFiles) {
  const png = fs.readFileSync(path.join(assetDirectory, filename));
  assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a", `${filename} must be a PNG`);
  assert.equal(png.readUInt32BE(16), 512, `${filename} must be 512 px wide`);
  assert.equal(png.readUInt32BE(20), 512, `${filename} must be 512 px tall`);
  assert.equal(png[24], 8, `${filename} must use 8-bit channels`);
  assert.equal(png[25], 6, `${filename} must retain RGBA transparency`);
  assert.equal(png.includes(Buffer.from("iCCP", "ascii")), true, `${filename} must retain an sRGB ICC profile`);
}

assert.match(gameSource, /MINER_SPRITE_DIRECTORY\s*=\s*['"]assets\/characters\/miner['"]/);
assert.match(gameSource, /MINER_SPRITE_CACHE\.clear\(\)/, "old equipment frames must be released between tiers");
assert.match(gameSource, /player\.facing\s*\*\s*spriteScale/, "left-facing movement must mirror the supplied right-facing art");
assert.match(gameSource, /spriteDescriptor\.action\s*===\s*['"]step['"]/);
assert.match(gameSource, /player\.swing\s*>=\s*0\.66/);
assert.match(gameSource, /variant\.ranged\s*\?\s*['"]fire['"]\s*:\s*['"]contact['"]/);
assert.match(gameSource, /variant\.ranged\s*\?\s*['"]aim['"]\s*:\s*['"]prepare['"]/);
for (const variant of manifest.variants) {
  assert.match(
    gameSource,
    new RegExp(`${variant.id}[^\\n]+scale:\\s*1(?:\\D|$)`),
    `${variant.id} must use the shared visual-redux scale`,
  );
}
assert.match(gameSource, /const VISUAL_ASSET_REVISION = 'visual-redux-2';/);
assert.match(gameSource, /src: visualAssetSource\(`\$\{MINER_SPRITE_DIRECTORY\}\/\$\{filename\}`\)/);
assert.match(gameSource, /solarDrillEnabled[\s\S]*?MINER_SPRITE_VARIANTS\[6\]/, "the final art must wait for the actual Solar Drill");
assert.match(gameSource, /if\s*\(sprite\)[\s\S]*?ctx\.drawImage\([\s\S]*?return;/);
assert.match(gameSource, /drawTool\(\);/, "the procedural miner must remain as an asset-load fallback");

const sourceSheet = fs.readFileSync(path.join(root, manifest.source_sheet));
assert.equal(sourceSheet.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
assert.equal(sourceSheet.readUInt32BE(16), 2560);
assert.equal(sourceSheet.readUInt32BE(20), 3584);
assert.equal(sourceSheet[25], 6, "the visual-redux source sheet must retain RGBA transparency");

const mappingRows = fs.readFileSync(path.join(assetDirectory, "manifest.tsv"), "utf8").trim().split(/\r?\n/);
assert.equal(mappingRows.length, 36, "the mapping table needs one header and all 35 runtime frames");
assert.equal(mappingRows[0], "file\tvariant\trow\tcolumn\tpose");

console.log(JSON.stringify({
  ok: true,
  variants: manifest.variants.length,
  frames: actualFiles.length,
  runtimeSizeBytes: actualFiles.reduce((sum, filename) => sum + fs.statSync(path.join(assetDirectory, filename)).size, 0),
}));
