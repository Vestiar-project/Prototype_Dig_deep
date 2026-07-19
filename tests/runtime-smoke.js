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
  addEventListener() {}
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
global.document = {
  hidden: false,
  activeElement: null,
  querySelector: (selector) => elementFor(selector),
  querySelectorAll: () => [],
  createElement: (tagName) => new StubElement(tagName),
  createElementNS: (_namespace, tagName) => new StubElement(tagName),
  createDocumentFragment: () => new StubElement("fragment"),
  addEventListener() {},
};

const root = path.resolve(__dirname, "..");
require(path.join(root, "js", "upgrades.js"));
require(path.join(root, "js", "world.js"));
require(path.join(root, "js", "game.js"));

const api = global.__DEPTH_ZERO__;
assert.ok(api, "runtime diagnostics API should initialize");
assert.equal(api.getSnapshot().upgrades, 102, "all selected upgrade nodes should be registered");

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

api.setAllUpgrades(true);
const fullStats = api.getStats();
assert.equal(fullStats.runDuration, 45, "direct timer upgrades must stop at 45 seconds");
assert.equal(fullStats.bonusRunDurationCap, 60, "bonus runtime cap must be 60 seconds");
assert.equal(fullStats.backupTargetSlots, 1);
assert.equal(fullStats.oreFocusEscalationBonus, 0.75);
assert.equal(fullStats.mineLiftRecordDepthRatio, 0.35);
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
  magneticFieldDuration: 2.7,
  magneticFieldRadiusTiles: 3,
  magneticFieldTargetingBonus: 0.48,
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

const escalated = api.forceFocusMiss(3.5);
assert.ok(escalated > 2.15, "focus search radius should escalate after the delay");

const targetPair = api.acquireTargets();
assert.ok(targetPair?.primary && targetPair?.backup, "second fix should keep a distinct backup target");
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

api.acquireTargets();
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
placeOre(150, 20, "star_core", "distant-live-beacon", 1000);
assert.ok(api.debugSetTargetTile(150, 20));
assert.equal(api.debugValidateCrewBeacon(), true);
placeOre(21, 20, "star_core", "nearby-fallback", 2000);
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
assert.equal(api.debugGetMicroEvents().length, 5);

// Deaf Knock needs eight consecutive main-tool rock breaks at max level. A
// remote drone ore break must not erase that streak, and focus must filter the
// enlarged pulse to the chosen ore.
api.setFocusedOre("gold");
api.debugSetPlayerTile(40, 20);
placeOre(42, 20, "copper", "deaf-decoy", 1_000_000);
placeOre(46, 20, "gold", "deaf-focus", 1_000_000);
const deafBefore = api.getSnapshot().metrics.deafKnocks;
for (let index = 0; index < 7; index += 1) {
  placeRock(70 + index, 12);
  assert.ok(api.debugBreakTileWithSource(70 + index, 12, "laser"));
}
assert.equal(api.getSnapshot().metrics.deafKnocks, deafBefore, "the pulse must not fire before the eighth dry break");
placeOre(78, 12, "coal", "remote-drone-find", 1);
assert.ok(api.debugBreakTileWithSource(78, 12, "drone"));
placeRock(77, 12);
assert.ok(api.debugBreakTileWithSource(77, 12, "laser"));
snapshot = api.getSnapshot();
assert.equal(snapshot.metrics.deafKnocks, deafBefore + 1, "the eighth main-tool rock must fire Deaf Knock");
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

// Every micro-event gets a natural proximity trigger or an explicit semantic
// assertion for its compact top-line timer and concrete gameplay result.
api.setAllUpgrades(false);
api.startRun({ seed: "micro-event-semantics", sectorId: "stable_strata" });
let events = api.debugGetMicroEvents();
assert.equal(events.length, 5);
const fragile = events.find((event) => event.type === "fragile_cavity");
const priorityChest = events.find((event) => event.type === "ancient_container");
assert.ok(fragile);
assert.ok(priorityChest);
const chestApproachDirection = priorityChest.tx < 120 ? 1 : -1;
const chestApproachTx = priorityChest.tx + chestApproachDirection * 2;
api.debugSetPlayerTile(chestApproachTx, priorityChest.ty);
placeOre(chestApproachTx + chestApproachDirection, priorityChest.ty, "copper", "chest-priority-decoy", 1_000_000);
api.stepRun(0.01);
snapshot = api.getSnapshot();
assert.equal(snapshot.target?.kind, "micro_event", "a chest entering the scanner must override ordinary ore targets");
assert.deepEqual([snapshot.target.tx, snapshot.target.ty], [priorityChest.tx, priorityChest.ty]);
api.debugSetPlayerTile(fragile.tx, fragile.ty);
api.stepRun(0.2);
snapshot = api.getSnapshot();
assert.equal(snapshot.metrics.microEvents.fragile_cavity, 1, "entering the bright event contour must trigger it naturally");
assert.equal(snapshot.activeMicroEvent.type, "fragile_cavity");
assert.match(elementFor("#microEventTitle").textContent, /МЯГКАЯ ПОРОДА/);
assert.equal(elementFor("#microEventTimer").textContent, "5,0 С");
assert.ok(!elementFor("#microEventBanner").classList.contains("hidden"));
assert.ok(!elementFor("#microEventBanner").classList.contains("is-triggered"));
assert.ok(!elementFor("#microEventBanner").classList.contains("is-preview"));
assert.ok(snapshot.eventSoftRockRemaining > 4.7, "fragile cavity must soften rock globally for five seconds");

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
assert.equal(api.debugGetMicroEvents().length, 0, "all five events must remain one-shot");
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

// The covenant marks an already existing highest-tier vein after twenty ore
// breaks. Completing that exact vein must grant its cache/time reward.
api.setAllUpgrades(false);
api.setUpgradeLevel("fortune_motherlode_covenant", 1);
api.startRun({ seed: "runtime-motherlode", sectorId: "stable_strata" });
for (let tx = 90; tx <= 92; tx += 1) placeOre(tx, 12, "star_core", "motherlode-candidate", 1);
assert.ok(api.debugBreakTileWithSource(90, 12, "debug"), "the first sample should reveal the candidate tier");
for (let index = 0; index < 19; index += 1) {
  placeOre(100 + index, 12, "copper", `motherlode-feed-${index}`, 1);
  assert.ok(api.debugBreakTileWithSource(100 + index, 12, "debug"));
}
snapshot = api.getSnapshot();
assert.equal(snapshot.metrics.motherlodes, 1, "the twentieth break must mark one existing motherlode");
const motherlodeBonusBefore = snapshot.bonusTimeEarned;
assert.ok(api.debugBreakTileWithSource(91, 12, "debug"));
assert.ok(api.debugBreakTileWithSource(92, 12, "debug"));
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

elementFor("#balanceProfile").value = "90";
elementFor("#balanceRuns").value = "1";
const prefinalBalanceReport = api.runBalanceBench();
assert.deepEqual(prefinalBalanceReport.profileBuild.invalidRequirements, []);
assert.equal(prefinalBalanceReport.profileBuild.laserUnlocked, true, "the prefinal profile must exercise the laser model");

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

api.setAllUpgrades(true);
api.startRun({ seed: "runtime-timer-cap", sectorId: "stable_strata" });
api.grantBonusTime(100);
snapshot = api.getSnapshot();
assert.ok(snapshot.timeLeft <= 60, "bonus countdown must be clamped at 60");
api.stepRun(61);
snapshot = api.getSnapshot();
assert.equal(snapshot.mode, "result", "absolute bonus wall-clock cap should end the run");
assert.ok(snapshot.activeWallElapsed <= 60 + 0.051);

console.log(JSON.stringify({
  ok: true,
  nodes: snapshot.upgrades,
  directCap: fullStats.runDuration,
  bonusCap: fullStats.bonusRunDurationCap,
  checkedMechanics: [
    "mine-lift",
    "focus-escalation",
    "backup-target",
    "indexed-target-search",
    "least-resistance-route",
    "point-blank-pick-contact",
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
    "triangular-fix",
    "random-geology-without-sector-choice",
    "short-global-micro-events",
    "resonant-ping",
    "vein-memory-through-rock",
    "side-chip",
    "chrono-overdrive",
    "fortune-pity-cycle",
    "motherlode-covenant",
    "golden-touch-gating",
    "magnetic-field",
    "multi-vein-gadget-reserve",
    "thermal-edge-falloff",
    "approach-side-choice",
    "fault-line-clearance",
    "priority-depth-scaled-chest",
    "run-diagnostics",
    "geological-journal",
    "local-balance-bench",
    "absolute-60-second-cap",
  ],
}));
