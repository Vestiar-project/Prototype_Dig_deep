"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const gameSource = fs.readFileSync(path.join(root, "js/game.js"), "utf8");
const indexSource = fs.readFileSync(path.join(root, "index.html"), "utf8");
const promptSource = fs.readFileSync(path.join(root, "docs/art-references/VEIN_CONNECTORS_IMAGE_PROMPT_RU.md"), "utf8");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "docs/art-references/vein-connectors-manifest.json"), "utf8"));
const guide = fs.readFileSync(path.join(root, "docs/art-references/vein-connectors-layout-guide.png"));
const zip = fs.readFileSync(path.join(root, "docs/art-packs/depth-zero-vein-connectors-generation-pack-v1.zip"));
const runtimeAtlas = fs.readFileSync(path.join(root, "assets/field/depth-zero-vein-connectors-runtime-atlas.png"));

const oreRenderer = gameSource.match(/function drawOreInTile\([\s\S]*?\n\}\n\nfunction drawCracks/);
assert.ok(oreRenderer, "ore renderer missing");
assert.doesNotMatch(oreRenderer[0], /verticalOreEdgeOffset|horizontalOreEdgeOffset/);
assert.doesNotMatch(oreRenderer[0], /ctx\.lineTo\(/, "legacy procedural vein strokes returned");
assert.match(oreRenderer[0], /drawRuntimeOreNode\(/, "approved ore nodes must remain active");
assert.doesNotMatch(oreRenderer[0], /drawRuntimeVein/, "veins need one shared pass, not a per-node cross");
assert.match(gameSource, /function drawRuntimeVeinEdge\(/, "authored connector material must follow each edge");
assert.match(gameSource, /function collectVisibleVeinEdges\(/, "visible ore neighbours must form a render-only graph");
assert.match(gameSource, /function buildVeinEdgePolyline\(/, "connector edges must bend deterministically");
assert.ok(
  gameSource.indexOf("drawVisibleVeinNetwork(visible, oreVisualStates);")
    < gameSource.indexOf("for (const entry of visible) drawTile(entry, now, 'overlay', oreVisualStates);"),
  "all connector branches must render before the approved ore nodes",
);
assert.match(gameSource, /FIELD_VEIN_ATLAS_SOURCE = 'assets\/field\/depth-zero-vein-connectors-runtime-atlas\.png'/);
assert.match(gameSource, /tile\.oreId !== oreId[\s\S]*tile\.veinId !== veinId/);
assert.match(gameSource, /cachedVisualState[\s\S]*cachedVisualState\.visible/);
assert.match(gameSource, /for \(const entry of visible\) drawTile\(entry, now, 'terrain'/);
assert.match(gameSource, /drawVisibleVeinNetwork\(visible, oreVisualStates\)/);
assert.match(gameSource, /for \(const entry of visible\) drawTile\(entry, now, 'overlay'/);
assert.match(indexSource, /deep-shaft-9-sense1/, "browser cache key was not advanced");

assert.equal(runtimeAtlas.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
assert.equal(runtimeAtlas.readUInt32BE(16), 2560);
assert.equal(runtimeAtlas.readUInt32BE(20), 1024);
assert.equal(runtimeAtlas[24], 8);
assert.equal(runtimeAtlas[25], 6, "vein connectors must retain true alpha");

assert.equal(manifest.assetId, "depth-zero-vein-connectors-v1");
assert.deepEqual([manifest.output.columns, manifest.output.rows], [5, 2]);
assert.equal(manifest.geometry.centralNodeIncluded, false);
assert.equal(manifest.runtimeContract.changesOreNodeCount, false);
assert.equal(manifest.cells.length, 10);
assert.deepEqual(manifest.cells.map((cell) => cell.id), [
  "copper",
  "coal",
  "iron",
  "amber",
  "silver",
  "gold",
  "amethyst",
  "prism_crystal",
  "void_ore",
  "star_core",
]);

assert.match(promptSource, /ОДИН четырёхрукавный модуль/);
assert.match(promptSource, /oreId and veinId|oreId и veinId|oreId.*veinId/s);
assert.match(promptSource, /не добавляй новые самородки/u);
assert.match(promptSource, /28×28 px/u);

assert.equal(guide.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
assert.equal(guide.readUInt32BE(16), 2000);
assert.equal(guide.readUInt32BE(20), 800);

assert.equal(zip.subarray(0, 4).toString("hex"), "504b0304", "generation pack is not a ZIP archive");
for (const entry of [
  "PROMPT_RU.md",
  "NEGATIVE_PROMPT_RU.txt",
  "manifest.json",
  "references/01_ore_nodes_authoritative.png",
  "references/02_terrain_authoritative.png",
  "references/03_topology_and_scale.png",
]) {
  assert.ok(zip.includes(Buffer.from(entry, "utf8")), `ZIP entry missing: ${entry}`);
}
assert.equal(zip.includes(Buffer.from("master-atlas", "utf8")), false, "the redundant master atlas should not confuse generation");

console.log("vein generation pack smoke test passed");
