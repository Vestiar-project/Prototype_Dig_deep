"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

const crcTable = new Uint32Array(256);
for (let index = 0; index < crcTable.length; index += 1) {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
  crcTable[index] = value >>> 0;
}

function crc32(buffer) {
  let value = 0xffffffff;
  for (const byte of buffer) value = crcTable[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

function validatePngChunks(buffer, relativePath) {
  let offset = 8;
  let sawIend = false;
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const typeStart = offset + 4;
    const dataEnd = typeStart + 4 + length;
    const crcOffset = dataEnd;
    assert.ok(crcOffset + 4 <= buffer.length, `${relativePath} has a truncated PNG chunk`);
    const type = buffer.subarray(typeStart, typeStart + 4).toString("ascii");
    const expectedCrc = buffer.readUInt32BE(crcOffset);
    const actualCrc = crc32(buffer.subarray(typeStart, dataEnd));
    assert.equal(actualCrc, expectedCrc, `${relativePath} has a bad ${type} CRC`);
    offset = crcOffset + 4;
    if (type === "IEND") {
      sawIend = true;
      break;
    }
  }
  assert.equal(sawIend, true, `${relativePath} has no complete IEND chunk`);
}

function readPngHeader(relativePath) {
  const absolutePath = path.join(root, relativePath);
  const buffer = fs.readFileSync(absolutePath);
  assert.equal(buffer.subarray(0, 8).toString("hex"), "89504e470d0a1a0a", `${relativePath} is not a PNG`);
  assert.equal(buffer.subarray(12, 16).toString("ascii"), "IHDR", `${relativePath} has no IHDR`);
  validatePngChunks(buffer, relativePath);
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
    bitDepth: buffer[24],
    colorType: buffer[25],
  };
}

assert.deepEqual(readPngHeader("assets/field/depth-zero-field-art-master-atlas.png"), {
  width: 2048,
  height: 2048,
  bitDepth: 8,
  colorType: 2,
});
assert.deepEqual(readPngHeader("assets/field/depth-zero-terrain-runtime-atlas.png"), {
  width: 1536,
  height: 1024,
  bitDepth: 8,
  colorType: 2,
});
assert.deepEqual(readPngHeader("assets/field/depth-zero-ores-runtime-atlas.png"), {
  width: 1774,
  height: 887,
  bitDepth: 8,
  colorType: 6,
});
assert.deepEqual(readPngHeader("assets/field/depth-zero-vein-connectors-runtime-atlas.png"), {
  width: 2560,
  height: 1024,
  bitDepth: 8,
  colorType: 6,
});

assert.equal(fs.existsSync(path.join(root, "assets/field/depth-zero-ores-chroma-source.png")), false);
assert.equal(fs.existsSync(path.join(root, "assets/field/depth-zero-field-art-master-atlas-sanitized.png")), false);

const gameSource = fs.readFileSync(path.join(root, "js/game.js"), "utf8");
const worldSource = fs.readFileSync(path.join(root, "js/world.js"), "utf8");

assert.match(gameSource, /FIELD_TERRAIN_ATLAS_SOURCE = 'assets\/field\/depth-zero-terrain-runtime-atlas\.png'/);
assert.match(gameSource, /FIELD_ORE_ATLAS_SOURCE = 'assets\/field\/depth-zero-ores-runtime-atlas\.png'/);
assert.match(gameSource, /FIELD_VEIN_ATLAS_SOURCE = 'assets\/field\/depth-zero-vein-connectors-runtime-atlas\.png'/);
assert.match(gameSource, /width: 1536, height: 1024, cellSize: 512/);
assert.match(gameSource, /width: 1774, height: 887/);
assert.match(gameSource, /width: 2560, height: 1024, cellSize: 512/);
assert.match(gameSource, /function requestFieldArtAssets\(\)/);
assert.match(gameSource, /if \(FIELD_ART_RUNTIME\.terrainReady\) resetTerrainBaseCache\(\)/);
assert.match(gameSource, /function mirroredAtlasAxisSegments\(/);
assert.match(gameSource, /function drawMirroredAtlasRegion\(/);
assert.match(gameSource, /function drawRuntimeTerrainTexture\(/);
assert.match(gameSource, /function drawRuntimeOreNode\(/);
assert.match(gameSource, /function drawRuntimeVeinConnectors\(/);
assert.match(gameSource, /function getVeinConnectorMask\(/);
assert.match(gameSource, /function addVeinConnectorArmClip\(/);
assert.match(gameSource, /const runtimeTextureDrawn = drawRuntimeTerrainTexture\(/);
assert.match(gameSource, /if \(!drawRuntimeOreNode\(/);

for (const terrainId of ["loam", "dirt", "stone", "deepstone", "bedrock", "final_seal"]) {
  assert.match(gameSource, new RegExp(`\\b${terrainId}: Object\\.freeze\\(\\{`), `missing ${terrainId} terrain cell`);
}
for (const oreId of [
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
]) {
  assert.match(gameSource, new RegExp(`\\b${oreId}: Object\\.freeze\\(\\{`), `missing ${oreId} ore crop`);
}

const veinLayoutBlock = gameSource.match(/const FIELD_VEIN_ATLAS_LAYOUT = Object\.freeze\(\{([\s\S]*?)\n\}\);/);
assert.ok(veinLayoutBlock, "authored vein atlas layout missing");
for (const oreId of [
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
]) {
  assert.match(
    veinLayoutBlock[1],
    new RegExp(`\\b${oreId}: Object\\.freeze\\(\\{[^}]*portWidthRatio:`),
    `missing ${oreId} vein connector cell`,
  );
}

assert.doesNotMatch(worldSource, /assets\/field|FIELD_(?:TERRAIN|ORE|VEIN)_ATLAS/);
assert.match(gameSource, /drawTerrainDepthTone\(/);
assert.match(gameSource, /drawTerrainEdgeLandmark\(/);
assert.match(gameSource, /drawCracks\(/);
assert.match(gameSource, /const glowTier = clamp\(\(ore\.tier \|\| 0\) - 2, 0, 7\)/);

console.log("field art assets smoke test passed");
