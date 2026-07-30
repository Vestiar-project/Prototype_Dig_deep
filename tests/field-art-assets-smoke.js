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

function extractFunctionSource(name, nextName) {
  const pattern = new RegExp(
    `function ${name}\\([\\s\\S]*?\\n\\}(?=\\n\\nfunction ${nextName}\\()`,
  );
  const match = gameSource.match(pattern);
  assert.ok(match, `${name} renderer source missing`);
  return match[0];
}

function compileExtractedFunction(source, name, dependencies) {
  const dependencyNames = Object.keys(dependencies);
  return Function(
    ...dependencyNames,
    `"use strict";\n${source}\nreturn ${name};`,
  )(...dependencyNames.map((dependency) => dependencies[dependency]));
}

// Exercise the approved ore atlas against a recording canvas instead of only
// matching implementation text. An unrevealed node must still reach drawImage,
// but through its own dim treatment; sensing restores the ordinary treatment.
const runtimeOreDrawCalls = [];
const runtimeOreStateStack = [];
const runtimeOreContext = {
  globalAlpha: 1,
  filter: "none",
  imageSmoothingEnabled: false,
  save() {
    runtimeOreStateStack.push({
      globalAlpha: this.globalAlpha,
      filter: this.filter,
      imageSmoothingEnabled: this.imageSmoothingEnabled,
    });
  },
  restore() {
    Object.assign(this, runtimeOreStateStack.pop() || {});
  },
  translate() {},
  rotate() {},
  scale() {},
  drawImage(image, ...args) {
    runtimeOreDrawCalls.push({
      image,
      args,
      alpha: this.globalAlpha,
      filter: this.filter,
    });
  },
};
const runtimeOreImage = { id: "ore-runtime-atlas" };
const drawRuntimeOreNodeProbe = compileExtractedFunction(
  extractFunctionSource("drawRuntimeOreNode", "getRuntimeVeinSprite"),
  "drawRuntimeOreNode",
  {
    FIELD_ORE_ATLAS_LAYOUT: {
      copper: { x: 10, y: 20, width: 80, height: 64 },
    },
    getOreNodeRenderMetrics: () => ({ drawWidth: 28, drawHeight: 24 }),
    FIELD_ART_RUNTIME: {
      oreReady: true,
      oreImage: runtimeOreImage,
    },
    ctx: runtimeOreContext,
  },
);

assert.equal(
  drawRuntimeOreNodeProbe(16, 16, { id: "copper" }, false, 0.25, 0.75),
  true,
  "an unrevealed ore node must still use the runtime atlas",
);
assert.equal(runtimeOreDrawCalls.length, 1, "hidden ore must issue one atlas draw");
assert.equal(runtimeOreDrawCalls[0].image, runtimeOreImage);
assert.equal(runtimeOreDrawCalls[0].alpha, 0.62, "hidden atlas ore needs a readable dim alpha");
assert.equal(
  runtimeOreDrawCalls[0].filter,
  "grayscale(0.78) saturate(0.18) brightness(0.38) contrast(1.15)",
  "hidden atlas ore needs a distinct dark, desaturated treatment",
);

assert.equal(
  drawRuntimeOreNodeProbe(16, 16, { id: "copper" }, true, 0.25, 0.75),
  true,
);
assert.equal(runtimeOreDrawCalls.length, 2);
assert.equal(runtimeOreDrawCalls[1].alpha, 0.98);
assert.equal(runtimeOreDrawCalls[1].filter, "none");

const oreTileRendererSource = extractFunctionSource("drawOreInTile", "drawCracks");
assert.match(
  oreTileRendererSource,
  /ctx\.globalAlpha = revealed \? 0\.92 : 0\.54/,
  "the procedural fallback must keep hidden ore silhouettes readable",
);
assert.match(oreTileRendererSource, /ctx\.globalAlpha = revealed \? 1 : 0\.48/);
assert.match(
  oreTileRendererSource,
  /ctx\.fillStyle = revealed \? ore\.color : '#263335'/,
  "the fallback must not leak the unrevealed ore colour",
);

function createSenseRecordingContext() {
  const strokes = [];
  const stack = [];
  const context = {
    globalAlpha: 1,
    lineWidth: 1,
    lineCap: "butt",
    strokeStyle: "",
    lineDash: [],
    currentPath: [],
    strokes,
    save() {
      stack.push({
        globalAlpha: this.globalAlpha,
        lineWidth: this.lineWidth,
        lineCap: this.lineCap,
        strokeStyle: this.strokeStyle,
        lineDash: [...this.lineDash],
      });
    },
    restore() {
      Object.assign(this, stack.pop() || {});
    },
    setLineDash(value) {
      this.lineDash = [...value];
    },
    beginPath() {
      this.currentPath = [];
    },
    arc(x, y, radius, start, end) {
      this.currentPath.push({ type: "arc", x, y, radius, start, end });
    },
    moveTo(x, y) {
      this.currentPath.push({ type: "move", x, y });
    },
    lineTo(x, y) {
      this.currentPath.push({ type: "line", x, y });
    },
    stroke() {
      strokes.push({
        path: this.currentPath.map((command) => ({ ...command })),
        alpha: this.globalAlpha,
        lineWidth: this.lineWidth,
        lineDash: [...this.lineDash],
      });
    },
    fill() {},
    createRadialGradient() {
      return { addColorStop() {} };
    },
  };
  return context;
}

function renderSenseProbe(now) {
  const senseContext = createSenseRecordingContext();
  const player = { x: 120, y: 220 };
  const drawSenseFieldProbe = compileExtractedFunction(
    extractFunctionSource("drawSenseField", "drawTargeting"),
    "drawSenseField",
    {
      state: { player, ping: 0 },
      REDUCED_MOTION: false,
      stats: { sensePulseSpeed: 1 },
      getFocusedOre: () => null,
      effectiveSenseRadius: () => 96,
      focusedSenseMultiplier: () => 1,
      clamp: (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value)),
      ctx: senseContext,
    },
  );
  drawSenseFieldProbe(now);
  return { player, strokes: senseContext.strokes };
}

function findSenseBoundary(render) {
  return render.strokes.find((stroke) => (
    stroke.lineDash.join(",") === "5,7"
    && stroke.path.length === 1
    && stroke.path[0].type === "arc"
    && stroke.path[0].start === 0
    && stroke.path[0].end === Math.PI * 2
  ));
}

const firstSenseRender = renderSenseProbe(250);
const secondSenseRender = renderSenseProbe(1750);
const firstSenseBoundary = findSenseBoundary(firstSenseRender);
const secondSenseBoundary = findSenseBoundary(secondSenseRender);
assert.ok(firstSenseBoundary, "sense needs a steady dashed boundary");
assert.ok(secondSenseBoundary, "sense boundary must survive every animation phase");
assert.equal(firstSenseBoundary.path[0].radius, 96, "boundary must use the exact effective sense radius");
assert.equal(secondSenseBoundary.path[0].radius, 96, "sense animation must not move the actual boundary");
assert.equal(firstSenseBoundary.alpha, 0.34);
assert.equal(firstSenseBoundary.lineWidth, 1.35);

const senseBoundaryTicks = firstSenseRender.strokes.filter((stroke) => (
  stroke.lineDash.length === 0
  && stroke.lineWidth === 2.4
  && stroke.path.length === 2
  && stroke.path[0].type === "move"
  && stroke.path[1].type === "line"
));
assert.equal(senseBoundaryTicks.length, 8, "the scanner boundary needs eight obvious range ticks");
for (const tick of senseBoundaryTicks) {
  const innerRadius = Math.hypot(
    tick.path[0].x - firstSenseRender.player.x,
    tick.path[0].y - firstSenseRender.player.y,
  );
  const outerRadius = Math.hypot(
    tick.path[1].x - firstSenseRender.player.x,
    tick.path[1].y - firstSenseRender.player.y,
  );
  assert.ok(Math.abs(innerRadius - 92) < 1e-9);
  assert.ok(Math.abs(outerRadius - 100) < 1e-9);
}

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
assert.match(gameSource, /function drawRuntimeVeinEdge\(/);
assert.match(gameSource, /function collectVisibleVeinEdges\(/);
assert.match(gameSource, /function drawVisibleVeinNetwork\(/);
assert.match(gameSource, /function buildVeinEdgePolyline\(/);
assert.match(gameSource, /function getVeinConnectorMask\(/);
assert.match(gameSource, /function getOreNodeTransform\(/);
assert.doesNotMatch(gameSource, /function addVeinConnectorArmClip\(/);
assert.match(gameSource, /const runtimeTextureDrawn = drawRuntimeTerrainTexture\(/);
assert.match(gameSource, /if \(!drawRuntimeOreNode\(/);
assert.match(gameSource, /FIELD_ORE_NODE_MIN_SIZE = 32\.5/);
assert.match(gameSource, /FIELD_ORE_NODE_TIER_STEP = 0\.5/);
assert.match(gameSource, /FIELD_ORE_NODE_MAX_SIZE = 37/);
assert.match(gameSource, /FIELD_ORE_FALLBACK_SCALE = 1\.32/);
assert.match(gameSource, /FIELD_VEIN_WIDTH_SCALE = 0\.72/);
assert.match(
  gameSource,
  /FIELD_DIRECTIONAL_ORE_IDS = new Set\(\['copper', 'iron', 'silver', 'gold'\]\)/,
  "only the four elongated ore materials should receive vein-aware orientation",
);
assert.match(gameSource, /FIELD_DIRECTIONAL_ORE_SOURCE_ANGLES = Object\.freeze\(\{/);
assert.match(gameSource, /getVeinConnectorMask\(tx, ty, ore\.id, tile\.veinId, oreVisualStates\)/);
assert.match(
  gameSource,
  /drawTile\(entry, now, 'terrain', oreVisualStates\);[\s\S]*drawVisibleVeinNetwork\(visible, oreVisualStates\);[\s\S]*drawTile\(entry, now, 'overlay', oreVisualStates\);/,
  "the complete connector network must render before every enlarged ore node",
);

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
