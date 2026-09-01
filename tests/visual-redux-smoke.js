"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const exists = (relativePath) => fs.existsSync(path.join(root, relativePath));

const game = read("js/game.js");
const css = read("styles.css");
const html = read("index.html");
const characterManifest = JSON.parse(read("docs/art-packs/visual-redux-character-generation-pack-v1/manifest.json"));
const terrainManifest = JSON.parse(read("docs/art-packs/visual-redux-terrain-generation-pack-v1/manifest.json"));

assert.match(game, /const MINER_SPRITE_SCALE = 0\.275;/);
assert.match(game, /const MINER_ACTION_HOLD_SECONDS = Object\.freeze\(/);
assert.match(game, /function getRequestedMinerSpriteAction\(/);
assert.match(game, /function getMinerSpriteAction\([\s\S]*?minimumHold/);

const actionSource = game.match(
  /function getRequestedMinerSpriteAction\([\s\S]*?\n\}(?=\n\nfunction getMinerSpriteDescriptor)/,
)?.[0];
assert.ok(actionSource, "miner action stabilizer source missing");
const actionState = {
  mode: "run",
  elapsed: 0,
  target: { x: 0, y: 0 },
  stuckElapsed: 0,
  attackCooldown: 0,
};
const actionStats = { laserUnlocked: false, laserRange: 0, digReach: 30, toolTier: 1 };
const actionProbe = Function(
  "state",
  "stats",
  "distance",
  "TILE_SIZE",
  "MINER_ACTION_HOLD_SECONDS",
  "getMinerSpriteVariant",
  `"use strict";
   let minerSpriteActionState = { variant: null, action: "idle", since: 0 };
   ${actionSource}
   return { getMinerSpriteAction };`,
)(
  actionState,
  actionStats,
  (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay),
  28,
  { idle: 0.11, step: 0.1, prepare: 0.075, aim: 0.085, contact: 0.075, fire: 0.075, recoil: 0.12 },
  () => ({ id: "v01_worn_pick", ranged: false }),
);
const actionPlayer = { x: 0, y: 0, moving: 0, swing: 0 };
assert.equal(actionProbe.getMinerSpriteAction(actionPlayer, actionStats), "prepare");
actionState.elapsed = 0.01;
actionPlayer.swing = 0.8;
assert.equal(actionProbe.getMinerSpriteAction(actionPlayer, actionStats), "contact", "impact must remain immediate");
actionState.elapsed = 0.03;
actionPlayer.swing = 0;
actionState.attackCooldown = 1;
assert.equal(actionProbe.getMinerSpriteAction(actionPlayer, actionStats), "contact", "contact must not flicker away");
actionState.elapsed = 0.1;
assert.equal(actionProbe.getMinerSpriteAction(actionPlayer, actionStats), "idle");
assert.match(game, /drawDrones\(now, 'behind'\);\s*drawMiner\(now\);\s*drawDrones\(now, 'front'\);/);
assert.match(game, /const DRONE_VISUAL_STATE = new Map\(\);/);
assert.match(game, /droneIndex: index/);
assert.match(game, /dronePosition\(beam\.droneIndex, state\.elapsed\)/);
assert.match(game, /const angularSpeed = outerRing \? -0\.52 : 0\.66;/);
assert.match(game, /kind: 'drone-impact'/);
assert.match(game, /kind: 'blast-smoke'/);
assert.match(game, /const VFX_PALETTE = Object\.freeze\(/);
assert.match(game, /const blastParticleSlots = REDUCED_MOTION \? 14 : 26;/);
assert.match(game, /const sparkRandomBudget = 3 \+ Math\.round\(drillVisual \* 4\);/);
assert.match(game, /vfxFraction\(blastX, blastY, index, 1\)/, "new smoke must not consume gameplay RNG");
assert.match(game, /fillStyle = '#6f4535'/, "the surface lip must no longer be green");
assert.match(game, /Slow parallax shaftwork/);

const drawWorld = game.match(/function drawWorld\(now\) \{[\s\S]*?\n\}(?=\n\nfunction drawRuntimeFields)/)?.[0];
assert.ok(drawWorld, "drawWorld source missing");
assert.doesNotMatch(drawWorld, /Math\.random/, "camera shake must be deterministic");
assert.match(drawWorld, /REDUCED_MOTION \? 0\.14 : 1/);

assert.match(css, /VISUAL REDUX · authoritative final overrides/);
assert.match(css, /utility-nav__button--dev \{ display: none !important; \}/);
assert.match(css, /run-hud \.timer-module/);
assert.match(css, /upgrade-node\.is-dimmed \{ opacity: 0\.09; \}/);
assert.doesNotMatch(html, /id="openBalance"/);
assert.match(html, /styles\.css\?v=visual-redux-2/);
assert.match(html, /js\/game\.js\?v=visual-redux-2/);
assert.match(game, /const VISUAL_ASSET_REVISION = 'visual-redux-2';/);
assert.match(game, /terrainImage\.src = visualAssetSource\(FIELD_TERRAIN_ATLAS_SOURCE\);/);
for (const variantId of [
  "v01_worn_pick",
  "v02_iron_pick",
  "v03_steel_pick",
  "v04_pneumatic_pick",
  "v05_super_pick",
  "v06_mining_laser",
  "v07_solar_drill",
]) {
  assert.match(game, new RegExp(`${variantId}[^\\n]+scale:\\s*1(?:\\D|$)`));
}

assert.equal(characterManifest.artDirection.targetRuntimeBodyHeightCssPx, 68);
assert.equal(characterManifest.generation.generateAllTiersTogetherFirst, true);
assert.deepEqual(
  [characterManifest.generation.fullPack.columns, characterManifest.generation.fullPack.rows],
  [5, 7],
);
assert.equal(characterManifest.output.frameCount, 35);
assert.equal(terrainManifest.output.exactWidth, 1536);
assert.equal(terrainManifest.output.exactHeight, 1024);
assert.equal(terrainManifest.references.filter((reference) => reference.required).length, 3);

for (const relativePath of [
  "docs/art-packs/visual-redux-character-generation-pack-v1/FULL_PACK_PROMPT_RU.md",
  "docs/art-packs/visual-redux-character-generation-pack-v1/references/current-runtime-miner/animation_manifest.json",
  "docs/art-packs/visual-redux-character-generation-pack-v1/references/style-main-menu-hero.png",
  "docs/art-packs/visual-redux-character-generation-pack-v1/references/contrast-current-terrain.png",
  "docs/art-packs/visual-redux-terrain-generation-pack-v1/references/01_current_terrain_authoritative.png",
  "docs/art-packs/visual-redux-terrain-generation-pack-v1/references/02_current_ores_contrast_only.png",
  "docs/art-packs/visual-redux-terrain-generation-pack-v1/references/03_current_veins_contrast_only.png",
  "docs/art-packs/visual-redux-terrain-generation-pack-v1/references/04_field_master_style_only.png",
]) {
  assert.equal(exists(relativePath), true, `${relativePath} must be packaged`);
}

const terrainImageHandoffDir = path.join(root, "docs/art-packs/terrain-gpt-image-handoff");
const terrainImageHandoffFiles = fs.readdirSync(terrainImageHandoffDir).sort();
assert.deepEqual(terrainImageHandoffFiles, [
  "01_CURRENT_TERRAIN_LAYOUT.png",
  "02_ORES_CONTRAST_ONLY.png",
  "03_VEINS_CONTRAST_ONLY.png",
  "04_STYLE_ONLY.png",
  "PROMPT_TO_PASTE_RU.txt",
]);
const terrainPrompt = read("docs/art-packs/terrain-gpt-image-handoff/PROMPT_TO_PASTE_RU.txt");
assert.match(terrainPrompt, /1536×1024/);
assert.match(terrainPrompt, /3 колонки × 2 ряда/);
assert.match(terrainPrompt, /Каждая ячейка ровно 512×512 px/);
assert.match(terrainPrompt, /02_ORES_CONTRAST_ONLY\.png — только ориентир по контрасту/);
assert.match(terrainPrompt, /03_VEINS_CONTRAST_ONLY\.png — только ориентир по контрасту/);
assert.match(terrainPrompt, /Верни только один готовый atlas/);
assert.equal(
  exists("docs/art-packs/visual-redux-terrain-generation-pack-v1.zip"),
  false,
  "obsolete terrain ZIP must not be presented as an Image handoff",
);

for (const [source, handoff] of [
  ["visual-redux-terrain-generation-pack-v1/references/01_current_terrain_authoritative.png", "01_CURRENT_TERRAIN_LAYOUT.png"],
  ["visual-redux-terrain-generation-pack-v1/references/02_current_ores_contrast_only.png", "02_ORES_CONTRAST_ONLY.png"],
  ["visual-redux-terrain-generation-pack-v1/references/03_current_veins_contrast_only.png", "03_VEINS_CONTRAST_ONLY.png"],
  ["visual-redux-terrain-generation-pack-v1/references/04_field_master_style_only.png", "04_STYLE_ONLY.png"],
]) {
  const sourceBytes = fs.readFileSync(path.join(root, "docs/art-packs", source));
  const handoffBytes = fs.readFileSync(path.join(terrainImageHandoffDir, handoff));
  assert.equal(handoffBytes.equals(sourceBytes), true, `${handoff} must be an unchanged reference copy`);
}

console.log(JSON.stringify({
  ok: true,
  characterFrames: characterManifest.output.frameCount,
  characterSheet: `${characterManifest.generation.fullPack.columns}x${characterManifest.generation.fullPack.rows}`,
  terrainAtlas: `${terrainManifest.output.exactWidth}x${terrainManifest.output.exactHeight}`,
  terrainImageHandoff: `${terrainImageHandoffFiles.filter((file) => file.endsWith(".png")).length} images + 1 text`,
}));
