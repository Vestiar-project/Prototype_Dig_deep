"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");

global.window = global;
const root = path.resolve(__dirname, "..");
require(path.join(root, "js", "upgrades.js"));
require(path.join(root, "js", "world.js"));

const { ORE_TYPES, UPGRADE_DEFS, calculateMetaStats } = global.DepthZeroUpgrades;
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

assert.equal(WORLD_CONFIG.WIDTH, 88, "the mine must keep depth dominant with an 88-tile field");
assert.equal(WORLD_CONFIG.HEIGHT, 180, "the mine must trade lateral sprawl for meaningful depth");
assert.equal(WORLD_CONFIG.METERS_PER_TILE, 5, "one terrain row must represent five metres");
assert.equal(WORLD_CONFIG.SPAWN_TX, WORLD_CONFIG.WIDTH / 2, "the surface landing must be centered");
assert.equal(WORLD_CONFIG.CAVE_COUNT, 32, "cave count must preserve cave density after the final width reduction");

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
const pressureDepths = [120, 135, 150, 160, 165];
const pressureTerrainHp = pressureDepths.map(terrainHpAtDepth);
const deepTerrainHp = pressureTerrainHp[2];
const bottomTerrainHp = pressureTerrainHp.at(-1);
assert.ok(shallowTerrainHp > 0 && deepTerrainHp > 0, "both shallow and deep strata must contain mineable terrain");
assert.ok(
  deepTerrainHp >= shallowTerrainHp * 3,
  `deep rock must justify late tools (${shallowTerrainHp} HP near 100 m, ${deepTerrainHp} HP near 750 m)`,
);
for (let index = 1; index < pressureTerrainHp.length; index += 1) {
  assert.ok(
    pressureTerrainHp[index] >= pressureTerrainHp[index - 1],
    `planetary pressure must rise monotonically after 600 m: ${pressureTerrainHp.join(" â†’ ")} HP`,
  );
}
assert.ok(
  bottomTerrainHp >= 220 && bottomTerrainHp <= 280,
  `bottom terrain should sit in the 220â€“280 HP pressure band, got ${bottomTerrainHp}`,
);
const baseStats = calculateMetaStats({});
const fullLevels = Object.fromEntries(UPGRADE_DEFS.map((definition) => [definition.id, definition.maxLevel]));
const fullStats = calculateMetaStats(fullLevels);
const baseBottomSeconds = bottomTerrainHp / Math.max(0.01, baseStats.pickPower * baseStats.digSpeed);
const startingShiftDamageShare = baseStats.runDuration / baseBottomSeconds;
const fullLaserBottomSeconds = bottomTerrainHp / Math.max(
  0.01,
  fullStats.pickPower * fullStats.digSpeed * fullStats.laserPower,
);
assert.ok(
  baseBottomSeconds > baseStats.runDuration * 10,
  `a fresh pick must be effectively unable to mine bottom rock (${baseBottomSeconds.toFixed(1)} s)`,
);
assert.ok(
  startingShiftDamageShare <= 0.06,
  `one fresh six-second shift may remove at most 6% of bottom rock (${(startingShiftDamageShare * 100).toFixed(1)}%)`,
);
assert.ok(
  fullLaserBottomSeconds < 0.5,
  `a completed laser build must visibly shred bottom rock (${fullLaserBottomSeconds.toFixed(2)} s)`,
);

const DAMAGE_STAGE_LEVELS = {
  fresh: {},
  iron: {
    core_first_descent: 1, tools_balanced_handle: 1,
    power_sharpened_edge: 1, tools_iron_pick: 1,
  },
  steel: {
    core_first_descent: 1, tools_balanced_handle: 3,
    power_sharpened_edge: 3, power_tempered_steel: 2,
    tools_iron_pick: 1, tools_steel_pick: 1,
  },
  pneumatic: {
    core_first_descent: 1, tools_balanced_handle: 4,
    power_sharpened_edge: 5, power_tempered_steel: 3,
    power_diamond_tip: 1, tools_iron_pick: 1,
    tools_steel_pick: 1, tools_pneumatic_pick: 1,
  },
  superPick: {
    core_first_descent: 1, tools_balanced_handle: 4,
    power_sharpened_edge: 6, power_tempered_steel: 3,
    power_diamond_tip: 2, power_adamant_grip: 2,
    power_sample_calibration: 1, tools_iron_pick: 1,
    tools_steel_pick: 1, tools_pneumatic_pick: 1,
    tools_super_pick: 1, tools_super_motor: 2,
    tools_super_teeth: 2, tools_super_field: 1,
  },
  firstLaser: {
    core_first_descent: 1, tools_balanced_handle: 4,
    power_sharpened_edge: 6, power_tempered_steel: 3,
    power_diamond_tip: 3, power_adamant_grip: 3,
    power_sample_calibration: 2, tools_iron_pick: 1,
    tools_steel_pick: 1, tools_pneumatic_pick: 1,
    tools_super_pick: 1, tools_super_motor: 4,
    tools_super_teeth: 4, tools_super_field: 4,
    tools_laser_emitter: 1,
  },
};
const deterministicTerrainDps = (levels) => {
  const stageStats = calculateMetaStats(levels);
  if (stageStats.laserUnlocked) {
    return stageStats.pickPower * stageStats.digSpeed * stageStats.laserChargeRate
      * stageStats.laserPower * (1 + stageStats.laserPierce * 0.08);
  }
  const multi = 1
    + Math.max(0, stageStats.multiHitCount - 1) * 0.65
    + stageStats.multiHitChance * 0.65;
  return stageStats.pickPower * stageStats.digSpeed * multi;
};
const damageStageTtk = Object.fromEntries(Object.entries(DAMAGE_STAGE_LEVELS).map(([id, levels]) => [
  id,
  bottomTerrainHp / Math.max(0.01, deterministicTerrainDps(levels)),
]));
assert.ok(damageStageTtk.fresh > 90, `fresh bottom TTK must stay prohibitive: ${damageStageTtk.fresh}`);
assert.ok(damageStageTtk.iron >= 35 && damageStageTtk.iron <= 50, `iron bottom TTK drifted: ${damageStageTtk.iron}`);
assert.ok(damageStageTtk.steel >= 12 && damageStageTtk.steel <= 20, `steel bottom TTK drifted: ${damageStageTtk.steel}`);
assert.ok(damageStageTtk.pneumatic >= 4 && damageStageTtk.pneumatic <= 8, `pneumatic bottom TTK drifted: ${damageStageTtk.pneumatic}`);
assert.ok(damageStageTtk.superPick >= 0.8 && damageStageTtk.superPick <= 2.2, `super-pick bottom TTK drifted: ${damageStageTtk.superPick}`);
assert.ok(damageStageTtk.firstLaser < 1.2, `the first laser must already shred bottom terrain: ${damageStageTtk.firstLaser}`);
const orderedDamageTtk = ['fresh', 'iron', 'steel', 'pneumatic', 'superPick', 'firstLaser']
  .map((id) => damageStageTtk[id]);
for (let index = 1; index < orderedDamageTtk.length; index += 1) {
  assert.ok(
    orderedDamageTtk[index] < orderedDamageTtk[index - 1],
    `every tool stage must visibly reduce bottom TTK: ${orderedDamageTtk.map((value) => value.toFixed(2)).join(' -> ')}`,
  );
}
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

function oreVeins(world, oreId) {
  const veins = new Map();
  for (let ty = 0; ty < WORLD_CONFIG.HEIGHT - WORLD_CONFIG.BEDROCK_ROWS; ty += 1) {
    for (let tx = 0; tx < WORLD_CONFIG.WIDTH; tx += 1) {
      const tile = world.getTile(tx, ty);
      if (tile?.oreId !== oreId) continue;
      if (!veins.has(tile.veinId)) veins.set(tile.veinId, []);
      veins.get(tile.veinId).push({ tx, ty, tile });
    }
  }
  return veins;
}

// Amber and gold each spend one normal generated vein on a central frontier
// reserve. This removes long no-resource streaks without adding veins, nodes,
// larger seams or softer ore to the narrowed field.
for (let index = 0; index < 24; index += 1) {
  const world = new MineWorld(ORE_TYPES, `frontier-reserve-${index}`, { sectorId: "stable_strata" });
  const authoredVeinBudget = world._oreDefinitions.reduce(
    (total, definition) => total + world._oreVeinCount(definition),
    0,
  );
  assert.equal(
    world._nextVeinId - 1,
    authoredVeinBudget,
    `frontier seed ${index}: reserves must consume, not enlarge, the authored vein budget`,
  );

  for (const oreId of ["amber", "gold"]) {
    const ore = oreById.get(oreId);
    const definition = world._oreDefinitions.find((candidate) => candidate.id === oreId);
    const veins = oreVeins(world, oreId);
    const frontierVein = [...veins.values()].find((cells) => cells.some(({ tx, ty }) => {
      const localDepth = (ty - (world.surface[tx] ?? WORLD_CONFIG.SURFACE_BASE)) * WORLD_CONFIG.TILE_SIZE;
      return Math.abs(tx - WORLD_CONFIG.SPAWN_TX) <= 10
        && localDepth >= ore.depth
        && localDepth <= ore.depth + 12 * WORLD_CONFIG.TILE_SIZE;
    }));
    assert.ok(frontierVein, `frontier seed ${index}: ${oreId} needs one reachable reserve vein`);
    assert.ok(
      frontierVein.length <= world._oreVeinSizeRange(definition).max,
      `frontier seed ${index}: ${oreId} reserve must keep the normal maximum vein size`,
    );
    for (const { tile } of frontierVein) {
      assert.equal(
        tile.maxHp,
        Math.round(tile.terrainMaxHp * ore.hardness),
        `frontier seed ${index}: ${oreId} reserve must retain ordinary ore durability`,
      );
    }
  }
}

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

// The 88x180 field is deliberately smaller than the old wide map. Authored
// vein budgets and cave count scale with its area, so the silhouette narrows
// without increasing ore density or enlarging individual veins.
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
assert.equal(legacyProfiles.lßMû¶‰žËkºwµçU‰Õ™™ÌµÕÍÐ‰”‘•Ñ•Éµ¥¹¥ÍÑ¥Œˆ¤ì(€…ÍÍ•ÉÐ¹½¬¡Í¡•‘Õ±•¤ì(€…ÍÍ•ÉÐ¹½¬¡1=	1}Y9Q}QeAL¹Í½µ” ¡‘•™¥¹¥Ñ¥½¸¤€ôø‘•™¥¹¥Ñ¥½¸¹¥€ôôôÍ¡•‘Õ±•¹ÑåÁ”¤¤ì(€…ÍÍ•ÉÐ¹•ÅÕ…°¡Í¡•‘Õ±•¹‘ÕÉ…Ñ¥½¹M•½¹‘Ì°€Ô¤ì(€…ÍÍ•ÉÐ¹•ÅÕ…°¡Í¡•‘Õ±•¹±½‰…°°ÑÉÕ”¤ì(€…ÍÍ•ÉÐ¹•ÅÕ…°¡Í¡•‘Õ±•¹Í¡•‘Õ±•°ÑÉÕ”¤ì(€…ÍÍ•ÉÐ¹•ÅÕ…°¡Í¡•‘Õ±•¹¥¹‘•à°¥¹‘•à¤ì(€…ÍÍ•ÉÐ¹•ÅÕ…°¡Í¡•‘Õ±•¹¹½Ñ¥•1•Ù•°°€‰¡¥ ˆ¤ì(€…ÍÍ•ÉÐ¹½¬¡Í¡•‘Õ±•¹…¹¹½Õ¹•µ•¹Ð¹¥¹±Õ‘•Ì¡Í¡•‘Õ±•¹±…‰•°¤¤ì(€™½È€¡½¹ÍÐ™¥•±½˜™½É‰¥‘‘•¹±½‰…±¥•±‘Ì¤ì(€€€…ÍÍ•ÉÐ¹•ÅÕ…° (€€€€€=‰©•Ð¹¡…Í=Ý¸¡Í¡•‘Õ±•°™¥•±¤°(€€€€€™…±Í”°(€€€€€Í¡•‘Õ±•€‘íÍ¡•‘Õ±•¹ÑåÁ•ôµÕÍÐ¹½Ð•áÁ½Í”™¥•±µ½¹±äÁÉ½Á•ÉÑä€‘í™¥•±‘õ€°(€€€€¤ì(€ô(€Í¡•‘Õ±•‘QåÁ•Ì¹…‘¡Í¡•‘Õ±•¹ÑåÁ”¤ì)ô)…ÍÍ•ÉÐ¹‘••ÁÅÕ…°¡Í¡•‘Õ±•‘QåÁ•Ì°¹•ÜM•Ð¡1=	1}Y9Q}QeAL¹µ…À ¡‘•™¥¹¥Ñ¥½¸¤€ôø‘•™¥¹¥Ñ¥½¸¹¥¤¤¤ì()½¹ÍÐ™¥á•‘1½½ÑI¹œ€ôì¥¹Ðè€¡µ¥¹¥µÕ´¤€ôøµ¥¹¥µÕ´ôì)½¹ÍÐ•Ù•¹ÑMÁ…Ý¸€ô•Ù•¹Ñ]½É±¹•ÑMÁ…Ý¸ ¤ì)½¹ÍÐ•…É±å1½½Ð€ô•Ù•¹Ñ]½É±¹}É•…Ñ•½¹Ñ…¥¹•É1½½Ð¡•Ù•¹ÑMÁ…Ý¸¹Ñà°•Ù•¹ÑMÁ…Ý¸¹Ñä€¬€ÄÈ°™¥á•‘1½½ÑI¹œ¤ì)…ÍÍ•ÉÐ¹•ÅÕ…°¡=‰©•Ð¹­•åÌ¡•…É±å1½½Ð¤¹±•¹Ñ °€Ô°€‰½Á•¹¥¹œ½¹Ñ…¥¹•ÉÌµÕÍÐ…ÉÉä„Íµ…±°PÄµPÔÍÑ…ÉÑ•Èµ¥àˆ¤ì)…ÍÍ•ÉÐ¹½¬¡=‰©•Ð¹­•åÌ¡•…É±å1½½Ð¤¹•Ù•Éä ¡½É•%¤€ôø=I}QeAL¹™¥¹ ¡½É”¤€ôø½É”¹¥€ôôô½É•%¤ü¹Ñ¥•È€ðô€Ð¤¤ì)½¹ÍÐ‘••Á1½½ÑQä€ô]=I1}=9%¹!%!P€´]=I1}=9%¹	I=-}I=]L€´€àì)½¹ÍÐ‘••ÁÙ…¥±…‰±”€ô•Ù•¹Ñ]½É±¹•ÑÙ…¥±…‰±•=É•%‘ÍÐ¡•Ù•¹ÑMÁ…Ý¸¹Ñà°‘••Á1½½ÑQä¤ì)½¹ÍÐ‘••Á1½½Ð€ô•Ù•¹Ñ]½É±¹}É•…Ñ•½¹Ñ…¥¹•É1½½Ð¡•Ù•¹ÑMÁ…Ý¸¹Ñà°‘••Á1½½ÑQä°™¥á•‘1½½ÑI¹œ¤ì)…ÍÍ•ÉÐ¹½¬¡‘••ÁÙ…¥±…‰±”¹±•¹Ñ €ø€À¤ì)…ÍÍ•ÉÐ¹½¬ (€=‰©•Ð¹¡…Í=Ý¸¡‘••Á1½½Ð°‘••ÁÙ…¥±…‰±•m‘••ÁÙ…¥±…‰±”¹±•¹Ñ €´€Åt¤°(€€‰„‘••À¡•ÍÐµÕÍÐ¥¹±Õ‘”Ñ¡”¡¥¡•ÍÐ½É”Ñ¡…Ð¹…ÑÕÉ…±±ä•á¥ÍÑÌÑ¡•É”ˆ°(¤ì()½¹ÍÐÑ¥±•M•…É €ô•Ù•¹Ñ]½É±¹•Ñ5¥É½Ù•¹ÑÍ9•…È¡¡•ÍÐ¹Ñà°¡•ÍÐ¹Ñä°€À¤ì)…ÍÍ•ÉÐ¹•ÅÕ…°¡Ñ¥±•M•…É¡lÁtü¹¥°¡•ÍÐ¹¥°€‰Ñ¥±”µÍÁ…”ÁÉ½á¥µ¥ÑäÍ•…É µÕÍÐ™¥¹Ñ¡”¡•ÍÐ…Ð¥ÑÌ•¹Ñ•Èˆ¤ì)½¹ÍÐÁ¥á•±M•…É €ô•Ù•¹Ñ]½É±¹™¥¹‘U¹‘•ÉÉ½Õ¹‘Ù•¹Ð¡¡•ÍÐ¹à°¡•ÍÐ¹ä°€À¤ì)…ÍÍ•ÉÐ¹•ÅÕ…°¡Á¥á•±M•…É ü¹¥°¡•ÍÐ¹¥°€‰Ý½É±µÍÁ…”ÁÉ½á¥µ¥ÑäÍ•…É µÕÍÐ™¥¹Ñ¡”¡•ÍÐ…Ð¥ÑÌ•¹Ñ•Èˆ¤ì)…ÍÍ•ÉÐ¹•ÅÕ…°¡Á¥á•±M•…É ü¹‘¥ÍÑ…¹”°€À¤ì((¼¼I•ÑÕÉ¹•É•½É‘Ì…É”‘•™•¹Í¥Ù”½Á¥•Ì¸)½¹ÍÐ½Á¥•‘Ù•¹ÑÌ€ô•Ù•¹Ñ]½É±¹•Ñ5¥É½Ù•¹ÑÌ ¤ì)½Á¥•‘Ù•¹ÑÍlÁt¹±…‰•°€ô€‰µÕÑ…Ñ•ˆì)½Á¥•‘Ù•¹ÑÍlÁt¹Ù¥ÍÕ…°¹½±½È€ô€ˆŒÀÀÀÀÀÀˆì)…ÍÍ•ÉÐ¹¹½ÑÅÕ…°¡•Ù•¹Ñ]½É±¹•Ñ5¥É½Ù•¹ÑÌ ¥lÁt¹±…‰•°°€‰µÕÑ…Ñ•ˆ¤ì)…ÍÍ•ÉÐ¹¹½ÑÅÕ…°¡•Ù•¹Ñ]½É±¹•Ñ5¥É½Ù•¹ÑÌ ¥lÁt¹Ù¥ÍÕ…°¹½±½È°€ˆŒÀÀÀÀÀÀˆ¤ì)½¹ÍÐ½Á¥•‘¡•ÍÐ€ô½Á¥•‘Ù•¹ÑÍlÁtì)½¹ÍÐ½Á¥•‘1½½Ñ%€ô=‰©•Ð¹­•åÌ¡½Á¥•‘¡•ÍÐ¹±½½Ðñðíô¥lÁtì)¥˜€¡½Á¥•‘1½½Ñ%¤½Á¥•‘¡•ÍÐ¹±½½Ñm½Á¥•‘1½½Ñ%‘t€ô€äääì)…ÍÍ•ÉÐ¹¹½ÑÅÕ…° (€•Ù•¹Ñ]½É±¹•Ñ5¥É½Ù•¹ÑÌ¡ìÑåÁ”è€‰…¹¥•¹Ñ}½¹Ñ…¥¹•Èˆô¥lÁtü¹±½½Ðü¹m½Á¥•‘1½½Ñ%‘t°(€€äää°(€€‰¡•ÍÐ±½½ÐµÕÍÐ…±Í¼‰”É•ÑÕÉ¹•…Ì„‘•™•¹Í¥Ù”½Áäˆ°(¤ì()½¹ÍÐÑÉ¥•É•€ô•Ù•¹Ñ]½É±¹ÑÉ¥•É5¥É½Ù•¹Ð¡¡•ÍÐ¹¥¤ì)…ÍÍ•ÉÐ¹•ÅÕ…°¡ÑÉ¥•É•¹¥°¡•ÍÐ¹¥¤ì)…ÍÍ•ÉÐ¹•ÅÕ…°¡ÑÉ¥•É•¹™¥ÉÍÑQÉ¥•È°ÑÉÕ”¤ì)…ÍÍ•ÉÐ¹•ÅÕ…°¡ÑÉ¥•É•¹ÍÑ…Ñ”°€‰ÑÉ¥•É•ˆ¤ì)…ÍÍ•ÉÐ¹•ÅÕ…°¡•Ù•¹Ñ]½É±¹ÑÉ¥•É5¥É½Ù•¹Ð¡¡•ÍÐ¹¥¤°¹Õ±°°€‰ÑÉ¥•ÈµÕÍÐ‰”½¹”µÍ¡½Ðˆ¤ì)½¹ÍÐ½¹ÍÕµ•€ô•Ù•¹Ñ]½É±¹½¹ÍÕµ•5¥É½Ù•¹Ð¡¡•ÍÐ¹¥¤ì)…ÍÍ•ÉÐ¹•ÅÕ…°¡½¹ÍÕµ•¹¥°¡•ÍÐ¹¥¤ì)…ÍÍ•ÉÐ¹•ÅÕ…°¡½¹ÍÕµ•¹Ý…ÍQÉ¥•É•°ÑÉÕ”¤ì)…ÍÍ•ÉÐ¹•ÅÕ…°¡½¹ÍÕµ•¹™¥ÉÍÑ½¹ÍÕµ”°ÑÉÕ”¤ì)…ÍÍ•ÉÐ¹•ÅÕ…°¡½¹ÍÕµ•¹ÍÑ…Ñ”°€‰½¹ÍÕµ•ˆ¤ì)…ÍÍ•ÉÐ¹•ÅÕ…°¡•Ù•¹Ñ]½É±¹½¹ÍÕµ•5¥É½Ù•¹Ð¡¡•ÍÐ¹¥¤°¹Õ±°°€‰½¹ÍÕµ”µÕÍÐ‰”½¹”µÍ¡½Ðˆ¤ì)…ÍÍ•ÉÐ¹½¬ …•Ù•¹Ñ]½É±¹•Ñ5¥É½Ù•¹ÑÌ ¤¹Í½µ” ¡•Ù•¹Ð¤€ôø•Ù•¹Ð¹¥€ôôô¡•ÍÐ¹¥¤¤ì)…ÍÍ•ÉÐ¹½¬¡•Ù•¹Ñ]½É±¹•Ñ5¥É½Ù•¹ÑÌ¡ì¥¹±Õ‘•½¹ÍÕµ•èÑÉÕ”ô¤¹Í½µ” ¡•Ù•¹Ð¤€ôø•Ù•¹Ð¹¥€ôôô¡•ÍÐ¹¥¤¤ì()•Ù•¹Ñ]½É±¹É•Í•Ð ‰µ¥É¼µ•Ù•¹ÐµÁÉ½‰”ˆ°ìÍ•Ñ½É%è€‰½É•}É¥‘”ˆô¤ì)½¹ÍÐÕ¹Ñ½Õ¡•‘¡•ÍÐ€ô•Ù•¹Ñ]½É±¹•Ñ5¥É½Ù•¹ÑÌ ¥lÁtì)½¹ÍÐ‘¥É•Ñ±å½¹ÍÕµ•€ô•Ù•¹Ñ]½É±¹½¹ÍÕµ•5¥É½Ù•¹Ð¡Õ¹Ñ½Õ¡•‘¡•ÍÐ¹¥¤ì)…ÍÍ•ÉÐ¹•ÅÕ…°¡‘¥É•Ñ±å½¹ÍÕµ•¹Ý…ÍQÉ¥•É•°™…±Í”°€‰½¹ÍÕµ”µ…ä…Ñ½µ¥…±±äÑÉ¥•È…¸Õ¹Ñ½Õ¡••Ù•¹Ðˆ¤ì)…ÍÍ•ÉÐ¹•ÅÕ…°¡•Ù•¹Ñ]½É±¹ÑÉ¥•É5¥É½Ù•¹Ð¡Õ¹Ñ½Õ¡•‘¡•ÍÐ¹¥¤°¹Õ±°¤ì()•Ù•¹Ñ]½É±¹É•Í•Ð ‰µ¥É¼µ•Ù•¹ÐµÁÉ½‰”ˆ°ìÍ•Ñ½É%è€‰½É•}É¥‘”ˆô¤ì)…ÍÍ•ÉÐ¹‘••ÁÅÕ…°¡•Ù•¹Ñ]½É±¹•Ñ5¥É½Ù•¹ÑÌ ¤°•Ù•¹ÑQÝ¥¸¹•Ñ5¥É½Ù•¹ÑÌ ¤°€‰É•Í•ÐµÕÍÐÉ•ÍÑ½É”‘•Ñ•Éµ¥¹¥ÍÑ¥ŒÉ•…‘ä•Ù•¹ÑÌˆ¤ì()½¹ÍÐÍÑ…•‘¥¹•ÉÁÉ¥¹Ð€ôÑ¥±•¥¹•ÉÁÉ¥¹Ð¡•Ù•¹Ñ]½É±¤ì)½¹ÍÐÍÑ…•‘Ù•¹Ð€ô•Ù•¹Ñ]½É±¹ÍÑ…•5¥É½Ù•¹Ñ9•…ÉMÁ…Ý¸ ‰…¹¥•¹Ñ}½¹Ñ…¥¹•Èˆ¤ì)½¹ÍÐÍÑ…•‘QÝ¥¸€ô•Ù•¹ÑQÝ¥¸¹ÍÑ…•5¥É½Ù•¹Ñ9•…ÉMÁ…Ý¸ ‰…¹¥•¹Ñ}½¹Ñ…¥¹•Èˆ¤ì)½¹ÍÐÍÑ…•‘MÁ…Ý¸€ô•Ù•¹Ñ]½É±¹•ÑMÁ…Ý¸ ¤ì)…ÍÍ•ÉÐ¹½¬¡ÍÑ…•‘Ù•¹Ð°€‰„‘ÉäµÍ¡¥™ÐÁ¥Ñä•Ù•¹ÐµÕÍÐ‰”ÍÑ…•…‰±”¹•…ÈÑ¡”±…¹‘¥¹œ¡…µ‰•Èˆ¤ì)…ÍÍ•ÉÐ¹‘••ÁÅÕ…°¡ÍÑ…•‘Ù•¹Ð°ÍÑ…•‘QÝ¥¸°€‰ÍÑ…•Á¥Ñä•Ù•¹ÑÌµÕÍÐÍÑ…ä‘•Ñ•Éµ¥¹¥ÍÑ¥Œˆ¤ì)…ÍÍ•ÉÐ¹½¬ (€5…Ñ ¹¡åÁ½Ð¡ÍÑ…•‘Ù•¹Ð¹Ñà€´ÍÑ…•‘MÁ…Ý¸¹Ñà°ÍÑ…•‘Ù•¹Ð¹Ñä€´ÍÑ…•‘MÁ…Ý¸¹Ñä¤€ðô€Ø°(€€‰„ÍÑ…••Ù•¹ÐµÕÍÐ™¥Ð¥¹Í¥‘”•…É±äÍ•¹Í”É…¹”ˆ°(¤ì)…ÍÍ•ÉÐ¹½¬ (€€…l‰…¥Èˆ°€‰‰•‘É½¬‰t¹¥¹±Õ‘•Ì¡•Ù•¹Ñ]½É±¹•ÑQ¥±”¡ÍÑ…•‘Ù•¹Ð¹Ñà°ÍÑ…•‘Ù•¹Ð¹Ñä¤ü¹­¥¹¤°(€€‰„ÍÑ…••Ù•¹ÐµÕÍÐÉ•µ…¥¸„Á¡åÍ¥…°Õ¹‘•ÉÉ½Õ¹Ñ…É•Ðˆ°(¤ì)…ÍÍ•ÉÐ¹•ÅÕ…°¡ÍÑ…•‘Ù•¹Ð¹ÑåÁ”°€‰…¹¥•¹Ñ}½¹Ñ…¥¹•Èˆ¤ì)…ÍÍ•ÉÑ½¹Ñ…¥¹•É1½½Ð¡•Ù•¹Ñ]½É±°ÍÑ…•‘Ù•¹Ð¤ì)…ÍÍ•ÉÐ¹•ÅÕ…°¡•Ù•¹Ñ]½É±¹•Ñ5¥É½Ù•¹ÑÌ ¤¹±•¹Ñ °€Ä¤ì)…ÍÍ•ÉÐ¹•ÅÕ…°¡Ñ¥±•¥¹•ÉÁÉ¥¹Ð¡•Ù•¹Ñ]½É±¤°ÍÑ…•‘¥¹•ÉÁÉ¥¹Ð°€‰ÍÑ…¥¹œ…¸•Ù•¹ÐµÕÍÐ¹½Ð¡…¹”É½¬½È½É”‘•¹Í¥Ñäˆ¤ì()±•Ð¡•­•‘MÑ…•‘Ù•¹ÑÌ€ô€Àì)™½È€¡±•ÐÍ••€ô€ÀìÍ••€ð€ÄÈìÍ••€¬ô€Ä¤ì(€½¹ÍÐÍÕÉ™…•]½É±€ô¹•Ü5¥¹•]½É±¡=I}QeAL°ÍÕÉ™…”µÁ¥Ñä´‘íÍ••‘ôµ…¹¥•¹Ðµ½¹Ñ…¥¹•É€¤ì(€½¹ÍÐÍÕÉ™…•MÑ…•€ôÍÕÉ™…•]½É±¹ÍÑ…•5¥É½Ù•¹Ñ9•…ÉMÁ…Ý¸ ‰…¹¥•¹Ñ}½¹Ñ…¥¹•Èˆ°ÍÕÉ™…•]½É±¹•ÑMÁ…Ý¸ ¤¤ì(€…ÍÍ•ÉÐ¹½¬¡ÍÕÉ™…•MÑ…•°ÍÕÉ™…”Á¥ÑäµÕÍÐÍÑ…”Ñ¡”¡•ÍÐ™½ÈÍ••€‘íÍ••‘õ€¤ì((€½¹ÍÐ±¥™Ñ]½É±€ô¹•Ü5¥¹•]½É±¡=I}QeAL°±¥™ÐµÁ¥Ñä´‘íÍ••‘ôµ…¹¥•¹Ðµ½¹Ñ…¥¹•É€¤ì(€½¹ÍÐ±¥™Ð€ô±¥™Ñ]½É±¹•Ñ1¥™ÑMÑ…ÉÐ ÄàÀ°€À¸ØÔ°€ÄàÀ°ìÕ¹±½­•‘Q¥•É…Àè€äô¤ì(€…ÍÍ•ÉÐ¹½¬¡±¥™Ð°±¥™Ð™¥áÑÕÉ”µÕÍÐ•á¥ÍÐ™½È¡•ÍÐÍ••€‘íÍ••‘õ€¤ì(€½¹ÍÐ±¥™ÑMÑ…•€ô±¥™Ñ]½É±¹ÍÑ…•5¥É½Ù•¹Ñ9•…ÉMÁ…Ý¸ ‰…¹¥•¹Ñ}½¹Ñ…¥¹•Èˆ°±¥™Ð¤ì(€…ÍÍ•ÉÐ¹½¬¡±¥™ÑMÑ…•°±¥™ÐÁ¥ÑäµÕÍÐÍÑ…”Ñ¡”¡•ÍÐ™½ÈÍ••€‘íÍ••‘õ€¤ì(€…ÍÍ•ÉÐ¹½¬ (€€€5…Ñ ¹¡åÁ½Ð¡±¥™ÑMÑ…•¹Ñà€´±¥™Ð¹Ñà°±¥™ÑMÑ…•¹Ñä€´±¥™Ð¹Ñä¤€ðô€à(€€€€€ñð€¡±¥™Ð¹Ñ…É•Ð€˜˜±¥™ÑMÑ…•¹Ñà€ôôô±¥™Ð¹Ñ…É•Ð¹Ñà€˜˜±¥™ÑMÑ…•¹Ñä€ôôô±¥™Ð¹Ñ…É•Ð¹Ñä¤°(€€€€‰±¥™ÐÁ¥ÑäµÕÍÐÍÑ…ä¹•…ÈÑ¡”ÕÉÉ•¹Ð±…¹‘¥¹œ½È¥ÑÌÕ…É…¹Ñ••Ñ…É•Ðˆ°(€€¤ì(€¡•­•‘MÑ…•‘Ù•¹ÑÌ€¬ô€Èì)ô((¼¼±¥™Ð±…¹‘¥¹œÉ•ÑÕ¹•Ì¥ÑÌ•á¥ÍÑ¥¹œ½¹”µ¹½‘”Í…µÁ±”Ñ¼Ñ¡”Ý½É­Í¡½ÀÌ(¼¼É•ÅÕ•ÍÑ•Í¡½ÉÑ…”¸%ÐµÕÍÐ¹½ÐÉ•…Ñ”•áÑÉ„½É”½ÈÉ•ÍÑ½É”™Õ±°‘••Àµ½É”!@¸)½¹ÍÐ±¥™ÑMÕÁÁ±å]½É±€ô¹•Ü5¥¹•]½É±¡=I}QeAL°€‰±¥™ÐµÉ•ÍÕÁÁ±äµÁÉ½‰”ˆ°ìÍ•Ñ½É%è€‰ÍÑ…‰±•}ÍÑÉ…Ñ„ˆô¤ì)½¹ÍÐ±¥™ÑMÕÁÁ±åMÑ…ÉÐ€ô±¥™ÑMÕÁÁ±å]½É±¹•Ñ1¥™ÑMÑ…ÉÐ àÀÀ°€À¸ÐÔ°€àÀÀ°ìÕ¹±½­•‘Q¥•É…Àè€äô¤ì)…ÍÍ•ÉÐ¹•ÅÕ…°¡±¥™ÑMÕÁÁ±åMÑ…ÉÐ¹Í½ÕÉ”°€‰Í¡…™Ðµ±¥™Ðˆ¤ì)…ÍÍ•ÉÐ¹½¬¡±¥™ÑMÕÁÁ±åMÑ…ÉÐ¹É•ÅÕ¥É•‘Q¥•È€øô€È°€‰Ñ¡”É•ÍÕÁÁ±ä™¥áÑÕÉ”µÕÍÐ…±±½Ü¥É½¸ˆ¤ì)½¹ÍÐ±¥™ÑMÕÁÁ±å	•™½É•½Õ¹Ð€ôÝ½É±‘5•ÑÉ¥Ì¡±¥™ÑMÕÁÁ±å]½É±¤¹½É•Q¥±•Ìì)½¹ÍÐ±¥™ÑMÕÁÁ±å=É¥¥¹…±…À€ô±¥™ÑMÕÁÁ±å]½É±¹•ÑQ¥±” (€±¥™ÑMÕÁÁ±åMÑ…ÉÐ¹Ñ…É•Ð¹Ñà°(€±¥™ÑMÕÁÁ±åMÑ…ÉÐ¹Ñ…É•Ð¹Ñä°(¤¹µ…á!Àì)½¹ÍÐ±¥™ÑMÕÁÁ±ä€ô±¥™ÑMÕÁÁ±å]½É±¹É•ÑÕ¹•1¥™ÑQ…É•Ð¡±¥™ÑMÕÁÁ±åMÑ…ÉÐ°l‰ÍÑ…É}½É”ˆ°€‰¥É½¸‰t¤ì)…ÍÍ•ÉÐ¹½¬¡±¥™ÑMÕÁÁ±ä°€‰„‘••À±¥™ÐµÕÍÐ•áÁ½Í”½¹”É•ÑÕ¹…‰±”É•ÍÕÁÁ±äÍ…µÁ±”ˆ¤ì)…ÍÍ•ÉÐ¹•ÅÕ…°¡±¥™ÑMÕÁÁ±ä¹½É•%°€‰¥É½¸ˆ°€‰…¸Õ¹…Ù…¥±…‰±”Ñ½ÀµÑ¥•ÈÉ•ÅÕ•ÍÐµÕÍÐ™…±°Ñ¡É½Õ Ñ¼Ñ¡”É•…¡…‰±”Í¡½ÉÑ…”ˆ¤ì)…ÍÍ•ÉÐ¹‘••ÁÅÕ…° (€ìÑàè±¥™ÑMÕÁÁ±ä¹Ñà°Ñäè±¥™ÑMÕÁÁ±ä¹Ñäô°(€ìÑàè±¥™ÑMÕÁÁ±åMÑ…ÉÐ¹Ñ…É•Ð¹Ñà°Ñäè±¥™ÑMÕÁÁ±åMÑ…ÉÐ¹Ñ…É•Ð¹Ñäô°(€€‰É•ÑÕ¹¥¹œµÕÍÐÉ•ÕÍ”Ñ¡”…ÕÑ¡½É•±…¹‘¥¹œ¹½‘”ˆ°(¤ì)½¹ÍÐ±¥™ÑMÕÁÁ±åQ¥±”€ô±¥™ÑMÕÁÁ±å]½É±¹•ÑQ¥±”¡±¥™ÑMÕÁÁ±ä¹Ñà°±¥™ÑMÕÁÁ±ä¹Ñä¤ì)…ÍÍ•ÉÐ¹•ÅÕ…°¡±¥™ÑMÕÁÁ±åQ¥±”¹±¥™ÑMÕÁÁ±ä°ÑÉÕ”¤ì)…ÍÍ•ÉÐ¹•ÅÕ…°¡±¥™ÑMÕÁÁ±åQ¥±”¹‘¥Í½Ù•É•°ÑÉÕ”¤ì)…ÍÍ•ÉÐ¹½¬¡±¥™ÑMÕÁÁ±åQ¥±”¹µ…á!À€ðô±¥™ÑMÕÁÁ±å=É¥¥¹…±…À°€‰Ñ¡”±…¹‘¥¹œÍ…µÁ±”µÕÍÐÉ•µ…¥¸ÅÕ¥¬Ñ¼½±±•Ðˆ¤ì)…ÍÍ•ÉÐ¹•ÅÕ…°¡Ý½É±‘5•ÑÉ¥Ì¡±¥™ÑMÕÁÁ±å]½É±¤¹½É•Q¥±•Ì°±¥™ÑMÕÁÁ±å	•™½É•½Õ¹Ð°€‰É•ÍÕÁÁ±äµÕÍÐ¹½Ð¥¹É•…Í”¹½‘”‘•¹Í¥Ñäˆ¤ì((¼¼Ù•ÉäÍ•Ñ½È…¹Í••ÍÑ…ÉÑÌÝ¥Ñ Ñ¡”Í…µ”Í¡½ÉÐ°µ¥¹•…‰±”•½¹½µäÍ•…´è(¼¼½ÁÁ•È¥ÌÙ¥Í¥‰±”¥µµ•‘¥…Ñ•±ä°½…°™½±±½ÝÌ‰•¡¥¹¥Ð°…¹…¹½Ñ¡•È½ÁÁ•È(¼¼Ñ¥±”É•Ý…É‘Ì½¹Ñ¥¹Õ¥¹œ‘½Ý¸Ñ¡”¹•Ý±ä½Á•¹•Í¡…™Ð¸)±•Ð¡•­•‘MÑ…ÉÑ•ÉM•…µÌ€ô€Àì)™½È€¡±•ÐÍ••€ô€ÄìÍ••€ðô€àìÍ••€¬ô€Ä¤ì(€™½È€¡½¹ÍÐÍ•Ñ½È½˜=1=%1}MQ=IL¤ì(€€€½¹ÍÐÍÑ…ÉÑ•É]½É±€ô¹•Ü5¥¹•]½É±¡=I}QeAL°ÍÑ…ÉÑ•ÈµÍ•…´´‘íÍ••‘õ€°ìÍ•Ñ½É%èÍ•Ñ½È¹¥ô¤ì(€€€½¹ÍÐÍÑ…ÉÑ•ÉMÁ…Ý¸€ôÍÑ…ÉÑ•É]½É±¹•ÑMÁ…Ý¸ ¤ì(€€€½¹ÍÐ™¥ÉÍÑ½ÁÁ•È€ôÍÑ…ÉÑ•É]½É±¹•ÑQ¥±”¡ÍÑ…ÉÑ•ÉMÁ…Ý¸¹Ñà°ÍÑ…ÉÑ•ÉMÁ…Ý¸¹Ñä€¬€È¤ì(€€€½¹ÍÐ½…°€ôÍÑ…ÉÑ•É]½É±¹•ÑQ¥±”¡ÍÑ…ÉÑ•ÉMÁ…Ý¸¹Ñà°ÍÑ…ÉÑ•ÉMÁ…Ý¸¹Ñä€¬€Ì¤ì(€€€½¹ÍÐÍ•½¹‘½ÁÁ•È€ôÍÑ…ÉÑ•É]½É±¹•ÑQ¥±”¡ÍÑ…ÉÑ•ÉMÁ…Ý¸¹Ñà°ÍÑ…ÉÑ•ÉMÁ…Ý¸¹Ñä€¬€Ð¤ì((€€€…ÍÍ•ÉÐ¹•ÅÕ…°¡™¥ÉÍÑ½ÁÁ•Èü¹½É•%°€‰½ÁÁ•Èˆ°€‘íÍ•Ñ½È¹¥‘ôµÕÍÐ•áÁ½Í”ÍÑ…ÉÑ•È½ÁÁ•É€¤ì(€€€…ÍÍ•ÉÐ¹•ÅÕ…°¡™¥ÉÍÑ½ÁÁ•Èü¹µ…á!À°€È°€‰™¥ÉÍÐ½ÁÁ•ÈµÕÍÐ™¥Ð¥¹Í¥‘”Ñ¡”½Á•¹¥¹œÍ¡¥™Ðˆ¤ì(€€€…ÍÍ•ÉÐ¹•ÅÕ…°¡½…°ü¹½É•%°€‰½…°ˆ°€‘íÍ•Ñ½È¹¥‘ôµÕÍÐÕ…É…¹Ñ•”•…É±ä½…±€¤ì(€€€…ÍÍ•ÉÐ¹•ÅÕ…°¡½…°ü¹µ…á!À°€Ð°€‰ÍÑ…ÉÑ•È½…°µÕÍÐ™¥ÐÑ¡”½Á•¹¥¹œÍ¡¥™ÐÝ¥Ñ¡½ÕÐ‰•½µ¥¹œ™É•”ˆ¤ì(€€€…ÍÍ•ÉÐ¹•ÅÕ…°¡Í•½¹‘½ÁÁ•Èü¹½É•%°€‰½ÁÁ•Èˆ°€‘íÍ•Ñ½È¹¥‘ôµÕÍÐ™¥¹¥Í Ñ¡”ÍÑ…ÉÑ•ÈÍ•…´Ý¥Ñ ½ÁÁ•É€¤ì(€€€…ÍÍ•ÉÐ¹•ÅÕ…°¡Í•½¹‘½ÁÁ•Èü¹µ…á!À°€Ì°€‰Í•½¹½ÁÁ•ÈµÕÍÐÍÑ…äÍ½™Ðˆ¤ì(€€€…ÍÍ•ÉÐ¹½¬¡™¥ÉÍÑ½ÁÁ•È¹‘¥Í½Ù•É•€˜˜½…°¹‘¥Í½Ù•É•€˜˜Í•½¹‘½ÁÁ•È¹‘¥Í½Ù•É•¤ì((€€€½¹ÍÐÍÑ…ÉÑ•ÉI½ÕÑ”€ôÍÑ…ÉÑ•É]½É±¹™¥¹‘1•…ÍÑI•Í¥ÍÑ…¹•MÑ•À (€€€€€ÍÑ…ÉÑ•ÉMÁ…Ý¸°(€€€€€ìÑàèÍÑ…ÉÑ•ÉMÁ…Ý¸¹Ñà°ÑäèÍÑ…ÉÑ•ÉMÁ…Ý¸¹Ñä€¬€Ðô°(€€€€€ìµ½Ù•MÁ••è€ÄÀÀ°‘¥A½Ý•ÉA•ÉM•½¹è€È¸ÈÔ°µ…á•Ñ½ÕÉQ¥±•Ìè€àô°(€€€€¤ì(€€€…ÍÍ•ÉÐ¹½¬¡ÍÑ…ÉÑ•ÉI½ÕÑ”ü¹É½ÕÑ”¹±•¹Ñ €øô€Ì°€‰Ñ¡”½µÁ±•Ñ”ÍÑ…ÉÑ•ÈÍ•…´µÕÍÐ‰”É•…¡…‰±”ˆ¤ì(€€€¡•­•‘MÑ…ÉÑ•ÉM•…µÌ€¬ô€Äì(€ô)ô((¼¼Q¡”Ñ¡É•”…‘‘¥Ñ¥½¹…°Õ…É…¹Ñ••½ÁÁ•ÈÁÉ½‰•ÌµÕÍÐ±•…¥¹Ñ¼Ñ¡”Í¡…™Ð°(¼¼¹•Ù•ÈÉ•É•…Ñ”Ñ¡”™½Éµ•ÈÍ¡…±±½Ü±•™Ð½É¥¡Ð™…Éµ¥¹œÍÑÉ¥À¸I•½ÉÑ¡”(¼¼É•ÅÕ•ÍÑ•±½…Ñ¥½¹ÌÝ¥Ñ¡½ÕÐ‘•Á•¹‘¥¹œ½¸¥¹¥‘•¹Ñ…°…Ù•Ì¥¸½¹”Í••¸)½¹ÍÐÍÑ…ÉÑ•É…¹]½É±€ô¹•Ü5¥¹•]½É±¡=I}QeAL°€‰ÍÑ…ÉÑ•Èµ‘•Í•¹‘¥¹œµ™…¸ˆ°ìÍ•Ñ½É%è€‰ÍÑ…‰±•}ÍÑÉ…Ñ„ˆô¤ì)½¹ÍÐÍÑ…ÉÑ•É…¹MÁ…Ý¸€ôÍÑ…ÉÑ•É…¹]½É±¹•ÑMÁ…Ý¸ ¤ì)½¹ÍÐÍÑ…ÉÑ•É…¹I•ÅÕ•ÍÑÌ€ômtì)½¹ÍÐ½É¥¥¹…±9•…É•ÍÑM½±¥‘Q¥±”€ôÍÑ…ÉÑ•É…¹]½É±¹}¹•…É•ÍÑM½±¥‘Q¥±”ì)ÍÑ…ÉÑ•É…¹]½É±¹}¹•…É•ÍÑM½±¥‘Q¥±”€ô€¡Ñà°Ñä°É…‘¥ÕÌ¤€ôøì(€ÍÑ…ÉÑ•É…¹I•ÅÕ•ÍÑÌ¹ÁÕÍ ¡ì(€€€‘àèÑà€´ÍÑ…ÉÑ•É…¹MÁ…Ý¸¹Ñà°(€€€‘äèÑä€´ÍÑ…ÉÑ•É…¹MÁ…Ý¸¹Ñä°(€€€É…‘¥ÕÌ°(€ô¤ì(€É•ÑÕÉ¸¹Õ±°ì)ôì)ÍÑ…ÉÑ•É…¹]½É±¹}Á±…•MÑ…ÉÑ•É=É” ¤ì)ÍÑ…ÉÑ•É…¹]½É±¹}¹•…É•ÍÑM½±¥‘Q¥±”€ô½É¥¥¹…±9•…É•ÍÑM½±¥‘Q¥±”ì)…ÍÍ•ÉÐ¹‘••ÁÅÕ…°¡ÍÑ…ÉÑ•É…¹I•ÅÕ•ÍÑÌ°l(€ì‘àè€´È°‘äè€Ð°É…‘¥ÕÌè€Èô°(€ì‘àè€È°‘äè€Ô°É…‘¥ÕÌè€Èô°(€ì‘àè€À°‘äè€Ü°É…‘¥ÕÌè€Èô°)t¤ì)…ÍÍ•ÉÐ¹½¬¡ÍÑ…ÉÑ•É…¹I•ÅÕ•ÍÑÌ¹•Ù•Éä ¡É•ÅÕ•ÍÐ¤€ôøÉ•ÅÕ•ÍÐ¹‘ä€øô€Ð€˜˜5…Ñ ¹…‰Ì¡É•ÅÕ•ÍÐ¹‘à¤€ðô€È¤¤ì((¼¼‘¥É•Ð‘¥…½¹…°µÕÍÐ¹½ÐÍÅÕ••é”Ñ¡É½Õ Ñ¡”Í•…´‰•ÑÝ••¸ÑÝ¼¥¹Ñ…Ð(¼¼‰±½­Ì¸Q¡”ÁÕ‰±¥ŒÉ½ÕÑ”™¥¹‘•ÈµÕÍÐ¥¹ÍÑ•…¡½½Í”½¹”½˜Ñ¡”½ÉÑ¡½½¹…°(¼¼‰±½­Ì…¹•¹Ñ•ÈÑ¡”½…°™É½´„…É‘¥¹…°‘¥É•Ñ¥½¸¸)½¹ÍÐ½É¹•É]½É±€ô¹•Ü5¥¹•]½É±¡=I}QeAL°€‰½É¹•ÈµÕÐµÁÉ½‰”ˆ¤ì)½¹ÍÐ½É¹•ÉMÑ…ÉÐ€ôìÑàè5…Ñ ¹™±½½È¡]=I1}=9%¹]%Q €¼€È¤°Ñäè€ÐÀôì)½¹ÍÐ½É¹•É½…°€ôìÑàè½É¹•ÉMÑ…ÉÐ¹Ñà€¬€Ä°Ñäè½É¹•ÉMÑ…ÉÐ¹Ñä€¬€Äôì)™½È€¡±•Ð½™™Í•Ñd€ô€´Èì½™™Í•Ñd€ðô€Ìì½™™Í•Ñd€¬ô€Ä¤ì(€™½È€¡±•Ð½™™Í•Ñ`€ô€´Èì½™™Í•Ñ`€ðô€Ìì½™™Í•Ñ`€¬ô€Ä¤ì(€€€½¹ÍÐÑ¥±”€ô½É¹•É]½É±¹•ÑQ¥±”¡½É¹•ÉMÑ…ÉÐ¹Ñà€¬½™™Í•Ñ`°½É¹•ÉMÑ…ÉÐ¹Ñä€¬½™™Í•Ñd¤ì(€€€Ñ¥±”¹­¥¹€ô€‰‰•‘É½¬ˆì(€€€Ñ¥±”¹¡À€ô€Å|ÀÀÁ|ÀÀÁ|ÀÀÀì(€€€Ñ¥±”¹µ…á!À€ô€Å|ÀÀÁ|ÀÀÁ|ÀÀÀì(€€€Ñ¥±”¹½É•%€ô¹Õ±°ì(€€€Ñ¥±”¹Ù•¥¹%€ô¹Õ±°ì(€ô)ô)™½È€¡½¹ÍÐÁ½¥¹Ð½˜m½É¹•ÉMÑ…ÉÐ°½É¹•É½…±t¤ì(€½¹ÍÐÑ¥±”€ô½É¹•É]½É±¹•ÑQ¥±”¡Á½¥¹Ð¹Ñà°Á½¥¹Ð¹Ñä¤ì(€Ñ¥±”¹­¥¹€ô€‰…¥Èˆì(€Ñ¥±”¹¡À€ô€Àì(€Ñ¥±”¹µ…á!À€ô€Àì)ô)™½È€¡½¹ÍÐÁ½¥¹Ð½˜l(€ìÑàè½É¹•É½…°¹Ñà°Ñäè½É¹•ÉMÑ…ÉÐ¹Ñäô°(€ìÑàè½É¹•ÉMÑ…ÉÐ¹Ñà°Ñäè½É¹•É½…°¹Ñäô°)t¤ì(€½¹ÍÐÑ¥±”€ô½É¹•É]½É±¹•ÑQ¥±”¡Á½¥¹Ð¹Ñà°Á½¥¹Ð¹Ñä¤ì(€Ñ¥±”¹­¥¹€ô€‰ÍÑ½¹”ˆì(€Ñ¥±”¹¡À€ô€Èì(€Ñ¥±”¹µ…á!À€ô€Èì)ô()½¹ÍÐ½É¹•ÉI½ÕÑ”€ô½É¹•É]½É±¹™¥¹‘1•…ÍÑI•Í¥ÍÑ…¹•MÑ•À¡½É¹•ÉMÑ…ÉÐ°½É¹•É½…°°ì(€µ½Ù•MÁ••è€ÄÀÀ°(€‘¥A½Ý•ÉA•ÉM•½¹è€ÄÀ°(€µ…á•Ñ½ÕÉQ¥±•Ìè€È°(€µ¥¹¥µÕµM…Ù¥¹Ìè€À°)ô¤ì)…ÍÍ•ÉÐ¹½¬¡½É¹•ÉI½ÕÑ”°€‰…¸½ÉÑ¡½½¹…°ÑÝ¼µÍÑ•ÀÉ½ÕÑ”µÕÍÐÉ•µ…¥¸…Ù…¥±…‰±”ˆ¤ì)…ÍÍ•ÉÐ¹•ÅÕ…° (€½É¹•É]½É±¹}É½ÕÑ•MÑ•Á½ÍÐ¡½É¹•ÉMÑ…ÉÐ°½É¹•É½…°°ì(€€€µ½Ù•MÁ••è€ÄÀÀ°(€€€‘¥A½Ý•ÉA•ÉM•½¹è€ÄÀ°(€€€¡…É‘¹•ÍÍ5Õ±Ñ¥Á±¥•Èè€Ä°(€€€™½ÕÍ•‘=É•%è¹Õ±°°(€€€™½ÕÍ•‘=É•¥5Õ±Ñ¥Á±¥•Èè€Ä°(€ô¤°(€%¹™¥¹¥Ñä°(€€‰Ñ¡”‰±½­•½¹”µÍÑ•À‘¥…½¹…°µÕÍÐ‰”É•©•Ñ•ˆ°(¤ì)…ÍÍ•ÉÐ¹•ÅÕ…°¡½É¹•ÉI½ÕÑ”¹É½ÕÑ”¹±•¹Ñ °€Ì¤ì)…ÍÍ•ÉÐ¹½¬ (€½É¹•ÉI½ÕÑ”¹É½ÕÑ”¹Í±¥” Ä¤¹•Ù•Éä ¡Á½¥¹Ð°¥¹‘•à¤€ôøì(€€€½¹ÍÐÁÉ•Ù¥½ÕÌ€ô½É¹•ÉI½ÕÑ”¹É½ÕÑ•m¥¹‘•átì(€€€É•ÑÕÉ¸Á½¥¹Ð¹Ñà€ôôôÁÉ•Ù¥½ÕÌ¹ÑàñðÁ½¥¹Ð¹Ñä€ôôôÁÉ•Ù¥½ÕÌ¹Ñäì(€ô¤°(€€‰Ñ¡”É•Á±…•µ•¹ÐÉ½ÕÑ”µÕÍÐ½¹Ñ…¥¸…É‘¥¹…°ÍÑ•ÁÌ½¹±äˆ°(¤ì((¼¼á¥ÍÑ¥¹œ±¥Ù”µ½É”¥¹‘•à…¹É½ÕÑ”Í•…É É•µ…¥¸ÕÍ…‰±”Ý¥Ñ „Í•±•Ñ•Í•Ñ½È¸)±•Ð™¥ÉÍÑ=É”€ô¹Õ±°ì)±•Ð¥¹‘•á•‘=É”€ô€Àì)•Ù•¹Ñ]½É±¹™½É…¡=É•Q¥±•%¹	½Õ¹‘Ì (€€À°(€€À°(€]=I1}=9%¹]%Q €´€Ä°(€]=I1}=9%¹!%!P€´€Ä°(€€¡Ñ¥±”°Ñà°Ñä¤€ôøì(€€€¥¹‘•á•‘=É”€¬ô€Äì(€€€¥˜€ …™¥ÉÍÑ=É”¤™¥ÉÍÑ=É”€ôìÑ¥±”°Ñà°Ñäôì(€ô°(¤ì)…ÍÍ•ÉÐ¹½¬¡¥¹‘•á•‘=É”€ø€À€˜˜™¥ÉÍÑ=É”¤ì)½¹ÍÐÍÁ…Ý¸€ô•Ù•¹Ñ]½É±¹•ÑMÁ…Ý¸ ¤ì)½¹ÍÐ¡Á	•™½É•I½ÕÑ”€ô•Ù•¹Ñ]½É±¹•ÑQ¥±”¡™¥ÉÍÑ=É”¹Ñà°™¥ÉÍÑ=É”¹Ñä¤¹¡Àì)½¹ÍÐÉ½ÕÑ”€ô•Ù•¹Ñ]½É±¹™¥¹‘1•…ÍÑI•Í¥ÍÑ…¹•MÑ•À¡ÍÁ…Ý¸°™¥ÉÍÑ=É”°ì(€µ½Ù•MÁ••è€ÄÀÀ°(€‘¥A½Ý•ÉA•ÉM•½¹è€ÄÀ°(€µ…á•Ñ½ÕÉQ¥±•Ìè€à°)ô¤ì)…ÍÍ•ÉÐ¹½¬¡É½ÕÑ”ü¹É½ÕÑ”¹±•¹Ñ €øô€Ä¤ì)…ÍÍ•ÉÐ¹•ÅÕ…°¡•Ù•¹Ñ]½É±¹•ÑQ¥±”¡™¥ÉÍÑ=É”¹Ñà°™¥ÉÍÑ=É”¹Ñä¤¹¡À°¡Á	•™½É•I½ÕÑ”°€‰É½ÕÑ¥¹œÍÑ…åÌÉ•…µ½¹±äˆ¤ì((¼¼‘…µ…•I…ä‘•±¥‰•É…Ñ•±ä…ÁÁ±¥•Ì¥ÑÌ™Õ±°‘…µ…”Ñ¼•Ù•ÉäÑ¥±”½Ù•É•‰äÑ¡”(¼¼ÍÕÁÁ±¥•Ý¥‘Ñ ¸…±±½™˜‰…¹‘ÌÑ¡•É•™½É”‰•±½¹œÑ¼Ñ¡”…±±•ÈèÑ¡”±…Í•ÈµÕÍÐ(¼¼Á…ÍÌ½¹±ä¥ÑÌÁ•Éµ…¹•¹Ð½É”Ý¥‘Ñ …¹É•Í½±Ù”Ñ¡•Éµ…°•‘•ÌÍ•Á…É…Ñ•±ä¸)½¹ÍÐÉ…å½¹ÑÉ…Ñ]½É±€ô¹•Ü5¥¹•]½É±¡=I}QeAL°€‰É…äµÝ¥‘Ñ µ½¹ÑÉ…Ðˆ¤ì)½¹ÍÐÉ…å=É¥¥¹Qà€ô5…Ñ ¹™±½½È¡]=I1}=9%¹]%Q €¼€È¤ì)½¹ÍÐÉ…å=É¥¥¹Qä€ô€ÐÀì)½¹ÍÐÉ…å½É”€ôÉ…å½¹ÑÉ…Ñ]½É±¹•ÑQ¥±”¡É…å=É¥¥¹Qà€¬€È°É…å=É¥¥¹Qä¤ì)½¹ÍÐÉ…å‘”€ôÉ…å½¹ÑÉ…Ñ]½É±¹•ÑQ¥±”¡É…å=É¥¥¹Qà€¬€È°É…å=É¥¥¹Qä€¬€Ä¤ì)™½È€¡½¹ÍÐÑ¥±”½˜mÉ…å½É”°É…å‘•t¤ì(€=‰©•Ð¹…ÍÍ¥¸¡Ñ¥±”°ì(€€€­¥¹è€‰ÍÑ½¹”ˆ°(€€€½É•%è¹Õ±°°(€€€Ù•¥¹%è¹Õ±°°(€€€¡Àè€ÄÀÀ°(€€€µ…á!Àè€ÄÀÀ°(€€€‘¥Í½Ù•É•èÑÉÕ”°(€€€É…­•è€À°(€ô¤ì)ô)½¹ÍÐÉ…å=É¥¥¹`€ô€¡É…å=É¥¥¹Qà€¬€À¸Ô¤€¨]=I1}=9%¹Q%1}M%iì)½¹ÍÐÉ…å=É¥¥¹d€ô€¡É…å=É¥¥¹Qä€¬€À¸Ô¤€¨]=I1}=9%¹Q%1}M%iì)É…å½¹ÑÉ…Ñ]½É±¹‘…µ…•I…ä¡É…å=É¥¥¹`°É…å=É¥¥¹d°€Ä°€À°]=I1}=9%¹Q%1}M%i€¨€Ð°€ÄÀ°€à¤ì)…ÍÍ•ÉÐ¹•ÅÕ…°¡É…å½É”¹¡À°€äÀ°€‰Ñ¡”•¥¡ÐµÁ¥á•°½É”µÕÍÐ‘…µ…”¥ÑÌ•¹Ñ•ÈÉ½Üˆ¤ì)…ÍÍ•ÉÐ¹•ÅÕ…°¡É…å‘”¹¡À°€ÄÀÀ°€‰Ñ¡”•¥¡ÐµÁ¥á•°½É”µÕÍÐ¹½ÐÉ•… Ñ¡”¹•¥¡‰½É¥¹œÉ½Üˆ¤ì)É…å½¹ÑÉ…Ñ]½É±¹‘…µ…•I…ä¡É…å=É¥¥¹`°É…å=É¥¥¹d°€Ä°€À°]=I1}=9%¹Q%1}M%i€¨€Ð°€ÄÀ°€ÈÌ¤ì)…ÍÍ•ÉÐ¹•ÅÕ…°¡É…å½É”¹¡À°€àÀ¤ì)…ÍÍ•ÉÐ¹•ÅÕ…°¡É…å‘”¹¡À°€äÀ°€‰‘…µ…•I…ä¡…Ì¹¼¥µÁ±¥¥Ð•‘”™…±±½™˜…ÐÝ¥‘•ÈÝ¥‘Ñ¡Ìˆ¤ì()½¹Í½±”¹±½œ¡)M=8¹ÍÑÉ¥¹¥™ä¡ì(€½¬èÑÉÕ”°(€‘¥…¹½ÍÑ¥AÉ½™¥±•Ìè±•…åAÉ½™¥±•Ì¹±•¹Ñ °(€Á¡åÍ¥…±Ù•¹ÑQåÁ•Ìè•Ù•¹ÑÌ¹±•¹Ñ °(€±½‰…±Ù•¹ÑQåÁ•ÌèÍ¡•‘Õ±•‘QåÁ•Ì¹Í¥é”°(€¡•­•‘MÑ…ÉÑ•ÉM•…µÌ°(€¡•­•‘MÑ…•‘Ù•¹ÑÌ°(€¡•­•‘•ÁÑ¡…Ñ•‘=É”°(€Í…µÁ±•‘=É••¹Í¥Ñäè9Õµ‰•È¡Í…µÁ±•‘=É••¹Í¥Ñä¹Ñ½¥á• Ð¤¤°(€Í…µÁ±•‘…Ù••¹Í¥Ñäè9Õµ‰•È¡Í…µÁ±•‘…Ù••¹Í¥Ñä¹Ñ½¥á• Ð¤¤°(€µ…ááÁ•Ñ•‘9½‘•	Õ‘•ÑÉ¥™Ðè9Õµ‰•È¡µ…ááÁ•Ñ•‘9½‘•	Õ‘•ÑÉ¥™Ð¹Ñ½¥á• Ð¤¤°(€µ…á•¹•É…Ñ•‘9½‘•	Õ‘•ÑÉ¥™Ðè9Õµ‰•È¡µ…á•¹•É…Ñ•‘9½‘•	Õ‘•ÑÉ¥™Ð¹Ñ½¥á• Ð¤¤°(€…Ù•É¹¥Èè…Ù•É¸¹Õ¹‘•ÉÉ½Õ¹‘¥È°(€É¥‘•¥ÈèÉ¥‘”¹Õ¹‘•ÉÉ½Õ¹‘¥È°(€…Ù•É¹=É”è…Ù•É¸¹½É•Q¥±•Ì°(€É¥‘•=É”èÉ¥‘”¹½É•Q¥±•Ì°)ô¤¤ì(