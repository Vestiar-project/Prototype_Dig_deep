"use strict";

const assert = require("node:assert/strict");
const harness = require("./helpers/runtime-harness.js");
const { elementFor, localData } = harness;
let api = harness.api;
const definitions = global.DepthZeroUpgrades.UPGRADE_DEFS;
const saveKey = "depth-zero-save-v1";
const nodes = elementFor("#upgradeNodes");
nodes.querySelectorAll = (selector) => selector === "[data-upgrade-id]" ? nodes.children : [];
nodes.querySelector = (selector) => {
  const id = selector.match(/data-upgrade-id="([^"]+)"/)?.[1];
  const node = nodes.children.find((entry) => entry.dataset.upgradeId === id);
  if (node) node.focus = () => { document.activeElement = node; };
  return node || null;
};

const selected = () => elementFor("#buySelectedUpgrade").dataset.upgradeId;
const rank = (id) => api.getUpgradeCatalog().find((entry) => entry.id === id).level;
const count = (selector) => Number(elementFor(selector).textContent.match(/· (\d+)/)?.[1]);
const click = (selector) => elementFor(selector).listeners.get("click").at(-1)({ target: elementFor(selector) });
function nodeEvent(type, id, extra = {}) {
  const node = { dataset: { upgradeId: id, buyUpgrade: id } };
  const target = { closest: (selector) => ["[data-upgrade-id]", "[data-buy-upgrade]"].includes(selector) ? node : null };
  for (const listener of elementFor("#upgradeGrid").listeners.get(type) || []) listener({ type, target, ...extra });
}
function jump(selector, id) {
  const target = { dataset: { jumpUpgrade: id }, closest: () => target };
  elementFor(selector).listeners.get("click").at(-1)({ target });
}
function grantBudget() {
  for (const ore of global.DepthZeroUpgrades.ORE_TYPES) api.grantOre(ore.id, 1_000_000);
}

api.debugResetProgress();
grantBudget();
api.openUpgrades();
const initialInventory = api.getSnapshot().inventory;
assert.equal(count("#upgradeAffordableNext"), 1, "only the root is ready before the first purchase");
for (const width of [1280, 390, 320]) {
  global.innerWidth = width;
  nodeEvent("click", "core_first_descent", { shiftKey: true });
  assert.equal(rank("core_first_descent"), 0, `a ${width}px card, including Shift, only selects`);
  assert.deepEqual(api.getSnapshot().inventory, initialInventory);
  assert.equal(selected(), "core_first_descent");
  nodeEvent("pointerover", "time_extra_breath");
  nodeEvent("focusin", "time_extra_breath");
  assert.equal(selected(), "core_first_descent", "moving the pointer or keyboard focus must preserve the purchase target");
}
global.innerWidth = 1280;
click("#buySelectedUpgrade");
assert.equal(rank("core_first_descent"), 1);
assert.equal(selected(), "core_first_descent", "finishing a module must keep its description and purchase target pinned");
assert.equal(elementFor("#buySelectedUpgrade").disabled, true);
assert.equal(count("#upgradeAffordableNext"), 0, "freshly opened children still require one completed shift");

// Availability navigation respects both the ore price and workshop preparation.
api.startRun({ seed: "tree-preparation-shift" });
api.finishRun();
api.openUpgrades();
const affordable = api.getUpgradeCatalog().filter((entry) => entry.available && entry.affordable).map((entry) => entry.id);
assert.ok(affordable.length > 2);
assert.equal(count("#upgradeAffordableNext"), affordable.length);
const visitedAffordable = [];
for (let i = 0; i < affordable.length; i += 1) {
  click("#upgradeAffordableNext");
  visitedAffordable.push(selected());
  assert.ok(affordable.includes(selected()));
}
assert.equal(new Set(visitedAffordable).size, affordable.length, "successive presses reach every affordable, prepared card");
click("#upgradeAffordableNext");
assert.equal(selected(), visitedAffordable[0], "the affordable navigation wraps without purchasing");
nodeEvent("click", "time_extra_breath", { detail: 0 });
assert.equal(rank("time_extra_breath"), 0, "native keyboard card activation is selection only");
click("#buyMaxSelectedUpgrade");
assert.equal(rank("time_extra_breath"), definitions.find((entry) => entry.id === "time_extra_breath").maxLevel);
assert.equal(selected(), "time_extra_breath");

// New means unviewed: redraws, search, reopening and reload cannot consume it.
api.debugResetProgress();
api.openUpgrades();
const initialNew = count("#upgradeNewNext");
assert.ok(initialNew > 1);
api.openUpgrades();
api.grantOre("copper", 1);
assert.equal(count("#upgradeNewNext"), initialNew);
nodeEvent("click", "core_first_descent");
const unreadAfterRoot = count("#upgradeNewNext");
assert.equal(unreadAfterRoot, initialNew - 1);
api.openUpgrades();
assert.equal(count("#upgradeNewNext"), unreadAfterRoot);
assert.ok(JSON.parse(localData.get(saveKey)).viewedUpgradeIds.includes("core_first_descent"));
delete require.cache[require.resolve("../js/game.js")];
require("../js/game.js");
api = global.__DEPTH_ZERO__;
api.openUpgrades();
assert.equal(count("#upgradeNewNext"), unreadAfterRoot, "viewed markers survive a real runtime reload");
const viewedNew = new Set();
for (let left = unreadAfterRoot; left > 0; left -= 1) {
  click("#upgradeNewNext");
  assert.equal(count("#upgradeNewNext"), left - 1);
  assert.equal(viewedNew.has(selected()), false);
  viewedNew.add(selected());
}
assert.equal(elementFor("#upgradeNewNext").disabled, true);

// A locked card links to the exact missing parent/rank, not a suggested recipe.
api.debugResetProgress();
api.setUpgradeLevel("core_first_descent", 1);
api.setFocusedOre("coal");
api.openUpgrades();
nodeEvent("click", "tools_iron_pick");
assert.match(elementFor("#upgradeRequirements").innerHTML, /data-jump-upgrade="tools_balanced_handle"/);
const beforeParentJump = api.getSnapshot();
jump("#upgradeRequirements", "tools_balanced_handle");
assert.equal(selected(), "tools_balanced_handle");
assert.equal(document.activeElement.dataset.upgradeId, "tools_balanced_handle", "a removed requirement button transfers keyboard focus to its destination");
assert.deepEqual(api.getSnapshot().inventory, beforeParentJump.inventory);
assert.equal(api.getSnapshot().focusedOreId, "coal", "tree navigation never becomes a gameplay ore focus");

// Nearest major technology follows the actual installed prerequisite path.
assert.match(elementFor("#upgradeMilestoneSummary").textContent, /Карман пороха/);
api.setUpgradeLevel("gadgets_powder_pocket", 1);
assert.match(elementFor("#upgradeMilestoneSummary").textContent, /Железная кирка/);
assert.match(elementFor("#upgradeMilestoneContent").innerHTML, /рангов — 2/);
api.setUpgradeLevel("tools_balanced_handle", 1);
assert.match(elementFor("#upgradeMilestoneContent").innerHTML, /рангов — 1/);
api.setUpgradeLevel("tools_iron_pick", 1);
api.setUpgradeLevel("power_tempered_steel", 1);
assert.match(elementFor("#upgradeMilestoneSummary").textContent, /Стальная кирка/);
assert.match(elementFor("#upgradeMilestoneContent").innerHTML, /рангов — 1/);

// Late goals name all seven real requirements. Even a still-hidden capstone
// leads to the currently visible part of its own prerequisite branch.
api.setBestDepth(1200);
api.grantOre("copper", 0);
const finalDefinition = definitions.find((entry) => entry.id === "core_bon_voyage");
assert.match(elementFor("#upgradeMilestoneSummary").textContent, /0\/7 компонентов/);
const solarMarkup = elementFor("#upgradeMilestoneContent").innerHTML;
assert.equal((solarMarkup.match(/data-jump-upgrade=/g) || []).length, 7);
function ancestorIds(id, result = new Set()) {
  if (result.has(id)) return result;
  result.add(id);
  for (const req of definitions.find((entry) => entry.id === id).requires) ancestorIds(typeof req === "string" ? req : req.id, result);
  return result;
}
for (const id of finalDefinition.requires) {
  const part = definitions.find((entry) => entry.id === id);
  assert.ok(solarMarkup.includes(part.name));
  jump("#upgradeMilestoneContent", id);
  assert.ok(ancestorIds(id).has(selected()), `${id} must lead into its own actual prerequisite path`);
}
assert.equal(api.getSnapshot().focusedOreId, "coal");
api.setUpgradeLevel(finalDefinition.requires[0], 1);
assert.match(elementFor("#upgradeMilestoneSummary").textContent, /1\/7 компонентов/);

console.log(JSON.stringify({ ok: true, checked: ["explicit-purchase-all-widths", "stable-hover-focus-max", "affordable-ready-cycle", "unread-persistence-reload", "parent-keyboard-navigation", "actual-prerequisite-milestone", "seven-solar-branch-links", "no-gameplay-focus-mutation"] }));
