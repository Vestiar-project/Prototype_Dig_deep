"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");

global.window = global;
const root = path.resolve(__dirname, "..");
require(path.join(root, "js", "upgrades.js"));
require(path.join(root, "js", "world.js"));

const { ORE_TYPES } = global.DepthZeroUpgrades;
const {
  GEOLOGICAL_SECTORS,
  GLOBAL_EVENT_TYPES,
  UNDERGROUND_EVENT_TYPES,
  MineWorld,
  WORLD_CONFIG,
  createRandomGeologyProfile,
  getSectorChoices,
} = global.DepthZeroWorld;

const oreById = new Map(ORE_TYPES.map((ore) => [ore.id, ore]));

assert.equal(WORLD_CONFIG.WIDTH, 120, "the mine must use the narrower 120-tile field");
assert.equal(WORLD_CONFIG.HEIGHT, 180, "the mine must trade lateral sprawl for meaningful depth");
assert.equal(WORLD_CONFIG.METERS_PER_TILE, 5, "one terrain row must represent five metres");
assert.equal(WORLD_CONFIG.SPAWN_TX, WORLD_CONFIG.WIDTH / 2, "the surface landing must be centered");
assert.equal(WORLD_CONFIG.CAVE_COUNT, 44, "cave count must preserve cave density across the taller field");

const depthHardnessWorld = new MineWorld(ORE_TYPES, "depth-hardness-regression", { sectorId: "stable_strata" });
const terrainHpAtDepth = (depthTiles) => {
  const values = [];
  for (let tx = 0; tx < WORLD_CONFIG.WIDTH; tx += 1) {
    const ty = depthHardnessWorld.surface[tx] + depthTiles;
    const tile = depthHardnessWorld.getTile(tx, ty);
    if (tile && tile.kind !== "air" && tile.kind !== "bedrock") values.push(tile.terrainMaxHp);
  }
  values.sort((left, right) => left - right);
  return values[Math.floor(values.length / 2)];
};
const shallowTerrainHp = terrainHpAtDepth(20);
const deepTerrainHp = terrainHpAtDepth(150);
assert.ok(shallowTerrainHp > 0 && deepTerrainHp > 0, "both shallow and deep strata must contain mineable terrain");
assert.ok(
  deepTerrainHp >= shallowTerrainHp * 3,
  `deep rock must justify late tools (${shallowTerrainHp} HP near 100 m, ${deepTerrainHp} HP near 750 m)`,
);
for (let index = 1; index < ORE_TYPES.length; index += 1) {
  assert.ok(
    ORE_TYPES[index].hardness > ORE_TYPES[index - 1].hardness,
    `ore tier ${index + 1} must be harder than tier ${index}`,
  );
}

const overlapWorld = new MineWorld(ORE_TYPES, "overlapping-vein-hp", { sectorId: "stable_strata" });
let overlapTarget = null;
for (let ty = WORLD_CONFIG.HEIGHT - WORLD_CONFIG.BEDROCK_ROWS - 4; ty >= 1 && !overlapTarget; ty -= 1) {
  for (let tx = 1; tx < WORLD_CONFIG.WIDTH - 1; tx += 1) {
    const tile = overlapWorld.getTile(tx, ty);
    if (tile && tile.kind !== "air" && tile.kind !== "bedrock") {
      overlapTarget = { tx, ty, tile };
      break;
    }
  }
}
assert.ok(overlapTarget, "the generated mine must expose a solid tile for overlap regression");
const underlyingRockHp = overlapTarget.tile.terrainMaxHp;
const starDefinition = overlapWorld._oreDefinitions.find((definition) => definition.id === "star_core");
const goldDefinition = overlapWorld._oreDefinitions.find((definition) => definition.id === "gold");
assert.ok(starDefinition && goldDefinition);
assert.equal(overlapWorld._applyOre(overlapTarget.tx, overlapTarget.ty, starDefinition, "overlap-star"), true);
assert.equal(
  overlapWorld.getTile(overlapTarget.tx, overlapTarget.ty).maxHp,
  Math.round(underlyingRockHp * oreById.get("star_core").hardness),
  "first ore must derive durability from the underlying terrain",
);
assert.equal(overlapWorld._applyOre(overlapTarget.tx, overlapTarget.ty, goldDefinition, "overlap-gold"), true);
assert.equal(
  overlapWorld.getTile(overlapTarget.tx, overlapTarget.ty).maxHp,
  Math.round(underlyingRockHp * oreById.get("gold").hardness),
  "crossing veins must replace, not compound, ore hardness",
);

assert.deepEqual(
  Object.fromEntries(ORE_TYPES.map((ore) => [ore.id, ore.depth])),
  {
    copper: 0,
    coal: 112,
    iron: 420,
    amber: 952,
    silver: 1568,
    gold: 2128,
    amethyst: 2688,
    prism_crystal: 3248,
    void_ore: 3808,
    star_core: 4312,
  },
  "ore bands must span the full vertical mine instead of bunching near the surface",
);

function worldMetrics(world) {
  let undergroundAir = 0;
  let solidHp = 0;
  let solidTiles = 0;
  let oreTiles = 0;
  const veinSizes = new Map();

  for (let ty = 0; ty < WORLD_CONFIG.HEIGHT - WORLD_CONFIG.BEDROCK_ROWS; ty += 1) {
    for (let tx = 0; tx < WORLD_CONFIG.WIDTH; tx += 1) {
      const tile = world.getTile(tx, ty);
      if (ty >= world.surface[tx] && tile?.kind === "air") undergroundAir += 1;
      if (tile && tile.kind !== "air" && tile.kind !== "bedrock") {
        solidHp += tile.maxHp;
        solidTiles += 1;
      }
      if (tile?.oreId) {
        oreTiles += 1;
        veinSizes.set(tile.veinId, (veinSizes.get(tile.veinId) || 0) + 1);
      }
    }
  }

  return {
    undergroundAir,
    averageSolidHp: solidHp / Math.max(1, solidTiles),
    oreTiles,
    veinCount: veinSizes.size,
    averageVeinSize: oreTiles / Math.max(1, veinSizes.size),
  };
}

function tileFingerprint(world) {
  let hash = 0x811c9dc5;
  for (let ty = 0; ty < WORLD_CONFIG.HEIGHT; ty += 1) {
    for (let tx = 0; tx < WORLD_CONFIG.WIDTH; tx += 1) {
      const tile = world.getTile(tx, ty);
      const text = `${tile.kind}:${tile.maxHp}:${tile.oreId || "-"}:${tile.veinId || "-"}`;
      for (let index = 0; index < text.length; index += 1) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
      }
    }
  }
  return hash >>> 0;
}

function assertAuthoredVerticalOreDepth(world, label) {
  let checked = 0;
  world.forEachOreTileInBounds(0, 0, WORLD_CONFIG.WIDTH - 1, WORLD_CONFIG.HEIGHT - 1, (tile, tx, ty) => {
    const ore = oreById.get(tile.oreId);
    if (!ore || ore.tier < 4) return;
    const authoredDepth = Number(ore.depth);
    if (!Number.isFinite(authoredDepth) || authoredDepth <= 1) return;
    const localSurface = world.surface[tx] ?? WORLD_CONFIG.SURFACE_BASE;
    const verticalDepth = Math.max(0, ty - localSurface) * WORLD_CONFIG.TILE_SIZE;
    assert.ok(
      verticalDepth + 0.001 >= authoredDepth,
      `${label}: ${ore.id} at ${tx}:${ty} appeared ${verticalDepth}px down, before its ${authoredDepth}px vertical gate`,
    );
    checked += 1;
  });
  return checked;
}

// The 120x180 field has the same tile area as the former 240x90 field. Vein
// budgets scale by width because the generator already distributes them over
// the available rows; cave count scales by area. Both densities should remain
// in their established bands without enlarging authored veins.
const densitySamples = 32;
let densityOreTiles = 0;
let densityUndergroundAir = 0;
let checkedDepthGatedOre = 0;
for (let index = 0; index < densitySamples; index += 1) {
  const world = new MineWorld(ORE_TYPES, `density-preservation-${index}`, { sectorId: "stable_strata" });
  const metrics = worldMetrics(world);
  densityOreTiles += metrics.oreTiles;
  densityUndergroundAir += metrics.undergroundAir;
  checkedDepthGatedOre += assertAuthoredVerticalOreDepth(world, `density seed ${index}`);
}
const sampledWorldTiles = densitySamples * WORLD_CONFIG.WIDTH * WORLD_CONFIG.HEIGHT;
const sampledOreDensity = densityOreTiles / sampledWorldTiles;
const sampledCaveDensity = densityUndergroundAir / sampledWorldTiles;
assert.ok(
  Math.abs(sampledOreDensity - 0.08) <= 0.008,
  `ore density must stay near the former 8% field density, got ${(sampledOreDensity * 100).toFixed(2)}%`,
);
assert.ok(
  Math.abs(sampledCaveDensity - 0.258) <= 0.022,
  `cave density must stay near the former 25.8% field density, got ${(sampledCaveDensity * 100).toFixed(2)}%`,
);
assert.ok(checkedDepthGatedOre > 0, "the depth-gate audit must inspect generated T5+ ore cells");

const depthProbe = new MineWorld(ORE_TYPES, "full-depth-probe", { sectorId: "stable_strata" });
const depthSpawn = depthProbe.getSpawn();
const maximumPlayableDepth = (
  WORLD_CONFIG.HEIGHT - WORLD_CONFIG.BEDROCK_ROWS - 1 - depthSpawn.ty
) * WORLD_CONFIG.METERS_PER_TILE;
assert.ok(maximumPlayableDepth >= 800, `all eight 100 m depth-contract stacks need at least 800 m, got ${maximumPlayableDepth}`);

const legacyProfiles = getSectorChoices("unused-menu-seed");
assert.equal(legacyProfiles.length, 3, "legacy profiles remain available only for diagnostics");
assert.equal(GEOLOGICAL_SECTORS.length, 3);

// A normal run no longer selects a sector. Its hidden geology is deterministic
// for a seed and rerolled when the seed changes.
const randomA = new MineWorld(ORE_TYPES, "random-geology-probe");
const randomB = new MineWorld(ORE_TYPES, "random-geology-probe");
const randomProfile = randomA.getGeologyProfile();
assert.match(randomProfile.id, /^random_strata-/);
assert.equal(randomProfile.hidden, true);
assert.equal(randomProfile.modifiers.hardness, 1, "run variance must not change block HP");
assert.equal(randomProfile.modifiers.veins, 1, "run variance must not change individual vein density");
assert.ok(randomProfile.oreBias?.id, "every run may redistribute its ore composition");
assert.equal(tileFingerprint(randomA), tileFingerprint(randomB));
assert.deepEqual(randomA.getMicroEvents(), randomB.getMicroEvents());
assert.deepEqual(randomProfile, randomB.getGeologyProfile());
assert.notEqual(
  randomProfile.id,
  new MineWorld(ORE_TYPES, "another-random-geology-probe").getGeologyProfile().id,
);

function findProfileSeed(predicate) {
  for (let index = 0; index < 10_000; index += 1) {
    const seed = `profile-search-${index}`;
    const profile = createRandomGeologyProfile(seed, ORE_TYPES);
    if (predicate(profile)) return seed;
  }
  throw new Error("could not find deterministic geology fixture");
}

const cavernSeed = findProfileSeed((profile) => profile.trait === "cavernous");
const compactSeed = findProfileSeed((profile) => profile.trait === "compact");
const richSeed = findProfileSeed((profile) => profile.trait === "ore_rich");
const ironSeed = findProfileSeed((profile) => profile.trait === "ore_bias" && profile.oreBias?.id === "iron");
for (const seed of [cavernSeed, compactSeed, ironSeed]) {
  const profile = createRandomGeologyProfile(seed, ORE_TYPES);
  assert.equal(
    profile.modifiers.abundance,
    1,
    `${profile.trait} must redistribute ore without changing the node budget`,
  );
}
const cavernWorld = new MineWorld(ORE_TYPES, cavernSeed);
const compactWorld = new MineWorld(ORE_TYPES, compactSeed);
const richWorld = new MineWorld(ORE_TYPES, richSeed);
const richControl = new MineWorld(ORE_TYPES, richSeed, { sectorId: "stable_strata" });
const ironWorld = new MineWorld(ORE_TYPES, ironSeed);
const ironControl = new MineWorld(ORE_TYPES, ironSeed, { sectorId: "stable_strata" });
for (const [label, world] of [
  ["random profile", randomA],
  ["cavern profile", cavernWorld],
  ["compact profile", compactWorld],
  ["ore-rich profile", richWorld],
  ["iron-biased profile", ironWorld],
]) {
  checkedDepthGatedOre += assertAuthoredVerticalOreDepth(world, label);
}
const cavern = worldMetrics(cavernWorld);
const ridge = worldMetrics(compactWorld);
assert.ok(cavern.undergroundAir > ridge.undergroundAir, "hidden cave-heavy runs must visibly contain more caves");
assert.ok(worldMetrics(richWorld).oreTiles > worldMetrics(richControl).oreTiles, "ore-rich runs must add ore overall");

function oreCounts(world) {
  const counts = {};
  world.forEachOreTileInBounds(0, 0, WORLD_CONFIG.WIDTH - 1, WORLD_CONFIG.HEIGHT - 1, (tile) => {
    counts[tile.oreId] = (counts[tile.oreId] || 0) + 1;
  });
  return counts;
}
const biasedIron = oreCounts(ironWorld).iron || 0;
const neutralIron = oreCounts(ironControl).iron || 0;
assert.ok(biasedIron > neutralIron * 1.35, "an iron-biased run must substantially redistribute veins toward iron");

// Composition bias must preserve expected ore tiles, not merely the number of
// veins: early ores have larger veins than late ores. Check every possible
// preferred ore so a future normalizer cannot silently grow copper-heavy maps
// or shrink deep-ore maps. Actual generated totals get a slightly wider bound
// because each profile may also change cave topology.
let maxExpectedNodeBudgetDrift = 0;
let maxGeneratedNodeBudgetDrift = 0;
for (const preferredOre of ORE_TYPES) {
  const seed = findProfileSeed((profile) => (
    profile.trait === "ore_bias" && profile.oreBias?.id === preferredOre.id
  ));
  const profile = createRandomGeologyProfile(seed, ORE_TYPES);
  assert.equal(profile.modifiers.abundance, 1);

  const biasedWorld = new MineWorld(ORE_TYPES, seed);
  const neutralWorld = new MineWorld(ORE_TYPES, seed, { sectorId: "stable_strata" });
  const neutralNodeBudget = biasedWorld._oreDefinitions.reduce((total, definition) => (
    total + biasedWorld._oreBasePropensity(definition) * biasedWorld._oreExpectedVeinSize(definition)
  ), 0);
  const biasedNodeBudget = biasedWorld._oreDefinitions.reduce((total, definition) => (
    total + biasedWorld._oreVeinCount(definition) * biasedWorld._oreExpectedVeinSize(definition)
  ), 0);
  const expectedDrift = Math.abs(biasedNodeBudget / Math.max(1, neutralNodeBudget) - 1);
  const generatedDrift = Math.abs(
    worldMetrics(biasedWorld).oreTiles / Math.max(1, worldMetrics(neutralWorld).oreTiles) - 1,
  );
  maxExpectedNodeBudgetDrift = Math.max(maxExpectedNodeBudgetDrift, expectedDrift);
  maxGeneratedNodeBudgetDrift = Math.max(maxGeneratedNodeBudgetDrift, generatedDrift);

  assert.ok(
    expectedDrift <= 0.015,
    `${preferredOre.id} bias changed the expected ore-node budget by ${(expectedDrift * 100).toFixed(2)}%`,
  );
  assert.ok(
    generatedDrift <= 0.06,
    `${preferredOre.id} bias changed generated ore nodes by ${(generatedDrift * 100).toFixed(2)}%`,
  );
}

// Explicit diagnostic profiles also keep hardness and individual vein size
// neutral; only cave count and total abundance may vary.
for (const profile of legacyProfiles) {
  assert.equal(profile.modifiers.hardness, 1);
  assert.equal(profile.modifiers.veins, 1);
}

assert.equal(UNDERGROUND_EVENT_TYPES.length, 5);
assert.equal(GLOBAL_EVENT_TYPES.length, 4, "four short buffs must remain scheduled non-spatial events");
assert.deepEqual(
  new Set(GLOBAL_EVENT_TYPES.map((definition) => definition.id)),
  new Set(UNDERGROUND_EVENT_TYPES.filter((definition) => definition.effect !== "chest").map((definition) => definition.id)),
);
const eventWorld = new MineWorld(ORE_TYPES, "micro-event-probe", { sectorId: "ore_ridge" });
const eventTwin = new MineWorld(ORE_TYPES, "micro-event-probe", { sectorId: "ore_ridge" });
const events = eventWorld.getMicroEvents();
assert.equal(events.length, 1, "the ancient container must be the only physical field event");
assert.equal(events[0]?.type, "ancient_container");
assert.deepEqual(events, eventTwin.getMicroEvents(), "physical events must be deterministic");

function assertContainerLoot(world, event) {
  const available = new Set(world.getAvailableOreIdsAt(event.tx, event.ty));
  assert.ok(Object.keys(event.loot || {}).length >= 2, "the chest must carry several depth-scaled ore types");
  for (const [oreId, amount] of Object.entries(event.loot)) {
    const ore = ORE_TYPES.find((candidate) => candidate.id === oreId);
    assert.ok(ore, `${oreId} must be a known resource`);
    assert.ok(
      ore.tier <= 4 || available.has(oreId),
      `${oreId} above T5 must naturally exist at the chest depth`,
    );
    assert.ok(Number.isInteger(amount) && amount >= 1 && amount <= 6);
  }
}

for (let seed = 1; seed <= 12; seed += 1) {
  for (const sector of legacyProfiles) {
    const stressWorld = new MineWorld(ORE_TYPES, `micro-stress-${seed}`, { sectorId: sector.id });
    const stressEvents = stressWorld.getMicroEvents();
    assert.equal(stressEvents.length, 1);
    assert.equal(stressEvents[0].type, "ancient_container");
    assert.ok(stressEvents[0].depthTiles >= 12);
    assertContainerLoot(stressWorld, stressEvents[0]);
  }
  const randomStressWorld = new MineWorld(ORE_TYPES, `random-micro-stress-${seed}`);
  const randomStressEvents = randomStressWorld.getMicroEvents();
  assert.equal(randomStressEvents.length, 1);
  assert.equal(randomStressEvents[0].type, "ancient_container");
  assert.ok(randomStressEvents[0].depthTiles >= 12);
  assertContainerLoot(randomStressWorld, randomStressEvents[0]);
}

const chest = events[0];
assert.ok(chest.depthTiles >= 12, "the physical chest must start after the opening zone");
assert.ok(chest.label.length >= 8);
assert.ok(chest.icon);
assert.match(chest.color, /^#[0-9a-f]{6}$/i);
assert.ok(chest.radius >= WORLD_CONFIG.TILE_SIZE);
assert.ok(chest.radiusTiles >= 1 && chest.radiusTiles <= 2);
assert.ok(chest.description.length >= 40);
assert.equal(chest.noticeLevel, "high");
assert.equal(chest.visual.pulse, "local");
assert.equal(chest.visual.color, chest.color);
assert.ok(chest.announcement.includes(chest.label));
assert.equal(chest.triggered, false);
assert.equal(chest.consumed, false);
assert.equal(chest.state, "ready");
assertContainerLoot(eventWorld, chest);

const forbiddenGlobalFields = [
  "tx", "ty", "x", "y", "depthTiles", "radius", "radiusTiles", "visual", "loot",
  "triggered", "consumed", "state",
];
const scheduledTypes = new Set();
for (let index = 0; index < 64; index += 1) {
  const scheduled = eventWorld.getGlobalMicroEvent(index);
  assert.deepEqual(scheduled, eventTwin.getGlobalMicroEvent(index), "scheduled buffs must be deterministic");
  assert.ok(scheduled);
  assert.ok(GLOBAL_EVENT_TYPES.some((definition) => definition.id === scheduled.type));
  assert.equal(scheduled.durationSeconds, 5);
  assert.equal(scheduled.global, true);
  assert.equal(scheduled.scheduled, true);
  assert.equal(scheduled.index, index);
  assert.equal(scheduled.noticeLevel, "high");
  assert.ok(scheduled.announcement.includes(scheduled.label));
  for (const field of forbiddenGlobalFields) {
    assert.equal(
      Object.hasOwn(scheduled, field),
      false,
      `scheduled ${scheduled.type} must not expose field-only property ${field}`,
    );
  }
  scheduledTypes.add(scheduled.type);
}
assert.deepEqual(scheduledTypes, new Set(GLOBAL_EVENT_TYPES.map((definition) => definition.id)));

const fixedLootRng = { int: (minimum) => minimum };
const eventSpawn = eventWorld.getSpawn();
const earlyLoot = eventWorld._createContainerLoot(eventSpawn.tx, eventSpawn.ty + 12, fixedLootRng);
assert.equal(Object.keys(earlyLoot).length, 5, "opening containers must carry a small T1-T5 starter mix");
assert.ok(Object.keys(earlyLoot).every((oreId) => ORE_TYPES.find((ore) => ore.id === oreId)?.tier <= 4));
const deepLootTy = WORLD_CONFIG.HEIGHT - WORLD_CONFIG.BEDROCK_ROWS - 8;
const deepAvailable = eventWorld.getAvailableOreIdsAt(eventSpawn.tx, deepLootTy);
const deepLoot = eventWorld._createContainerLoot(eventSpawn.tx, deepLootTy, fixedLootRng);
assert.ok(deepAvailable.length > 0);
assert.ok(
  Object.hasOwn(deepLoot, deepAvailable[deepAvailable.length - 1]),
  "a deep chest must include the highest ore that naturally exists there",
);

const tileSearch = eventWorld.getMicroEventsNear(chest.tx, chest.ty, 0);
assert.equal(tileSearch[0]?.id, chest.id, "tile-space proximity search must find the chest at its center");
const pixelSearch = eventWorld.findUndergroundEvent(chest.x, chest.y, 0);
assert.equal(pixelSearch?.id, chest.id, "world-space proximity search must find the chest at its center");
assert.equal(pixelSearch?.distance, 0);

// Returned records are defensive copies.
const copiedEvents = eventWorld.getMicroEvents();
copiedEvents[0].label = "mutated";
copiedEvents[0].visual.color = "#000000";
assert.notEqual(eventWorld.getMicroEvents()[0].label, "mutated");
assert.notEqual(eventWorld.getMicroEvents()[0].visual.color, "#000000");
const copiedChest = copiedEvents[0];
const copiedLootId = Object.keys(copiedChest.loot || {})[0];
if (copiedLootId) copiedChest.loot[copiedLootId] = 999;
assert.notEqual(
  eventWorld.getMicroEvents({ type: "ancient_container" })[0]?.loot?.[copiedLootId],
  999,
  "chest loot must also be returned as a defensive copy",
);

const triggered = eventWorld.triggerMicroEvent(chest.id);
assert.equal(triggered.id, chest.id);
assert.equal(triggered.firstTrigger, true);
assert.equal(triggered.state, "triggered");
assert.equal(eventWorld.triggerMicroEvent(chest.id), null, "trigger must be one-shot");
const consumed = eventWorld.consumeMicroEvent(chest.id);
assert.equal(consumed.id, chest.id);
assert.equal(consumed.wasTriggered, true);
assert.equal(consumed.firstConsume, true);
assert.equal(consumed.state, "consumed");
assert.equal(eventWorld.consumeMicroEvent(chest.id), null, "consume must be one-shot");
assert.ok(!eventWorld.getMicroEvents().some((event) => event.id === chest.id));
assert.ok(eventWorld.getMicroEvents({ includeConsumed: true }).some((event) => event.id === chest.id));

eventWorld.reset("micro-event-probe", { sectorId: "ore_ridge" });
const untouchedChest = eventWorld.getMicroEvents()[0];
const directlyConsumed = eventWorld.consumeMicroEvent(untouchedChest.id);
assert.equal(directlyConsumed.wasTriggered, false, "consume may atomically trigger an untouched event");
assert.equal(eventWorld.triggerMicroEvent(untouchedChest.id), null);

eventWorld.reset("micro-event-probe", { sectorId: "ore_ridge" });
assert.deepEqual(eventWorld.getMicroEvents(), eventTwin.getMicroEvents(), "reset must restore deterministic ready events");

const stagedFingerprint = tileFingerprint(eventWorld);
const stagedEvent = eventWorld.stageMicroEventNearSpawn("ancient_container");
const stagedTwin = eventTwin.stageMicroEventNearSpawn("ancient_container");
const stagedSpawn = eventWorld.getSpawn();
assert.ok(stagedEvent, "a dry-shift pity event must be stageable near the landing chamber");
assert.deepEqual(stagedEvent, stagedTwin, "staged pity events must stay deterministic");
assert.ok(
  Math.hypot(stagedEvent.tx - stagedSpawn.tx, stagedEvent.ty - stagedSpawn.ty) <= 6,
  "a staged event must fit inside early sense range",
);
assert.ok(
  !["air", "bedrock"].includes(eventWorld.getTile(stagedEvent.tx, stagedEvent.ty)?.kind),
  "a staged event must remain a physical underground target",
);
assert.equal(stagedEvent.type, "ancient_container");
assertContainerLoot(eventWorld, stagedEvent);
assert.equal(eventWorld.getMicroEvents().length, 1);
assert.equal(tileFingerprint(eventWorld), stagedFingerprint, "staging an event must not change rock or ore density");

let checkedStagedEvents = 0;
for (let seed = 0; seed < 12; seed += 1) {
  const surfaceWorld = new MineWorld(ORE_TYPES, `surface-pity-${seed}-ancient-container`);
  const surfaceStaged = surfaceWorld.stageMicroEventNearSpawn("ancient_container", surfaceWorld.getSpawn());
  assert.ok(surfaceStaged, `surface pity must stage the chest for seed ${seed}`);

  const liftWorld = new MineWorld(ORE_TYPES, `lift-pity-${seed}-ancient-container`);
  const lift = liftWorld.getLiftStart(180, 0.65, 180, { unlockedTierCap: 9 });
  assert.ok(lift, `lift fixture must exist for chest seed ${seed}`);
  const liftStaged = liftWorld.stageMicroEventNearSpawn("ancient_container", lift);
  assert.ok(liftStaged, `lift pity must stage the chest for seed ${seed}`);
  assert.ok(
    Math.hypot(liftStaged.tx - lift.tx, liftStaged.ty - lift.ty) <= 8
      || (lift.target && liftStaged.tx === lift.target.tx && liftStaged.ty === lift.target.ty),
    "lift pity must stay near the current landing or its guaranteed target",
  );
  checkedStagedEvents += 2;
}

// Every sector and seed starts with the same short, mineable economy seam:
// copper is visible immediately, coal follows behind it, and another copper
// tile rewards continuing down the newly opened shaft.
let checkedStarterSeams = 0;
for (let seed = 1; seed <= 8; seed += 1) {
  for (const sector of GEOLOGICAL_SECTORS) {
    const starterWorld = new MineWorld(ORE_TYPES, `starter-seam-${seed}`, { sectorId: sector.id });
    const starterSpawn = starterWorld.getSpawn();
    const firstCopper = starterWorld.getTile(starterSpawn.tx, starterSpawn.ty + 2);
    const coal = starterWorld.getTile(starterSpawn.tx, starterSpawn.ty + 3);
    const secondCopper = starterWorld.getTile(starterSpawn.tx, starterSpawn.ty + 4);

    assert.equal(firstCopper?.oreId, "copper", `${sector.id} must expose starter copper`);
    assert.equal(firstCopper?.maxHp, 2, "first copper must fit inside the opening shift");
    assert.equal(coal?.oreId, "coal", `${sector.id} must guarantee early coal`);
    assert.equal(coal?.maxHp, 4, "starter coal must fit the opening shift without becoming free");
    assert.equal(secondCopper?.oreId, "copper", `${sector.id} must finish the starter seam with copper`);
    assert.equal(secondCopper?.maxHp, 3, "second copper must stay soft");
    assert.ok(firstCopper.discovered && coal.discovered && secondCopper.discovered);

    const starterRoute = starterWorld.findLeastResistanceStep(
      starterSpawn,
      { tx: starterSpawn.tx, ty: starterSpawn.ty + 4 },
      { moveSpeed: 100, digPowerPerSecond: 2.25, maxDetourTiles: 8 },
    );
    assert.ok(starterRoute?.route.length >= 3, "the complete starter seam must be reachable");
    checkedStarterSeams += 1;
  }
}

// The three additional guaranteed copper probes must lead into the shaft,
// never recreate the former shallow left/right farming strip. Record the
// requested locations without depending on incidental caves in one seed.
const starterFanWorld = new MineWorld(ORE_TYPES, "starter-descending-fan", { sectorId: "stable_strata" });
const starterFanSpawn = starterFanWorld.getSpawn();
const starterFanRequests = [];
const originalNearestSolidTile = starterFanWorld._nearestSolidTile;
starterFanWorld._nearestSolidTile = (tx, ty, radius) => {
  starterFanRequests.push({
    dx: tx - starterFanSpawn.tx,
    dy: ty - starterFanSpawn.ty,
    radius,
  });
  return null;
};
starterFanWorld._placeStarterOre();
starterFanWorld._nearestSolidTile = originalNearestSolidTile;
assert.deepEqual(starterFanRequests, [
  { dx: -2, dy: 4, radius: 2 },
  { dx: 2, dy: 5, radius: 2 },
  { dx: 0, dy: 7, radius: 2 },
]);
assert.ok(starterFanRequests.every((request) => request.dy >= 4 && Math.abs(request.dx) <= 2));

// A direct diagonal must not squeeze through the seam between two intact
// blocks. The public route finder must instead choose one of the orthogonal
// blocks and enter the goal from a cardinal direction.
const cornerWorld = new MineWorld(ORE_TYPES, "corner-cut-probe");
const cornerStart = { tx: Math.floor(WORLD_CONFIG.WIDTH / 2), ty: 40 };
const cornerGoal = { tx: cornerStart.tx + 1, ty: cornerStart.ty + 1 };
for (let offsetY = -2; offsetY <= 3; offsetY += 1) {
  for (let offsetX = -2; offsetX <= 3; offsetX += 1) {
    const tile = cornerWorld.getTile(cornerStart.tx + offsetX, cornerStart.ty + offsetY);
    tile.kind = "bedrock";
    tile.hp = 1_000_000_000;
    tile.maxHp = 1_000_000_000;
    tile.oreId = null;
    tile.veinId = null;
  }
}
for (const point of [cornerStart, cornerGoal]) {
  const tile = cornerWorld.getTile(point.tx, point.ty);
  tile.kind = "air";
  tile.hp = 0;
  tile.maxHp = 0;
}
for (const point of [
  { tx: cornerGoal.tx, ty: cornerStart.ty },
  { tx: cornerStart.tx, ty: cornerGoal.ty },
]) {
  const tile = cornerWorld.getTile(point.tx, point.ty);
  tile.kind = "stone";
  tile.hp = 2;
  tile.maxHp = 2;
}

const cornerRoute = cornerWorld.findLeastResistanceStep(cornerStart, cornerGoal, {
  moveSpeed: 100,
  digPowerPerSecond: 10,
  maxDetourTiles: 2,
  minimumSavings: 0,
});
assert.ok(cornerRoute, "an orthogonal two-step route must remain available");
assert.equal(
  cornerWorld._routeStepCost(cornerStart, cornerGoal, {
    moveSpeed: 100,
    digPowerPerSecond: 10,
    hardnessMultiplier: 1,
    focusedOreId: null,
    focusedOreDigMultiplier: 1,
  }),
  Infinity,
  "the blocked one-step diagonal must be rejected",
);
assert.equal(cornerRoute.route.length, 3);
assert.ok(
  cornerRoute.route.slice(1).every((point, index) => {
    const previous = cornerRoute.route[index];
    return point.tx === previous.tx || point.ty === previous.ty;
  }),
  "the replacement route must contain cardinal steps only",
);

// Existing live-ore index and route search remain usable with a selected sector.
let firstOre = null;
let indexedOre = 0;
eventWorld.forEachOreTileInBounds(
  0,
  0,
  WORLD_CONFIG.WIDTH - 1,
  WORLD_CONFIG.HEIGHT - 1,
  (tile, tx, ty) => {
    indexedOre += 1;
    if (!firstOre) firstOre = { tile, tx, ty };
  },
);
assert.ok(indexedOre > 0 && firstOre);
const spawn = eventWorld.getSpawn();
const hpBeforeRoute = eventWorld.getTile(firstOre.tx, firstOre.ty).hp;
const route = eventWorld.findLeastResistanceStep(spawn, firstOre, {
  moveSpeed: 100,
  digPowerPerSecond: 10,
  maxDetourTiles: 8,
});
assert.ok(route?.route.length >= 1);
assert.equal(eventWorld.getTile(firstOre.tx, firstOre.ty).hp, hpBeforeRoute, "routing stays read-only");

// damageRay deliberately applies its full damage to every tile covered by the
// supplied width. Falloff bands therefore belong to the caller: the laser must
// pass only its permanent core width and resolve thermal edges separately.
const rayContractWorld = new MineWorld(ORE_TYPES, "ray-width-contract");
const rayOriginTx = Math.floor(WORLD_CONFIG.WIDTH / 2);
const rayOriginTy = 40;
const rayCore = rayContractWorld.getTile(rayOriginTx + 2, rayOriginTy);
const rayEdge = rayContractWorld.getTile(rayOriginTx + 2, rayOriginTy + 1);
for (const tile of [rayCore, rayEdge]) {
  Object.assign(tile, {
    kind: "stone",
    oreId: null,
    veinId: null,
    hp: 100,
    maxHp: 100,
    discovered: true,
    cracked: 0,
  });
}
const rayOriginX = (rayOriginTx + 0.5) * WORLD_CONFIG.TILE_SIZE;
const rayOriginY = (rayOriginTy + 0.5) * WORLD_CONFIG.TILE_SIZE;
rayContractWorld.damageRay(rayOriginX, rayOriginY, 1, 0, WORLD_CONFIG.TILE_SIZE * 4, 10, 8);
assert.equal(rayCore.hp, 90, "the eight-pixel core must damage its center row");
assert.equal(rayEdge.hp, 100, "the eight-pixel core must not reach the neighboring row");
rayContractWorld.damageRay(rayOriginX, rayOriginY, 1, 0, WORLD_CONFIG.TILE_SIZE * 4, 10, 23);
assert.equal(rayCore.hp, 80);
assert.equal(rayEdge.hp, 90, "damageRay has no implicit edge falloff at wider widths");

console.log(JSON.stringify({
  ok: true,
  diagnosticProfiles: legacyProfiles.length,
  physicalEventTypes: events.length,
  globalEventTypes: scheduledTypes.size,
  checkedStarterSeams,
  checkedStagedEvents,
  checkedDepthGatedOre,
  sampledOreDensity: Number(sampledOreDensity.toFixed(4)),
  sampledCaveDensity: Number(sampledCaveDensity.toFixed(4)),
  maxExpectedNodeBudgetDrift: Number(maxExpectedNodeBudgetDrift.toFixed(4)),
  maxGeneratedNodeBudgetDrift: Number(maxGeneratedNodeBudgetDrift.toFixed(4)),
  cavernAir: cavern.undergroundAir,
  ridgeAir: ridge.undergroundAir,
  cavernOre: cavern.oreTiles,
  ridgeOre: ridge.oreTiles,
}));
