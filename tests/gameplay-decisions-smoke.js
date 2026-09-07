"use strict";

const assert = require("node:assert/strict");
const { api, elementFor, localData } = require("./helpers/runtime-harness.js");
const { MineWorld } = global.DepthZeroWorld;
const { ORE_TYPES } = global.DepthZeroUpgrades;

const clearTile = (tx, ty) => api.debugPatchTile(tx, ty, {
  kind: "air", oreId: null, veinId: null, hp: 0, maxHp: 0,
});
const ore = (tx, ty, oreId, veinId, hp = 1) => api.debugPatchTile(tx, ty, {
  kind: "ore", oreId, veinId, hp, maxHp: hp, discovered: true,
});

api.debugResetProgress();
assert.equal(api.getRunModeStatus().unlocked, false);
assert.equal(api.getRunModeStatus().mode, "descent");
assert.equal(api.setRunMode("harvest"), false, "a clean save keeps the first shift simple");
api.setUpgradeLevel("core_first_descent", 1);
assert.equal(api.setRunMode("invalid"), false);
assert.equal(api.setRunMode("harvest"), true);
assert.ok([...localData.values()].some((text) => text.includes('"runMode":"harvest"')), "the workshop choice is saved");

function modeFixture(mode) {
  api.debugResetProgress();
  api.setUpgradeLevel("core_first_descent", 1);
  api.setUpgradeLevel("sense_instinct_spark", 6);
  assert.equal(api.setRunMode(mode), true);
  api.startRun({ seed: "mode-tradeoff", sectorId: "stable_strata" });
  api.debugScheduleGlobalEvent();
  assert.equal(api.setRunMode(mode === "harvest" ? "descent" : "harvest"), false, "the shift fixes its mode");
  assert.equal(api.getRunModeStatus().mode, mode);
  api.debugSetPlayerTile(40, 20);
  for (let y = 7; y <= 39; y += 1) for (let x = 26; x <= 54; x += 1) clearTile(x, y);
  ore(40, 26, "copper", "deep-single");
  for (let x = 46; x <= 49; x += 1) ore(x, 20, "copper", "wide-seam");
  const first = api.acquireTargets().primary;
  api.stepRun(2.6);
  const snapshot = api.getSnapshot();
  const result = { first, ore: snapshot.runOre, depth: snapshot.deepest };
  api.finishRun();
  return result;
}

const descent = modeFixture("descent");
const harvest = modeFixture("harvest");
assert.deepEqual(descent.first, { tx: 40, ty: 26 }, "passage values the deeper target");
assert.deepEqual(harvest.first, { tx: 46, ty: 20 }, "harvest invests in the lateral seam");
assert.ok(harvest.ore > descent.ore, `harvest must earn its benefit through actual mining: ${JSON.stringify({ descent, harvest })}`);
assert.ok(descent.depth > harvest.depth, `passage must deliver actual depth: ${JSON.stringify({ descent, harvest })}`);

// A late record must not strand focused harvesting inside the hardest floor.
// The choice only selects an existing lift station; deep ore stays natural.
api.debugResetProgress();
api.setAllUpgrades(true);
api.setUpgradeLevel("core_bon_voyage", 0);
for (const definition of ORE_TYPES) api.grantOre(definition.id, 1);
api.setBestDepth(2010);
api.setFocusedOre("void_ore");
api.setRunMode("descent");
const landingSeed = "campaign-17-405";
api.startRun({ seed: landingSeed });
const recordLanding = api.getSnapshot().liftDepth;
assert.ok(recordLanding > 1900, "passage retains its record landing even with ore focus");
api.finishRun();
const naturalWorld = new MineWorld(ORE_TYPES, landingSeed);
const naturalDeepOre = [];
naturalWorld.forEachOreTileInBounds(0, 0, 87, 419, (tile, tx, ty) => {
  if (ORE_TYPES.find((type) => type.id === tile.oreId).tier >= 4) naturalDeepOre.push(`${tx}:${ty}:${tile.oreId}`);
});
api.setRunMode("harvest");
for (const [oreId, expectedLanding] of [["prism_crystal", 850], ["void_ore", 925], ["star_core", 1275]]) {
  api.openUpgrades();
  const focusClickHandlers = elementFor("#oreFocusChoices").listeners.get("click") || [];
  assert.ok(focusClickHandlers.length, "the workshop must bind its actual focus click handler");
  const focusChoice = { dataset: { focusOre: oreId } };
  for (const handler of focusClickHandlers) handler({
    type: "click",
    target: { closest: (selector) => selector === "[data-focus-ore]" ? focusChoice : null },
  });
  assert.equal(api.getSnapshot().focusedOreId, oreId);
  const plan = api.getRunModeStatus();
  assert.equal(plan.focusedLanding, true);
  assert.equal(plan.plannedLiftDepth, expectedLanding);
  assert.match(plan.description, new RegExp(`~${expectedLanding} м`));
  assert.match(elementFor("#runModeDescription").textContent, new RegExp(`~${expectedLanding} м`), "changing focus must refresh the workshop landing preview immediately");
  api.startRun({ seed: landingSeed });
  assert.equal(api.getSnapshot().liftDepth, expectedLanding, "the saved next mode must override the previous shift's mode during world creation");
  const actualDeepOre = [];
  for (let ty = 0; ty < 420; ty += 1) for (let tx = 0; tx < 88; tx += 1) {
    const tile = api.debugGetTile(tx, ty);
    if (tile?.oreId && ORE_TYPES.find((type) => type.id === tile.oreId).tier >= 4) actualDeepOre.push(`${tx}:${ty}:${tile.oreId}`);
  }
  assert.deepEqual(actualDeepOre.sort(), naturalDeepOre.slice().sort(), "focused landing must not add, move or replace any deep ore node");
  api.finishRun();
}
api.setFocusedOre("void_ore");
api.startRun({ seed: landingSeed });
const harvestLanding = api.getSnapshot().player;
const voidBeforeHarvest = api.getSnapshot().inventory.void_ore;
const landingRandom = Math.random;
try {
  let randomState = 17;
  Math.random = () => {
    randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
    return randomState / 0x100000000;
  };
  api.stepRun(61);
} finally {
  Math.random = landingRandom;
}
assert.equal(api.getSnapshot().mode, "result");
assert.ok(api.getSnapshot().inventory.void_ore > voidBeforeHarvest, "the selected natural layer must actually yield the focused ore");
assert.ok(api.getSnapshot().lastRunReport.travelMeters > 25, "harvesting must leave the landing and work the natural mine");
assert.notDeepEqual(api.getSnapshot().player, harvestLanding);
api.setFocusedOre(null);
assert.equal(api.getRunModeStatus().focusedLanding, false);
api.startRun({ seed: landingSeed });
assert.equal(api.getSnapshot().liftDepth, recordLanding, "removing focus restores the record landing");
api.finishRun();
api.setFocusedOre("void_ore");
api.setRunMode("descent");
api.startRun({ seed: landingSeed });
assert.equal(api.getSnapshot().liftDepth, recordLanding, "switching back to passage must not inherit the previous harvest landing");
api.finishRun();
api.setRunMode("harvest");
api.setUpgradeLevel("sense_ore_focus", 0);
assert.equal(api.getRunModeStatus().focusedLanding, false, "a saved ore preference cannot act without its focus module");
api.setUpgradeLevel("sense_ore_focus", 1);
api.setUpgradeLevel("dig_mine_lift", 0);
assert.equal(api.getRunModeStatus().plannedLiftDepth, 0, "the harvest choice cannot create a lift");
api.setUpgradeLevel("dig_mine_lift", 3);
api.setUpgradeLevel("core_bon_voyage", 1);
assert.equal(api.getRunModeStatus().focusedLanding, false);
api.startRun({ seed: landingSeed });
assert.equal(api.getSnapshot().liftDepth, recordLanding, "the final expedition always resumes its deep record route");
assert.equal(api.getRunModeStatus().mode, "descent");
api.finishRun();

// Both strategies share physical restrictions and finish the seam they hit.
for (const mode of ["descent", "harvest"]) {
  api.debugResetProgress();
  api.setUpgradeLevel("core_first_descent", 1);
  api.setRunMode(mode);
  api.startRun({ seed: "mode-lock", sectorId: "stable_strata" });
  api.debugScheduleGlobalEvent();
  api.debugSetPlayerTile(40, 20);
  for (let y = 17; y <= 24; y += 1) for (let x = 37; x <= 44; x += 1) clearTile(x, y);
  ore(41, 20, "copper", "engaged", 100);
  ore(42, 20, "copper", "engaged", 100);
  ore(40, 22, "copper", "deeper-temptation", 1);
  api.debugSetTargetTile(41, 20);
  api.attackNow();
  assert.equal(api.getSnapshot().engagedVeinId, "engaged");
  const target = api.acquireTargets().primary;
  assert.equal(api.debugGetTile(target.tx, target.ty).veinId, "engaged");
  assert.ok(target.ty >= api.debugGetActiveDepthFloorTy());
  const intent = api.debugGetRunIntent();
  assert.equal(intent.text, "Добирает жилу");
  assert.deepEqual([intent.point.x, intent.point.y], [41.5 * 28, 20.5 * 28], "the lamp follows the actual tool contact");
  api.debugSetAttackCooldown(10);
  api.stepRun(0.01);
  assert.match(elementFor("#runIntent").textContent, /Добирает жилу/);
  api.stepRun(2);
  assert.ok(elementFor("#runIntent").classList.contains("hidden"), "unchanged ordinary intentions fade instead of occupying the HUD");
  api.setUpgradeLevel("sense_ore_focus", 1);
  api.setFocusedOre("iron");
  ore(40, 21, "iron", "focused-iron");
  const focusedTarget = api.acquireTargets().primary;
  assert.equal(api.debugGetTile(focusedTarget.tx, focusedTarget.ty).oreId, "iron", "both modes obey the same ore focus");
  api.finishRun();
}

api.debugResetProgress();
api.setUpgradeLevel("core_first_descent", 1);
api.setUpgradeLevel("fortune_rich_vein", 5);
api.startRun({ seed: "special-vein-intent", sectorId: "stable_strata" });
api.debugScheduleGlobalEvent();
api.debugSetPlayerTile(40, 20);
ore(41, 20, "copper", "special-readable");
ore(42, 20, "copper", "special-readable");
const originalRandom = Math.random;
try {
  Math.random = () => 0;
  api.debugBreakTileWithSource(41, 20, "pick");
} finally {
  Math.random = originalRandom;
}
api.debugSetTargetTile(42, 20);
assert.match(api.debugGetRunIntent().text, /Богатая жила · осталось 1/);
assert.equal(api.debugGetRunIntent().persistent, true);
api.debugBreakTileWithSource(42, 20, "pick");
assert.match(api.debugGetRunIntent().text, /Богатая жила завершена/);
api.finishRun();

api.debugResetProgress();
api.setUpgradeLevel("core_first_descent", 1);
api.setUpgradeLevel("tools_iron_pick", 1);
api.debugSetSelectedUpgrade("sense_instinct_spark");
const firstSupplyPreferences = api.debugGetLiftResupplyPreferences(9);
api.debugSetSelectedUpgrade("tools_steel_pick");
assert.deepEqual(api.debugGetLiftResupplyPreferences(9), firstSupplyPreferences, "hovering or selecting a recipe must never tune supplies");
assert.ok(firstSupplyPreferences.every((id) => ORE_TYPES.find((type) => type.id === id).tier <= 3));
const supplyWorld = new MineWorld(ORE_TYPES, "bounded-station", { sectorId: "stable_strata" });
const countOre = () => {
  let count = 0;
  supplyWorld.forEachOreTileInBounds(0, 0, 87, 419, () => { count += 1; });
  return count;
};
const beforeSupply = countOre();
const station = supplyWorld.getLiftStart(800, 0.95, 800, { unlockedTierCap: 9 });
const supply = supplyWorld.retuneLiftTarget(station, ["star_core", "gold", "amber"]);
assert.equal(supply.oreId, "amber", "explicit late requests must not put deep ore at a station");
assert.equal(countOre(), beforeSupply, "the support remains a relocated node");

const eventWorld = new MineWorld(ORE_TYPES, "sealed-world", { sectorId: "stable_strata" });
const event = eventWorld.getMicroEvents()[0];
assert.equal(event.state, "sealed");
assert.equal(eventWorld.triggerMicroEvent(event.id), null);
assert.equal(eventWorld.consumeMicroEvent(event.id), null);
const neighbor = [[1, 0], [-1, 0], [0, 1], [0, -1]].find(([x, y]) => eventWorld.getTile(event.tx + x, event.ty + y)?.kind !== "air");
if (neighbor) eventWorld.breakTile(event.tx + neighbor[0], event.ty + neighbor[1]);
assert.equal(eventWorld.triggerMicroEvent(event.id), null, "breaking nearby rock cannot open the container");
eventWorld.damageTile(event.tx, event.ty, eventWorld.getTile(event.tx, event.ty).hp * 0.25);
assert.equal(eventWorld.getMicroEvents()[0].state, "opening");
eventWorld.breakTile(event.tx, event.ty);
assert.equal(eventWorld.getMicroEvents()[0].state, "opened");
assert.deepEqual(eventWorld.triggerMicroEvent(event.id).loot, event.loot, "working the seal does not inflate loot");
assert.ok(eventWorld.consumeMicroEvent(event.id));
assert.equal(eventWorld.consumeMicroEvent(event.id), null, "contents can be collected once");

api.debugResetProgress();
api.setUpgradeLevel("core_first_descent", 1);
api.setUpgradeLevel("time_extra_breath", 8);
api.startRun({ seed: "sealed-runtime", sectorId: "stable_strata" });
api.debugScheduleGlobalEvent();
const chest = api.debugGetMicroEvents()[0];
api.debugPatchTile(chest.tx, chest.ty, { hp: 1, maxHp: 1 });
api.debugSetPlayerTile(chest.tx - 3, chest.ty);
ore(chest.tx - 2, chest.ty, "copper", "chest-neighbor-seam", 100);
ore(chest.tx - 2, chest.ty + 1, "copper", "chest-neighbor-seam", 100);
api.debugSetTargetTile(chest.tx - 2, chest.ty);
api.attackNow();
assert.equal(api.debugGetPriorityChestTarget(), null, "a discovered container waits for the engaged seam");
api.debugBreakTileWithSource(chest.tx - 2, chest.ty, "pick");
api.debugBreakTileWithSource(chest.tx - 2, chest.ty + 1, "pick");
api.debugSetPlayerTile(chest.tx - 1, chest.ty);
assert.ok(api.debugGetPriorityChestTarget(), "an affordable ordinary chest can be chosen");
assert.equal(api.debugTriggerMicroEvent("ancient_container"), false);
const chestLootBefore = api.getSnapshot().runOre;
api.debugSetAttackCooldown(10);
api.stepRun(0.05);
assert.equal(api.getSnapshot().runOre, chestLootBefore, "standing beside a container cannot award it");
api.debugBreakTileWithSource(chest.tx, chest.ty, "pick");
assert.equal(api.getSnapshot().metrics.microEvents.ancient_container, 1, "actual host destruction awards one chest");
api.finishRun();

api.startRun({ seed: "focused-chest", sectorId: "stable_strata" });
api.debugScheduleGlobalEvent();
const focusedChest = api.debugGetMicroEvents()[0];
api.debugSetPlayerTile(focusedChest.tx - 1, focusedChest.ty);
api.debugPatchTile(focusedChest.tx, focusedChest.ty, { hp: 1, maxHp: 1 });
api.setUpgradeLevel("sense_ore_focus", 1);
const unrelatedOre = ORE_TYPES.find((type) => !(focusedChest.loot[type.id] > 0));
api.setFocusedOre(unrelatedOre.id);
assert.equal(api.debugGetPriorityChestTarget(), null, "unrelated treasure cannot override focus");
api.setFocusedOre(null);
api.setUpgradeLevel("core_bon_voyage", 1);
assert.equal(api.debugGetPriorityChestTarget(), null, "the solar approach ignores treasure");
api.finishRun();

console.log(JSON.stringify({ ok: true, tradeoff: { descent, harvest }, checks: ["saved-fixed-modes", "actual-harvest-depth-tradeoff", "focused-natural-landing", "live-workshop-landing-preview", "unchanged-natural-deep-ore", "harvest-actually-mines-and-travels", "record-and-finale-landing", "vein-lock", "intent-contact", "bounded-supply", "sealed-container", "focus-finale-priority"] }));
