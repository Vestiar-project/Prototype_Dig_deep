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
  UNDERGROUND_EVENT_TYPES,
  MineWorld,
  WORLD_CONFIG,
  getSectorChoices,
} = global.DepthZeroWorld;

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

const choices = getSectorChoices("menu-preview-seed");
assert.equal(choices.length, 3, "exactly three geological sectors must be offered");
assert.equal(GEOLOGICAL_SECTORS.length, 3);
assert.equal(new Set(choices.map((sector) => sector.id)).size, choices.length);
assert.deepEqual(choices, getSectorChoices("menu-preview-seed"), "sector menu must be deterministic");
assert.deepEqual(choices, MineWorld.getSectorChoices());

for (const sector of choices) {
  assert.ok(sector.label.length >= 5, `${sector.id} needs an obvious name`);
  assert.ok(sector.description.length >= 30, `${sector.id} needs a readable description`);
  assert.match(sector.color, /^#[0-9a-f]{6}$/i);
  assert.ok(sector.icon);
  assert.equal(sector.forecast.length, 4, `${sector.id} must forecast all four generation axes`);
  assert.deepEqual(Object.keys(sector.modifiers).sort(), ["abundance", "caves", "hardness", "veins"]);
  for (const value of Object.values(sector.modifiers)) assert.ok(Number.isFinite(value) && value > 0);
}

// Old constructor/reset forms remain deterministic and select the neutral
// profile, while object and third-argument sector forms select a real profile.
const legacyA = new MineWorld(ORE_TYPES, "legacy-sector-probe");
const legacyB = new MineWorld(ORE_TYPES, "legacy-sector-probe");
assert.equal(legacyA.getSectorInfo().id, "stable_strata");
assert.equal(tileFingerprint(legacyA), tileFingerprint(legacyB));
assert.deepEqual(legacyA.getMicroEvents(), legacyB.getMicroEvents());

const constructorOption = new MineWorld(ORE_TYPES, "constructor-sector-probe", {
  sectorId: "ore_ridge",
});
assert.equal(constructorOption.getSectorInfo().id, "ore_ridge");
const constructorObject = new MineWorld(ORE_TYPES, {
  seed: "constructor-object-probe",
  sector: "cavern_karst",
});
assert.equal(constructorObject.seed, "constructor-object-probe");
assert.equal(constructorObject.getSectorInfo().id, "cavern_karst");

const resetProbe = new MineWorld(ORE_TYPES, "reset-before");
assert.equal(resetProbe.reset("reset-after", { sector: "ore_ridge" }), resetProbe);
assert.equal(resetProbe.seed, "reset-after");
assert.equal(resetProbe.getSectorInfo().id, "ore_ridge");
resetProbe.reset({ seed: "reset-object", sectorId: "cavern_karst" });
assert.equal(resetProbe.seed, "reset-object");
assert.equal(resetProbe.getSectorInfo().id, "cavern_karst");

// Every advertised forecast is backed by measurable generation differences.
const differenceSeed = "sector-difference-probe";
const cavernWorld = new MineWorld(ORE_TYPES, differenceSeed, { sectorId: "cavern_karst" });
const ridgeWorld = new MineWorld(ORE_TYPES, differenceSeed, { sectorId: "ore_ridge" });
const cavern = worldMetrics(cavernWorld);
const ridge = worldMetrics(ridgeWorld);
const cavernRock = worldMetrics(new MineWorld([], differenceSeed, { sectorId: "cavern_karst" }));
const ridgeRock = worldMetrics(new MineWorld([], differenceSeed, { sectorId: "ore_ridge" }));
assert.ok(cavern.undergroundAir > ridge.undergroundAir, "cavern sector must carve more caves");
assert.ok(cavernRock.averageSolidHp < ridgeRock.averageSolidHp, "cavern sector must be softer");
assert.ok(cavern.oreTiles < ridge.oreTiles, "ore ridge must contain more ore");
assert.ok(cavern.averageVeinSize < ridge.averageVeinSize, "ore ridge must grow larger veins");
assert.notEqual(tileFingerprint(cavernWorld), tileFingerprint(ridgeWorld));

assert.equal(UNDERGROUND_EVENT_TYPES.length, 5);
const eventWorld = new MineWorld(ORE_TYPES, "micro-event-probe", { sectorId: "ore_ridge" });
const eventTwin = new MineWorld(ORE_TYPES, "micro-event-probe", { sectorId: "ore_ridge" });
const events = eventWorld.getMicroEvents();
assert.equal(events.length, 5, "all five readable micro-event types must be generated");
assert.equal(new Set(events.map((event) => event.type)).size, 5);
assert.deepEqual(events, eventTwin.getMicroEvents(), "micro-events must be deterministic");

for (let seed = 1; seed <= 12; seed += 1) {
  for (const sector of choices) {
    const stressWorld = new MineWorld(ORE_TYPES, `micro-stress-${seed}`, { sectorId: sector.id });
    const stressEvents = stressWorld.getMicroEvents();
    assert.equal(stressEvents.length, UNDERGROUND_EVENT_TYPES.length);
    assert.ok(stressEvents.every((event) => event.depthTiles >= 12));
  }
}

for (const event of events) {
  assert.ok(event.depthTiles >= 12, `${event.type} must start after the early zone`);
  assert.ok(event.label.length >= 8);
  assert.ok(event.icon);
  assert.match(event.color, /^#[0-9a-f]{6}$/i);
  assert.ok(event.radius >= WORLD_CONFIG.TILE_SIZE * 3);
  assert.ok(event.radiusTiles >= 3);
  assert.ok(event.description.length >= 40);
  assert.equal(event.noticeLevel, "high");
  assert.equal(event.visual.pulse, "strong");
  assert.equal(event.visual.color, event.color);
  assert.ok(event.announcement.includes(event.label));
  assert.equal(event.triggered, false);
  assert.equal(event.consumed, false);
  assert.equal(event.state, "ready");
}

const first = events[0];
const tileSearch = eventWorld.getMicroEventsNear(first.tx, first.ty, 0);
assert.equal(tileSearch[0]?.id, first.id, "tile-space proximity search must find an event at its center");
const pixelSearch = eventWorld.findUndergroundEvent(first.x, first.y, 0);
assert.equal(pixelSearch?.id, first.id, "world-space proximity search must find an event at its center");
assert.equal(pixelSearch?.distance, 0);

// Returned records are defensive copies.
const copiedEvents = eventWorld.getMicroEvents();
copiedEvents[0].label = "mutated";
copiedEvents[0].visual.color = "#000000";
assert.notEqual(eventWorld.getMicroEvents()[0].label, "mutated");
assert.notEqual(eventWorld.getMicroEvents()[0].visual.color, "#000000");

const triggered = eventWorld.triggerMicroEvent(first.id);
assert.equal(triggered.id, first.id);
assert.equal(triggered.firstTrigger, true);
assert.equal(triggered.state, "triggered");
assert.equal(eventWorld.triggerMicroEvent(first.id), null, "trigger must be one-shot");
const consumed = eventWorld.consumeMicroEvent(first.id);
assert.equal(consumed.id, first.id);
assert.equal(consumed.wasTriggered, true);
assert.equal(consumed.firstConsume, true);
assert.equal(consumed.state, "consumed");
assert.equal(eventWorld.consumeMicroEvent(first.id), null, "consume must be one-shot");
assert.ok(!eventWorld.getMicroEvents().some((event) => event.id === first.id));
assert.ok(eventWorld.getMicroEvents({ includeConsumed: true }).some((event) => event.id === first.id));

const second = events[1];
const directlyConsumed = eventWorld.consumeMicroEvent(second.id);
assert.equal(directlyConsumed.wasTriggered, false, "consume may atomically trigger an untouched event");
assert.equal(eventWorld.triggerMicroEvent(second.id), null);

eventWorld.reset("micro-event-probe", { sectorId: "ore_ridge" });
assert.deepEqual(eventWorld.getMicroEvents(), eventTwin.getMicroEvents(), "reset must restore deterministic ready events");

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
    assert.equal(coal?.maxHp, 6, "starter coal must be soft but still distinct from copper");
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

// A direct diagonal must not squeeze through the seam between two intact
// blocks. The public route finder must instead choose one of the orthogonal
// blocks and enter the goal from a cardinal direction.
const cornerWorld = new MineWorld(ORE_TYPES, "corner-cut-probe");
const cornerStart = { tx: 120, ty: 40 };
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

console.log(JSON.stringify({
  ok: true,
  sectors: choices.length,
  microEventTypes: events.length,
  checkedStarterSeams,
  cavernAir: cavern.undergroundAir,
  ridgeAir: ridge.undergroundAir,
  cavernOre: cavern.oreTiles,
  ridgeOre: ridge.oreTiles,
}));
