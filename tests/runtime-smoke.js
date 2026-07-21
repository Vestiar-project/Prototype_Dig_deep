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
const requestedImageSources = [];
global.Image = class StubImage {
  constructor() {
    this.naturalWidth = 512;
    this.naturalHeight = 512;
    this.onload = null;
    this.onerror = null;
  }
  set src(value) {
    this._src = String(value);
    requestedImageSources.push(this._src);
    this.onload?.();
  }
  get src() { return this._src || ""; }
};
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
assert.equal(api.debugGetMinerSpriteVariant({ toolTier: 1, laserUnlocked: false, solarDrillEnabled: false }).id, "v01_worn_pick");
assert.equal(api.debugGetMinerSpriteVariant({ toolTier: 5, laserUnlocked: false, solarDrillEnabled: false }).id, "v05_super_pick");
assert.equal(api.debugGetMinerSpriteVariant({ toolTier: 7, laserUnlocked: true, solarDrillEnabled: false }).id, "v06_mining_laser");
assert.equal(api.debugGetMinerSpriteVariant({ toolTier: 7, laserUnlocked: true, solarDrillEnabled: true }).id, "v07_solar_drill");
assert.equal(requestedImageSources.length, 5, "only the active equipment tier should preload");
assert.ok(requestedImageSources.every((source) => source.startsWith("assets/characters/miner/miner_v01_worn_pick_")));
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
assert.equal(guideToggle.title, "Открыть памятку");
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
assert.equal(elementFor('#buyMaxSelectedUpgrade').textContent, 'КУПИТЬ', 'mobile must expose an explicit single-rank purchase button');
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
assert.equal(elementFor('#buyMaxSelectedUpgrade').textContent, 'КУПИТЬ MAX', 'desktop must retain its existing max-purchase button');
assert.equal(elementFor('#buyMaxSelectedUpgrade').dataset.purchaseMode, 'max');
api.debugResetProgress();

// Ore focus needs a stable touch control outside the scroll-capped toolbar.
// Owning the pneumatic pick makes the mechanic relevant, but must not bypass
// its sense/sample requirements or silently purchase the focus node.
mobileUpgradeInteraction = true;
api.setUpgradeLevel('tools_pneumatic_pick', 1);
api.openUpgrades();
const mobileOreFocus = elementFor('#mobileOreFocus');
const mobileOreFocusToggle = elementFor('#mobileOreFocusToggle');
const mobileOreFocusBackdrop = elementFor('#mobileOreFocusBackdrop');
assert.equal(mobileOreFocus.classList.contains('hidden'), false, 'pneumatic-tier mobile players must see the focus status control');
assert.equal(mobileOreFocus.dataset.state, 'locked');
assert.match(elementFor('#mobileOreFocusHint').textContent, /Глубинный резонанс/);
assert.match(elementFor('#mobileOreFocusHint').textContent, /образец/i, 'the locked state must name the still-missing ore discovery');
mobileOreFocusToggle.click();
assert.equal(mobileOreFocusBackdrop.classList.contains('hidden'), true, 'a locked focus control must explain/locate the node, not open an empty picker');
assert.equal(api.getUpgradeCatalog().find((upgrade) => upgrade.id === 'sense_ore_focus').level, 0, 'the mobile focus status must never purchase the perk itself');

api.setUpgradeLevel('sense_ore_focus', 1);
api.grantOre('copper', 1);
assert.equal(mobileOreFocus.dataset.state, 'unlocked');
assert.equal(elementFor('#mobileOreFocusValue').textContent, 'ОБЫЧНЫЙ ПОИСК');
mobileOreFocusToggle.click();
assert.equal(mobileOreFocusBackdrop.classList.contains('hidden'), false, 'an unlocked mobile focus button must open the ore picker');
assert.equal(mobileOreFocusToggle.getAttribute('aria-expanded'), 'true');
const focusChoiceListeners = elementFor('#mobileOreFocusChoices').listeners.get('click') || [];
assert.equal(focusChoiceListeners.length, 1, 'the mobile ore picker must install one delegated choice handler');
const copperFocusTarget = {
  dataset: { focusOre: 'copper' },
  closest(selector) { return selector === '[data-focus-ore]' ? this : null; },
};
focusChoiceListeners[0]({ target: copperFocusTarget });
assert.equal(api.getSnapshot().focusedOreId, 'copper', 'tapping a discovered ore must update the active focus');
assert.equal(mobileOreFocusBackdrop.classList.contains('hidden'), true, 'choosing a mobile focus must close the sheet');
assert.equal(mobileOreFocusToggle.getAttribute('aria-expanded'), 'false');

mobileUpgradeInteraction = false;
api.setFocusedOre(null);
assert.equal(mobileOreFocus.classList.contains('hidden'), true, 'the separate touch focus control must stay out of the desktop layout');
assert.equal(elementFor('#oreFocusPanel').classList.contains('hidden'), false, 'the existing desktop focus panel must remain available');
api.debugResetProgress();

// Returning to a background-paused run on a phone cannot rely on an Esc key.
// The explicit resume action must preserve the paused timer and never resume
// merely because the page became visible again.
mobileUpgradeInteraction = true;
api.startRun({ seed: 'mobile-visibility-pause' });
api.stepRun(0.35);
const prePauseTime = api.getSnapshot().timeLeft;
document.hidden = true;
dispatchDocumentEvent('visibilitychange');
assert.equal(api.getSnapshot().paused, true, 'backgrounding an active run must still protect it with a pause');
assert.equal(elementFor('#pauseOverlay').classList.contains('hidden'), false);
const pausedTime = api.getSnapshot().timeLeft;
assert.equal(pausedTime, prePauseTime, 'entering the visibility pause must not consume run time');
document.hidden = false;
dispatchDocumentEvent('visibilitychange');
assert.equal(api.getSnapshot().paused, true, 'returning to the tab must wait for an explicit mobile resume');
elementFor('#resumeRun').click();
assert.equal(api.getSnapshot().paused, false, 'the mobile ПРОДОЛЖИТЬ button must resume the run');
assert.equal(elementFor('#pauseOverlay').classList.contains('hidden'), true);
assert.equal(api.getSnapshot().timeLeft, pausedTime, 'resuming must not deduct the time spent in the background');
api.finishRun();
mobileUpgradeInteraction = false;
api.debugResetProgress();

// Completing an unpinned node must advance the persistent workshop guide;
// otherwise "Next breakthrough" gets stuck on the finished root forever.
api.debugResetProgress();
api.grantOre("copper", 20);
api.openUpgrades();
const breakthroughBeforeRoot = elementFor("#nextBreakthroughName").textContent;
assert.match(breakthroughBeforeRoot, /0\/1/, "fresh guide should point at the root purchase");
assert.equal(api.buyUpgrade("core_first_descent"), true);
const breakthroughAfterRoot = elementFor("#nextBreakthroughName").textContent;
assert.notEqual(breakthroughAfterRoot, breakthroughBeforeRoot, "guide should advance after completing an unpinned node");
assert.doesNotMatch(breakthroughAfterRoot, /1\/1/, "guide should describe an incomplete next node");
assert.equal(elementFor("#upgradeMapStatus").textContent, "", "live status must not keep a stale available-node count while every child is pending");
const pendingChild = api.getUpgradeCatalog().find((upgrade) => upgrade.id === "time_extra_breath");
assert.equal(pendingChild.unlocked, true, "a child should become visible as soon as its prerequisite is installed");
assert.equal(pendingChild.available, false, "a newly unlocked child should wait for the next completed shift");
const savedPendingWorkshop = JSON.parse(localData.get("depth-zero-save-v1"));
assert.equal(savedPendingWorkshop.workshopEligibilityRun, 0, "the workshop generation should be persisted");
assert.equal(savedPendingWorkshop.workshopEligibleIds.includes("time_extra_breath"), false, "reload data must not bypass a pending child");
assert.equal(api.buyUpgrade("time_extra_breath"), false, "the workshop gate should prevent same-shift dependency cascades");
api.startRun({ seed: 14001 });
api.stepRun(8);
assert.equal(api.getSnapshot().mode, "result", "the gate should advance only after a completed shift");
const preparedChild = api.getUpgradeCatalog().find((upgrade) => upgrade.id === "time_extra_breath");
assert.equal(preparedChild.available, true, "the pending child should be installable after one completed shift");
const savedPreparedWorkshop = JSON.parse(localData.get("depth-zero-save-v1"));
assert.equal(savedPreparedWorkshop.workshopEligibilityRun, 1, "a completed shift should persist a fresh workshop generation");
assert.equal(savedPreparedWorkshop.workshopEligibleIds.includes("time_extra_breath"), true, "the prepared child should remain ready after reload");
assert.equal(api.buyUpgrade("time_extra_breath"), true, "the prepared child should purchase normally");

// A workshop pause can start at most four previously-unowned nodes. Remaining
// ranks on those nodes stay buyable, and a completed shift opens four fresh slots.
grantWorkshopBudget(api);
const workshopCandidates = api.getUpgradeCatalog()
  .filter((upgrade) => upgrade.level === 0 && upgrade.available)
  .slice(0, 4);
assert.ok(workshopCandidates.length >= 4, "the first post-root workshop should expose enough distinct branches to exercise its cap");
for (const candidate of workshopCandidates.slice(0, 3)) {
  assert.equal(api.buyUpgrade(candidate.id), true, `the workshop should start ${candidate.id} before reaching its cap`);
}
const cappedCandidate = workshopCandidates[3];
const startedBeforeExtraRank = api.getUpgradeCatalog().find((upgrade) => upgrade.id === "time_extra_breath");
assert.ok(startedBeforeExtraRank.level > 0 && startedBeforeExtraRank.level < startedBeforeExtraRank.maxLevel);
assert.equal(api.buyUpgrade("time_extra_breath"), true, "a started node must keep all later ranks available at the first-rank cap");
const cappedCatalogEntry = api.getUpgradeCatalog().find((upgrade) => upgrade.id === cappedCandidate.id);
assert.equal(cappedCatalogEntry.available, false, "a fifth distinct first rank must be blocked in the same workshop");
assert.equal(cappedCatalogEntry.pendingReason, "capacity", "catalog diagnostics should distinguish capacity from preparation");
assert.equal(cappedCatalogEntry.firstRankSlotsRemaining, 0);
assert.equal(api.buyUpgrade(cappedCandidate.id), false, "the direct purchase path must enforce the four-node cap");
const cappedWorkshopSave = JSON.parse(localData.get("depth-zero-save-v1"));
assert.equal(cappedWorkshopSave.version, 15, "the final-seal campaign state requires save schema v15");
assert.equal(cappedWorkshopSave.workshopInstallRun, 1);
assert.equal(cappedWorkshopSave.workshopInstalledIds.length, 4, "the exact set of first-ranked nodes must persist");
assert.match(elementFor("#upgradeMapStatus").textContent, /4\/4/, "the workshop tracker should explain the exhausted capacity");
api.startRun({ seed: 14003 });
api.stepRun(8);
assert.equal(
  api.getUpgradeCatalog().find((upgrade) => upgrade.id === cappedCandidate.id).available,
  true,
  "the next completed shift must reset first-rank capacity",
);
assert.equal(api.buyUpgrade(cappedCandidate.id), true);
api.debugResetProgress();

grantWorkshopBudget(api);
api.openUpgrades();
assert.equal(api.buyUpgrade("core_first_descent"), true);
api.startRun({ seed: 14004 });
api.stepRun(8);
grantWorkshopBudget(api);
const prioritizedWorkshopPurchase = api.debugAutoBuyAffordable(1);
assert.deepEqual(
  prioritizedWorkshopPurchase.bought,
  ["sense_instinct_spark"],
  "with multiple first-rank slots left, auto-buy must preserve the original economic ordering",
);
maxWorkshopUpgrade(api, "sense_instinct_spark");
assert.equal(api.buyUpgrade("dig_arm_swing"), true);
maxWorkshopUpgrade(api, "dig_arm_swing");
assert.equal(api.buyUpgrade("time_extra_breath"), true);
maxWorkshopUpgrade(api, "time_extra_breath");
const lastSlotWorkshopPurchase = api.debugAutoBuyAffordable(1);
assert.deepEqual(
  lastSlotWorkshopPurchase.bought,
  ["gadgets_powder_pocket"],
  "the last contested first-rank slot should prefer a non-capstone mechanic to a cheaper new scalar",
);
const automatedWorkshop = api.debugAutoBuyAffordable(199);
const automatedWorkshopSave = JSON.parse(localData.get("depth-zero-save-v1"));
assert.ok(automatedWorkshop.bought.length > 0, "auto-buy should continue buying ranks after opening four nodes");
assert.equal(automatedWorkshopSave.workshopInstalledIds.length, 4, "auto-buy must obey the distinct first-rank cap");
assert.ok(automatedWorkshopSave.workshopLevelsInstalled <= 35, "auto-buy must never exceed total workshop capacity");
assert.equal(new Set(automatedWorkshopSave.workshopInstalledIds).size, 4);
assert.equal(automatedWorkshopSave.workshopInstalledIds[3], "gadgets_powder_pocket", "the mechanic reservation belongs only to the final slot");
api.debugResetProgress();

// A late-game workshop can have hundreds of affordable ranks and no first-rank
// bottleneck. Bound that pathological Buy Max dump independently, and expose a
// specific reason instead of pretending the player ran out of ore.
api.setAllUpgrades(true);
for (const upgrade of initialUpgradeCatalog.filter((entry) => entry.maxLevel > 1)) {
  api.setUpgradeLevel(upgrade.id, 1);
}
grantWorkshopBudget(api);
const levelsBeforeWorkshopCap = api.getSnapshot().purchasedLevels;
const levelCappedPurchase = api.debugAutoBuyAffordable(199);
assert.equal(levelCappedPurchase.purchasedLevels - levelsBeforeWorkshopCap, 35);
const levelCappedSave = JSON.parse(localData.get("depth-zero-save-v1"));
assert.equal(levelCappedSave.workshopLevelsInstalled, 35);
assert.ok(
  api.getUpgradeCatalog().some((upgrade) => upgrade.pendingReason === "level-capacity"),
  "catalog diagnostics must expose the exhausted total-installation capacity",
);
api.debugResetProgress();

// Branch capstones are milestones, not last-slot reservation candidates.
api.setAllUpgrades(true);
api.setUpgradeLevel("sense_earth_call", 0);
api.setUpgradeLevel("sense_instinct_spark", 0);
api.setUpgradeLevel("dig_arm_swing", 0);
api.setUpgradeLevel("time_extra_breath", 0);
api.setUpgradeLevel("power_sharpened_edge", 0);
grantWorkshopBudget(api);
const capstoneCatalog = api.getUpgradeCatalog();
assert.equal(capstoneCatalog.find((upgrade) => upgrade.id === "sense_earth_call").capstone, true);
assert.equal(capstoneCatalog.find((upgrade) => upgrade.id === "sense_earth_call").breakthrough, true);
assert.equal(capstoneCatalog.find((upgrade) => upgrade.id === "gadgets_shock_capsule").capstone, false);
assert.equal(api.buyUpgrade("dig_arm_swing"), true);
maxWorkshopUpgrade(api, "dig_arm_swing");
assert.equal(api.buyUpgrade("time_extra_breath"), true);
maxWorkshopUpgrade(api, "time_extra_breath");
assert.equal(api.buyUpgrade("power_sharpened_edge"), true);
maxWorkshopUpgrade(api, "power_sharpened_edge");
assert.deepEqual(
  api.debugAutoBuyAffordable(1).bought,
  ["sense_instinct_spark"],
  "a capstone must not displace the original scalar candidate in the last slot",
);
api.debugResetProgress();

function placeOre(tx, ty, oreId, veinId, hp = 1000) {
  return api.debugPatchTile(tx, ty, {
    kind: "stone",
    oreId,
    veinId,
    hp,
    maxHp: hp,
    discovered: true,
    cracked: 0,
  });
}

function placeRock(tx, ty, hp = 1) {
  return api.debugPatchTile(tx, ty, {
    kind: "stone",
    oreId: null,
    veinId: null,
    hp,
    maxHp: hp,
    discovered: true,
    cracked: 0,
  });
}

function clearTile(tx, ty) {
  return api.debugPatchTile(tx, ty, {
    kind: "air",
    oreId: null,
    veinId: null,
    hp: 0,
    maxHp: 0,
    discovered: true,
    cracked: 0,
  });
}

// Tool progression must become visibly more forceful even when a late tool
// one-shots the rock before its crack stages can be seen.
api.debugResetProgress();
api.setAllUpgrades(false);
api.startRun({ seed: "runtime-base-rock-break-fx", sectorId: "stable_strata" });
placeRock(12, 24, 1);
assert.equal(api.debugBreakTileWithSource(12, 24, "pick"), true);
const baseRockFx = api.getSnapshot().visualEffects;
assert.equal(baseRockFx.particles, 4, "a starter pick should keep ordinary rock feedback restrained");
assert.equal(baseRockFx.shocks, 0, "a starter pick must not look like a late-game fracture tool");
api.finishRun();

api.debugResetProgress();
api.setAllUpgrades(false);
api.setUpgradeLevel("tools_super_pick", 1);
api.startRun({ seed: "runtime-super-rock-break-fx", sectorId: "stable_strata" });
placeRock(12, 24, 1);
assert.equal(api.debugBreakTileWithSource(12, 24, "pick"), true);
const superRockFx = api.getSnapshot().visualEffects;
assert.ok(superRockFx.particles >= 13, "super-pick rock must throw extra debris and bright fracture sparks");
assert.equal(superRockFx.shocks, 1, "super-pick rock must show one bounded fracture ring");
assert.ok(superRockFx.shake >= 1.9, "super-pick rock must have a stronger but bounded impact");
api.finishRun();

// Ore Focus is selected in the workshop before a shift. In a run it is a
// passive, bottom-centred status readout: it must neither open a picker nor
// pause the timer on touch devices.
api.debugResetProgress();
api.setUpgradeLevel("sense_ore_focus", 1);
api.grantOre("copper", 1);
api.startRun({ seed: "runtime-run-focus-picker", sectorId: "stable_strata" });
const runFocusHud = elementFor("#focusHud");
assert.equal(runFocusHud.classList.contains("hidden"), false, "an unlocked focus must remain visible during a shift");
assert.equal((runFocusHud.listeners.get("click") || []).length, 0, "the in-run focus must be passive status, not a control");
const runFocusTimeBeforeReadout = api.getSnapshot().timeLeft;
runFocusHud.click();
api.stepRun(0.25);
assert.equal(api.getSnapshot().paused, false, "reading focus must never pause a shift");
assert.ok(api.getSnapshot().timeLeft < runFocusTimeBeforeReadout, "the passive focus readout must not freeze the timer");
assert.equal(api.getSnapshot().focusedOreId, null, "a run HUD click must not alter workshop-selected focus");
api.setFocusedOre("copper");
assert.equal(api.getSnapshot().focusedOreId, "copper", "the workshop/debug selection remains the single focus source");
assert.match(runFocusHud.title, /радиус/i, "the passive HUD must communicate the current focus bonus");
api.finishRun();

// Discovery is permanent visual knowledge, independent of the live sense
// radius. A locked target is also readable immediately even before discovery.
api.debugResetProgress();
api.setAllUpgrades(false);
api.setFocusedOre(null);
api.startRun({ seed: "runtime-ore-visual-memory", sectorId: "stable_strata" });
api.debugSetPlayerTile(40, 20);
placeOre(62, 20, "copper", "remembered-visual", 100);
const rememberedOreVisual = api.debugGetOreVisualState(62, 20);
assert.equal(rememberedOreVisual.sensed, false, "the remembered ore fixture must be outside current sense");
assert.equal(rememberedOreVisual.visible, true, "a discovered ore must never become grey/hidden outside current sense");
api.debugPatchTile(66, 20, {
  kind: "stone",
  oreId: "copper",
  veinId: "locked-undiscovered-visual",
  hp: 100,
  maxHp: 100,
  discovered: false,
  cracked: 0,
});
assert.ok(api.debugSetTargetTile(66, 20));
const lockedOreVisual = api.debugGetOreVisualState(66, 20);
assert.equal(lockedOreVisual.sensed, false, "the locked fixture must remain beyond the natural sense radius");
assert.equal(lockedOreVisual.isLockedTarget, true);
assert.equal(lockedOreVisual.visible, true, "a target lock must reveal an otherwise undiscovered ore");
api.finishRun();

// Clearing every solid candidate in the original 18-tile search must make the
// fallback scan expand, drive the update loop, and reacquire after that outer
// target disappears. Exercise both contact mining and the laser movement path.
function assertExpandedExplorationContinues(tool) {
  api.debugResetProgress();
  api.setAllUpgrades(false);
  if (tool === "laser") api.setUpgradeLevel("tools_laser_emitter", 1);
  api.setFocusedOre(null);
  api.startRun({ seed: `runtime-expanded-exploration-${tool}`, sectorId: "stable_strata" });
  api.debugScheduleGlobalEvent();
  const explorationCenter = { tx: Math.floor(global.DepthZeroWorld.WORLD_CONFIG.WIDTH / 2), ty: 40 };
  api.debugSetPlayerTile(explorationCenter.tx, explorationCenter.ty);
  for (let ty = explorationCenter.ty - 6; ty <= explorationCenter.ty + 18; ty += 1) {
    for (let tx = explorationCenter.tx - 18; tx <= explorationCenter.tx + 18; tx += 1) {
      const tileDistance = Math.hypot(tx - explorationCenter.tx, ty - explorationCenter.ty);
      const tile = api.debugGetTile(tx, ty);
      if (tileDistance <= 18 && tile?.kind !== "air" && tile?.kind !== "bedrock") clearTile(tx, ty);
    }
  }
  placeRock(explorationCenter.tx, explorationCenter.ty + 24, 100);
  const expandedTarget = api.debugFindExplorationTarget();
  assert.ok(expandedTarget, `${tool}: an emptied local pocket must still produce an exploration target`);
  assert.ok(
    expandedTarget.explorationRadius >= 30,
    `${tool}: the exploration scan must expand beyond 18 tiles (${JSON.stringify(expandedTarget)})`,
  );

  const playerBefore = api.getSnapshot().player;
  api.stepRun(0.8);
  let explorationSnapshot = api.getSnapshot();
  assert.equal(explorationSnapshot.target?.kind, "exploration", `${tool}: the update loop must install the expanded target`);
  assert.ok(
    Math.hypot(
      explorationSnapshot.player.x - playerBefore.x,
      explorationSnapshot.player.y - playerBefore.y,
    ) > 1,
    `${tool}: the miner must move toward work outside the emptied pocket`,
  );

  const firstTarget = { tx: explorationSnapshot.target.tx, ty: explorationSnapshot.target.ty };
  clearTile(firstTarget.tx, firstTarget.ty);
  api.stepRun(0.1);
  explorationSnapshot = api.getSnapshot();
  assert.ok(explorationSnapshot.target, `${tool}: clearing the outer target must immediately acquire more work`);
  assert.notDeepEqual(
    [explorationSnapshot.target.tx, explorationSnapshot.target.ty],
    [firstTarget.tx, firstTarget.ty],
    `${tool}: the cleared exploration target must not remain locked`,
  );
  api.finishRun();
}

assertExpandedExplorationContinues("pick");
assertExpandedExplorationContinues("laser");

// Solar Drill is an actual delayed attack, not only a normalized stat. Its
// fifth shot must queue the burst; advancing time with attacks suppressed must
// apply the held beam/final blast and damage the perpendicular neighboring tile.
api.debugResetProgress();
api.setAllUpgrades(false);
api.setUpgradeLevel("tools_laser_emitter", 1);
api.setUpgradeLevel("core_bon_voyage", 1);
api.setFocusedOre(null);
api.startRun({ seed: "runtime-solar-drill-burst", sectorId: "stable_strata" });
api.debugScheduleGlobalEvent();
api.debugSetPlayerTile(40, 20);
for (let ty = 18; ty <= 22; ty += 1) {
  for (let tx = 39; tx <= 45; tx += 1) clearTile(tx, ty);
}
placeOre(44, 20, "star_core", "solar-burst-target", 1_000);
placeRock(44, 21, 1);
assert.ok(api.debugSetTargetTile(44, 20));
const solarBurstsBefore = api.getSnapshot().metrics.solarDrillBursts;
for (let shot = 0; shot < 4; shot += 1) assert.ok(api.attackNow());
assert.equal(api.getSnapshot().metrics.solarDrillBursts, solarBurstsBefore, "Solar Drill must wait for shot five");
assert.ok(api.attackNow());
let solarSnapshot = api.getSnapshot();
assert.equal(solarSnapshot.metrics.solarDrillBursts, solarBurstsBefore + 1, "the fifth laser shot must queue Solar Drill");
assert.equal(api.debugGetTile(44, 21).hp, 1, "the perpendicular fixture must not be hit by the direct laser");
const solarTargetAfterShot = api.debugGetTile(44, 20).hp;
api.debugSetAttackCooldown(100);
api.stepRun(0.8);
solarSnapshot = api.getSnapshot();
assert.ok(api.debugGetTile(44, 20).hp < solarTargetAfterShot, "the delayed Solar Drill beam must damage its target");
assert.equal(api.debugGetTile(44, 21).kind, "air", "the Solar Drill final burst must damage its local area");
assert.ok((solarSnapshot.metrics.sourceBreaks.solar || 0) > 0, "Solar Drill breaks must be attributed to the solar source");
api.finishRun();

// The finale is reached by breaching the indestructible planetary seal with
// three completed Solar Drill bursts, not by a separate qualification counter.
api.debugResetProgress();
api.setAllUpgrades(true);
api.startRun({ seed: "runtime-final-seal-breach", sectorId: "stable_strata" });
const finalLayerTy = global.DepthZeroWorld.FINAL_LAYER_TY;
const finalLayerTx = Math.floor(global.DepthZeroWorld.WORLD_CONFIG.WIDTH / 2);
api.debugSetPlayerTile(finalLayerTx, finalLayerTy - 1);
api.stepRun(0.05);
assert.equal(api.getSnapshot().target?.kind, "final_seal", "Solar Drill must prioritize the final layer when it is reached");
for (let strike = 0; strike < 3; strike += 1) {
  for (let shot = 0; shot < 5; shot += 1) assert.ok(api.attackNow(), "the Solar Drill must receive its fifth shot");
  api.debugSetAttackCooldown(100);
  api.stepRun(0.8);
}
assert.equal(api.getSnapshot().mode, "ending", "the third Solar Drill strike must open the comic finale");
assert.equal(api.getSnapshot().campaign.ready, true, "a breached seal must complete the campaign");
assert.equal(elementFor("#endingScreen").classList.contains("hidden"), false, "the comic must become visible immediately after the breach");
elementFor("#endingResetProgress").click();
assert.equal(api.getSnapshot().campaign.ready, false, "the ending reset button must clear completed campaign state");
assert.equal(api.getSnapshot().mode, "title", "the ending reset button must return to a clean title state");

// Runtime depth records are expressed in authored metres: twenty vertical
// tiles from the surface origin must advance the record by about 100 metres.
api.debugResetProgress();
api.setAllUpgrades(false);
api.startRun({ seed: "runtime-depth-metres", sectorId: "stable_strata" });
const depthStartPlayer = api.getSnapshot().player;
const depthTileSize = global.DepthZeroWorld.WORLD_CONFIG.TILE_SIZE;
const depthStartTile = {
  tx: Math.floor(depthStartPlayer.x / depthTileSize),
  ty: Math.floor(depthStartPlayer.y / depthTileSize),
};
api.debugSetPlayerTile(depthStartTile.tx, depthStartTile.ty + 20);
api.stepRun(0.001);
assert.ok(
  Math.abs(api.getSnapshot().deepest - 100) < 1,
  `twenty depth tiles must equal 100 metres, got ${api.getSnapshot().deepest}`,
);
api.finishRun();
api.debugResetProgress();

api.setAllUpgrades(true);
const fullStats = api.getStats();
assert.equal(fullStats.runDuration, 45, "direct timer upgrades must stop at 45 seconds");
assert.equal(fullStats.bonusRunDurationCap, 60, "bonus runtime cap must be 60 seconds");
assert.equal(fullStats.backupTargetSlots, 1);
assert.equal(fullStats.oreFocusEscalationBonus, 0.75);
assert.equal(fullStats.mineLiftRecordDepthRatio, 0.45);
assert.equal(fullStats.discoveryTimeBonus, 0.48);
assert.equal(fullStats.directionalBombConeTiles, 3);
assert.equal(fullStats.laserRicochetCount, 2);
assert.equal(fullStats.oreDiversityBonusPerType, 0.06);
assert.equal(fullStats.deafKnockStoneThreshold, 8);
assert.equal(fullStats.deafKnockSenseRadiusMultiplier, 1.4);
assert.equal(fullStats.triangularFixUnlocked, true);
assert.equal(fullStats.triangularFixGadgetDamageBonus, 0.25);
assert.equal(fullStats.triangularFixRangeBonus, 0.2);
assert.equal(fullStats.laserSuperPickEchoEvery, 4);
assert.equal(fullStats.laserSuperPickEchoRadiusTiles, 1.4);
assert.equal(fullStats.laserSuperPickEchoPower, 0.85);

api.startRun({ seed: "runtime-depth-contract", sectorId: "stable_strata" });
const contractPlayer = api.getSnapshot().player;
const contractTileSize = global.DepthZeroWorld.WORLD_CONFIG.TILE_SIZE;
const contractOriginTile = {
  tx: Math.floor(contractPlayer.x / contractTileSize),
  ty: Math.floor(contractPlayer.y / contractTileSize),
};
assert.equal(api.debugDepthAtTile(contractOriginTile.tx, contractOriginTile.ty + 20), 100);
assert.equal(
  api.debugDepthContractStacksAtTile(contractOriginTile.tx, contractOriginTile.ty + 20),
  1,
  "the depth contract must award its first stack at 100 authored metres",
);
assert.equal(
  api.debugDepthContractStacksAtTile(contractOriginTile.tx, contractOriginTile.ty + 160),
  8,
  "the deep shaft must make all eight 100-metre contract stacks reachable",
);
api.finishRun();
api.debugResetProgress();
api.setAllUpgrades(true);

// Every redesigned perk must survive the upgrades -> runtime normalization
// boundary. Keep this exhaustive: a missing field silently turns an installed
// tree node into a cosmetic purchase.
const expectedRuntimePerkStats = {
  echoPingCooldown: 3,
  echoPingRadiusMultiplier: 1.55,
  echoPingTargetHold: 1.2,
  veinTrailRangeMultiplier: 1.65,
  veinTrailMoveSpeedBonus: 0.2,
  seismicRouteSlots: 3,
  ghostTrailDuration: 4,
  ghostTrailMaxLayers: 3,
  ghostTrailThroughWalls: true,
  veinLockEnabled: true,
  veinLockRangeMultiplier: 1.6,
  veinLockMoveSpeedBonus: 0.2,
  approachStrikeTravelTime: 0.9,
  approachStrikePower: 1,
  approachStrikeSideChip: 0.45,
  focusVeinSizeBias: 1.2,
  focusMoveSpeedPerNode: 0.12,
  sideChipEvery: 1,
  sideChipHits: 2,
  sideChipPower: 0.6,
  impactWaveEvery: 4,
  impactWaveRadiusTiles: 1.5,
  impactWavePower: 0.65,
  quarryModeRequiredBreaks: 3,
  quarryModeWindow: 1.2,
  quarryModeDuration: 2.5,
  quarryModeMoveSpeedBonus: 0.25,
  quarryModeDigSpeedBonus: 0.25,
  quarryModeSideFracturePower: 0.4,
  faultLineMaxBlocks: 4,
  faultLinePower: 0.75,
  faultLineExtendOnBreak: true,
  overkillReservoirRatio: 0.85,
  chronoOverdrive: true,
  chronoOverflowThreshold: 45,
  chronoOverflowSpeedBonus: 0.25,
  chronoOverflowProcEvery: 5,
  magneticFieldEnabled: true,
  magneticFieldDuration: 4.8,
  magneticFieldRadiusTiles: 6,
  magneticFieldTargetingBonus: 0.72,
  demolitionComboEnabled: true,
  demolitionComboMarkDuration: 3,
  demolitionComboFinishPower: 0.75,
  demolitionComboVeinRadiusTiles: 2,
  superFieldEnabled: true,
  superFieldRadiusTiles: 1.75,
  superFieldPower: 0.6,
  superFieldDuration: 1.6,
  superFieldLaserPersistent: true,
  laserHeatEdgePower: 0.45,
  laserHeatDuration: 1.2,
  laserHeatNextHitBonus: 0.3,
  solarDrillEnabled: true,
  solarDrillProcEvery: 5,
  solarDrillBeamDuration: 0.7,
  solarDrillFinalBurstPower: 0.9,
  rareOreAdditiveChance: 0.18,
  goldenOreAdditiveChance: 0.075,
  richVeinWholeChance: 0.18,
  richVeinYieldBonus: 0.5,
  richVeinCompletionBonus: 6,
  tripleSampleEvery: 3,
  tripleSampleBonusYield: 2,
  tripleSampleNextNodeDamage: 0.5,
  depthContractStep: 100,
  depthContractBonusPerStack: 0.18,
  depthContractMaxStacks: 8,
  relicEffectChance: 0.075,
  relicEffectDuration: 6,
  relicEffectPower: 0.4,
  fortuneWheelEnabled: true,
  fortunePityThreshold: 5,
  fortuneWheelCycleLength: 4,
  motherlodeGuaranteed: true,
  motherlodeTriggerBreaks: 20,
  motherlodeYieldMultiplier: 2,
  motherlodeCompletionCache: 6,
  motherlodeCompletionTimeBonus: 2.5,
};
for (const [key, expected] of Object.entries(expectedRuntimePerkStats)) {
  assert.equal(fullStats[key], expected, `runtime stat contract ${key}`);
}

api.openUpgrades();
assert.equal(api.getSnapshot().mode, "upgrades", "the 102-node radial map should render without a runtime error");
const radialLayout = api.debugGetUpgradeLayout();
const radialRoot = radialLayout.positions.core_first_descent;
assert.equal(radialRoot.x + 31, radialLayout.centerX, "the single root must sit at the horizontal center");
assert.equal(radialRoot.y + 31, radialLayout.centerY, "the single root must sit at the vertical center");
const radialNodes = Object.entries(radialLayout.positions).map(([id, point]) => ({
  id,
  x: point.x,
  y: point.y,
  width: radialLayout.sizes[id].width,
  height: radialLayout.sizes[id].height,
}));
let closestRadialBoxGap = Infinity;
let closestRadialBoxPair = "";
for (let left = 0; left < radialNodes.length; left += 1) {
  for (let right = left + 1; right < radialNodes.length; right += 1) {
    const a = radialNodes[left];
    const b = radialNodes[right];
    const horizontalGap = Math.abs((a.x + a.width * 0.5) - (b.x + b.width * 0.5))
      - (a.width + b.width) * 0.5;
    const verticalGap = Math.abs((a.y + a.height * 0.5) - (b.y + b.height * 0.5))
      - (a.height + b.height) * 0.5;
    const boxGap = Math.max(horizontalGap, verticalGap);
    if (boxGap < closestRadialBoxGap) {
      closestRadialBoxGap = boxGap;
      closestRadialBoxPair = `${a.id} <> ${b.id}`;
    }
  }
}
assert.ok(
  closestRadialBoxGap >= radialLayout.minimumGap - 0.01,
  `radial upgrade boxes need ${radialLayout.minimumGap}px of clear space; closest is ${closestRadialBoxGap}px (${closestRadialBoxPair})`,
);

api.setFocusedOre("copper");
api.setBestDepth(100);
api.grantOre("gold", 1);
api.startRun({ seed: "runtime-lift", sectorId: "stable_strata" });
let snapshot = api.getSnapshot();
assert.equal(snapshot.mode, "run");
assert.ok(snapshot.liftDepth > 0, "mine lift should start below the surface after a depth record");
assert.equal(snapshot.metrics.liftStarts, 1);
assert.ok(
  ["copper", "coal", "iron", "amber"].includes(snapshot.liftSupplyOreId),
  `the lift must retune its one landing sample to an opening-economy ore, got ${snapshot.liftSupplyOreId}`,
);
const liftLandingTx = Math.floor(snapshot.player.x / global.DepthZeroWorld.WORLD_CONFIG.TILE_SIZE);
const liftLandingTy = Math.floor(snapshot.player.y / global.DepthZeroWorld.WORLD_CONFIG.TILE_SIZE);
const liftExplorationFloor = liftLandingTy - 2;
assert.equal(
  api.debugGetExplorationSearchMinTy(18, false),
  liftExplorationFloor,
  "local exploration must not scan ordinary terrain above a lift landing",
);
assert.equal(
  api.debugGetExplorationSearchMinTy(Math.hypot(
    global.DepthZeroWorld.WORLD_CONFIG.WIDTH,
    global.DepthZeroWorld.WORLD_CONFIG.HEIGHT,
  ), true),
  liftExplorationFloor,
  "the full-world exploration fallback must preserve the lift floor",
);
const liftExplorationTarget = api.debugFindExplorationTarget();
assert.ok(
  !liftExplorationTarget || liftExplorationTarget.ty >= liftExplorationFloor,
  "ordinary exploration routing must never climb into strata skipped by the lift",
);
const worldPixelWidth = global.DepthZeroWorld.WORLD_CONFIG.WIDTH
  * global.DepthZeroWorld.WORLD_CONFIG.TILE_SIZE;
const cameraZoom = 0.9;
assert.deepEqual(
  api.debugGetHorizontalCameraBounds(worldPixelWidth - 640),
  { min: 0, max: worldPixelWidth - (worldPixelWidth - 640) / cameraZoom },
  "the zoomed-out camera must retain normal horizontal scrolling",
);
assert.deepEqual(
  api.debugGetHorizontalCameraBounds(worldPixelWidth + 640),
  {
    min: (worldPixelWidth - (worldPixelWidth + 640) / cameraZoom) * 0.5,
    max: (worldPixelWidth - (worldPixelWidth + 640) / cameraZoom) * 0.5,
  },
  "a zoomed-out viewport wider than the mine must center equal letterbox margins",
);
placeOre(liftLandingTx - 3, liftLandingTy - 4, "copper", "skipped-upper-strata", 1);

const escalated = api.forceFocusMiss(3.5);
assert.ok(escalated > 2.15, "focus search radius should escalate after the delay");

const targetPair = api.acquireTargets();
assert.ok(targetPair?.primary && targetPair?.backup, "second fix should keep a distinct backup target");
assert.ok(targetPair.primary.ty >= liftLandingTy - 2, "the miner must not route back above a lift landing");
assert.ok(targetPair.backup.ty >= liftLandingTy - 2, "the backup route must respect the same lift floor");
const cooldownBeforePulse = api.debugSetAttackCooldown(0.42);
api.triggerSensePulse();
const pulseSnapshot = api.getSnapshot();
assert.equal(pulseSnapshot.attackCooldown, cooldownBeforePulse, "a canvas pulse must not grant a free hit or reset attack cadence");
assert.ok(pulseSnapshot.manualPulseCooldown > 0, "a canvas pulse must debounce repeated pointer input");
const targetSearchComparison = api.debugCompareIndexedTargetSearch();
assert.ok(targetSearchComparison?.same, `indexed target search must match brute force: ${JSON.stringify(targetSearchComparison)}`);
assert.ok(api.getSnapshot().crewBeacon?.veinId, "crew beacon should mark the primary vein");
assert.equal(api.breakCurrentTarget(), true);
assert.equal(api.promoteBackup(), true);
assert.equal(api.getSnapshot().metrics.backupPromotions, 1);

assert.ok(api.breakNearestOre("copper"), "a copper tile should be breakable in the generated world");
snapshot = api.getSnapshot();
assert.equal(snapshot.metrics.discoveryBonuses, 1, "the first ore type should grant discovery time once");
const firstBonus = snapshot.bonusTimeEarned;
assert.ok(firstBonus > 0 && firstBonus <= 0.480001);

assert.ok(api.breakNearestOre("copper"));
assert.equal(api.getSnapshot().metrics.discoveryBonuses, 1, "a repeated ore type must not grant time twice");
assert.ok(api.breakNearestOre("coal"), "a second ore type should be available");
snapshot = api.getSnapshot();
assert.equal(snapshot.metrics.discoveryBonuses, 2);
assert.equal(snapshot.discoveredOreTypes.length, 2);

assert.equal(api.forceDetonate(), true);
assert.ok(api.getSnapshot().metrics.directionalBlasts >= 1, "geocharges should use a directional blast");

const laserProbePlayer = api.getSnapshot().player;
const laserProbeTx = Math.floor(laserProbePlayer.x / global.DepthZeroWorld.WORLD_CONFIG.TILE_SIZE);
const laserProbeTy = Math.floor(laserProbePlayer.y / global.DepthZeroWorld.WORLD_CONFIG.TILE_SIZE);
placeOre(laserProbeTx + 2, laserProbeTy + 1, "copper", "mirror-primary", 1000);
placeOre(laserProbeTx + 3, laserProbeTy + 4, "copper", "mirror-ricochet", 1000);
assert.ok(api.debugSetTargetTile(laserProbeTx + 2, laserProbeTy + 1));
assert.equal(api.attackNow(), true);
assert.ok(api.getSnapshot().metrics.laserRicochets >= 1, "mirror crystal should emit at least one extra laser segment");

api.stepRun(0.8);
snapshot = api.getSnapshot();
assert.ok(snapshot.activeWallElapsed > 0);
assert.ok(snapshot.timeLeft <= 60);

for (let index = 0; index < 24; index += 1) api.breakNearestOre(index % 2 ? "copper" : "coal");
api.finishRun();
snapshot = api.getSnapshot();
assert.equal(snapshot.mode, "result");
assert.ok(snapshot.metrics.catalogBonusPieces > 0, "catalog should add deterministic final-haul pieces");

api.setAllUpgrades(false);
api.setUpgradeLevel("dig_least_resistance", 1);
api.setFocusedOre(null);
api.startRun({ seed: "runtime-route", sectorId: "stable_strata" });
assert.ok(api.acquireTargets()?.primary);
assert.ok(api.computeCurrentRoute(), "least-resistance route should be calculable for the selected target");
api.stepRun(0.01);
snapshot = api.getSnapshot();
assert.ok(snapshot.pathWaypoint, "runtime navigation should install a route waypoint");
api.finishRun();

// The miner collision body is wider than a center-line pick ray. When moving
// diagonally through a one-tile corner, the adjacent contact block must receive
// the real pick hit instead of an invisible 45% clearance tick.
api.setAllUpgrades(false);
api.setUpgradeLevel("sense_instinct_spark", 1);
api.setFocusedOre(null);
api.startRun({ seed: "runtime-point-blank-pick", sectorId: "stable_strata" });
api.debugSetPlayerTile(40, 20);
for (let ty = 16; ty <= 26; ty += 1) {
  for (let tx = 36; tx <= 47; tx += 1) clearTile(tx, ty);
}
placeOre(42, 22, "copper", "point-blank-target", 100);
placeRock(40, 21, 100);
assert.ok(api.debugSetTargetTile(42, 22));
const pointBlankPower = api.getStats().pickPower;
const pointBlankBefore = api.debugGetTile(40, 21).hp;
const distantTargetBefore = api.debugGetTile(42, 22).hp;
assert.equal(api.attackNow(), true);
const pointBlankDamage = pointBlankBefore - api.debugGetTile(40, 21).hp;
assert.ok(
  Math.abs(pointBlankDamage - pointBlankPower) < 1e-9,
  `a side block touching the miner must receive one full pick hit (${pointBlankDamage}/${pointBlankPower})`,
);
assert.equal(
  api.debugGetTile(42, 22).hp,
  distantTargetBefore,
  "fixing point-blank contact must not grant remote damage to the ore beyond reach",
);
placeRock(40, 21, 1);
const pointBlankPlayerBefore = api.getSnapshot().player;
api.stepRun(0.65);
assert.equal(api.debugGetTile(40, 21).kind, "air", "automatic mining must break the contact block at normal power");
const pointBlankPlayerAfter = api.getSnapshot().player;
assert.ok(
  Math.hypot(pointBlankPlayerAfter.x - pointBlankPlayerBefore.x, pointBlankPlayerAfter.y - pointBlankPlayerBefore.y) > 1,
  "the miner must resume moving after clearing the point-blank obstruction",
);
api.finishRun();

// A neighbouring wall may overlap only the miner body's padded contact ray.
// It must not steal a clean, point-blank strike from the ore directly ahead.
api.setAllUpgrades(false);
api.setFocusedOre(null);
api.startRun({ seed: "runtime-point-blank-pressed-ore", sectorId: "stable_strata" });
api.debugScheduleGlobalEvent();
for (let ty = 17; ty <= 23; ty += 1) {
  for (let tx = 37; tx <= 44; tx += 1) clearTile(tx, ty);
}
const pressedOreTileSize = global.DepthZeroWorld.WORLD_CONFIG.TILE_SIZE;
const pressedOrePower = api.getStats().pickPower;
const pressedOreCases = [
  { name: "right", target: [41, 20], wall: [40, 19], player: [40.5, 20.5 - 8 / pressedOreTileSize] },
  { name: "left", target: [39, 20], wall: [40, 21], player: [40.5, 20.5 + 8 / pressedOreTileSize] },
  { name: "down", target: [40, 21], wall: [41, 20], player: [40.5 + 8 / pressedOreTileSize, 20.5] },
  { name: "up", target: [40, 19], wall: [39, 20], player: [40.5 - 8 / pressedOreTileSize, 20.5] },
];
for (const pressedCase of pressedOreCases) {
  for (let ty = 18; ty <= 22; ty += 1) {
    for (let tx = 38; tx <= 42; tx += 1) clearTile(tx, ty);
  }
  placeOre(...pressedCase.target, "copper", `pressed-ore-${pressedCase.name}`, 100);
  placeRock(...pressedCase.wall, 100);
  api.debugSetPlayerPosition(
    pressedCase.player[0] * pressedOreTileSize,
    pressedCase.player[1] * pressedOreTileSize,
  );
  assert.ok(api.debugSetTargetTile(...pressedCase.target));
  const pressedOreBefore = api.debugGetTile(...pressedCase.target).hp;
  const grazingWallBefore = api.debugGetTile(...pressedCase.wall).hp;
  assert.equal(api.attackNow(), true);
  assert.ok(
    Math.abs(pressedOreBefore - api.debugGetTile(...pressedCase.target).hp - pressedOrePower) < 1e-9,
    `${pressedCase.name}: point-blank ore must receive the full pick hit while the miner brushes a side wall`,
  );
  assert.equal(
    api.debugGetTile(...pressedCase.wall).hp,
    grazingWallBefore,
    `${pressedCase.name}: a padded-only side contact must not steal the adjacent ore strike`,
  );
}
api.finishRun();

// Equal candidates must not make the miner reverse direction every targeting
// tick. A live incumbent stays locked until it is gone; then the twin is used.
api.setAllUpgrades(false);
api.setFocusedOre(null);
api.startRun({ seed: "runtime-equal-target-lock", sectorId: "stable_strata" });
api.debugScheduleGlobalEvent();
api.debugSetPlayerTile(40, 20);
for (let ty = 16; ty <= 24; ty += 1) {
  for (let tx = 35; tx <= 45; tx += 1) clearTile(tx, ty);
}
placeOre(39, 20, "copper", "equal-left", 1_000_000);
placeOre(41, 20, "copper", "equal-right", 1_000_000);
assert.ok(api.debugSetTargetTile(41, 20));
const equalTargetSwitches = api.getSnapshot().metrics.targetSwitches;
api.stepRun(0.13);
snapshot = api.getSnapshot();
assert.deepEqual([snapshot.target?.tx, snapshot.target?.ty], [41, 20]);
assert.equal(snapshot.metrics.targetSwitches, equalTargetSwitches, "an equal row-major rival must not steal the live target");
assert.ok(api.debugBreakTileWithSource(41, 20, "debug"));
api.stepRun(0.13);
snapshot = api.getSnapshot();
assert.deepEqual([snapshot.target?.tx, snapshot.target?.ty], [39, 20], "the remaining twin must be acquired after the incumbent breaks");
api.finishRun();

api.setAllUpgrades(false);
api.setUpgradeLevel("sense_ore_focus", 1);
api.setUpgradeLevel("power_sample_calibration", 4);
api.setFocusedOre("copper");
api.startRun({ seed: "runtime-focused-calibration", sectorId: "stable_strata" });
assert.ok(api.acquireTargets()?.primary);
assert.equal(api.attackNow(), true);
assert.ok(api.getSnapshot().metrics.focusedCalibrationHits >= 1, "sample calibration should add focused-only damage");
api.finishRun();

// Focus calibration must only amplify a main hit that actually reached the
// selected tile. A distant pick target previously took post-hoc remote damage.
api.setAllUpgrades(false);
api.setUpgradeLevel("sense_ore_focus", 1);
api.setUpgradeLevel("power_sample_calibration", 4);
api.setFocusedOre("star_core");
api.startRun({ seed: "runtime-remote-pick", sectorId: "stable_strata" });
api.debugSetPlayerTile(40, 20);
placeOre(50, 20, "star_core", "remote-pick", 1000);
assert.ok(api.debugSetTargetTile(50, 20));
const pickRemoteBefore = api.debugGetTile(50, 20).hp;
api.attackNow();
assert.equal(api.debugGetTile(50, 20).hp, pickRemoteBefore, "pick calibration must not damage an unreached aim target");
assert.equal(api.getSnapshot().metrics.focusedCalibrationHits, 0);
api.finishRun();

// The same invariant applies to the main laser and to a ricochet whose chosen
// target lies inside the search radius but beyond the actual beam range.
api.setAllUpgrades(true);
api.setFocusedOre("star_core");
api.startRun({ seed: "runtime-remote-laser", sectorId: "stable_strata" });
api.debugSetPlayerTile(40, 20);
placeOre(70, 20, "star_core", "remote-laser", 1000);
assert.ok(api.debugSetTargetTile(70, 20));
const laserRemoteBefore = api.debugGetTile(70, 20).hp;
api.attackNow();
assert.equal(api.debugGetTile(70, 20).hp, laserRemoteBefore, "laser calibration must not damage an aim target beyond beam range");
api.debugPatchTile(70, 20, { kind: "air", oreId: null, veinId: null, hp: 0, maxHp: 0 });
placeOre(40, 20, "star_core", "ricochet-origin", 1000);
placeOre(66, 20, "star_core", "remote-ricochet", 1000);
const ricochetRemoteBefore = api.debugGetTile(66, 20).hp;
const ricochetsBefore = api.getSnapshot().metrics.laserRicochets;
assert.ok(api.debugFireRicochetFrom(40, 20, 100));
assert.ok(api.getSnapshot().metrics.laserRicochets > ricochetsBefore, "the ricochet chain should emit at least one segment");
assert.equal(api.debugGetTile(66, 20).hp, ricochetRemoteBefore, "an unreached ricochet target must take no direct calibration damage");
api.finishRun();

const measureFocusedLaserDamage = (calibrationLevel) => {
  api.setAllUpgrades(true);
  // Redesigned secondary impacts are deliberately orthogonal to hardness
  // calibration. Disable them here so this legacy assertion continues to
  // measure the primary beam only.
  for (const upgradeId of [
    "dig_sweeping_arc",
    "dig_precision_path",
    "dig_omni_swing",
    "dig_quarry_presence",
    "power_mountain_splitter",
    "time_thirty_second_oath",
    "tools_super_field",
    "tools_laser_width",
    "tools_solar_drill",
    "fortune_alchemist_scales",
  ]) api.setUpgradeLevel(upgradeId, 0);
  api.setUpgradeLevel("power_sample_calibration", calibrationLevel);
  api.setFocusedOre("star_core");
  api.startRun({ seed: "runtime-laser-calibration", sectorId: "stable_strata" });
  api.debugSetPlayerTile(40, 20);
  api.debugPatchTile(41, 20, { kind: "air", oreId: null, veinId: null, hp: 0, maxHp: 0 });
  placeOre(42, 20, "star_core", "calibration-probe", 10000);
  assert.ok(api.debugSetTargetTile(42, 20));
  const before = api.debugGetTile(42, 20).hp;
  api.attackNow();
  const dealt = before - api.debugGetTile(42, 20).hp;
  api.finishRun();
  return dealt;
};
const uncalibratedLaserDamage = measureFocusedLaserDamage(0);
const calibratedLaserDamage = measureFocusedLaserDamage(4);
const expectedCalibrationMultiplier = 1 / (1 - fullStats.focusedOreHardnessReduction);
assert.ok(uncalibratedLaserDamage > 0);
assert.ok(
  Math.abs(calibratedLaserDamage / uncalibratedLaserDamage - expectedCalibrationMultiplier) < 1e-6,
  `focused calibration must scale aggregate beam damage: ${uncalibratedLaserDamage}/${calibratedLaserDamage}/${expectedCalibrationMultiplier}`,
);

const measureFocusedRicochetDamage = (calibrationLevel) => {
  api.setAllUpgrades(true);
  for (const upgradeId of [
    "dig_sweeping_arc",
    "dig_precision_path",
    "dig_omni_swing",
    "dig_quarry_presence",
    "power_mountain_splitter",
    "time_thirty_second_oath",
    "tools_super_field",
    "tools_laser_width",
    "tools_solar_drill",
    "fortune_alchemist_scales",
  ]) api.setUpgradeLevel(upgradeId, 0);
  api.setUpgradeLevel("power_sample_calibration", calibrationLevel);
  api.setFocusedOre("star_core");
  api.startRun({ seed: "runtime-ricochet-calibration", sectorId: "stable_strata" });
  api.debugSetPlayerTile(40, 20);
  api.debugPatchTile(41, 20, { kind: "air", oreId: null, veinId: null, hp: 0, maxHp: 0 });
  api.debugPatchTile(42, 21, { kind: "air", oreId: null, veinId: null, hp: 0, maxHp: 0 });
  placeOre(42, 20, "star_core", "ricochet-power-origin", 10000);
  placeOre(42, 22, "star_core", "ricochet-power-target", 10000);
  assert.ok(api.debugSetTargetTile(42, 20));
  const before = api.debugGetTile(42, 22).hp;
  api.attackNow();
  const dealt = before - api.debugGetTile(42, 22).hp;
  api.finishRun();
  return dealt;
};
const uncalibratedRicochetDamage = measureFocusedRicochetDamage(0);
const calibratedRicochetDamage = measureFocusedRicochetDamage(4);
assert.ok(uncalibratedRicochetDamage > 0);
assert.ok(
  Math.abs(calibratedRicochetDamage / uncalibratedRicochetDamage - expectedCalibrationMultiplier) < 1e-6,
  "ricochet power must receive focused calibration once, not inherit aggregate multi-beam damage",
);

// Once the final live tile of the marked vein is gone, the beacon must clear
// immediately and both chain lightning and drones must retarget normally in
// that same simulation tick.
api.setAllUpgrades(true);
api.setFocusedOre("star_core");
api.startRun({ seed: "runtime-beacon-exhaustion", sectorId: "stable_strata" });
api.debugSetPlayerTile(40, 20);
placeOre(41, 20, "star_core", "exhausted-beacon-vein", 1);
placeOre(42, 20, "star_core", "fallback-vein", 1000);
assert.ok(api.debugSetTargetTile(41, 20));
assert.equal(api.debugValidateCrewBeacon(), true);
assert.equal(api.breakCurrentTarget(), true);
assert.equal(api.debugValidateCrewBeacon(), false, "beacon must invalidate when its vein has no live tiles");
assert.equal(api.getSnapshot().crewBeacon, null);
const chainFallbackBefore = api.debugGetTile(42, 20).hp;
assert.ok(api.debugForceChain());
const chainFallbackAfter = api.debugGetTile(42, 20).hp;
assert.ok(chainFallbackAfter < chainFallbackBefore, "chain lightning should immediately fall back to normal focused targeting");
assert.ok(api.debugForceDrones());
assert.ok(api.debugGetTile(42, 20).hp < chainFallbackAfter, "drones should immediately fall back to normal focused targeting");
api.finishRun();

// A still-living beacon outside a gadget's local radius must not consume the
// proc: chain lightning and drones fall back to ordinary focused targeting.
api.setAllUpgrades(true);
api.setFocusedOre("star_core");
api.startRun({ seed: "runtime-beacon-range", sectorId: "stable_strata" });
api.debugSetPlayerTile(20, 20);
for (let ty = 0; ty < global.DepthZeroWorld.WORLD_CONFIG.HEIGHT; ty += 1) {
  for (let tx = 0; tx < global.DepthZeroWorld.WORLD_CONFIG.WIDTH; tx += 1) {
    if (api.debugGetTile(tx, ty)?.oreId) clearTile(tx, ty);
  }
}
const distantBeaconTx = global.DepthZeroWorld.WORLD_CONFIG.WIDTH - 10;
const distantBeaconTy = global.DepthZeroWorld.WORLD_CONFIG.HEIGHT - 10;
placeOre(distantBeaconTx, distantBeaconTy, "star_core", "distant-live-beacon", 1000);
assert.ok(api.debugSetTargetTile(distantBeaconTx, distantBeaconTy));
assert.equal(api.debugValidateCrewBeacon(), true);
placeOre(21, 20, "star_core", "nearby-fallback", 2_000_000_000);
const rangeFallbackBefore = api.debugGetTile(21, 20).hp;
assert.ok(api.debugForceChain());
const rangeFallbackAfterChain = api.debugGetTile(21, 20).hp;
assert.ok(rangeFallbackAfterChain < rangeFallbackBefore, "chain should fall back when the live beacon is out of range");
assert.equal(api.debugValidateCrewBeacon(), true, "the distant vein is still alive and should remain marked");
assert.ok(api.debugForceDrones());
assert.ok(api.debugGetTile(21, 20).hp < rangeFallbackAfterChain, "drones should also fall back without clearing a live beacon");
api.finishRun();

// Selected complex upgrades and the game-wide systems expose deterministic
// runtime hooks so their behavior, not merely their stat flags, cannot regress.
api.setAllUpgrades(true);
api.setFocusedOre(null);
api.setCompletedRuns(2);
api.requestRunStart();
assert.equal(api.getSnapshot().mode, "run", "starting a shift must skip the removed three-sector choice");
assert.match(api.getSnapshot().sector.id, /^random_strata-/, "normal shifts must roll hidden geology from their seed");
api.startRun({ seed: "deaf-knock-semantics", sectorId: "ore_ridge" });
snapshot = api.getSnapshot();
assert.equal(snapshot.sector.id, "ore_ridge");
assert.equal(api.debugGetMicroEvents().length, 1, "only the ancient container remains a physical field event");

// Deaf Knock counts ordinary rock destroyed by any normal proc-capable source.
// Ore between those breaks does not erase progress, while recursive/no-proc
// Echo damage cannot charge it. Focus still filters the enlarged pulse.
api.setFocusedOre("gold");
api.debugSetPlayerTile(40, 20);
placeOre(42, 20, "copper", "deaf-decoy", 1_000_000);
placeOre(46, 20, "gold", "deaf-focus", 1_000_000);
const deafBefore = api.getSnapshot().metrics.deafKnocks;
const firstDeafSources = ["pick", "bomb", "chain", "drone"];
for (let index = 0; index < firstDeafSources.length; index += 1) {
  placeRock(70 + index, 12);
  assert.ok(api.debugBreakTileWithSource(70 + index, 12, firstDeafSources[index]));
}
placeOre(74, 12, "coal", "deaf-interleaved-ore", 1);
assert.ok(api.debugBreakTileWithSource(74, 12, "pick"));
placeRock(75, 12);
assert.ok(api.debugBreakTileWithSource(75, 12, "echo"));
assert.equal(api.getSnapshot().dryRockBlocks, 4, "no-proc Echo rock must not charge or reset the four stored knocks");
for (let index = 0; index < 3; index += 1) {
  placeRock(76 + index, 12);
  assert.ok(api.debugBreakTileWithSource(76 + index, 12, ["bomb", "chain", "drone"][index]));
}
assert.equal(api.getSnapshot().metrics.deafKnocks, deafBefore, "the pulse must not fire before the eighth ordinary-rock break");
placeRock(79, 12);
assert.ok(api.debugBreakTileWithSource(79, 12, "pick"));
snapshot = api.getSnapshot();
assert.equal(snapshot.metrics.deafKnocks, deafBefore + 1, "the eighth qualifying rock must fire Deaf Knock");
assert.equal(snapshot.target.oreId, "gold", "focused Deaf Knock must ignore every wrong ore");
assert.ok(snapshot.deafKnockBoostRemaining > 1.1, "a successful pulse must grant the movement window");
assert.ok(snapshot.deafKnockCooldown > 2.9, "a successful pulse must start the three-second cooldown");
for (let index = 0; index < 8; index += 1) {
  placeRock(80 + index, 12);
  assert.ok(api.debugBreakTileWithSource(80 + index, 12, "laser"));
}
assert.equal(api.getSnapshot().metrics.deafKnocks, deafBefore + 1, "the cooldown must suppress an immediate second pulse");
api.finishRun();

// Super-pick Echo fires on the exact advertised cadence. Its own breaks use
// the no-proc source even when every random proc would otherwise succeed.
api.setFocusedOre(null);
api.setAllUpgrades(true);
api.setUpgradeLevel("tools_super_pick_echo", 1);
api.setUpgradeLevel("sense_deaf_knock", 0);
for (const upgradeId of ["dig_sweeping_arc", "dig_precision_path", "dig_omni_swing", "dig_quarry_presence", "tools_super_field", "tools_laser_width", "tools_solar_drill", "fortune_motherlode_covenant"]) {
  api.setUpgradeLevel(upgradeId, 0);
}
api.startRun({ seed: "echo-level-one", sectorId: "stable_strata" });
api.debugSetPlayerTile(40, 14);
for (let ty = 10; ty <= 18; ty += 1) {
  for (let tx = 38; tx <= 48; tx += 1) clearTile(tx, ty);
}
placeOre(44, 14, "copper", "echo-target-one", 1_000_000_000);
assert.ok(api.debugSetTargetTile(44, 14));
let echoBefore = api.getSnapshot().metrics.superPickEchoes;
for (let shot = 0; shot < 5; shot += 1) assert.ok(api.attackNow());
assert.equal(api.getSnapshot().metrics.superPickEchoes, echoBefore, "level-one Echo must wait for shot six");
assert.ok(api.attackNow());
assert.equal(
  api.getSnapshot().metrics.superPickEchoes,
  echoBefore + 1,
  "level-one Echo must fire on shot six",
);
api.finishRun();

api.setAllUpgrades(true);
api.setUpgradeLevel("tools_super_pick_echo", 2);
api.setUpgradeLevel("sense_deaf_knock", 0);
for (const upgradeId of ["dig_sweeping_arc", "dig_precision_path", "dig_omni_swing", "dig_quarry_presence", "tools_super_field", "tools_laser_width", "tools_solar_drill", "fortune_motherlode_covenant"]) {
  api.setUpgradeLevel(upgradeId, 0);
}
api.startRun({ seed: "echo-level-two", sectorId: "stable_strata" });
api.debugSetPlayerTile(40, 14);
for (let ty = 10; ty <= 18; ty += 1) {
  for (let tx = 38; tx <= 48; tx += 1) clearTile(tx, ty);
}
placeOre(44, 14, "copper", "echo-target-two", 1_000_000_000);
assert.ok(api.debugSetTargetTile(44, 14));
echoBefore = api.getSnapshot().metrics.superPickEchoes;
for (let shot = 0; shot < 3; shot += 1) assert.ok(api.attackNow());
assert.equal(api.getSnapshot().metrics.superPickEchoes, echoBefore, "level-two Echo must wait for shot four");
assert.ok(api.attackNow());
assert.equal(api.getSnapshot().metrics.superPickEchoes, echoBefore + 1, "level-two Echo must fire on shot four");
placeRock(44, 15);
const echoBreaksBefore = api.getSnapshot().metrics.sourceBreaks.echo || 0;
const shattersBefore = api.getSnapshot().metrics.sourceBreaks.shatter || 0;
const savedRandom = Math.random;
Math.random = () => 0;
try {
  assert.equal(api.debugTriggerSuperPickEcho(200), true);
} finally {
  Math.random = savedRandom;
}
snapshot = api.getSnapshot();
assert.ok((snapshot.metrics.sourceBreaks.echo || 0) > echoBreaksBefore, "Echo must damage its local circle");
assert.equal(snapshot.metrics.sourceBreaks.shatter || 0, shattersBefore, "Echo must not proc break splash");
api.finishRun();

// Echo's no-proc contract also covers deterministic perk counters. Breaking
// three nodes of one vein must not advance or pay out Triple Sample.
api.setAllUpgrades(false);
api.setUpgradeLevel("tools_super_pick_echo", 2);
api.setUpgradeLevel("fortune_triple_seam", 3);
api.startRun({ seed: "echo-no-triple-sample", sectorId: "stable_strata" });
api.debugSetPlayerTile(40, 20);
for (let ty = 18; ty <= 22; ty += 1) {
  for (let tx = 39; tx <= 44; tx += 1) clearTile(tx, ty);
}
placeOre(42, 20, "copper", "echo-no-sample-vein", 1);
placeOre(42, 19, "copper", "echo-no-sample-vein", 1);
placeOre(42, 21, "copper", "echo-no-sample-vein", 1);
assert.ok(api.debugSetTargetTile(42, 20));
assert.equal(api.debugTriggerSuperPickEcho(10), true);
assert.equal(api.getSnapshot().runOre, 3, "three no-proc Echo breaks must yield only their three base pieces");
api.finishRun();

// Triangular Fix remembers ore, directs drones into the marked sector, keeps
// that priority for 1.5 seconds after geometry disappears, and adds exactly
// 25% drone damage at level two.
api.setAllUpgrades(false);
api.setUpgradeLevel("gadgets_scout_drone", 1);
api.setUpgradeLevel("sense_triangular_fix", 1);
api.startRun({ seed: "triangle-semantics", sectorId: "stable_strata" });
api.debugSetPlayerTile(40, 14);
for (let ty = 10; ty <= 19; ty += 1) {
  for (let tx = 37; tx <= 45; tx += 1) clearTile(tx, ty);
}
placeOre(43, 14, "copper", "triangle-main", 1_000_000_000);
placeOre(41, 17, "copper", "triangle-backup", 1_000_000_000);
placeOre(41, 15, "star_core", "triangle-memory", 1000);
placeOre(39, 14, "star_core", "triangle-outside", 1000);
assert.ok(api.debugSetTargetTile(43, 14));
assert.ok(api.debugSetBackupTile(41, 17));
assert.ok(api.debugGetTriangle(), "triangular fix should create a live miner-primary-backup sector");
assert.ok(api.getSnapshot().triangleRememberedOre.includes("41:15"), "ore inside the triangle must enter the 1.5-second memory");
const outsideBefore = api.debugGetTile(39, 14).hp;
const memoryBaseHp = api.debugGetTile(41, 15).hp;
assert.ok(api.debugForceDrones());
const levelOneDamage = memoryBaseHp - api.debugGetTile(41, 15).hp;
assert.ok(levelOneDamage > 0, "level-one drones must prioritize ore inside the triangle");
assert.equal(api.debugGetTile(39, 14).hp, outsideBefore, "the closer ore outside the sector must not steal drone priority");
placeOre(41, 15, "star_core", "triangle-memory", memoryBaseHp);
api.setUpgradeLevel("sense_triangular_fix", 2);
assert.ok(api.debugForceDrones());
const levelTwoDamage = memoryBaseHp - api.debugGetTile(41, 15).hp;
assert.ok(Math.abs(levelTwoDamage / levelOneDamage - 1.25) < 0.001, "level two must add 25% drone damage inside the triangle");
placeOre(41, 15, "star_core", "triangle-memory", memoryBaseHp);
clearTile(43, 14);
clearTile(41, 17);
assert.equal(api.debugGetTriangle(), null, "invalidated endpoints must remove the live triangle");
assert.ok(api.getSnapshot().triangleRememberedOre.includes("41:15"), "triangle memory must outlive the endpoints briefly");
assert.ok(api.debugForceDrones());
assert.ok(api.debugGetTile(41, 15).hp < memoryBaseHp, "drones must still prefer remembered ore after the triangle disappears");
assert.equal(api.debugGetTile(39, 14).hp, outsideBefore, "remembered priority must remain observable after the live sector disappears");
placeOre(41, 15, "star_core", "triangle-memory", 0.1);
assert.ok(api.debugForceDrones());
assert.equal(api.debugGetTile(41, 15).kind, "air", "the prioritized drone hit should be credited in the report");
api.finishRun();
snapshot = api.getSnapshot();
assert.ok(snapshot.lastRunReport && snapshot.lastRunReport.triangleBuffHits > 0);
const reportDetailsHtml = elementFor("#reportDetails").innerHTML;
assert.match(reportDetailsHtml, /Глухой стук/);
assert.match(reportDetailsHtml, /Эхо суперкирки/);
assert.match(reportDetailsHtml, /Усиления триангуляции/);
assert.match(reportDetailsHtml, /Дроны:/, "break sources must use readable Russian labels");
assert.doesNotMatch(reportDetailsHtml, /drone:/);
assert.ok(Object.keys(snapshot.oreRecords).length > 0, "journal records should persist a mined ore sample");

// One bomb snapshots the triangulation sector. Its first endpoint can break
// early in candidate order without stripping the 25% bonus from the second.
api.setAllUpgrades(false);
api.setUpgradeLevel("sense_triangular_fix", 2);
api.startRun({ seed: "triangle-aoe-snapshot", sectorId: "stable_strata" });
api.debugSetPlayerTile(40, 20);
for (let ty = 18; ty <= 23; ty += 1) {
  for (let tx = 39; tx <= 43; tx += 1) clearTile(tx, ty);
}
placeOre(41, 20, "copper", "triangle-blast-primary", 0.5);
placeOre(39, 21, "copper", "triangle-blast-backup", 100);
assert.ok(api.debugSetTargetTile(41, 20));
assert.ok(api.debugSetBackupTile(39, 21));
const triangleBlastBase = api.getStats().pickPower * api.getStats().bombPower * 1.8;
const triangleBackupBefore = api.debugGetTile(39, 21).hp;
assert.equal(api.forceDetonate(1, 0), true);
assert.equal(api.debugGetTile(41, 20).kind, "air", "the first endpoint must be destroyed during the AoE");
const triangleBackupDamage = triangleBackupBefore - api.debugGetTile(39, 21).hp;
assert.ok(
  Math.abs(triangleBackupDamage - triangleBlastBase * 1.25) < 1e-9,
  `the later endpoint must retain the snapshotted triangulation bonus (damage ${triangleBackupDamage}, base ${triangleBlastBase})`,
);
api.finishRun();

// Every micro-event gets a natural proximity trigger or an explicit semantic
// assertion for its compact top-line timer and concrete gameplay result.
api.setAllUpgrades(false);
api.startRun({ seed: "micro-event-semantics", sectorId: "stable_strata" });
api.debugScheduleGlobalEvent();
let events = api.debugGetMicroEvents();
assert.equal(events.length, 1, "only the chest may exist as a physical field event");
const priorityChest = events.find((event) => event.type === "ancient_container");
assert.ok(priorityChest);
const scheduledGlobal = api.debugGetGlobalMicroEvent(0);
assert.ok(scheduledGlobal?.global && scheduledGlobal.scheduled);
assert.equal(Object.hasOwn(scheduledGlobal, "tx"), false, "global bonuses must have no field coordinates");
const chestApproachDirection = priorityChest.tx < global.DepthZeroWorld.WORLD_CONFIG.WIDTH / 2 ? 1 : -1;
const chestApproachTx = priorityChest.tx + chestApproachDirection * 2;
api.debugSetPlayerTile(chestApproachTx, priorityChest.ty);
placeOre(chestApproachTx + chestApproachDirection, priorityChest.ty, "copper", "chest-priority-decoy", 1_000_000);
api.stepRun(0.01);
snapshot = api.getSnapshot();
assert.equal(snapshot.target?.kind, "micro_event", "a chest entering the scanner must override ordinary ore targets");
assert.deepEqual([snapshot.target.tx, snapshot.target.ty], [priorityChest.tx, priorityChest.ty]);
assert.equal(api.debugTriggerMicroEvent("fragile_cavity"), true);
api.stepRun(0.2);
snapshot = api.getSnapshot();
assert.equal(snapshot.metrics.microEvents.fragile_cavity, 1, "the scheduled condition must trigger without a field marker");
assert.equal(snapshot.activeMicroEvent.type, "fragile_cavity");
assert.match(elementFor("#microEventTitle").textContent, /МЯГКАЯ ПОРОДА/);
assert.match(
  elementFor("#microEventTimer").textContent,
  /^4,[78]/,
  "the five-second bonus timer must reflect the 0.2 seconds already simulated",
);
assert.ok(!elementFor("#microEventBanner").classList.contains("hidden"));
assert.ok(!elementFor("#microEventBanner").classList.contains("is-triggered"));
assert.ok(!elementFor("#microEventBanner").classList.contains("is-preview"));
assert.ok(snapshot.eventSoftRockRemaining > 4.7, "fragile cavity must soften rock globally for five seconds");

api.setUpgradeLevel("tools_laser_emitter", 1);
api.debugSetPlayerTile(40, 20);
placeRock(42, 20, 1_000);
placeOre(44, 20, "copper", "soft-rock-laser-target", 1_000);
assert.ok(api.debugSetTargetTile(44, 20));
const softLaserRockBefore = api.debugGetTile(42, 20).hp;
const softLaserOreBefore = api.debugGetTile(44, 20).hp;
assert.equal(api.attackNow(), true);
const softLaserRockDamage = softLaserRockBefore - api.debugGetTile(42, 20).hp;
const softLaserOreDamage = softLaserOreBefore - api.debugGetTile(44, 20).hp;
assert.ok(softLaserOreDamage > 0, "the event regression fixture must hit its ore aim target");
assert.ok(
  Math.abs(softLaserRockDamage / softLaserOreDamage - 1.65) < 1e-9,
  `soft rock must boost each intervening terrain hit without boosting ore (${softLaserRockDamage}/${softLaserOreDamage})`,
);
api.setUpgradeLevel("tools_laser_emitter", 0);

assert.equal(api.debugTriggerMicroEvent("gas_pocket"), true);
assert.ok(api.getSnapshot().eventDigBoostRemaining > 4.9, "gas pocket must grant a five-second dig-speed window");
assert.match(elementFor("#microEventTitle").textContent, /УСКОРЕНИЕ КОПКИ \+50%/);
assert.equal(api.debugTriggerMicroEvent("rich_lens"), true);
assert.ok(api.getSnapshot().eventYieldBoostRemaining > 4.9, "rich lens must visibly grant a five-second yield window");
assert.match(elementFor("#microEventTitle").textContent, /ВЫХОД РУДЫ ×1,5/);
const beforeContainer = api.getSnapshot();
assert.equal(api.debugTriggerMicroEvent("ancient_container"), true);
snapshot = api.getSnapshot();
assert.ok(snapshot.runOre >= beforeContainer.runOre + 1, "the ancient container must add its mixed depth-scaled ore reward");
assert.ok(snapshot.timeLeft >= beforeContainer.timeLeft + 0.49, "the ancient container must add half a second");
assert.match(elementFor("#microEventTitle").textContent, /^СУНДУК ·/);
assert.equal(elementFor("#microEventTimer").textContent, "2,2 С");
assert.equal(api.debugTriggerMicroEvent("underground_flow"), true);
snapshot = api.getSnapshot();
assert.ok(snapshot.eventMoveBoostRemaining > 4.9, "the underground flow must grant five seconds of movement boost");
assert.match(elementFor("#microEventTitle").textContent, /СКОРОСТЬ ДВИЖЕНИЯ \+35%/);
assert.equal(elementFor("#microEventTimer").textContent, "5,0 С");
assert.equal(snapshot.metrics.eventCount, 5);
assert.equal(api.debugGetMicroEvents().length, 0, "the collected chest must remain one-shot");
api.stepRun(1.05);
assert.match(elementFor("#microEventTimer").textContent, /^4,[0-9] С$/, "the top-line timer must visibly count down with the active effect");
api.stepRun(4.05);
snapshot = api.getSnapshot();
assert.equal(snapshot.eventSoftRockRemaining, 0, "short event buffs must expire after their five-second window");
assert.equal(snapshot.eventDigBoostRemaining, 0);
assert.equal(snapshot.eventYieldBoostRemaining, 0);
assert.equal(snapshot.eventMoveBoostRemaining, 0);
assert.ok(elementFor("#microEventBanner").classList.contains("hidden"), "the event line must disappear when its countdown expires");
api.finishRun();
assert.ok(elementFor("#microEventBanner").classList.contains("hidden"), "event notices must not leak onto the result screen");

// A short chest notice may temporarily cover a global-effect timer, but the
// still-active effect must return instead of disappearing for its final seconds.
api.startRun({ seed: "runtime-stacked-event-indicator", sectorId: "stable_strata" });
api.debugScheduleGlobalEvent();
assert.equal(api.debugTriggerMicroEvent("gas_pocket"), true);
api.stepRun(1);
assert.equal(api.debugTriggerMicroEvent("ancient_container"), true);
api.stepRun(2.25);
snapshot = api.getSnapshot();
assert.ok(snapshot.eventDigBoostRemaining > 1.7);
assert.match(elementFor("#microEventTitle").textContent, /УСКОРЕНИЕ КОПКИ/);
assert.ok(!elementFor("#microEventBanner").classList.contains("hidden"));
api.finishRun();

// Short global conditions start on their own and never become objects that
// the miner must walk toward. The chest stays the sole physical event.
api.startRun({ seed: "runtime-scheduled-global-event", sectorId: "stable_strata" });
assert.equal(api.debugGetMicroEvents().length, 1);
api.debugScheduleGlobalEvent(0.05);
api.stepRun(0.06);
snapshot = api.getSnapshot();
assert.equal(snapshot.metrics.eventCount, 1);
assert.equal(snapshot.activeMicroEvent?.global, true);
assert.equal(Object.hasOwn(snapshot.activeMicroEvent, "tx"), false);
assert.equal(api.debugGetMicroEvents().length, 1, "a global condition must not consume or duplicate the chest");
assert.ok(!elementFor("#microEventBanner").classList.contains("hidden"));
api.finishRun();

// Resonant Ping must acquire ore that the ordinary scanner cannot reach. The
// debug world is cleared locally so an unrelated generated node cannot mask
// the enlarged scan.
api.setAllUpgrades(false);
api.setUpgradeLevel("sense_echo_pulse", 3);
api.setFocusedOre(null);
api.startRun({ seed: "runtime-resonant-ping", sectorId: "stable_strata" });
api.debugSetPlayerTile(40, 20);
for (let ty = 15; ty <= 25; ty += 1) {
  for (let tx = 35; tx <= 48; tx += 1) clearTile(tx, ty);
}
placeOre(44, 20, "copper", "echo-ping-vein", 1000);
api.forceFocusMiss(0);
api.stepRun(0.05);
snapshot = api.getSnapshot();
assert.equal(snapshot.target?.tx, 44, "resonant ping should acquire ore beyond the ordinary sense radius");
assert.equal(snapshot.target?.ty, 20);
api.finishRun();

// Deep Resonance is a directional fallback rather than a second Ore Focus:
// it ignores an equally distant side sample, penetrates four layers, and
// visibly points down toward the acquired ore.
api.setAllUpgrades(false);
api.setUpgradeLevel("sense_deep_resonance", 1);
api.setFocusedOre(null);
api.startRun({ seed: "runtime-deep-resonance-sector", sectorId: "stable_strata" });
api.debugScheduleGlobalEvent();
api.debugSetPlayerTile(40, 20);
for (let ty = 15; ty <= 27; ty += 1) {
  for (let tx = 34; tx <= 46; tx += 1) clearTile(tx, ty);
}
placeOre(44, 20, "copper", "deep-sector-side-decoy", 1000);
for (let ty = 21; ty <= 24; ty += 1) placeRock(40, ty, 1000);
placeOre(40, 25, "copper", "deep-sector-target", 1000);
assert.equal(api.acquireTargets(), null, "ordinary sense must not reach either distant probe");
assert.equal(api.debugTriggerDeepResonance(), true);
snapshot = api.getSnapshot();
assert.equal(snapshot.target?.tx, 40, "the depth sector should reject the horizontal decoy");
assert.equal(snapshot.target?.ty, 25, "the depth sector should acquire ore through four downward layers");
assert.ok(snapshot.deepResonanceCooldownRemaining > 3.9);
assert.ok(snapshot.visualEffects.beams >= 3, "two cone edges and a target ray must make the sector visible");
assert.ok(snapshot.visualEffects.shocks >= 1);
api.finishRun();

// The second rank turns the sector into an actual route instead of another
// radius scalar: one pulse marks a primary and a distinct follow-up target.
api.setAllUpgrades(false);
api.setUpgradeLevel("sense_deep_resonance", 2);
api.setFocusedOre(null);
api.startRun({ seed: "runtime-deep-resonance-route", sectorId: "stable_strata" });
api.debugScheduleGlobalEvent();
api.debugSetPlayerTile(40, 20);
for (let ty = 15; ty <= 27; ty += 1) {
  for (let tx = 34; tx <= 46; tx += 1) clearTile(tx, ty);
}
for (let ty = 21; ty <= 24; ty += 1) {
  placeRock(39, ty, 1000);
  placeRock(41, ty, 1000);
}
placeOre(39, 25, "copper", "deep-sector-route-a", 1000);
placeOre(41, 25, "copper", "deep-sector-route-b", 1000);
assert.equal(api.acquireTargets(), null, "both routed samples must remain beyond ordinary sense");
assert.equal(api.debugTriggerDeepResonance(), true);
snapshot = api.getSnapshot();
assert.ok(snapshot.target, "rank two must mark a primary depth-sector target");
assert.ok(snapshot.backupTarget, "rank two must visibly reserve a second depth-sector target");
assert.notDeepEqual(
  [snapshot.target.tx, snapshot.target.ty],
  [snapshot.backupTarget.tx, snapshot.backupTarget.ty],
  "the depth-sector route must contain two distinct ore nodes",
);
api.finishRun();

// Rank three must keep the third mapped target even without Seismic Memory.
// Otherwise the tooltip promises a route that silently disappears.
api.setAllUpgrades(false);
api.setUpgradeLevel("sense_deep_resonance", 3);
api.setFocusedOre(null);
api.startRun({ seed: "runtime-deep-resonance-map", sectorId: "stable_strata" });
api.debugScheduleGlobalEvent();
api.debugSetPlayerTile(40, 20);
for (let ty = 15; ty <= 28; ty += 1) {
  for (let tx = 34; tx <= 46; tx += 1) clearTile(tx, ty);
}
placeOre(38, 26, "copper", "deep-sector-map-a", 1000);
placeOre(40, 26, "copper", "deep-sector-map-b", 1000);
placeOre(42, 26, "copper", "deep-sector-map-c", 1000);
assert.equal(api.acquireTargets(), null, "all three mapped samples must remain beyond ordinary sense");
assert.equal(api.debugTriggerDeepResonance(), true);
snapshot = api.getSnapshot();
assert.ok(snapshot.target, "rank three must mark a primary depth-sector target");
assert.ok(snapshot.backupTarget, "rank three must mark a backup depth-sector target");
assert.equal(snapshot.rememberedVeins.length, 1, "rank three must retain its third target without Seismic Memory");
const mappedDepthTargets = [
  [snapshot.target.tx, snapshot.target.ty],
  [snapshot.backupTarget.tx, snapshot.backupTarget.ty],
  [snapshot.rememberedVeins[0].tx, snapshot.rememberedVeins[0].ty],
];
assert.equal(
  new Set(mappedDepthTargets.map(([tx, ty]) => `${tx}:${ty}`)).size,
  3,
  "the depth-sector map must contain three distinct ore nodes",
);
api.finishRun();

// Light Footwork rank two gives a visible opening sprint, but only until the
// first real tool contact. Rank one remains ordinary movement.
const measureOpeningSprint = (level, seed) => {
  api.setAllUpgrades(false);
  api.setUpgradeLevel("dig_light_footwork", level);
  api.setFocusedOre(null);
  api.startRun({ seed, sectorId: "stable_strata" });
  api.debugScheduleGlobalEvent();
  api.debugSetPlayerTile(40, 20);
  for (let ty = 18; ty <= 22; ty += 1) {
    for (let tx = 39; tx <= 43; tx += 1) clearTile(tx, ty);
  }
  placeOre(42, 20, "copper", `opening-sprint-${level}`, 1000);
  assert.ok(api.debugSetTargetTile(42, 20));
  api.debugSetAttackCooldown(5);
  const before = api.getSnapshot().player;
  api.stepRun(0.1);
  const moving = api.getSnapshot();
  const distanceMoved = Math.hypot(moving.player.x - before.x, moving.player.y - before.y);
  let endedAfterImpact = !moving.openingSprintActive;
  if (level >= 2) {
    api.debugSetPlayerTile(41, 20);
    assert.equal(api.attackNow(), true);
    endedAfterImpact = !api.getSnapshot().openingSprintActive;
  }
  api.finishRun();
  return { distanceMoved, moving, endedAfterImpact };
};
const ordinaryFootwork = measureOpeningSprint(1, "runtime-opening-sprint-base");
const openingSprint = measureOpeningSprint(2, "runtime-opening-sprint-active");
assert.equal(ordinaryFootwork.moving.openingSprintActive, false);
assert.equal(openingSprint.moving.openingSprintActive, true);
assert.ok(
  openingSprint.distanceMoved > ordinaryFootwork.distanceMoved * 1.35,
  "rank-two opening movement should be unmistakably faster than rank one",
);
assert.ok(openingSprint.moving.visualEffects.particles > 0, "the sprint must leave a local luminous trail");
assert.ok(openingSprint.moving.perkStatus.some((entry) => entry.value === "+40%"), "the active sprint must be named in the status rail");
assert.equal(openingSprint.endedAfterImpact, true, "the first real strike must end the opening sprint");

// At max rank Light Footwork becomes a repeatable routing mechanic: after the
// opening sprint is spent, selecting another ore node starts a shorter local
// burst with its own status and trail.
api.setAllUpgrades(false);
api.setUpgradeLevel("dig_light_footwork", 4);
api.setFocusedOre(null);
api.startRun({ seed: "runtime-target-relay-sprint", sectorId: "stable_strata" });
api.debugScheduleGlobalEvent();
api.debugSetPlayerTile(40, 20);
for (let ty = 18; ty <= 22; ty += 1) {
  for (let tx = 39; tx <= 44; tx += 1) clearTile(tx, ty);
}
placeOre(41, 20, "copper", "relay-sprint-a", 1000);
placeOre(43, 20, "copper", "relay-sprint-b", 1000);
assert.ok(api.debugSetTargetTile(41, 20));
assert.equal(api.attackNow(), true);
assert.equal(api.getSnapshot().openingSprintActive, false);
assert.ok(api.debugSetTargetTile(43, 20));
snapshot = api.getSnapshot();
assert.ok(snapshot.targetRelaySprintRemaining > 0.64, "a distinct follow-up ore target must trigger the rank-four relay sprint");
assert.ok(snapshot.perkStatus.some((entry) => entry.value === "+18%"), "the relay sprint must be named in the status rail");
api.debugSetAttackCooldown(5);
api.stepRun(0.1);
snapshot = api.getSnapshot();
assert.ok(snapshot.visualEffects.particles > 0, "the relay sprint must reuse the obvious local trail");
api.finishRun();

// Fault Finder rank three replaces an invisible multiplier-only stretch with
// a deterministic, visibly named critical strike cadence.
api.setAllUpgrades(false);
api.setUpgradeLevel("power_fault_finder", 3);
api.setFocusedOre(null);
api.startRun({ seed: "runtime-fault-finder-cadence", sectorId: "stable_strata" });
api.debugScheduleGlobalEvent();
api.debugSetPlayerTile(40, 20);
for (let ty = 19; ty <= 21; ty += 1) {
  for (let tx = 39; tx <= 42; tx += 1) clearTile(tx, ty);
}
placeOre(41, 20, "copper", "fault-finder-cadence", 100000);
assert.ok(api.debugSetTargetTile(41, 20));
for (let hit = 0; hit < 18; hit += 1) {
  api.debugSetAttackCooldown(0);
  assert.equal(api.attackNow(), true);
}
snapshot = api.getSnapshot();
assert.equal(snapshot.metrics.faultFinderCadenceCrits, 1, "rank three must guarantee exactly every eighteenth strike");
assert.ok(snapshot.visualEffects.shake >= 6, "the guaranteed crack strike must have critical-impact feedback");
api.finishRun();

// Opening one ordinary stone between two nodes must not erase the remembered
// vein. With the memory intact, the farther continuation wins over a closer
// decoy vein that the base scanner could otherwise choose.
api.setAllUpgrades(false);
api.setUpgradeLevel("sense_vein_whisper", 3);
api.setFocusedOre(null);
api.startRun({ seed: "runtime-vein-memory-through-rock", sectorId: "stable_strata" });
api.debugSetPlayerTile(40, 20);
for (let ty = 18; ty <= 22; ty += 1) {
  for (let tx = 38; tx <= 46; tx += 1) clearTile(tx, ty);
}
placeOre(41, 20, "copper", "remembered-vein", 1);
placeRock(42, 20, 1);
placeOre(44, 20, "copper", "remembered-vein", 1000);
placeOre(43, 20, "copper", "closer-decoy-vein", 1000);
assert.ok(api.debugBreakTileWithSource(41, 20, "pick"));
assert.ok(api.debugBreakTileWithSource(42, 20, "pick"));
api.forceFocusMiss(0);
const rememberedVeinTargets = api.acquireTargets();
assert.equal(
  rememberedVeinTargets?.primary?.tx,
  44,
  "a path-opening rock must preserve priority for the remaining node of the last vein",
);
assert.equal(rememberedVeinTargets?.primary?.ty, 20);
api.finishRun();

// Stress Map scans beyond the ordinary sense circle and stores that distant
// vein while a nearer primary is still being mined.
api.setAllUpgrades(false);
api.setUpgradeLevel("sense_seismic_memory", 1);
api.startRun({ seed: "runtime-stress-map-outside-sense", sectorId: "stable_strata" });
api.debugSetPlayerTile(40, 20);
for (let ty = 15; ty <= 25; ty += 1) {
  for (let tx = 35; tx <= 49; tx += 1) clearTile(tx, ty);
}
placeOre(42, 20, "copper", "stress-map-primary", 1);
placeOre(45, 20, "copper", "stress-map-distant", 1000);
let stressTargets = api.acquireTargets();
assert.equal(stressTargets?.primary?.tx, 42);
assert.ok(
  api.getSnapshot().rememberedVeins.some((target) => target.veinId === "stress-map-distant"),
  "the map must store a suitable vein outside ordinary sense",
);
assert.ok(api.breakCurrentTarget());
stressTargets = api.acquireTargets();
assert.equal(stressTargets?.primary?.tx, 45, "the stored distant vein must become the next route immediately");
api.finishRun();

// Density piercing is target-aware: it does nothing to ordinary rock, gives a
// smaller benefit to soft copper, and reaches its full value on star core.
api.setAllUpgrades(false);
api.setUpgradeLevel("power_tempered_steel", 7);
api.startRun({ seed: "runtime-density-pierce", sectorId: "stable_strata" });
api.debugSetPlayerTile(40, 20);
for (let ty = 18; ty <= 22; ty += 1) {
  for (let tx = 39; tx <= 43; tx += 1) clearTile(tx, ty);
}
placeRock(41, 20, 100);
assert.ok(api.debugSetClearanceTargetTile(41, 20));
assert.ok(api.attackNow());
const rockPierceDamage = 100 - api.debugGetTile(41, 20).hp;
placeOre(41, 20, "copper", "pierce-copper", 100);
assert.ok(api.debugSetTargetTile(41, 20));
assert.ok(api.attackNow());
const copperPierceDamage = 100 - api.debugGetTile(41, 20).hp;
placeOre(41, 20, "star_core", "pierce-star", 100);
assert.ok(api.debugSetTargetTile(41, 20));
assert.ok(api.attackNow());
const starPierceDamage = 100 - api.debugGetTile(41, 20).hp;
assert.equal(rockPierceDamage, api.getStats().pickPower, "ordinary rock must not receive density-pierce power");
assert.ok(copperPierceDamage > rockPierceDamage, "soft ore should receive a small density-pierce benefit");
assert.ok(starPierceDamage > copperPierceDamage, "denser ore must expose more of the piercing benefit");
assert.ok(Math.abs(copperPierceDamage / api.getStats().pickPower - api.debugHardnessPierceMultiplier("copper")) < 1e-9);
assert.ok(Math.abs(starPierceDamage / api.getStats().pickPower - api.debugHardnessPierceMultiplier("star_core")) < 1e-9);
api.finishRun();

// Side Chip is an actual two-sided hit, including at level three where it
// fires on every swing instead of merely widening a decorative arc.
api.setAllUpgrades(false);
api.setUpgradeLevel("dig_sweeping_arc", 3);
api.startRun({ seed: "runtime-side-chip", sectorId: "stable_strata" });
api.debugSetPlayerTile(40, 20);
for (let ty = 17; ty <= 23; ty += 1) {
  for (let tx = 38; tx <= 44; tx += 1) clearTile(tx, ty);
}
placeOre(42, 20, "copper", "side-chip-target", 1000);
placeRock(42, 19, 10);
placeRock(42, 21, 10);
assert.ok(api.debugSetTargetTile(42, 20));
assert.ok(api.attackNow());
assert.ok(api.debugGetTile(42, 19).hp < 10, "the upper side block should receive chip damage");
assert.ok(api.debugGetTile(42, 21).hp < 10, "the lower side block should receive chip damage");
api.finishRun();

// Bonus seconds above the direct 45-second cap charge Chrono Overdrive. Its
// fifth strike is identified by the break source, so the test covers both the
// overflow state and the promised deterministic cadence.
api.setAllUpgrades(false);
api.setUpgradeLevel("time_thirty_second_oath", 1);
api.startRun({ seed: "runtime-chrono-overdrive", sectorId: "stable_strata" });
api.debugSetPlayerTile(40, 20);
for (let ty = 18; ty <= 22; ty += 1) {
  for (let tx = 39; tx <= 44; tx += 1) clearTile(tx, ty);
}
placeOre(42, 20, "copper", "chrono-target", 5.5);
assert.ok(api.debugSetTargetTile(42, 20));
assert.ok(api.grantBonusTime(100) > 0);
for (let hit = 0; hit < 4; hit += 1) assert.ok(api.attackNow());
assert.notEqual(api.debugGetTile(42, 20).kind, "air", "chrono repeat must wait for the fifth strike");
assert.ok(api.attackNow());
snapshot = api.getSnapshot();
assert.equal(api.debugGetTile(42, 20).kind, "air", "the fifth chrono strike should finish the prepared target");
assert.equal(snapshot.metrics.sourceBreaks["chrono-overdrive"], 1);
api.finishRun();

// Full drone autonomy follows the actual bonus-extended end of a shift rather
// than switching off at the direct timer duration.
api.setAllUpgrades(false);
api.setUpgradeLevel("gadgets_scout_drone", 1);
api.setUpgradeLevel("gadgets_drone_battery", 3);
api.startRun({ seed: "runtime-drone-bonus-autonomy", sectorId: "stable_strata" });
assert.equal(api.getStats().droneLifetime, 1);
assert.ok(api.grantBonusTime(4) > 0);
api.stepRun(6.2);
assert.equal(api.getSnapshot().mode, "run");
assert.ok(api.getSnapshot().timeLeft > 0, "bonus seconds must keep the shift alive beyond its direct duration");
assert.equal(api.debugDronesAreActive(), true, "full-autonomy drones must remain active in bonus time");
api.setUpgradeLevel("gadgets_drone_battery", 2);
assert.equal(api.debugDronesAreActive(), false, "a partial battery must still use its advertised duration share");
api.finishRun();

// Fortune Wheel is a visible pity cycle, not another hidden percentage roll:
// with every random proc suppressed, the fifth dry ore break must still fire.
api.setAllUpgrades(false);
api.setUpgradeLevel("fortune_wheel", 4);
api.startRun({ seed: "runtime-fortune-wheel", sectorId: "stable_strata" });
for (let index = 0; index < 5; index += 1) {
  placeOre(70 + index, 12, "copper", `fortune-${index}`, 1);
  assert.ok(api.debugBreakTileWithSource(70 + index, 12, "debug"));
}
snapshot = api.getSnapshot();
assert.equal(snapshot.metrics.fortuneWheelProcs, 1, "the pity threshold must guarantee the fifth proc");
api.finishRun();

// The covenant counts yielded pieces rather than physical nodes. A newly
// discovered tier on the threshold piece is eligible for the mark immediately.
api.setAllUpgrades(false);
api.setUpgradeLevel("fortune_motherlode_covenant", 1);
api.setUpgradeLevel("fortune_double_yield", 6);
api.startRun({ seed: "runtime-motherlode", sectorId: "stable_strata" });
api.debugSetAttackCooldown(100);
assert.ok(api.grantBonusTime(20) > 0);
const motherlodeCandidateBase = global.DepthZeroWorld.WORLD_CONFIG.WIDTH - 6;
const motherlodeFeedBase = global.DepthZeroWorld.WORLD_CONFIG.WIDTH - 16;
for (let tx = motherlodeCandidateBase; tx <= motherlodeCandidateBase + 2; tx += 1) {
  placeOre(tx, 12, "star_core", "motherlode-candidate", 1);
}
const savedMotherlodeRandom = Math.random;
Math.random = () => 0;
try {
for (let index = 0; index < 9; index += 1) {
  placeOre(motherlodeFeedBase + index, 12, "copper", `motherlode-feed-${index}`, 1);
  assert.ok(api.debugBreakTileWithSource(motherlodeFeedBase + index, 12, "debug"));
  if (index < 8) api.stepRun(0.8);
}
assert.equal(api.getSnapshot().motherlodeBreaks, 18, "nine doubled drops must count as eighteen covenant pieces");
assert.equal(api.getSnapshot().metrics.motherlodes, 0);
assert.ok(api.debugBreakTileWithSource(motherlodeCandidateBase, 12, "debug"), "the doubled threshold sample should reveal its tier");
} finally {
  Math.random = savedMotherlodeRandom;
}
snapshot = api.getSnapshot();
assert.equal(snapshot.metrics.motherlodes, 1, "the twentieth yielded piece must mark one existing motherlode");
assert.equal(snapshot.motherlodeVeinId, "motherlode-candidate", "the threshold's newly discovered top tier must be eligible");
const motherlodeBonusBefore = snapshot.bonusTimeEarned;
assert.ok(api.debugBreakTileWithSource(motherlodeCandidateBase + 1, 12, "debug"));
assert.ok(api.debugBreakTileWithSource(motherlodeCandidateBase + 2, 12, "debug"));
snapshot = api.getSnapshot();
assert.ok(
  snapshot.bonusTimeEarned >= motherlodeBonusBefore + 2.5,
  "completing the marked motherlode must grant its 2.5-second reward",
);
for (let index = 0; index < 20; index += 1) {
  placeOre(60 + index, 10, "copper", `motherlode-second-cycle-${index}`, 1);
  assert.ok(api.debugBreakTileWithSource(60 + index, 10, "debug"));
}
assert.equal(
  api.getSnapshot().metrics.motherlodes,
  1,
  "a completed motherlode must not allow a second mark after another twenty pieces",
);
api.finishRun();

// Golden Touch is additive gold, but only after gold is already known. The
// same forced proc first proves that amethyst cannot unlock gold by itself,
// then proves that the unlocked reward is exactly gold rather than a generic
// higher-tier substitution.
api.debugResetProgress();
api.setAllUpgrades(false);
api.setUpgradeLevel("fortune_golden_touch", 5);
api.startRun({ seed: "runtime-golden-touch-locked", sectorId: "stable_strata" });
placeOre(70, 12, "amethyst", "golden-touch-locked", 1);
const savedGoldenRandom = Math.random;
Math.random = () => 0;
try {
  assert.ok(api.debugBreakTileWithSource(70, 12, "debug"));
} finally {
  Math.random = savedGoldenRandom;
}
snapshot = api.getSnapshot();
assert.equal(snapshot.discoveredOreTypes.includes("gold"), false, "Golden Touch must not discover locked gold");
assert.equal(snapshot.inventory.gold, 0);
api.finishRun();
snapshot = api.getSnapshot();
assert.equal(snapshot.lastHaul.amethyst, 1, "the source amethyst must be preserved");
assert.equal(snapshot.lastHaul.gold, 0, "locked gold must not be paid out");

api.grantOre("gold", 1);
api.startRun({ seed: "runtime-golden-touch-known", sectorId: "stable_strata" });
placeOre(70, 12, "amethyst", "golden-touch-known", 1);
Math.random = () => 0;
try {
  assert.ok(api.debugBreakTileWithSource(70, 12, "debug"));
} finally {
  Math.random = savedGoldenRandom;
}
api.finishRun();
snapshot = api.getSnapshot();
assert.equal(snapshot.lastHaul.amethyst, 1, "Golden Touch must not replace amethyst");
assert.equal(snapshot.lastHaul.gold, 1, "known gold must be the exact additive reward");
assert.equal(snapshot.inventory.gold, 2, "the additive gold piece must enter persistent inventory");

// A secondary/no-proc break may discover a vein first, but it must not consume
// the vein's one legitimate Rich Vein roll. The next allowed break resolves it.
api.setAllUpgrades(false);
api.setUpgradeLevel("fortune_rich_vein", 6);
api.startRun({ seed: "runtime-rich-roll-deferred", sectorId: "stable_strata" });
placeOre(70, 12, "copper", "deferred-rich-vein", 1);
placeOre(71, 12, "copper", "deferred-rich-vein", 1);
const savedRichRandom = Math.random;
Math.random = () => 0;
try {
  assert.ok(api.debugBreakTileWithSource(70, 12, "event"));
  assert.equal(api.getSnapshot().metrics.richVeins, 0, "a no-proc break must leave the rich roll unresolved");
  assert.ok(api.debugBreakTileWithSource(71, 12, "debug"));
} finally {
  Math.random = savedRichRandom;
}
assert.equal(api.getSnapshot().metrics.richVeins, 1, "the first allowed break must still resolve the vein-rich roll");
api.finishRun();

// The roll is resolved by the first eligible node, but its +50% yield starts
// only on nodes that remain after that discovery hit.
api.setAllUpgrades(false);
api.setUpgradeLevel("fortune_rich_vein", 6);
api.startRun({ seed: "runtime-rich-remaining-nodes", sectorId: "stable_strata" });
placeOre(70, 12, "copper", "remaining-rich-vein", 1);
placeOre(71, 12, "copper", "remaining-rich-vein", 1);
Math.random = () => 0;
try {
  assert.ok(api.debugBreakTileWithSource(70, 12, "debug"));
} finally {
  Math.random = savedRichRandom;
}
assert.equal(api.getSnapshot().runOre, 1, "the discovery node itself must not receive rich yield");
assert.ok(api.debugBreakTileWithSource(71, 12, "debug"));
assert.equal(api.getSnapshot().runOre, 8, "only the remaining node plus the six-piece completion cache should be rich");
api.finishRun();

// Relic status uses the real soft-rock timer and represents an enhanced chest
// as a charge, not as a made-up duration.
api.setAllUpgrades(false);
api.setUpgradeLevel("fortune_relic_magnet", 5);
api.startRun({ seed: "runtime-relic-status", sectorId: "stable_strata" });
const savedRelicRandom = Math.random;
Math.random = () => 0;
try {
  for (let index = 0; index < 4; index += 1) {
    placeOre(70 + index, 12, "copper", `relic-status-${index}`, 1);
    assert.ok(api.debugBreakTileWithSource(70 + index, 12, "debug"));
  }
} finally {
  Math.random = savedRelicRandom;
}
snapshot = api.getSnapshot();
assert.ok(snapshot.relicSoftRockRemaining >= 6, "the relic rail must retain the real soft-rock window");
assert.equal(snapshot.relicChestBoostCharges, 1, "the fourth relic effect must grant one enhanced-chest charge");
const relicStatus = snapshot.perkStatus.find((entry) => entry.label === "Реликвия");
assert.match(relicStatus?.value || "", /порода 6с/);
assert.match(relicStatus?.value || "", /сундук ×1/);
api.finishRun();

// Gadget overkill belongs to the broken vein. It cannot help a foreign vein,
// while a fresh gadget reserve must transfer to the next node of its own vein.
api.setAllUpgrades(false);
api.setUpgradeLevel("fortune_alchemist_scales", 5);
api.startRun({ seed: "runtime-gadget-overkill-vein", sectorId: "stable_strata" });
api.debugSetPlayerTile(40, 20);
for (let ty = 17; ty <= 23; ty += 1) {
  for (let tx = 37; tx <= 43; tx += 1) clearTile(tx, ty);
}
const overkillPickPower = api.getStats().pickPower;
placeOre(40, 20, "copper", "overkill-vein-a", overkillPickPower * 0.1);
assert.equal(api.forceDetonate(), true);
snapshot = api.getSnapshot();
assert.ok(snapshot.overkillReservoir > 0);
assert.equal(snapshot.overkillReservoirVeinId, "overkill-vein-a");
placeOre(41, 20, "copper", "overkill-vein-b", overkillPickPower * 1.3);
assert.ok(api.debugSetTargetTile(41, 20));
assert.ok(api.attackNow());
assert.notEqual(api.debugGetTile(41, 20).kind, "air", "vein A reserve must not break a vein B node");
snapshot = api.getSnapshot();
assert.equal(snapshot.overkillReservoir, 0);
assert.equal(snapshot.overkillReservoirVeinId, null);
clearTile(41, 20);
placeOre(40, 20, "copper", "overkill-vein-a", overkillPickPower * 0.1);
assert.equal(api.forceDetonate(), true);
placeOre(41, 20, "copper", "overkill-vein-a", overkillPickPower * 1.3);
assert.ok(api.debugSetTargetTile(41, 20));
assert.ok(api.attackNow());
assert.equal(api.debugGetTile(41, 20).kind, "air", "gadget reserve must transfer to the next node of the same vein");
api.finishRun();

// A single blast may destroy several veins. Circle and directional shapes must
// aggregate by vein, retain only the largest real reserve, and never report the
// impossible sum of mutually exclusive reserves.
function assertLargestBlastReserve({ directional, seed }) {
  api.setAllUpgrades(false);
  api.setUpgradeLevel("fortune_alchemist_scales", 5);
  if (directional) api.setUpgradeLevel("gadgets_geo_charge", 3);
  api.startRun({ seed, sectorId: "stable_strata" });
  api.debugSetPlayerTile(40, 20);
  for (let ty = 17; ty <= 23; ty += 1) {
    for (let tx = 37; tx <= 44; tx += 1) clearTile(tx, ty);
  }
  const blastStats = api.getStats();
  const blastDamage = blastStats.pickPower * blastStats.bombPower * 1.8;
  const nodeHp = blastDamage * 0.05;
  placeOre(40, 20, "copper", `${seed}-large`, nodeHp);
  placeOre(41, 20, "copper", `${seed}-large`, nodeHp);
  placeOre(40, 19, "copper", `${seed}-small`, nodeHp);
  assert.equal(api.forceDetonate(1, 0), true);
  const blastSnapshot = api.getSnapshot();
  const expectedReserve = 2 * (blastDamage - nodeHp) * blastStats.overkillReservoirRatio;
  assert.equal(blastSnapshot.overkillReservoirVeinId, `${seed}-large`);
  assert.ok(
    Math.abs(blastSnapshot.overkillReservoir - expectedReserve) < 1e-9,
    `${directional ? "directional" : "circle"} blast must retain the largest vein aggregate only`,
  );
  api.finishRun();
}
assertLargestBlastReserve({ directional: false, seed: "runtime-circle-reserve" });
assertLargestBlastReserve({ directional: true, seed: "runtime-directional-reserve" });

// Sticky Charge is useful before Crew Beacon: on a successful roll it moves
// the epicenter to a nearby ore that the original blast could not reach.
api.setAllUpgrades(false);
api.setUpgradeLevel("gadgets_sticky_charge", 5);
api.startRun({ seed: "runtime-sticky-without-beacon", sectorId: "stable_strata" });
api.debugSetPlayerTile(40, 20);
for (let ty = 17; ty <= 23; ty += 1) {
  for (let tx = 37; tx <= 45; tx += 1) clearTile(tx, ty);
}
placeOre(43, 20, "copper", "sticky-local-target", 1);
assert.equal(api.getSnapshot().crewBeacon, null);
const savedStickyRandom = Math.random;
Math.random = () => 0;
try {
  assert.equal(api.forceDetonate(1, 0), true);
} finally {
  Math.random = savedStickyRandom;
}
assert.equal(api.debugGetTile(43, 20).kind, "air", "sticky charge must attach to ore without Crew Beacon");
api.finishRun();

// A detonation with Magnetic Field installed must create the local field even
// when random bomb procs are suppressed. The first bomb is already guided: a
// valuable ore outside the original blast radius breaks, while the nearby
// low-value decoy outside the moved blast remains intact.
api.setAllUpgrades(false);
api.setUpgradeLevel("gadgets_magnet_mine", 6);
api.startRun({ seed: "runtime-magnetic-field", sectorId: "stable_strata" });
api.debugSetPlayerTile(40, 20);
for (let ty = 18; ty <= 22; ty += 1) {
  for (let tx = 37; tx <= 43; tx += 1) clearTile(tx, ty);
}
placeOre(39, 20, "copper", "magnetic-decoy", 1);
placeOre(42, 20, "star_core", "magnetic-priority", 1);
const magneticFieldsBefore = api.getSnapshot().metrics.magneticFields;
assert.equal(api.forceDetonate(), true);
assert.equal(api.getSnapshot().metrics.magneticFields, magneticFieldsBefore + 1);
assert.equal(api.debugGetTile(42, 20).kind, "air", "the first field bomb must move its epicenter to valuable ore");
assert.notEqual(api.debugGetTile(39, 20).kind, "air", "the moved epicenter must leave the low-value decoy outside the blast");
api.finishRun();

// Thermal Trail widens only the visual/edge band. damageRay keeps the original
// eight-pixel full-power core, while a neighboring edge tile receives exactly
// the advertised level-five 45% damage and is credited to the readable source.
api.setAllUpgrades(false);
api.setFocusedOre(null);
api.setUpgradeLevel("tools_laser_emitter", 1);
api.setUpgradeLevel("tools_laser_width", 5);
api.startRun({ seed: "runtime-thermal-edge", sectorId: "stable_strata" });
api.debugSetPlayerTile(40, 20);
for (let ty = 18; ty <= 22; ty += 1) {
  for (let tx = 39; tx <= 43; tx += 1) clearTile(tx, ty);
}
placeOre(41, 20, "copper", "thermal-core", 10_000);
placeOre(41, 21, "copper", "thermal-edge", 10_000);
assert.ok(api.debugSetTargetTile(41, 20));
const thermalStats = api.getStats();
const thermalCoreBefore = api.debugGetTile(41, 20).hp;
const thermalEdgeBefore = api.debugGetTile(41, 21).hp;
assert.ok(api.attackNow());
const thermalCoreDamage = thermalCoreBefore - api.debugGetTile(41, 20).hp;
const thermalEdgeDamage = thermalEdgeBefore - api.debugGetTile(41, 21).hp;
assert.ok(thermalCoreDamage > 0);
assert.ok(
  Math.abs(thermalEdgeDamage / thermalCoreDamage - thermalStats.laserHeatEdgePower) < 1e-9,
  "thermal edge must receive only its advertised falloff instead of full-width ray damage plus edge damage",
);
placeOre(41, 21, "copper", "thermal-edge-break", thermalEdgeDamage * 0.5);
assert.ok(api.attackNow());
assert.equal(api.getSnapshot().metrics.sourceBreaks["laser-heat"], 1);
api.finishRun();
assert.match(elementFor("#reportDetails").innerHTML, /Термический след/);

// A one-target approach chip must inspect both sides. If its historical first
// side is empty, the existing obstructing side still receives the strike.
api.setAllUpgrades(false);
api.setUpgradeLevel("dig_precision_path", 3);
api.startRun({ seed: "runtime-approach-side-choice", sectorId: "stable_strata" });
api.debugSetPlayerTile(40, 20);
for (let ty = 18; ty <= 22; ty += 1) {
  for (let tx = 39; tx <= 43; tx += 1) clearTile(tx, ty);
}
placeOre(41, 20, "copper", "approach-target", 100);
placeRock(41, 21, 10);
assert.ok(api.debugSetTargetTile(41, 20));
api.debugSetApproachTravel(1);
const obstructingSideBefore = api.debugGetTile(41, 21).hp;
assert.ok(api.attackNow());
assert.ok(api.debugGetTile(41, 21).hp < obstructingSideBefore, "the existing side must receive the one approach chip");
api.finishRun();

// Fault Line follows any critically destroyed primary target, including a
// clearance rock. Its secondary break remains a non-recursive fault-line hit.
api.setAllUpgrades(false);
api.setUpgradeLevel("power_mountain_splitter", 1);
api.startRun({ seed: "runtime-fault-line-clearance", sectorId: "stable_strata" });
api.debugSetPlayerTile(40, 20);
for (let ty = 18; ty <= 22; ty += 1) {
  for (let tx = 39; tx <= 44; tx += 1) clearTile(tx, ty);
}
placeRock(41, 20, 0.1);
placeRock(42, 20, 0.5);
assert.ok(api.debugSetClearanceTargetTile(41, 20));
const savedFaultRandom = Math.random;
Math.random = () => 0;
try {
  assert.ok(api.attackNow());
} finally {
  Math.random = savedFaultRandom;
}
assert.equal(api.debugGetTile(41, 20).kind, "air");
assert.equal(api.debugGetTile(42, 20).kind, "air", "clearance overkill must continue forward through Fault Line");
assert.equal(api.getSnapshot().metrics.sourceBreaks["fault-line"], 1);
api.finishRun();

// A motherlode is also rich at runtime, so its estimator completion must carry
// the same guaranteed rich completion pieces in addition to its cache.
const motherlodeEstimatorBase = {
  runDuration: 45,
  bonusRunDurationCap: 60,
  pickPower: 100000,
  digSpeed: 20,
  moveSpeed: 5000,
  motherlodeGuaranteed: true,
  motherlodeTriggerBreaks: 1,
  motherlodeYieldMultiplier: 2,
  motherlodeCompletionCache: 0,
  motherlodeCompletionTimeBonus: 0,
  richVeinWholeChance: 0,
  richVeinYieldBonus: 0.5,
};
const motherlodeEstimateWithoutRichFinish = api.debugEstimateBalanceRun(
  "runtime-estimator-motherlode-rich",
  { ...motherlodeEstimatorBase, richVeinCompletionBonus: 0 },
);
const motherlodeEstimateWithRichFinish = api.debugEstimateBalanceRun(
  "runtime-estimator-motherlode-rich",
  { ...motherlodeEstimatorBase, richVeinCompletionBonus: 6 },
);
assert.ok(
  motherlodeEstimateWithRichFinish.haul >= motherlodeEstimateWithoutRichFinish.haul + 5.99,
  "motherlode estimator completion must include its rich completion bonus",
);

const balanceReport = api.runBalanceBench();
assert.equal(balanceReport.rows.length, 3);
assert.equal(balanceReport.simulations, 12);
assert.deepEqual(balanceReport.profileBuild.invalidRequirements, [], "bench profiles must respect every tree dependency");

elementFor("#balanceProfile").value = "60";
elementFor("#balanceRuns").value = "2";
const advancedBalanceReport = api.runBalanceBench();
assert.deepEqual(advancedBalanceReport.profileBuild.invalidRequirements, []);
assert.notEqual(advancedBalanceReport.profileBuild.tool, "pickaxe", "the advanced profile must use an advanced tool");
assert.ok(advancedBalanceReport.profileBuild.droneCount > 0, "the advanced profile must include working drones");
assert.ok(advancedBalanceReport.rows.every((row) => row.averageHaul > 0 && row.averageBlocks > 0));

elementFor("#balanceProfile").value = "95";
elementFor("#balanceRuns").value = "1";
const prefinalBalanceReport = api.runBalanceBench();
assert.deepEqual(prefinalBalanceReport.profileBuild.invalidRequirements, []);
assert.equal(prefinalBalanceReport.profileBuild.laserUnlocked, true, "the prefinal profile must exercise the laser model");

// Four to six eventless shifts arm one physical, locally rendered event near
// the current start (including lift starts) and make it the next sense target.
api.setAllUpgrades(false);
const pitySetup = api.debugSetEventPity(5, 0);
assert.equal(pitySetup.threshold, 5);
api.startRun({ seed: "runtime-event-pity", sectorId: "stable_strata" });
let pitySnapshot = api.getSnapshot();
assert.equal(pitySnapshot.eventPity.armed, true);
assert.ok(pitySnapshot.eventPity.stagedEventId);
api.stepRun(0.2);
pitySnapshot = api.getSnapshot();
assert.ok(
  pitySnapshot.target?.kind === "micro_event" || pitySnapshot.metrics.eventCount > 0,
  `the staged chest must be targeted or already collected: ${JSON.stringify({ pity: pitySnapshot.eventPity, target: pitySnapshot.target, metrics: pitySnapshot.metrics })}`,
);
api.finishRun();

// Once projected wall-clock end already reaches 60 seconds, a late bonus must
// grant/log nothing and must not recharge Chrono Overdrive past the real cap.
api.setAllUpgrades(false);
api.setUpgradeLevel("time_thirty_second_oath", 1);
api.startRun({ seed: "runtime-late-bonus-cap", sectorId: "stable_strata" });
api.grantBonusTime(100);
api.stepRun(55);
const lateBonusBefore = api.getSnapshot();
const lateGranted = api.grantBonusTime(10);
const lateBonusAfter = api.getSnapshot();
assert.ok(lateGranted <= 1e-6, "a bonus beyond the projected absolute end must grant zero real seconds");
assert.ok(lateBonusAfter.activeWallElapsed + lateBonusAfter.timeLeft <= 60 + 1e-6);
assert.ok(Math.abs(lateBonusAfter.bonusTimeEarned - lateBonusBefore.bonusTimeEarned) <= 1e-6);
assert.ok(Math.abs(lateBonusAfter.chronoOverflowRemaining - lateBonusBefore.chronoOverflowRemaining) <= 1e-6);
api.finishRun();

// Hidden geology must never masquerade as the actual haul. An amethyst-biased
// map with only copper and coal collected stays neutral, and one incidental
// amethyst among a hundred copper pieces is still too weak to name the report.
let amethystBiasSeed = null;
for (let index = 0; index < 10_000 && !amethystBiasSeed; index += 1) {
  const candidateSeed = `runtime-amethyst-bias-${index}`;
  const profile = global.DepthZeroWorld.createRandomGeologyProfile(
    candidateSeed,
    global.DepthZeroUpgrades.ORE_TYPES,
  );
  if (profile.trait === "ore_bias" && profile.oreBias?.id === "amethyst") {
    amethystBiasSeed = candidateSeed;
  }
}
assert.ok(amethystBiasSeed, "a deterministic amethyst-bias fixture must exist");
api.setAllUpgrades(false);
api.startRun({ seed: amethystBiasSeed });
for (let index = 0; index < 2; index += 1) {
  placeOre(70, 12, "copper", `geology-copper-${index}`, 1);
  assert.ok(api.debugBreakTileWithSource(70, 12, "debug"));
}
placeOre(70, 12, "coal", "geology-coal", 1);
assert.ok(api.debugBreakTileWithSource(70, 12, "debug"));
api.finishRun();
snapshot = api.getSnapshot();
assert.match(snapshot.lastRunReport.sectorLabel, /ГЛУБИННЫЙ УКЛОН/);
assert.doesNotMatch(
  `${snapshot.lastRunReport.sectorLabel} ${snapshot.lastRunReport.geologyDetail}`,
  /АМЕТИСТ/,
  "an uncollected biased ore must not be reported as part of the haul",
);

api.startRun({ seed: amethystBiasSeed });
for (let index = 0; index < 100; index += 1) {
  placeOre(70, 12, "copper", `geology-major-copper-${index}`, 1);
  assert.ok(api.debugBreakTileWithSource(70, 12, "debug"));
}
placeOre(70, 12, "amethyst", "geology-incidental-amethyst", 1);
assert.ok(api.debugBreakTileWithSource(70, 12, "debug"));
api.finishRun();
snapshot = api.getSnapshot();
assert.match(snapshot.lastRunReport.sectorLabel, /ГЛУБИННЫЙ УКЛОН/);
assert.doesNotMatch(
  `${snapshot.lastRunReport.sectorLabel} ${snapshot.lastRunReport.geologyDetail}`,
  /АМЕТИСТ/,
  "one incidental biased piece must not outweigh the real haul",
);

api.setAllUpgrades(true);
api.setUpgradeLevel("core_bon_voyage", 0);
api.startRun({ seed: "runtime-timer-cap", sectorId: "stable_strata" });
api.grantBonusTime(100);
snapshot = api.getSnapshot();
assert.ok(snapshot.timeLeft <= 60, "bonus countdown must be clamped at 60");
api.stepRun(61);
snapshot = api.getSnapshot();
assert.equal(snapshot.mode, "result", "absolute bonus wall-clock cap should end the run");
assert.ok(snapshot.activeWallElapsed <= 60 + 0.051);

// Recreate the complete game runtime against the same localStorage map. This
// catches reload-only regressions that a serialized-field assertion cannot.
api.debugResetProgress();
api.grantOre("copper", 20);
api.openUpgrades();
assert.equal(api.buyUpgrade("core_first_descent"), true);
assert.equal(api.getUpgradeCatalog().find((upgrade) => upgrade.id === "time_extra_breath").available, false);
const gameModulePath = require.resolve(path.join(root, "js", "game.js"));
delete require.cache[gameModulePath];
require(gameModulePath);
const reloadedApi = global.__DEPTH_ZERO__;
assert.notEqual(reloadedApi, api, "reload regression should use a fresh game runtime");
assert.equal(
  reloadedApi.getUpgradeCatalog().find((upgrade) => upgrade.id === "time_extra_breath").available,
  false,
  "a real runtime reload must preserve the pending child gate",
);
reloadedApi.startRun({ seed: 14002 });
reloadedApi.stepRun(8);
assert.equal(
  reloadedApi.getUpgradeCatalog().find((upgrade) => upgrade.id === "time_extra_breath").available,
  true,
  "one completed shift after reload must prepare the pending child",
);
grantWorkshopBudget(reloadedApi);
const reloadCapCandidates = reloadedApi.getUpgradeCatalog()
  .filter((upgrade) => upgrade.level === 0 && upgrade.available)
  .slice(0, 5);
assert.equal(reloadCapCandidates.length, 5);
for (const candidate of reloadCapCandidates.slice(0, 4)) {
  assert.equal(reloadedApi.buyUpgrade(candidate.id), true);
}
assert.equal(reloadedApi.buyUpgrade(reloadCapCandidates[4].id), false);
delete require.cache[gameModulePath];
require(gameModulePath);
const capReloadedApi = global.__DEPTH_ZERO__;
const reloadBlocked = capReloadedApi.getUpgradeCatalog().find((upgrade) => upgrade.id === reloadCapCandidates[4].id);
assert.equal(reloadBlocked.available, false, "reloading the runtime must not restore a consumed first-rank slot");
assert.equal(reloadBlocked.pendingReason, "capacity");
const reloadStarted = reloadCapCandidates.find((candidate) => candidate.maxLevel > 1);
assert.ok(reloadStarted);
assert.equal(capReloadedApi.buyUpgrade(reloadStarted.id), true, "reload must still allow later ranks on an already-started node");
snapshot = capReloadedApi.getSnapshot();

console.log(JSON.stringify({
  ok: true,
  nodes: snapshot.upgrades,
  directCap: fullStats.runDuration,
  bonusCap: fullStats.bonusRunDurationCap,
  checkedMechanics: [
    "mine-lift",
    "lift-floor-exploration",
    "wide-viewport-camera-centering",
    "focus-escalation",
    "backup-target",
    "indexed-target-search",
    "least-resistance-route",
    "point-blank-pick-contact",
    "tool-tier-rock-break-feedback",
    "pressed-ore-full-contact",
    "focused-calibration",
    "aggregate-laser-calibration",
    "independent-ricochet-power",
    "no-remote-focused-damage",
    "discovery-time",
    "directional-charge",
    "crew-beacon",
    "crew-beacon-fallback",
    "crew-beacon-range-fallback",
    "laser-ricochet",
    "catalog-final-bonus",
    "deaf-knock",
    "super-pick-echo",
    "echo-no-triple-sample",
    "triangular-fix",
    "triangle-aoe-snapshot",
    "bounded-terrain-base-cache",
    "random-geology-without-sector-choice",
    "geology-report-matches-haul",
    "short-global-micro-events",
    "soft-rock-laser-ray",
    "resonant-ping",
    "deep-resonance-sector",
    "opening-sprint",
    "target-relay-sprint",
    "fault-finder-cadence",
    "vein-memory-through-rock",
    "stress-map-outside-sense",
    "expanded-exploration-reacquisition",
    "solar-drill-delayed-burst",
    "solar-drill-final-seal-comic",
    "target-aware-density-pierce",
    "side-chip",
    "chrono-overdrive",
    "drone-bonus-autonomy",
    "fortune-pity-cycle",
    "motherlode-covenant",
    "golden-touch-gating",
    "rich-remaining-nodes",
    "sticky-without-beacon",
    "magnetic-field",
    "multi-vein-gadget-reserve",
    "thermal-edge-falloff",
    "approach-side-choice",
    "fault-line-clearance",
    "priority-depth-scaled-chest",
    "dry-shift-event-pity",
    "run-diagnostics",
    "geological-journal",
    "local-balance-bench",
    "persistent-workshop-session-gate",
    "workshop-first-rank-cap",
    "workshop-level-cap",
    "absolute-60-second-cap",
    "field-guide-auto-collapse",
  ],
}));
