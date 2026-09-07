"use strict";

const assert = require("node:assert/strict");
const { api, elementFor } = require("./helpers/runtime-harness.js");
const { UPGRADE_DEFS, ORE_TYPES } = global.DepthZeroUpgrades;
const { FINAL_LAYER_TY } = global.DepthZeroWorld;
const definitions = new Map(UPGRADE_DEFS.map((definition) => [definition.id, definition]));
const minimumLevels = new Map();

function requireLevel(id, level = 1) {
  if ((minimumLevels.get(id) || 0) >= level) return;
  minimumLevels.set(id, level);
  for (const requirement of definitions.get(id).requires) {
    requireLevel(
      typeof requirement === "string" ? requirement : requirement.id,
      typeof requirement === "string" ? 1 : requirement.level || 1,
    );
  }
}
requireLevel("core_bon_voyage");

function startMinimumFinale(seed, bestDepth = 1600, sectorId) {
  api.debugResetProgress();
  let randomState = 0x91f34;
  Math.random = () => {
    randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
    return randomState / 0x100000000;
  };
  for (const [id, level] of minimumLevels) api.setUpgradeLevel(id, level);
  for (const ore of ORE_TYPES) api.grantOre(ore.id, 1);
  api.setBestDepth(bestDepth);
  api.setCompletedRuns(150);
  api.debugSetEventPity(5, 8);
  api.setFocusedOre("copper");
  api.startRun({ seed, sectorId });
  assert.equal(api.getSnapshot().timeLeft, 60, "the first final expedition starts with a full sixty-second charge");
  assert.equal(api.getStats().runDuration, 45, "the special final charge does not alter permanent timer upgrades");
  return api.getSnapshot();
}

function clearTile(tx, ty) {
  api.debugPatchTile(tx, ty, { kind: "air", oreId: null, veinId: null, hp: 0, maxHp: 0 });
}

// Independent seeded geometry, including the sparse and rich authored sectors.
// No optional damage levels, random buying heuristic or debug teleport is used.
const journeys = [];
for (const [seed, sectorId] of [
  [17], [43], [73], [137], [211], [353],
  [419, "stable_strata"], [457, "ore_ridge"], [509, "cavern_karst"],
]) {
  const initial = startMinimumFinale(`solar-final-minimum-${seed}`, 1600, sectorId);
  const stages = [];
  let lastStage = 0;
  while (api.getSnapshot().mode === "run" && api.getSnapshot().activeWallElapsed < 61) {
    api.stepRun(0.1);
    const snapshot = api.getSnapshot();
    if (snapshot.solarFinale.sealHits !== lastStage) {
      lastStage = snapshot.solarFinale.sealHits;
      stages.push({ hits: lastStage, at: snapshot.activeWallElapsed });
    }
    if (snapshot.mode === "run") assert.equal(snapshot.target?.kind, "final_seal", "ore focus and events must never replace the final route");
  }
  const final = api.getSnapshot();
  assert.equal(final.mode, "ending", `seed ${seed}: the minimum legitimate build must reach the ending in one expedition`);
  assert.ok(final.activeWallElapsed <= 60, `seed ${seed}: the ordinary final route must fit its charge`);
  assert.ok(final.activeWallElapsed > 20, `seed ${seed}: keep the physical final tunnel rather than teleporting to the seal`);
  assert.ok(final.lastRunReport.travelMeters > 350, `seed ${seed}: preserve the remaining journey from the actual lift frontier`);
  assert.ok(initial.liftDepth <= 1600 && initial.liftDepth >= 1500, "the final tool does not skip unexplored depth");
  assert.deepEqual(stages.map((stage) => stage.hits), [1, 2, 3], "show each completed seal stage separately");
  assert.ok(stages[1].at - stages[0].at >= 1.4 && stages[2].at - stages[1].at >= 1.4, "even fast fire must leave readable seal stages");
  assert.ok(final.activeWallElapsed - stages[2].at >= 0.7, "show the third fracture in the mine before the comic replaces it");
  assert.ok(final.solarFinale.meltedBlocks > 0, "the powerful local excavation must actually be used");
  assert.equal(final.metrics.eventCount, 0, "neither event pity nor global events may interrupt the final expedition");
  assert.equal(final.campaign.ready, true);
  assert.equal(elementFor("#endingScreen").classList.contains("hidden"), false, "the breach opens the epilogue automatically");
  journeys.push({ seed, sectorId: sectorId || "procedural", seconds: Number(final.activeWallElapsed.toFixed(2)), melted: final.solarFinale.meltedBlocks });
}

// The melt is tied to the completed local contact, does not farm ore, and
// cannot touch either a distant fixture or the indestructible seal remotely.
api.debugResetProgress();
api.setUpgradeLevel("tools_laser_emitter", 1);
api.setUpgradeLevel("core_bon_voyage", 1);
api.startRun({ seed: "solar-melt-no-procs" });
api.debugSetPlayerTile(40, 20);
for (let ty = 16; ty <= 25; ty += 1) {
  for (let tx = 39; tx <= 49; tx += 1) clearTile(tx, ty);
}
api.debugPatchTile(44, 20, { kind: "stone", oreId: "star_core", veinId: "solar-test-vein", hp: 1e9, maxHp: 1e9 });
api.debugPatchTile(44, 22, { kind: "stone", oreId: null, veinId: null, hp: 1e9, maxHp: 1e9 });
api.debugPatchTile(49, 20, { kind: "stone", oreId: null, veinId: null, hp: 1e9, maxHp: 1e9 });
assert.equal(api.debugSetTargetTile(44, 20), true);
for (let shot = 0; shot < 5; shot += 1) api.attackNow();
const beforeMelt = api.getSnapshot();
api.debugSetAttackCooldown(100);
api.stepRun(0.6);
assert.notEqual(api.debugGetTile(44, 22).kind, "air", "the hold must visibly finish before its terrain melts");
api.stepRun(0.2);
const afterMelt = api.getSnapshot();
assert.equal(api.debugGetTile(44, 20).kind, "air", "ore obstructing the tunnel also melts regardless of HP");
assert.equal(api.debugGetTile(44, 22).kind, "air");
assert.notEqual(api.debugGetTile(49, 20).kind, "air", "melt radius stays local to the real beam contact");
assert.equal(api.debugGetTile(44, FINAL_LAYER_TY).kind, "final_seal", "a far-away pulse cannot damage the seal");
assert.equal(afterMelt.runOre, beforeMelt.runOre, "melted ore grants no harvested chunks");
assert.equal(afterMelt.bonusTimeEarned, beforeMelt.bonusTimeEarned, "melt must not grant time procs");
assert.equal(afterMelt.motherlodeBreaks, beforeMelt.motherlodeBreaks, "melt must not advance motherlode rewards");

// Zero energy can finish an already-held terrain pulse, but it cannot buy
// more travel or another shot. The charge is not an unlimited overtime mode.
api.debugResetProgress();
api.setUpgradeLevel("tools_laser_emitter", 1);
api.setUpgradeLevel("core_bon_voyage", 1);
api.startRun({ seed: "solar-last-terrain-pulse" });
api.debugSetAttackCooldown(100);
api.stepRun(59.8);
api.debugSetPlayerTile(40, 20);
for (let ty = 18; ty <= 24; ty += 1) {
  for (let tx = 39; tx <= 48; tx += 1) clearTile(tx, ty);
}
api.debugPatchTile(44, 20, { kind: "stone", oreId: "star_core", veinId: "last-solar-vein", hp: 1e9, maxHp: 1e9 });
api.debugSetTargetTile(44, 20);
for (let shot = 0; shot < 5; shot += 1) api.attackNow();
api.stepRun(0.25);
const atEmptyCharge = api.getSnapshot();
assert.equal(atEmptyCharge.mode, "run", "the held local pulse should still be finishing at zero charge");
api.stepRun(0.6);
const finishedLastPulse = api.getSnapshot();
assert.equal(finishedLastPulse.mode, "result");
assert.equal(api.debugGetTile(44, 20).kind, "air");
assert.deepEqual(finishedLastPulse.player, atEmptyCharge.player, "zero-energy completion adds no movement");
assert.equal(finishedLastPulse.metrics.attacks, atEmptyCharge.metrics.attacks, "zero-energy completion adds no attacks");
assert.ok(finishedLastPulse.activeWallElapsed < 61);

// Begin the close seal sequence just before the charge expires. It must be
// allowed to finish; zero energy must never interrupt an almost-won finale.
startMinimumFinale("solar-seal-boundary");
api.debugSetAttackCooldown(100);
api.stepRun(59.4);
const sealTx = api.getSnapshot().target.tx;
for (let ty = FINAL_LAYER_TY - 4; ty < FINAL_LAYER_TY; ty += 1) {
  for (let tx = sealTx - 1; tx <= sealTx + 1; tx += 1) clearTile(tx, ty);
}
api.debugSetPlayerTile(sealTx, FINAL_LAYER_TY - 1);
for (let shot = 0; shot < 5; shot += 1) api.attackNow();
assert.equal(api.getSnapshot().solarFinale.sealSequenceStarted, true);
api.debugSetAttackCooldown(0);
api.stepRun(8);
const boundary = api.getSnapshot();
assert.equal(boundary.mode, "ending", "an already-started close seal sequence must survive the energy boundary");
assert.equal(boundary.solarFinale.sealHits, 3);
assert.ok(boundary.activeWallElapsed > 60 && boundary.activeWallElapsed < 68, "the completion grace is bounded and only serves the final sequence");

// A third contact can start inside the eight-second seal grace and complete
// just after it. The already-spent pulse must retain its fracture reveal and
// automatically open the epilogue instead of falling through to a lost run.
startMinimumFinale("solar-third-pulse-after-grace");
api.debugSetAttackCooldown(100);
api.stepRun(59.4);
const lateSealTx = api.getSnapshot().target.tx;
for (let ty = FINAL_LAYER_TY - 4; ty < FINAL_LAYER_TY; ty += 1) {
  for (let tx = lateSealTx - 2; tx <= lateSealTx + 2; tx += 1) clearTile(tx, ty);
}
api.debugSetPlayerTile(lateSealTx, FINAL_LAYER_TY - 1);
const fireSealPulse = () => {
  for (let shot = 0; shot < 5; shot += 1) api.attackNow();
};
fireSealPulse();
api.stepRun(0.8);
assert.equal(api.getSnapshot().solarFinale.sealHits, 1);
api.stepRun(3);
fireSealPulse();
api.stepRun(0.8);
assert.equal(api.getSnapshot().solarFinale.sealHits, 2);
api.stepRun(3.5);
assert.ok(api.getSnapshot().activeWallElapsed < 68, "the third pulse must start before the existing grace expires");
fireSealPulse();
for (let frame = 0; frame < 20 && api.getSnapshot().solarFinale.sealHits < 3; frame += 1) api.stepRun(0.05);
const lateFracture = api.getSnapshot();
assert.equal(lateFracture.solarFinale.sealHits, 3);
assert.ok(lateFracture.activeWallElapsed > 68, "the last fracture must exercise the expired-grace branch");
assert.equal(lateFracture.mode, "run", "a completed breach must survive until its reveal finishes");
assert.equal(lateFracture.timeLeft, 0, "the reveal must not replenish the sixty-second charge");
assert.equal(lateFracture.solarFinale.pendingBursts.length, 0);
assert.equal(api.debugGetTile(lateSealTx, FINAL_LAYER_TY).kind, "air");
assert.equal(elementFor("#endingScreen").classList.contains("hidden"), true);
api.stepRun(0.8);
assert.equal(api.getSnapshot().mode, "run", "the third fracture must remain visible for the full 0.85-second scene");
assert.equal(elementFor("#endingScreen").classList.contains("hidden"), true);
api.stepRun(0.1);
const lateEnding = api.getSnapshot();
assert.equal(lateEnding.mode, "ending");
assert.equal(lateEnding.campaign.ready, true);
assert.equal(elementFor("#endingScreen").classList.contains("hidden"), false, "the delayed fracture must open the epilogue automatically");
assert.ok(lateEnding.activeWallElapsed - lateFracture.activeWallElapsed >= 0.85 - 1e-7);
assert.ok(lateEnding.activeWallElapsed - lateFracture.activeWallElapsed < 1);
assert.deepEqual(lateEnding.player, lateFracture.player, "the reveal must add no travel");
assert.equal(lateEnding.metrics.attacks, lateFracture.metrics.attacks, "the reveal must add no attacks");
assert.equal(lateEnding.runOre, lateFracture.runOre, "the reveal must add no mining reward");

// Starting another mine after seeing the ending keeps the normal timer and
// no longer enables the guaranteed local melt: no renewable farming mode.
api.startRun({ seed: "solar-after-ending" });
assert.equal(api.getSnapshot().timeLeft, 45);
assert.equal(api.getSnapshot().solarFinale.active, false);

// Without a started seal sequence, an empty charge must stop the expedition.
startMinimumFinale("solar-no-unbounded-charge");
api.debugSetAttackCooldown(100);
api.stepRun(61);
assert.equal(api.getSnapshot().mode, "result");
assert.equal(api.getSnapshot().solarFinale.sealSequenceStarted, false);

console.log(JSON.stringify({ ok: true, minimumRequiredLevels: [...minimumLevels.values()].reduce((sum, value) => sum + value, 0), journeys, boundaryFinishSeconds: Number(boundary.activeWallElapsed.toFixed(2)), lateBoundaryFinishSeconds: Number(lateEnding.activeWallElapsed.toFixed(2)) }));
