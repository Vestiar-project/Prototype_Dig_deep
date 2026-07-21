"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const assetDirectory = path.join(root, "assets", "characters", "miner");
const manifest = JSON.parse(fs.readFileSync(path.join(assetDirectory, "animation_manifest.json"), "utf8"));
const gameSource = fs.readFileSync(path.join(root, "js", "game.js"), "utf8");

assert.equal(manifest.format_version, 1);
assert.deepEqual(manifest.source_canvas, { width: 1024, height: 1024, format: "PNG", color_mode: "RGBA" });
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
}

assert.match(gameSource, /MINER_SPRITE_DIRECTORY\s*=\s*['"]assets\/characters\/miner['"]/);
assert.match(gameSource, /MINER_SPRITE_CACHE\.clear\(\)/, "old equipment frames must be released between tiers");
assert.match(gameSource, /player\.facing\s*\*\s*spriteScale/, "left-facing movement must mirror the supplied right-facing art");
assert.match(gameSource, /spriteDescriptor\.action\s*===\s*['"]step['"]/);
assert.match(gameSource, /player\.swing\s*>=\s*0\.66/);
assert.match(gameSource, /variant\.ranged\s*\?\s*['"]fire['"]\s*:\s*['"]contact['"]/);
assert.match(gameSource, /variant\.ranged\s*\?\s*['"]aim['"]\s*:\s*['"]prepare['"]/);
assert.match(gameSource, /v05_super_pick[^\n]+scale:\s*1\.37/, "the undersized super-pick art needs normalization");
assert.match(gameSource, /solarDrillEnabled[\s\S]*?MINER_SPRITE_VARIANTS\[6\]/, "the final art must wait for the actual Solar Drill");
assert.match(gameSource, /if\s*\(sprite\)[\s\S]*?ctx\.drawImage\([\s\S]*?return;/);
assert.match(gameSource, /drawTool\(\);/, "the procedural miner must remain as an asset-load fallback");

console.log(JSON.stringify({
  ok: true,
  variants: manifest.variants.length,
  frames: actualFiles.length,
  runtimeSizeBytes: actualFiles.reduce((sum, filename) => sum + fs.statSync(path.join(assetDirectory, filename)).size, 0),
}));
