"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

global.window = global;
const root = path.resolve(__dirname, "..");
require(path.join(root, "js", "upgrades.js"));
require(path.join(root, "js", "world.js"));

const { UPGRADE_DEFS, ORE_TYPES, calculateMetaStats } = global.DepthZeroUpgrades;
const { MineWorld, WORLD_CONFIG } = global.DepthZeroWorld;
const ids = new Set(UPGRADE_DEFS.map((definition) => definition.id));

assert.equal(UPGRADE_DEFS.length, 102);
assert.equal(ids.size, UPGRADE_DEFS.length, "upgrade ids must be unique");
assert.equal(UPGRADE_DEFS.reduce((sum, definition) => sum + definition.maxLevel, 0), 498);
for (const definition of UPGRADE_DEFS) {
  for (const requirement of definition.requires || []) {
    const id = typeof requirement === "string" ? requirement : requirement.id;
    assert.ok(ids.has(id), `${definition.id} references missing upgrade ${id}`);
  }
}

const fullLevels = Object.fromEntries(UPGRADE_DEFS.map((definition) => [definition.id, definition.maxLevel]));
const fullStats = calculateMetaStats(fullLevels);
assert.equal(fullStats.runDuration, 45);
assert.equal(fullStats.bonusRunDurationCap, 60);

const timerNodes = UPGRADE_DEFS.filter((definition) => definition.category === "time");
assert.deepEqual(
  timerNodes.map((definition) => definition.id),
  ["time_extra_breath", "time_clockwork_heart", "time_capsule", "time_thirty_second_oath"],
  "timer progression must stay condensed into exactly four meaningful nodes",
);
assert.equal(timerNodes.reduce((sum, definition) => sum + definition.maxLevel, 0), 37);

const removedDuplicateIds = [
  "sense_ore_scent",
  "sense_wide_sweep",
  "dig_long_handle",
  "dig_relentless_rhythm",
  "power_weighted_head",
  "tools_laser_lens",
  "fortune_ore_appraisal",
  "time_wound_spring",
  "time_sand_reserve",
  "time_stolen_second",
  "time_overtime_protocol",
  "time_frozen_moment",
  "time_aftershock_clock",
  "time_last_second",
  "time_chrono_shard",
  "time_elastic_second",
  "time_deep_shift",
  "time_keeper",
  "time_discovery_bonus",
];
for (const id of removedDuplicateIds) {
  assert.ok(!ids.has(id), `${id} must not return to the exported tree`);
}

const playerFacingSource = ["index.html", path.join("js", "game.js")]
  .map((file) => fs.readFileSync(path.join(root, file), "utf8"))
  .join("\n");
assert.doesNotMatch(
  playerFacingSource,
  /Стаж экспедиции/i,
  "expedition tenure must not remain in player-facing UI or campaign logic",
);

const routeCalibrationWorld = new MineWorld(ORE_TYPES, "route-calibration-probe");
let focusedRouteTile = null;
let ordinaryRouteTile = null;
for (let ty = 1; ty < WORLD_CONFIG.HEIGHT - 1 && (!focusedRouteTile || !ordinaryRouteTile); ty += 1) {
  for (let tx = 1; tx < WORLD_CONFIG.WIDTH - 1 && (!focusedRouteTile || !ordinaryRouteTile); tx += 1) {
    const tile = routeCalibrationWorld.getTile(tx, ty);
    if (!tile || tile.kind === "air" || tile.kind === "bedrock") continue;
    if (tile.oreId && !focusedRouteTile) focusedRouteTile = { tx, ty, tile };
    if (!tile.oreId && !ordinaryRouteTile) ordinaryRouteTile = { tx, ty, tile };
  }
}
assert.ok(focusedRouteTile && ordinaryRouteTile);
const baseRouteOptions = {
  moveSpeed: 100,
  digPowerPerSecond: 10,
  hardnessMultiplier: 1,
  focusedOreId: focusedRouteTile.tile.oreId,
  focusedOreDigMultiplier: 1,
};
const calibratedRouteOptions = { ...baseRouteOptions, focusedOreDigMultiplier: 2 };
const routeStepFrom = (point) => ({ tx: point.tx - 1, ty: point.ty });
assert.ok(
  routeCalibrationWorld._routeStepCost(routeStepFrom(focusedRouteTile), focusedRouteTile, calibratedRouteOptions)
    < routeCalibrationWorld._routeStepCost(routeStepFrom(focusedRouteTile), focusedRouteTile, baseRouteOptions),
  "focused calibration must reduce only the focused ore step cost",
);
assert.equal(
  routeCalibrationWorld._routeStepCost(routeStepFrom(ordinaryRouteTile), ordinaryRouteTile, calibratedRouteOptions),
  routeCalibrationWorld._routeStepCost(routeStepFrom(ordinaryRouteTile), ordinaryRouteTile, baseRouteOptions),
  "focused calibration must not soften ordinary route tiles",
);

let checkedRoutes = 0;
let checkedVeins = 0;
for (let seed = 1; seed <= 50; seed += 1) {
  const world = new MineWorld(ORE_TYPES, `stress-${seed}`);
  const lift = world.getLiftStart(120, 0.35, 120, { unlockedTierCap: 9 });
  assert.ok(lift && Number.isFinite(lift.x) && Number.isFinite(lift.y));
  assert.ok(lift.depthTiles <= 42 + 1e-9);
  assert.ok(world.getTile(lift.tx, lift.ty)?.kind === "air", "lift landing must be open");
  assert.ok(lift.target && world.getTile(lift.target.tx, lift.target.ty)?.oreId, "lift needs a guaranteed ore target");

  const beforeHp = world.getTile(lift.target.tx, lift.target.ty).hp;
  const route = world.findLeastResistanceStep(lift, lift.target, {
    moveSpeed: 100,
    digPowerPerSecond: 8,
    maxDetourTiles: 9,
  });
  assert.ok(route && route.waypoint && route.route.length >= 1);
  assert.equal(world.getTile(lift.target.tx, lift.target.ty).hp, beforeHp, "route search must be read-only");
  checkedRoutes += 1;

  let oreTiles = 0;
  let firstOreCoordinate = null;
  const veins = new Map();
  for (let ty = 0; ty < WORLD_CONFIG.HEIGHT; ty += 1) {
    for (let tx = 0; tx < WORLD_CONFIG.WIDTH; tx += 1) {
      const tile = world.getTile(tx, ty);
      if (!tile?.oreId) continue;
      oreTiles += 1;
      if (!firstOreCoordinate) firstOreCoordinate = { tx, ty };
      assert.ok(tile.veinId, `ore tile ${tx}:${ty} must keep a vein id`);
      const vein = veins.get(tile.veinId) || { oreId: tile.oreId, cells: new Set() };
      assert.equal(
        vein.oreId,
        tile.oreId,
        `vein ${tile.veinId} must not contain conflicting ore types`,
      );
      const coordinate = `${tx}:${ty}`;
      assert.ok(!vein.cells.has(coordinate), `vein ${tile.veinId} repeats cell ${coordinate}`);
      vein.cells.add(coordinate);
      veins.set(tile.veinId, vein);
    }
  }
  assert.ok(oreTiles > 0);
  for (const vein of veins.values()) {
    assert.ok(vein.cells.size > 0, "every generated vein must own at least one unique cell");
    checkedVeins += 1;
  }

  let indexedOreTiles = 0;
  let previousIndex = -1;
  world.forEachOreTileInBounds(0, 0, WORLD_CONFIG.WIDTH - 1, WORLD_CONFIG.HEIGHT - 1, (_tile, tx, ty) => {
    const index = ty * WORLD_CONFIG.WIDTH + tx;
    assert.ok(index > previousIndex, "ore index must preserve row-major tie-breaking order");
    previousIndex = index;
    indexedOreTiles += 1;
  });
  assert.equal(indexedOreTiles, oreTiles, "ore index must enumerate every live ore tile exactly once");
  assert.ok(firstOreCoordinate);
  world.breakTile(firstOreCoordinate.tx, firstOreCoordinate.ty);
  let indexedAfterBreak = 0;
  world.forEachOreTileInBounds(0, 0, WORLD_CONFIG.WIDTH - 1, WORLD_CONFIG.HEIGHT - 1, () => {
    indexedAfterBreak += 1;
  });
  assert.equal(indexedAfterBreak, oreTiles - 1, "broken ore must leave the live index immediately");
}

// Force the random walk to stay on its origin. The deterministic fallback must
// still place the requested number of unique cells, and _applyOre must never be
// called twice for the same cell merely to inflate the returned count.
const duplicateWorld = new MineWorld(ORE_TYPES, "duplicate-walk-probe");
const richestDefinition = duplicateWorld._oreDefinitions.reduce((richest, definition) => (
  !richest || definition.rank > richest.rank ? definition : richest
), null);
const requestedSize = 7;
let probeOrigin = null;
for (let ty = 2; ty < WORLD_CONFIG.HEIGHT - WORLD_CONFIG.BEDROCK_ROWS - 2 && !probeOrigin; ty += 1) {
  for (let tx = 2; tx < WORLD_CONFIG.WIDTH - 2 && !probeOrigin; tx += 1) {
    const tile = duplicateWorld.getTile(tx, ty);
    if (!tile || tile.kind === "air" || tile.kind === "bedrock") continue;
    let nearbySolid = 0;
    for (let offsetY = -3; offsetY <= 3; offsetY += 1) {
      for (let offsetX = -3; offsetX <= 3; offsetX += 1) {
        if (Math.abs(offsetX) + Math.abs(offsetY) > 3) continue;
        const nearby = duplicateWorld.getTile(tx + offsetX, ty + offsetY);
        if (nearby && nearby.kind !== "air" && nearby.kind !== "bedrock") nearbySolid += 1;
      }
    }
    if (nearbySolid >= requestedSize) probeOrigin = { tx, ty };
  }
}
assert.ok(probeOrigin, "duplicate-walk probe needs a sufficiently solid origin");

const expectedVeinId = `${richestDefinition.id}:${duplicateWorld._nextVeinId}`;
const originalNext = duplicateWorld._rng.next;
const originalApplyOre = duplicateWorld._applyOre;
let probeApplyCalls = 0;
duplicateWorld._rng.next = () => 0;
duplicateWorld._applyOre = function applyOreProbe(...args) {
  if (args[3] === expectedVeinId) probeApplyCalls += 1;
  return originalApplyOre.apply(this, args);
};
const uniquePlaced = duplicateWorld._placeVein(
  probeOrigin.tx,
  probeOrigin.ty,
  richestDefinition,
  requestedSize,
);
duplicateWorld._rng.next = originalNext;
duplicateWorld._applyOre = originalApplyOre;

let actualProbeCells = 0;
for (let ty = 0; ty < WORLD_CONFIG.HEIGHT; ty += 1) {
  for (let tx = 0; tx < WORLD_CONFIG.WIDTH; tx += 1) {
    if (duplicateWorld.getTile(tx, ty)?.veinId === expectedVeinId) actualProbeCells += 1;
  }
}
assert.equal(uniquePlaced, requestedSize, "fallback must complete a stalled random-walk vein");
assert.equal(actualProbeCells, uniquePlaced, "reported vein size must equal its unique world cells");
assert.equal(probeApplyCalls, uniquePlaced, "duplicate visits must not reapply or recount the same cell");

const deterministicA = new MineWorld(ORE_TYPES, "determinism-probe");
const deterministicB = new MineWorld(ORE_TYPES, "determinism-probe");
assert.deepEqual(deterministicA.surface, deterministicB.surface, "same seed must reproduce the surface");
for (let ty = 0; ty < WORLD_CONFIG.HEIGHT; ty += 1) {
  for (let tx = 0; tx < WORLD_CONFIG.WIDTH; tx += 1) {
    assert.deepEqual(
      deterministicA.getTile(tx, ty),
      deterministicB.getTile(tx, ty),
      `same seed must reproduce tile ${tx}:${ty}`,
    );
  }
}

console.log(JSON.stringify({
  ok: true,
  nodes: UPGRADE_DEFS.length,
  levels: UPGRADE_DEFS.reduce((sum, definition) => sum + definition.maxLevel, 0),
  seeds: 50,
  checkedRoutes,
  checkedVeins,
  duplicateWalkCells: actualProbeCells,
}));
