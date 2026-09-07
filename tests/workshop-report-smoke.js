"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const harness = require("./helpers/runtime-harness.js");
let api = harness.api;
const { elementFor, localData } = harness;
const saveKey = "depth-zero-save-v1";

api.debugResetProgress();
api.setUpgradeLevel("core_first_descent", 1);
api.setUpgradeLevel("gadgets_powder_pocket", 1);
api.setUpgradeLevel("sense_echo_pulse", 1);
for (const ore of global.DepthZeroUpgrades.ORE_TYPES) api.grantOre(ore.id, 1000);
api.openUpgrades();
assert.equal(api.buyUpgrade("gadgets_scout_drone"), true);
assert.deepEqual(JSON.parse(localData.get(saveKey)).pendingUpgradeChanges.gadgets_scout_drone, { from: 0, to: 1 });

// A pending purchase must survive a real runtime reload before its first run.
const modulePath = require.resolve(path.join(__dirname, "..", "js", "game.js"));
delete require.cache[modulePath];
require(modulePath);
api = global.__DEPTH_ZERO__;
api.startRun({ seed: "new-drone-contribution" });
api.debugPatchTile(65, 20, { kind: "stone", hp: 1, maxHp: 1, oreId: "copper", veinId: "report-drone", discovered: true });
assert.equal(api.debugBreakTileWithSource(65, 20, "drone"), true);
api.finishRun();
let report = api.getSnapshot().lastRunReport;
let drone = report.contributions.find((entry) => entry.id === "gadgets_scout_drone");
assert.ok(drone, "the first shift should report the newly purchased drone");
assert.equal(drone.blocks, 1);
assert.equal(drone.ore, report.sourceOre.drone);
assert.ok(drone.ore >= 1);
assert.match(drone.text, /Разрушено блоков: 1/);
assert.match(elementFor("#reportHighlights").innerHTML, /Дрон-разведчик/);
assert.deepEqual(JSON.parse(localData.get(saveKey)).pendingUpgradeChanges, {});

api.startRun({ seed: "old-drone-no-new-purchase" });
api.finishRun();
assert.equal(api.getSnapshot().lastRunReport.contributions.length, 0, "an old upgrade must not be advertised as newly bought again");

// Several ranks bought together describe the actual purchased interval.
api.openUpgrades();
assert.equal(api.buyUpgrade("gadgets_drone_battery"), true);
assert.equal(api.buyUpgrade("gadgets_drone_battery"), true);
assert.deepEqual(JSON.parse(localData.get(saveKey)).pendingUpgradeChanges.gadgets_drone_battery, { from: 0, to: 2 });
api.startRun({ seed: "drone-battery-multiple-ranks" });
api.finishRun();
const battery = api.getSnapshot().lastRunReport.contributions.find((entry) => entry.id === "gadgets_drone_battery");
assert.equal(battery.from, 0);
assert.equal(battery.to, 2);
assert.ok(battery.summary.some((line) => line.includes("→")));

// Scalar changes show statistics, not a made-up causal haul percentage.
api.openUpgrades();
assert.equal(api.buyUpgrade("power_sharpened_edge"), true);
api.startRun({ seed: "scalar-contribution" });
api.finishRun();
const scalar = api.getSnapshot().lastRunReport.contributions.find((entry) => entry.id === "power_sharpened_edge");
assert.equal(scalar.measured, false);
assert.match(scalar.text, /Сила инструмента/);
assert.match(scalar.text, /→/);

// The workshop's persistent launch control starts a run directly.
api.openUpgrades();
elementFor("#workshopStartRun").click();
assert.equal(api.getSnapshot().mode, "run");
assert.equal(elementFor("#upgradeScreen").classList.contains("hidden"), true);
api.finishRun();

// Resetting progress cannot carry a previously bought module into a new report.
api.debugResetProgress();
api.grantOre("copper", 10);
api.openUpgrades();
assert.equal(api.buyUpgrade("core_first_descent"), true);
api.setAllUpgrades(false);
api.startRun({ seed: "reset-pending-upgrade" });
api.finishRun();
assert.deepEqual(api.getSnapshot().lastRunReport.contributions, []);

// Earned tutorials remain inside the scrollable report, leaving launch controls accessible.
assert.equal(elementFor("#tutorialCoach").parentElement, elementFor("#resultTutorialSlot"));
assert.equal(elementFor("#tutorialCoach").getAttribute("role"), "region");
assert.equal(elementFor("#tutorialCoach").getAttribute("aria-modal"), "false");

function previewFirstRank(id) {
  api.debugResetProgress();
  const definitions = global.DepthZeroUpgrades.UPGRADE_DEFS;
  const prepare = (targetId) => {
    const definition = definitions.find((entry) => entry.id === targetId);
    for (const requirement of definition.requires || []) {
      const parentId = typeof requirement === "string" ? requirement : requirement.id;
      const parentRank = typeof requirement === "string" ? 1 : requirement.level || 1;
      prepare(parentId);
      const currentRank = api.getUpgradeCatalog().find((entry) => entry.id === parentId).level;
      api.setUpgradeLevel(parentId, Math.max(currentRank, parentRank));
    }
  };
  prepare(id);
  global.innerWidth = 390;
  api.openUpgrades();
  const node = { dataset: { upgradeId: id, buyUpgrade: id } };
  const target = { closest: (selector) => ['[data-buy-upgrade]', '[data-upgrade-id]'].includes(selector) ? node : null };
  elementFor('#upgradeGrid').listeners.get('click').at(-1)({ target, shiftKey: false });
  return elementFor('#upgradeBenefit').innerHTML;
}

assert.match(previewFirstRank('tools_super_pick'), /Ударов за взмах: 1 → 2/);
assert.match(elementFor('#upgradeBenefit').innerHTML, /Сила инструмента/);
assert.match(previewFirstRank('dig_quarry_presence'), /движение: 0% → 25%/);
assert.match(elementFor('#upgradeBenefit').innerHTML, /копка: 0% → 25%/);
assert.match(previewFirstRank('dig_wall_bite'), /Открывается площадная копка/);
assert.match(previewFirstRank('sense_deep_resonance'), /16,67%/);
assert.doesNotMatch(previewFirstRank('power_tempered_steel'), /Пробивание плотности: [^<]*%/);

console.log(JSON.stringify({ ok: true, checked: ["purchase-report-reload", "actual-source-yield", "one-time-new-upgrade", "multi-rank-summary", "scalar-summary", "workshop-direct-launch", "reset-pending", "inline-report-tutorial", "key-upgrade-mobile-benefits"] }));
