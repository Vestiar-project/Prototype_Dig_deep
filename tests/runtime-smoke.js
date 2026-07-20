"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");

class StubClassList {
  constructor() { this.values = new Set(); }
  add(...names) { names.forEach((name) => this.values.add(name)); }
  remove(...names) { names.forEach((name) => this.values.delete(name)); }
  contains(name) { return this.values.has(name); }
  toggle(name, force) {
    const enabled = typeof force === "boolean" ? force : !this.values.has(name);
    if (enabled) this.values.add(name);
    else this.values.delete(name);
    return enabled;
  }
}

class StubStyle {
  constructor() { this.values = new Map(); }
  setProperty(name, value) { this.values.set(name, String(value)); }
  removeProperty(name) { this.values.delete(name); }
}

class StubElement {
  constructor(tagName = "div") {
    this.tagName = tagName.toUpperCase();
    this.classList = new StubClassList();
    this.style = new StubStyle();
    this.dataset = {};
    this.attributes = new Map();
    this.children = [];
    this.parentElement = null;
    this.textContent = "";
    this.innerHTML = "";
    this.value = "";
    this.title = "";
    this.tabIndex = -1;
    this.clientWidth = 1100;
    this.clientHeight = 720;
    this.offsetWidth = 1100;
    this.scrollLeft = 0;
    this.scrollTop = 0;
    this.listeners = new Map();
  }
  append(...children) {
    for (const child of children) {
      if (child && typeof child === "object") child.parentElement = this;
      this.children.push(child);
    }
  }
  replaceChildren(...children) {
    this.children = [];
    this.append(...children);
  }
  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(listener);
  }
  click() {
    for (const listener of this.listeners.get("click") || []) {
      listener({ type: "click", currentTarget: this, target: this });
    }
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  querySelector() { return null; }
  querySelectorAll() { return []; }
  closest() { return null; }
  focus() {}
  scrollTo(options = {}) {
    this.scrollLeft = Number(options.left) || 0;
    this.scrollTop = Number(options.top) || 0;
  }
  getBoundingClientRect() { return { width: 1280, height: 720, left: 0, top: 0 }; }
}

const gradient = { addColorStop() {} };
const context = new Proxy({
  createRadialGradient: () => gradient,
  createLinearGradient: () => gradient,
  measureText: () => ({ width: 0 }),
}, {
  get(target, property) {
    if (property in target) return target[property];
    if (typeof property === "symbol") return target[property];
    return () => {};
  },
  set(target, property, value) {
    target[property] = value;
    return true;
  },
});

const elements = new Map();
function elementFor(selector) {
  if (!elements.has(selector)) elements.set(selector, new StubElement());
  return elements.get(selector);
}

const canvas = new StubElement("canvas");
canvas.getContext = () => context;
elements.set("#gameCanvas", canvas);

const localData = new Map();
// Keep chance-based side effects out of deterministic mechanic assertions.
// The world itself uses its seeded generator, so this does not affect terrain.
Math.random = () => 0.999999;
global.window = global;
global.innerWidth = 1280;
global.innerHeight = 720;
global.devicePixelRatio = 1;
let mobileUpgradeInteraction = false;
global.matchMedia = (query) => ({
  matches: query === '(hover: none) and (pointer: coarse)' ? mobileUpgradeInteraction : false,
  media: query,
  addEventListener() {},
  removeEventListener() {},
});
global.addEventListener = () => {};
global.requestAnimationFrame = () => 0;
global.cancelAnimationFrame = () => {};
global.confirm = () => true;
global.localStorage = {
  getItem: (key) => localData.get(key) ?? null,
  setItem: (key, value) => localData.set(key, String(value)),
  removeItem: (key) => localData.delete(key),
  clear: () => localData.clear(),
};
const documentListeners = new Map();
global.document = {
  hidden: false,
  activeElement: null,
  querySelector: (selector) => elementFor(selector),
  querySelectorAll: () => [],
  createElement: (tagName) => new StubElement(tagName),
  createElementNS: (_namespace, tagName) => new StubElement(tagName),
  createDocumentFragment: () => new StubElement("fragment"),
  addEventListener(type, listener) {
    if (!documentListeners.has(type)) documentListeners.set(type, []);
    documentListeners.get(type).push(listener);
  },
};

function dispatchDocumentEvent(type) {
  for (const listener of documentListeners.get(type) || []) listener({ type, target: document });
}

const root = path.resolve(__dirname, "..");
require(path.join(root, "js", "upgrades.js"));
require(path.join(root, "js", "world.js"));
require(path.join(root, "js", "game.js"));

const api = global.__DEPTH_ZERO__;
assert.ok(api, "runtime diagnostics API should initialize");
assert.equal(api.getSnapshot().upgrades, 102, "all selected upgrade nodes should be registered");
const initialUpgradeCatalog = api.getUpgradeCatalog();
assert.equal(
  initialUpgradeCatalog.find((upgrade) => upgrade.id === "gadgets_shock_capsule").breakthrough,
  true,
  "Shock Capsule must be explicitly classified as a gameplay breakthrough",
);
assert.equal(
  initialUpgradeCatalog.find((upgrade) => upgrade.id === "sense_instinct_spark").breakthrough,
  false,
  "plain scalar first ranks must not be mislabeled as breakthroughs",
);

function findSolidTerrainPair(targetApi) {
  const { WIDTH, HEIGHT } = global.DepthZeroWorld.WORLD_CONFIG;
  for (let ty = 1; ty < HEIGHT - 1; ty += 1) {
    for (let tx = 1; tx < WIDTH - 1; tx += 1) {
      const tile = targetApi.debugGetTile(tx, ty);
      const right = targetApi.debugGetTile(tx + 1, ty);
      if (tile?.kind !== "air" && right?.kind !== "air") return { tx, ty };
    }
  }
  return null;
}

// Static terrain may use small offscreen canvases in a browser, but the
// headless DOM intentionally has no canvas.getContext. That path must render
// directly, report the bypass and never grow the bounded LRU.
const initialTerrainCache = api.getTerrainBaseCacheStats();
assert.equal(Object.isFrozen(initialTerrainCache), true, "cache diagnostics must be a read-only snapshot");
assert.deepEqual(initialTerrainCache, {
  entries: 0,
  hits: 0,
  misses: 0,
  bypasses: 0,
  limit: 1800,
});
const terrainPair = findSolidTerrainPair(api);
assert.ok(terrainPair, "terrain cache smoke test needs adjacent solid tiles");
assert.equal(api.debugRenderTerrainBaseTile(terrainPair.tx, terrainPair.ty), true);
assert.deepEqual(api.getTerrainBaseCacheStats(), {
  entries: 0,
  hits: 0,
  misses: 1,
  bypasses: 1,
  limit: 1800,
}, "missing offscreen context must use the direct-render fallback");

// Swap in a minimal working offscreen context to exercise hits, open-mask
// variants and eviction without changing the production renderer.
const originalCreateElement = document.createElement;
document.createElement = (tagName) => {
  const element = new StubElement(tagName);
  if (String(tagName).toLowerCase() === "canvas") element.getContext = () => context;
  return element;
};
try {
  api.startRun({ seed: "terrain-cache-smoke", sectorId: "stable_strata" });
  assert.deepEqual(api.getTerrainBaseCacheStats(), {
    entries: 0,
    hits: 0,
    misses: 0,
    bypasses: 0,
    limit: 1800,
  }, "newWorld must clear cache entries and counters");
  const cachedPair = findSolidTerrainPair(api);
  assert.ok(cachedPair);
  assert.equal(api.debugRenderTerrainBaseTile(cachedPair.tx, cachedPair.ty), true);
  assert.equal(api.debugRenderTerrainBaseTile(cachedPair.tx, cachedPair.ty), true);
  let cacheStats = api.getTerrainBaseCacheStats();
  assert.equal(cacheStats.entries, 1);
  assert.equal(cacheStats.misses, 1);
  assert.equal(cacheStats.hits, 1);
  assert.equal(cacheStats.bypasses, 0);

  api.debugPatchTile(cachedPair.tx + 1, cachedPair.ty, {
    kind: "air",
    oreId: null,
    veinId: null,
    hp: 0,
    maxHp: 0,
  });
  assert.equal(api.debugRenderTerrainBaseTile(cachedPair.tx, cachedPair.ty), true);
  cacheStats = api.getTerrainBaseCacheStats();
  assert.equal(cacheStats.entries, 2, "a changed exposed-neighbor mask must create a fresh base tile variant");
  assert.equal(cacheStats.misses, 2);

  const { WIDTH, HEIGHT } = global.DepthZeroWorld.WORLD_CONFIG;
  let rendered = 0;
  for (let ty = 0; ty < HEIGHT && rendered < cacheStats.limit + 12; ty += 1) {
    for (let tx = 0; tx < WIDTH && rendered < cacheStats.limit + 12; tx += 1) {
      if (api.debugGetTile(tx, ty)?.kind === "air") continue;
      api.debugRenderTerrainBaseTile(tx, ty);
      rendered += 1;
    }
  }
  cacheStats = api.getTerrainBaseCacheStats();
  assert.ok(rendered > cacheStats.limit, "smoke world must contain enough solid cells to exercise eviction");
  assert.equal(cacheStats.entries, cacheStats.limit, "terrain LRU must stay at its hard entry limit");
} finally {
  document.createElement = originalCreateElement;
}
api.startRun({ seed: "terrain-cache-reset", sectorId: "stable_strata" });
assert.deepEqual(api.getTerrainBaseCacheStats(), {
  entries: 0,
  hits: 0,
  misses: 0,
  bypasses: 0,
  limit: 1800,
}, "starting another world must release all cached canvases");

// The field guide stays open for a new player, then becomes a small explicit
// disclosure after the first shifts. The button must always restore it.
api.debugResetProgress();
api.startRun({ seed: "guide-first-run" });
const fieldGuide = elementFor("#fieldGuide");
const guideToggle = elementFor("#guideToggle");
const guideBody = elementFor("#guideBody");
assert.equal(fieldGuide.classList.contains("is-collapsed"), false, "the first shift should keep the compact guide open");
assert.equal(guideToggle.getAttribute("aria-expanded"), "true");
guideToggle.click();
assert.equal(fieldGuide.classList.contains("is-collapsed"), true, "the guide disclosure must collapse on request");
assert.equal(guideBody.getAttribute("aria-hidden"), "true");
guideToggle.click();
assert.equal(fieldGuide.classList.contains("is-collapsed"), false, "the guide disclosure must reopen on request");
api.debugResetProgress();
elementFor("#replayTutorial").click();
elementFor("#tutorialNext").click();
elementFor("#tutorialNext").click();
elementFor("#tutorialNext").click();
api.startRun({ seed: "guide-trained-player" });
assert.equal(fieldGuide.classList.contains("is-collapsed"), true, "completed onboarding should also compact the field guide");
api.debugResetProgress();
api.setCompletedRuns(2);
api.startRun({ seed: "guide-returning-player" });
assert.equal(fieldGuide.classList.contains("is-collapsed"), true, "returning players should start with an unobtrusive guide button");
assert.equal(guideToggle.getAttribute("aria-expanded"), "false");
assert.equal(guideToggle.title, "ÐžÑ‚ÐºÑ€Ñ‹Ñ‚ÑŒ Ð¿Ð°Ð¼ÑÑ‚ÐºÑƒ");
guideToggle.click();
assert.equal(fieldGuide.classList.contains("is-collapsed"), false, "auto-collapse must not prevent explicit reopening");
api.debugResetProgress();

function grantWorkshopBudget(targetApi, amount = 1_000_000) {
  for (const ore of global.DepthZeroUpgrades.ORE_TYPES) targetApi.grantOre(ore.id, amount);
}

function maxWorkshopUpgrade(targetApi, upgradeId) {
  let entry = targetApi.getUpgradeCatalog().find((upgrade) => upgrade.id === upgradeId);
  while (entry.level < entry.maxLevel) {
    assert.equal(targetApi.buyUpgrade(upgradeId), true, `test setup should finish ${upgradeId}`);
    entry = targetApi.getUpgradeCatalog().find((upgrade) => upgrade.id === upgradeId);
  }
}

function dispatchUpgradeNodeClick(upgradeId, { shiftKey = false } = {}) {
  const node = { dataset: { upgradeId, buyUpgrade: upgradeId } };
  const target = {
    closest(selector) {
      if (selector === '[data-buy-upgrade]' || selector === '[data-upgrade-id]') return node;
      return null;
    },
  };
  const listeners = elementFor('#upgradeGrid').listeners.get('click') || [];
  assert.equal(listeners.length, 1, 'the upgrade map should install one delegated click handler');
  listeners[0]({ target, shiftKey });
}

// Desktop keeps its established shortcut. Both coarse touch devices and the
// narrow mobile layout make a node tap select-only, so the interface can never
// show mobile copy while silently using desktop purchase semantics.
api.debugResetProgress();
grantWorkshopBudget(api);
api.openUpgrades();
mobileUpgradeInteraction = false;
dispatchUpgradeNodeClick('core_first_descent');
assert.equal(api.getUpgradeCatalog().find((upgrade) => upgrade.id === 'core_first_descent').level, 1, 'desktop node click must keep its direct-purchase behavior');
api.startRun({ seed: 'desktop-shift-purchase' });
api.stepRun(8);
grantWorkshopBudget(api);
api.openUpgrades();
dispatchUpgradeNodeClick('time_extra_breath', { shiftKey: true });
const desktopShiftPurchase = api.getUpgradeCatalog().find((upgrade) => upgrade.id === 'time_extra_breath');
assert.equal(desktopShiftPurchase.level, desktopShiftPurchase.maxLevel, 'desktop Shift + click must keep buying every affordable rank');

api.debugResetProgress();
grantWorkshopBudget(api);
global.innerWidth = 390;
mobileUpgradeInteraction = false;
api.openUpgrades();
dispatchUpgradeNodeClick('core_first_descent');
assert.equal(api.getUpgradeCatalog().find((upgrade) => upgrade.id === 'core_first_descent').level, 0, 'the narrow mobile layout must not purchase a perk by tapping its icon');
assert.equal(elementFor('#buyMaxSelectedUpgrade').dataset.purchaseMode, 'single', 'the narrow mobile layout must expose a single-rank purchase action');
global.innerWidth = 1280;

api.debugResetProgress();
grantWorkshopBudget(api);
mobileUpgradeInteraction = true;
api.openUpgrades();
dispatchUpgradeNodeClick('core_first_descent');
assert.equal(api.getUpgradeCatalog().find((upgrade) => upgrade.id === 'core_first_descent').level, 0, 'mobile node tap must only select and reveal its description');
assert.equal(elementFor('#buyMaxSelectedUpgrade').textContent, 'ÐšÐ£ÐŸÐ˜Ð¢Ð¬', 'mobile must expose an explicit single-rank purchase button');
assert.equal(elementFor('#buyMaxSelectedUpgrade').dataset.purchaseMode, 'single');
elementFor('#buyMaxSelectedUpgrade').click();
assert.equal(api.getUpgradeCatalog().find((upgrade) => upgrade.id === 'core_first_descent').level, 1, 'the explicit mobile purchase button must install the selected node');

api.startRun({ seed: 'mobile-purchase-button' });
api.stepRun(8);
grantWorkshopBudget(api);
api.openUpgrades();
dispatchUpgradeNodeClick('time_extra_breath');
elementFor('#buyMaxSelectedUpgrade').click();
assert.equal(api.getUpgradeCatalog().find((upgrade) => upgrade.id === 'time_extra_breath').level, 1, 'mobile purchase button must buy one rank rather than every affordable rank');

mobileUpgradeInteraction = false;
api.debugResetProgress();
grantWorkshopBudget(api);
api.openUpgrades();
assert.equal(elementFor('#buyMaxSelectedUpgrade').textContent, 'ÐšÐ£ÐŸÐ˜Ð¢Ð¬ MAX', 'desktop must retain its existiß];îÚ$z{-®éÜj×²6VVBÂ6V7F÷$–C¢'7F&ÆU÷7G&F"Ò“°¢’æFV'Vu6WEÆ–W%F–ÆRƒCÂ#“°¢f÷"†ÆWBG’Òs²G’ÃÒ#3²G’³Ò’°¢f÷"†ÆWBG‚Ò3s²G‚ÃÒCC²G‚³Ò’6ÆV%F–ÆR‡G‚ÂG’“°¢Ð¢6öç7B&Æ7E7FG2Ò’ævWE7FG2‚“°¢6öç7B&Æ7DFÖvRÒ&Æ7E7FG2ç–6µ÷vW"¢&Æ7E7FG2æ&öÖ%÷vW"¢ãƒ°¢6öç7BæöFT‡Ò&Æ7DFÖvR¢ãS°¢Æ6T÷&RƒCÂ#Â&6÷W""ÂG·6VVGÒÖÆ&vVÂæöFT‡“°¢Æ6T÷&RƒCÂ#Â&6÷W""ÂG·6VVGÒÖÆ&vVÂæöFT‡“°¢Æ6T÷&RƒCÂ’Â&6÷W""ÂG·6VVGÒ×6ÖÆÆÂæöFT‡“°¢76W'BæWVÂ†’æf÷&6TFWFöæFRƒÂ’ÂG'VR“°¢6öç7B&Æ7E6æ6†÷BÒ’ævWE6æ6†÷B‚“°¢6öç7BW‡V7FVE&W6W'fRÒ"¢†&Æ7DFÖvRÒæöFT‡’¢&Æ7E7FG2æ÷fW&¶–ÆÅ&W6W'fö—%&F–ó°¢76W'BæWVÂ†&Æ7E6æ6†÷Bæ÷fW&¶–ÆÅ&W6W'fö—%fV–ä–BÂG·6VVGÒÖÆ&vV“°¢76W'Bæö²€¢ÖF‚æ'2†&Æ7E6æ6†÷Bæ÷fW&¶–ÆÅ&W6W'fö—"ÒW‡V7FVE&W6W'fR’ÂRÓ’À¢G¶F—&V7F–öæÂò&F—&V7F–öæÂ"¢&6—&6ÆR'Ò&Æ7B×W7B&WF–âF†RÆ&vW7BfV–âvw&VvFRöæÇ–À¢“°¢’æf–æ—6…'Vâ‚“°§Ð¦76W'DÆ&vW7D&Æ7E&W6W'fR‡²F—&V7F–öæÃ¢fÇ6RÂ6VVC¢''VçF–ÖRÖ6—&6ÆR×&W6W'fR"Ò“°¦76W'DÆ&vW7D&Æ7E&W6W'fR‡²F—&V7F–öæÃ¢G'VRÂ6VVC¢''VçF–ÖRÖF—&V7F–öæÂ×&W6W'fR"Ò“° ¢òò7F–6·’6†&vR—2W6VgVÂ&Vf÷&R7&Wr&V6öã¢öâ7V66W76gVÂ&öÆÂ—BÖ÷fW0¢òòF†RW–6VçFW"FòæV&'’÷&RF†BF†R÷&–v–æÂ&Æ7B6÷VÆBæ÷B&V6‚à¦’ç6WDÆÅWw&FW2†fÇ6R“°¦’ç6WEWw&FTÆWfVÂ‚&vFvWG5÷7F–6·•ö6†&vR"ÂR“°¦’ç7F'E'Vâ‡²6VVC¢''VçF–ÖR×7F–6·’×v—F†÷WBÖ&V6öâ"Â6V7F÷$–C¢'7F&ÆU÷7G&F"Ò“°¦’æFV'Vu6WEÆ–W%F–ÆRƒCÂ#“°¦f÷"†ÆWBG’Òs²G’ÃÒ#3²G’³Ò’°¢f÷"†ÆWBG‚Ò3s²G‚ÃÒCS²G‚³Ò’6ÆV%F–ÆR‡G‚ÂG’“°§Ð§Æ6T÷&RƒC2Â#Â&6÷W""Â'7F–6·’ÖÆö6Â×F&vWB"Â“°¦76W'BæWVÂ†’ævWE6æ6†÷B‚’æ7&Wt&V6öâÂçVÆÂ“°¦6öç7B6fVE7F–6·•&æFöÒÒÖF‚ç&æFöÓ°¤ÖF‚ç&æFöÒÒ‚’Óâ°§G'’°¢76W'BæWVÂ†’æf÷&6TFWFöæFRƒÂ’ÂG'VR“°§Òf–æÆÇ’°¢ÖF‚ç&æFöÒÒ6fVE7F–6·•&æFöÓ°§Ð¦76W'BæWVÂ†’æFV'VtvWEF–ÆRƒC2Â#’æ¶–æBÂ&—""Â'7F–6·’6†&vR×W7BGF6‚Fò÷&Rv—F†÷WB7&Wr&V6öâ"“°¦’æf–æ—6…'Vâ‚“° ¢òòFWFöæF–öâv—F‚ÖvæWF–2f–VÆB–ç7FÆÆVB×W7B7&VFRF†RÆö6Âf–VÆBWfVà¢òòv†Vâ&æFöÒ&öÖ"&ö72&R7W&W76VBâF†Rf—'7B&öÖ"—2Ç&VG’wV–FVC¢¢òòfÇV&ÆR÷&R÷WG6–FRF†R÷&–v–æÂ&Æ7B&F—W2'&V·2Âv†–ÆRF†RæV&'¢òòÆ÷r×fÇVRFV6÷’÷WG6–FRF†RÖ÷fVB&Æ7B&VÖ–ç2–çF7Bà¦’ç6WDÆÅWw&FW2†fÇ6R“°¦’ç6WEWw&FTÆWfVÂ‚&vFvWG5öÖvæWEöÖ–æR"Âb“°¦’ç7F'E'Vâ‡²6VVC¢''VçF–ÖRÖÖvæWF–2Öf–VÆB"Â6V7F÷$–C¢'7F&ÆU÷7G&F"Ò“°¦’æFV'Vu6WEÆ–W%F–ÆRƒCÂ#“°¦f÷"†ÆWBG’Òƒ²G’ÃÒ##²G’³Ò’°¢f÷"†ÆWBG‚Ò3s²G‚ÃÒC3²G‚³Ò’6ÆV%F–ÆR‡G‚ÂG’“°§Ð§Æ6T÷&Rƒ3’Â#Â&6÷W""Â&ÖvæWF–2ÖFV6÷’"Â“°§Æ6T÷&RƒC"Â#Â'7F%ö6÷&R"Â&ÖvæWF–2×&–÷&—G’"Â“°¦6öç7BÖvæWF–4f–VÆG4&Vf÷&RÒ’ævWE6æ6†÷B‚’æÖWG&–72æÖvæWF–4f–VÆG3°¦76W'BæWVÂ†’æf÷&6TFWFöæFR‚’ÂG'VR“°¦76W'BæWVÂ†’ævWE6æ6†÷B‚’æÖWG&–72æÖvæWF–4f–VÆG2ÂÖvæWF–4f–VÆG4&Vf÷&R²“°¦76W'BæWVÂ†’æFV'VtvWEF–ÆRƒC"Â#’æ¶–æBÂ&—""Â'F†Rf—'7Bf–VÆB&öÖ"×W7BÖ÷fR—G2W–6VçFW"FòfÇV&ÆR÷&R"“°¦76W'Bææ÷DWVÂ†’æFV'VtvWEF–ÆRƒ3’Â#’æ¶–æBÂ&—""Â'F†RÖ÷fVBW–6VçFW"×W7BÆVfRF†RÆ÷r×fÇVRFV6÷’÷WG6–FRF†R&Æ7B"“°¦’æf–æ—6…'Vâ‚“° ¢òòF†W&ÖÂG&–Âv–FVç2öæÇ’F†Rf—7VÂöVFvR&æBâFÖvU&’¶VW2F†R÷&–v–æÀ¢òòV–v‡B×—†VÂgVÆÂ×÷vW"6÷&RÂv†–ÆRæV–v†&÷&–ærVFvRF–ÆR&V6V—fW2W†7FÇ¢òòF†RGfW'F—6VBÆWfVÂÖf—fRCRRFÖvRæB—27&VF—FVBFòF†R&VF&ÆR6÷W&6Rà¦’ç6WDÆÅWw&FW2†fÇ6R“°¦’ç6WDfö7W6VD÷&R†çVÆÂ“°¦’ç6WEWw&FTÆWfVÂ‚'FööÇ5öÆ6W%öVÖ—GFW""Â“°¦’ç6WEWw&FTÆWfVÂ‚'FööÇ5öÆ6W%÷v–GF‚"ÂR“°¦’ç7F'E'Vâ‡²6VVC¢''VçF–ÖR×F†W&ÖÂÖVFvR"Â6V7F÷$–C¢'7F&ÆU÷7G&F"Ò“°¦’æFV'Vu6WEÆ–W%F–ÆRƒCÂ#“°¦f÷"†ÆWBG’Òƒ²G’ÃÒ##²G’³Ò’°¢f÷"†ÆWBG‚Ò3“²G‚ÃÒC3²G‚³Ò’6ÆV%F–ÆR‡G‚ÂG’“°§Ð§Æ6T÷&RƒCÂ#Â&6÷W""Â'F†W&ÖÂÖ6÷&R"Âó“°§Æ6T÷&RƒCÂ#Â&6÷W""Â'F†W&ÖÂÖVFvR"Âó“°¦76W'Bæö²†’æFV'Vu6WEF&vWEF–ÆRƒCÂ#’“°¦6öç7BF†W&ÖÅ7FG2Ò’ævWE7FG2‚“°¦6öç7BF†W&ÖÄ6÷&T&Vf÷&RÒ’æFV'VtvWEF–ÆRƒCÂ#’æ‡°¦6öç7BF†W&ÖÄVFvT&Vf÷&RÒ’æFV'VtvWEF–ÆRƒCÂ#’æ‡°¦76W'Bæö²†’æGF6´æ÷r‚’“°¦6öç7BF†W&ÖÄ6÷&TFÖvRÒF†W&ÖÄ6÷&T&Vf÷&RÒ’æFV'VtvWEF–ÆRƒCÂ#’æ‡°¦6öç7BF†W&ÖÄVFvTFÖvRÒF†W&ÖÄVFvT&Vf÷&RÒ’æFV'VtvWEF–ÆRƒCÂ#’æ‡°¦76W'Bæö²‡F†W&ÖÄ6÷&TFÖvRâ“°¦76W'Bæö²€¢ÖF‚æ'2‡F†W&ÖÄVFvTFÖvRòF†W&ÖÄ6÷&TFÖvRÒF†W&ÖÅ7FG2æÆ6W$†VDVFvU÷vW"’ÂRÓ’À¢'F†W&ÖÂVFvR×W7B&V6V—fRöæÇ’—G2GfW'F—6VBfÆÆöfb–ç7FVBöbgVÆÂ×v–GF‚&’FÖvRÇW2VFvRFÖvR"À¢“°§Æ6T÷&RƒCÂ#Â&6÷W""Â'F†W&ÖÂÖVFvRÖ'&V²"ÂF†W&ÖÄVFvTFÖvR¢ãR“°¦76W'Bæö²†’æGF6´æ÷r‚’“°¦76W'BæWVÂ†’ævWE6æ6†÷B‚’æÖWG&–72ç6÷W&6T'&V·5²&Æ6W"Ö†VB%ÒÂ“°¦’æf–æ—6…'Vâ‚“°¦76W'BæÖF6‚†VÆVÖVçDf÷"‚"7&W÷'DFWF–Ç2"’æ–ææW$…DÔÂÂý
-]Í}]­’½]Bò“° ¢òòöæR×F&vWB&ö6‚6†—×W7B–ç7V7B&÷F‚6–FW2â–b—G2†—7F÷&–6Âf—'7@¢òò6–FR—2V×G’ÂF†RW†—7F–ærö'7G'V7F–ær6–FR7F–ÆÂ&V6V—fW2F†R7G&–¶Rà¦’ç6WDÆÅWw&FW2†fÇ6R“°¦’ç6WEWw&FTÆWfVÂ‚&F–u÷&V6—6–öå÷F‚"Â2“°¦’ç7F'E'Vâ‡²6VVC¢''VçF–ÖRÖ&ö6‚×6–FRÖ6†ö–6R"Â6V7F÷$–C¢'7F&ÆU÷7G&F"Ò“°¦’æFV'Vu6WEÆ–W%F–ÆRƒCÂ#“°¦f÷"†ÆWBG’Òƒ²G’ÃÒ##²G’³Ò’°¢f÷"†ÆWBG‚Ò3“²G‚ÃÒC3²G‚³Ò’6ÆV%F–ÆR‡G‚ÂG’“°§Ð§Æ6T÷&RƒCÂ#Â&6÷W""Â&&ö6‚×F&vWB"Â“°§Æ6U&ö6²ƒCÂ#Â“°¦76W'Bæö²†’æFV'Vu6WEF&vWEF–ÆRƒCÂ#’“°¦’æFV'Vu6WD&ö6…G&fVÂƒ“°¦6öç7Bö'7G'V7F–æu6–FT&Vf÷&RÒ’æFV'VtvWEF–ÆRƒCÂ#’æ‡°¦76W'Bæö²†’æGF6´æ÷r‚’“°¦76W'Bæö²†’æFV'VtvWEF–ÆRƒCÂ#’æ‡Âö'7G'V7F–æu6–FT&Vf÷&RÂ'F†RW†—7F–ær6–FR×W7B&V6V—fRF†RöæR&ö6‚6†—"“°¦’æf–æ—6…'Vâ‚“° ¢òòfVÇBÆ–æRföÆÆ÷w2ç’7&—F–6ÆÇ’FW7G&÷–VB&–Ö'’F&vWBÂ–æ6ÇVF–ær¢òò6ÆV&æ6R&ö6²â—G26V6öæF'’'&V²&VÖ–ç2æöâ×&V7W'6—fRfVÇBÖÆ–æR†—Bà¦’ç6WDÆÅWw&FW2†fÇ6R“°¦’ç6WEWw&FTÆWfVÂ‚'÷vW%öÖ÷VçF–å÷7Æ—GFW""Â“°¦’ç7F'E'Vâ‡²6VVC¢''VçF–ÖRÖfVÇBÖÆ–æRÖ6ÆV&æ6R"Â6V7F÷$–C¢'7F&ÆU÷7G&F"Ò“°¦’æFV'Vu6WEÆ–W%F–ÆRƒCÂ#“°¦f÷"†ÆWBG’Òƒ²G’ÃÒ##²G’³Ò’°¢f÷"†ÆWBG‚Ò3“²G‚ÃÒCC²G‚³Ò’6ÆV%F–ÆR‡G‚ÂG’“°§Ð§Æ6U&ö6²ƒCÂ#Âã“°§Æ6U&ö6²ƒC"Â#ÂãR“°¦76W'Bæö²†’æFV'Vu6WD6ÆV&æ6UF&vWEF–ÆRƒCÂ#’“°¦6öç7B6fVDfVÇE&æFöÒÒÖF‚ç&æFöÓ°¤ÖF‚ç&æFöÒÒ‚’Óâ°§G'’°¢76W'Bæö²†’æGF6´æ÷r‚’“°§Òf–æÆÇ’°¢ÖF‚ç&æFöÒÒ6fVDfVÇE&æFöÓ°§Ð¦76W'BæWVÂ†’æFV'VtvWEF–ÆRƒCÂ#’æ¶–æBÂ&—""“°¦76W'BæWVÂ†’æFV'VtvWEF–ÆRƒC"Â#’æ¶–æBÂ&—""Â&6ÆV&æ6R÷fW&¶–ÆÂ×W7B6öçF–çVRf÷'v&BF‡&÷Vv‚fVÇBÆ–æR"“°¦76W'BæWVÂ†’ævWE6æ6†÷B‚’æÖWG&–72ç6÷W&6T'&V·5²&fVÇBÖÆ–æR%ÒÂ“°¦’æf–æ—6…'Vâ‚“° ¢òòÖ÷F†W&ÆöFR—2Ç6ò&–6‚B'VçF–ÖRÂ6ò—G2W7F–ÖF÷"6ö×ÆWF–öâ×W7B6''¢òòF†R6ÖRwV&çFVVB&–6‚6ö×ÆWF–öâ–V6W2–âFF—F–öâFò—G266†Rà¦6öç7BÖ÷F†W&ÆöFTW7F–ÖF÷$&6RÒ°¢'VäGW&F–öã¢CRÀ¢&öçW5'VäGW&F–öä6¢cÀ¢–6µ÷vW#¢À¢F–u7VVC¢#À¢Ö÷fU7VVC¢SÀ¢Ö÷F†W&ÆöFTwV&çFVVC¢G'VRÀ¢Ö÷F†W&ÆöFUG&–vvW$'&V·3¢À¢Ö÷F†W&ÆöFU––VÆD×VÇF—Æ–W#¢"À¢Ö÷F†W&ÆöFT6ö×ÆWF–öä66†S¢À¢Ö÷F†W&ÆöFT6ö×ÆWF–öåF–ÖT&öçW3¢À¢&–6…fV–åv†öÆT6†æ6S¢À¢&–6…fV–å––VÆD&öçW3¢ãRÀ§Ó°¦6öç7BÖ÷F†W&ÆöFTW7F–ÖFUv—F†÷WE&–6„f–æ—6‚Ò’æFV'VtW7F–ÖFT&Ææ6U'Vâ€¢''VçF–ÖRÖW7F–ÖF÷"ÖÖ÷F†W&ÆöFR×&–6‚"À¢²ââæÖ÷F†W&ÆöFTW7F–ÖF÷$&6RÂ&–6…fV–ä6ö×ÆWF–öä&öçW3¢ÒÀ¢“°¦6öç7BÖ÷F†W&ÆöFTW7F–ÖFUv—F…&–6„f–æ—6‚Ò’æFV'VtW7F–ÖFT&Ææ6U'Vâ€¢''VçF–ÖRÖW7F–ÖF÷"ÖÖ÷F†W&ÆöFR×&–6‚"À¢²ââæÖ÷F†W&ÆöFTW7F–ÖF÷$&6RÂ&–6…fV–ä6ö×ÆWF–öä&öçW3¢bÒÀ¢“°¦76W'Bæö²€¢Ö÷F†W&ÆöFTW7F–ÖFUv—F…&–6„f–æ—6‚æ†VÂãÒÖ÷F†W&ÆöFTW7F–ÖFUv—F†÷WE&–6„f–æ—6‚æ†VÂ²Rã“’À¢&Ö÷F†W&ÆöFRW7F–ÖF÷"6ö×ÆWF–öâ×W7B–æ6ÇVFR—G2&–6‚6ö×ÆWF–öâ&öçW2"À¢“° ¦6öç7B&Ææ6U&W÷'BÒ’ç'Vä&Ææ6T&Væ6‚‚“°¦76W'BæWVÂ†&Ææ6U&W÷'Bç&÷w2æÆVæwF‚Â2“°¦76W'BæWVÂ†&Ææ6U&W÷'Bç6–×VÆF–öç2Â"“°¦76W'BæFVWWVÂ†&Ææ6U&W÷'Bç&öf–ÆT'V–ÆBæ–çfÆ–E&WV—&VÖVçG2ÂµÒÂ&&Væ6‚&öf–ÆW2×W7B&W7V7BWfW'’G&VRFWVæFVæ7’"“° ¦VÆVÖVçDf÷"‚"6&Ææ6U&öf–ÆR"’çfÇVRÒ#c#°¦VÆVÖVçDf÷"‚"6&Ææ6U'Vç2"’çfÇVRÒ#"#°¦6öç7BGfæ6VD&Ææ6U&W÷'BÒ’ç'Vä&Ææ6T&Væ6‚‚“°¦76W'BæFVWWVÂ†Gfæ6VD&Ææ6U&W÷'Bç&öf–ÆT'V–ÆBæ–çfÆ–E&WV—&VÖVçG2ÂµÒ“°¦76W'Bææ÷DWVÂ†Gfæ6VD&Ææ6U&W÷'Bç&öf–ÆT'V–ÆBçFööÂÂ'–6¶†R"Â'F†RGfæ6VB&öf–ÆR×W7BW6RâGfæ6VBFööÂ"“°¦76W'Bæö²†Gfæ6VD&Ææ6U&W÷'Bç&öf–ÆT'V–ÆBæG&öæT6÷VçBâÂ'F†RGfæ6VB&öf–ÆR×W7B–æ6ÇVFRv÷&¶–ærG&öæW2"“°¦76W'Bæö²†Gfæ6VD&Ææ6U&W÷'Bç&÷w2æWfW'’‚‡&÷r’Óâ&÷ræfW&vT†VÂâbb&÷ræfW&vT&Æö6·2â’“° ¦VÆVÖVçDf÷"‚"6&Ææ6U&öf–ÆR"’çfÇVRÒ#“R#°¦VÆVÖVçDf÷"‚"6&Ææ6U'Vç2"’çfÇVRÒ##°¦6öç7B&Vf–æÄ&Ææ6U&W÷'BÒ’ç'Vä&Ææ6T&Væ6‚‚“°¦76W'BæFVWWVÂ‡&Vf–æÄ&Ææ6U&W÷'Bç&öf–ÆT'V–ÆBæ–çfÆ–E&WV—&VÖVçG2ÂµÒ“°¦76W'BæWVÂ‡&Vf–æÄ&Ææ6U&W÷'Bç&öf–ÆT'V–ÆBæÆ6W%VæÆö6¶VBÂG'VRÂ'F†R&Vf–æÂ&öf–ÆR×W7BW†W&6—6RF†RÆ6W"ÖöFVÂ"“° ¢òòf÷W"Fò6—‚WfVçFÆW726†–gG2&ÒöæR‡—6–6ÂÂÆö6ÆÇ’&VæFW&VBWfVçBæV ¢òòF†R7W'&VçB7F'B†–æ6ÇVF–ærÆ–gB7F'G2’æBÖ¶R—BF†RæW‡B6Vç6RF&vWBà¦’ç6WDÆÅWw&FW2†fÇ6R“°¦6öç7B—G•6WGWÒ’æFV'Vu6WDWfVçE—G’ƒRÂ“°¦76W'BæWVÂ‡—G•6WGWçF‡&W6†öÆBÂR“°¦’ç7F'E'Vâ‡²6VVC¢''VçF–ÖRÖWfVçB×—G’"Â6V7F÷$–C¢'7F&ÆU÷7G&F"Ò“°¦ÆWB—G•6æ6†÷BÒ’ævWE6æ6†÷B‚“°¦76W'BæWVÂ‡—G•6æ6†÷BæWfVçE—G’æ&ÖVBÂG'VR“°¦76W'Bæö²‡—G•6æ6†÷BæWfVçE—G’ç7FvVDWfVçD–B“°¦’ç7FW'Vâƒã"“°§—G•6æ6†÷BÒ’ævWE6æ6†÷B‚“°¦76W'Bæö²€¢—G•6æ6†÷BçF&vWCòæ¶–æBÓÓÒ&Ö–7&õöWfVçB"ÇÂ—G•6æ6†÷BæÖWG&–72æWfVçD6÷VçBâÀ¢F†R7FvVB6†W7B×W7B&RF&vWFVB÷"Ç&VG’6öÆÆV7FVC¢G´¥4ôâç7G&–æv–g’‡²—G“¢—G•6æ6†÷BæWfVçE—G’ÂF&vWC¢—G•6æ6†÷BçF&vWBÂÖWG&–73¢—G•6æ6†÷BæÖWG&–72Ò—ÖÀ¢“°¦’æf–æ—6…'Vâ‚“° ¢òòöæ6R&ö¦V7FVBvÆÂÖ6Æö6²VæBÇ&VG’&V6†W2c6V6öæG2ÂÆFR&öçW2×W7@¢òòw&çBöÆöræ÷F†–æræB×W7Bæ÷B&V6†&vR6‡&öæò÷fW&G&—fR7BF†R&VÂ6à¦’ç6WDÆÅWw&FW2†fÇ6R“°¦’ç6WEWw&FTÆWfVÂ‚'F–ÖU÷F†—'G•÷6V6öæEööF‚"Â“°¦’ç7F'E'Vâ‡²6VVC¢''VçF–ÖRÖÆFRÖ&öçW2Ö6"Â6V7F÷$–C¢'7F&ÆU÷7G&F"Ò“°¦’æw&çD&öçW5F–ÖRƒ“°¦’ç7FW'VâƒSR“°¦6öç7BÆFT&öçW4&Vf÷&RÒ’ævWE6æ6†÷B‚“°¦6öç7BÆFTw&çFVBÒ’æw&çD&öçW5F–ÖRƒ“°¦6öç7BÆFT&öçW4gFW"Ò’ævWE6æ6†÷B‚“°¦76W'Bæö²†ÆFTw&çFVBÃÒRÓbÂ&&öçW2&W–öæBF†R&ö¦V7FVB'6öÇWFRVæB×W7Bw&çB¦W&ò&VÂ6V6öæG2"“°¦76W'Bæö²†ÆFT&öçW4gFW"æ7F—fUvÆÄVÆ6VB²ÆFT&öçW4gFW"çF–ÖTÆVgBÃÒc²RÓb“°¦76W'Bæö²„ÖF‚æ'2†ÆFT&öçW4gFW"æ&öçW5F–ÖTV&æVBÒÆFT&öçW4&Vf÷&Ræ&öçW5F–ÖTV&æVB’ÃÒRÓb“°¦76W'Bæö²„ÖF‚æ'2†ÆFT&öçW4gFW"æ6‡&öæô÷fW&fÆ÷u&VÖ–æ–ærÒÆFT&öçW4&Vf÷&Ræ6‡&öæô÷fW&fÆ÷u&VÖ–æ–ær’ÃÒRÓb“°¦’æf–æ—6…'Vâ‚“° ¦’ç6WDÆÅWw&FW2‡G'VR“°¦’ç7F'E'Vâ‡²6VVC¢''VçF–ÖR×F–ÖW"Ö6"Â6V7F÷$–C¢'7F&ÆU÷7G&F"Ò“°¦’æw&çD&öçW5F–ÖRƒ“°§6æ6†÷BÒ’ævWE6æ6†÷B‚“°¦76W'Bæö²‡6æ6†÷BçF–ÖTÆVgBÃÒcÂ&&öçW26÷VçFF÷vâ×W7B&R6Æ×VBBc"“°¦’ç7FW'Vâƒc“°§6æ6†÷BÒ’ævWE6æ6†÷B‚“°¦76W'BæWVÂ‡6æ6†÷BæÖöFRÂ'&W7VÇB"Â&'6öÇWFR&öçW2vÆÂÖ6Æö6²66†÷VÆBVæBF†R'Vâ"“°¦76W'Bæö²‡6æ6†÷Bæ7F—fUvÆÄVÆ6VBÃÒc²ãS“° ¢òò&V7&VFRF†R6ö×ÆWFRvÖR'VçF–ÖRv–ç7BF†R6ÖRÆö6Å7F÷&vRÖâF†—0¢òò6F6†W2&VÆöBÖöæÇ’&Vw&W76–öç2F†B6W&–Æ—¦VBÖf–VÆB76W'F–öâ6ææ÷Bà¦’æFV'Vu&W6WE&öw&W72‚“°¦’æw&çD÷&R‚&6÷W""Â#“°¦’æ÷VåWw&FW2‚“°¦76W'BæWVÂ†’æ'W•Ww&FR‚&6÷&Uöf—'7EöFW66VçB"’ÂG'VR“°¦76W'BæWVÂ†’ævWEWw&FT6FÆör‚’æf–æB‚‡Ww&FR’ÓâWw&FRæ–BÓÓÒ'F–ÖUöW‡G&ö'&VF‚"’æf–Æ&ÆRÂfÇ6R“°¦6öç7BvÖTÖöGVÆUF‚Ò&WV—&Rç&W6öÇfR‡F‚æ¦ö–â‡&ö÷BÂ&§2"Â&vÖRæ§2"’“°¦FVÆWFR&WV—&Ræ66†U¶vÖTÖöGVÆUF…Ó°§&WV—&R†vÖTÖöGVÆUF‚“°¦6öç7B&VÆöFVD’ÒvÆö&ÂåõôDUD…õ¤U$õõó°¦76W'Bææ÷DWVÂ‡&VÆöFVD’Â’Â'&VÆöB&Vw&W76–öâ6†÷VÆBW6Rg&W6‚vÖR'VçF–ÖR"“°¦76W'BæWVÂ€¢&VÆöFVD’ævWEWw&FT6FÆör‚’æf–æB‚‡Ww&FR’ÓâWw&FRæ–BÓÓÒ'F–ÖUöW‡G&ö'&VF‚"’æf–Æ&ÆRÀ¢fÇ6RÀ¢&&VÂ'VçF–ÖR&VÆöB×W7B&W6W'fRF†RVæF–ær6†–ÆBvFR"À¢“°§&VÆöFVD’ç7F'E'Vâ‡²6VVC¢C"Ò“°§&VÆöFVD’ç7FW'Vâƒ‚“°¦76W'BæWVÂ€¢&VÆöFVD’ævWEWw&FT6FÆör‚’æf–æB‚‡Ww&FR’ÓâWw&FRæ–BÓÓÒ'F–ÖUöW‡G&ö'&VF‚"’æf–Æ&ÆRÀ¢G'VRÀ¢&öæR6ö×ÆWFVB6†–gBgFW"&VÆöB×W7B&W&RF†RVæF–ær6†–ÆB"À¢“°¦w&çEv÷&·6†÷'VFvWB‡&VÆöFVD’“°¦6öç7B&VÆöD66æF–FFW2Ò&VÆöFVD’ævWEWw&FT6FÆör‚¢æf–ÇFW"‚‡Ww&FR’ÓâWw&FRæÆWfVÂÓÓÒbbWw&FRæf–Æ&ÆR¢ç6Æ–6RƒÂR“°¦76W'BæWVÂ‡&VÆöD66æF–FFW2æÆVæwF‚ÂR“°¦f÷"†6öç7B6æF–FFRöb&VÆöD66æF–FFW2ç6Æ–6RƒÂB’’°¢76W'BæWVÂ‡&VÆöFVD’æ'W•Ww&FR†6æF–FFRæ–B’ÂG'VR“°§Ð¦76W'BæWVÂ‡&VÆöFVD’æ'W•Ww&FR‡&VÆöD66æF–FFW5³EÒæ–B’ÂfÇ6R“°¦FVÆWFR&WV—&Ræ66†U¶vÖTÖöGVÆUF…Ó°§&WV—&R†vÖTÖöGVÆUF‚“°¦6öç7B6&VÆöFVD’ÒvÆö&ÂåõôDUD…õ¤U$õõó°¦6öç7B&VÆöD&Æö6¶VBÒ6&VÆöFVD’ævWEWw&FT6FÆör‚’æf–æB‚‡Ww&FR’ÓâWw&FRæ–BÓÓÒ&VÆöD66æF–FFW5³EÒæ–B“°¦76W'BæWVÂ‡&VÆöD&Æö6¶VBæf–Æ&ÆRÂfÇ6RÂ'&VÆöF–ærF†R'VçF–ÖR×W7Bæ÷B&W7F÷&R6öç7VÖVBf—'7B×&æ²6Æ÷B"“°¦76W'BæWVÂ‡&VÆöD&Æö6¶VBçVæF–æu&V6öâÂ&66—G’"“°¦6öç7B&VÆöE7F'FVBÒ&VÆöD66æF–FFW2æf–æB‚†6æF–FFR’Óâ6æF–FFRæÖ„ÆWfVÂâ“°¦76W'Bæö²‡&VÆöE7F'FVB“°¦76W'BæWVÂ†6&VÆöFVD’æ'W•Ww&FR‡&VÆöE7F'FVBæ–B’ÂG'VRÂ'&VÆöB×W7B7F–ÆÂÆÆ÷rÆFW"&æ·2öââÇ&VG’×7F'FVBæöFR"“°§6æ6†÷BÒ6&VÆöFVD’ævWE6æ6†÷B‚“° ¦6öç6öÆRæÆör„¥4ôâç7G&–æv–g’‡°¢ö³¢G'VRÀ¢æöFW3¢6æ6†÷BçWw&FW2À¢F—&V7D6¢gVÆÅ7FG2ç'VäGW&F–öâÀ¢&öçW46¢gVÆÅ7FG2æ&öçW5'VäGW&F–öä6À¢6†V6¶VDÖV6†æ–73¢°¢&Ö–æRÖÆ–gB"À¢&Æ–gBÖfÆö÷"ÖW‡Æ÷&F–öâ"À¢'v–FR×f–Ww÷'BÖ6ÖW&Ö6VçFW&–ær"À¢&fö7W2ÖW66ÆF–öâ"À¢&&6·W×F&vWB"À¢&–æFW†VB×F&vWB×6V&6‚"À¢&ÆV7B×&W6—7Fæ6R×&÷WFR"À¢'ö–çBÖ&Ææ²×–6²Ö6öçF7B"À¢'FööÂ×F–W"×&ö6²Ö'&V²ÖfVVF&6²"À¢'&W76VBÖ÷&RÖgVÆÂÖ6öçF7B"À¢&fö7W6VBÖ6Æ–'&F–öâ"À¢&vw&VvFRÖÆ6W"Ö6Æ–'&F–öâ"À¢&–æFWVæFVçB×&–6ö6†WB×÷vW""À¢&æò×&VÖ÷FRÖfö7W6VBÖFÖvR"À¢&F—66÷fW'’×F–ÖR"À¢&F—&V7F–öæÂÖ6†&vR"À¢&7&WrÖ&V6öâ"À¢&7&WrÖ&V6öâÖfÆÆ&6²"À¢&7&WrÖ&V6öâ×&ævRÖfÆÆ&6²"À¢&Æ6W"×&–6ö6†WB"À¢&6FÆörÖf–æÂÖ&öçW2"À¢&FVbÖ¶æö6²"À¢'7WW"×–6²ÖV6†ò"À¢&V6†òÖæò×G&—ÆR×6×ÆR"À¢'G&–æwVÆ"Öf—‚"À¢'G&–ævÆRÖöR×6æ6†÷B"À¢&&÷VæFVB×FW'&–âÖ&6RÖ66†R"À¢'&æFöÒÖvVöÆöw’×v—F†÷WB×6V7F÷"Ö6†ö–6R"À¢'6†÷'BÖvÆö&ÂÖÖ–7&òÖWfVçG2"À¢'6ögB×&ö6²ÖÆ6W"×&’"À¢'&W6öæçB×–ær"À¢&FVW×&W6öææ6R×6V7F÷""À¢&÷Væ–ær×7&–çB"À¢'F&vWB×&VÆ’×7&–çB"À¢&fVÇBÖf–æFW"Ö6FVæ6R"À¢'fV–âÖÖVÖ÷'’×F‡&÷Vv‚×&ö6²"À¢'7G&W72ÖÖÖ÷WG6–FR×6Vç6R"À¢&W‡æFVBÖW‡Æ÷&F–öâ×&V7V—6—F–öâ"À¢'6öÆ"ÖG&–ÆÂÖFVÆ–VBÖ'W'7B"À¢'6öÆ"ÖG&–ÆÂÖf–æÆR×VÆ–f–6F–öâ"À¢'F&vWBÖv&RÖFVç6—G’×–W&6R"À¢'6–FRÖ6†—"À¢&6‡&öæòÖ÷fW&G&—fR"À¢&G&öæRÖ&öçW2ÖWFöæö×’"À¢&f÷'GVæR×—G’Ö7–6ÆR"À¢&Ö÷F†W&ÆöFRÖ6÷fVæçB"À¢&vöÆFVâ×F÷V6‚ÖvF–ær"À¢'&–6‚×&VÖ–æ–ærÖæöFW2"À¢'7F–6·’×v—F†÷WBÖ&V6öâ"À¢&ÖvæWF–2Öf–VÆB"À¢&×VÇF’×fV–âÖvFvWB×&W6W'fR"À¢'F†W&ÖÂÖVFvRÖfÆÆöfb"À¢&&ö6‚×6–FRÖ6†ö–6R"À¢&fVÇBÖÆ–æRÖ6ÆV&æ6R"À¢'&–÷&—G’ÖFWF‚×66ÆVBÖ6†W7B"À¢&G'’×6†–gBÖWfVçB×—G’"À¢''VâÖF–væ÷7F–72"À¢&vVöÆöv–6ÂÖ¦÷W&æÂ"À¢&Æö6ÂÖ&Ææ6RÖ&Væ6‚"À¢'W'6—7FVçB×v÷&·6†÷×6W76–öâÖvFR"À¢'v÷&·6†÷Öf—'7B×&æ²Ö6"À¢'v÷&·6†÷ÖÆWfVÂÖ6"À¢&'6öÇWFRÓc×6V6öæBÖ6"À¢&f–VÆBÖwV–FRÖWFòÖ6öÆÆ6R"À¢ÒÀ§Ò’“° 