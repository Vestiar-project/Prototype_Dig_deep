"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const harness = require("./helpers/runtime-harness.js");
let api = harness.api;
const { elementFor, localData } = harness;

const observation = {
  runMode: "descent", duration: 30, liftDepth: 1950, depth: 1950,
  newDepth: 0, blocks: 0, haul: 0, searchingSeconds: 20,
  movementSeconds: 2, miningSeconds: 8,
  focusedOreId: "void_ore", focusedOreAmount: 0,
};

api.debugResetProgress();
api.setAllUpgrades(true);
api.setUpgradeLevel("core_bon_voyage", 0);
for (const ore of global.DepthZeroUpgrades.ORE_TYPES) api.grantOre(ore.id, 1);
api.setBestDepth(2000);
api.setFocusedOre("void_ore");
api.setRunMode("descent");
let advice = api.debugGetRunAdvice(observation);
assert.equal(advice.reason, "return-to-layer");
assert.match(advice.text, /925 м/);
assert.equal(advice.action, "settings");
assert.equal(api.getRunModeStatus().mode, "descent", "advice must never change the player's mode");

// Changing the upcoming focus cannot rewrite the observed result or the
// suggested landing of the ore used in that completed shift.
api.setFocusedOre("star_core");
advice = api.debugGetRunAdvice(observation);
assert.match(advice.text, /Пустотная руда/);
assert.match(advice.text, /925 м/);
assert.doesNotMatch(advice.text, /1275/);
assert.equal(api.getSnapshot().focusedOreId, "star_core");

// A successful harvesting shift is not a failed attempt to deepen the mine.
advice = api.debugGetRunAdvice({ ...observation, runMode: "harvest", liftDepth: 925, haul: 7, focusedOreAmount: 7, miningSeconds: 28, searchingSeconds: 0 });
assert.equal(advice.reason, "focused-haul");
assert.match(advice.text, /7/);
assert.doesNotMatch(advice.text, /Усиление инструмента|не добыта/);
assert.equal(api.debugGetRunAdvice({ ...observation, focusedOreId: null, newDepth: 20 }).reason, "new-depth");
assert.match(api.debugGetRunAdvice({ ...observation, runMode: "harvest", focusedOreId: null, newDepth: 20 }).text, /Разработка продвинула маршрут/);
assert.equal(api.debugGetRunAdvice({ ...observation, liftDepth: 925, miningSeconds: 28, searchingSeconds: 0 }).reason, "hard-rock");
assert.equal(api.debugGetRunAdvice({ ...observation, liftDepth: 925 }).reason, "focused-search", "already being in the right layer should not prompt the same return");

// Locked focus/lift cannot produce an impossible return-to-layer suggestion.
api.setUpgradeLevel("dig_mine_lift", 0);
assert.notEqual(api.debugGetRunAdvice(observation).reason, "return-to-layer");

// A complete recipe alone is not proof that a newly revealed module is ready.
api.debugResetProgress();
for (const ore of global.DepthZeroUpgrades.ORE_TYPES) api.grantOre(ore.id, 1000);
api.openUpgrades();
assert.equal(api.buyUpgrade("core_first_descent"), true);
advice = api.debugGetRunAdvice({ ...observation, focusedOreId: null, duration: 6, miningSeconds: 0, searchingSeconds: 0 });
assert.ok(advice.upgradeId);
assert.equal(advice.prepared, false);
assert.match(advice.purchaseText, /ещё готовится/);
assert.doesNotMatch(advice.purchaseText, /уже можно установить/);
api.startRun({ seed: "advice-preparation" });
api.finishRun();
advice = api.debugGetRunAdvice({ ...observation, focusedOreId: null, duration: 6, miningSeconds: 0, searchingSeconds: 0 });
assert.equal(advice.prepared, true);
assert.match(advice.purchaseText, /уже можно установить/);

// Capture the ore choice and its actual haul in the report, then repeat with
// a different setting. No selected recipe or card controls the miner.
api.debugResetProgress();
api.setUpgradeLevel("core_first_descent", 1);
api.setUpgradeLevel("sense_ore_focus", 1);
api.grantOre("copper", 1);
api.grantOre("coal", 1);
api.setFocusedOre("copper");
api.setRunMode("harvest");
api.startRun({ seed: "advice-captured-focus" });
api.debugPatchTile(65, 20, { kind: "ore", hp: 1, maxHp: 1, oreId: "copper", veinId: "advice-haul", discovered: true });
assert.equal(api.debugBreakTileWithSource(65, 20, "pick"), true);
api.finishRun();
const report = api.getSnapshot().lastRunReport;
assert.equal(report.focusedOreId, "copper");
assert.ok(report.focusedOreAmount > 0);
assert.equal(api.debugGetRunAdvice().reason, "focused-haul");
assert.match(elementFor("#nextRunSummary").textContent, /Разработка · Медь/);
elementFor("#reportAdviceAction").click();
assert.equal(api.getSnapshot().mode, "upgrades");
assert.equal(api.getRunModeStatus().mode, "harvest", "opening settings does not accept any recommendation automatically");
api.setFocusedOre("coal");
api.setRunMode("descent");
elementFor("#closeUpgrades").click();
assert.match(elementFor("#nextRunSummary").textContent, /Проходка · Уголь/);
assert.equal(api.getSnapshot().lastRunReport.focusedOreId, "copper");

// The report's observation and upcoming configuration both survive reload.
const modulePath = require.resolve(path.join(__dirname, "..", "js", "game.js"));
delete require.cache[modulePath];
require(modulePath);
api = global.__DEPTH_ZERO__;
assert.equal(api.getSnapshot().lastRunReport.focusedOreId, "copper");
assert.equal(api.getSnapshot().focusedOreId, "coal");
assert.equal(api.getRunModeStatus().mode, "descent");
assert.equal(JSON.parse(localData.get("depth-zero-save-v1")).lastRunReport.focusedOreAmount, report.focusedOreAmount);

console.log(JSON.stringify({ ok: true, checked: ["observed-mode-and-focus", "no-automatic-settings", "honest-preparation", "successful-harvest", "hard-rock-evidence", "valid-layer-advice", "actual-focused-haul", "repeat-summary", "settings-action", "reload"] }));
