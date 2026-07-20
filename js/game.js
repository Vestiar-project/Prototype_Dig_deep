(() => {
"use strict";

const upgradesApi = window.DepthZeroUpgrades;
const worldApi = window.DepthZeroWorld;

if (!upgradesApi || !worldApi) {
  throw new Error('Не удалось загрузить данные улучшений или генератор мира.');
}

const {
  ORE_TYPES,
  UPGRADE_DEFS,
  calculateMetaStats,
  getUpgradeRecipe,
  canAffordRecipe,
  spendRecipe,
  createOreBag,
  sanitizeOreBag,
  addOreBag,
  countOreBag,
  countPurchasedLevels,
} = upgradesApi;
const { MineWorld, WORLD_CONFIG } = worldApi;

const canvas = document.querySelector('#gameCanvas');
const ctx = canvas.getContext('2d', { alpha: false });
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const lerp = (a, b, amount) => a + (b - a) * amount;
const distance = (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay);
const REDUCED_MOTION = Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
const MOBILE_UPGRADE_INTERACTION_QUERY = '(hover: none) and (pointer: coarse)';
const usesMobileUpgradeControls = () => {
  const pointerQuery = window.matchMedia?.(MOBILE_UPGRADE_INTERACTION_QUERY);
  if (pointerQuery) return Boolean(pointerQuery.matches);
  return Boolean(window.navigator?.maxTouchPoints > 0 && window.innerWidth <= 1024);
};
const formatNumber = (value) => {
  const number = Math.max(0, Number(value) || 0);
  if (number < 1_000) return Math.floor(number).toLocaleString('ru-RU');
  if (number < 1_000_000) return `${(number / 1_000).toFixed(number < 10_000 ? 1 : 0)} тыс.`;
  return `${(number / 1_000_000).toFixed(number < 10_000_000 ? 1 : 0)} млн`;
};
const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (character) => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  "'": '&#39;',
  '"': '&quot;',
})[character]);

const TILE_SIZE = WORLD_CONFIG.TILE_SIZE || 28;
const TERRAIN_BASE_CACHE_LIMIT = 1800;
const MINER_COLLISION_RADIUS = 8;
const MIN_RUN_SECONDS = 6;
const DIRECT_MAX_RUN_SECONDS = 45;
const BONUS_MAX_RUN_SECONDS = 60;
const EXPLORATION_SCAN_TILES = 18;
const WORKSHOP_FIRST_RANK_CAP = 4;
const STORAGE_KEY = 'depth-zero-save-v1';
const CAMPAIGN = Object.freeze({
  requiredLifetimeChunks: 4_000,
  finalUpgrade: 'core_bon_voyage',
  capstones: Object.freeze([
    'sense_earth_call',
    'dig_quarry_presence',
    'power_mountain_splitter',
    'time_thirty_second_oath',
    'gadgets_demolition_orchestra',
    'tools_solar_drill',
    'fortune_motherlode_covenant',
  ]),
});
const CAMPAIGN_PROGRESS_TOOLS = Object.freeze([
  'tools_iron_pick',
  'tools_steel_pick',
  'tools_pneumatic_pick',
  'tools_super_pick',
  'tools_laser_emitter',
  'tools_solar_drill',
]);
// The headless campaign buyer represents a player who deliberately works
// toward transformative tool tiers instead of exhausting every cheap flat
// level first. Target levels cover only the prerequisites needed for the next
// tool; later levels return to the ordinary cost/depth ordering.
const CAMPAIGN_AUTOBUY_TARGETS = Object.freeze({
  tools_iron_pick: 1,
  tools_steel_pick: 1,
  tools_pneumatic_pick: 1,
  gadgets_scout_drone: 1,
  power_diamond_tip: 1,
  tools_super_pick: 1,
  tools_super_motor: 1,
  tools_super_teeth: 1,
  tools_super_field: 1,
  tools_laser_emitter: 1,
  tools_laser_range: 1,
  tools_laser_power: 1,
  tools_laser_width: 1,
  tools_laser_splitter: 2,
  power_corebreaker: 2,
  tools_solar_drill: 1,
});
const CAMPAIGN_AUTOBUY_WEIGHTS = Object.freeze({
  tools_iron_pick: 0.18,
  tools_steel_pick: 0.18,
  tools_pneumatic_pick: 0.16,
  gadgets_scout_drone: 0.16,
  power_diamond_tip: 0.24,
  tools_super_pick: 0.14,
  tools_super_motor: 0.24,
  tools_super_teeth: 0.24,
  tools_super_field: 0.2,
  tools_laser_emitter: 0.12,
  tools_laser_range: 0.24,
  tools_laser_power: 0.24,
  tools_laser_width: 0.22,
  tools_laser_splitter: 0.18,
  power_corebreaker: 0.22,
  tools_solar_drill: 0.12,
});
// First ranks that visibly change play instead of only increasing a scalar.
// The workshop remains free-choice; this marker only helps diagnostics and
// simulated buyers spend their four new-node slots on actual breakthroughs.
const BREAKTHROUGH_FIRST_RANK_IDS = new Set([
  'sense_echo_pulse',
  'sense_clear_signal',
  'sense_vein_whisper',
  'sense_seismic_memory',
  'sense_ore_focus',
  'sense_priority_tuning',
  'sense_ghost_outline',
  'sense_second_fix',
  'sense_frequency_swing',
  'sense_deaf_knock',
  'sense_triangular_fix',
  'sense_earth_call',
  'dig_sweeping_arc',
  'dig_twin_stroke',
  'dig_precision_path',
  'dig_wall_bite',
  'dig_omni_swing',
  'dig_least_resistance',
  'dig_mine_lift',
  'dig_quarry_presence',
  'power_furious_swing',
  'power_momentum',
  'power_shatterpoint',
  'power_overcharge_strike',
  'power_one_hit_legend',
  'power_sample_calibration',
  'power_mountain_splitter',
  'time_clockwork_heart',
  'time_capsule',
  'time_thirty_second_oath',
  'gadgets_powder_pocket',
  'gadgets_cluster_shell',
  'gadgets_sticky_charge',
  'gadgets_chain_spark',
  'gadgets_shock_capsule',
  'gadgets_magnet_mine',
  'gadgets_scout_drone',
  'gadgets_drone_swarm',
  'gadgets_volatile_jackpot',
  'gadgets_geo_charge',
  'gadgets_crew_beacon',
  'gadgets_demolition_orchestra',
  'tools_iron_pick',
  'tools_steel_pick',
  'tools_pneumatic_pick',
  'tools_super_pick',
  'tools_super_field',
  'tools_laser_emitter',
  'tools_laser_width',
  'tools_laser_splitter',
  'tools_mirror_crystal',
  'tools_super_pick_echo',
  'tools_solar_drill',
  'fortune_glimmer_hunter',
  'fortune_rich_vein',
  'fortune_double_yield',
  'fortune_triple_seam',
  'fortune_alchemist_scales',
  'fortune_deep_market',
  'fortune_golden_touch',
  'fortune_relic_magnet',
  'fortune_wheel',
  'fortune_findings_catalog',
  'fortune_motherlode_covenant',
  'core_bon_voyage',
]);
const DEFAULT_SAVE = Object.freeze({
  version: 10,
  inventory: createOreBag(),
  lifetimeOres: createOreBag(),
  lifetimeChunks: 0,
  levels: {},
  runs: 0,
  bestHaul: 0,
  bestDepth: 0,
  focusedOreId: null,
  sound: true,
  endingSeen: false,
  campaignComplete: false,
  tutorialSeen: {},
  tutorialVersion: 2,
  oreRecords: {},
  lastRunReport: null,
  bestRunReport: null,
  preferredSectorId: null,
  balanceHistory: [],
  pinnedUpgradeId: null,
  pendingShowcases: {},
  runsSinceEvent: 0,
  totalEvents: 0,
  workshopEligibilityRun: -1,
  workshopEligibleIds: [],
  workshopInstallRun: -1,
  workshopInstalledIds: [],
});

function createDefaultSave() {
  return {
    ...DEFAULT_SAVE,
    inventory: createOreBag(),
    lifetimeOres: createOreBag(),
    levels: {},
    tutorialSeen: {},
    oreRecords: {},
    lastRunReport: null,
    bestRunReport: null,
    preferredSectorId: null,
    balanceHistory: [],
    pinnedUpgradeId: null,
    pendingShowcases: {},
    workshopEligibleIds: [],
    workshopInstalledIds: [],
  };
}

function migrateLegacyBalance(value) {
  const total = Math.max(0, Math.floor(Number(value) || 0));
  const coal = Math.floor(total * 0.125);
  const iron = Math.floor(total * 0.0375);
  return {
    copper: Math.max(0, total - coal * 2 - iron * 4),
    coal,
    iron,
  };
}

function migrateUpgradeLevels(source = {}, storedVersion = 0) {
  const levels = source && typeof source === 'object' ? { ...source } : {};
  if ((Number(storedVersion) || 0) >= 7) return levels;
  const owned = (id) => Math.max(0, Math.floor(Number(levels[id]) || 0));
  const setLevel = (id, value, cap) => {
    levels[id] = clamp(Math.max(owned(id), Math.ceil(Number(value) || 0)), 0, cap);
  };

  // Collapse repeated numeric nodes without taking already bought strength
  // away from an old save.
  setLevel(
    'sense_instinct_spark',
    (owned('sense_instinct_spark') * 8 + owned('sense_ore_scent') * 12 + owned('sense_wide_sweep') * 18) / 22,
    18,
  );
  setLevel(
    'dig_arm_swing',
    (owned('dig_arm_swing') * 4 + owned('dig_long_handle') * 6) / 5,
    18,
  );
  setLevel(
    'tools_balanced_handle',
    (owned('tools_balanced_handle') * 0.04 + owned('dig_relentless_rhythm') * 0.06) / 0.05,
    12,
  );
  setLevel(
    'power_sharpened_edge',
    (owned('power_sharpened_edge') * 0.35 + owned('power_weighted_head') * 0.55) / 0.45,
    18,
  );
  setLevel(
    'fortune_prospector_ledger',
    (owned('fortune_prospector_ledger') * 0.03 + owned('fortune_ore_appraisal') * 0.05) / 0.04,
    18,
  );
  setLevel(
    'tools_laser_range',
    (owned('tools_laser_range') * 60 + owned('tools_laser_lens') * 35) / 50,
    10,
  );

  const directSeconds = (
    owned('time_extra_breath') * 0.25
    + owned('time_wound_spring') * 0.35
    + owned('time_sand_reserve') * 0.5
    + owned('time_stolen_second') * 0.75
    + owned('time_clockwork_heart') * 0.6
    + owned('time_capsule')
    + owned('time_overtime_protocol') * 1.25
    + owned('time_deep_shift') * 1.2
    + owned('time_keeper') * 1.5
  );
  const oldOath = owned('time_thirty_second_oath') > 0;
  let remainingSeconds = oldOath ? 39 : directSeconds;
  const extraLevel = Math.min(8, Math.ceil(Math.min(6, remainingSeconds) / 0.75));
  remainingSeconds = Math.max(0, remainingSeconds - extraLevel * 0.75);
  let heartLevel = Math.min(8, Math.ceil(Math.min(9, remainingSeconds) / 1.125));
  remainingSeconds = Math.max(0, remainingSeconds - heartLevel * 1.125);
  let capsuleLevel = Math.min(6, Math.ceil(remainingSeconds / 4));
  if (owned('time_frozen_moment') > 0) heartLevel = Math.max(heartLevel, 3);
  if (owned('time_aftershock_clock') > 0) heartLevel = Math.max(heartLevel, 6);
  if (owned('time_last_second') > 0) heartLevel = 8;
  if (owned('time_discovery_bonus') > 0) {
    capsuleLevel = Math.max(capsuleLevel, Math.ceil(owned('time_discovery_bonus') * 0.15 / 0.08));
  }
  if (owned('time_chrono_shard') > 0) capsuleLevel = Math.max(capsuleLevel, 5);
  if (owned('time_elastic_second') > 0) capsuleLevel = 6;
  setLevel('time_extra_breath', oldOath ? 8 : extraLevel, 8);
  setLevel('time_clockwork_heart', oldOath ? 8 : heartLevel, 8);
  setLevel('time_capsule', oldOath ? 6 : capsuleLevel, 6);
  if (owned('time_clockwork_heart') > 0) {
    setLevel('dig_arm_swing', 1, 18);
    setLevel('dig_light_footwork', 3, 8);
  }
  if (owned('time_capsule') > 0) setLevel('tools_balanced_handle', 5, 12);

  for (const removedId of [
    'sense_ore_scent',
    'sense_wide_sweep',
    'dig_long_handle',
    'dig_relentless_rhythm',
    'power_weighted_head',
    'fortune_ore_appraisal',
    'tools_laser_lens',
    'time_wound_spring',
    'time_sand_reserve',
    'time_stolen_second',
    'time_overtime_protocol',
    'time_frozen_moment',
    'time_aftershock_clock',
    'time_last_second',
    'time_chrono_shard',
    'time_elastic_second',
    'time_deep_shift',
    'time_keeper',
    'time_discovery_bonus',
  ]) delete levels[removedId];
  return levels;
}

function loadSave() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (!stored || typeof stored !== 'object') return createDefaultSave();
    const storedVersion = Math.max(0, Math.floor(Number(stored.version) || 0));
    const levels = migrateUpgradeLevels(stored.levels, storedVersion);
    const hasLegacyBranchProgress = Object.entries(levels).some(([id, level]) => (
      id !== 'core_first_descent'
      && id !== 'core_bon_voyage'
      && Number(level) > 0
    ));
    if (hasLegacyBranchProgress && !Number(levels.core_first_descent)) {
      levels.core_first_descent = 1;
    }
    const typedInventory = stored.inventory && typeof stored.inventory === 'object';
    const typedLifetime = stored.lifetimeOres && typeof stored.lifetimeOres === 'object';
    const inventory = typedInventory
      ? sanitizeOreBag(stored.inventory)
      : addOreBag(createOreBag(), migrateLegacyBalance(stored.currency));
    const lifetimeOres = typedLifetime
      ? sanitizeOreBag(stored.lifetimeOres)
      : addOreBag(createOreBag(), migrateLegacyBalance(stored.lifetimeOre));
    const migratedLifetimeChunks = Number.isFinite(Number(stored.lifetimeChunks))
      ? Math.max(0, Math.floor(Number(stored.lifetimeChunks)))
      : typedLifetime
        ? countOreBag(lifetimeOres)
        : Math.max(0, Math.floor((Number(stored.lifetimeOre) || 0) / 47.5));
    const merged = {
      ...DEFAULT_SAVE,
      ...stored,
      version: DEFAULT_SAVE.version,
      tutorialVersion: DEFAULT_SAVE.tutorialVersion,
      inventory,
      lifetimeOres,
      lifetimeChunks: migratedLifetimeChunks,
      levels,
      focusedOreId: ORE_TYPES.some((ore) => ore.id === stored.focusedOreId) ? stored.focusedOreId : null,
      tutorialSeen: stored.tutorialSeen && typeof stored.tutorialSeen === 'object' ? { ...stored.tutorialSeen } : {},
      oreRecords: stored.oreRecords && typeof stored.oreRecords === 'object' ? { ...stored.oreRecords } : {},
      lastRunReport: stored.lastRunReport && typeof stored.lastRunReport === 'object' ? { ...stored.lastRunReport } : null,
      bestRunReport: stored.bestRunReport && typeof stored.bestRunReport === 'object' ? { ...stored.bestRunReport } : null,
      preferredSectorId: typeof stored.preferredSectorId === 'string' ? stored.preferredSectorId : null,
      balanceHistory: Array.isArray(stored.balanceHistory) ? stored.balanceHistory.slice(-12) : [],
      pinnedUpgradeId: typeof stored.pinnedUpgradeId === 'string' ? stored.pinnedUpgradeId : null,
      pendingShowcases: stored.pendingShowcases && typeof stored.pendingShowcases === 'object'
        ? { ...stored.pendingShowcases }
        : {},
      runsSinceEvent: Math.max(0, Math.floor(Number(stored.runsSinceEvent) || 0)),
      totalEvents: Math.max(0, Math.floor(Number(stored.totalEvents) || 0)),
      workshopEligibilityRun: storedVersion >= 9 && Number.isFinite(Number(stored.workshopEligibilityRun))
        ? Math.max(-1, Math.floor(Number(stored.workshopEligibilityRun)))
        : -1,
      workshopEligibleIds: storedVersion >= 9 && Array.isArray(stored.workshopEligibleIds)
        ? [...new Set(stored.workshopEligibleIds.filter((id) => typeof id === 'string'))]
        : [],
      workshopInstallRun: storedVersion >= 10 && Number.isFinite(Number(stored.workshopInstallRun))
        ? Math.max(-1, Math.floor(Number(stored.workshopInstallRun)))
        : -1,
      workshopInstalledIds: storedVersion >= 10 && Array.isArray(stored.workshopInstalledIds)
        ? [...new Set(stored.workshopInstalledIds.filter((id) => typeof id === 'string'))]
        : [],
    };
    delete merged.currency;
    delete merged.lifetimeOre;
    delete merged.activeMiningSeconds;
    return merged;
  } catch {
    return createDefaultSave();
  }
}

let save = loadSave();
let stats = normalizeStats(calculateMetaStats(save.levels));

function persistSave() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(save));
  } catch {
    // The run remains playable when storage is unavailable.
  }
}

function normalizeStats(source = {}) {
  return {
    ...source,
    senseRadius: source.senseRadius ?? 128,
    digReach: source.digReach ?? 38,
    digRadius: source.digRadius ?? 8,
    areaMiningUnlocked: Boolean(source.areaMiningUnlocked),
    pickPower: source.pickPower ?? 18,
    digSpeed: source.digSpeed ?? 4.2,
    moveSpeed: source.moveSpeed ?? 108,
    runDuration: clamp(source.runDuration ?? MIN_RUN_SECONDS, MIN_RUN_SECONDS, DIRECT_MAX_RUN_SECONDS),
    maxRunDuration: DIRECT_MAX_RUN_SECONDS,
    bonusRunDurationCap: clamp(source.bonusRunDurationCap ?? BONUS_MAX_RUN_SECONDS, DIRECT_MAX_RUN_SECONDS, BONUS_MAX_RUN_SECONDS),
    critChance: source.critChance ?? 0.05,
    critMultiplier: source.critMultiplier ?? 2,
    bombChance: source.bombChance ?? 0,
    bombPower: source.bombPower ?? 44,
    bombRadius: source.bombRadius ?? 62,
    chainChance: source.chainChance ?? 0,
    chainCount: source.chainCount ?? 0,
    droneCount: source.droneCount ?? 0,
    dronePower: source.dronePower ?? 8,
    droneSpeed: source.droneSpeed ?? 1.4,
    laserUnlocked: Boolean(source.laserUnlocked),
    laserRange: source.laserRange ?? 210,
    laserWidth: source.laserWidth ?? 10,
    superPickUnlocked: Boolean(source.superPickUnlocked),
    oreValueMultiplier: source.oreValueMultiplier ?? 1,
    extraYieldChance: source.extraYieldChance ?? 0,
    comboWindow: source.comboWindow ?? 0.9,
    comboMultiplier: source.comboMultiplier ?? 0.06,
    luck: source.luck ?? 0,
    oreFocusUnlocked: Boolean(source.oreFocusUnlocked),
    oreFocusRadiusMultiplier: source.oreFocusRadiusMultiplier ?? 1,
    backupTargetSlots: Math.max(0, Math.floor(source.backupTargetSlots || 0)),
    oreFocusEscalationDelay: Math.max(0, source.oreFocusEscalationDelay || 0),
    oreFocusEscalationBonus: Math.max(0, source.oreFocusEscalationBonus || 0),
    leastResistancePathing: Boolean(source.leastResistancePathing),
    mineLiftRecordDepthRatio: clamp(source.mineLiftRecordDepthRatio || 0, 0, 0.9),
    focusedOreHardnessReduction: clamp(source.focusedOreHardnessReduction || 0, 0, 0.8),
    discoveryTimeBonus: Math.max(0, source.discoveryTimeBonus || 0),
    directionalBombs: Boolean(source.directionalBombs),
    directionalBombConeTiles: Math.max(0, Math.floor(source.directionalBombConeTiles || 0)),
    crewBeaconUnlocked: Boolean(source.crewBeaconUnlocked),
    crewBeaconOverkillCarry: Math.max(0, source.crewBeaconOverkillCarry || 0),
    laserRicochetCount: clamp(Math.floor(source.laserRicochetCount || 0), 0, 2),
    laserFirstRicochetMultiplier: clamp(source.laserFirstRicochetMultiplier ?? 0.65, 0, 1),
    laserSecondRicochetMultiplier: clamp(source.laserSecondRicochetMultiplier ?? 0.45, 0, 1),
    oreDiversityBonusPerType: Math.max(0, source.oreDiversityBonusPerType || 0),
    deafKnockStoneThreshold: Math.max(0, Math.floor(source.deafKnockStoneThreshold || 0)),
    deafKnockSenseRadiusMultiplier: Math.max(1, source.deafKnockSenseRadiusMultiplier || 1),
    deafKnockMoveSpeedBonus: Math.max(0, source.deafKnockMoveSpeedBonus || 0),
    deafKnockMoveDuration: Math.max(0, source.deafKnockMoveDuration || 0),
    deafKnockCooldown: Math.max(0, source.deafKnockCooldown || 0),
    deafKnockFocusOnly: Boolean(source.deafKnockFocusOnly),
    triangularFixUnlocked: Boolean(source.triangularFixUnlocked),
    triangularFixOreMemory: Math.max(0, source.triangularFixOreMemory || 0),
    triangularFixDronePriority: Boolean(source.triangularFixDronePriority),
    triangularFixGadgetDamageBonus: Math.max(0, source.triangularFixGadgetDamageBonus || 0),
    triangularFixRangeBonus: Math.max(0, source.triangularFixRangeBonus || 0),
    laserSuperPickEchoEvery: Math.max(0, Math.floor(source.laserSuperPickEchoEvery || 0)),
    laserSuperPickEchoRadiusTiles: Math.max(0, source.laserSuperPickEchoRadiusTiles || 0),
    laserSuperPickEchoPower: clamp(source.laserSuperPickEchoPower || 0, 0, 1),
    laserSuperPickEchoNoProcs: Boolean(source.laserSuperPickEchoNoProcs),
    echoPingCooldown: Math.max(0, source.echoPingCooldown || 0),
    echoPingRadiusMultiplier: Math.max(1, source.echoPingRadiusMultiplier || 1),
    echoPingTargetHold: Math.max(0, source.echoPingTargetHold || 0),
    veinTrailRangeMultiplier: Math.max(1, source.veinTrailRangeMultiplier || 1),
    veinTrailMoveSpeedBonus: Math.max(0, source.veinTrailMoveSpeedBonus || 0),
    seismicRouteSlots: clamp(Math.floor(source.seismicRouteSlots || 0), 0, 6),
    ghostTrailDuration: Math.max(0, source.ghostTrailDuration || 0),
    ghostTrailThroughWalls: Boolean(source.ghostTrailThroughWalls || source.ghostTrailMaxLayers > 0),
    ghostTrailMaxLayers: Math.max(0, Math.floor(source.ghostTrailMaxLayers || 0)),
    veinLockEnabled: Boolean(source.veinLockEnabled),
    veinLockRangeMultiplier: Math.max(1, source.veinLockRangeMultiplier || 1),
    veinLockMoveSpeedBonus: Math.max(0, source.veinLockMoveSpeedBonus || 0),
    approachStrikeTravelTime: Math.max(0, source.approachStrikeTravelTime || 0),
    approachStrikePower: Math.max(0, source.approachStrikePower || 0),
    approachStrikeSideChip: Math.max(0, Number(source.approachStrikeSideChip ?? source.approachStrikeSideChipPower) || 0),
    focusVeinSizeBias: Math.max(0, source.focusVeinSizeBias || 0),
    focusMoveSpeedPerNode: Math.max(0, source.focusMoveSpeedPerNode ?? source.focusVeinMoveSpeedPerNode ?? 0),
    sideChipEvery: Math.max(0, Math.floor(source.sideChipEvery || 0)),
    sideChipHits: clamp(Math.floor(source.sideChipHits ?? source.sideChipTargets ?? 0), 0, 8),
    sideChipPower: Math.max(0, source.sideChipPower || 0),
    impactWaveEvery: Math.max(0, Math.floor(source.impactWaveEvery || 0)),
    impactWaveRadiusTiles: Math.max(0, source.impactWaveRadiusTiles || 0),
    impactWavePower: Math.max(0, source.impactWavePower || 0),
    quarryModeRequiredBreaks: Math.max(0, Math.floor(source.quarryModeRequiredBreaks || 0)),
    quarryModeWindow: Math.max(0, source.quarryModeWindow || 0),
    quarryModeDuration: Math.max(0, source.quarryModeDuration || 0),
    quarryModeMoveSpeedBonus: Math.max(0, source.quarryModeMoveSpeedBonus || 0),
    quarryModeDigSpeedBonus: Math.max(0, source.quarryModeDigSpeedBonus || 0),
    quarryModeSideFracturePower: Math.max(0, source.quarryModeSideFracturePower || 0),
    faultLineMaxBlocks: clamp(Math.floor(source.faultLineMaxBlocks || 0), 0, 12),
    faultLinePower: Math.max(0, source.faultLinePower || 0),
    faultLineExtendOnBreak: Boolean(source.faultLineExtendOnBreak),
    trueOverkillEnabled: Boolean(source.trueOverkillEnabled),
    overkillReservoirRatio: clamp(source.overkillReservoirRatio || 0, 0, 1),
    overkillReservoirYieldThreshold: Math.max(0, source.overkillReservoirYieldThreshold || 0),
    chronoOverdrive: Boolean(source.chronoOverdrive),
    chronoOverflowThreshold: clamp(source.chronoOverflowThreshold || DIRECT_MAX_RUN_SECONDS, DIRECT_MAX_RUN_SECONDS, BONUS_MAX_RUN_SECONDS),
    chronoOverflowSpeedBonus: Math.max(0, source.chronoOverflowSpeedBonus || 0),
    chronoOverflowProcEvery: Math.max(0, Math.floor(source.chronoOverflowProcEvery ?? source.chronoOverflowRepeatEvery ?? 0)),
    superFieldEnabled: Boolean(source.superFieldEnabled),
    superFieldRadiusTiles: Math.max(0, source.superFieldRadiusTiles || 0),
    superFieldPower: Math.max(0, source.superFieldPower || 0),
    superFieldDuration: Math.max(0, source.superFieldDuration || 0),
    superFieldLaserPersistent: Boolean(source.superFieldLaserPersistent),
    laserHeatEdgePower: Math.max(0, source.laserHeatEdgePower || 0),
    laserHeatDuration: Math.max(0, source.laserHeatDuration || 0),
    laserHeatNextHitBonus: Math.max(0, source.laserHeatNextHitBonus || 0),
    rareOreAdditiveChance: clamp(source.rareOreAdditiveChance || 0, 0, 0.95),
    goldenOreAdditiveChance: clamp(source.goldenOreAdditiveChance || 0, 0, 0.95),
    magneticFieldEnabled: Boolean(source.magneticFieldEnabled),
    magneticFieldDuration: Math.max(0, source.magneticFieldDuration || 0),
    magneticFieldRadiusTiles: Math.max(0, source.magneticFieldRadiusTiles || source.magneticFieldRadius || 0),
    magneticFieldTargetingBonus: Math.max(0, source.magneticFieldTargetingBonus || 0),
    relicEffectChance: clamp(source.relicEffectChance || 0, 0, 0.95),
    relicEffectDuration: Math.max(0, source.relicEffectDuration || 0),
    relicEffectPower: Math.max(0, source.relicEffectPower || 0),
    fortuneWheelEnabled: Boolean(source.fortuneWheelEnabled),
    fortunePityThreshold: Math.max(0, Math.floor(source.fortunePityThreshold || 0)),
    fortuneWheelCycleLength: Math.max(0, Math.floor(source.fortuneWheelCycleLength || 0)),
    richVeinWholeChance: clamp(source.richVeinWholeChance || 0, 0, 0.95),
    richVeinYieldBonus: Math.max(0, source.richVeinYieldBonus || 0),
    richVeinCompletionBonus: Math.max(0, source.richVeinCompletionBonus || 0),
    tripleSampleEvery: Math.max(0, Math.floor(source.tripleSampleEvery || 0)),
    tripleSampleBonusYield: Math.max(0, Math.floor(source.tripleSampleBonusYield || 0)),
    tripleSampleNextNodeDamage: clamp(source.tripleSampleNextNodeDamage || 0, 0, 1),
    depthContractStep: Math.max(0, source.depthContractStep || 0),
    depthContractBonusPerStack: Math.max(0, source.depthContractBonusPerStack || 0),
    depthContractMaxStacks: Math.max(0, Math.floor(source.depthContractMaxStacks || 0)),
    motherlodeGuaranteed: Boolean(source.motherlodeGuaranteed),
    motherlodeTriggerBreaks: Math.max(1, Math.floor(source.motherlodeTriggerBreaks || 8)),
    motherlodeYieldMultiplier: Math.max(1, source.motherlodeYieldMultiplier || 1),
    motherlodeCompletionCache: Math.max(0, Math.floor(source.motherlodeCompletionCache || 0)),
    motherlodeCompletionTimeBonus: Math.max(0, source.motherlodeCompletionTimeBonus || 0),
    demolitionComboEnabled: Boolean(source.demolitionComboEnabled),
    demolitionComboMarkDuration: Math.max(0.5, source.demolitionComboMarkDuration || 3),
    demolitionComboFinishPower: Math.max(0, source.demolitionComboFinishPower || 0),
    demolitionComboVeinRadiusTiles: Math.max(0, source.demolitionComboVeinRadiusTiles || 2),
    solarDrillEnabled: Boolean(source.solarDrillEnabled),
    solarDrillProcEvery: Math.max(0, Math.floor(source.solarDrillProcEvery || 0)),
    solarDrillBeamDuration: Math.max(0, source.solarDrillBeamDuration || source.solarDrillDuration || 0),
    solarDrillFinalBurstPower: Math.max(0, source.solarDrillFinalBurstPower || 0),
  };
}

function getCampaignProgress() {
  const purchasedLevels = countPurchasedLevels(save.levels);
  const completedCapstones = CAMPAIGN.capstones.filter((id) => (save.levels[id] || 0) >= 1).length;
  const finalInstalled = (save.levels[CAMPAIGN.finalUpgrade] || 0) >= 1;
  const capstoneFraction = completedCapstones / CAMPAIGN.capstones.length;
  const finalFraction = finalInstalled ? 1 : 0;
  const oreFraction = clamp(save.lifetimeChunks / CAMPAIGN.requiredLifetimeChunks, 0, 1);
  const discoveredOres = ORE_TYPES.filter((ore) => (save.lifetimeOres?.[ore.id] || 0) > 0).length;
  const discoveryFraction = discoveredOres / Math.max(1, ORE_TYPES.length);
  const unlockedTools = CAMPAIGN_PROGRESS_TOOLS.filter((id) => (save.levels[id] || 0) >= 1).length;
  const toolFraction = unlockedTools / CAMPAIGN_PROGRESS_TOOLS.length;
  const totalLevels = UPGRADE_DEFS.reduce((sum, definition) => sum + definition.maxLevel, 0);
  // A focused route reaches the finale without buying every numeric level.
  // This target therefore measures meaningful breadth, not 100% completion.
  const levelGoal = Math.min(totalLevels, 170);
  const levelFraction = clamp(purchasedLevels / Math.max(1, levelGoal), 0, 1);
  const ready = Boolean(save.campaignComplete) || (
    finalInstalled
    && completedCapstones === CAMPAIGN.capstones.length
    && save.lifetimeChunks >= CAMPAIGN.requiredLifetimeChunks
  );

  return {
    ready,
    percent: ready ? 100 : Math.min(99, Math.floor((
      oreFraction * 0.18
      + levelFraction * 0.22
      + discoveryFraction * 0.15
      + toolFraction * 0.15
      + capstoneFraction * 0.25
      + finalFraction * 0.05
    ) * 100)),
    finalInstalled,
    completedCapstones,
    totalCapstones: CAMPAIGN.capstones.length,
    purchasedLevels,
    levelGoal,
    discoveredOres,
    totalOres: ORE_TYPES.length,
    unlockedTools,
    totalTools: CAMPAIGN_PROGRESS_TOOLS.length,
    lifetimeChunks: save.lifetimeChunks,
    requiredLifetimeChunks: CAMPAIGN.requiredLifetimeChunks,
  };
}

const oreById = new Map(ORE_TYPES.map((ore) => [ore.id, ore]));
const upgradeById = new Map(UPGRADE_DEFS.map((definition) => [definition.id, definition]));
const UPGRADE_LANES = Object.freeze(['time', 'dig', 'tools', 'power', 'fortune', 'gadgets', 'sense']);
const UPGRADE_NODE_WIDTH = 62;
const UPGRADE_NODE_HEIGHT = 62;
const UPGRADE_NODE_GAP = 14;
const UPGRADE_RING_START = 170;
const UPGRADE_RING_STEP = 118;
const UPGRADE_MAP_PADDING = 270;
const LASER_CORE_WIDTH = 8;
let upgradeLayoutCache = null;

const BREAK_SOURCE_LABELS = Object.freeze({
  pick: 'Кирка',
  laser: 'Лазер',
  'laser-heat': 'Термический след',
  multi: 'Дополнительные удары',
  bomb: 'Бомбы',
  chain: 'Разряды',
  drone: 'Дроны',
  echo: 'Эхо суперкирки',
  event: 'Микрособытия',
  shatter: 'Осколочный урон',
  shock: 'Шок-волны',
  beacon: 'Маяк артели',
  clearance: 'Расчистка прохода',
  'side-chip': 'Боковой скол',
  'approach-chip': 'Удар сближения',
  'impact-wave': 'Ударная волна',
  'quarry-fracture': 'Карьерный темп',
  'fault-line': 'Линия разлома',
  'chrono-overdrive': 'Хронофорсаж',
  fortune: 'Колесо фортуны',
  orchestra: 'Оркестр подрывников',
  solar: 'Солнечный бур',
  super_field: 'Поле инструмента',
  debug: 'Отладочное разрушение',
});
const DIRECT_TOOL_BREAK_SOURCES = new Set(['pick', 'laser', 'multi', 'clearance']);
const SECONDARY_NO_PROC_SOURCES = new Set([
  'side-chip',
  'approach-chip',
  'impact-wave',
  'quarry-fracture',
  'fault-line',
  'chrono-overdrive',
  'fortune',
  'orchestra',
  'solar',
  'super_field',
  'laser-heat',
  'triple-sample',
]);
const TOOL_NAMES = Object.freeze({
  pickaxe: 'КИРКА',
  ironPick: 'ЖЕЛЕЗНАЯ КИРКА',
  steelPick: 'СТАЛЬНАЯ КИРКА',
  pneumaticPick: 'ПНЕВМОКИРКА',
  superPick: 'СУПЕРКИРКА',
  miningLaser: 'ЛАЗЕР',
  prismaticLaser: 'ПРИЗМОЛАЗЕР',
});

function breakSourceLabel(source) {
  return BREAK_SOURCE_LABELS[source] || String(source || 'Неизвестно');
}

function createRunMetrics() {
  return {
    backupPromotions: 0,
    focusEscalations: 0,
    pathDetours: 0,
    liftStarts: 0,
    focusedCalibrationHits: 0,
    discoveryBonuses: 0,
    directionalBlasts: 0,
    crewRelays: 0,
    laserRicochets: 0,
    catalogBonusPieces: 0,
    movementSeconds: 0,
    miningSeconds: 0,
    searchingSeconds: 0,
    attacks: 0,
    targetSwitches: 0,
    sourceBreaks: {},
    maxBlockHp: 0,
    maxBlockKind: '',
    deafKnocks: 0,
    superPickEchoes: 0,
    triangleBuffHits: 0,
    microEvents: {},
    eventCount: 0,
    magneticFields: 0,
    relicEffects: 0,
    fortuneWheelProcs: 0,
    richVeins: 0,
    motherlodes: 0,
    demolitionCombos: 0,
    solarDrillBursts: 0,
    laserHeatStrikes: 0,
  };
}

const ui = {
  startScreen: $('#startScreen'),
  startRun: $('#startRun'),
  runHud: $('#runHud'),
  timerValue: $('#timerValue'),
  timerFill: $('#timerFill'),
  runOre: $('#runOre'),
  runOreBreakdown: $('#runOreBreakdown'),
  depthValue: $('#depthValue'),
  toolValue: $('#toolValue'),
  comboValue: $('#comboValue'),
  fieldGuide: $('#fieldGuide'),
  guideToggle: $('#guideToggle'),
  guideBody: $('#guideBody'),
  resultScreen: $('#resultScreen'),
  resultTitle: $('#resultTitle'),
  resultStats: $('#resultStats'),
  resultOreBadge: $('#resultOreBadge'),
  resultOreBreakdown: $('#resultOreBreakdown'),
  bankedOre: $('#bankedOre'),
  openUpgrades: $('#openUpgrades'),
  retryRun: $('#retryRun'),
  upgradeScreen: $('#upgradeScreen'),
  upgradeGrid: $('#upgradeGrid'),
  upgradeViewport: $('#upgradeMapViewport'),
  upgradeWorld: $('#upgradeMapWorld'),
  upgradeLanes: $('#upgradeMapLanes'),
  upgradeEdges: $('#upgradeMapLinks'),
  upgradeNodes: $('#upgradeNodes'),
  upgradeLive: $('#upgradeMapStatus'),
  upgradeSearch: $('#upgradeSearch'),
  nextBreakthrough: $('#nextBreakthrough'),
  nextBreakthroughName: $('#nextBreakthroughName'),
  nextBreakthroughNeed: $('#nextBreakthroughNeed'),
  pinSelectedUpgrade: $('#pinSelectedUpgrade'),
  buyMaxSelectedUpgrade: $('#buyMaxSelectedUpgrade'),
  oreInventory: $('#oreInventory'),
  oreFocusPanel: $('#oreFocusPanel'),
  oreFocusChoices: $('#oreFocusChoices'),
  focusHud: $('#focusHud'),
  focusHudName: $('#focusHudName'),
  upgradeProgress: $('#upgradeProgress'),
  closeUpgrades: $('#closeUpgrades'),
  wipeSave: $('#wipeSave'),
  campaignStatus: $('#campaignStatus'),
  launchRocket: $('#launchRocket'),
  launchLabel: $('#launchLabel'),
  endingScreen: $('#endingScreen'),
  endingProgress: $('#endingProgress'),
  endingReplay: $('#endingReplay'),
  endingContinue: $('#endingContinue'),
  toast: $('#toast'),
  screenFlash: $('#screenFlash'),
  tutorialCoach: $('#tutorialCoach'),
  tutorialTitle: $('#tutorialTitle'),
  tutorialText: $('#tutorialText'),
  tutorialHint: $('#tutorialHint'),
  tutorialClose: $('#tutorialClose'),
  tutorialNext: $('#tutorialNext'),
  replayTutorial: $('#replayTutorial'),
  reportHighlights: $('#reportHighlights'),
  reportDetails: $('#reportDetails'),
  reportPanel: $('#reportPanel'),
  reportGrade: $('.diagnosis-grade'),
  journalScreen: $('#journalScreen'),
  journalGrid: $('#journalGrid'),
  journalDiscoveryCount: $('#journalDiscoveryCount'),
  openJournal: $('#openJournal'),
  closeJournal: $('#closeJournal'),
  balanceScreen: $('#balanceScreen'),
  openBalance: $('#openBalance'),
  balanceSeed: $('#balanceSeed'),
  balanceProfile: $('#balanceProfile'),
  balanceRuns: $('#balanceRuns'),
  runBalance: $('#runBalance'),
  exportBalance: $('#exportBalance'),
  balanceResults: $('#balanceResults'),
  closeBalance: $('#closeBalance'),
  microEventBanner: $('#microEventBanner'),
  microEventTitle: $('#microEventTitle'),
  microEventTimer: $('#microEventTimer'),
  perkStatusRail: $('#perkStatusRail'),
  utilityNav: $('#utilityNav'),
};

const state = {
  mode: 'title',
  returnMode: 'title',
  world: null,
  player: null,
  spawn: null,
  depthOrigin: null,
  liftDepth: 0,
  target: null,
  backupTarget: null,
  pathWaypoint: null,
  seed: Date.now() & 0x7fffffff,
  timeLeft: 0,
  elapsed: 0,
  runOre: 0,
  oreCounts: createOreBag(),
  yieldRemainders: {},
  blocksBroken: 0,
  deepest: 0,
  combo: 0,
  comboExpires: 0,
  attackCooldown: 0,
  manualPulseCooldown: 0,
  stuckElapsed: 0,
  targetCooldown: 0,
  pathCooldown: 0,
  droneCooldown: 0,
  ping: 0,
  shake: 0,
  camera: { x: 0, y: 0 },
  viewport: { width: innerWidth, height: innerHeight, dpr: 1 },
  particles: [],
  floaters: [],
  beams: [],
  lastFrame: performance.now(),
  upgradeFilter: 'all',
  upgradeQuery: '',
  selectedUpgradeId: null,
  visibleUpgradeIds: new Set(),
  availableUpgradeIds: new Set(),
  workshopEligibilityRun: -1,
  workshopEligibleIds: new Set(),
  workshopInstallRun: -1,
  workshopInstalledIds: new Set(),
  paused: false,
  lastChanceUsed: 0,
  lastHaul: createOreBag(),
  lastHaulCount: 0,
  attackCount: 0,
  hitStreak: 0,
  lastTargetKey: '',
  runStartedAt: 0,
  pauseStartedAt: 0,
  activeWallElapsed: 0,
  lastBigToast: -99,
  shocks: [],
  focusMissElapsed: 0,
  discoveredOreIds: new Set(),
  bonusTimeEarned: 0,
  crewBeacon: null,
  focusEscalationActive: false,
  metrics: createRunMetrics(),
  currentSector: null,
  dryRockBlocks: 0,
  deafKnockCooldown: 0,
  deafKnockBoostRemaining: 0,
  laserShotCount: 0,
  triangleOreMemory: new Map(),
  triangleRefreshCooldown: 0,
  echoPingCooldownRemaining: 0,
  rememberedVeins: [],
  ghostTarget: null,
  lockedVeinId: null,
  lockedVeinOreId: null,
  veinRemainingCounts: new Map(),
  lastBrokenVeinId: null,
  veinBreakStreak: 0,
  approachTravelElapsed: 0,
  approachTargetKey: '',
  impactWaveProgress: 0,
  quarryVeinId: null,
  quarryBreakStreak: 0,
  quarryStreakExpires: 0,
  quarryModeRemaining: 0,
  quarryModeActive: false,
  overkillReservoir: 0,
  overkillReservoirVeinId: null,
  overkillYieldTargetKey: null,
  overkillYieldReady: false,
  chronoOverflowRemaining: 0,
  chronoOverdriveHitCount: 0,
  lastMetricTargetKey: '',
  microEventCheckCooldown: 0,
  activeMicroEvent: null,
  eventYieldBoostRemaining: 0,
  eventMoveBoostRemaining: 0,
  eventDigBoostRemaining: 0,
  eventSoftRockRemaining: 0,
  eventBannerTimer: 0,
  magneticField: null,
  relicEffectIndex: 0,
  relicDigBoostRemaining: 0,
  relicYieldBoostRemaining: 0,
  relicGadgetBoostRemaining: 0,
  relicSecondBeamRemaining: 0,
  relicSoftRockRemaining: 0,
  relicChestBoostCharges: 0,
  fortunePityCounter: 0,
  fortuneWheelIndex: 0,
  veinRuntime: new Map(),
  motherlodeBreaks: 0,
  motherlodeTriggered: false,
  motherlodeVeinId: null,
  demolitionComboStage: 0,
  demolitionComboExpires: 0,
  demolitionComboCooldownRemaining: 0,
  demolitionComboVeinId: null,
  laserHeatMarks: new Map(),
  solarDrillBursts: [],
  superFields: [],
  tripleSampleVeins: new Map(),
  balanceReport: null,
  tutorialQueue: [],
  activeTutorialId: null,
  activeTutorial: null,
  pityEventArmed: false,
  stagedEventId: null,
  journalFilter: 'all',
  lastFocusedElement: null,
};

class SoundEngine {
  constructor() {
    this.context = null;
    this.enabled = save.sound !== false;
  }

  unlock() {
    if (!this.enabled) return;
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    if (!this.context) this.context = new AudioContext();
    if (this.context.state === 'suspended') this.context.resume();
  }

  tone(frequency, duration = 0.06, type = 'square', volume = 0.025, slide = 0) {
    if (!this.enabled) return;
    this.unlock();
    if (!this.context) return;
    const now = this.context.currentTime;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(Math.max(35, frequency), now);
    if (slide) oscillator.frequency.exponentialRampToValueAtTime(Math.max(35, frequency + slide), now + duration);
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    oscillator.connect(gain).connect(this.context.destination);
    oscillator.start(now);
    oscillator.stop(now + duration);
  }

  hit(critical = false) {
    this.tone(critical ? 180 : 105, critical ? 0.11 : 0.045, 'square', critical ? 0.05 : 0.018, critical ? 220 : -20);
  }

  ore(ore) {
    const index = Math.max(0, ORE_TYPES.findIndex((item) => item.id === ore.id));
    this.tone(260 + index * 48, 0.12, 'triangle', 0.035, 150);
  }

  boom() {
    this.tone(68, 0.24, 'sawtooth', 0.055, -24);
  }
}

const sound = new SoundEngine();

function getHighestUnlockedOreTier() {
  return ORE_TYPES.reduce((highest, ore) => {
    const found = (save.lifetimeOres?.[ore.id] || 0) > 0 || (save.inventory?.[ore.id] || 0) > 0;
    return found ? Math.max(highest, ore.tier || 0) : highest;
  }, 0);
}

function depthFromOrigin(x, y) {
  const origin = state.depthOrigin || state.spawn;
  if (!origin) return 0;
  const horizontalDepth = Math.abs(x - origin.x) / TILE_SIZE * 0.42;
  const verticalDepth = Math.max(0, y - origin.y) / TILE_SIZE;
  return horizontalDepth + verticalDepth;
}

function getBonusRunCap() {
  return clamp(stats.bonusRunDurationCap || BONUS_MAX_RUN_SECONDS, DIRECT_MAX_RUN_SECONDS, BONUS_MAX_RUN_SECONDS);
}

function addBonusTime(seconds, x, y, label = 'БОНУС') {
  const amount = Math.max(0, Number(seconds) || 0);
  if (amount <= 0 || state.mode !== 'run') return 0;
  const before = state.timeLeft;
  const absoluteCap = getBonusRunCap();
  const remainingWallTime = Math.max(0, absoluteCap - state.activeWallElapsed);
  const projectedEndBefore = Math.min(absoluteCap, state.activeWallElapsed + before);
  state.timeLeft = Math.min(remainingWallTime, state.timeLeft + amount);
  const granted = Math.max(0, state.timeLeft - before);
  if (granted <= 0) return 0;
  state.bonusTimeEarned += granted;
  if (stats.chronoOverdrive) {
    const overflowThreshold = stats.chronoOverflowThreshold || DIRECT_MAX_RUN_SECONDS;
    const projectedEndAfter = Math.min(absoluteCap, state.activeWallElapsed + state.timeLeft);
    const overflowAdded = Math.max(0, projectedEndAfter - overflowThreshold)
      - Math.max(0, projectedEndBefore - overflowThreshold);
    state.chronoOverflowRemaining += Math.max(0, overflowAdded);
  }
  if (label === 'ОТКРЫТИЕ') state.metrics.discoveryBonuses += 1;
  if (Number.isFinite(x) && Number.isFinite(y)) {
    state.floaters.push({
      x,
      y,
      text: `${label} +${granted.toFixed(2)}с`,
      color: '#74e4df',
      life: 0.95,
      maxLife: 0.95,
    });
  }
  return granted;
}

function tutorialModeAllowed(lesson, mode = state.mode) {
  return !lesson?.validModes?.length || lesson.validModes.includes(mode);
}

function activateTutorialLesson(lesson) {
  if (!lesson || !ui.tutorialCoach || !tutorialModeAllowed(lesson)) return false;
  state.activeTutorialId = lesson.id;
  state.activeTutorial = lesson;
  if (ui.tutorialTitle) ui.tutorialTitle.textContent = lesson.title;
  if (ui.tutorialText) ui.tutorialText.textContent = lesson.text;
  if (ui.tutorialHint) {
    ui.tutorialHint.textContent = lesson.hint;
    ui.tutorialHint.classList.toggle('hidden', !lesson.hint);
  }
  ui.tutorialCoach.dataset.lesson = lesson.id;
  ui.tutorialCoach.classList.remove('hidden');
  requestAnimationFrame(() => {
    if (state.activeTutorialId === lesson.id) ui.tutorialNext?.focus?.({ preventScroll: true });
  });
  return true;
}

function activateNextTutorial() {
  if (state.activeTutorialId || !state.tutorialQueue.length) return false;
  const index = state.tutorialQueue.findIndex((lesson) => tutorialModeAllowed(lesson));
  if (index < 0) return false;
  const [next] = state.tutorialQueue.splice(index, 1);
  return activateTutorialLesson(next);
}

function deactivateActiveTutorial(markSeen = false) {
  if (markSeen) markTutorialSeen(state.activeTutorialId);
  ui.tutorialCoach?.classList.add('hidden');
  state.activeTutorialId = null;
  state.activeTutorial = null;
}

function deferActiveTutorialForMode(nextMode) {
  const lesson = state.activeTutorial;
  if (!lesson || tutorialModeAllowed(lesson, nextMode)) return false;
  deactivateActiveTutorial(false);
  if (!save.tutorialSeen?.[lesson.id] && !state.tutorialQueue.some((queued) => queued.id === lesson.id)) {
    state.tutorialQueue.unshift(lesson);
  }
  return true;
}

function showTutorial(id, title, text, hint = '', options = {}) {
  if (!id || save.tutorialSeen?.[id]) return false;
  if (state.activeTutorialId === id || state.tutorialQueue.some((lesson) => lesson.id === id)) return false;
  if (!ui.tutorialCoach) return false;
  const fallbackModes = state.mode === 'run' ? ['result', 'title'] : [state.mode];
  const lesson = {
    id,
    title,
    text,
    hint,
    validModes: Array.isArray(options.validModes) ? [...options.validModes] : fallbackModes,
  };
  // A tutorial must never steal seconds from an active shift. Context earned
  // underground is delivered on the result/title screen instead.
  if (state.mode === 'run' || state.activeTutorialId || !tutorialModeAllowed(lesson)) {
    state.tutorialQueue.push(lesson);
    return true;
  }
  return activateTutorialLesson(lesson);
}

function markTutorialSeen(id) {
  if (!id) return;
  save.tutorialSeen = { ...(save.tutorialSeen || {}), [id]: true };
}

function dismissTutorial(skipQueued = false) {
  markTutorialSeen(state.activeTutorialId);
  if (skipQueued) {
    const deferred = [];
    for (const lesson of state.tutorialQueue) {
      if (tutorialModeAllowed(lesson)) markTutorialSeen(lesson.id);
      else deferred.push(lesson);
    }
    state.tutorialQueue = deferred;
  }
  persistSave();
  deactivateActiveTutorial(false);
  activateNextTutorial();
}

const ONBOARDING_LESSONS = Object.freeze([
  Object.freeze({
    id: 'onboarding_v2_shift',
    title: 'КОРОТКАЯ СМЕНА',
    text: 'Шахтёр работает сам: чует руду, прокладывает к ней ход и добывает груз. Первая смена длится 6 секунд — это нормально, между сменами ты усиливаешь постоянное оборудование.',
    hint: 'Нажми «НАЧАТЬ ЗАБЕГ» и наблюдай: форма и состав пластов определятся автоматически.',
  }),
  Object.freeze({
    id: 'onboarding_v2_cargo',
    title: 'ГРУЗ И РУДА',
    text: 'Вверху во время смены видно, какие именно руды уже лежат в грузе. После смены весь состав показан цветными значками и переносится в постоянный запас.',
    hint: 'Разные улучшения требуют конкретные виды руды, а не одну общую валюту.',
  }),
  Object.freeze({
    id: 'onboarding_v2_tree',
    title: 'ЕДИНОЕ ДЕРЕВО',
    text: 'Все постоянные улучшения растут из одной центральной точки. Наведи на иконку, чтобы увидеть эффект, требования и цену; дальние узлы открываются постепенно.',
    hint: 'Кнопка «КАК ИГРАТЬ» на стартовом экране повторяет это обучение.',
  }),
]);

function fieldGuideShouldStartCollapsed() {
  const onboardingComplete = ONBOARDING_LESSONS.every((lesson) => save.tutorialSeen?.[lesson.id]);
  const completedRuns = Math.max(0, Math.floor(Number(save.runs) || 0));
  return completedRuns >= 2 || onboardingComplete;
}

function setFieldGuideCollapsed(collapsed = false) {
  const nextCollapsed = Boolean(collapsed);
  if (!ui.fieldGuide || !ui.guideToggle) return nextCollapsed;
  ui.fieldGuide.classList.toggle('is-collapsed', nextCollapsed);
  ui.guideToggle.setAttribute('aria-expanded', String(!nextCollapsed));
  ui.guideToggle.title = nextCollapsed ? 'Открыть памятку' : 'Свернуть памятку';
  ui.guideBody?.setAttribute('aria-hidden', String(nextCollapsed));
  return nextCollapsed;
}

function showFieldGuideForRun() {
  ui.fieldGuide?.classList.remove('hidden');
  setFieldGuideCollapsed(fieldGuideShouldStartCollapsed());
}

function startOnboarding(force = false) {
  const onboardingIds = new Set(ONBOARDING_LESSONS.map((lesson) => lesson.id));
  const preserved = state.tutorialQueue.filter((lesson) => !onboardingIds.has(lesson.id));
  if (state.activeTutorial && !onboardingIds.has(state.activeTutorial.id)) preserved.unshift(state.activeTutorial);
  clearTutorialCoach(false, true);
  state.tutorialQueue = preserved;
  if (force) {
    for (const lesson of ONBOARDING_LESSONS) delete save.tutorialSeen[lesson.id];
    persistSave();
  }
  for (const lesson of ONBOARDING_LESSONS) {
    showTutorial(lesson.id, lesson.title, lesson.text, lesson.hint);
  }
}

function clearTutorialCoach(markActive = false, clearQueue = true) {
  if (markActive) markTutorialSeen(state.activeTutorialId);
  deactivateActiveTutorial(false);
  if (clearQueue) state.tutorialQueue.length = 0;
  if (markActive) persistSave();
}

function trapOverlayFocus(event) {
  if (event.key !== 'Tab') return false;
  const modal = ({
    journal: ui.journalScreen,
    balance: ui.balanceScreen,
    upgrades: ui.upgradeScreen,
    result: ui.resultScreen,
    ending: ui.endingScreen,
  })[state.mode];
  const tutorialVisible = Boolean(state.activeTutorialId && ui.tutorialCoach && !ui.tutorialCoach.classList.contains('hidden'));
  const focusScope = tutorialVisible ? ui.tutorialCoach : modal;
  if (!focusScope || focusScope.classList.contains('hidden')) return false;
  const focusable = [...focusScope.querySelectorAll('button, summary, [href], input, select, textarea, [tabindex]')]
    .filter((element) => (
      !element.disabled
      && element.getAttribute('aria-hidden') !== 'true'
      && element.tabIndex !== -1
      && !element.closest('.hidden')
      && (typeof element.getClientRects !== 'function' || element.getClientRects().length > 0)
    ));
  if (!focusable.length) return false;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (!focusScope.contains(document.activeElement)) {
    event.preventDefault();
    (event.shiftKey ? last : first).focus();
    return true;
  }
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
    return true;
  }
  if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
    return true;
  }
  return false;
}

function getRunSeed() {
  return (Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0;
}

function requestRunStart() {
  const seed = getRunSeed();
  startRun({ seed });
}

const EVENT_PITY_TYPES = Object.freeze([
  'ancient_container',
  'gas_pocket',
  'fragile_cavity',
  'rich_lens',
  'underground_flow',
]);

function getEventPityThreshold() {
  return 4 + ((save.totalEvents || 0) * 7 + 1) % 3;
}

function stageCampaignPityEvent() {
  if (!state.world || typeof state.world.stageMicroEventNearSpawn !== 'function') return null;
  if (save.runs < 4 || (save.runsSinceEvent || 0) < getEventPityThreshold()) return null;
  const preferredType = EVENT_PITY_TYPES[(save.totalEvents || 0) % EVENT_PITY_TYPES.length];
  return state.world.stageMicroEventNearSpawn(preferredType, state.spawn);
}

function newWorld(seed = (Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0, options = {}) {
  resetTerrainBaseCache();
  state.seed = seed;
  const worldOptions = options.sectorId ? { sectorId: options.sectorId } : {};
  state.world = new MineWorld(ORE_TYPES, seed, worldOptions);
  state.currentSector = typeof state.world.getSectorInfo === 'function'
    ? state.world.getSectorInfo()
    : null;
  const baseSpawn = state.world.getSpawn();
  state.depthOrigin = {
    ...baseSpawn,
    x: baseSpawn.x ?? (baseSpawn.tx + 0.5) * TILE_SIZE,
    y: baseSpawn.y ?? (baseSpawn.ty + 0.5) * TILE_SIZE,
  };
  let spawn = baseSpawn;
  if (
    options.useLift
    && (stats.mineLiftRecordDepthRatio || 0) > 0
    && save.bestDepth > 0
    && typeof state.world.getLiftStart === 'function'
  ) {
    spawn = state.world.getLiftStart(
      save.bestDepth,
      stats.mineLiftRecordDepthRatio,
      save.bestDepth,
      { unlockedTierCap: getHighestUnlockedOreTier() },
    ) || baseSpawn;
  }
  state.spawn = {
    ...spawn,
    x: spawn.x ?? (spawn.tx + 0.5) * TILE_SIZE,
    y: spawn.y ?? (spawn.ty + 0.5) * TILE_SIZE,
  };
  state.liftDepth = Number.isFinite(Number(spawn.depth))
    ? Math.max(0, Number(spawn.depth))
    : depthFromOrigin(state.spawn.x, state.spawn.y);
  state.player = {
    x: state.spawn.x,
    y: state.spawn.y,
    vx: 0,
    vy: 0,
    facing: 1,
    angle: 0.35,
    swing: 0,
    moving: 0,
  };
  state.camera.x = state.player.x - state.viewport.width * 0.5;
  state.camera.y = state.player.y - state.viewport.height * 0.52;
}

function startRun(options = {}) {
  const runOptions = options && typeof options === 'object' && !('currentTarget' in options)
    ? options
    : {};
  // Defensive path for programmatic starts and a click racing the onboarding
  // animation frame: no modal is allowed to remain over a ticking shift.
  if (state.activeTutorialId) dismissTutorial(true);
  sound.unlock();
  stats = normalizeStats(calculateMetaStats(save.levels));
  newWorld(runOptions.seed ?? getRunSeed(), {
    useLift: true,
    sectorId: runOptions.sectorId || null,
  });
  const stagedPityEvent = stageCampaignPityEvent();
  persistSave();
  Object.assign(state, {
    mode: 'run',
    target: null,
    backupTarget: null,
    pathWaypoint: null,
    timeLeft: stats.runDuration,
    elapsed: 0,
    runOre: 0,
    oreCounts: createOreBag(),
    yieldRemainders: {},
    blocksBroken: 0,
    deepest: state.liftDepth,
    combo: 0,
    comboExpires: 0,
    attackCooldown: 0,
    manualPulseCooldown: 0,
    stuckElapsed: 0,
    targetCooldown: 0,
    pathCooldown: 0,
    droneCooldown: 0,
    ping: 1,
    paused: false,
    lastChanceUsed: 0,
    attackCount: 0,
    hitStreak: 0,
    lastTargetKey: '',
    runStartedAt: performance.now(),
    pauseStartedAt: 0,
    activeWallElapsed: 0,
    lastBigToast: -99,
    focusMissElapsed: 0,
    discoveredOreIds: new Set(),
    bonusTimeEarned: 0,
    crewBeacon: null,
    focusEscalationActive: false,
    metrics: createRunMetrics(),
    dryRockBlocks: 0,
    deafKnockCooldown: 0,
    deafKnockBoostRemaining: 0,
    laserShotCount: 0,
    triangleOreMemory: new Map(),
    triangleRefreshCooldown: 0,
    echoPingCooldownRemaining: 0,
    rememberedVeins: [],
    ghostTarget: null,
    lockedVeinId: null,
    lockedVeinOreId: null,
    veinRemainingCounts: collectVeinRemainingCounts(),
    lastBrokenVeinId: null,
    veinBreakStreak: 0,
    approachTravelElapsed: 0,
    approachTargetKey: '',
    impactWaveProgress: 0,
    quarryVeinId: null,
    quarryBreakStreak: 0,
    quarryStreakExpires: 0,
    quarryModeRemaining: 0,
    quarryModeActive: false,
    overkillReservoir: 0,
    overkillReservoirVeinId: null,
    overkillYieldTargetKey: null,
    overkillYieldReady: false,
    chronoOverflowRemaining: 0,
    chronoOverdriveHitCount: 0,
    lastMetricTargetKey: '',
    microEventCheckCooldown: 0,
    activeMicroEvent: null,
    eventYieldBoostRemaining: 0,
    eventMoveBoostRemaining: 0,
    eventDigBoostRemaining: 0,
    eventSoftRockRemaining: 0,
    eventBannerTimer: 0,
    magneticField: null,
    relicEffectIndex: 0,
    relicDigBoostRemaining: 0,
    relicYieldBoostRemaining: 0,
    relicGadgetBoostRemaining: 0,
    relicSecondBeamRemaining: 0,
    relicSoftRockRemaining: 0,
    relicChestBoostCharges: 0,
    fortunePityCounter: 0,
    fortuneWheelIndex: 0,
    veinRuntime: new Map(),
    motherlodeBreaks: 0,
    motherlodeTriggered: false,
    motherlodeVeinId: null,
    demolitionComboStage: 0,
    demolitionComboExpires: 0,
    demolitionComboCooldownRemaining: 0,
    demolitionComboVeinId: null,
    laserHeatMarks: new Map(),
    solarDrillBursts: [],
    superFields: [],
    tripleSampleVeins: new Map(),
    pityEventArmed: Boolean(stagedPityEvent),
    stagedEventId: stagedPityEvent?.id || null,
  });
  if (state.liftDepth > 1) state.metrics.liftStarts = 1;
  state.particles.length = 0;
  state.floaters.length = 0;
  state.beams.length = 0;
  state.shocks.length = 0;
  hideAllScreens();
  updateUtilityNavState();
  ui.runHud?.classList.remove('hidden');
  showFieldGuideForRun();
  updateHud();
  toast(
    stagedPityEvent
      ? 'ЧУТЬЁ ПОЙМАЛО АНОМАЛЬНЫЙ СИГНАЛ'
      : state.liftDepth > 1
        ? `ЛИФТ: СТАРТ С ${Math.floor(state.liftDepth)} М`
        : 'ЧУТЬЁ АКТИВНО — ИЩЕМ ЖИЛУ',
    stagedPityEvent ? 'warning' : 'info',
  );
  sound.tone(145, 0.16, 'triangle', 0.04, 180);
}

function applyCatalogBonus(sourceHaul) {
  const haul = sanitizeOreBag(sourceHaul);
  const distinctTypes = state.discoveredOreIds?.size || 0;
  const multiplier = 1 + Math.max(0, distinctTypes - 1) * (stats.oreDiversityBonusPerType || 0);
  const rawCount = countOreBag(haul);
  const bonusCount = Math.max(0, Math.floor(rawCount * (multiplier - 1)));
  if (bonusCount <= 0 || rawCount <= 0) return { haul, rawCount, bonusCount: 0, multiplier, distinctTypes };

  const shares = ORE_TYPES
    .filter((ore) => haul[ore.id] > 0)
    .map((ore) => {
      const exact = bonusCount * haul[ore.id] / rawCount;
      const whole = Math.floor(exact);
      haul[ore.id] += whole;
      return { ore, fraction: exact - whole, whole };
    })
    .sort((left, right) => right.fraction - left.fraction || right.ore.tier - left.ore.tier);
  let distributed = shares.reduce((sum, share) => sum + share.whole, 0);
  for (let index = 0; distributed < bonusCount && shares.length; index = (index + 1) % shares.length) {
    haul[shares[index].ore.id] += 1;
    distributed += 1;
  }
  state.metrics.catalogBonusPieces += bonusCount;
  return { haul, rawCount, bonusCount, multiplier, distinctTypes };
}

function describeRunGeology(profile = state.currentSector) {
  if (!profile) return { label: 'Случайные пласты', detail: 'геология не определена' };
  if (!profile.hidden) return { label: profile.label || 'Стабильные пласты', detail: profile.description || '' };
  const biasedOre = profile.oreBias?.id ? oreById.get(profile.oreBias.id) : null;
  const descriptions = {
    cavernous: ['КАРСТОВЫЙ ПЛАСТ', 'Много естественных пустот'],
    compact: ['ПЛОТНЫЙ ПЛАСТ', 'Меньше пещер и больше сплошной породы'],
    ore_rich: ['РУДНЫЙ ПЛАСТ', 'Общая рудность этого участка повышена'],
    ore_bias: [
      `ПЕРЕКОС: ${(biasedOre?.name || 'НЕИЗВЕСТНАЯ РУДА').toUpperCase()}`,
      'Рудный бюджет смещён в пользу одного ресурса',
    ],
    mixed: ['СМЕШАННЫЕ ПЛАСТЫ', 'Без выраженной геологической крайности'],
  };
  const [label, detail] = descriptions[profile.trait] || descriptions.mixed;
  return { label, detail };
}

function expectedEfficiencyForProgress(profile = state.currentSector) {
  const purchased = countPurchasedLevels(save.levels);
  const toolOrder = ['pickaxe', 'ironPick', 'steelPick', 'pneumaticPick', 'superPick', 'miningLaser', 'prismaticLaser'];
  const toolStage = Math.max(0, toolOrder.indexOf(stats.tool));
  const abundance = clamp(Number(profile?.modifiers?.abundance) || 1, 0.75, 1.5);
  const caves = clamp(Number(profile?.modifiers?.caves) || 1, 0.65, 1.6);
  const topologyFactor = caves > 1.2 ? 1.06 : caves < 0.86 ? 0.94 : 1;
  return Math.max(0.25, (0.34 + purchased * 0.012 + toolStage * 0.18) * abundance * topologyFactor);
}

function buildRunReport(catalog, haul, activeRunSeconds) {
  const sourceEntries = Object.entries(state.metrics.sourceBreaks || {})
    .sort((left, right) => right[1] - left[1]);
  const previous = save.lastRunReport;
  const haulCount = countOreBag(haul);
  const duration = Math.max(0.01, activeRunSeconds || state.elapsed || 0.01);
  const movement = Math.min(duration, state.metrics.movementSeconds || 0);
  const mining = Math.min(duration, state.metrics.miningSeconds || 0);
  const searching = Math.min(duration, state.metrics.searchingSeconds || 0);
  const rarest = Object.entries(haul)
    .filter(([, amount]) => amount > 0)
    .sort(([a], [b]) => (oreById.get(b)?.tier || 0) - (oreById.get(a)?.tier || 0))[0];
  const geology = describeRunGeology();
  const efficiency = Number((haulCount / duration).toFixed(2));
  const expectedEfficiency = Number(expectedEfficiencyForProgress().toFixed(2));
  const previousEfficiency = Number(previous?.efficiency);
  const report = {
    seed: state.seed,
    run: save.runs + 1,
    sectorId: state.currentSector?.id || 'random_strata',
    sectorLabel: geology.label,
    geologyDetail: geology.detail,
    geologyTrait: state.currentSector?.trait || 'mixed',
    haul: haulCount,
    rawHaul: catalog.rawCount,
    catalogBonus: catalog.bonusCount,
    duration: Number(duration.toFixed(2)),
    depth: Math.floor(state.deepest),
    blocks: state.blocksBroken,
    oreTypes: state.discoveredOreIds?.size || 0,
    rarestOreId: rarest?.[0] || null,
    rarestAmount: rarest?.[1] || 0,
    efficiency,
    expectedEfficiency,
    efficiencyRatio: Number((efficiency / Math.max(0.01, expectedEfficiency)).toFixed(2)),
    movementSeconds: Number(movement.toFixed(2)),
    miningSeconds: Number(mining.toFixed(2)),
    searchingSeconds: Number(searching.toFixed(2)),
    bonusTime: Number(state.bonusTimeEarned.toFixed(2)),
    targetSwitches: state.metrics.targetSwitches || 0,
    eventCount: state.metrics.eventCount || 0,
    microEvents: { ...(state.metrics.microEvents || {}) },
    sourceBreaks: { ...(state.metrics.sourceBreaks || {}) },
    strongestSource: sourceEntries[0]?.[0] || '—',
    strongestSourceBlocks: sourceEntries[0]?.[1] || 0,
    maxBlockHp: Math.round(state.metrics.maxBlockHp || 0),
    maxBlockKind: state.metrics.maxBlockKind || '—',
    deafKnocks: state.metrics.deafKnocks || 0,
    superPickEchoes: state.metrics.superPickEchoes || 0,
    triangleBuffHits: state.metrics.triangleBuffHits || 0,
    deltaHaul: previous ? haulCount - (previous.haul || 0) : null,
    deltaEfficiency: Number.isFinite(previousEfficiency)
      ? Number((efficiency - previousEfficiency).toFixed(2))
      : null,
    deltaDepth: previous ? Math.floor(state.deepest) - (previous.depth || 0) : null,
  };
  return report;
}

function getRunTimeSink(report) {
  const entries = [
    ['поиск', report.searchingSeconds || 0, ['sense', 'tools']],
    ['движение', report.movementSeconds || 0, ['dig', 'tools', 'sense']],
    ['разрушение породы', report.miningSeconds || 0, ['power', 'dig', 'gadgets', 'tools']],
  ].sort((left, right) => right[1] - left[1]);
  const [label, seconds, categories] = entries[0];
  return {
    label,
    seconds,
    share: clamp(seconds / Math.max(0.01, report.duration || 0.01), 0, 1),
    categories,
  };
}

function getReportUpgradeRecommendation(report) {
  const sink = getRunTimeSink(report);
  const candidates = getVisibleUpgradeDefinitions()
    .filter((definition) => getUpgradeLevel(definition) < definition.maxLevel)
    .filter(requirementsMet)
    .map((definition) => {
      const level = getUpgradeLevel(definition);
      const recipe = getUpgradeRecipe(definition, level);
      const categoryRank = sink.categories.indexOf(definition.category);
      const missing = Object.entries(recipe)
        .filter(([oreId, amount]) => (save.inventory[oreId] || 0) < amount)
        .map(([oreId, amount]) => `${oreById.get(oreId)?.name || oreId} ×${amount - (save.inventory[oreId] || 0)}`);
      return {
        definition,
        recipe,
        missing,
        score: (categoryRank < 0 ? 80 : categoryRank * 10)
          + (missing.length ? 14 : 0)
          + (definition.maxLevel === 1 ? -3 : 0),
      };
    })
    .sort((left, right) => left.score - right.score || UPGRADE_DEFS.indexOf(left.definition) - UPGRADE_DEFS.indexOf(right.definition));
  const choice = candidates[0] || null;
  return {
    sink,
    choice,
    text: choice
      ? choice.missing.length
        ? `До «${choice.definition.name}» не хватает: ${choice.missing.join(' · ')}.`
        : `«${choice.definition.name}» уже можно установить в мастерской.`
      : 'Доступные узлы этого направления уже установлены — продолжайте открывать дерево.',
  };
}

function renderRunReport(report) {
  if (!report) return;
  ui.reportPanel?.classList.remove('hidden');
  const rare = report.rarestOreId ? oreById.get(report.rarestOreId) : null;
  const advice = getReportUpgradeRecommendation(report);
  const deltaLabel = (value, suffix = '') => value == null
    ? 'первый замер'
    : `${value >= 0 ? '+' : ''}${value}${suffix} к прошлой смене`;
  if (ui.reportHighlights) {
    ui.reportHighlights.innerHTML = `
      <article class="diagnosis-highlight is-positive"><span aria-hidden="true">↗</span><div><small>ЭФФЕКТИВНОСТЬ</small><strong>${report.efficiency.toFixed(1)} куск./с</strong><p>${deltaLabel(report.deltaEfficiency, ' куск./с')}</p></div></article>
      <article class="diagnosis-highlight is-warning"><span aria-hidden="true">⌛</span><div><small>ГЛУБИНА</small><strong>${report.depth} м</strong><p>${deltaLabel(report.deltaDepth, ' м')}</p></div></article>
      <article class="diagnosis-highlight is-neutral"><span aria-hidden="true">◇</span><div><small>ГЛАВНАЯ НАХОДКА</small><strong>${rare ? `${rare.name} ×${report.rarestAmount}` : 'нет руды'}</strong><p>${report.sectorLabel}${report.geologyDetail ? ` · ${report.geologyDetail}` : ''}</p></div></article>`;
  }
  if (ui.reportGrade) {
    const ratio = report.efficiencyRatio || report.efficiency / Math.max(0.01, report.expectedEfficiency || 1);
    ui.reportGrade.textContent = ratio >= 1.45
      ? 'A+'
      : ratio >= 1.05
        ? 'A'
        : ratio >= 0.75
          ? 'B'
          : ratio >= 0.5 && report.haul > 0 ? 'C' : 'D';
    ui.reportGrade.title = `Оценка относительно текущего оборудования и геологии: ${(ratio * 100).toFixed(0)}% от ориентира`;
  }
  if (ui.reportDetails) {
    const sourceText = Object.entries(report.sourceBreaks)
      .sort((left, right) => right[1] - left[1])
      .map(([source, amount]) => `${escapeHtml(breakSourceLabel(source))}: ${amount}`)
      .join(' · ') || 'нет разрушений';
    const share = (seconds) => `${clamp(seconds / Math.max(0.01, report.duration) * 100, 0, 100).toFixed(0)}%`;
    ui.reportDetails.innerHTML = `
      <summary>ПОДРОБНЫЕ ДАННЫЕ <span aria-hidden="true">⌄</span></summary>
      <div class="diagnosis-details__body">
        <div class="diagnosis-advice"><span aria-hidden="true">◎</span><div><small>СЛЕДУЮЩИЙ ШАГ · ГЛАВНАЯ ПОТЕРЯ: ${advice.sink.label.toUpperCase()} ${Math.round(advice.sink.share * 100)}%</small><strong>${escapeHtml(advice.text)}</strong><p>Закрепите нужный узел в мастерской — панель покажет недостающую руду после каждой смены.</p></div></div>
        <div class="diagnosis-timeline" aria-label="Распределение времени смены">
          <span><small>КОПКА</small><i style="--share:${share(report.miningSeconds)}"></i><b>${share(report.miningSeconds)}</b></span>
          <span><small>ДВИЖЕНИЕ</small><i style="--share:${share(report.movementSeconds)}"></i><b>${share(report.movementSeconds)}</b></span>
          <span><small>ПОИСК</small><i style="--share:${share(report.searchingSeconds)}"></i><b>${share(report.searchingSeconds)}</b></span>
        </div>
        <dl class="diagnosis-metrics">
        <div><dt>В движении</dt><dd>${report.movementSeconds.toFixed(1)} с</dd></div>
        <div><dt>За работой</dt><dd>${report.miningSeconds.toFixed(1)} с</dd></div>
        <div><dt>Без цели</dt><dd>${report.searchingSeconds.toFixed(1)} с</dd></div>
        <div><dt>Бонусное время</dt><dd>+${report.bonusTime.toFixed(1)} с</dd></div>
        <div><dt>Смен цели</dt><dd>${report.targetSwitches}</dd></div>
        <div><dt>Микрособытия</dt><dd>${report.eventCount}</dd></div>
        <div><dt>Глухой стук</dt><dd>${report.deafKnocks}</dd></div>
        <div><dt>Эхо суперкирки</dt><dd>${report.superPickEchoes}</dd></div>
        <div><dt>Усиления триангуляции</dt><dd>${report.triangleBuffHits}</dd></div>
        <div><dt>Плотнейший блок</dt><dd>${report.maxBlockHp} · ${report.maxBlockKind}</dd></div>
          <div><dt>Разрушения</dt><dd>${sourceText}</dd></div>
        </dl>
      </div>`;
  }
}

function finishRun() {
  if (state.mode !== 'run') return;
  state.mode = 'result';
  updateUtilityNavState();
  ui.runHud?.classList.add('hidden');
  ui.microEventBanner?.classList.add('hidden');
  updateFocusHud();
  const activeRunSeconds = clamp(state.activeWallElapsed, 0, getBonusRunCap());
  const catalog = applyCatalogBonus(state.oreCounts);
  const haul = catalog.haul;
  const haulCount = countOreBag(haul);
  const report = buildRunReport(catalog, haul, activeRunSeconds);
  state.lastHaul = haul;
  state.lastHaulCount = haulCount;
  addOreBag(save.inventory, haul);
  addOreBag(save.lifetimeOres, haul);
  save.runs += 1;
  invalidateWorkshopEligibility();
  resetWorkshopInstallSession();
  if ((state.metrics.eventCount || 0) > 0) {
    save.totalEvents += state.metrics.eventCount;
    save.runsSinceEvent = 0;
  } else {
    save.runsSinceEvent = (save.runsSinceEvent || 0) + 1;
  }
  save.lifetimeChunks += haulCount;
  save.bestHaul = Math.max(save.bestHaul, haulCount);
  save.bestDepth = Math.max(save.bestDepth, Math.floor(state.deepest));
  save.lastRunReport = report;
  if (!save.bestRunReport || report.haul > (save.bestRunReport.haul || 0)) save.bestRunReport = { ...report };
  persistSave();

  const rarest = Object.entries(haul)
    .filter(([, amount]) => amount > 0)
    .sort(([a], [b]) => (oreById.get(b)?.tier || 0) - (oreById.get(a)?.tier || 0))[0];
  const rareText = rarest ? `${oreById.get(rarest[0])?.name || rarest[0]} ×${rarest[1]}` : 'руда не найдена';
  const haulText = ORE_TYPES
    .filter((ore) => haul[ore.id] > 0)
    .map((ore) => `${ore.name} ×${haul[ore.id]}`)
    .join(' · ') || 'пусто';
  if (ui.resultTitle) ui.resultTitle.textContent = haulCount > 0 ? 'СМЕНА ЗАВЕРШЕНА' : 'СИГНАЛ ПОТЕРЯН';
  if (ui.resultStats) {
    ui.resultStats.innerHTML = `
      <div><span>Добыча</span><strong>${formatNumber(haulCount)} куск.</strong></div>
      <div><span>Разрушено</span><strong>${state.blocksBroken}</strong></div>
      <div><span>Глубина</span><strong>${Math.floor(state.deepest)} м</strong></div>
      <div><span>Лучшая находка</span><strong>${rareText}</strong></div>
      <div><span>Состав груза</span><strong>${haulText}</strong></div>
      ${catalog.bonusCount > 0 ? `<div><span>Каталог находок</span><strong>+${catalog.bonusCount} · ×${catalog.multiplier.toFixed(2)}</strong></div>` : ''}
      `;
  }
  if (ui.bankedOre) ui.bankedOre.textContent = `+${formatNumber(haulCount)}`;
  if (ui.resultOreBreakdown) ui.resultOreBreakdown.innerHTML = oreBreakdownMarkup(haul);
  if (ui.resultOreBadge) {
    if (rarest) {
      ui.resultOreBadge.dataset.ore = rarest[0];
      ui.resultOreBadge.title = `${oreById.get(rarest[0])?.name || rarest[0]} ×${formatNumber(haul[rarest[0]] || rarest[1])}`;
    } else {
      delete ui.resultOreBadge.dataset.ore;
      ui.resultOreBadge.title = 'Руда не найдена';
    }
  }
  renderRunReport(report);
  ui.resultScreen?.classList.remove('hidden');
  $('#fieldGuide')?.classList.add('hidden');
  updatePersistentLabels();
  activateNextTutorial();
  showTutorial(
    'first_report',
    'РАЗБОР СМЕНЫ',
    'После каждого забега отчёт показывает, куда ушло время, что разрушало породу и насколько результат лучше прошлого.',
    'Геологический журнал хранит постоянные рекорды по каждому виду руды.',
  );
  requestAnimationFrame(() => {
    if (state.activeTutorialId) ui.tutorialNext?.focus?.({ preventScroll: true });
    else ui.retryRun?.focus?.({ preventScroll: true });
  });
  sound.tone(220, 0.15, 'triangle', 0.04, -80);
}

function refreshCampaignUI() {
  const progress = getCampaignProgress();
  if (ui.campaignStatus) {
    ui.campaignStatus.textContent = progress.ready
      ? (save.endingSeen ? 'ФИНАЛ ОТКРЫТ' : 'РАКЕТА ГОТОВА')
      : `РАКЕТА · ${progress.percent}% · ИНСТРУМЕНТЫ ${progress.unlockedTools}/${progress.totalTools} · ВЕРШИНЫ ${progress.completedCapstones}/${progress.totalCapstones}`;
    ui.campaignStatus.title = `Непрерывный прогресс учитывает оборудование ${progress.purchasedLevels}/${progress.levelGoal}, руды ${progress.discoveredOres}/${progress.totalOres}, инструменты ${progress.unlockedTools}/${progress.totalTools}, верхушки ${progress.completedCapstones}/${progress.totalCapstones} и добычу ${formatNumber(progress.lifetimeChunks)}/${formatNumber(progress.requiredLifetimeChunks)}.`;
  }
  ui.launchRocket?.classList.toggle('hidden', !progress.ready);
  if (ui.launchLabel) ui.launchLabel.textContent = save.endingSeen ? 'СМОТРЕТЬ ФИНАЛ' : 'ЗАПУСТИТЬ РАКЕТУ';
  return progress;
}

function replayEnding() {
  if (!ui.endingScreen) return;
  const animated = ui.endingScreen.querySelectorAll(
    '.ending-stage, #endingComicImage, .ending-comic__gutter, .ending-comic__halftone, .ending-panel, .ending-progress__rail b, .ending-footer',
  );
  animated.forEach((element) => { element.style.animation = 'none'; });
  void ui.endingScreen.offsetWidth;
  requestAnimationFrame(() => animated.forEach((element) => element.style.removeProperty('animation')));
  sound.tone(180, 0.18, 'triangle', 0.035, 240);
}

function showEnding() {
  const progress = getCampaignProgress();
  if (!progress.ready && !save.campaignComplete) return;
  deferActiveTutorialForMode('ending');
  state.mode = 'ending';
  updateUtilityNavState();
  save.campaignComplete = true;
  save.endingSeen = true;
  persistSave();
  hideAllScreens();
  ui.runHud?.classList.add('hidden');
  $('#fieldGuide')?.classList.add('hidden');
  $('#pauseOverlay')?.classList.add('hidden');
  ui.endingScreen?.classList.remove('hidden');
  ui.endingProgress?.setAttribute('aria-valuenow', '2');
  refreshCampaignUI();
  replayEnding();
  setTimeout(() => {
    if (state.mode === 'ending') sound.tone(110, 0.45, 'sawtooth', 0.035, 190);
  }, 700);
  setTimeout(() => {
    if (state.mode === 'ending') ui.endingReplay?.focus({ preventScroll: true });
  }, 1450);
}

function hideAllScreens() {
  ui.startScreen?.classList.add('hidden');
  ui.resultScreen?.classList.add('hidden');
  ui.upgradeScreen?.classList.add('hidden');
  ui.endingScreen?.classList.add('hidden');
  ui.journalScreen?.classList.add('hidden');
  ui.balanceScreen?.classList.add('hidden');
}

function showTitle() {
  state.mode = 'title';
  hideAllScreens();
  ui.runHud?.classList.add('hidden');
  ui.startScreen?.classList.remove('hidden');
  updateUtilityNavState();
  updatePersistentLabels();
  activateNextTutorial();
}

function openUpgradeScreen() {
  if (!['title', 'result'].includes(state.mode)) return;
  state.returnMode = state.mode === 'result' ? 'result' : 'title';
  deferActiveTutorialForMode('upgrades');
  state.mode = 'upgrades';
  ensureWorkshopEligibility();
  updateUtilityNavState();
  ui.startScreen?.classList.add('hidden');
  ui.resultScreen?.classList.add('hidden');
  ui.upgradeScreen?.classList.remove('hidden');
  renderUpgrades();
  activateNextTutorial();
  showTutorial(
    'upgrade_tree',
    'ЕДИНОЕ ДЕРЕВО',
    'Вся мета-прокачка начинается в одном корне. Ветки расходятся, снова пересекаются и сходятся к перку «В добрый путь».',
    'Наведи курсор на иконку, чтобы увидеть эффект и цену следующего уровня.',
  );
  requestAnimationFrame(() => {
    const selected = state.selectedUpgradeId ? upgradeById.get(state.selectedUpgradeId) : null;
    scrollUpgradeIntoView(selected, false);
    if (state.activeTutorialId) ui.tutorialNext?.focus?.({ preventScroll: true });
    else ui.closeUpgrades?.focus({ preventScroll: true });
  });
}

function closeUpgradeScreen() {
  if (state.activeTutorialId) {
    deactivateActiveTutorial(true);
    persistSave();
  }
  ui.upgradeScreen?.classList.add('hidden');
  if (state.returnMode === 'result') {
    state.mode = 'result';
    updateUtilityNavState();
    if (ui.bankedOre) ui.bankedOre.textContent = `+${formatNumber(state.lastHaulCount)}`;
    renderRunReport(save.lastRunReport);
    ui.resultScreen?.classList.remove('hidden');
    activateNextTutorial();
  } else {
    showTitle();
  }
}

function updatePersistentLabels() {
  renderOreInventory();
  renderOreFocusPanel();
  updateFocusHud();
  $$('[data-total-runs]').forEach((element) => { element.textContent = save.runs; });
  $$('[data-best-haul]').forEach((element) => { element.textContent = formatNumber(save.bestHaul); });
  refreshCampaignUI();
}

function oreIsKnown(ore) {
  return Boolean(
    (save.lifetimeOres?.[ore.id] || 0) > 0
    || (save.inventory?.[ore.id] || 0) > 0
    || save.oreRecords?.[ore.id]
  );
}

function renderGeologicalJournal() {
  if (!ui.journalGrid) return;
  const fragment = document.createDocumentFragment();
  let knownCount = 0;
  let renderedCount = 0;
  for (const ore of ORE_TYPES) {
    const known = oreIsKnown(ore);
    if (known) knownCount += 1;
    if (state.journalFilter === 'known' && !known) continue;
    if (state.journalFilter === 'unknown' && known) continue;
    const record = save.oreRecords?.[ore.id] || {};
    const card = document.createElement('article');
    card.className = `journal-card${known ? ' is-discovered' : ' is-unknown'}`;
    card.style.setProperty('--ore-journal', ore.color || '#71808c');
    card.setAttribute('role', 'listitem');
    if (known) card.tabIndex = 0;
    if (known) {
      card.innerHTML = `
        <span class="journal-card__tier">T${(ore.tier || 0) + 1}</span>
        <span class="journal-card__sample" aria-hidden="true"><i></i></span>
        <div><small>ОБРАЗЕЦ · ${Math.round(ore.hardness || ore.hp || 0)} ПЛОТН.</small><h3>${ore.name}</h3><p>${ore.description || 'Рудная жила.'}</p></div>
        <dl>
          <div><dt>Всего</dt><dd>${formatNumber(save.lifetimeOres?.[ore.id] || 0)}</dd></div>
          <div><dt>Ценность</dt><dd>×${formatNumber(ore.value || 1)}</dd></div>
          <div><dt>Встречается</dt><dd>от ~${Math.floor((ore.depth || 0) / TILE_SIZE)} м</dd></div>
          <div><dt>Выход</dt><dd>${formatNumber(record.largestYield || 0)}</dd></div>
          <div><dt>Рекорд глубины</dt><dd>${Math.floor(record.deepest || 0)} м</dd></div>
          <div><dt>Блоки</dt><dd>${formatNumber(record.physicalBlocks || 0)}</dd></div>
        </dl>`;
    } else {
      const depthHint = Math.max(0, Math.floor((ore.depth || 0) / TILE_SIZE * 0.9));
      card.innerHTML = `
        <span class="journal-card__tier">T${(ore.tier || 0) + 1}</span>
        <span class="journal-card__sample" aria-hidden="true"><i></i></span>
        <div><small>ОБРАЗЕЦ НЕ НАЙДЕН</small><h3>НЕИЗВЕСТНО</h3><p>Ищите примерно после ${depthHint} м. Свойства откроются после первой добычи.</p></div>
        <span class="journal-card__lock"><span aria-hidden="true">◆</span> СИЛУЭТ</span>`;
    }
    fragment.append(card);
    renderedCount += 1;
  }
  if (!renderedCount) {
    const empty = document.createElement('p');
    empty.className = 'journal-empty';
    empty.textContent = state.journalFilter === 'known'
      ? 'Открытых образцов пока нет — первая находка появится здесь автоматически.'
      : 'Неоткрытых образцов не осталось.';
    fragment.append(empty);
  }
  ui.journalGrid.replaceChildren(fragment);
  if (ui.journalDiscoveryCount) ui.journalDiscoveryCount.textContent = `${knownCount} / ${ORE_TYPES.length}`;
  ui.journalDiscoveryCount?.parentElement?.setAttribute('aria-label', `Открыто ${knownCount} из ${ORE_TYPES.length} пород`);
  $$('[data-journal-filter]').forEach((button) => {
    const active = button.dataset.journalFilter === state.journalFilter;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', String(active));
  });
}

function rememberAuxiliaryReturnMode() {
  state.returnMode = ['result', 'upgrades', 'title'].includes(state.mode) ? state.mode : 'title';
  state.lastFocusedElement = document.activeElement || null;
}

function updateUtilityNavState() {
  const suppressed = ['run', 'sector', 'journal', 'balance', 'ending'].includes(state.mode);
  ui.utilityNav?.classList.toggle('is-suppressed', suppressed);
  ui.openJournal?.setAttribute('aria-expanded', String(state.mode === 'journal'));
  ui.openBalance?.setAttribute('aria-expanded', String(state.mode === 'balance'));
}

function openJournalScreen() {
  if (!['title', 'result', 'upgrades'].includes(state.mode)) return;
  rememberAuxiliaryReturnMode();
  deferActiveTutorialForMode('journal');
  state.mode = 'journal';
  hideAllScreens();
  renderGeologicalJournal();
  ui.journalScreen?.classList.remove('hidden');
  updateUtilityNavState();
  activateNextTutorial();
  requestAnimationFrame(() => ui.closeJournal?.focus({ preventScroll: true }));
}

function closeAuxiliaryScreen() {
  const returnFocus = state.lastFocusedElement;
  hideAllScreens();
  if (state.returnMode === 'result') {
    state.mode = 'result';
    ui.resultScreen?.classList.remove('hidden');
    renderRunReport(save.lastRunReport);
  } else if (state.returnMode === 'upgrades') {
    state.mode = 'upgrades';
    ui.upgradeScreen?.classList.remove('hidden');
    renderUpgrades();
  } else {
    showTitle();
  }
  updateUtilityNavState();
  activateNextTutorial();
  requestAnimationFrame(() => {
    if (state.activeTutorialId) ui.tutorialNext?.focus?.({ preventScroll: true });
    else returnFocus?.focus?.({ preventScroll: true });
  });
}

function profileLevels(percent) {
  const fraction = clamp((Number(percent) || 0) / 100, 0, 1);
  const totalLevels = UPGRADE_DEFS.reduce((sum, definition) => sum + definition.maxLevel, 0);
  const targetLevels = Math.round(totalLevels * fraction);
  const levels = {};
  const depthMemo = new Map();
  const dependency = (requirement) => (
    typeof requirement === 'string'
      ? { id: requirement, level: 1 }
      : { id: requirement.id, level: requirement.level || 1 }
  );
  const nodeDepth = (definition, visiting = new Set()) => {
    if (depthMemo.has(definition.id)) return depthMemo.get(definition.id);
    if (visiting.has(definition.id)) return Number.MAX_SAFE_INTEGER;
    const nextVisiting = new Set(visiting).add(definition.id);
    const parents = (definition.requires || [])
      .map((requirement) => upgradeById.get(dependency(requirement).id))
      .filter(Boolean);
    const depth = parents.length
      ? 1 + Math.max(...parents.map((parent) => nodeDepth(parent, nextVisiting)))
      : 0;
    depthMemo.set(definition.id, depth);
    return depth;
  };
  const spreadWeight = 2 + fraction * 9;
  let purchased = 0;

  while (purchased < targetLevels) {
    let candidate = null;
    let candidateScore = Infinity;
    for (const definition of UPGRADE_DEFS) {
      const current = levels[definition.id] || 0;
      if (current >= definition.maxLevel) continue;
      const ready = (definition.requires || []).every((requirement) => {
        const required = dependency(requirement);
        return (levels[required.id] || 0) >= required.level;
      });
      if (!ready) continue;
      const score = nodeDepth(definition) + current / definition.maxLevel * spreadWeight;
      if (score < candidateScore) {
        candidate = definition;
        candidateScore = score;
      }
    }
    if (!candidate) break;
    levels[candidate.id] = (levels[candidate.id] || 0) + 1;
    purchased += 1;
  }
  return levels;
}

function validateProfileLevels(levels) {
  return UPGRADE_DEFS.flatMap((definition) => {
    if ((levels[definition.id] || 0) <= 0) return [];
    const missing = (definition.requires || []).filter((requirement) => {
      const id = typeof requirement === 'string' ? requirement : requirement.id;
      const level = typeof requirement === 'string' ? 1 : (requirement.level || 1);
      return (levels[id] || 0) < level;
    });
    return missing.length ? [definition.id] : [];
  });
}

function estimateBalanceRun(seed, profilePercent, preparedStats = null) {
  const simulatedStats = preparedStats || normalizeStats(calculateMetaStats(profileLevels(profilePercent)));
  const world = new MineWorld(ORE_TYPES, seed);
  const spawn = world.getSpawn();
  const sector = typeof world.getSector === 'function' ? world.getSector() : null;
  const targets = [];
  const originX = spawn.x ?? (spawn.tx + 0.5) * TILE_SIZE;
  const originY = spawn.y ?? (spawn.ty + 0.5) * TILE_SIZE;
  const expectedChance = (baseChance = 0, luckWeight = 0.22) => clamp(
    (baseChance || 0) + (simulatedStats.luck || 0) * luckWeight + (simulatedStats.fortuneProcChance || 0),
    0,
    0.95,
  );
  const expectedCritical = 1 + expectedChance(simulatedStats.critChance, 0.16)
    * Math.max(0, simulatedStats.critMultiplier - 1);
  const expectedMulti = 1
    + Math.max(0, (simulatedStats.multiHitCount || 1) - 1) * 0.65
    + expectedChance(simulatedStats.multiHitChance, 0.1) * 0.65;
  const expectedCharged = 1 + Math.max(0, simulatedStats.chargedHitPower || 0) / 8;
  const expectedStreak = 1 + Math.max(0, simulatedStats.streakPower || 0)
    * Math.max(0, simulatedStats.streakCap || 0) * 0.45;
  const beamCount = simulatedStats.laserUnlocked
    ? clamp(Math.floor(simulatedStats.laserBeams || 1), 1, 5)
    : 1;
  const beamPower = simulatedStats.laserUnlocked
    ? (simulatedStats.laserPower || 1)
      * (1 + Math.max(0, beamCount - 1) * 0.62)
      * (1 + Math.max(0, simulatedStats.laserPierce || 1) * 0.08)
    : 1;
  const overclock = simulatedStats.chronoOverclock
    ? 1
      + (simulatedStats.startTimeFreeze || 0) * 0.025
      + (simulatedStats.timerDrainReduction || 0) * 0.28
      + (simulatedStats.timeRefundChance || 0) * 0.25
      + (simulatedStats.timeShardChance || 0) * 0.18
      + (simulatedStats.lastChanceCharges || 0) * 0.03
    : 1;
  const chronoOverdriveEstimate = simulatedStats.chronoOverdrive
    ? 1
      + (simulatedStats.chronoOverflowSpeedBonus || 0) * 0.45
      + ((simulatedStats.chronoOverflowProcEvery || 0) > 0 ? 0.45 / simulatedStats.chronoOverflowProcEvery : 0)
    : 1;
  const attackRate = simulatedStats.digSpeed
    * (simulatedStats.laserUnlocked ? (simulatedStats.laserChargeRate || 1) : 1)
    * overclock
    * chronoOverdriveEstimate;
  const densityPower = hardnessPierceMultiplier(ORE_TYPES[4], simulatedStats.hardnessPierce);
  const directDps = simulatedStats.pickPower * attackRate * densityPower
    * (1 + Math.max(0, simulatedStats.oreDamageBonus || 0))
    * expectedCritical * expectedMulti * expectedCharged * expectedStreak * beamPower;
  const toolSweep = simulatedStats.laserUnlocked
    ? 1 + Math.min(10,
      simulatedStats.laserRange / TILE_SIZE
        * Math.max(0.35, simulatedStats.laserWidth / TILE_SIZE)
        * (1 + Math.max(0, beamCount - 1) * 0.45)
        * 0.42)
    : 1 + (simulatedStats.areaMiningUnlocked
      ? Math.min(5, Math.PI * (simulatedStats.digRadius / TILE_SIZE) ** 2 * 0.45)
      : 0);
  const bombChance = (simulatedStats.bombChance || 0) > 0
    ? expectedChance(simulatedStats.bombChance, 0.18)
    : 0;
  const chainChance = (simulatedStats.chainChance || 0) > 0
    ? expectedChance(simulatedStats.chainChance, 0.16)
    : 0;
  const bombArea = Math.max(1, Math.PI * (simulatedStats.bombRadius / TILE_SIZE) ** 2 * 0.22);
  const volatileFactor = 1 + ((simulatedStats.volatileBombChance || 0) > 0
    ? expectedChance(simulatedStats.volatileBombChance, 0.1) * 2.2
    : 0);
  const stickyFactor = 1 + ((simulatedStats.stickyBombChance || 0) > 0
    ? expectedChance(simulatedStats.stickyBombChance, 0.12) * 0.45
    : 0);
  const fragmentFactor = 1 + Math.min(6, simulatedStats.bombFragments || 0)
    * Math.max(0, simulatedStats.bombFragmentPower || 0.3) * 0.2;
  const magneticFieldUptime = simulatedStats.magneticFieldEnabled && bombChance > 0
    ? clamp(attackRate * bombChance * Math.max(0, simulatedStats.magneticFieldDuration || 0), 0, 1)
    : 0;
  const magneticBonus = simulatedStats.magneticFieldEnabled
    ? Math.max(0, simulatedStats.magneticFieldTargetingBonus || 0)
    : 0;
  const primaryBombFieldFactor = 1 + magneticBonus;
  const sustainedMagneticFactor = 1 + magneticBonus * magneticFieldUptime;
  const bombDps = attackRate * bombChance * simulatedStats.pickPower
    * Math.max(0, simulatedStats.bombPower || 1) * 1.8 * bombArea
    * volatileFactor * stickyFactor * fragmentFactor * primaryBombFieldFactor;
  const chainDps = attackRate * chainChance
    * Math.max(1, simulatedStats.chainCount || 1) * simulatedStats.pickPower
    * Math.max(0, simulatedStats.chainPower || 0.55)
    * (1 + (simulatedStats.triangularFixGadgetDamageBonus || 0) * 0.35)
    * sustainedMagneticFactor;
  const droneDps = Math.max(0, simulatedStats.droneCount || 0)
    * Math.max(0, simulatedStats.droneSpeed || 1)
    * simulatedStats.pickPower * Math.max(0, simulatedStats.dronePower || 0.35)
    * clamp(simulatedStats.droneLifetime || 0, 0, 1)
    * sustainedMagneticFactor;
  const echoDps = simulatedStats.laserUnlocked && simulatedStats.laserSuperPickEchoEvery > 0
    ? attackRate / simulatedStats.laserSuperPickEchoEvery
      * simulatedStats.pickPower * simulatedStats.laserSuperPickEchoPower
      * Math.max(1, Math.PI * simulatedStats.laserSuperPickEchoRadiusTiles ** 2 * 0.28)
    : 0;
  const sideChipDps = (simulatedStats.sideChipEvery || 0) > 0
    ? directDps * (simulatedStats.sideChipPower || 0) * Math.max(1, simulatedStats.sideChipHits || 0)
      / simulatedStats.sideChipEvery * 0.32
    : 0;
  const impactWaveDps = (simulatedStats.impactWaveEvery || 0) > 0
    ? directDps * (simulatedStats.impactWavePower || 0)
      * Math.max(1, Math.PI * (simulatedStats.impactWaveRadiusTiles || 0) ** 2 * 0.16)
      / simulatedStats.impactWaveEvery
    : 0;
  const persistentFieldDps = simulatedStats.superFieldEnabled
    ? directDps * (simulatedStats.superFieldPower || 0)
      * Math.max(1, (simulatedStats.superFieldRadiusTiles || 0) ** 2 * 0.16)
    : 0;
  const laserHeatDps = simulatedStats.laserUnlocked && simulatedStats.laserHeatEdgePower > 0
    ? directDps * (
      Math.max(0, simulatedStats.laserHeatEdgePower || 0) * 0.35
      + Math.max(0, simulatedStats.laserHeatNextHitBonus || 0) * 0.12
    )
    : 0;
  const tripleSampleDps = (simulatedStats.tripleSampleEvery || 0) > 0
    ? directDps * Math.max(0, simulatedStats.tripleSampleNextNodeDamage || 0)
      / simulatedStats.tripleSampleEvery * 0.7
    : 0;
  const solarDps = simulatedStats.solarDrillEnabled && simulatedStats.solarDrillProcEvery > 0
    ? directDps * (1 + Math.max(0, simulatedStats.solarDrillFinalBurstPower || 0))
      / simulatedStats.solarDrillProcEvery
    : 0;
  const effectiveDps = Math.max(
    0.1,
    directDps + bombDps + chainDps + droneDps + echoDps + sideChipDps + impactWaveDps
      + persistentFieldDps + laserHeatDps + tripleSampleDps + solarDps,
  );
  const workRange = simulatedStats.laserUnlocked
    ? simulatedStats.laserRange * 0.78
    : Math.max(simulatedStats.digReach, TILE_SIZE * 0.9);
  const movementSpeed = Math.max(1, simulatedStats.moveSpeed * (simulatedStats.mineMoveMultiplier || 1));
  const routeResistance = clamp(
    (sector?.modifiers?.hardness || 1) / Math.sqrt(sector?.modifiers?.caves || 1),
    0.6,
    1.55,
  );
  if (typeof world.forEachOreTileInBounds === 'function') {
    world.forEachOreTileInBounds(0, 0, WORLD_CONFIG.WIDTH - 1, WORLD_CONFIG.HEIGHT - 1, (tile, tx, ty) => {
      const ore = oreById.get(tile.oreId);
      if (!ore) return;
      const x = (tx + 0.5) * TILE_SIZE;
      const y = (ty + 0.5) * TILE_SIZE;
      const travelDistance = Math.max(0, distance(originX, originY, x, y) - workRange);
      const travel = travelDistance / movementSpeed * routeResistance;
      const rarePower = 1 + ((ore.tier || 0) >= 4 ? (simulatedStats.rareOreDamageBonus || 0) : 0);
      const work = Math.max(1, tile.hp || 1) / Math.max(0.1, effectiveDps * rarePower);
      const valueWeight = 1 + Math.log2(1 + (ore.value || 1)) * Math.max(0, simulatedStats.targetValueBias || 0);
      const score = (travel * 0.22 + work) / valueWeight;
      targets.push({ tile, ore, tx, ty, x, y, travel, work, score });
    });
  }
  targets.sort((left, right) => left.score - right.score || left.ty - right.ty || left.tx - right.tx);
  const timerDrain = clamp(simulatedStats.timerDrainMultiplier || 1, 0.5, 1);
  const directDuration = clamp(simulatedStats.runDuration, MIN_RUN_SECONDS, DIRECT_MAX_RUN_SECONDS);
  const bonusCap = clamp(simulatedStats.bonusRunDurationCap || BONUS_MAX_RUN_SECONDS, DIRECT_MAX_RUN_SECONDS, BONUS_MAX_RUN_SECONDS);
  let duration = Math.min(
    bonusCap,
    directDuration / timerDrain
      + Math.max(0, simulatedStats.startTimeFreeze || 0)
      + Math.max(0, simulatedStats.lastChanceCharges || 0) * Math.max(0, simulatedStats.lastChanceSeconds || 0),
  );
  let time = 0;
  let haul = 0;
  let cargoValue = 0;
  let depth = 0;
  let mined = 0;
  let oreBlocks = 0;
  const oreBreakdown = createOreBag();
  let previousX = originX;
  let previousY = originY;
  const foundTypes = new Set();
  let motherlodeEstimateTriggered = false;
  let motherlodeEstimateNodesRemaining = 0;
  const estimatedVeinNodes = 5;
  const collateralPerTarget = clamp(
    1
      + Math.max(0, toolSweep - 1) * 0.18
      + bombChance * Math.min(3, bombArea * 0.16)
      + chainChance * Math.min(2, simulatedStats.chainCount || 1) * 0.22,
    1,
    5,
  );
  for (const target of targets) {
    const legDistance = Math.max(0, distance(previousX, previousY, target.x, target.y) - workRange);
    const incrementalTravel = (legDistance / movementSpeed) * routeResistance * (oreBlocks ? 0.24 : 1);
    const cost = incrementalTravel + target.work;
    if (time + cost > duration) continue;
    time += cost;
    previousX = target.x;
    previousY = target.y;
    const collateral = Math.min(collateralPerTarget, targets.length - oreBlocks);
    const oreBlocksBefore = oreBlocks;
    oreBlocks += collateral;
    mined += collateral * (1 + Math.max(0, toolSweep - 1) * 0.65)
      + legDistance / TILE_SIZE * 0.18;
    depth = Math.max(depth, target.ty - spawn.ty);
    const firstOfType = !foundTypes.has(target.ore.id);
    foundTypes.add(target.ore.id);
    const richVeinChance = expectedChance(simulatedStats.richVeinWholeChance, 0.18);
    const richVeinMultiplier = 1 + richVeinChance * Math.max(0, simulatedStats.richVeinYieldBonus || 0);
    const richCompletionExpected = richVeinChance
      * Math.max(0, simulatedStats.richVeinCompletionBonus || 0) / estimatedVeinNodes;
    let motherlodeAffectedBlocks = 0;
    let motherlodeCompletedHere = false;
    if (simulatedStats.motherlodeGuaranteed) {
      const trigger = Math.max(1, simulatedStats.motherlodeTriggerBreaks || 20);
      let eligibleBlocks = motherlodeEstimateTriggered
        ? collateral
        : Math.max(0, oreBlocks - Math.max(trigger, oreBlocksBefore));
      if (!motherlodeEstimateTriggered && oreBlocks >= trigger) {
        motherlodeEstimateTriggered = true;
        motherlodeEstimateNodesRemaining = estimatedVeinNodes;
      }
      if (motherlodeEstimateTriggered && motherlodeEstimateNodesRemaining > 0 && eligibleBlocks > 0) {
        motherlodeAffectedBlocks = Math.min(eligibleBlocks, motherlodeEstimateNodesRemaining);
        motherlodeEstimateNodesRemaining -= motherlodeAffectedBlocks;
        motherlodeCompletedHere = motherlodeEstimateNodesRemaining <= 0;
      }
    }
    const tripleSampleExpected = (simulatedStats.tripleSampleEvery || 0) > 0
      ? Math.max(0, simulatedStats.tripleSampleBonusYield || 0) / simulatedStats.tripleSampleEvery
      : 0;
    const wheelExpected = simulatedStats.fortuneWheelEnabled && simulatedStats.fortunePityThreshold > 0
      ? 0.42 / simulatedStats.fortunePityThreshold
      : 0;
    const baseDropPieces = 1
      + expectedChance(simulatedStats.extraYieldChance, 0.24)
      + expectedChance(simulatedStats.doubleDropChance, 0.18)
      + expectedChance(simulatedStats.tripleDropChance, 0.12) * 2
      + tripleSampleExpected
      + wheelExpected;
    const ordinaryDropPieces = baseDropPieces * richVeinMultiplier + richCompletionExpected;
    const motherlodeShare = collateral > 0 ? motherlodeAffectedBlocks / collateral : 0;
    const motherlodeDropPieces = baseDropPieces * Math.max(1, simulatedStats.motherlodeYieldMultiplier || 1);
    const dropMultiplier = ordinaryDropPieces * (1 - motherlodeShare)
      + motherlodeDropPieces * motherlodeShare;
    const comboMultiplier = 1 + Math.min(
      1.1,
      Math.max(0, attackRate - 2) * 0.018 * Math.max(1, simulatedStats.comboMultiplier || 1),
    );
    const depthProgress = clamp((target.ty - spawn.ty) / Math.max(1, WORLD_CONFIG.HEIGHT - spawn.ty), 0, 1);
    const gemMultiplier = (target.ore.tier || 0) >= 6 ? (simulatedStats.gemValueMultiplier || 1) : 1;
    const diversityMultiplier = 1 + Math.max(0, foundTypes.size - 1)
      * Math.max(0, simulatedStats.oreDiversityBonusPerType || 0);
    const targetDepth = Math.abs(target.x - originX) / TILE_SIZE * 0.42
      + Math.max(0, target.y - originY) / TILE_SIZE;
    const contractStacks = simulatedStats.depthContractStep > 0
      ? Math.min(
        simulatedStats.depthContractMaxStacks || 0,
        Math.floor(targetDepth / simulatedStats.depthContractStep),
      )
      : 0;
    const yieldPerBlock = Math.max(1,
      (simulatedStats.oreValueMultiplier || 1)
        * dropMultiplier
        * comboMultiplier
        * gemMultiplier
        * (1 + depthProgress * Math.max(0, simulatedStats.depthValueBonus || 0))
        * (1 + contractStacks * Math.max(0, simulatedStats.depthContractBonusPerStack || 0))
        * diversityMultiplier);
    const pieces = collateral * yieldPerBlock;
    oreBreakdown[target.ore.id] = (oreBreakdown[target.ore.id] || 0) + pieces;
    const nextOre = ORE_TYPES
      .filter((ore) => ore.tier > target.ore.tier && foundTypes.has(ore.id))
      .sort((left, right) => left.tier - right.tier)[0] || null;
    const rareAdditive = nextOre ? expectedChance(simulatedStats.rareOreAdditiveChance, 0.2) : 0;
    const goldOre = oreById.get('gold') || null;
    const goldIsKnown = Boolean(
      goldOre
      && (
        foundTypes.has(goldOre.id)
        || (save.lifetimeOres?.[goldOre.id] || 0) > 0
        || (save.inventory?.[goldOre.id] || 0) > 0
      )
    );
    const goldAdditive = goldIsKnown ? expectedChance(simulatedStats.goldenOreAdditiveChance, 0.12) : 0;
    const additivePieces = collateral * (rareAdditive + goldAdditive);
    if (nextOre) oreBreakdown[nextOre.id] = (oreBreakdown[nextOre.id] || 0) + collateral * rareAdditive;
    if (goldOre) oreBreakdown[goldOre.id] = (oreBreakdown[goldOre.id] || 0) + collateral * goldAdditive;
    const motherlodeCachePieces = motherlodeCompletedHere
      ? Math.max(0, simulatedStats.motherlodeCompletionCache || 0)
      : 0;
    const motherlodeRichCompletionPieces = motherlodeCompletedHere
      ? Math.max(0, simulatedStats.richVeinCompletionBonus || 0)
      : 0;
    const cacheOre = [...foundTypes]
      .map((oreId) => oreById.get(oreId))
      .filter(Boolean)
      .sort((left, right) => right.tier - left.tier)[0] || target.ore;
    if (motherlodeCachePieces > 0) {
      oreBreakdown[cacheOre.id] = (oreBreakdown[cacheOre.id] || 0) + motherlodeCachePieces;
    }
    if (motherlodeRichCompletionPieces > 0) {
      oreBreakdown[target.ore.id] += motherlodeRichCompletionPieces;
    }
    haul += pieces + additivePieces + motherlodeCachePieces + motherlodeRichCompletionPieces;
    cargoValue += pieces * (target.ore.value || 1)
      + collateral * rareAdditive * (nextOre?.value || target.ore.value || 1)
      + collateral * goldAdditive * (goldOre?.value || target.ore.value || 1)
      + motherlodeCachePieces * (cacheOre.value || target.ore.value || 1)
      + motherlodeRichCompletionPieces * (target.ore.value || 1);
    const expectedTimeBonus = collateral * (
      ((simulatedStats.timeRefundChance || 0) > 0
        ? expectedChance(simulatedStats.timeRefundChance, 0.1) * Math.max(0, simulatedStats.timeRefundAmount || 0)
        : 0)
      + ((simulatedStats.timeShardChance || 0) > 0
        ? expectedChance(simulatedStats.timeShardChance, 0.08) * Math.max(0, simulatedStats.timeShardSeconds || 0)
        : 0)
      + ((simulatedStats.relicEffectChance || 0) > 0
        ? expectedChance(simulatedStats.relicEffectChance, 0.08)
          * 0.25 * (0.4 + Math.min(0.4, simulatedStats.relicEffectPower || 0))
        : 0)
      + (simulatedStats.fortuneWheelEnabled && simulatedStats.fortunePityThreshold > 0
        ? 0.25 / (simulatedStats.fortunePityThreshold * Math.max(1, simulatedStats.fortuneWheelCycleLength || 4))
        : 0)
    )
      + (firstOfType ? Math.max(0, simulatedStats.discoveryTimeBonus || 0) : 0)
      + (motherlodeCompletedHere ? Math.max(0, simulatedStats.motherlodeCompletionTimeBonus || 0) : 0);
    duration = Math.min(bonusCap, duration + expectedTimeBonus);
    if (oreBlocks >= targets.length || mined >= 2_500) break;
  }
  return {
    haul: Math.max(0, haul),
    cargoValue: Math.max(0, cargoValue),
    depth: Math.max(0, depth),
    mined: Math.max(0, mined),
    oreBlocks: Math.max(0, oreBlocks),
    idle: Math.max(0, duration - time),
    duration,
    oreBreakdown,
  };
}

function runBalanceBench() {
  const baseSeed = String(ui.balanceSeed?.value || 'depth-zero-bench').trim() || 'depth-zero-bench';
  const profile = clamp(Number(ui.balanceProfile?.value) || 0, 0, 100);
  const simulations = clamp(Math.floor(Number(ui.balanceRuns?.value) || 12), 1, 30);
  if (ui.balanceRuns) ui.balanceRuns.value = String(simulations);
  const levels = profileLevels(profile);
  const preparedStats = normalizeStats(calculateMetaStats(levels));
  const invalidRequirements = validateProfileLevels(levels);
  const batches = [
    { id: 'random-a', label: 'Случайная серия A' },
    { id: 'random-b', label: 'Случайная серия B' },
    { id: 'random-c', label: 'Случайная серия C' },
  ];
  const rows = batches.map((batch, batchIndex) => {
    const samples = [];
    for (let index = 0; index < simulations; index += 1) {
      samples.push(estimateBalanceRun(`${baseSeed}:random:${batchIndex}:${index}`, profile, preparedStats));
    }
    const average = (key) => samples.reduce((sum, sample) => sum + sample[key], 0) / samples.length;
    return {
      batchId: batch.id,
      batchLabel: batch.label,
      averageHaul: Number(average('haul').toFixed(1)),
      averageCargoValue: Number(average('cargoValue').toFixed(1)),
      averageDepth: Number(average('depth').toFixed(1)),
      averageBlocks: Number(average('mined').toFixed(1)),
      averageOreBlocks: Number(average('oreBlocks').toFixed(1)),
      averageIdle: Number(average('idle').toFixed(2)),
      averageOreBreakdown: Object.fromEntries(ORE_TYPES.map((ore) => [
        ore.id,
        Number((samples.reduce((sum, sample) => sum + (sample.oreBreakdown?.[ore.id] || 0), 0) / samples.length).toFixed(2)),
      ])),
    };
  });
  state.balanceReport = {
    generatedAt: new Date().toISOString(),
    seed: baseSeed,
    profile,
    simulations,
    profileBuild: {
      purchasedLevels: countPurchasedLevels(levels),
      purchasedNodes: Object.values(levels).filter((level) => level > 0).length,
      invalidRequirements,
      tool: preparedStats.tool,
      laserUnlocked: preparedStats.laserUnlocked,
      droneCount: preparedStats.droneCount,
      runDuration: preparedStats.runDuration,
    },
    rows,
  };
  save.balanceHistory = [...(save.balanceHistory || []), state.balanceReport].slice(-12);
  persistSave();
  if (ui.balanceResults) {
    const maxHaul = Math.max(1, ...rows.map((row) => row.averageHaul));
    const safeSeed = escapeHtml(baseSeed);
    ui.balanceResults.innerHTML = `
      <header><div><span class="status-dot"></span><strong id="balanceResultsTitle">СРАВНЕНИЕ СЛУЧАЙНЫХ СЕРИЙ</strong></div><small>seed: ${safeSeed} · ${simulations} забегов в серии</small></header>
      <div class="balance-result-cards">${rows.map((row) => `
        <article><small>${escapeHtml(row.batchLabel.toUpperCase())}</small><strong>${row.averageHaul}</strong><span>кусков · ценность ${formatNumber(row.averageCargoValue)} · ${row.averageDepth} м · ${row.averageBlocks} блок.</span><span>${averageOreBreakdownText(row.averageOreBreakdown)}</span></article>`).join('')}</div>
      <div class="balance-chart" aria-label="Средняя добыча в трёх случайных сериях">${rows.map((row) => `
        <span style="--height:${Math.max(12, row.averageHaul / maxHaul * 94)}%"><i>${escapeHtml(row.batchLabel)}</i><b>${row.averageHaul}</b></span>`).join('')}</div>
      <footer><span><i class="balance-key balance-key--median"></i> ожидаемые куски руды</span><span>профиль ${profile}% · ${escapeHtml(TOOL_NAMES[preparedStats.tool] || preparedStats.tool)} · модель учитывает инструменты, гаджеты и бонусный таймер</span></footer>`;
  }
  ui.exportBalance?.removeAttribute?.('disabled');
  return state.balanceReport;
}

function openBalanceScreen() {
  if (!['title', 'result', 'upgrades'].includes(state.mode)) return;
  rememberAuxiliaryReturnMode();
  deferActiveTutorialForMode('balance');
  state.mode = 'balance';
  hideAllScreens();
  ui.balanceScreen?.classList.remove('hidden');
  if (ui.balanceSeed && !ui.balanceSeed.value) ui.balanceSeed.value = 'depth-zero-bench';
  if (ui.balanceResults && !state.balanceReport) ui.balanceResults.innerHTML = '<p id="balanceResultsTitle">Задайте профиль и запустите локальную серию.</p>';
  updateUtilityNavState();
  activateNextTutorial();
  requestAnimationFrame(() => ui.closeBalance?.focus({ preventScroll: true }));
}

function exportBalanceReport() {
  if (!state.balanceReport || typeof Blob === 'undefined' || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return false;
  const blob = new Blob([JSON.stringify(state.balanceReport, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `depth-zero-balance-${state.balanceReport.seed}.json`.replace(/[^a-zа-яё0-9._-]+/gi, '-');
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
  return true;
}

function renderOreInventory() {
  if (!ui.oreInventory) return;
  const fragment = document.createDocumentFragment();
  for (const ore of ORE_TYPES) {
    const amount = Math.max(0, Math.floor(Number(save.inventory?.[ore.id]) || 0));
    const stock = document.createElement('span');
    stock.className = `ore-inventory__item ore-stock${amount > 0 ? ' has-stock' : ' is-empty'}`;
    stock.dataset.ore = ore.id;
    stock.style.setProperty('--ore-color', ore.color);
    stock.style.setProperty('--ore-accent', ore.accent);
    stock.setAttribute('role', 'listitem');
    stock.setAttribute('aria-label', `${ore.name}: ${formatNumber(amount)}`);
    stock.tabIndex = 0;
    stock.title = `${ore.name}: ${formatNumber(amount)}`;
    stock.innerHTML = `<small>${ore.name}</small><strong>${formatNumber(amount)}</strong>`;
    fragment.append(stock);
  }
  ui.oreInventory.replaceChildren(fragment);
}

function getFocusedOre() {
  if (!stats.oreFocusUnlocked || !save.focusedOreId) return null;
  return oreById.get(save.focusedOreId) || null;
}

function focusedDamageMultiplier(tileOrOreId) {
  const focused = getFocusedOre();
  const oreId = typeof tileOrOreId === 'string' ? tileOrOreId : tileOrOreId?.oreId;
  if (!focused || !oreId || focused.id !== oreId) return 1;
  return 1 / Math.max(0.2, 1 - (stats.focusedOreHardnessReduction || 0));
}

function tileDamageAmount(tx, ty, hpBefore) {
  if (!state.world || !(hpBefore > 0)) return 0;
  const tile = state.world.getTile(tx, ty);
  if (!tile) return 0;
  if (tile.kind === 'air') return hpBefore;
  return clamp(hpBefore - Math.max(0, tile.hp || 0), 0, hpBefore);
}

function tileReceivedDamage(tx, ty, hpBefore) {
  return tileDamageAmount(tx, ty, hpBefore) > 1e-9;
}

function renderOreFocusPanel() {
  if (!ui.oreFocusPanel || !ui.oreFocusChoices) return;
  ui.oreFocusPanel.classList.toggle('hidden', !stats.oreFocusUnlocked);
  if (!stats.oreFocusUnlocked) return;
  const discovered = ORE_TYPES.filter((ore) => (
    (save.lifetimeOres?.[ore.id] || 0) > 0
    || (save.inventory?.[ore.id] || 0) > 0
    || save.focusedOreId === ore.id
  ));
  const fragment = document.createDocumentFragment();
  const normal = document.createElement('button');
  normal.type = 'button';
  normal.className = `ore-focus-choice${save.focusedOreId ? '' : ' is-active'}`;
  normal.dataset.focusOre = '';
  normal.textContent = 'ОБЫЧНЫЙ ПОИСК';
  fragment.append(normal);
  for (const ore of discovered) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `ore-focus-choice${save.focusedOreId === ore.id ? ' is-active' : ''}`;
    button.dataset.focusOre = ore.id;
    button.dataset.ore = ore.id;
    button.style.setProperty('--ore-color', ore.color);
    button.textContent = ore.name.toUpperCase();
    fragment.append(button);
  }
  ui.oreFocusChoices.replaceChildren(fragment);
}

function updateFocusHud() {
  const focused = getFocusedOre();
  ui.focusHud?.classList.toggle('hidden', !focused || state.mode !== 'run');
  const multiplier = focusedSenseMultiplier(focused);
  const escalating = Boolean(focused && multiplier > (stats.oreFocusRadiusMultiplier || 1) + 0.01);
  ui.focusHud?.classList.toggle('is-escalating', escalating);
  if (ui.focusHud) {
    ui.focusHud.title = focused
      ? `${focused.name}: остальные жилы игнорируются; текущий радиус поиска ×${multiplier.toFixed(2)}`
      : 'Рудный фокус игнорирует остальные жилы';
  }
  if (ui.focusHudName) ui.focusHudName.textContent = focused ? `${focused.name.toUpperCase()} · ×${multiplier.toFixed(2)}` : '—';
}

function toast(message, tone = 'info') {
  if (!ui.toast) return;
  const now = performance.now();
  if (toast.lastMessage === message && now - (toast.lastAt || 0) < 650) return;
  toast.lastMessage = message;
  toast.lastAt = now;
  let icon = ui.toast.querySelector('.toast-icon');
  let copy = ui.toast.querySelector('.toast-copy');
  if (!icon || !copy) {
    ui.toast.replaceChildren();
    icon = document.createElement('span');
    icon.className = 'toast-icon';
    icon.setAttribute('aria-hidden', 'true');
    copy = document.createElement('span');
    copy.className = 'toast-copy';
    ui.toast.append(icon, copy);
  }
  icon.textContent = tone === 'warning' ? '!' : tone === 'success' ? '◆' : '◉';
  copy.replaceChildren();
  const strong = document.createElement('strong');
  strong.textContent = message;
  const small = document.createElement('small');
  small.textContent = tone === 'warning' ? 'Проверьте оборудование' : tone === 'success' ? 'Модуль активен' : 'Сигнал экспедиции';
  copy.append(strong, small);
  ui.toast.dataset.tone = tone;
  ui.toast.classList.remove('hidden', 'show');
  requestAnimationFrame(() => ui.toast?.classList.add('show'));
  clearTimeout(toast.timeout);
  toast.timeout = setTimeout(() => ui.toast?.classList.remove('show'), 1500);
}

function flash(color = '#f5d06f', opacity = 0.24) {
  if (!ui.screenFlash) return;
  ui.screenFlash.style.setProperty('--flash-color', color);
  ui.screenFlash.style.setProperty('--flash-opacity', opacity);
  ui.screenFlash.classList.remove('flash');
  void ui.screenFlash.offsetWidth;
  ui.screenFlash.classList.add('flash');
}

function getUpgradeLevel(definition) {
  return clamp(Number(save.levels[definition.id]) || 0, 0, definition.maxLevel);
}

function requirementsMet(definition) {
  const dependenciesReady = (definition.requires || []).every((requirement) => {
    const id = typeof requirement === 'string' ? requirement : requirement.id;
    const level = typeof requirement === 'string' ? 1 : (requirement.level || 1);
    return (save.levels[id] || 0) >= level;
  });
  const sampleId = definition.requiresOreDiscovery;
  const sampleReady = !sampleId || (save.lifetimeOres?.[sampleId] || 0) > 0;
  return dependenciesReady && sampleReady;
}

function invalidateWorkshopEligibility() {
  state.workshopEligibilityRun = -1;
  state.workshopEligibleIds = new Set();
  save.workshopEligibilityRun = -1;
  save.workshopEligibleIds = [];
}

function ensureWorkshopEligibility() {
  const completedRuns = Math.max(0, Math.floor(Number(save.runs) || 0));
  if (state.workshopEligibilityRun === completedRuns) return state.workshopEligibleIds;

  const savedSnapshotIsCurrent = Number(save.workshopEligibilityRun) === completedRuns
    && Array.isArray(save.workshopEligibleIds);
  const eligibleIds = savedSnapshotIsCurrent
    ? save.workshopEligibleIds.filter((id) => upgradeById.has(id))
    : UPGRADE_DEFS
      .filter((definition) => requirementsMet(definition) && getUpgradeLevel(definition) < definition.maxLevel)
      .map((definition) => definition.id);

  state.workshopEligibilityRun = completedRuns;
  state.workshopEligibleIds = new Set(eligibleIds);
  if (!savedSnapshotIsCurrent) {
    save.workshopEligibilityRun = completedRuns;
    save.workshopEligibleIds = [...state.workshopEligibleIds];
    persistSave();
  }
  return state.workshopEligibleIds;
}

function invalidateWorkshopInstallSession() {
  state.workshopInstallRun = -1;
  state.workshopInstalledIds = new Set();
  save.workshopInstallRun = -1;
  save.workshopInstalledIds = [];
}

function resetWorkshopInstallSession() {
  const completedRuns = Math.max(0, Math.floor(Number(save.runs) || 0));
  state.workshopInstallRun = completedRuns;
  state.workshopInstalledIds = new Set();
  save.workshopInstallRun = completedRuns;
  save.workshopInstalledIds = [];
}

function ensureWorkshopInstallSession() {
  const completedRuns = Math.max(0, Math.floor(Number(save.runs) || 0));
  if (state.workshopInstallRun === completedRuns) return state.workshopInstalledIds;

  const savedSessionIsCurrent = Number(save.workshopInstallRun) === completedRuns
    && Array.isArray(save.workshopInstalledIds);
  const installedIds = savedSessionIsCurrent
    ? [...new Set(save.workshopInstalledIds)]
      .filter((id) => upgradeById.has(id) && getUpgradeLevel(upgradeById.get(id)) > 0)
      .slice(0, WORKSHOP_FIRST_RANK_CAP)
    : [];
  const savedSessionNeedsRepair = !savedSessionIsCurrent
    || save.workshopInstalledIds.length !== installedIds.length
    || installedIds.some((id, index) => save.workshopInstalledIds[index] !== id);

  state.workshopInstallRun = completedRuns;
  state.workshopInstalledIds = new Set(installedIds);
  save.workshopInstallRun = completedRuns;
  save.workshopInstalledIds = [...state.workshopInstalledIds];
  if (savedSessionNeedsRepair) persistSave();
  return state.workshopInstalledIds;
}

function workshopInstallStatus() {
  const installed = ensureWorkshopInstallSession().size;
  return {
    installed,
    cap: WORKSHOP_FIRST_RANK_CAP,
    remaining: Math.max(0, WORKSHOP_FIRST_RANK_CAP - installed),
  };
}

function registerWorkshopFirstRank(definition) {
  const installedIds = ensureWorkshopInstallSession();
  if (installedIds.has(definition.id)) return;
  if (installedIds.size >= WORKSHOP_FIRST_RANK_CAP) return;
  installedIds.add(definition.id);
  save.workshopInstallRun = state.workshopInstallRun;
  save.workshopInstalledIds = [...installedIds];
}

function upgradePurchaseBlockReason(definition) {
  if (!upgradeIsAvailable(definition) || getUpgradeLevel(definition) > 0) return null;
  if (!ensureWorkshopEligibility().has(definition.id)) return 'preparation';
  if (workshopInstallStatus().remaining <= 0) return 'capacity';
  return null;
}

function upgradeIsPurchaseEligible(definition) {
  if (!upgradeIsAvailable(definition)) return false;
  // Once installation has started, every remaining rank stays available.
  // Workshop preparation and capacity gates apply only to a new node's first rank.
  if (getUpgradeLevel(definition) > 0) return true;
  return upgradePurchaseBlockReason(definition) === null;
}

const UPGRADE_CEREMONIES = Object.freeze({
  gadgets_powder_pocket: Object.freeze({
    title: 'ПЕРВЫЙ ПОРОХОВОЙ ЗАРЯД',
    text: 'Бомбы теперь могут вылетать при ударе. В следующей смене первый подходящий удар гарантированно покажет новый эффект.',
    hint: 'Дальние узлы превратят случайный взрыв в управляемую систему подрыва.',
  }),
  sense_ore_focus: Object.freeze({
    title: 'ОТКРЫТ РУДНЫЙ ФОКУС',
    text: 'В мастерской появился выбор приоритетной руды. Выбранный ресурс ищется в расширенной зоне, а остальные жилы временно игнорируются.',
    hint: 'Сначала выберите уже найденную руду в панели над деревом.',
  }),
  tools_iron_pick: Object.freeze({ title: 'ЖЕЛЕЗНАЯ КИРКА', text: 'Новый инструмент установлен и будет заметен уже в следующей смене.', hint: 'Смена инструмента меняет темп ударов и внешний вид шахтёра.' }),
  tools_steel_pick: Object.freeze({ title: 'СТАЛЬНАЯ КИРКА', text: 'Инструмент перешёл на следующий технологический уровень.', hint: 'Теперь плотные пласты будут открываться заметно увереннее.' }),
  tools_pneumatic_pick: Object.freeze({ title: 'ПНЕВМОКИРКА', text: 'Автоматика получила пневматический привод: серия ударов стала отдельной фазой прогрессии.', hint: 'Следующая смена сразу начнётся с новым инструментом.' }),
  tools_super_pick: Object.freeze({ title: 'СУПЕРКИРКА', text: 'Собран первый сверхмощный инструмент поздней шахты.', hint: 'Её модули готовят переход к дистанционной добыче.' }),
  tools_laser_emitter: Object.freeze({ title: 'ДАЛЬНОБОЙНЫЙ ЛАЗЕР', text: 'Шахтёр больше не обязан подходить к каждой жиле вплотную: добыча переходит на дистанционный режим.', hint: 'Дальность, ширина и расщепление луча развиваются отдельными узлами.' }),
  tools_solar_drill: Object.freeze({ title: 'СОЛНЕЧНЫЙ БУР', text: 'Финальная форма инструмента собрана. Заряженные серии завершаются заметным призмовым импульсом.', hint: 'Осталось свести вершины дерева к общему стартовому протоколу.' }),
});

function showUpgradeCeremony(definition) {
  const ceremony = UPGRADE_CEREMONIES[definition.id] || (CAMPAIGN.capstones.includes(definition.id)
    ? {
      title: 'ВЕРШИНА ВЕТВИ ОСВОЕНА',
      text: `«${definition.name}» — один из семи ключевых модулей, необходимых для финального перка «В добрый путь».`,
      hint: 'Индикатор ракеты учитывает эту вершину сразу после установки.',
    }
    : null);
  if (!ceremony) return;
  showTutorial(
    `unlock_${definition.id}`,
    ceremony.title,
    ceremony.text,
    ceremony.hint,
    { validModes: ['upgrades'] },
  );
}

function buyUpgrade(id, options = {}) {
  const definition = upgradeById.get(id);
  if (!definition) return;
  const campaignWasReady = getCampaignProgress().ready;
  const startingLevel = getUpgradeLevel(definition);
  if (startingLevel >= definition.maxLevel) return;
  if (!requirementsMet(definition)) {
    toast('УСЛОВИЯ УЛУЧШЕНИЯ ЕЩЁ НЕ ВЫПОЛНЕНЫ', 'warning');
    sound.tone(90, 0.1, 'square', 0.025, -25);
    return;
  }
  if (!upgradeIsPurchaseEligible(definition)) {
    const blockReason = upgradePurchaseBlockReason(definition);
    toast(
      blockReason === 'capacity'
        ? `ЛИМИТ МАСТЕРСКОЙ: ${WORKSHOP_FIRST_RANK_CAP} НОВЫХ УЗЛА ЗА СМЕНУ`
        : 'НОВЫЙ УЗЕЛ БУДЕТ ГОТОВ ПОСЛЕ СЛЕДУЮЩЕЙ СМЕНЫ',
      'warning',
    );
    sound.tone(105, 0.09, 'square', 0.022, -18);
    return;
  }
  let level = startingLevel;
  let purchased = 0;
  const buyMaximum = Boolean(options.maxAffordable);
  while (level < definition.maxLevel) {
    const recipe = getUpgradeRecipe(definition, level);
    if (!canAffordRecipe(save.inventory, recipe)) break;
    if (!spendRecipe(save.inventory, recipe)) break;
    level += 1;
    purchased += 1;
    save.levels[definition.id] = level;
    if (!buyMaximum) break;
  }
  if (purchased <= 0) {
    const recipe = getUpgradeRecipe(definition, level);
    const missing = Object.entries(recipe)
      .filter(([oreId, amount]) => (save.inventory[oreId] || 0) < amount)
      .map(([oreId, amount]) => `${oreById.get(oreId)?.name || oreId} ${amount - (save.inventory[oreId] || 0)}`)
      .join(' · ');
    toast(`НЕ ХВАТАЕТ: ${missing.toUpperCase()}`, 'warning');
    sound.tone(85, 0.08, 'square', 0.025, -20);
    return;
  }
  if (startingLevel === 0) registerWorkshopFirstRank(definition);
  if (startingLevel === 0 && definition.id === 'gadgets_powder_pocket') {
    save.pendingShowcases = { ...(save.pendingShowcases || {}), bomb: true };
  }
  stats = normalizeStats(calculateMetaStats(save.levels));
  if (!stats.oreFocusUnlocked) save.focusedOreId = null;
  // Once an unpinned node is finished, keep the "next breakthrough" panel
  // useful by advancing selection to the next available incomplete node.
  if (level >= definition.maxLevel && save.pinnedUpgradeId !== definition.id) {
    state.selectedUpgradeId = null;
  }
  persistSave();
  sound.tone(330, 0.12, 'triangle', 0.04, 210);
  flash('#68e0c1', 0.18);
  toast(`${definition.name.toUpperCase()} · УР. ${level}${purchased > 1 ? ` · +${purchased}` : ''}`, 'success');
  showTutorial(
    'first_upgrade',
    'УЗЕЛ УСТАНОВЛЕН',
    'Апгрейды постоянны и действуют со следующей смены. Некоторые узлы многоуровневые, а сложные требуют несколько родительских веток.',
    'Запас руды сверху показывает все ресурсы; название появляется при наведении.',
  );
  if (startingLevel === 0) showUpgradeCeremony(definition);
  renderUpgrades();
  if (!campaignWasReady && getCampaignProgress().ready) {
    toast('РАКЕТА ГОТОВА — ЗАВЕРШИТЕ СМЕНУ', 'success');
  }
}

function categoryLabel(category) {
  return ({
    core: 'Путь',
    sense: 'Чутьё',
    dig: 'Копка',
    power: 'Сила',
    time: 'Время',
    gadgets: 'Техника',
    tools: 'Инструменты',
    fortune: 'Удача',
  })[category] || category;
}

function requirementNames(definition) {
  const names = (definition.requires || []).map((requirement) => {
    const id = typeof requirement === 'string' ? requirement : requirement.id;
    const level = typeof requirement === 'string' ? 1 : (requirement.level || 1);
    const parent = UPGRADE_DEFS.find((item) => item.id === id);
    return `${parent?.name || id}${level > 1 ? ` ${level}` : ''}`;
  });
  if (definition.requiresOreDiscovery) {
    const ore = oreById.get(definition.requiresOreDiscovery);
    names.push(`образец «${ore?.name || definition.requiresOreDiscovery}»`);
  }
  return names.join(', ');
}

function upgradeIsAvailable(definition) {
  return requirementsMet(definition) && getUpgradeLevel(definition) < definition.maxLevel;
}

function upgradeIsPreview(definition) {
  if (getUpgradeLevel(definition) > 0 || requirementsMet(definition)) return false;
  const requirements = definition.requires || [];
  if (!requirements.length) return false;
  return requirements.every((requirement) => {
    const id = typeof requirement === 'string' ? requirement : requirement.id;
    const needed = typeof requirement === 'string' ? 1 : (requirement.level || 1);
    if ((save.levels[id] || 0) >= needed) return true;
    const parent = upgradeById.get(id);
    return Boolean(parent && upgradeIsAvailable(parent));
  });
}

function getVisibleUpgradeDefinitions() {
  return UPGRADE_DEFS.filter((definition) => (
    getUpgradeLevel(definition) > 0
    || upgradeIsAvailable(definition)
    || upgradeIsPreview(definition)
  ));
}

function separateUpgradeNodeBoxes(positions) {
  const nodes = UPGRADE_DEFS
    .map((definition) => ({
      definition,
      position: positions.get(definition.id),
      size: getUpgradeNodeSize(definition),
      locked: definition.id === 'core_first_descent' || definition.id === CAMPAIGN.finalUpgrade,
    }))
    .filter((node) => node.position);

  // The polar slots make the branch silhouette; this short relaxation only
  // opens the last few pixel-tight contacts between rectangular icon cards.
  // Moving along the shallower overlap axis preserves each node's radial lobe
  // much better than increasing every ring and leaving large empty bands.
  for (let pass = 0; pass < 80; pass += 1) {
    let adjusted = false;
    for (let left = 0; left < nodes.length; left += 1) {
      for (let right = left + 1; right < nodes.length; right += 1) {
        const a = nodes[left];
        const b = nodes[right];
        const deltaX = (b.position.x + b.size.width * 0.5) - (a.position.x + a.size.width * 0.5);
        const deltaY = (b.position.y + b.size.height * 0.5) - (a.position.y + a.size.height * 0.5);
        const overlapX = (a.size.width + b.size.width) * 0.5 + UPGRADE_NODE_GAP - Math.abs(deltaX);
        const overlapY = (a.size.height + b.size.height) * 0.5 + UPGRADE_NODE_GAP - Math.abs(deltaY);
        if (overlapX <= 0 || overlapY <= 0 || (a.locked && b.locked)) continue;

        const useX = overlapX <= overlapY;
        const direction = (useX ? deltaX : deltaY) >= 0 ? 1 : -1;
        const distance = (useX ? overlapX : overlapY) + 0.05;
        const aShare = a.locked ? 0 : (b.locked ? 1 : 0.5);
        const bShare = b.locked ? 0 : (a.locked ? 1 : 0.5);
        if (useX) {
          a.position.x -= direction * distance * aShare;
          b.position.x += direction * distance * bShare;
        } else {
          a.position.y -= direction * distance * aShare;
          b.position.y += direction * distance * bShare;
        }
        adjusted = true;
      }
    }
    if (!adjusted) break;
  }
}

function getUpgradeLayout() {
  if (upgradeLayoutCache) return upgradeLayoutCache;
  const depthById = new Map();
  const visiting = new Set();
  const getDepth = (definition) => {
    if (depthById.has(definition.id)) return depthById.get(definition.id);
    if (visiting.has(definition.id)) return 0;
    visiting.add(definition.id);
    const parents = (definition.requires || [])
      .map((requirement) => upgradeById.get(typeof requirement === 'string' ? requirement : requirement.id))
      .filter(Boolean);
    const depth = parents.length ? 1 + Math.max(...parents.map(getDepth)) : 0;
    visiting.delete(definition.id);
    depthById.set(definition.id, depth);
    return depth;
  };
  UPGRADE_DEFS.forEach(getDepth);

  // Categories still define the broad direction of a branch, while layoutLobe
  // lets cross-discipline nodes grow inside another branch. Nothing is split
  // into labelled rows: the whole graph grows concentrically from one root.
  const branchDefinitions = UPGRADE_DEFS.filter((definition) => definition.category !== 'core');
  const bucketByLobeDepth = new Map();
  for (const definition of branchDefinitions) {
    const lobe = UPGRADE_LANES.includes(definition.layoutLobe)
      ? definition.layoutLobe
      : definition.category;
    const key = `${lobe}:${depthById.get(definition.id) || 0}`;
    if (!bucketByLobeDepth.has(key)) bucketByLobeDepth.set(key, []);
    bucketByLobeDepth.get(key).push(definition);
  }
  const branchMaxDepth = Math.max(1, ...branchDefinitions.map((definition) => depthById.get(definition.id) || 1));
  const finalRadius = UPGRADE_RING_START + branchMaxDepth * UPGRADE_RING_STEP + 150;
  const maximumRadius = finalRadius + 70;
  const width = Math.ceil((maximumRadius + UPGRADE_MAP_PADDING) * 2);
  const height = width;
  const centerX = width * 0.5;
  const centerY = height * 0.5;
  const positions = new Map();
  for (const [key, definitions] of bucketByLobeDepth) {
    const [lobe, depthText] = key.split(':');
    const depth = Number(depthText);
    definitions.sort((a, b) => UPGRADE_DEFS.indexOf(a) - UPGRADE_DEFS.indexOf(b));
    const baseAngle = -Math.PI * 0.5 + UPGRADE_LANES.indexOf(lobe) * (Math.PI * 2 / UPGRADE_LANES.length);
    const baseRadius = UPGRADE_RING_START + Math.max(0, depth - 1) * UPGRADE_RING_STEP;
    definitions.forEach((definition, index) => {
      let angle;
      let radius;
      if (definitions.length < 4) {
        const slotStep = Math.min(0.44, Math.max(0.13, 88 / baseRadius));
        angle = baseAngle + (index - (definitions.length - 1) * 0.5) * slotStep;
        radius = baseRadius;
      } else {
        const slotStep = Math.min(0.3, Math.max(0.13, 90 / baseRadius));
        const innerCount = Math.ceil(definitions.length / 2);
        const inInnerArc = index < innerCount;
        const arcIndex = inInnerArc ? index : index - innerCount;
        const arcCount = inInnerArc ? innerCount : definitions.length - innerCount;
        const evenRowShift = definitions.length % 2 === 0
          ? slotStep * (inInnerArc ? -0.25 : 0.25)
          : 0;
        angle = baseAngle + (arcIndex - (arcCount - 1) * 0.5) * slotStep + evenRowShift;
        radius = baseRadius + (inInnerArc ? -26 : 26);
      }
      positions.set(definition.id, {
        x: centerX + Math.cos(angle) * radius - UPGRADE_NODE_WIDTH * 0.5,
        y: centerY + Math.sin(angle) * radius - UPGRADE_NODE_HEIGHT * 0.5,
      });
    });
  }
  positions.set('core_first_descent', {
    x: centerX - UPGRADE_NODE_WIDTH * 0.5,
    y: centerY - UPGRADE_NODE_HEIGHT * 0.5,
  });
  positions.set(CAMPAIGN.finalUpgrade, {
    x: centerX - 34,
    y: centerY - finalRadius - 34,
  });
  separateUpgradeNodeBoxes(positions);
  upgradeLayoutCache = {
    positions,
    depthById,
    centerX,
    centerY,
    width,
    height,
  };
  return upgradeLayoutCache;
}

function getUpgradeNodeSize(definition) {
  const finalNode = definition?.id === CAMPAIGN.finalUpgrade;
  return {
    width: finalNode ? 68 : UPGRADE_NODE_WIDTH,
    height: finalNode ? 68 : UPGRADE_NODE_HEIGHT,
  };
}

function recipeMarkup(recipe, compact = false) {
  return Object.entries(recipe).map(([oreId, amount]) => {
    const ore = oreById.get(oreId);
    const met = (save.inventory[oreId] || 0) >= amount;
    const label = compact ? (ore?.name || oreId).slice(0, 3).toUpperCase() : (ore?.name || oreId);
    return `<span class="recipe-chip${compact ? ' is-compact' : ''} ${met ? 'is-met' : 'is-missing'}" data-ore="${oreId}" title="${ore?.name || oreId}; в запасе: ${formatNumber(save.inventory[oreId] || 0)}">${label} ×${amount}</span>`;
  }).join('');
}

function renderNextBreakthrough() {
  if (!ui.nextBreakthrough) return;
  const mobileControls = usesMobileUpgradeControls();
  const pinned = save.pinnedUpgradeId ? upgradeById.get(save.pinnedUpgradeId) : null;
  if (save.pinnedUpgradeId && !pinned) save.pinnedUpgradeId = null;
  const selected = state.selectedUpgradeId ? upgradeById.get(state.selectedUpgradeId) : null;
  const visible = getVisibleUpgradeDefinitions();
  const definition = (mobileControls ? selected : pinned)
    || (mobileControls ? pinned : selected)
    || visible.find(upgradeIsPurchaseEligible)
    || visible.find(upgradeIsAvailable)
    || null;
  const level = definition ? getUpgradeLevel(definition) : 0;
  const complete = Boolean(definition && level >= definition.maxLevel);
  const purchaseEligible = Boolean(definition && upgradeIsPurchaseEligible(definition));
  const pending = Boolean(definition && !complete && requirementsMet(definition) && !purchaseEligible);
  const pendingReason = pending ? upgradePurchaseBlockReason(definition) : null;
  const ready = Boolean(definition && !complete && purchaseEligible
    && canAffordRecipe(save.inventory, getUpgradeRecipe(definition, level)));
  let need = 'Нажмите на модуль в дереве, чтобы следить за его ценой.';
  if (definition) {
    if (complete) {
      need = 'Модуль полностью установлен.';
    } else if (!requirementsMet(definition)) {
      need = `Сначала: ${requirementNames(definition) || 'откройте предыдущий слой'}.`;
    } else if (pending) {
      need = pendingReason === 'capacity'
        ? `Мастерская занята: запущено новых узлов ${WORKSHOP_FIRST_RANK_CAP}/${WORKSHOP_FIRST_RANK_CAP}. Завершите смену; уровни уже начатых узлов остаются доступны.`
        : 'Узел открыт. Завершите одну смену, чтобы подготовить его к установке.';
    } else {
      const recipe = getUpgradeRecipe(definition, level);
      const missing = Object.entries(recipe)
        .filter(([oreId, amount]) => (save.inventory[oreId] || 0) < amount)
        .map(([oreId, amount]) => `${oreById.get(oreId)?.name || oreId} ×${amount - (save.inventory[oreId] || 0)}`);
      need = missing.length ? `Не хватает: ${missing.join(' · ')}.` : 'Руда собрана — модуль можно установить.';
    }
  }
  if (ui.nextBreakthroughName) {
    ui.nextBreakthroughName.textContent = definition
      ? `${definition.name.toUpperCase()} · ${level}/${definition.maxLevel}`
      : 'ВЫБЕРИТЕ УЗЕЛ';
  }
  if (ui.nextBreakthroughNeed) ui.nextBreakthroughNeed.textContent = need;
  ui.nextBreakthrough.classList.toggle('is-ready', ready);
  ui.nextBreakthrough.classList.toggle('is-complete', complete);
  ui.nextBreakthrough.classList.toggle('is-pending', pending);
  const selectedDiffers = Boolean(pinned && selected && selected.id !== pinned.id);
  if (ui.pinSelectedUpgrade) {
    ui.pinSelectedUpgrade.disabled = !selected && !pinned;
    ui.pinSelectedUpgrade.classList.toggle('is-pinned', Boolean(pinned));
    ui.pinSelectedUpgrade.textContent = selectedDiffers ? 'СМЕНИТЬ ЦЕЛЬ' : pinned ? 'СНЯТЬ ЦЕЛЬ' : 'ЗАКРЕПИТЬ';
    ui.pinSelectedUpgrade.title = selectedDiffers
      ? `Закрепить «${selected.name}» вместо «${pinned.name}»`
      : pinned
        ? `Перестать следить за «${pinned.name}»`
        : selected
          ? `Следить за «${selected.name}» между сменами`
          : 'Сначала выберите узел дерева';
  }
  if (ui.buyMaxSelectedUpgrade) {
    ui.buyMaxSelectedUpgrade.disabled = !definition || complete || !purchaseEligible || !ready;
    ui.buyMaxSelectedUpgrade.dataset.upgradeId = definition?.id || '';
    ui.buyMaxSelectedUpgrade.dataset.purchaseMode = mobileControls ? 'single' : 'max';
    ui.buyMaxSelectedUpgrade.textContent = mobileControls ? 'КУПИТЬ' : 'КУПИТЬ MAX';
    ui.buyMaxSelectedUpgrade.title = definition
      ? ready
        ? mobileControls
          ? `Купить следующий уровень «${definition.name}»`
          : `Купить все доступные уровни «${definition.name}»`
        : need
      : 'Сначала выберите узел дерева';
  }
}

function oreBreakdownEntries(bag = {}) {
  return ORE_TYPES
    .map((ore) => ({ ore, amount: Math.max(0, Math.floor(Number(bag[ore.id]) || 0)) }))
    .filter((entry) => entry.amount > 0);
}

function oreBreakdownText(bag = {}) {
  const entries = oreBreakdownEntries(bag);
  return entries.length
    ? entries.map(({ ore, amount }) => `${ore.name} ×${formatNumber(amount)}`).join(' · ')
    : 'ПОКА ПУСТО';
}

function averageOreBreakdownText(bag = {}) {
  const entries = ORE_TYPES
    .map((ore) => ({ ore, amount: Math.max(0, Number(bag[ore.id]) || 0) }))
    .filter((entry) => entry.amount >= 0.01);
  return entries.length
    ? entries.map(({ ore, amount }) => `${ore.name} ×${amount.toFixed(1)}`).join(' · ')
    : 'ПОКА ПУСТО';
}

function oreBreakdownMarkup(bag = {}) {
  const entries = oreBreakdownEntries(bag);
  if (!entries.length) return '<span class="result-ore-chip is-empty" role="listitem">ПОКА ПУСТО</span>';
  return entries.map(({ ore, amount }) => (
    `<span class="result-ore-chip" data-ore="${ore.id}" role="listitem" title="${ore.name}">${ore.name} ×${formatNumber(amount)}</span>`
  )).join('');
}

function renderUpgrades() {
  if (!ui.upgradeNodes || !ui.upgradeWorld || !ui.upgradeEdges) return;
  const previousVisible = state.visibleUpgradeIds;
  const visible = getVisibleUpgradeDefinitions();
  const visibleIds = new Set(visible.map((definition) => definition.id));
  const newlyVisible = [...visibleIds].filter((id) => !previousVisible.has(id));
  state.visibleUpgradeIds = visibleIds;
  const previousAvailable = state.availableUpgradeIds;
  const availableIds = new Set(visible.filter(upgradeIsPurchaseEligible).map((definition) => definition.id));
  const newlyAvailable = [...availableIds].filter((id) => !previousAvailable.has(id));
  state.availableUpgradeIds = availableIds;
  if (!state.selectedUpgradeId || !visibleIds.has(state.selectedUpgradeId)) {
    const root = visible.find((definition) => definition.id === 'core_first_descent');
    const orderedAvailable = visible
      .filter(upgradeIsPurchaseEligible)
      .sort((left, right) => UPGRADE_LANES.indexOf(left.category) - UPGRADE_LANES.indexOf(right.category));
    const pending = visible.find(upgradeIsAvailable);
    state.selectedUpgradeId = orderedAvailable[0]?.id || pending?.id || root?.id || visible[0]?.id || null;
  }

  const layout = getUpgradeLayout();
  const mapWidth = Math.max(ui.upgradeViewport?.clientWidth || 0, layout.width);
  ui.upgradeWorld.style.setProperty('--map-width', `${mapWidth}px`);
  ui.upgradeWorld.style.setProperty('--map-height', `${layout.height}px`);
  ui.upgradeLanes?.replaceChildren();

  const query = state.upgradeQuery.trim().toLocaleLowerCase('ru');
  const mobileControls = usesMobileUpgradeControls();
  let matchingNodes = 0;
  const nodeFragment = document.createDocumentFragment();
  for (const definition of visible) {
    const level = getUpgradeLevel(definition);
    const atMax = level >= definition.maxLevel;
    const unlocked = upgradeIsAvailable(definition);
    const available = upgradeIsPurchaseEligible(definition);
    const pending = unlocked && !available && !atMax;
    const pendingReason = pending ? upgradePurchaseBlockReason(definition) : null;
    const preview = upgradeIsPreview(definition);
    const owned = level > 0;
    const recipe = atMax ? {} : getUpgradeRecipe(definition, level);
    const affordable = available && canAffordRecipe(save.inventory, recipe);
    const searchMatch = !query || `${definition.name} ${definition.description}`.toLocaleLowerCase('ru').includes(query);
    const categoryMatch = true;
    if (searchMatch && categoryMatch) matchingNodes += 1;
    const position = layout.positions.get(definition.id);
    const node = document.createElement('button');
    node.type = 'button';
    node.className = [
      'upgrade-node',
      definition.id === 'core_first_descent' ? 'is-root' : '',
      definition.id === CAMPAIGN.finalUpgrade ? 'is-final' : '',
      available ? 'is-available' : '',
      affordable ? 'is-affordable' : '',
      pending ? 'is-pending' : '',
      preview ? 'is-preview' : '',
      owned ? 'is-owned' : '',
      atMax ? 'is-maxed' : '',
      state.selectedUpgradeId === definition.id ? 'is-selected' : '',
      save.pinnedUpgradeId === definition.id ? 'is-pinned' : '',
      !searchMatch || !categoryMatch ? 'is-dimmed' : '',
      newlyVisible.includes(definition.id) ? 'is-new' : '',
    ].filter(Boolean).join(' ');
    node.dataset.upgradeId = definition.id;
    node.dataset.category = definition.category;
    node.dataset.state = atMax ? 'maxed' : preview ? 'preview' : pending ? 'pending' : owned ? 'owned' : 'available';
    if (pendingReason) node.dataset.pendingReason = pendingReason;
    if (available && !atMax) node.dataset.buyUpgrade = definition.id;
    if (position.x + getUpgradeNodeSize(definition).width * 0.5 > layout.centerX) node.dataset.tooltipSide = 'left';
    node.style.setProperty('--node-x', `${position.x}px`);
    node.style.setProperty('--node-y', `${position.y}px`);
    const requirements = definition.requires?.length
      ? `Требуется: ${requirementNames(definition)}`
      : 'Единая стартовая точка';
    const priceText = atMax
      ? 'установлено'
      : Object.entries(recipe).map(([oreId, amount]) => `${oreById.get(oreId)?.name || oreId} ×${amount}`).join(', ');
    const actionHint = atMax
      ? 'Модуль установлен'
      : preview
        ? `Сначала откройте: ${requirementNames(definition)}`
        : pending
          ? pendingReason === 'capacity'
            ? `Лимит мастерской исчерпан: за одну паузу можно запустить ${WORKSHOP_FIRST_RANK_CAP} новых узла. Завершите смену; уже начатые узлы можно улучшать без ограничения`
            : 'Узел открыт — завершите одну смену, чтобы подготовить его к установке'
        : affordable
          ? mobileControls
            ? 'Выберите узел и нажмите «Купить»'
            : `Нажмите, чтобы установить${definition.maxLevel - level > 1 ? '; Shift + клик — купить максимум' : ''}`
          : 'Не хватает руды — недостающие позиции отмечены красным';
    node.setAttribute('aria-label', `${definition.name}. ${definition.description}. Уровень ${level} из ${definition.maxLevel}. ${requirements}. ${priceText}. ${actionHint}`);
    node.innerHTML = `
      <span class="upgrade-node__icon" aria-hidden="true">${definition.icon || '◆'}</span>
      <span class="upgrade-node__level">${atMax && definition.maxLevel === 1 ? '✓' : `${level}/${definition.maxLevel}`}</span>
      <span class="upgrade-node__tooltip" role="tooltip">
        <strong class="tooltip__title">${definition.name}</strong>
        <span class="tooltip__description">${definition.description}</span>
        <span class="tooltip__requirements">${requirements}</span>
        <span class="tooltip__recipe">${atMax ? '<span class="upgrade-installed">УСТАНОВЛЕНО</span>' : recipeMarkup(recipe)}</span>
        <span class="tooltip__hint">${actionHint}</span>
      </span>
    `;
    nodeFragment.append(node);
  }
  ui.upgradeNodes.replaceChildren(nodeFragment);

  const svgNamespace = 'http://www.w3.org/2000/svg';
  const defs = ui.upgradeEdges.querySelector('defs')?.cloneNode(true);
  ui.upgradeEdges.replaceChildren();
  if (defs) ui.upgradeEdges.append(defs);
  ui.upgradeEdges.setAttribute('viewBox', `0 0 ${mapWidth} ${layout.height}`);
  for (const child of visible) {
    const childPosition = layout.positions.get(child.id);
    for (const requirement of child.requires || []) {
      const parentId = typeof requirement === 'string' ? requirement : requirement.id;
      if (!visibleIds.has(parentId)) continue;
      const parent = upgradeById.get(parentId);
      const parentPosition = layout.positions.get(parentId);
      const requiredLevel = typeof requirement === 'string' ? 1 : (requirement.level || 1);
      const complete = (save.levels[parentId] || 0) >= requiredLevel;
      const path = document.createElementNS(svgNamespace, 'path');
      const parentSize = getUpgradeNodeSize(parent);
      const childSize = getUpgradeNodeSize(child);
      const parentCenterX = parentPosition.x + parentSize.width * 0.5;
      const parentCenterY = parentPosition.y + parentSize.height * 0.5;
      const childCenterX = childPosition.x + childSize.width * 0.5;
      const childCenterY = childPosition.y + childSize.height * 0.5;
      const lineLength = Math.max(1, Math.hypot(childCenterX - parentCenterX, childCenterY - parentCenterY));
      const unitX = (childCenterX - parentCenterX) / lineLength;
      const unitY = (childCenterY - parentCenterY) / lineLength;
      const x1 = parentCenterX + unitX * parentSize.width * 0.46;
      const y1 = parentCenterY + unitY * parentSize.height * 0.46;
      const x2 = childCenterX - unitX * childSize.width * 0.46;
      const y2 = childCenterY - unitY * childSize.height * 0.46;
      const bend = lineLength * 0.34;
      path.setAttribute('d', `M ${x1} ${y1} C ${x1 + unitX * bend} ${y1 + unitY * bend}, ${x2 - unitX * bend} ${y2 - unitY * bend}, ${x2} ${y2}`);
      path.classList.add('upgrade-edge', complete ? 'is-complete' : 'is-preview');
      if (parent?.category !== child.category) path.classList.add('is-cross-category');
      if (state.selectedUpgradeId === child.id || state.selectedUpgradeId === parentId) path.classList.add('is-focused');
      ui.upgradeEdges.append(path);
    }
  }

  renderOreInventory();
  renderOreFocusPanel();
  renderNextBreakthrough();
  $('#upgradeEmpty')?.classList.toggle('hidden', matchingNodes > 0);
  const bought = countPurchasedLevels(save.levels);
  const totalLevels = UPGRADE_DEFS.reduce((sum, definition) => sum + definition.maxLevel, 0);
  const campaign = getCampaignProgress();
  if (ui.upgradeProgress) ui.upgradeProgress.textContent = `${bought} / ${totalLevels} ур. · ракета ${campaign.percent}%`;
  const miniProgress = ui.upgradeProgress?.closest('.upgrade-progress-wrap')?.querySelector('.mini-progress i');
  if (miniProgress) miniProgress.style.width = `${clamp(bought / totalLevels, 0, 1) * 100}%`;
  $$('.filter-btn[data-category]').forEach((button) => button.classList.toggle('is-active', button.dataset.category === state.upgradeFilter));
  if (ui.upgradeLive) {
    const installStatus = workshopInstallStatus();
    ui.upgradeLive.textContent = newlyAvailable.length
      ? `Доступно для установки новых узлов: ${newlyAvailable.length}`
      : installStatus.remaining <= 0
        ? `Лимит мастерской: ${installStatus.installed}/${installStatus.cap} новых узлов. Следующая смена освободит места.`
        : '';
  }
}

function scrollUpgradeIntoView(definition, smooth = true) {
  if (!definition || !ui.upgradeViewport) return;
  const position = getUpgradeLayout().positions.get(definition.id);
  if (!position) return;
  const size = getUpgradeNodeSize(definition);
  const left = Math.max(0, position.x + size.width * 0.5 - ui.upgradeViewport.clientWidth * 0.5);
  const top = Math.max(0, position.y + size.height * 0.5 - ui.upgradeViewport.clientHeight * 0.5);
  if (typeof ui.upgradeViewport.scrollTo === 'function') {
    ui.upgradeViewport.scrollTo({ left, top, behavior: smooth ? 'smooth' : 'auto' });
  } else {
    ui.upgradeViewport.scrollLeft = left;
    ui.upgradeViewport.scrollTop = top;
  }
}

function updateHud() {
  const duration = Math.max(0.01, stats.runDuration);
  const displayedTime = Math.max(0, Math.min(state.timeLeft, getBonusRunCap() - state.activeWallElapsed));
  const chronoOverflow = stats.chronoOverdrive ? Math.max(0, state.chronoOverflowRemaining || 0) : 0;
  if (ui.timerValue) {
    ui.timerValue.textContent = `${displayedTime.toFixed(1)}${chronoOverflow > 0 ? ' ⚡' : ''}`;
    ui.timerValue.title = chronoOverflow > 0 ? `Хронофорсаж: ${chronoOverflow.toFixed(1)} с` : '';
  }
  if (ui.timerFill) {
    const fraction = clamp(displayedTime / duration, 0, 1);
    ui.timerFill.style.transform = `scaleX(${fraction})`;
    ui.timerFill.classList.toggle('is-danger', fraction < 0.28);
    ui.timerFill.classList.toggle('is-bonus', state.bonusTimeEarned > 0 && displayedTime > Math.max(0, duration - state.activeWallElapsed));
    ui.timerFill.classList.toggle('is-overdrive', chronoOverflow > 0);
  }
  const timerTrack = ui.timerFill?.parentElement;
  timerTrack?.setAttribute('aria-valuemax', String(getBonusRunCap()));
  timerTrack?.setAttribute('aria-valuenow', displayedTime.toFixed(1));
  if (ui.runOre) {
    ui.runOre.textContent = formatNumber(state.runOre);
    const types = state.discoveredOreIds?.size || 0;
    const catalogMultiplier = 1 + Math.max(0, types - 1) * (stats.oreDiversityBonusPerType || 0);
    ui.runOre.title = types > 0
      ? `Найдено типов: ${types}${catalogMultiplier > 1 ? ` · итоговый каталог ×${catalogMultiplier.toFixed(2)}` : ''}`
      : 'Добыча текущего забега';
  }
  if (ui.runOreBreakdown) ui.runOreBreakdown.textContent = oreBreakdownText(state.oreCounts);
  if (ui.depthValue) ui.depthValue.textContent = `${Math.floor(state.deepest)} м`;
  if (ui.toolValue) {
    ui.toolValue.textContent = TOOL_NAMES[stats.tool] || (stats.laserUnlocked ? 'ЛАЗЕР' : 'КИРКА');
  }
  if (ui.comboValue) {
    ui.comboValue.textContent = state.combo > 1 ? `×${state.combo}` : '—';
    ui.comboValue.classList.toggle('is-hot', state.combo >= 4);
  }
  updateFocusHud();
}

function procChance(baseChance = 0, luckWeight = 0.22) {
  return clamp((baseChance || 0) + (stats.luck || 0) * luckWeight + (stats.fortuneProcChance || 0), 0, 0.95);
}

function relicDigMultiplier() {
  return state.relicDigBoostRemaining > 0 ? 1 + Math.max(0.12, stats.relicEffectPower || 0) : 1;
}

function relicYieldMultiplier() {
  return state.relicYieldBoostRemaining > 0 ? 1 + Math.max(0.12, stats.relicEffectPower || 0) : 1;
}

function relicGadgetMultiplier() {
  return state.relicGadgetBoostRemaining > 0 ? 1 + Math.max(0.12, stats.relicEffectPower || 0) : 1;
}

function activateRelicEffect(x, y, fromChest = false) {
  if (!(stats.relicEffectChance > 0)) return false;
  const baseDuration = Math.max(3, stats.relicEffectDuration || 6);
  const duration = fromChest ? baseDuration + 2 : baseDuration;
  const labels = ['РЕЛИКВИЯ: ВТОРОЙ ЛУЧ', 'РЕЛИКВИЯ: МЯГКАЯ ПОРОДА', 'РЕЛИКВИЯ: ХРОНОЗАРЯД', 'РЕЛИКВИЯ: УСИЛЕННЫЙ СУНДУК'];
  const colors = ['#8ff8ef', '#ffbb77', '#ffe58d', '#92eaff'];
  const effectIndex = state.relicEffectIndex % labels.length;
  state.relicEffectIndex = (state.relicEffectIndex + 1) % labels.length;
  if (fromChest) {
    state.relicSecondBeamRemaining = Math.max(state.relicSecondBeamRemaining, duration);
    state.eventSoftRockRemaining = Math.max(state.eventSoftRockRemaining, duration);
    state.relicSoftRockRemaining = Math.max(state.relicSoftRockRemaining, duration);
    state.relicYieldBoostRemaining = Math.max(state.relicYieldBoostRemaining, duration);
  } else if (effectIndex === 0) {
    state.relicSecondBeamRemaining = Math.max(state.relicSecondBeamRemaining, duration);
  } else if (effectIndex === 1) {
    state.eventSoftRockRemaining = Math.max(state.eventSoftRockRemaining, duration);
    state.relicSoftRockRemaining = Math.max(state.relicSoftRockRemaining, duration);
  } else if (effectIndex === 2) {
    addBonusTime(0.4 + Math.min(0.4, stats.relicEffectPower || 0), x, y - 36, 'РЕЛИКВИЯ');
  } else {
    state.relicChestBoostCharges = Math.min(2, state.relicChestBoostCharges + 1);
  }
  state.metrics.relicEffects += 1;
  const label = fromChest ? 'РЕЛИКВИЯ ИЗ СУНДУКА · ВСЕ БОНУСЫ' : labels[effectIndex];
  state.floaters.push({ x, y: y - 34, text: label, color: fromChest ? '#fff2a6' : colors[effectIndex], life: 1.2, maxLife: 1.2 });
  toast(label, 'success');
  sound.tone(fromChest ? 520 : 410 + effectIndex * 80, 0.18, 'sine', 0.035, 180);
  return true;
}

function activeMagneticField() {
  const field = state.magneticField;
  if (!field || field.remaining <= 0 || field.radius <= 0) return null;
  return field;
}

function revealMagneticFieldOres(field) {
  if (!field || !state.world) return 0;
  const min = state.world.worldToTile(field.x - field.radius, field.y - field.radius);
  const max = state.world.worldToTile(field.x + field.radius, field.y + field.radius);
  let revealed = 0;
  for (let ty = Math.max(0, min.ty); ty <= Math.min(WORLD_CONFIG.HEIGHT - 1, max.ty); ty += 1) {
    for (let tx = Math.max(0, min.tx); tx <= Math.min(WORLD_CONFIG.WIDTH - 1, max.tx); tx += 1) {
      const tile = state.world.getTile(tx, ty);
      if (!tile?.oreId || tile.kind === 'air') continue;
      const x = (tx + 0.5) * TILE_SIZE;
      const y = (ty + 0.5) * TILE_SIZE;
      if (distance(x, y, field.x, field.y) > field.radius) continue;
      tile.discovered = true;
      tile.sensedUntil = Math.max(tile.sensedUntil || 0, state.elapsed + field.maxDuration);
      revealed += 1;
    }
  }
  if (revealed > 0) state.ping = 1;
  return revealed;
}

function magneticGadgetMultiplier(x, y) {
  const field = activeMagneticField();
  const inside = field && distance(x, y, field.x, field.y) <= field.radius + TILE_SIZE;
  return relicGadgetMultiplier() * (inside ? 1 + stats.magneticFieldTargetingBonus : 1);
}

function temporalOverclockMultiplier() {
  let multiplier = 1;
  if (stats.chronoOverclock) {
    multiplier += (stats.startTimeFreeze || 0) * 0.025
      + (stats.timerDrainReduction || 0) * 0.28
      + (stats.timeRefundChance || 0) * 0.25
      + (stats.timeShardChance || 0) * 0.18
      + (stats.lastChanceCharges || 0) * 0.03;
  }
  if (stats.chronoOverdrive && state.chronoOverflowRemaining > 0) {
    multiplier += stats.chronoOverflowSpeedBonus || 0;
  }
  return multiplier;
}

function dronesAreActive() {
  if (!stats.droneUnlocked || (stats.droneCount || 0) <= 0) return false;
  const lifetimeShare = clamp(stats.droneLifetime || 0, 0, 1);
  // A fully upgraded battery promises autonomy for the whole shift. Bonus
  // seconds are still part of that shift, so the drones must not silently
  // switch off at the direct 45-second timer cap.
  if (lifetimeShare >= 1) {
    return state.mode === 'run'
      && state.timeLeft > 0
      && state.activeWallElapsed < getBonusRunCap();
  }
  const availableFor = stats.runDuration * lifetimeShare;
  return state.elapsed <= availableFor;
}

function oreRank(ore) {
  return Math.max(0, ORE_TYPES.findIndex((item) => item.id === ore?.id));
}

function hardnessPierceMultiplier(target, pierce = stats.hardnessPierce) {
  const ore = typeof target === 'string'
    ? oreById.get(target)
    : target?.oreId
      ? oreById.get(target.oreId)
      : target?.hardness
        ? target
        : null;
  const amount = Math.max(0, Number(pierce) || 0);
  if (!ore || amount <= 0) return 1;
  const maximumDensity = Math.max(1, ...ORE_TYPES.map((candidate) => candidate.hardness || 1));
  const density = Math.max(1, ore.hardness || 1);
  const normalizedDensity = maximumDensity > 1
    ? clamp(Math.log(density) / Math.log(maximumDensity), 0, 1)
    : 0;
  // Even soft ore has a little structure to pierce, while dense late ores
  // expose the full benefit. Ordinary dirt/stone deliberately returns 1.
  const densityWeight = 0.25 + normalizedDensity * 0.75;
  return 1 + amount * 0.07 * densityWeight;
}

function collectVeinRemainingCounts() {
  const counts = new Map();
  if (!state.world) return counts;
  const countTile = (tile) => {
    if (!tile?.oreId || !tile.veinId || tile.kind === 'air' || tile.kind === 'bedrock') return;
    counts.set(tile.veinId, (counts.get(tile.veinId) || 0) + 1);
  };
  if (typeof state.world.forEachOreTileInBounds === 'function') {
    state.world.forEachOreTileInBounds(0, 0, WORLD_CONFIG.WIDTH - 1, WORLD_CONFIG.HEIGHT - 1, countTile);
  } else {
    for (let ty = 0; ty < WORLD_CONFIG.HEIGHT; ty += 1) {
      for (let tx = 0; tx < WORLD_CONFIG.WIDTH; tx += 1) countTile(state.world.getTile(tx, ty));
    }
  }
  return counts;
}

function remainingVeinNodes(veinId) {
  if (!veinId) return 0;
  return Math.max(0, state.veinRemainingCounts?.get(veinId) || 0);
}

function decorateRememberedTarget(target, options = {}) {
  if (!target || target.kind !== 'ore') return target;
  if ((stats.ghostTrailDuration || 0) > 0) {
    target.ghostUntil = Math.max(target.ghostUntil || 0, state.elapsed + stats.ghostTrailDuration);
    state.ghostTarget = {
      kind: 'ore',
      tx: target.tx,
      ty: target.ty,
      x: target.x,
      y: target.y,
      ghostUntil: target.ghostUntil,
      lockRadius: target.lockRadius || 0,
    };
  }
  if ((options.echoHold || 0) > 0) {
    target.echoHoldUntil = Math.max(target.echoHoldUntil || 0, state.elapsed + options.echoHold);
  }
  return target;
}

function pruneRememberedVeins(focusedOreId = null) {
  const slots = stats.seismicRouteSlots || 0;
  if (slots <= 0) {
    state.rememberedVeins.length = 0;
    return;
  }
  const seenVeins = new Set();
  state.rememberedVeins = state.rememberedVeins.filter((target) => {
    if (!oreTargetIsValid(target, focusedOreId)) return false;
    const veinId = target.tile?.veinId;
    if (!veinId || seenVeins.has(veinId)) return false;
    seenVeins.add(veinId);
    return true;
  }).slice(0, slots);
}

function rememberSeismicRoutes(targets, primary, focusedOreId = null) {
  const slots = stats.seismicRouteSlots || 0;
  if (slots <= 0) return;
  pruneRememberedVeins(focusedOreId);
  const primaryVeinId = primary?.tile?.veinId || null;
  const merged = [...state.rememberedVeins];
  const known = new Set(merged.map((target) => target.tile?.veinId).filter(Boolean));
  for (const target of targets) {
    const veinId = target?.tile?.veinId;
    if (!veinId || veinId === primaryVeinId || known.has(veinId)) continue;
    known.add(veinId);
    merged.push({ ...target, rememberedRoute: true });
  }
  merged.sort((left, right) => (left.score || Infinity) - (right.score || Infinity));
  state.rememberedVeins = merged.slice(0, slots);
}

function takeRememberedVeinTarget(focusedOreId = null) {
  pruneRememberedVeins(focusedOreId);
  const target = state.rememberedVeins.shift() || null;
  if (!target) return null;
  target.rememberedRoute = true;
  target.lockRadius = Math.max(
    target.lockRadius || 0,
    distance(state.player.x, state.player.y, target.x, target.y) + TILE_SIZE,
  );
  return decorateRememberedTarget(target);
}

function takeGhostTrailTarget(focusedOreId = null) {
  const ghost = state.ghostTarget;
  if (
    !stats.ghostTrailThroughWalls
    || !ghost
    || ghost.ghostUntil < state.elapsed
    || !oreTargetIsValid(ghost, focusedOreId)
  ) return null;
  if (
    (stats.ghostTrailMaxLayers || 0) > 0
    && !hasSenseLine(
      state.player.x,
      state.player.y,
      ghost.x,
      ghost.y,
      stats.ghostTrailMaxLayers,
    )
  ) return null;
  const target = { ...ghost, ghostTrail: true };
  target.lockRadius = Math.max(
    target.lockRadius || 0,
    distance(state.player.x, state.player.y, target.x, target.y) + TILE_SIZE,
  );
  return target;
}

function effectiveSenseRadius() {
  const origin = state.depthOrigin || state.spawn;
  if (!state.player || !origin) return stats.senseRadius;
  const worldProgress = clamp(
    (Math.abs(state.player.x - origin.x) * 0.35 + Math.max(0, state.player.y - origin.y))
      / (WORLD_CONFIG.HEIGHT * TILE_SIZE),
    0,
    1,
  );
  const deepBoost = 1 + (stats.deepOreSenseBonus || 0) * worldProgress;
  return stats.senseRadius * deepBoost;
}

function focusedSenseMultiplier(focusedOre) {
  if (!focusedOre) return 1;
  const delay = Math.max(0, stats.oreFocusEscalationDelay || 0);
  const ramp = delay > 0
    ? clamp((state.focusMissElapsed - delay) / 2, 0, 1)
    : 0;
  return (stats.oreFocusRadiusMultiplier || 1) * (1 + (stats.oreFocusEscalationBonus || 0) * ramp);
}

function hasSenseLine(originX, originY, targetX, targetY, solidLayerLimit = 2) {
  if (stats.senseThroughWalls) return true;
  const dx = targetX - originX;
  const dy = targetY - originY;
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / (TILE_SIZE * 0.45)));
  let lastTx = -1;
  let lastTy = -1;
  let solidLayers = 0;
  for (let index = 1; index < steps - 1; index += 1) {
    const sample = state.world.worldToTile(originX + dx * index / steps, originY + dy * index / steps);
    if (sample.tx === lastTx && sample.ty === lastTy) continue;
    lastTx = sample.tx;
    lastTy = sample.ty;
    const tile = state.world.getTile(sample.tx, sample.ty);
    if (tile && tile.kind !== 'air') solidLayers += 1;
    if (solidLayers > solidLayerLimit) return false;
  }
  return true;
}

function findBestOreTargets(x, y, radius, focusedOreId = null, options = {}, limit = 1) {
  const bias = Math.max(0, stats.targetValueBias || 0);
  const excludedKeys = options.excludedKeys instanceof Set ? options.excludedKeys : new Set(options.excludedKeys || []);
  const center = state.world.worldToTile(x, y);
  const reach = Math.ceil(radius / TILE_SIZE);
  const radiusSquared = radius * radius;
  const resultLimit = clamp(Math.floor(Number(limit) || 1), 1, 12);
  const ranked = [];
  const minTx = Math.max(0, center.tx - reach);
  const maxTx = Math.min(WORLD_CONFIG.WIDTH - 1, center.tx + reach);
  const minTy = Math.max(0, center.ty - reach);
  const maxTy = Math.min(WORLD_CONFIG.HEIGHT - 1, center.ty + reach);

  const consider = (tile, tx, ty) => {
    if (!tile?.oreId || tile.kind === 'air') return;
    if (focusedOreId && tile.oreId !== focusedOreId) return;
    if (options.veinId && tile.veinId !== options.veinId) return;
    if (excludedKeys.has(`${tx}:${ty}`)) return;
    const targetX = (tx + 0.5) * TILE_SIZE;
    const targetY = (ty + 0.5) * TILE_SIZE;
    if (typeof options.predicate === 'function' && !options.predicate({ tile, tx, ty, x: targetX, y: targetY })) return;
    const dx = targetX - x;
    const dy = targetY - y;
    const distanceSquared = dx * dx + dy * dy;
    if (distanceSquared > radiusSquared) return;
    const ore = oreById.get(tile.oreId);
    const valueWeight = 1 + Math.log2(1 + (ore?.value || 1)) * bias;
    const veinSizeWeight = focusedOreId && (stats.focusVeinSizeBias || 0) > 0
      ? 1 + Math.log2(1 + remainingVeinNodes(tile.veinId)) * stats.focusVeinSizeBias
      : 1;
    const distanceToTarget = Math.sqrt(distanceSquared);
    const travelSeconds = distanceToTarget / Math.max(1, stats.moveSpeed * (stats.mineMoveMultiplier || 1));
    const expectedCritical = 1 + procChance(stats.critChance, 0.16) * Math.max(0, stats.critMultiplier - 1);
    const expectedMulti = 1 + Math.max(0, (stats.multiHitCount || 1) - 1) * 0.65 + procChance(stats.multiHitChance, 0.1) * 0.65;
    const rarePower = 1 + (oreRank(ore) >= 4 ? (stats.rareOreDamageBonus || 0) : 0);
    const laserPower = stats.laserUnlocked ? (stats.laserPower || 1) * (1 + Math.max(0, (stats.laserBeams || 1) - 1) * 0.55) : 1;
    const focusedCalibration = focusedOreId ? focusedDamageMultiplier(tile) : 1;
    const effectivePower = stats.pickPower * hardnessPierceMultiplier(tile) * (1 + (stats.oreDamageBonus || 0)) * expectedCritical * expectedMulti * rarePower * laserPower * focusedCalibration;
    const miningSeconds = (tile.hp || 1) / Math.max(0.1, effectivePower * stats.digSpeed);
    const score = (travelSeconds + miningSeconds) / (valueWeight * veinSizeWeight);
    const threshold = ranked.length >= resultLimit ? ranked[ranked.length - 1].score : Infinity;
    if (score >= threshold) return;
    if (!options.ignoreSenseLine && !hasSenseLine(x, y, targetX, targetY, focusedOreId ? 7 : 2)) return;

    const candidate = { kind: 'ore', tile, tx, ty, x: targetX, y: targetY, distance: distanceToTarget, score };
    const insertion = ranked.findIndex((entry) => score < entry.score);
    if (insertion < 0) ranked.push(candidate);
    else ranked.splice(insertion, 0, candidate);
    if (ranked.length > resultLimit) ranked.length = resultLimit;
  };

  if (typeof state.world.forEachOreTileInBounds === 'function') {
    state.world.forEachOreTileInBounds(minTx, minTy, maxTx, maxTy, consider);
  } else {
    for (let ty = minTy; ty <= maxTy; ty += 1) {
      for (let tx = minTx; tx <= maxTx; tx += 1) {
        consider(state.world.getTile(tx, ty), tx, ty);
      }
    }
  }
  return ranked;
}

function findBestOreTarget(x, y, radius, focusedOreId = null, options = {}) {
  return findBestOreTargets(x, y, radius, focusedOreId, options, 1)[0] || null;
}

function oreTargetIsValid(target, focusedOreId = null) {
  if (!target || target.kind !== 'ore') return false;
  const tile = state.world?.getTile(target.tx, target.ty);
  if (!tile?.oreId || tile.kind === 'air' || tile.kind === 'bedrock') return false;
  if (focusedOreId && tile.oreId !== focusedOreId) return false;
  target.tile = tile;
  target.x = (target.tx + 0.5) * TILE_SIZE;
  target.y = (target.ty + 0.5) * TILE_SIZE;
  return true;
}

function chooseOreTargets(x, y, radius, focusedOreId = null) {
  const lockedVeinId = stats.veinLockEnabled && remainingVeinNodes(state.lockedVeinId) > 0
    ? state.lockedVeinId
    : null;
  const trailVeinId = remainingVeinNodes(state.lastBrokenVeinId) > 0
    ? state.lastBrokenVeinId
    : null;
  const preferredVeinId = lockedVeinId || trailVeinId;
  if (preferredVeinId) {
    const rangeMultiplier = lockedVeinId
      ? Math.max(stats.veinLockRangeMultiplier || 1, stats.veinTrailRangeMultiplier || 1)
      : stats.veinTrailRangeMultiplier || 1;
    const veinTargets = findBestOreTargets(
      x,
      y,
      radius * rangeMultiplier,
      focusedOreId,
      { veinId: preferredVeinId, ignoreSenseLine: true },
      (stats.backupTargetSlots || 0) > 0 ? 2 : 1,
    );
    if (veinTargets[0]) {
      const [primary, backup = null] = veinTargets;
      return { primary: decorateRememberedTarget(primary), backup };
    }
    if (lockedVeinId) {
      state.lockedVeinId = null;
      state.lockedVeinOreId = null;
    }
  }

  const routeSampleSize = Math.max(
    (stats.backupTargetSlots || 0) > 0 ? 2 : 1,
    1 + (stats.seismicRouteSlots || 0) * 4,
  );
  const targets = findBestOreTargets(
    x,
    y,
    radius,
    focusedOreId,
    {},
    routeSampleSize,
  );
  const [primary = null, backup = null] = targets;
  const seismicSlots = Math.max(0, stats.seismicRouteSlots || 0);
  const distantRoutes = seismicSlots > 0
    ? findBestOreTargets(
      x,
      y,
      radius * 2.1,
      focusedOreId,
      {
        ignoreSenseLine: true,
        predicate: (candidate) => distance(x, y, candidate.x, candidate.y) > radius + TILE_SIZE * 0.25,
      },
      Math.min(12, seismicSlots * 4),
    )
    : [];
  if (primary) {
    rememberSeismicRoutes([...targets.slice(1), ...distantRoutes], primary, focusedOreId);
    return {
      primary: decorateRememberedTarget(primary),
      backup: (stats.backupTargetSlots || 0) > 0 ? backup : null,
    };
  }
  if (distantRoutes.length) rememberSeismicRoutes(distantRoutes, null, focusedOreId);
  return {
    primary: takeGhostTrailTarget(focusedOreId) || takeRememberedVeinTarget(focusedOreId),
    backup: null,
  };
}

function getTriangulationTriangle() {
  if (!stats.triangularFixUnlocked || !state.player) return null;
  const focusedOreId = getFocusedOre()?.id || null;
  if (!oreTargetIsValid(state.target, focusedOreId) || !oreTargetIsValid(state.backupTarget, focusedOreId)) return null;
  if (distance(state.target.x, state.target.y, state.backupTarget.x, state.backupTarget.y) < TILE_SIZE * 2) return null;
  const triangle = [
    { x: state.player.x, y: state.player.y },
    { x: state.target.x, y: state.target.y },
    { x: state.backupTarget.x, y: state.backupTarget.y },
  ];
  const twiceArea = Math.abs(
    (triangle[1].x - triangle[0].x) * (triangle[2].y - triangle[0].y)
    - (triangle[2].x - triangle[0].x) * (triangle[1].y - triangle[0].y)
  );
  return twiceArea >= TILE_SIZE * TILE_SIZE * 0.65 ? triangle : null;
}

function pointInTriangle(x, y, triangle = getTriangulationTriangle()) {
  if (!triangle) return false;
  const sign = (point, left, right) => (
    (point.x - right.x) * (left.y - right.y)
    - (left.x - right.x) * (point.y - right.y)
  );
  const point = { x, y };
  const d1 = sign(point, triangle[0], triangle[1]);
  const d2 = sign(point, triangle[1], triangle[2]);
  const d3 = sign(point, triangle[2], triangle[0]);
  const hasNegative = d1 < -0.001 || d2 < -0.001 || d3 < -0.001;
  const hasPositive = d1 > 0.001 || d2 > 0.001 || d3 > 0.001;
  return !(hasNegative && hasPositive);
}

function tileInsideTriangulation(tx, ty, triangle = getTriangulationTriangle()) {
  return pointInTriangle((tx + 0.5) * TILE_SIZE, (ty + 0.5) * TILE_SIZE, triangle);
}

function refreshTriangleOreMemory() {
  const triangle = getTriangulationTriangle();
  if (!triangle || !state.world || !(stats.triangularFixOreMemory > 0)) return triangle;
  const xs = triangle.map((point) => point.x / TILE_SIZE);
  const ys = triangle.map((point) => point.y / TILE_SIZE);
  const minTx = clamp(Math.floor(Math.min(...xs)), 0, WORLD_CONFIG.WIDTH - 1);
  const maxTx = clamp(Math.ceil(Math.max(...xs)), 0, WORLD_CONFIG.WIDTH - 1);
  const minTy = clamp(Math.floor(Math.min(...ys)), 0, WORLD_CONFIG.HEIGHT - 1);
  const maxTy = clamp(Math.ceil(Math.max(...ys)), 0, WORLD_CONFIG.HEIGHT - 1);
  const remember = (tile, tx, ty) => {
    if (!tile?.oreId || !tileInsideTriangulation(tx, ty, triangle)) return;
    tile.sensedUntil = Math.max(tile.sensedUntil || 0, state.elapsed + stats.triangularFixOreMemory);
    state.triangleOreMemory.set(`${tx}:${ty}`, state.elapsed + stats.triangularFixOreMemory);
  };
  if (typeof state.world.forEachOreTileInBounds === 'function') {
    state.world.forEachOreTileInBounds(minTx, minTy, maxTx, maxTy, remember);
  } else {
    for (let ty = minTy; ty <= maxTy; ty += 1) {
      for (let tx = minTx; tx <= maxTx; tx += 1) remember(state.world.getTile(tx, ty), tx, ty);
    }
  }
  return triangle;
}

function noteTargetAcquired(target) {
  if (!target) return;
  const key = `${target.kind || 'ore'}:${target.tx}:${target.ty}`;
  if (state.lastMetricTargetKey && state.lastMetricTargetKey !== key) state.metrics.targetSwitches += 1;
  if (state.approachTargetKey && state.approachTargetKey !== key) state.approachTravelElapsed = 0;
  state.approachTargetKey = key;
  state.lastMetricTargetKey = key;
  if (target.kind === 'ore') {
    decorateRememberedTarget(target);
    const veinId = target.tile?.veinId || null;
    if (stats.veinLockEnabled && veinId && (!state.lockedVeinId || remainingVeinNodes(state.lockedVeinId) <= 0)) {
      state.lockedVeinId = veinId;
      state.lockedVeinOreId = target.tile?.oreId || null;
    }
    showTutorial(
      'sense_target',
      'ЧУТЬЁ ВЗЯЛО СЛЕД',
      'Пунктир указывает текущую цель. Если руды рядом нет, шахтёр прокладывает разведочный ход и продолжает искать.',
      'Позже откроются запасная цель и фокус на конкретной руде.',
    );
  }
}

function promoteBackupTarget(focusedOreId = null) {
  if (!oreTargetIsValid(state.backupTarget, focusedOreId)) {
    state.backupTarget = null;
    return false;
  }
  state.target = state.backupTarget;
  state.backupTarget = null;
  state.targetCooldown = 0;
  state.metrics.backupPromotions += 1;
  noteTargetAcquired(state.target);
  refreshCrewBeacon(state.target);
  state.floaters.push({
    x: state.target.x,
    y: state.target.y - 18,
    text: 'ВТОРАЯ ЗАСЕЧКА',
    color: '#7fe9dd',
    life: 0.65,
    maxLife: 0.65,
  });
  return true;
}

function refreshCrewBeacon(target) {
  if (!stats.crewBeaconUnlocked || !oreTargetIsValid(target)) return;
  state.crewBeacon = {
    oreId: target.tile.oreId,
    veinId: target.tile.veinId || null,
    tx: target.tx,
    ty: target.ty,
    x: target.x,
    y: target.y,
    expires: state.elapsed + 2.4,
    validatedAt: state.elapsed,
  };
}

function crewVeinHasLiveTile(beacon) {
  if (!state.world || !beacon?.veinId) return false;
  if (typeof state.world.forEachOreTileInBounds === 'function') {
    let found = false;
    state.world.forEachOreTileInBounds(
      0,
      0,
      WORLD_CONFIG.WIDTH - 1,
      WORLD_CONFIG.HEIGHT - 1,
      (tile) => {
        if (tile.veinId !== beacon.veinId) return true;
        found = true;
        return false;
      },
    );
    return found;
  }
  for (let ty = 0; ty < WORLD_CONFIG.HEIGHT; ty += 1) {
    for (let tx = 0; tx < WORLD_CONFIG.WIDTH; tx += 1) {
      const tile = state.world.getTile(tx, ty);
      if (tile?.veinId === beacon.veinId && tile.kind !== 'air' && tile.kind !== 'bedrock' && tile.oreId) return true;
    }
  }
  return false;
}

function getCrewBeacon(forceValidation = false) {
  const beacon = state.crewBeacon;
  if (!stats.crewBeaconUnlocked || !beacon || beacon.expires < state.elapsed) {
    state.crewBeacon = null;
    return null;
  }
  if (forceValidation || beacon.validatedAt !== state.elapsed) {
    beacon.validatedAt = state.elapsed;
    if (!crewVeinHasLiveTile(beacon)) {
      state.crewBeacon = null;
      return null;
    }
  }
  return beacon;
}

function findBeaconAwareTarget(x, y, radius, focusedOre, beacon, options = {}) {
  const target = findBestOreTarget(
    x,
    y,
    radius,
    beacon?.oreId || focusedOre?.id || null,
    {
      ...options,
      ignoreSenseLine: Boolean(beacon),
      veinId: beacon?.veinId || null,
    },
  );
  if (target || !beacon) return target;

  // A living marked vein can be outside a gadget's local reach. In that case
  // the upgrade must not suppress the chain/drone proc that existed before it.
  return findBestOreTarget(
    x,
    y,
    radius,
    focusedOre?.id || null,
    { ...options, ignoreSenseLine: false, veinId: null },
  );
}

function findValuableOreInField(field, focusedOre = null, excludedKeys = []) {
  if (!field || !state.world) return null;
  const excluded = excludedKeys instanceof Set ? excludedKeys : new Set(excludedKeys || []);
  const min = state.world.worldToTile(field.x - field.radius, field.y - field.radius);
  const max = state.world.worldToTile(field.x + field.radius, field.y + field.radius);
  let best = null;
  let bestScore = -Infinity;
  const consider = (tile, tx, ty) => {
    if (!tile?.oreId || tile.kind === 'air' || excluded.has(`${tx}:${ty}`)) return;
    if (focusedOre?.id && tile.oreId !== focusedOre.id) return;
    const x = (tx + 0.5) * TILE_SIZE;
    const y = (ty + 0.5) * TILE_SIZE;
    const fromCenter = distance(x, y, field.x, field.y);
    if (fromCenter > field.radius) return;
    const ore = oreById.get(tile.oreId);
    const score = (ore?.value || 1) * 1000 - fromCenter - (tile.hp || 0) * 0.03;
    if (score <= bestScore) return;
    bestScore = score;
    best = { kind: 'ore', tile, tx, ty, x, y, distance: fromCenter, score: -score };
  };
  if (typeof state.world.forEachOreTileInBounds === 'function') {
    state.world.forEachOreTileInBounds(
      Math.max(0, min.tx),
      Math.max(0, min.ty),
      Math.min(WORLD_CONFIG.WIDTH - 1, max.tx),
      Math.min(WORLD_CONFIG.HEIGHT - 1, max.ty),
      consider,
    );
  } else {
    for (let ty = Math.max(0, min.ty); ty <= Math.min(WORLD_CONFIG.HEIGHT - 1, max.ty); ty += 1) {
      for (let tx = Math.max(0, min.tx); tx <= Math.min(WORLD_CONFIG.WIDTH - 1, max.tx); tx += 1) {
        consider(state.world.getTile(tx, ty), tx, ty);
      }
    }
  }
  return best;
}

function findMagneticFieldTarget(focusedOre = null, excludedKeys = []) {
  return findValuableOreInField(activeMagneticField(), focusedOre, excludedKeys);
}

function findCrewVeinTarget(x, y, oreId, excludedKeys = []) {
  if (!oreId) return null;
  const beacon = getCrewBeacon();
  return findBestOreTarget(x, y, Math.max(TILE_SIZE * 4.5, stats.digRadius * 3), oreId, {
    excludedKeys: new Set(excludedKeys),
    ignoreSenseLine: true,
    veinId: beacon?.veinId || null,
  });
}

function relayCrewOverkill(origin, oreId, amount, excludedKeys = []) {
  const carry = Math.max(0, amount) * Math.max(0, stats.crewBeaconOverkillCarry || 0);
  if (carry <= 0 || !getCrewBeacon()) return;
  const next = findCrewVeinTarget(origin.x, origin.y, oreId, excludedKeys);
  if (!next) return;
  state.metrics.crewRelays += 1;
  state.world.damageTile(next.tx, next.ty, carry, (tile, tx, ty) => resolveBrokenTile(tile, tx, ty, 'beacon'));
  state.beams.push({
    x: origin.x,
    y: origin.y,
    x2: next.x,
    y2: next.y,
    color: '#ffc95e',
    life: 0.16,
    maxLife: 0.16,
    width: 3,
    kind: 'beacon',
  });
}

function findExplorationTarget(x, y, focusedOreId = null) {
  const center = state.world.worldToTile(x, y);
  const edgeMargin = EXPLORATION_SCAN_TILES + 2;
  let forward = state.player?.facing < 0 ? -1 : 1;
  if (center.tx <= edgeMargin) forward = 1;
  else if (center.tx >= WORLD_CONFIG.WIDTH - edgeMargin) forward = -1;

  let best = null;
  let bestScore = Infinity;
  const minTy = Math.max(0, center.ty - Math.floor(EXPLORATION_SCAN_TILES * 0.45));
  const maxTy = Math.min(WORLD_CONFIG.HEIGHT - WORLD_CONFIG.BEDROCK_ROWS - 1, center.ty + EXPLORATION_SCAN_TILES);
  const minTx = Math.max(0, center.tx - EXPLORATION_SCAN_TILES);
  const maxTx = Math.min(WORLD_CONFIG.WIDTH - 1, center.tx + EXPLORATION_SCAN_TILES);

  for (let ty = minTy; ty <= maxTy; ty += 1) {
    for (let tx = minTx; tx <= maxTx; tx += 1) {
      const tile = state.world.getTile(tx, ty);
      if (!tile || tile.kind === 'air' || tile.kind === 'bedrock' || tile.hp <= 0) continue;
      if (focusedOreId && tile.oreId && tile.oreId !== focusedOreId) continue;

      const offsetX = tx - center.tx;
      const offsetY = ty - center.ty;
      const tileDistance = Math.hypot(offsetX, offsetY);
      if (tileDistance < 0.5 || tileDistance > EXPLORATION_SCAN_TILES) continue;

      const forwardOffset = offsetX * forward;
      const upwardPenalty = offsetY < 0 ? 5 + Math.abs(offsetY) * 0.8 : 0;
      const backwardPenalty = forwardOffset < 0 ? 1.2 + Math.abs(forwardOffset) * 0.12 : 0;
      const downwardBias = Math.min(2.6, Math.max(0, offsetY) * 0.24);
      const forwardBias = Math.min(1.3, Math.max(0, forwardOffset) * 0.11);
      const touchesAir = [
        state.world.getTile(tx - 1, ty),
        state.world.getTile(tx + 1, ty),
        state.world.getTile(tx, ty - 1),
        state.world.getTile(tx, ty + 1),
      ].some((neighbor) => !neighbor || neighbor.kind === 'air');
      const frontierPenalty = touchesAir ? 0 : 2.5;
      const score = tileDistance + upwardPenalty + backwardPenalty + frontierPenalty - downwardBias - forwardBias;

      if (score < bestScore) {
        const targetX = (tx + 0.5) * TILE_SIZE;
        const targetY = (ty + 0.5) * TILE_SIZE;
        bestScore = score;
        best = {
          kind: 'exploration',
          tile,
          tx,
          ty,
          x: targetX,
          y: targetY,
          distance: distance(x, y, targetX, targetY),
        };
      }
    }
  }

  return best;
}

function triggerDeafKnock(x = state.player?.x, y = state.player?.y) {
  if (!state.player || !state.world || !(stats.deafKnockStoneThreshold > 0)) return false;
  const focusedOre = getFocusedOre();
  const focusedOreId = stats.deafKnockFocusOnly ? focusedOre?.id || null : null;
  const radius = effectiveSenseRadius() * (stats.deafKnockSenseRadiusMultiplier || 1.4)
    * (focusedOre ? focusedSenseMultiplier(focusedOre) : 1);
  const targets = findBestOreTargets(
    state.player.x,
    state.player.y,
    radius,
    focusedOreId,
    { ignoreSenseLine: true },
    (stats.backupTargetSlots || 0) > 0 ? 2 : 1,
  );
  state.dryRockBlocks = 0;
  state.deafKnockCooldown = stats.deafKnockCooldown || 3;
  state.metrics.deafKnocks += 1;
  state.ping = 1;
  state.shocks.push({
    x: x ?? state.player.x,
    y: y ?? state.player.y,
    life: 0.42,
    maxLife: 0.42,
    tick: Infinity,
    radius,
    color: '#69e4d5',
    kind: 'sense-pulse',
  });
  if (targets[0]) {
    targets[0].lockRadius = radius;
    if (targets[1]) targets[1].lockRadius = radius;
    state.target = targets[0];
    state.backupTarget = targets[1] || null;
    noteTargetAcquired(state.target);
    state.pathWaypoint = null;
    state.targetCooldown = Math.max(state.targetCooldown, 0.08);
    state.deafKnockBoostRemaining = stats.deafKnockMoveDuration || 1.2;
    state.floaters.push({
      x: state.player.x,
      y: state.player.y - 42,
      text: 'ГЛУХОЙ СТУК · ЦЕЛЬ!',
      color: '#79f4df',
      life: 1,
      maxLife: 1,
    });
    sound.tone(118, 0.18, 'sine', 0.035, 290);
    return true;
  }
  state.floaters.push({ x: state.player.x, y: state.player.y - 36, text: 'ГЛУХО…', color: '#8497a4', life: 0.65, maxLife: 0.65 });
  sound.tone(92, 0.12, 'sine', 0.02, -20);
  return false;
}

function triggerEchoPing(focusedOre = getFocusedOre()) {
  if (
    !state.player
    || !state.world
    || !(stats.echoPingCooldown > 0)
    || state.echoPingCooldownRemaining > 0
  ) return false;
  state.echoPingCooldownRemaining = stats.echoPingCooldown;
  const radius = effectiveSenseRadius()
    * (stats.echoPingRadiusMultiplier || 1)
    * focusedSenseMultiplier(focusedOre);
  const targets = findBestOreTargets(
    state.player.x,
    state.player.y,
    radius,
    focusedOre?.id || null,
    { ignoreSenseLine: true },
    (stats.backupTargetSlots || 0) > 0 ? 2 : 1,
  );
  state.ping = 1;
  state.shocks.push({
    x: state.player.x,
    y: state.player.y,
    life: 0.5,
    maxLife: 0.5,
    tick: Infinity,
    radius,
    color: '#80ebff',
    kind: 'sense-pulse',
  });
  if (!targets[0]) return false;
  targets[0].lockRadius = radius;
  decorateRememberedTarget(targets[0], { echoHold: stats.echoPingTargetHold });
  if (targets[1]) {
    targets[1].lockRadius = radius;
    decorateRememberedTarget(targets[1], { echoHold: stats.echoPingTargetHold });
  }
  state.target = targets[0];
  state.backupTarget = targets[1] || null;
  state.pathWaypoint = null;
  noteTargetAcquired(state.target);
  state.floaters.push({
    x: state.player.x,
    y: state.player.y - 42,
    text: 'РЕЗОНАНСНЫЙ ПИНГ',
    color: '#8cf4ff',
    life: 0.9,
    maxLife: 0.9,
  });
  sound.tone(165, 0.15, 'sine', 0.03, 330);
  return true;
}

function triggerSuperPickEcho(aimTarget, baseDamage) {
  if (!aimTarget || !(baseDamage > 0) || !(stats.laserSuperPickEchoEvery > 0)) return false;
  const radius = Math.max(TILE_SIZE * 0.75, stats.laserSuperPickEchoRadiusTiles * TILE_SIZE);
  const power = baseDamage * stats.laserSuperPickEchoPower;
  state.world.damageCircle(
    aimTarget.x,
    aimTarget.y,
    radius,
    power,
    (tile, tx, ty) => resolveBrokenTile(tile, tx, ty, 'echo'),
  );
  state.metrics.superPickEchoes += 1;
  state.shocks.push({
    x: aimTarget.x,
    y: aimTarget.y,
    life: 0.48,
    maxLife: 0.48,
    tick: Infinity,
    radius,
    color: '#65ffe3',
    kind: 'echo',
  });
  state.floaters.push({ x: aimTarget.x, y: aimTarget.y - 28, text: 'ЭХО СУПЕРКИРКИ', color: '#a4fff1', life: 0.9, maxLife: 0.9 });
  spawnSparks(aimTarget.x, aimTarget.y, '#7affea', 13);
  state.shake = Math.max(state.shake, 8);
  sound.tone(205, 0.16, 'square', 0.035, 380);
  return true;
}

function countLiveVeinNodes(veinId) {
  return veinId ? Math.max(0, state.veinRemainingCounts?.get(veinId) || 0) : 0;
}

function findNearestLiveVeinNode(veinId, x, y) {
  if (!veinId || !state.world) return null;
  let best = null;
  let bestDistance = Infinity;
  const consider = (tile, tx, ty) => {
    if (!tile?.oreId || tile.veinId !== veinId || tile.kind === 'air') return;
    const targetX = (tx + 0.5) * TILE_SIZE;
    const targetY = (ty + 0.5) * TILE_SIZE;
    const fromBreak = distance(x, y, targetX, targetY);
    if (fromBreak >= bestDistance) return;
    bestDistance = fromBreak;
    best = { tile, tx, ty, x: targetX, y: targetY };
  };
  if (typeof state.world.forEachOreTileInBounds === 'function') {
    state.world.forEachOreTileInBounds(0, 0, WORLD_CONFIG.WIDTH - 1, WORLD_CONFIG.HEIGHT - 1, consider);
  } else {
    for (let ty = 0; ty < WORLD_CONFIG.HEIGHT; ty += 1) {
      for (let tx = 0; tx < WORLD_CONFIG.WIDTH; tx += 1) consider(state.world.getTile(tx, ty), tx, ty);
    }
  }
  return best;
}

function findMotherlodePriorityTarget() {
  if (!state.motherlodeTriggered || !state.motherlodeVeinId || !state.player) return null;
  const runtime = state.veinRuntime.get(state.motherlodeVeinId);
  if (!runtime?.motherlode || runtime.completed || countLiveVeinNodes(state.motherlodeVeinId) <= 0) return null;
  const target = findNearestLiveVeinNode(state.motherlodeVeinId, state.player.x, state.player.y);
  if (!target) return null;
  const targetDistance = distance(state.player.x, state.player.y, target.x, target.y);
  return {
    kind: 'ore',
    ...target,
    distance: targetDistance,
    lockRadius: targetDistance + TILE_SIZE * 2,
    motherlode: true,
  };
}

function advanceTripleSample(tile, x, y) {
  const every = stats.tripleSampleEvery || 0;
  const veinId = tile?.veinId || null;
  if (every <= 0 || !veinId) return 0;
  const progress = state.tripleSampleVeins.get(veinId) || { count: 0 };
  progress.count += 1;
  let bonusYield = 0;
  if (progress.count >= every) {
    progress.count = 0;
    bonusYield = stats.tripleSampleBonusYield || 0;
    const next = findNearestLiveVeinNode(veinId, x, y);
    if (next && stats.tripleSampleNextNodeDamage > 0) {
      const fracture = next.tile.maxHp * stats.tripleSampleNextNodeDamage;
      // The sample weakens a still-existing node without creating another
      // break/proc chain. Keep at least one hit point for the promised next hit.
      next.tile.hp = Math.max(1, next.tile.hp - fracture);
      next.tile.cracked = clamp(1 - next.tile.hp / Math.max(1, next.tile.maxHp), 0, 1);
      next.tile.discovered = true;
      next.tile.sensedUntil = Math.max(next.tile.sensedUntil || 0, state.elapsed + 1.2);
      state.beams.push({ x, y, x2: next.x, y2: next.y, color: '#e7b9ff', life: 0.22, maxLife: 0.22, width: 3, kind: 'sample' });
      state.floaters.push({ x: next.x, y: next.y - 28, text: `ПРОБА: ТРЕЩИНА ${Math.round(stats.tripleSampleNextNodeDamage * 100)}%`, color: '#e7b9ff', life: 0.9, maxLife: 0.9 });
    }
    state.floaters.push({ x, y: y - 42, text: `ТРОЙНАЯ ПРОБА +${bonusYield}`, color: '#f5d1ff', life: 1, maxLife: 1 });
    sound.tone(470, 0.12, 'triangle', 0.025, 150);
  }
  state.tripleSampleVeins.set(veinId, progress);
  return bonusYield;
}

function tagHighestExistingMotherlode(fallbackRuntime, x, y) {
  if (!stats.motherlodeGuaranteed || !state.world || state.motherlodeTriggered) return fallbackRuntime;
  let best = null;
  let bestScore = -Infinity;
  const consider = (tile, tx, ty) => {
    if (!tile?.oreId || !tile.veinId || tile.kind === 'air') return;
    const ore = oreById.get(tile.oreId);
    if (!ore || !state.discoveredOreIds.has(ore.id)) return;
    const targetX = (tx + 0.5) * TILE_SIZE;
    const targetY = (ty + 0.5) * TILE_SIZE;
    const score = ore.tier * 1_000_000 - distance(x, y, targetX, targetY);
    if (score <= bestScore) return;
    bestScore = score;
    best = { tile, tx, ty, x: targetX, y: targetY };
  };
  if (typeof state.world.forEachOreTileInBounds === 'function') {
    state.world.forEachOreTileInBounds(0, 0, WORLD_CONFIG.WIDTH - 1, WORLD_CONFIG.HEIGHT - 1, consider);
  }
  const fallbackVeinId = fallbackRuntime?.veinId || null;
  const targetVeinId = best?.tile?.veinId
    || (fallbackVeinId && countLiveVeinNodes(fallbackVeinId) > 0 ? fallbackVeinId : null);
  if (!targetVeinId) return fallbackRuntime;
  let runtime = state.veinRuntime.get(targetVeinId);
  if (!runtime) {
    runtime = {
      veinId: targetVeinId,
      oreId: best?.tile?.oreId || fallbackRuntime.oreId,
      rich: false,
      richRollResolved: false,
      motherlode: false,
      completed: false,
    };
    state.veinRuntime.set(targetVeinId, runtime);
  }
  state.motherlodeTriggered = true;
  state.motherlodeVeinId = targetVeinId;
  runtime.motherlode = true;
  runtime.rich = true;
  runtime.richRollResolved = true;
  state.motherlodeBreaks = 0;
  state.metrics.motherlodes += 1;
  const targetX = best?.x || x;
  const targetY = best?.y || y;
  if (best?.tile) {
    best.tile.discovered = true;
    best.tile.sensedUntil = Math.max(best.tile.sensedUntil || 0, state.elapsed + 4);
    const targetDistance = state.player ? distance(state.player.x, state.player.y, best.x, best.y) : 0;
    state.target = {
      kind: 'ore',
      tile: best.tile,
      tx: best.tx,
      ty: best.ty,
      x: best.x,
      y: best.y,
      distance: targetDistance,
      lockRadius: targetDistance + TILE_SIZE * 2,
      motherlode: true,
    };
    state.ping = 1;
  }
  state.floaters.push({ x: targetX, y: targetY - 34, text: 'МАТЕРИНСКАЯ ЖИЛА', color: '#fff0a6', life: 1.25, maxLife: 1.25 });
  toast('МАТЕРИНСКАЯ ЖИЛА НАЙДЕНА', 'success');
  flash('#ffe28a', 0.2);
  return runtime;
}

function getVeinRuntime(tile, x, y, allowProcs = true) {
  const veinId = tile?.veinId || `${tile?.oreId || 'ore'}:single:${x}:${y}`;
  let runtime = state.veinRuntime.get(veinId);
  if (!runtime) {
    runtime = {
      veinId,
      oreId: tile?.oreId || null,
      rich: false,
      richRollResolved: false,
      motherlode: false,
      completed: false,
    };
    state.veinRuntime.set(veinId, runtime);
  }
  if (allowProcs && !runtime.richRollResolved) {
    runtime.richRollResolved = true;
    if (stats.richVeinWholeChance > 0 && Math.random() < procChance(stats.richVeinWholeChance, 0.18)) {
      runtime.rich = true;
      runtime.richTaggedAtBreak = state.blocksBroken;
      state.metrics.richVeins += 1;
      state.floaters.push({ x, y: y - 28, text: 'БОГАТАЯ ЖИЛА', color: '#ffe074', life: 1, maxLife: 1 });
    }
  }
  return runtime;
}

function triggerFortuneWheel(runtime, x, y, allowProcs = true, hadRareEffect = false) {
  const threshold = stats.fortunePityThreshold;
  if (!stats.fortuneWheelEnabled || !allowProcs || threshold <= 0) return { extraYield: 0, bomb: false };
  if (hadRareEffect) {
    state.fortunePityCounter = 0;
    return { extraYield: 0, bomb: false };
  }
  state.fortunePityCounter += 1;
  if (state.fortunePityCounter < threshold) return { extraYield: 0, bomb: false };
  state.fortunePityCounter = 0;
  const cycleLength = clamp(stats.fortuneWheelCycleLength || 4, 1, 4);
  const effect = state.fortuneWheelIndex % cycleLength;
  state.fortuneWheelIndex = (state.fortuneWheelIndex + 1) % cycleLength;
  state.metrics.fortuneWheelProcs += 1;
  const labels = ['КОЛЕСО: ДВОЙНАЯ ДОБЫЧА', 'КОЛЕСО: БЕСПЛАТНАЯ БОМБА', 'КОЛЕСО: +0,25 С', 'КОЛЕСО: БОГАТАЯ ЖИЛА'];
  const colors = ['#ffe37c', '#ff9b65', '#8ff8ef', '#f6c75b'];
  state.floaters.push({ x, y: y - 42, text: labels[effect], color: colors[effect], life: 1.15, maxLife: 1.15 });
  toast(labels[effect], 'success');
  sound.tone(360 + effect * 75, 0.16, 'triangle', 0.032, 170);
  if (effect === 0) return { extraYield: 1, bomb: false };
  if (effect === 1) return { extraYield: 0, bomb: true };
  if (effect === 2) {
    addBonusTime(0.25, x, y - 34, 'КОЛЕСО');
    return { extraYield: 0, bomb: false };
  }
  if (runtime && !runtime.rich) {
    runtime.rich = true;
    runtime.richRollResolved = true;
    runtime.richTaggedAtBreak = state.blocksBroken;
    state.metrics.richVeins += 1;
  }
  return { extraYield: 0, bomb: false };
}

function advanceDemolitionCombo(stage, target) {
  if (!stats.demolitionComboEnabled || !target || state.demolitionComboCooldownRemaining > 0) return false;
  const veinId = target.tile?.veinId || target.veinId || null;
  if (state.demolitionComboStage > 0 && state.demolitionComboExpires < state.elapsed) {
    state.demolitionComboStage = 0;
    state.demolitionComboVeinId = null;
  }
  const sameVein = !state.demolitionComboVeinId || !veinId || state.demolitionComboVeinId === veinId;
  if (stage === 'drone' && state.demolitionComboStage === 0) {
    state.demolitionComboStage = 1;
    state.demolitionComboVeinId = veinId;
  } else if (stage === 'chain' && state.demolitionComboStage === 1 && sameVein) {
    state.demolitionComboStage = 2;
  } else if (stage === 'bomb' && state.demolitionComboStage === 2 && sameVein) {
    const finalPower = Math.max(0.1, stats.demolitionComboFinishPower || 0.75);
    const radius = Math.max(TILE_SIZE, stats.demolitionComboVeinRadiusTiles * TILE_SIZE);
    const comboDamage = stats.pickPower * Math.max(1, stats.bombPower || 1) * 1.8 * (1 + finalPower);
    const comboSnapshot = snapshotOreHpInCircle(target.x, target.y, radius);
    const comboBreaks = state.world.damageCircle(
      target.x,
      target.y,
      radius,
      comboDamage,
      (tile, tx, ty) => resolveBrokenTile(tile, tx, ty, 'orchestra'),
    );
    collectCircleGadgetOverkill(comboBreaks, comboSnapshot, comboDamage, target.x, target.y);
    state.metrics.demolitionCombos += 1;
    state.demolitionComboStage = 0;
    state.demolitionComboVeinId = null;
    state.demolitionComboCooldownRemaining = Math.max(4, stats.demolitionComboMarkDuration || 0);
    state.floaters.push({ x: target.x, y: target.y - 42, text: 'ОРКЕСТР: ФИНАЛ', color: '#fff0a1', life: 1.1, maxLife: 1.1 });
    state.shocks.push({ x: target.x, y: target.y, life: 0.55, maxLife: 0.55, tick: Infinity, radius, color: '#ffd879', kind: 'orchestra' });
    sound.tone(190, 0.22, 'sawtooth', 0.04, 520);
    return true;
  } else {
    return false;
  }
  state.demolitionComboExpires = state.elapsed + stats.demolitionComboMarkDuration;
  const label = state.demolitionComboStage === 1 ? 'ОРКЕСТР I/III · ДРОН' : 'ОРКЕСТР II/III · РАЗРЯД';
  state.floaters.push({ x: target.x, y: target.y - 30, text: label, color: state.demolitionComboStage === 1 ? '#76dbff' : '#ca9cff', life: 0.8, maxLife: 0.8 });
  return true;
}

function awardMotherlodeCache(pieceCount, x, y) {
  const count = Math.max(0, Math.floor(pieceCount || 0));
  if (count <= 0) return 0;
  const available = ORE_TYPES
    .filter((ore) => state.discoveredOreIds.has(ore.id))
    .sort((left, right) => right.tier - left.tier);
  if (!available.length) return 0;
  for (let index = 0; index < count; index += 1) {
    const ore = available[index % Math.min(3, available.length)];
    state.oreCounts[ore.id] = (state.oreCounts[ore.id] || 0) + 1;
  }
  state.runOre += count;
  state.floaters.push({ x, y: y - 48, text: `ТАЙНИК МАТЕРИНСКОЙ ЖИЛЫ +${count}`, color: '#fff0a6', life: 1.3, maxLife: 1.3 });
  return count;
}

function triggerImpactWaveAt(x, y) {
  const radius = Math.max(TILE_SIZE * 0.8, (stats.impactWaveRadiusTiles || 0) * TILE_SIZE);
  const power = stats.pickPower * (stats.impactWavePower || 0);
  if (!(power > 0) || !(radius > 0)) return false;
  state.world.damageCircle(
    x,
    y,
    radius,
    power,
    (tile, tx, ty) => resolveBrokenTile(tile, tx, ty, 'impact-wave'),
  );
  state.shocks.push({ x, y, life: 0.42, maxLife: 0.42, tick: Infinity, radius, color: '#f7d878', kind: 'impact' });
  spawnSparks(x, y, '#ffe69a', 9);
  return true;
}

function triggerQuarryFractureAt(x, y) {
  const power = stats.pickPower * (stats.quarryModeSideFracturePower || 0);
  if (!(power > 0)) return false;
  const radius = TILE_SIZE * 1.05;
  state.world.damageCircle(
    x,
    y,
    radius,
    power,
    (tile, tx, ty) => resolveBrokenTile(tile, tx, ty, 'quarry-fracture'),
  );
  state.shocks.push({ x, y, life: 0.28, maxLife: 0.28, tick: Infinity, radius, color: '#dfbd79', kind: 'fracture' });
  return true;
}

function noteToolBreakProgress(tile, x, y, source) {
  const veinId = tile?.veinId || null;
  if (veinId) {
    const nextCount = Math.max(0, remainingVeinNodes(veinId) - 1);
    state.veinRemainingCounts.set(veinId, nextCount);
    if (nextCount <= 0) {
      if (state.lastBrokenVeinId === veinId) {
        state.lastBrokenVeinId = null;
        state.veinBreakStreak = 0;
      }
      if (state.lockedVeinId === veinId) {
        state.lockedVeinId = null;
        state.lockedVeinOreId = null;
      }
      if (state.quarryVeinId === veinId) {
        state.quarryModeActive = false;
        state.quarryModeRemaining = 0;
        state.quarryVeinId = null;
        state.quarryBreakStreak = 0;
      }
    }
  }
  if (!DIRECT_TOOL_BREAK_SOURCES.has(source)) return;

  if (veinId) {
    if (state.lastBrokenVeinId === veinId) state.veinBreakStreak += 1;
    else {
      state.lastBrokenVeinId = veinId;
      state.veinBreakStreak = 1;
    }
    if ((stats.quarryModeRequiredBreaks || 0) > 0) {
      if (!state.quarryModeActive && state.elapsed > state.quarryStreakExpires) {
        state.quarryBreakStreak = 0;
        state.quarryVeinId = null;
      }
      if (state.quarryVeinId === veinId) state.quarryBreakStreak += 1;
      else {
        state.quarryVeinId = veinId;
        state.quarryBreakStreak = 1;
        state.quarryModeActive = false;
      }
      state.quarryStreakExpires = state.elapsed + (stats.quarryModeWindow || 1.2);
      if (!state.quarryModeActive && state.quarryBreakStreak >= stats.quarryModeRequiredBreaks) {
        state.quarryModeActive = true;
        state.quarryModeRemaining = stats.quarryModeDuration || 2.5;
        state.floaters.push({ x, y: y - 34, text: 'КАРЬЕРНЫЙ ТЕМП', color: '#ffe08b', life: 1, maxLife: 1 });
        sound.tone(145, 0.14, 'square', 0.03, 220);
      }
      if (state.quarryModeActive && remainingVeinNodes(veinId) > 0) triggerQuarryFractureAt(x, y);
    }
  } else {
    // Ordinary rock between two ore nodes must not erase the remembered vein.
    // The trail is deliberately cleared only when another vein is mined or the
    // remembered vein is exhausted; otherwise narrow seams lose their benefit
    // while the miner is merely opening the path between adjacent nodes.
    if (!state.quarryModeActive) state.quarryBreakStreak = 0;
  }

  if ((stats.impactWaveEvery || 0) > 0 && (stats.impactWavePower || 0) > 0) {
    state.impactWaveProgress += 1;
    if (state.impactWaveProgress >= stats.impactWaveEvery) {
      state.impactWaveProgress = 0;
      triggerImpactWaveAt(x, y);
    }
  }
}

function resolveBrokenTile(tile, tx, ty, source = 'pick') {
  state.blocksBroken += 1;
  state.metrics.sourceBreaks[source] = (state.metrics.sourceBreaks[source] || 0) + 1;
  if ((tile?.maxHp || 0) > state.metrics.maxBlockHp) {
    state.metrics.maxBlockHp = tile.maxHp || 0;
    state.metrics.maxBlockKind = tile?.oreId ? (oreById.get(tile.oreId)?.name || tile.oreId) : (tile?.kind || 'порода');
  }
  if (tile?.veinId && state.crewBeacon?.veinId === tile.veinId) getCrewBeacon(true);
  const x = (tx + 0.5) * TILE_SIZE;
  const y = (ty + 0.5) * TILE_SIZE;
  const ore = tile?.oreId ? oreById.get(tile.oreId) : null;
  spawnDebris(x, y, ore?.color || (tile?.kind === 'dirt' ? '#74523d' : '#626779'), ore ? 8 : 4);
  noteToolBreakProgress(tile, x, y, source);
  const noProcSource = source === 'event'
    || SECONDARY_NO_PROC_SOURCES.has(source)
    || (source === 'echo' && stats.laserSuperPickEchoNoProcs);
  const countsForDeafKnock = !noProcSource && source !== 'shatter';
  if (!noProcSource && source !== 'shatter' && (stats.breakSplashChance || 0) > 0 && Math.random() < procChance(stats.breakSplashChance, 0.12)) {
    state.world.damageCircle(x, y, Math.max(TILE_SIZE, stats.splashRadius || TILE_SIZE), stats.pickPower * (stats.breakSplashPower || 0.25), (nearTile, nearTx, nearTy) => resolveBrokenTile(nearTile, nearTx, nearTy, 'shatter'));
  }
  checkMicroEventsAt(x, y, true);
  if (!ore) {
    if (countsForDeafKnock && stats.deafKnockStoneThreshold > 0) {
      state.dryRockBlocks += 1;
      if (state.dryRockBlocks >= stats.deafKnockStoneThreshold && state.deafKnockCooldown <= 0) triggerDeafKnock(x, y);
    }
    return;
  }
  const veinRuntime = getVeinRuntime(tile, x, y, !noProcSource);

  const firstOfType = !state.discoveredOreIds.has(ore.id);
  if (firstOfType) {
    state.discoveredOreIds.add(ore.id);
    if ((stats.discoveryTimeBonus || 0) > 0) {
      addBonusTime(stats.discoveryTimeBonus, x, y - 30, 'ОТКРЫТИЕ');
    }
  }

  const now = state.elapsed;
  state.combo = now <= state.comboExpires ? state.combo + 1 : 1;
  state.comboExpires = now + stats.comboWindow;
  let hadRareEffect = veinRuntime.richTaggedAtBreak === state.blocksBroken;
  let yieldCount = 1 + (noProcSource ? 0 : advanceTripleSample(tile, x, y));
  const breakKey = `${tx}:${ty}`;
  if (state.overkillYieldReady && state.overkillYieldTargetKey === breakKey) {
    yieldCount += 1;
    state.overkillReservoir = 0;
    state.overkillReservoirVeinId = null;
    state.overkillYieldReady = false;
    state.overkillYieldTargetKey = null;
    state.floaters.push({ x, y: y - 52, text: 'ПЕРЕПЛАВКА +1', color: '#d6a5ff', life: 0.9, maxLife: 0.9 });
  }
  const bonusChance = noProcSource ? 0 : procChance(stats.extraYieldChance, 0.24);
  if (Math.random() < bonusChance) {
    yieldCount += 1;
    hadRareEffect = true;
  }
  // Jackpot effects stack additively. Multiplying five independent rolls made
  // the late economy jump by two orders of magnitude and skipped whole tiers.
  if (!noProcSource && Math.random() < procChance(stats.doubleDropChance, 0.18)) {
    yieldCount += 1;
    hadRareEffect = true;
  }
  if (!noProcSource && Math.random() < procChance(stats.tripleDropChance, 0.12)) {
    yieldCount += 2;
    hadRareEffect = true;
  }
  if (!noProcSource && Math.random() < procChance(stats.richVeinChance, 0.18)) {
    yieldCount += 1;
    hadRareEffect = true;
  }
  const legacyMotherlode = !stats.motherlodeGuaranteed
    && !noProcSource
    && Math.random() < procChance(stats.motherlodeChance, 0.08);
  if (legacyMotherlode) {
    yieldCount += 4;
    hadRareEffect = true;
    if (state.elapsed - state.lastBigToast > 1.2) {
      state.lastBigToast = state.elapsed;
      toast('МАТЕРИНСКАЯ ЖИЛА!', 'success');
      flash('#ffe08b', 0.32);
    }
  }

  let rareBonusOre = null;
  if (!noProcSource && stats.rareOreAdditiveChance > 0 && Math.random() < procChance(stats.rareOreAdditiveChance, 0.2)) {
    rareBonusOre = ORE_TYPES
      .filter((candidate) => candidate.tier > ore.tier && state.discoveredOreIds.has(candidate.id))
      .sort((left, right) => left.tier - right.tier)[0] || null;
    if (rareBonusOre) hadRareEffect = true;
  }
  let goldenBonusOre = null;
  if (!noProcSource && stats.goldenOreAdditiveChance > 0 && Math.random() < procChance(stats.goldenOreAdditiveChance, 0.12)) {
    const gold = oreById.get('gold') || null;
    const goldIsKnown = Boolean(
      gold
      && (
        state.discoveredOreIds.has(gold.id)
        || (save.lifetimeOres?.[gold.id] || 0) > 0
        || (save.inventory?.[gold.id] || 0) > 0
      )
    );
    // Golden Touch is strictly an additive gold payout. It never substitutes
    // the current high-tier ore and never opens gold before it was found.
    goldenBonusOre = goldIsKnown ? gold : null;
    if (goldenBonusOre) hadRareEffect = true;
  }
  if (!noProcSource && stats.relicEffectChance > 0 && Math.random() < procChance(stats.relicEffectChance, 0.08)) {
    activateRelicEffect(x, y, false);
    hadRareEffect = true;
  }
  const wheelEffect = triggerFortuneWheel(veinRuntime, x, y, !noProcSource, hadRareEffect);
  yieldCount += wheelEffect.extraYield;

  const rewardOre = ore;

  const comboBonus = 1 + Math.min(1.5, Math.max(0, state.combo - 1) * 0.06 * stats.comboMultiplier);
  const gemBonus = oreRank(rewardOre) >= 6 ? (stats.gemValueMultiplier || 1) : 1;
  const depthProgress = clamp(state.deepest / 90, 0, 1);
  const contractStacks = stats.depthContractStep > 0
    ? Math.min(stats.depthContractMaxStacks || 0, Math.floor(depthFromOrigin(x, y) / stats.depthContractStep))
    : 0;
  const depthBonus = (1 + depthProgress * (stats.depthValueBonus || 0))
    * (1 + contractStacks * (stats.depthContractBonusPerStack || 0));
  const overkill = Math.max(0, stats.pickPower - (tile.maxHp || 1)) / Math.max(1, tile.maxHp || 1);
  const conversionBonus = 1 + Math.min(1, overkill) * (stats.oreConversionBonus || 0);
  const sourceBonus = source === 'bomb' ? (stats.bombValueMultiplier || 1) : 1;
  const richActiveForBreak = veinRuntime.rich && veinRuntime.richTaggedAtBreak !== state.blocksBroken;
  const veinYieldBonus = veinRuntime.motherlode
    ? stats.motherlodeYieldMultiplier
    : richActiveForBreak ? 1 + stats.richVeinYieldBonus : 1;
  const pickupBonus = 1 + Math.max(0, (stats.pickupRadius || 46) - 46) / 1400;
  const eventYieldBonus = state.eventYieldBoostRemaining > 0 ? 1.5 : 1;
  const exactYield = Math.max(
    1,
    yieldCount * stats.oreValueMultiplier * comboBonus * gemBonus * depthBonus * conversionBonus
      * sourceBonus * pickupBonus * eventYieldBonus * veinYieldBonus * relicYieldMultiplier(),
  );
  const remainder = Math.max(0, Number(state.yieldRemainders[rewardOre.id]) || 0);
  yieldCount = Math.floor(exactYield + remainder);
  state.yieldRemainders[rewardOre.id] = exactYield + remainder - yieldCount;
  if (!noProcSource && (stats.timeRefundChance || 0) > 0 && Math.random() < procChance(stats.timeRefundChance, 0.1)) {
    addBonusTime(stats.timeRefundAmount || 0, x, y - 28, 'ВОЗВРАТ');
  }
  if (!noProcSource && (stats.timeShardChance || 0) > 0 && Math.random() < procChance(stats.timeShardChance, 0.08)) {
    addBonusTime(stats.timeShardSeconds || 0, x + 10, y - 35, 'ХРОНО');
  }
  const veinCompleted = !veinRuntime.completed && countLiveVeinNodes(veinRuntime.veinId) <= 0;
  if (veinCompleted) {
    veinRuntime.completed = true;
    if (richActiveForBreak) yieldCount += Math.floor(stats.richVeinCompletionBonus || 0);
  }
  state.runOre += yieldCount;
  state.oreCounts[rewardOre.id] = (state.oreCounts[rewardOre.id] || 0) + yieldCount;
  if (rareBonusOre) {
    state.runOre += 1;
    state.oreCounts[rareBonusOre.id] = (state.oreCounts[rareBonusOre.id] || 0) + 1;
    state.floaters.push({ x: x - 12, y: y - 34, text: `БЛЕСК +1 ${rareBonusOre.name.toUpperCase()}`, color: rareBonusOre.accent || rareBonusOre.color, life: 1, maxLife: 1 });
  }
  if (goldenBonusOre) {
    state.runOre += 1;
    state.oreCounts[goldenBonusOre.id] = (state.oreCounts[goldenBonusOre.id] || 0) + 1;
    state.floaters.push({ x: x + 12, y: y - 46, text: `${goldenBonusOre.name.toUpperCase()} +1`, color: '#ffe477', life: 1, maxLife: 1 });
  }
  if (stats.motherlodeGuaranteed && !state.motherlodeTriggered) {
    state.motherlodeBreaks += yieldCount;
    if (state.motherlodeBreaks >= stats.motherlodeTriggerBreaks) {
      tagHighestExistingMotherlode(veinRuntime, x, y);
    }
  }
  if (veinCompleted && veinRuntime.motherlode) {
    awardMotherlodeCache(stats.motherlodeCompletionCache, x, y);
    if (stats.motherlodeCompletionTimeBonus > 0) {
      addBonusTime(stats.motherlodeCompletionTimeBonus, x, y - 56, 'МАТЕРИНСКАЯ ЖИЛА');
    }
  }
  const existingRecord = save.oreRecords?.[ore.id] || {};
  save.oreRecords = save.oreRecords || {};
  save.oreRecords[ore.id] = {
    firstRun: existingRecord.firstRun || save.runs + 1,
    deepest: Math.max(existingRecord.deepest || 0, Math.floor(depthFromOrigin(x, y))),
    physicalBlocks: (existingRecord.physicalBlocks || 0) + 1,
    largestYield: Math.max(existingRecord.largestYield || 0, yieldCount),
  };
  if (!noProcSource && (stats.veinRevealChance || 0) > 0 && Math.random() < procChance(stats.veinRevealChance, 0.08)) revealVein(tx, ty, ore.id);
  state.floaters.push({ x, y: y - 10, text: `+${yieldCount} ${rewardOre.name.toUpperCase()}`, color: rewardOre.accent || rewardOre.color, life: 1, maxLife: 1 });
  state.shake = Math.max(state.shake, source === 'bomb' ? 9 : 3.5);
  sound.ore(ore);
  if ((ore.tier || 0) >= 5) flash(ore.color, 0.12);
  if (wheelEffect.bomb) detonate(x, y, 0, 1, { source: 'fortune', noProcs: true });
  showTutorial(
    'first_ore',
    'ПЕРВАЯ ЖИЛА',
    'Цветные прожилки — руда. Чем дальше от точки высадки, тем она ценнее и плотнее.',
    'Собранный груз начисляется после завершения смены и тратится в дереве улучшений.',
  );
}

function revealVein(centerTx, centerTy, oreId) {
  for (let ty = Math.max(0, centerTy - 3); ty <= Math.min(WORLD_CONFIG.HEIGHT - 1, centerTy + 3); ty += 1) {
    for (let tx = Math.max(0, centerTx - 3); tx <= Math.min(WORLD_CONFIG.WIDTH - 1, centerTx + 3); tx += 1) {
      const tile = state.world.getTile(tx, ty);
      if (tile?.oreId === oreId) {
        tile.discovered = true;
        tile.sensedUntil = state.elapsed + (stats.sensePersistence || 0);
      }
    }
  }
  state.ping = 1;
}

function fireLaserRicochets(originTarget, baseDamage, onBreak) {
  const ricochetCount = clamp(Math.floor(stats.laserRicochetCount || 0), 0, 2);
  if (ricochetCount <= 0 || !originTarget || originTarget.kind !== 'ore') return;
  const focusedOre = getFocusedOre();
  const used = new Set([`${originTarget.tx}:${originTarget.ty}`]);
  let from = { x: originTarget.x, y: originTarget.y };

  for (let index = 0; index < ricochetCount; index += 1) {
    const multiplier = index === 0
      ? (stats.laserFirstRicochetMultiplier || 0.65)
      : (stats.laserSecondRicochetMultiplier || 0.45);
    const target = findBestOreTarget(
      from.x,
      from.y,
      Math.max(stats.laserRange * 0.82, effectiveSenseRadius() * 0.7),
      focusedOre?.id || null,
      { excludedKeys: used, ignoreSenseLine: true },
    );
    if (!target) break;
    const rayExcludedKeys = new Set(used);
    used.add(`${target.tx}:${target.ty}`);
    const dx = target.x - from.x;
    const dy = target.y - from.y;
    const segmentLength = Math.max(0.001, Math.hypot(dx, dy));
    const power = baseDamage * multiplier;
    const hpBefore = target.tile.hp || 0;
    const targetOreId = target.tile.oreId;
    const calibration = focusedDamageMultiplier(target.tile);
    const rayRange = Math.min(stats.laserRange, segmentLength + TILE_SIZE * 0.45);
    state.world.damageRay(
      from.x,
      from.y,
      dx / segmentLength,
      dy / segmentLength,
      rayRange,
      power,
      Math.min(LASER_CORE_WIDTH, stats.laserWidth),
      onBreak,
      { excludedKeys: rayExcludedKeys },
    );
    const targetHit = tileReceivedDamage(target.tx, target.ty, hpBefore);
    if (targetHit) applyLaserEdgeHeat(target, dx / segmentLength, dy / segmentLength, power);
    if (targetHit && calibration > 1) {
      state.metrics.focusedCalibrationHits += 1;
      if (state.world.getTile(target.tx, target.ty)?.kind !== 'air') {
        state.world.damageTile(target.tx, target.ty, power * (calibration - 1), onBreak);
      }
    }
    if (targetHit && state.world.getTile(target.tx, target.ty)?.kind === 'air') {
      relayCrewOverkill(target, targetOreId || focusedOre?.id, Math.max(0, power * calibration - hpBefore), used);
    }
    const beamLength = targetHit ? segmentLength : Math.min(segmentLength, rayRange);
    state.beams.push({
      x: from.x,
      y: from.y,
      x2: from.x + dx / segmentLength * beamLength,
      y2: from.y + dy / segmentLength * beamLength,
      color: index === 0 ? '#bafcff' : '#f0c5ff',
      life: 0.18,
      maxLife: 0.18,
      width: Math.max(2, stats.laserWidth * (0.72 - index * 0.12)),
      kind: stats.tool === 'prismaticLaser' || (stats.toolTier || 0) >= 7 ? 'prism-ricochet' : 'ricochet',
    });
    state.metrics.laserRicochets += 1;
    if (!targetHit) break;
    from = { x: target.x, y: target.y };
  }
}

function expandedTileRayEntry(originX, originY, nx, ny, maxDistance, tx, ty, padding) {
  let entry = 0;
  let exit = maxDistance;
  const bounds = [
    [originX, nx, tx * TILE_SIZE - padding, (tx + 1) * TILE_SIZE + padding],
    [originY, ny, ty * TILE_SIZE - padding, (ty + 1) * TILE_SIZE + padding],
  ];

  for (const [origin, direction, minimum, maximum] of bounds) {
    if (Math.abs(direction) < 1e-9) {
      if (origin < minimum || origin > maximum) return null;
      continue;
    }
    let near = (minimum - origin) / direction;
    let far = (maximum - origin) / direction;
    if (near > far) [near, far] = [far, near];
    entry = Math.max(entry, near);
    exit = Math.min(exit, far);
    if (entry > exit) return null;
  }

  return exit >= 0 && entry <= maxDistance ? Math.max(0, entry) : null;
}

function findPickContact(player, nx, ny, reach, preferredTarget = null) {
  const endX = player.x + nx * reach;
  const endY = player.y + ny * reach;
  const padding = MINER_COLLISION_RADIUS;
  const minTx = clamp(Math.floor((Math.min(player.x, endX) - padding) / TILE_SIZE), 0, WORLD_CONFIG.WIDTH - 1);
  const maxTx = clamp(Math.floor((Math.max(player.x, endX) + padding) / TILE_SIZE), 0, WORLD_CONFIG.WIDTH - 1);
  const minTy = clamp(Math.floor((Math.min(player.y, endY) - padding) / TILE_SIZE), 0, WORLD_CONFIG.HEIGHT - 1);
  const maxTy = clamp(Math.floor((Math.max(player.y, endY) + padding) / TILE_SIZE), 0, WORLD_CONFIG.HEIGHT - 1);
  const preferredKey = preferredTarget ? `${preferredTarget.tx}:${preferredTarget.ty}` : '';
  const candidates = [];

  for (let ty = minTy; ty <= maxTy; ty += 1) {
    for (let tx = minTx; tx <= maxTx; tx += 1) {
      const tile = state.world.getTile(tx, ty);
      if (!tile || tile.kind === 'air' || tile.kind === 'bedrock' || tile.hp <= 0) continue;
      const centerX = (tx + 0.5) * TILE_SIZE;
      const centerY = (ty + 0.5) * TILE_SIZE;
      const forward = (centerX - player.x) * nx + (centerY - player.y) * ny;
      if (forward < -padding) continue;
      const entry = expandedTileRayEntry(player.x, player.y, nx, ny, reach, tx, ty, padding);
      if (entry === null) continue;
      const lateral = Math.abs((centerX - player.x) * -ny + (centerY - player.y) * nx);
      candidates.push({ tx, ty, tile, entry, lateral, preferred: `${tx}:${ty}` === preferredKey });
    }
  }

  candidates.sort((left, right) => (
    left.entry - right.entry
    || Number(right.preferred) - Number(left.preferred)
    || left.lateral - right.lateral
    || left.ty - right.ty
    || left.tx - right.tx
  ));
  return candidates[0] || null;
}

function clearanceTarget(blockedTiles, player) {
  const unique = new Map();
  for (const blocked of blockedTiles) {
    if (!blocked?.tile || blocked.tile.kind === 'air' || blocked.tile.kind === 'bedrock') continue;
    const key = `${blocked.tx}:${blocked.ty}`;
    const previous = unique.get(key);
    if (!previous || Math.abs(blocked.probeOffset || 0) < Math.abs(previous.probeOffset || 0)) unique.set(key, blocked);
  }
  const candidates = [...unique.values()];
  candidates.sort((left, right) => {
    const leftX = (left.tx + 0.5) * TILE_SIZE;
    const leftY = (left.ty + 0.5) * TILE_SIZE;
    const rightX = (right.tx + 0.5) * TILE_SIZE;
    const rightY = (right.ty + 0.5) * TILE_SIZE;
    return Math.abs(left.probeOffset || 0) - Math.abs(right.probeOffset || 0)
      || distance(player.x, player.y, leftX, leftY) - distance(player.x, player.y, rightX, rightY)
      || left.ty - right.ty
      || left.tx - right.tx;
  });
  const blocked = candidates[0];
  if (!blocked) return null;
  const x = (blocked.tx + 0.5) * TILE_SIZE;
  const y = (blocked.ty + 0.5) * TILE_SIZE;
  return {
    kind: blocked.tx === state.target?.tx && blocked.ty === state.target?.ty ? state.target.kind : 'clearance',
    tile: blocked.tile,
    tx: blocked.tx,
    ty: blocked.ty,
    x,
    y,
    distance: distance(player.x, player.y, x, y),
  };
}

function damageSideChips(centerX, centerY, nx, ny, damage, hits, source = 'side-chip') {
  const hitCount = clamp(Math.floor(hits || 0), 0, 8);
  if (!state.world || !(damage > 0) || hitCount <= 0) return 0;
  const perpendicularX = -ny;
  const perpendicularY = nx;
  const used = new Set();
  const candidates = [];
  const candidateCount = hitCount === 1 ? 2 : hitCount;
  for (let index = 0; index < candidateCount; index += 1) {
    const side = index % 2 === 0 ? -1 : 1;
    const step = hitCount === 1 ? 1 : 1 + Math.floor(index / 2);
    const point = state.world.worldToTile(
      centerX + perpendicularX * TILE_SIZE * step * side,
      centerY + perpendicularY * TILE_SIZE * step * side,
    );
    const key = `${point.tx}:${point.ty}`;
    if (used.has(key)) continue;
    used.add(key);
    const tile = state.world.getTile(point.tx, point.ty);
    if (!tile || tile.kind === 'air' || tile.kind === 'bedrock') continue;
    candidates.push({ point, tile, order: index });
  }
  if (hitCount === 1 && candidates.length > 1) {
    candidates.sort((left, right) => (
      Math.max(0, left.tile.hp || 0) - Math.max(0, right.tile.hp || 0)
      || left.order - right.order
    ));
  }
  let applied = 0;
  for (const { point } of candidates.slice(0, hitCount)) {
    state.world.damageTile(
      point.tx,
      point.ty,
      damage,
      (brokenTile, tx, ty) => resolveBrokenTile(brokenTile, tx, ty, source),
    );
    const x = (point.tx + 0.5) * TILE_SIZE;
    const y = (point.ty + 0.5) * TILE_SIZE;
    state.beams.push({ x: centerX, y: centerY, x2: x, y2: y, color: '#efcf83', life: 0.11, maxLife: 0.11, width: 2, kind: 'impact' });
    applied += 1;
  }
  return applied;
}

function forwardDamageableTiles(originX, originY, nx, ny, maximum) {
  const targets = [];
  const used = new Set();
  const samples = Math.max(1, maximum) * 4;
  for (let sample = 1; sample <= samples && targets.length < maximum; sample += 1) {
    const point = state.world.worldToTile(
      originX + nx * TILE_SIZE * sample * 0.55,
      originY + ny * TILE_SIZE * sample * 0.55,
    );
    const key = `${point.tx}:${point.ty}`;
    if (used.has(key)) continue;
    used.add(key);
    const tile = state.world.getTile(point.tx, point.ty);
    if (!tile || tile.kind === 'air' || tile.kind === 'bedrock') continue;
    targets.push({ ...point, tile, x: (point.tx + 0.5) * TILE_SIZE, y: (point.ty + 0.5) * TILE_SIZE });
  }
  return targets;
}

function triggerFaultLine(aimTarget, nx, ny, overkill) {
  const maximum = stats.faultLineMaxBlocks || 0;
  let carry = Math.max(0, overkill) * (stats.faultLinePower || 0);
  if (!aimTarget || maximum <= 0 || !(carry > 0)) return false;
  let remainingSteps = maximum;
  let fromX = aimTarget.x;
  let fromY = aimTarget.y;
  let brokeAny = false;
  const scanMaximum = stats.faultLineExtendOnBreak ? Math.min(12, maximum * 2) : maximum;
  for (const target of forwardDamageableTiles(aimTarget.x, aimTarget.y, nx, ny, scanMaximum)) {
    if (remainingSteps <= 0) break;
    remainingSteps -= 1;
    const hpBefore = Math.max(0, target.tile.hp || 0);
    state.world.damageTile(
      target.tx,
      target.ty,
      carry,
      (tile, tx, ty) => resolveBrokenTile(tile, tx, ty, 'fault-line'),
    );
    state.beams.push({ x: fromX, y: fromY, x2: target.x, y2: target.y, color: '#fff29b', life: 0.18, maxLife: 0.18, width: 3, kind: 'fault' });
    if (state.world.getTile(target.tx, target.ty)?.kind !== 'air') break;
    brokeAny = true;
    if (stats.faultLineExtendOnBreak) remainingSteps += 1;
    carry = Math.max(0, carry - hpBefore);
    if (!(carry > 0)) break;
    fromX = target.x;
    fromY = target.y;
  }
  if (brokeAny) {
    state.floaters.push({ x: aimTarget.x, y: aimTarget.y - 30, text: 'ЛИНИЯ РАЗЛОМА', color: '#fff3a4', life: 0.85, maxLife: 0.85 });
    state.shake = Math.max(state.shake, 7);
  }
  return brokeAny;
}

function triggerChronoOverdriveStrike(aimTarget, nx, ny, damage) {
  const every = stats.chronoOverflowProcEvery || 0;
  if (!stats.chronoOverdrive || state.chronoOverflowRemaining <= 0 || every <= 0 || !(damage > 0)) return false;
  state.chronoOverdriveHitCount += 1;
  if (state.chronoOverdriveHitCount % every !== 0) return false;
  let target = state.world.getTile(aimTarget.tx, aimTarget.ty);
  let point = { tx: aimTarget.tx, ty: aimTarget.ty, x: aimTarget.x, y: aimTarget.y, tile: target };
  if (!target || target.kind === 'air' || target.kind === 'bedrock') {
    point = forwardDamageableTiles(aimTarget.x, aimTarget.y, nx, ny, 1)[0] || null;
  }
  if (!point) return false;
  state.world.damageTile(
    point.tx,
    point.ty,
    damage * 0.65,
    (tile, tx, ty) => resolveBrokenTile(tile, tx, ty, 'chrono-overdrive'),
  );
  state.beams.push({ x: aimTarget.x, y: aimTarget.y, x2: point.x, y2: point.y, color: '#7efcff', life: 0.16, maxLife: 0.16, width: 3, kind: 'chrono' });
  state.floaters.push({ x: point.x, y: point.y - 25, text: 'ХРОНОУДАР', color: '#8dfff6', life: 0.7, maxLife: 0.7 });
  return true;
}

function applyLaserEdgeHeat(aimTarget, nx, ny, baseDamage) {
  if (!aimTarget || !(baseDamage > 0) || !(stats.laserHeatEdgePower > 0) || !(stats.laserHeatDuration > 0)) return 0;
  const perpendicularX = -ny;
  const perpendicularY = nx;
  const used = new Set([`${aimTarget.tx}:${aimTarget.ty}`]);
  let heated = 0;
  for (const side of [-1, 1]) {
    const point = state.world.worldToTile(
      aimTarget.x + perpendicularX * TILE_SIZE * side,
      aimTarget.y + perpendicularY * TILE_SIZE * side,
    );
    const key = `${point.tx}:${point.ty}`;
    if (used.has(key)) continue;
    used.add(key);
    const tile = state.world.getTile(point.tx, point.ty);
    if (!tile || tile.kind === 'air' || tile.kind === 'bedrock') continue;
    state.laserHeatMarks.set(key, state.elapsed + stats.laserHeatDuration);
    const edgeDamage = baseDamage * stats.laserHeatEdgePower;
    state.world.damageTile(
      point.tx,
      point.ty,
      edgeDamage,
      (brokenTile, tx, ty) => resolveBrokenTile(brokenTile, tx, ty, 'laser-heat'),
    );
    const x = (point.tx + 0.5) * TILE_SIZE;
    const y = (point.ty + 0.5) * TILE_SIZE;
    state.beams.push({ x: aimTarget.x, y: aimTarget.y, x2: x, y2: y, color: '#ff8b56', life: 0.18, maxLife: 0.18, width: 2.5, kind: 'heat' });
    heated += 1;
  }
  if (heated > 0) {
    state.metrics.laserHeatStrikes += heated;
    state.floaters.push({ x: aimTarget.x, y: aimTarget.y - 28, text: `ТЕРМОКРАЙ ×${heated}`, color: '#ff9f68', life: 0.72, maxLife: 0.72 });
  }
  return heated;
}

function spawnSuperField(x, y, baseDamage) {
  if (!stats.superFieldEnabled || !(stats.superFieldRadiusTiles > 0) || !(stats.superFieldPower > 0) || !(baseDamage > 0)) return false;
  const duration = Math.max(0.2, stats.superFieldDuration || 0.8);
  state.superFields.push({
    x,
    y,
    radius: stats.superFieldRadiusTiles * TILE_SIZE,
    remaining: duration,
    maxDuration: duration,
    tick: 0,
    tickInterval: 0.2,
    totalDamage: baseDamage * stats.superFieldPower,
  });
  // Bound overlapping visuals and work while preserving the newest impacts.
  if (state.superFields.length > 12) state.superFields.splice(0, state.superFields.length - 12);
  state.floaters.push({ x, y: y - 24, text: 'ПОЛЕ СУПЕРКИРКИ', color: '#75ffe2', life: 0.62, maxLife: 0.62 });
  return true;
}

function attack(aimTarget = state.target) {
  if (!aimTarget || !state.target || !state.player || !state.world) return;
  const player = state.player;
  const dx = aimTarget.x - player.x;
  const dy = aimTarget.y - player.y;
  const rawLength = Math.hypot(dx, dy);
  const length = Math.max(0.001, rawLength);
  const nx = rawLength > 0.001 ? dx / rawLength : Math.cos(player.angle || 0);
  const ny = rawLength > 0.001 ? dy / rawLength : Math.sin(player.angle || 0);
  player.facing = nx < 0 ? -1 : 1;
  player.angle = Math.atan2(ny, nx);
  player.swing = 1;

  state.attackCount += 1;
  state.metrics.attacks += 1;
  const aimTile = state.world.getTile(aimTarget.tx, aimTarget.ty) || aimTarget.tile;
  const targetKey = aimTile?.veinId ? `vein:${aimTile.veinId}` : `${aimTarget.tx}:${aimTarget.ty}`;
  state.hitStreak = state.lastTargetKey === targetKey ? state.hitStreak + 1 : 1;
  state.lastTargetKey = targetKey;
  const targetOre = oreById.get(aimTile?.oreId);
  const aimVeinId = aimTile?.veinId || null;
  const aimHpBefore = aimTile && aimTile.kind !== 'air' && aimTile.kind !== 'bedrock'
    ? Math.max(0, aimTile.hp || 0)
    : 0;
  const streakBonus = 1 + Math.min(state.hitStreak, stats.streakCap || 0) * (stats.streakPower || 0);
  const densityBonus = hardnessPierceMultiplier(aimTile);
  const oreBonus = 1 + (targetOre ? (stats.oreDamageBonus || 0) : 0);
  const rareBonus = 1 + (oreRank(targetOre) >= 4 ? (stats.rareOreDamageBonus || 0) : 0);
  const focusedCalibration = focusedDamageMultiplier(aimTile);
  const charged = (stats.chargedHitPower || 0) > 0 && state.attackCount % 8 === 0;
  const chargedBonus = charged ? 1 + stats.chargedHitPower : 1;
  const critical = Math.random() < procChance(stats.critChance, 0.16);
  const eventSoftnessBonus = state.eventSoftRockRemaining > 0 && !targetOre ? 1.65 : 1;
  const approachReady = (stats.approachStrikeTravelTime || 0) > 0
    && state.approachTravelElapsed >= stats.approachStrikeTravelTime;
  const approachBonus = approachReady ? 1 + (stats.approachStrikePower || 0) : 1;
  const heatKey = `${aimTarget.tx}:${aimTarget.ty}`;
  const heatMarkActive = stats.laserUnlocked && (state.laserHeatMarks.get(heatKey) || 0) >= state.elapsed;
  const laserHeatBonus = heatMarkActive ? 1 + stats.laserHeatNextHitBonus : 1;
  const damage = stats.pickPower * streakBonus * densityBonus * oreBonus * rareBonus * chargedBonus * (critical ? stats.critMultiplier : 1) * eventSoftnessBonus * approachBonus * laserHeatBonus;
  if (
    targetOre
    && state.overkillReservoir > 0
    && (!aimVeinId || state.overkillReservoirVeinId !== aimVeinId)
  ) {
    state.overkillReservoir = 0;
    state.overkillReservoirVeinId = null;
    state.overkillYieldReady = false;
    state.overkillYieldTargetKey = null;
  }
  const reservoirAvailable = targetOre
    && aimVeinId
    && state.overkillReservoirVeinId === aimVeinId
    && stats.trueOverkillEnabled
    && (stats.overkillReservoirRatio || 0) > 0
    ? Math.max(0, state.overkillReservoir || 0)
    : 0;
  state.overkillYieldTargetKey = reservoirAvailable > 0 ? `${aimTarget.tx}:${aimTarget.ty}` : null;
  state.overkillYieldReady = Boolean(
    reservoirAvailable > 0
    && stats.overkillReservoirYieldThreshold > 0
    && reservoirAvailable >= Math.max(1, aimTile?.maxHp || aimHpBefore) * stats.overkillReservoirYieldThreshold
  );
  const aimingAtMainTarget = aimTarget.tx === state.target.tx && aimTarget.ty === state.target.ty;
  const primaryTargetWasDamageable = Boolean(
    aimingAtMainTarget
    && aimTile
    && aimTile.kind !== 'air'
    && aimTile.kind !== 'bedrock'
  );
  const primaryOreId = aimingAtMainTarget ? aimTile?.oreId : null;
  const primaryVeinId = aimingAtMainTarget ? aimVeinId : null;
  let primaryPhaseDamage = 0;
  let primaryBasePowerApplied = 0;
  let primaryOverkill = 0;
  let maxHittingLaserDamage = 0;
  let aimReceivedPrimaryHit = false;
  let toolImpactX = aimTarget.x;
  let toolImpactY = aimTarget.y;
  let hadToolImpact = false;
  const broken = [];
  const onBreak = (tile, tx, ty) => {
    broken.push({ tile, tx, ty });
    const pickSource = !aimingAtMainTarget && aimTarget.kind === 'clearance' ? 'clearance' : 'pick';
    resolveBrokenTile(tile, tx, ty, stats.laserUnlocked ? 'laser' : pickSource);
  };

  if (stats.laserUnlocked) {
    const relicBeam = state.relicSecondBeamRemaining > 0 ? 1 : 0;
    const beamCount = clamp(Math.floor(stats.laserBeams || 1) + relicBeam, 1, 6);
    for (let beamIndex = 0; beamIndex < beamCount; beamIndex += 1) {
      const offsetIndex = beamIndex - (beamCount - 1) * 0.5;
      const splitAngle = offsetIndex * 0.075;
      const cos = Math.cos(splitAngle);
      const sin = Math.sin(splitAngle);
      const beamX = nx * cos - ny * sin;
      const beamY = nx * sin + ny * cos;
      const centralBeam = beamIndex === Math.floor(beamCount / 2);
      const splitPower = centralBeam ? 1 : 0.62;
      const beamDamage = damage * (stats.laserPower || 1) * (1 + (stats.laserPierce || 1) * 0.08) * splitPower
        + (centralBeam ? reservoirAvailable : 0);
      const beamTarget = state.world.getTile(aimTarget.tx, aimTarget.ty);
      const beamHpBefore = beamTarget && beamTarget.kind !== 'air' && beamTarget.kind !== 'bedrock'
        ? Math.max(0, beamTarget.hp || 0)
        : 0;
      state.world.damageRay(
        player.x,
        player.y,
        beamX,
        beamY,
        stats.laserRange,
        beamDamage,
        Math.min(LASER_CORE_WIDTH, stats.laserWidth),
        onBreak,
      );
      const beamDamageTaken = tileDamageAmount(aimTarget.tx, aimTarget.ty, beamHpBefore);
      if (beamDamageTaken > 0) {
        hadToolImpact = true;
        primaryBasePowerApplied += beamDamage;
        maxHittingLaserDamage = Math.max(maxHittingLaserDamage, beamDamage);
        if (state.world.getTile(aimTarget.tx, aimTarget.ty)?.kind === 'air') {
          primaryOverkill += Math.max(0, beamDamage - beamHpBefore);
        }
      }
      state.beams.push({
        x: player.x,
        y: player.y,
        x2: player.x + beamX * stats.laserRange,
        y2: player.y + beamY * stats.laserRange,
        color: '#69f4da',
        life: 0.12,
        maxLife: 0.12,
        width: stats.laserWidth,
        kind: stats.tool === 'prismaticLaser' || (stats.toolTier || 0) >= 7 ? 'prism' : 'laser',
      });
    }
    primaryPhaseDamage = tileDamageAmount(aimTarget.tx, aimTarget.ty, aimHpBefore);
    aimReceivedPrimaryHit = primaryPhaseDamage > 1e-9;
    sound.tone(420, 0.07, 'sawtooth', 0.025, 360);
  } else {
    const reach = Math.min(stats.digReach, Math.max(TILE_SIZE * 0.72, length));
    const pickDamage = damage + reservoirAvailable;
    let hitX = player.x + nx * reach;
    let hitY = player.y + ny * reach;
    const impactTile = findPickContact(player, nx, ny, reach, aimTarget);
    if (impactTile) {
      hitX = (impactTile.tx + 0.5) * TILE_SIZE;
      hitY = (impactTile.ty + 0.5) * TILE_SIZE;
      toolImpactX = hitX;
      toolImpactY = hitY;
      hadToolImpact = true;
    }
    const arcBonus = clamp((stats.digArc - Math.PI / 3) / Math.PI, 0, 0.7);
    if (impactTile) {
      if (stats.areaMiningUnlocked) {
        state.world.damageCircle(hitX, hitY, stats.digRadius * (1 + arcBonus * 0.32), pickDamage, onBreak);
      } else {
        state.world.damageTile(impactTile.tx, impactTile.ty, pickDamage, onBreak);
      }
    }
    primaryPhaseDamage = tileDamageAmount(aimTarget.tx, aimTarget.ty, aimHpBefore);
    aimReceivedPrimaryHit = primaryPhaseDamage > 1e-9;
    if (aimReceivedPrimaryHit) primaryBasePowerApplied = pickDamage;
    if (aimReceivedPrimaryHit && state.world.getTile(aimTarget.tx, aimTarget.ty)?.kind === 'air') {
      primaryOverkill += Math.max(0, pickDamage - aimHpBefore);
    }
    if ((stats.splashDamage || 0) > 0 && (stats.splashRadius || 0) > 0) {
      state.world.damageCircle(hitX, hitY, stats.digRadius + stats.splashRadius, damage * stats.splashDamage, onBreak);
    }
    spawnSparks(hitX, hitY, critical ? '#fff1a6' : '#edbb66', critical ? 7 : 3);
    sound.hit(critical);
  }

  const laserImpactDamage = stats.laserUnlocked && aimReceivedPrimaryHit
    ? (maxHittingLaserDamage > 0 ? maxHittingLaserDamage : damage * (stats.laserPower || 1))
    : 0;
  if (aimReceivedPrimaryHit) {
    hadToolImpact = true;
    toolImpactX = aimTarget.x;
    toolImpactY = aimTarget.y;
  }
  if (stats.laserUnlocked && aimReceivedPrimaryHit && laserImpactDamage > 0) {
    if (heatMarkActive) {
      state.laserHeatMarks.delete(heatKey);
      state.floaters.push({ x: aimTarget.x, y: aimTarget.y - 40, text: `ЖАР +${Math.round(stats.laserHeatNextHitBonus * 100)}%`, color: '#ffb06d', life: 0.85, maxLife: 0.85 });
      state.shake = Math.max(state.shake, 5);
    }
    applyLaserEdgeHeat(aimTarget, nx, ny, laserImpactDamage);
  }
  if (
    hadToolImpact
    && stats.superFieldEnabled
    && (!stats.laserUnlocked || stats.superFieldLaserPersistent)
  ) {
    spawnSuperField(
      toolImpactX,
      toolImpactY,
      stats.laserUnlocked ? laserImpactDamage : damage,
    );
  }
  if (hadToolImpact && approachReady) {
    state.approachTravelElapsed = 0;
    state.floaters.push({ x: toolImpactX, y: toolImpactY - 28, text: 'УДАР С ХОДУ', color: '#ffe5a0', life: 0.75, maxLife: 0.75 });
    if ((stats.approachStrikeSideChip || 0) > 0) {
      damageSideChips(
        toolImpactX,
        toolImpactY,
        nx,
        ny,
        damage * stats.approachStrikeSideChip,
        1,
        'approach-chip',
      );
    }
  }
  if (
    hadToolImpact
    && (stats.sideChipEvery || 0) > 0
    && state.attackCount % stats.sideChipEvery === 0
    && (stats.sideChipPower || 0) > 0
  ) {
    damageSideChips(
      toolImpactX,
      toolImpactY,
      nx,
      ny,
      damage * stats.sideChipPower,
      stats.sideChipHits || 2,
      'side-chip',
    );
  }
  if (reservoirAvailable > 0 && targetOre && aimReceivedPrimaryHit) {
    state.overkillReservoir = 0;
    state.overkillReservoirVeinId = null;
    state.floaters.push({ x: aimTarget.x, y: aimTarget.y - 38, text: `ИМПУЛЬС +${Math.floor(reservoirAvailable)}`, color: '#d6a5ff', life: 0.8, maxLife: 0.8 });
    if (state.world.getTile(aimTarget.tx, aimTarget.ty)?.kind !== 'air') {
      state.overkillYieldReady = false;
      state.overkillYieldTargetKey = null;
    }
  }

  if (targetOre && focusedCalibration > 1 && aimReceivedPrimaryHit) {
    state.metrics.focusedCalibrationHits += 1;
    const calibrationDamage = primaryBasePowerApplied * (focusedCalibration - 1);
    const targetBeforeCalibration = state.world.getTile(aimTarget.tx, aimTarget.ty);
    if (targetBeforeCalibration?.kind !== 'air') {
      const calibrationHpBefore = Math.max(0, targetBeforeCalibration.hp || 0);
      state.world.damageTile(aimTarget.tx, aimTarget.ty, calibrationDamage, onBreak);
      if (state.world.getTile(aimTarget.tx, aimTarget.ty)?.kind === 'air') {
        primaryOverkill += Math.max(0, calibrationDamage - calibrationHpBefore);
      }
    } else {
      primaryOverkill += calibrationDamage;
    }
  }

  const primaryTargetDestroyed = Boolean(
    primaryTargetWasDamageable
    && aimReceivedPrimaryHit
    && state.world.getTile(aimTarget.tx, aimTarget.ty)?.kind === 'air'
  );
  const primaryOreDestroyed = Boolean(primaryOreId && primaryTargetDestroyed);
  if (primaryTargetDestroyed && critical) triggerFaultLine(aimTarget, nx, ny, primaryOverkill);
  if (primaryOreDestroyed && primaryOverkill > 0 && stats.trueOverkillEnabled && (stats.overkillReservoirRatio || 0) > 0) {
    const captured = primaryOverkill * stats.overkillReservoirRatio;
    state.overkillReservoir += captured;
    state.overkillReservoirVeinId = primaryVeinId;
    state.floaters.push({
      x: aimTarget.x + 8,
      y: aimTarget.y - 48,
      text: `ЗАПАС +${Math.floor(captured)}`,
      color: '#c998ff',
      life: 0.8,
      maxLife: 0.8,
    });
  }
  if (hadToolImpact) {
    triggerChronoOverdriveStrike(
      aimTarget,
      nx,
      ny,
      Math.max(damage + reservoirAvailable, laserImpactDamage),
    );
  }

  if (primaryOreId && aimReceivedPrimaryHit && state.world.getTile(aimTarget.tx, aimTarget.ty)?.kind === 'air') {
    relayCrewOverkill(
      { x: aimTarget.x, y: aimTarget.y },
      primaryOreId,
      primaryOverkill,
      [`${aimTarget.tx}:${aimTarget.ty}`],
    );
  }

  if (stats.laserUnlocked && aimReceivedPrimaryHit) {
    // Calibration is target-specific hardness reduction. The ricochet applies
    // it to its own target, so its outgoing base must remain the raw hit power.
    fireLaserRicochets(aimTarget, laserImpactDamage, onBreak);
  }

  if (stats.laserUnlocked && aimingAtMainTarget) {
    state.laserShotCount += 1;
    const cadenceDamage = Math.max(laserImpactDamage, damage * (stats.laserPower || 1));
    if (
      stats.laserSuperPickEchoEvery > 0
      && state.laserShotCount % stats.laserSuperPickEchoEvery === 0
    ) {
      triggerSuperPickEcho(aimTarget, cadenceDamage);
    }
    if (
      stats.solarDrillEnabled
      && stats.solarDrillProcEvery > 0
      && state.laserShotCount % stats.solarDrillProcEvery === 0
    ) {
      const duration = Math.max(0.12, stats.solarDrillBeamDuration || 0.7);
      state.solarDrillBursts.push({
        originX: player.x,
        originY: player.y,
        x: aimTarget.x,
        y: aimTarget.y,
        remaining: duration,
        maxDuration: duration,
        tick: 0,
        damage: cadenceDamage,
      });
      state.metrics.solarDrillBursts += 1;
      state.floaters.push({ x: aimTarget.x, y: aimTarget.y - 52, text: 'СОЛНЕЧНЫЙ БУР', color: '#fff08a', life: 1, maxLife: 1 });
      toast('ПЯТЫЙ ВЫСТРЕЛ · СОЛНЕЧНЫЙ БУР', 'success');
      sound.tone(610, 0.18, 'sawtooth', 0.03, 280);
    }
  }

  if (critical || charged) {
    state.floaters.push({ x: player.x + nx * 45, y: player.y + ny * 45, text: charged ? 'ЗАРЯД!' : 'КРИТ!', color: charged ? '#8ff7ff' : '#fff09a', life: 0.65, maxLife: 0.65 });
    state.shake = Math.max(state.shake, 6);
  }

  const impactX = player.x + nx * Math.min(length, Math.max(stats.digReach, TILE_SIZE));
  const impactY = player.y + ny * Math.min(length, Math.max(stats.digReach, TILE_SIZE));
  const guaranteedBomb = Boolean(save.pendingShowcases?.bomb);
  if (stats.bombChance > 0 && hadToolImpact && (guaranteedBomb || Math.random() < procChance(stats.bombChance, 0.18))) {
    if (guaranteedBomb) {
      save.pendingShowcases = { ...(save.pendingShowcases || {}), bomb: false };
      persistSave();
      toast('ПЕРВЫЙ ЗАРЯД · ГАРАНТИРОВАННЫЙ ПОКАЗ', 'success');
    }
    detonate(impactX, impactY, nx, ny);
  }
  if (stats.chainCount > 0 && stats.chainChance > 0 && Math.random() < procChance(stats.chainChance, 0.16)) {
    chainStrike(impactX, impactY, nx, ny);
  }

  let bonusHits = Math.max(0, Math.floor(stats.multiHitCount || 1) - 1);
  if ((stats.multiHitChance || 0) > 0 && Math.random() < procChance(stats.multiHitChance, 0.1)) bonusHits += 1;
  if (bonusHits > 0) {
    for (let index = 0; index < bonusHits; index += 1) {
      const jitter = (Math.random() - 0.5) * 0.16;
      const cos = Math.cos(jitter);
      const sin = Math.sin(jitter);
      const jx = nx * cos - ny * sin;
      const jy = nx * sin + ny * cos;
      const bonusX = player.x + jx * stats.digReach;
      const bonusY = player.y + jy * stats.digReach;
      const bonusPoint = state.world.worldToTile(bonusX, bonusY);
      const bonusTargetTile = state.world.getTile(bonusPoint.tx, bonusPoint.ty);
      const bonusHpBefore = bonusTargetTile?.oreId ? Math.max(0, bonusTargetTile.hp || 0) : 0;
      const bonusCalibration = focusedDamageMultiplier(bonusTargetTile);
      const onMultiBreak = (tile, tx, ty) => resolveBrokenTile(tile, tx, ty, 'multi');
      if (stats.areaMiningUnlocked) {
        state.world.damageCircle(bonusX, bonusY, stats.digRadius * 0.75, stats.pickPower * 0.65, onMultiBreak);
      } else {
        state.world.damageTile(bonusPoint.tx, bonusPoint.ty, stats.pickPower * 0.65, onMultiBreak);
      }
      const bonusDamage = tileDamageAmount(bonusPoint.tx, bonusPoint.ty, bonusHpBefore);
      if (bonusDamage > 0 && bonusCalibration > 1) {
        state.metrics.focusedCalibrationHits += 1;
        if (state.world.getTile(bonusPoint.tx, bonusPoint.ty)?.kind !== 'air') {
          state.world.damageTile(
            bonusPoint.tx,
            bonusPoint.ty,
            bonusDamage * (bonusCalibration - 1),
            onMultiBreak,
          );
        }
      }
    }
  }
  if (critical && (stats.overkillCarry || 0) > 0 && Math.random() < procChance(stats.overkillCarry, 0.08)) {
    state.world.damageCircle(impactX + nx * TILE_SIZE, impactY + ny * TILE_SIZE, stats.digRadius, damage * 0.45, onBreak);
  }
}

function addGadgetOverkill(reserves, oreId, veinId, hpBefore, damage) {
  if (!stats.trueOverkillEnabled || !oreId || !veinId || !(stats.overkillReservoirRatio > 0)) return 0;
  const captured = Math.max(0, damage - Math.max(0, hpBefore)) * stats.overkillReservoirRatio;
  if (!(captured > 0)) return 0;
  reserves.set(veinId, (reserves.get(veinId) || 0) + captured);
  return captured;
}

function commitGadgetOverkill(reserves) {
  if (!(reserves instanceof Map) || reserves.size <= 0) return { added: 0, total: 0, veinId: null };
  const previousVeinId = state.overkillReservoirVeinId;
  const previousReserve = previousVeinId ? Math.max(0, state.overkillReservoir || 0) : 0;
  const candidates = new Map();
  for (const [veinId, amount] of reserves) {
    if (!veinId || !(amount > 0)) continue;
    candidates.set(veinId, amount + (veinId === previousVeinId ? previousReserve : 0));
  }
  if (previousVeinId && previousReserve > 0 && !candidates.has(previousVeinId)) {
    candidates.set(previousVeinId, previousReserve);
  }

  let selectedVeinId = null;
  let selectedTotal = 0;
  for (const [veinId, amount] of candidates) {
    const preferExistingTie = amount === selectedTotal && veinId === previousVeinId;
    if (amount > selectedTotal || preferExistingTie) {
      selectedVeinId = veinId;
      selectedTotal = amount;
    }
  }
  if (!selectedVeinId || !(selectedTotal > 0)) return { added: 0, total: 0, veinId: null };

  state.overkillReservoir = selectedTotal;
  state.overkillReservoirVeinId = selectedVeinId;
  state.overkillYieldReady = false;
  state.overkillYieldTargetKey = null;
  return {
    added: Math.max(0, reserves.get(selectedVeinId) || 0),
    total: selectedTotal,
    veinId: selectedVeinId,
  };
}

function storeGadgetOverkill(oreId, veinId, hpBefore, damage, x, y, show = false) {
  const reserves = new Map();
  addGadgetOverkill(reserves, oreId, veinId, hpBefore, damage);
  const retained = commitGadgetOverkill(reserves);
  if (show && retained.added > 0) {
    state.floaters.push({ x, y: y - 34, text: `ЗАПАС +${Math.floor(retained.added)}`, color: '#c998ff', life: 0.75, maxLife: 0.75 });
  }
  return retained.added;
}

function snapshotOreHpInCircle(x, y, radius) {
  const snapshot = new Map();
  if (!stats.trueOverkillEnabled || !state.world || !(radius > 0)) return snapshot;
  const min = state.world.worldToTile(x - radius - TILE_SIZE, y - radius - TILE_SIZE);
  const max = state.world.worldToTile(x + radius + TILE_SIZE, y + radius + TILE_SIZE);
  const radiusSquared = radius * radius;
  for (let ty = Math.max(0, min.ty); ty <= Math.min(WORLD_CONFIG.HEIGHT - 1, max.ty); ty += 1) {
    for (let tx = Math.max(0, min.tx); tx <= Math.min(WORLD_CONFIG.WIDTH - 1, max.tx); tx += 1) {
      const tile = state.world.getTile(tx, ty);
      if (!tile?.oreId || tile.kind === 'air' || tile.kind === 'bedrock') continue;
      const left = tx * TILE_SIZE;
      const top = ty * TILE_SIZE;
      const closestX = clamp(x, left, left + TILE_SIZE);
      const closestY = clamp(y, top, top + TILE_SIZE);
      if ((x - closestX) ** 2 + (y - closestY) ** 2 > radiusSquared) continue;
      snapshot.set(`${tx}:${ty}`, { oreId: tile.oreId, veinId: tile.veinId, hp: Math.max(0, tile.hp || 0), tx, ty });
    }
  }
  return snapshot;
}

function collectCircleGadgetOverkill(brokenTiles, snapshot, damage, x, y) {
  if (!Array.isArray(brokenTiles) || !brokenTiles.length || !snapshot?.size) return 0;
  const reserves = new Map();
  for (const broken of brokenTiles) {
    const before = snapshot.get(`${broken.tx}:${broken.ty}`);
    if (!before) continue;
    addGadgetOverkill(reserves, before.oreId, before.veinId, before.hp, damage);
  }
  const retained = commitGadgetOverkill(reserves);
  if (retained.added > 0) {
    state.floaters.push({ x, y: y - 40, text: `ЗАПАС ГАДЖЕТОВ +${Math.floor(retained.added)}`, color: '#c998ff', life: 0.8, maxLife: 0.8 });
  }
  return retained.added;
}

function damageBombShape(x, y, radius, power, directionX, directionY, source = 'bomb') {
  const magnitude = Math.hypot(directionX, directionY);
  const directional = Boolean(stats.directionalBombs && stats.directionalBombConeTiles > 0 && magnitude > 0.001);
  // The sector is sampled once per blast. Destroying one of its endpoint
  // nodes during the AoE must not revoke the bonus from later candidates in
  // that same explosion.
  const triangleSnapshot = getTriangulationTriangle();
  if (directional) state.metrics.directionalBlasts += 1;
  const nx = directional ? directionX / magnitude : 0;
  const ny = directional ? directionY / magnitude : 1;
  const centerRadius = directional ? radius * 0.58 : radius;
  const coneLength = directional ? radius * 0.65 + stats.directionalBombConeTiles * TILE_SIZE : 0;
  const tileReach = TILE_SIZE * Math.SQRT1_2;
  const reach = centerRadius + coneLength + tileReach;
  const min = state.world.worldToTile(x - reach, y - reach);
  const max = state.world.worldToTile(x + reach, y + reach);
  const candidates = [];

  for (let ty = Math.max(0, min.ty); ty <= Math.min(WORLD_CONFIG.HEIGHT - 1, max.ty); ty += 1) {
    for (let tx = Math.max(0, min.tx); tx <= Math.min(WORLD_CONFIG.WIDTH - 1, max.tx); tx += 1) {
      const tile = state.world.getTile(tx, ty);
      if (!tile || tile.kind === 'air' || tile.kind === 'bedrock') continue;
      const tileX = (tx + 0.5) * TILE_SIZE;
      const tileY = (ty + 0.5) * TILE_SIZE;
      const dx = tileX - x;
      const dy = tileY - y;
      const radialDistance = Math.hypot(dx, dy);
      const inCenter = radialDistance <= centerRadius + tileReach;
      let inCone = false;
      let progress = 0;
      if (directional) {
        const projection = dx * nx + dy * ny;
        const lateral = Math.abs(dx * -ny + dy * nx);
        progress = clamp(projection / Math.max(1, coneLength), 0, 1);
        const halfWidth = radius * (0.2 + progress * 0.65) + tileReach;
        inCone = projection >= 0 && projection <= coneLength + tileReach && lateral <= halfWidth;
      }
      if (!inCenter && !inCone) continue;
      candidates.push({
        tx,
        ty,
        order: inCenter ? radialDistance : centerRadius + progress * coneLength,
        factor: inCenter ? 1 : 0.9 - progress * 0.18,
      });
    }
  }

  candidates.sort((left, right) => left.order - right.order || left.ty - right.ty || left.tx - right.tx);
  const gadgetOverkillReserves = new Map();
  for (const candidate of candidates) {
    const tile = state.world.getTile(candidate.tx, candidate.ty);
    if (!tile || tile.kind === 'air' || tile.kind === 'bedrock') continue;
    const hpBefore = tile.hp || 0;
    const oreId = tile.oreId;
    const veinId = tile.veinId;
    const triangularBonus = tileInsideTriangulation(candidate.tx, candidate.ty, triangleSnapshot)
      ? stats.triangularFixGadgetDamageBonus
      : 0;
    if (triangularBonus > 0) state.metrics.triangleBuffHits += 1;
    const amount = power * candidate.factor * focusedDamageMultiplier(tile) * (1 + triangularBonus);
    const brokenTiles = state.world.damageTile(candidate.tx, candidate.ty, amount, (brokenTile, tx, ty) => resolveBrokenTile(brokenTile, tx, ty, source));
    if (oreId && brokenTiles.length) {
      addGadgetOverkill(
        gadgetOverkillReserves,
        oreId,
        veinId,
        hpBefore,
        amount,
      );
    }
    const beacon = getCrewBeacon();
    if (oreId && tile.kind === 'air' && beacon?.veinId && veinId === beacon.veinId) {
      relayCrewOverkill(
        { x: (candidate.tx + 0.5) * TILE_SIZE, y: (candidate.ty + 0.5) * TILE_SIZE },
        oreId,
        Math.max(0, amount - hpBefore),
        [`${candidate.tx}:${candidate.ty}`],
      );
    }
  }
  const retainedGadgetOverkill = commitGadgetOverkill(gadgetOverkillReserves);
  if (retainedGadgetOverkill.added > 0) {
    state.floaters.push({ x, y: y - 44, text: `ЗАПАС БОМБЫ +${Math.floor(retainedGadgetOverkill.added)}`, color: '#c998ff', life: 0.8, maxLife: 0.8 });
  }

  if (directional) {
    const halfAngle = Math.atan2(radius * 0.72, Math.max(TILE_SIZE, coneLength));
    const baseAngle = Math.atan2(ny, nx);
    for (const sign of [-1, 1]) {
      const angle = baseAngle + halfAngle * sign;
      state.beams.push({
        x,
        y,
        x2: x + Math.cos(angle) * coneLength,
        y2: y + Math.sin(angle) * coneLength,
        color: '#ffb65c',
        life: 0.2,
        maxLife: 0.2,
        width: 2,
        kind: 'blast-guide',
      });
    }
  }
}

function detonate(x, y, directionX = 0, directionY = 1, options = {}) {
  const noProcs = Boolean(options.noProcs);
  const source = options.source || 'bomb';
  sound.boom();
  state.shake = Math.max(state.shake, 15);
  flash('#f0a24c', 0.28);
  const volatile = !noProcs && (stats.volatileBombChance || 0) > 0 && Math.random() < procChance(stats.volatileBombChance, 0.1);
  const sticky = !noProcs && (stats.stickyBombChance || 0) > 0 && Math.random() < procChance(stats.stickyBombChance, 0.12);
  const beacon = getCrewBeacon();
  let blastX = x;
  let blastY = y;
  let blastDirectionX = directionX;
  let blastDirectionY = directionY;
  const focusedOre = getFocusedOre();
  const stickySearchRadius = Math.max(stats.bombRadius * 2.5, TILE_SIZE * 2.5);
  const stickyTarget = sticky
    ? beacon || findBestOreTarget(
      x,
      y,
      stickySearchRadius,
      focusedOre?.id || null,
      { ignoreSenseLine: true },
    ) || (focusedOre
      ? findBestOreTarget(x, y, stickySearchRadius, null, { ignoreSenseLine: true })
      : null)
    : null;
  const activeFieldTarget = findMagneticFieldTarget(focusedOre);
  const prospectiveField = stats.magneticFieldEnabled && stats.magneticFieldRadiusTiles > 0
    ? { x, y, radius: stats.magneticFieldRadiusTiles * TILE_SIZE }
    : null;
  // The very bomb that creates the field is guided too; waiting for a second
  // bomb made the headline behavior effectively invisible in short runs.
  const guidedTarget = activeFieldTarget || findValuableOreInField(prospectiveField, focusedOre);
  if (guidedTarget) {
    blastDirectionX = guidedTarget.x - x;
    blastDirectionY = guidedTarget.y - y;
    blastX = guidedTarget.x;
    blastY = guidedTarget.y;
  } else if (stickyTarget) {
    blastDirectionX = stickyTarget.x - x;
    blastDirectionY = stickyTarget.y - y;
    blastX = stickyTarget.x;
    blastY = stickyTarget.y;
  }
  if (stats.magneticFieldEnabled && stats.magneticFieldDuration > 0 && stats.magneticFieldRadiusTiles > 0) {
    state.magneticField = {
      x: blastX,
      y: blastY,
      radius: stats.magneticFieldRadiusTiles * TILE_SIZE,
      remaining: stats.magneticFieldDuration,
      maxDuration: stats.magneticFieldDuration,
    };
    revealMagneticFieldOres(state.magneticField);
    state.metrics.magneticFields += 1;
  }
  const blastPoint = state.world.worldToTile(blastX, blastY);
  const blastTile = state.world.getTile(blastPoint.tx, blastPoint.ty);
  if (!noProcs && source === 'bomb') {
    const nearestVeinTarget = blastTile?.veinId
      ? null
      : findBestOreTarget(
        blastX,
        blastY,
        Math.max(stats.bombRadius, TILE_SIZE * 1.5),
        null,
        { ignoreSenseLine: true },
      );
    const comboTile = nearestVeinTarget?.tile || blastTile;
    advanceDemolitionCombo('bomb', {
      x: blastX,
      y: blastY,
      tx: blastPoint.tx,
      ty: blastPoint.ty,
      tile: comboTile,
      veinId: comboTile?.veinId || null,
    });
  }
  const radius = stats.bombRadius * (volatile ? 1.75 : 1);
  const power = stats.pickPower * stats.bombPower * 1.8 * (volatile ? 2.2 : 1) * (sticky ? 1.45 : 1)
    * magneticGadgetMultiplier(blastX, blastY);
  damageBombShape(blastX, blastY, radius, power, blastDirectionX, blastDirectionY, source);
  const fragments = Math.min(6, Math.floor(stats.bombFragments || 0));
  for (let index = 0; index < fragments; index += 1) {
    const angle = index / Math.max(1, fragments) * Math.PI * 2 + Math.random() * 0.4;
    const fragmentX = blastX + Math.cos(angle) * radius * 0.72;
    const fragmentY = blastY + Math.sin(angle) * radius * 0.72;
    const fragmentRadius = radius * 0.36;
    const fragmentPower = power * (stats.bombFragmentPower || 0.3);
    const fragmentSnapshot = snapshotOreHpInCircle(fragmentX, fragmentY, fragmentRadius);
    const fragmentBreaks = state.world.damageCircle(
      fragmentX,
      fragmentY,
      fragmentRadius,
      fragmentPower,
      (tile, tx, ty) => resolveBrokenTile(tile, tx, ty, source),
    );
    collectCircleGadgetOverkill(fragmentBreaks, fragmentSnapshot, fragmentPower, fragmentX, fragmentY);
  }
  if (volatile) toast('НЕСТАБИЛЬНЫЙ ЗАРЯД!', 'warning');
  state.shocks.push({
    x: blastX,
    y: blastY,
    life: 0.48,
    maxLife: 0.48,
    tick: Infinity,
    radius,
    color: volatile ? '#ff6f4e' : '#ffc45d',
    kind: 'blast',
  });
  const blastParticleCount = REDUCED_MOTION ? 14 : 26;
  for (let index = 0; index < blastParticleCount; index += 1) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 55 + Math.random() * 180;
    state.particles.push({
      x: blastX,
      y: blastY,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      size: 2 + Math.random() * 6,
      color: index % 3 ? '#e06b3e' : '#ffd67d',
      life: 0.65 + Math.random() * 0.5,
      maxLife: 1.1,
      gravity: 80,
      glow: true,
      kind: index % 4 === 0 ? 'blast-chip' : 'blast-ember',
    });
  }
}

function chainStrike(x, y, nx, ny) {
  let fromX = x;
  let fromY = y;
  const visited = new Set();
  for (let index = 0; index < Math.floor(stats.chainCount); index += 1) {
    const focusedOre = getFocusedOre();
    const beacon = getCrewBeacon();
    const targetOreId = beacon?.oreId || focusedOre?.id || null;
    const triangle = getTriangulationTriangle();
    const chainRangeBonus = triangle ? 1 + stats.triangularFixRangeBonus : 1;
    const fieldRangeMultiplier = activeMagneticField() ? 1 + stats.magneticFieldTargetingBonus : 1;
    const magneticTarget = findMagneticFieldTarget(focusedOre, visited);
    const target = magneticTarget || findBeaconAwareTarget(
      fromX + nx * TILE_SIZE,
      fromY + ny * TILE_SIZE,
      stats.senseRadius * 0.65 * (focusedOre ? focusedSenseMultiplier(focusedOre) : 1) * chainRangeBonus * fieldRangeMultiplier,
      focusedOre,
      beacon,
      { excludedKeys: visited },
    );
    if (!target) break;
    visited.add(`${target.tx}:${target.ty}`);
    const inTriangle = pointInTriangle(target.x, target.y, triangle);
    const gadgetBonus = inTriangle ? stats.triangularFixGadgetDamageBonus : 0;
    if (gadgetBonus > 0 || (triangle && stats.triangularFixRangeBonus > 0)) state.metrics.triangleBuffHits += 1;
    const power = stats.pickPower * (stats.chainPower || 0.55) * (1 + gadgetBonus)
      * magneticGadgetMultiplier(target.x, target.y);
    const hpBefore = target.tile.hp || 0;
    const comboTarget = { ...target, veinId: target.tile?.veinId || null };
    const calibration = focusedDamageMultiplier(target.tile);
    const chainRadius = Math.max(10, stats.digRadius * 0.55);
    const chainSnapshot = snapshotOreHpInCircle(target.x, target.y, chainRadius);
    const chainBreaks = state.world.damageCircle(target.x, target.y, chainRadius, power, (tile, tx, ty) => resolveBrokenTile(tile, tx, ty, 'chain'));
    collectCircleGadgetOverkill(chainBreaks, chainSnapshot, power, target.x, target.y);
    if (calibration > 1 && target.tile.kind !== 'air') {
      const calibrationPower = power * (calibration - 1);
      const calibrationHp = target.tile.hp || 0;
      const calibrationOreId = target.tile.oreId;
      const calibrationVeinId = target.tile.veinId;
      const calibrationBreaks = state.world.damageTile(target.tx, target.ty, calibrationPower, (tile, tx, ty) => resolveBrokenTile(tile, tx, ty, 'chain'));
      if (calibrationBreaks.length) storeGadgetOverkill(calibrationOreId, calibrationVeinId, calibrationHp, calibrationPower, target.x, target.y, true);
    }
    if (target.tile.kind === 'air') {
      relayCrewOverkill(target, targetOreId, Math.max(0, power * calibration - hpBefore), visited);
    }
    advanceDemolitionCombo('chain', comboTarget);
    const beamLife = 0.18 + (stats.shockDuration || 0);
    state.beams.push({ x: fromX, y: fromY, x2: target.x, y2: target.y, color: '#b58cff', life: beamLife, maxLife: beamLife, width: 3, kind: 'chain' });
    if ((stats.shockDuration || 0) > 0) {
      state.shocks.push({ x: target.x, y: target.y, life: stats.shockDuration, maxLife: stats.shockDuration, tick: 0.12, kind: 'chain-impact', color: '#b58cff' });
    }
    fromX = target.x;
    fromY = target.y;
  }
  sound.tone(520, 0.12, 'sine', 0.025, 260);
}

function microEventIndicatorRemaining(event = state.activeMicroEvent) {
  if (!event) return 0;
  if (event.type === 'fragile_cavity') return state.eventSoftRockRemaining;
  if (event.type === 'gas_pocket') return state.eventDigBoostRemaining;
  if (event.type === 'rich_lens') return state.eventYieldBoostRemaining;
  if (event.type === 'underground_flow') return state.eventMoveBoostRemaining;
  return state.eventBannerTimer;
}

function fallbackTimedMicroEvent() {
  const candidates = [
    { type: 'fragile_cavity', remaining: state.eventSoftRockRemaining, indicatorText: 'МЯГКАЯ ПОРОДА · УРОН ПО ПОРОДЕ +65%', color: '#ffb45b' },
    { type: 'gas_pocket', remaining: state.eventDigBoostRemaining, indicatorText: 'УСКОРЕНИЕ КОПКИ +50%', color: '#a8f06a' },
    { type: 'rich_lens', remaining: state.eventYieldBoostRemaining, indicatorText: 'ВЫХОД РУДЫ ×1,5', color: '#ffe36e' },
    { type: 'underground_flow', remaining: state.eventMoveBoostRemaining, indicatorText: 'СКОРОСТЬ ДВИЖЕНИЯ +35%', color: '#58c9ff' },
  ].filter((event) => event.remaining > 0.001)
    .sort((left, right) => right.remaining - left.remaining);
  const event = candidates[0] || null;
  return event ? { ...event, label: event.indicatorText, restoredIndicator: true } : null;
}

function formatMicroEventTimer(seconds) {
  return `${Math.max(0, seconds).toFixed(1).replace('.', ',')} С`;
}

function updateMicroEventIndicator() {
  if (!ui.microEventBanner) return;
  let event = state.activeMicroEvent;
  let remaining = microEventIndicatorRemaining(event);
  if (!event || remaining <= 0) {
    event = fallbackTimedMicroEvent();
    state.activeMicroEvent = event;
    remaining = microEventIndicatorRemaining(event);
  }
  if (state.mode !== 'run' || !event || remaining <= 0) {
    ui.microEventBanner.classList.add('hidden');
    if (remaining <= 0) state.activeMicroEvent = null;
    return;
  }
  if (ui.microEventTitle) ui.microEventTitle.textContent = event.indicatorText || event.label || event.type;
  ui.microEventBanner.style.setProperty('--event-color', event.color || '#ffd170');
  if (ui.microEventTimer) ui.microEventTimer.textContent = formatMicroEventTimer(remaining);
  ui.microEventBanner.classList.remove('hidden');
}

function showMicroEventIndicator(event, text) {
  if (!ui.microEventBanner || !event) return;
  if (ui.microEventTitle) ui.microEventTitle.textContent = text || event.label || event.type;
  ui.microEventBanner.style.setProperty('--event-color', event.color || '#ffd170');
  updateMicroEventIndicator();
}

function perkStatusEntries() {
  if (state.mode !== 'run') return [];
  const entries = [];
  const add = (label, value, color) => entries.push({ label, value: String(value || ''), color });
  const targetTile = state.target?.kind === 'ore'
    ? state.world?.getTile(state.target.tx, state.target.ty)
    : null;
  const targetVein = targetTile?.veinId ? state.veinRuntime.get(targetTile.veinId) : null;
  if (targetVein?.motherlode) add('Материнская жила', '×2', '#fff0a6');
  else if (targetVein?.rich) add('Богатая жила', `+${Math.round((stats.richVeinYieldBonus || 0) * 100)}%`, '#f2c95d');
  if (state.chronoOverflowRemaining > 0) {
    add('Хронофорсаж', `${Math.ceil(state.chronoOverflowRemaining)}с`, '#8ff8ef');
  }
  if (state.quarryModeActive && state.quarryModeRemaining > 0) {
    add('Карьерный темп', `${Math.ceil(state.quarryModeRemaining)}с`, '#ffb56f');
  }
  const field = activeMagneticField();
  if (field) add('Магнитное поле', `${Math.ceil(field.remaining)}с`, '#74dfff');
  const relicAuxiliaryRemaining = Math.max(
    state.relicDigBoostRemaining || 0,
    state.relicYieldBoostRemaining || 0,
    state.relicGadgetBoostRemaining || 0,
  );
  const relicParts = [];
  if (state.relicSecondBeamRemaining > 0) relicParts.push(`луч ${Math.ceil(state.relicSecondBeamRemaining)}с`);
  if (state.relicSoftRockRemaining > 0) relicParts.push(`порода ${Math.ceil(state.relicSoftRockRemaining)}с`);
  if (relicAuxiliaryRemaining > 0) relicParts.push(`усиление ${Math.ceil(relicAuxiliaryRemaining)}с`);
  if (state.relicChestBoostCharges > 0) relicParts.push(`сундук ×${state.relicChestBoostCharges}`);
  if (relicParts.length) add('Реликвия', relicParts.join(' · '), '#ff9fe3');
  if (state.demolitionComboStage > 0) add('Оркестр', `${state.demolitionComboStage}/3`, '#ca9cff');
  const sampleVeinId = targetTile?.veinId || state.lastBrokenVeinId;
  const sampleProgress = sampleVeinId ? state.tripleSampleVeins.get(sampleVeinId)?.count || 0 : 0;
  if ((stats.tripleSampleEvery || 0) > 0) add('Тройная проба', `${sampleProgress}/${stats.tripleSampleEvery}`, '#e7b9ff');
  if (stats.fortuneWheelEnabled && stats.fortunePityThreshold > 0) {
    add('Колесо', `${state.fortunePityCounter}/${stats.fortunePityThreshold}`, '#ffe37c');
  }
  if (stats.motherlodeGuaranteed && !state.motherlodeTriggered && !targetVein?.motherlode) {
    add('Материнская', `${Math.min(state.motherlodeBreaks, stats.motherlodeTriggerBreaks)}/${stats.motherlodeTriggerBreaks}`, '#fff0a6');
  }
  if (state.overkillReservoir > 0.5) add('Импульс', Math.round(state.overkillReservoir), '#ffcf84');
  return entries;
}

function updatePerkStatusRail() {
  if (!ui.perkStatusRail) return;
  const entries = perkStatusEntries();
  if (!entries.length) {
    ui.perkStatusRail.classList.add('hidden');
    ui.perkStatusRail.dataset.signature = '';
    ui.perkStatusRail.replaceChildren();
    return;
  }
  const signature = entries.map((entry) => `${entry.label}:${entry.value}`).join('|');
  if (ui.perkStatusRail.dataset.signature !== signature) {
    const fragment = document.createDocumentFragment();
    for (const entry of entries) {
      const item = document.createElement('span');
      item.className = 'perk-status-rail__item';
      item.style.setProperty('--perk-color', entry.color);
      const dot = document.createElement('i');
      dot.setAttribute('aria-hidden', 'true');
      const label = document.createElement('span');
      label.textContent = entry.label;
      const value = document.createElement('strong');
      value.textContent = entry.value;
      item.append(dot, label, value);
      fragment.append(item);
    }
    ui.perkStatusRail.replaceChildren(fragment);
    ui.perkStatusRail.dataset.signature = signature;
  }
  ui.perkStatusRail.classList.remove('hidden');
}

function applyMicroEvent(event) {
  if (!event || !state.world || state.mode !== 'run') return false;
  const triggered = typeof state.world.triggerMicroEvent === 'function'
    ? state.world.triggerMicroEvent(event.id)
    : event;
  if (!triggered) return false;
  const x = triggered.x;
  const y = triggered.y;
  const duration = Math.max(0, Number(triggered.durationSeconds) || 0);
  let indicatorText = 'УСЛОВИЯ СМЕНЫ ИЗМЕНЕНЫ';

  if (triggered.type === 'fragile_cavity') {
    state.eventSoftRockRemaining = Math.max(state.eventSoftRockRemaining, duration || 5);
    indicatorText = 'МЯГКАЯ ПОРОДА · УРОН ПО ПОРОДЕ +65%';
  } else if (triggered.type === 'gas_pocket') {
    state.eventDigBoostRemaining = Math.max(state.eventDigBoostRemaining, duration || 5);
    indicatorText = 'УСКОРЕНИЕ КОПКИ +50%';
  } else if (triggered.type === 'rich_lens') {
    state.eventYieldBoostRemaining = Math.max(state.eventYieldBoostRemaining, duration || 5);
    indicatorText = 'ВЫХОД РУДЫ ×1,5';
  } else if (triggered.type === 'ancient_container') {
    const enhancedByRelic = state.relicChestBoostCharges > 0;
    const chestMultiplier = enhancedByRelic ? 2 : 1;
    const lootEntries = Object.entries(triggered.loot || {})
      .filter(([oreId, amount]) => oreById.has(oreId) && Number(amount) > 0);
    let pieces = 0;
    const labels = [];
    for (const [oreId, rawAmount] of lootEntries) {
      const amount = Math.max(1, Math.floor(Number(rawAmount) || 0)) * chestMultiplier;
      const rewardOre = oreById.get(oreId);
      state.oreCounts[oreId] = (state.oreCounts[oreId] || 0) + amount;
      state.discoveredOreIds.add(oreId);
      pieces += amount;
      labels.push(`${rewardOre.name} ×${amount}`);
    }
    state.runOre += pieces;
    addBonusTime(0.5, x, y - 38, 'КОНТЕЙНЕР');
    if (enhancedByRelic) {
      state.relicChestBoostCharges -= 1;
      activateRelicEffect(x, y, true);
    }
    indicatorText = `${enhancedByRelic ? 'УСИЛЕННЫЙ СУНДУК' : 'СУНДУК'} · ${labels.join(', ') || 'ПУСТО'}${pieces ? ' · +0,5 С' : ''}`;
  } else if (triggered.type === 'underground_flow') {
    state.eventMoveBoostRemaining = Math.max(state.eventMoveBoostRemaining, duration || 5);
    state.pathWaypoint = null;
    state.pathCooldown = 0;
    indicatorText = 'СКОРОСТЬ ДВИЖЕНИЯ +35%';
  }

  state.metrics.eventCount += 1;
  state.metrics.microEvents[triggered.type] = (state.metrics.microEvents[triggered.type] || 0) + 1;
  const bannerDuration = Math.max(2.2, duration);
  state.activeMicroEvent = { ...triggered, indicatorText };
  if (triggered.id === state.stagedEventId) {
    state.pityEventArmed = false;
    state.stagedEventId = null;
  }
  state.eventBannerTimer = bannerDuration;
  if (typeof state.world.consumeMicroEvent === 'function') state.world.consumeMicroEvent(triggered.id);
  showMicroEventIndicator(triggered, indicatorText);
  sound.tone(180, 0.18, 'triangle', 0.04, 320);
  return true;
}

function findPriorityChestTarget() {
  if (!state.player || !state.world || typeof state.world.getMicroEventsNear !== 'function') return null;
  const point = state.world.worldToTile(state.player.x, state.player.y);
  const senseTiles = Math.max(1, effectiveSenseRadius() / TILE_SIZE);
  const stagedEvent = state.pityEventArmed && state.stagedEventId
    ? state.world.getMicroEvents().find((event) => event.id === state.stagedEventId) || null
    : null;
  const stagedChest = stagedEvent?.type === 'ancient_container' ? stagedEvent : null;
  const chest = stagedChest || state.world.getMicroEventsNear(
    point.tx,
    point.ty,
    senseTiles,
    { type: 'ancient_container' },
  ).find((event) => event.distanceTiles <= senseTiles) || null;
  if (!chest) return null;
  return {
    kind: 'micro_event',
    eventId: chest.id,
    eventType: chest.type,
    tx: chest.tx,
    ty: chest.ty,
    x: chest.x,
    y: chest.y,
    tile: state.world.getTile(chest.tx, chest.ty),
    distance: distance(state.player.x, state.player.y, chest.x, chest.y),
    lockRadius: effectiveSenseRadius(),
  };
}

function checkMicroEventsAt(x, y, fromBreak = false) {
  if (!state.world || typeof state.world.getMicroEventsNear !== 'function' || !Number.isFinite(x) || !Number.isFinite(y)) return null;
  const point = state.world.worldToTile(x, y);
  const senseTiles = Math.max(2.5, effectiveSenseRadius() / TILE_SIZE * 0.78);
  const nearby = state.world.getMicroEventsNear(point.tx, point.ty, senseTiles);
  const closest = nearby[0] || null;
  if (!closest) return null;
  const triggerMargin = fromBreak ? 1.15 : 0.2;
  if ((closest.distanceToEdgeTiles || 0) <= triggerMargin) applyMicroEvent(closest);
  return closest;
}

function veinTravelSpeedMultiplier(target = state.target) {
  if (!target || target.kind !== 'ore' || !state.world) return 1;
  const tile = state.world.getTile(target.tx, target.ty);
  const veinId = tile?.veinId || null;
  if (!veinId) return 1;
  let bonus = 0;
  if (veinId === state.lastBrokenVeinId) bonus += stats.veinTrailMoveSpeedBonus || 0;
  if (stats.veinLockEnabled && veinId === state.lockedVeinId) bonus += stats.veinLockMoveSpeedBonus || 0;
  const focusedOre = getFocusedOre();
  if (focusedOre?.id === tile.oreId && veinId === state.lastBrokenVeinId) {
    bonus += Math.min(6, state.veinBreakStreak || 0) * (stats.focusMoveSpeedPerNode || 0);
  }
  if (state.quarryModeActive && veinId === state.quarryVeinId) bonus += stats.quarryModeMoveSpeedBonus || 0;
  return 1 + bonus;
}

function quarryDigSpeedMultiplier() {
  if (!state.quarryModeActive || remainingVeinNodes(state.quarryVeinId) <= 0) return 1;
  return 1 + (stats.quarryModeDigSpeedBonus || 0);
}

function updateSuperFields(delta) {
  if (!state.superFields.length || !state.world) return;
  const survivors = [];
  for (const field of state.superFields) {
    field.remaining -= delta;
    field.tick -= delta;
    while (field.tick <= 0 && field.remaining > 0) {
      field.tick += field.tickInterval;
      const tickDamage = field.totalDamage * field.tickInterval / Math.max(field.tickInterval, field.maxDuration);
      state.world.damageCircle(
        field.x,
        field.y,
        field.radius,
        tickDamage,
        (tile, tx, ty) => resolveBrokenTile(tile, tx, ty, 'super_field'),
      );
      state.shocks.push({ x: field.x, y: field.y, life: 0.22, maxLife: 0.22, tick: Infinity, radius: field.radius, color: '#65ffe3', kind: 'field' });
    }
    if (field.remaining > 0) survivors.push(field);
  }
  state.superFields = survivors;
}

function updateSolarDrillBursts(delta) {
  if (!state.solarDrillBursts.length || !state.world) return;
  const survivors = [];
  for (const burst of state.solarDrillBursts) {
    burst.remaining -= delta;
    burst.tick -= delta;
    while (burst.tick <= 0 && burst.remaining > 0) {
      burst.tick += 0.12;
      const heldBeamDamage = burst.damage * 0.12 / Math.max(0.12, burst.maxDuration || stats.solarDrillBeamDuration || 0.7);
      state.world.damageCircle(
        burst.x,
        burst.y,
        Math.max(TILE_SIZE * 0.45, stats.laserWidth || 8),
        heldBeamDamage,
        (tile, tx, ty) => resolveBrokenTile(tile, tx, ty, 'solar'),
      );
      state.beams.push({
        x: burst.originX,
        y: burst.originY,
        x2: burst.x,
        y2: burst.y,
        color: '#fff08a',
        life: 0.14,
        maxLife: 0.14,
        width: Math.max(4, stats.laserWidth * 0.8),
        kind: 'solar',
      });
    }
    if (burst.remaining <= 0) {
      const finalPower = Math.max(0, stats.solarDrillFinalBurstPower || 0);
      if (finalPower > 0) {
        state.world.damageCircle(
          burst.x,
          burst.y,
          TILE_SIZE * 1.15,
          burst.damage * finalPower,
          (tile, tx, ty) => resolveBrokenTile(tile, tx, ty, 'solar'),
        );
        state.shocks.push({ x: burst.x, y: burst.y, life: 0.5, maxLife: 0.5, tick: Infinity, radius: TILE_SIZE * 1.15, color: '#fff08a', kind: 'solar' });
        spawnSparks(burst.x, burst.y, '#fff6a8', 16);
      }
    } else {
      survivors.push(burst);
    }
  }
  state.solarDrillBursts = survivors;
}

function updateRun(delta, now = performance.now()) {
  if (state.paused || !state.player || !state.world) return;
  state.activeWallElapsed = Math.max(0, (now - state.runStartedAt) / 1000);
  if (state.activeWallElapsed >= getBonusRunCap()) {
    state.timeLeft = 0;
    updateHud();
    finishRun();
    return;
  }
  state.elapsed += delta;
  const freeze = Math.max(0, stats.startTimeFreeze || 0);
  if (state.elapsed > freeze) state.timeLeft -= delta * (stats.timerDrainMultiplier || 1);
  state.ping = Math.max(0, state.ping - delta * 0.8);
  state.player.swing = Math.max(0, state.player.swing - delta * 5.8);
  state.attackCooldown -= delta;
  state.manualPulseCooldown = Math.max(0, state.manualPulseCooldown - delta);
  state.targetCooldown -= delta;
  state.pathCooldown -= delta;
  state.droneCooldown -= delta;
  state.echoPingCooldownRemaining = Math.max(0, state.echoPingCooldownRemaining - delta);
  state.chronoOverflowRemaining = Math.max(0, state.chronoOverflowRemaining - delta);
  if (state.quarryModeActive) {
    state.quarryModeRemaining = Math.max(0, state.quarryModeRemaining - delta);
    if (state.quarryModeRemaining <= 0) {
      state.quarryModeActive = false;
      state.quarryBreakStreak = 0;
      state.quarryVeinId = null;
    }
  }
  state.deafKnockCooldown = Math.max(0, state.deafKnockCooldown - delta);
  state.deafKnockBoostRemaining = Math.max(0, state.deafKnockBoostRemaining - delta);
  state.eventYieldBoostRemaining = Math.max(0, state.eventYieldBoostRemaining - delta);
  state.eventMoveBoostRemaining = Math.max(0, state.eventMoveBoostRemaining - delta);
  state.eventDigBoostRemaining = Math.max(0, state.eventDigBoostRemaining - delta);
  state.eventSoftRockRemaining = Math.max(0, state.eventSoftRockRemaining - delta);
  state.relicDigBoostRemaining = Math.max(0, state.relicDigBoostRemaining - delta);
  state.relicYieldBoostRemaining = Math.max(0, state.relicYieldBoostRemaining - delta);
  state.relicGadgetBoostRemaining = Math.max(0, state.relicGadgetBoostRemaining - delta);
  state.relicSecondBeamRemaining = Math.max(0, state.relicSecondBeamRemaining - delta);
  state.relicSoftRockRemaining = Math.max(0, state.relicSoftRockRemaining - delta);
  state.demolitionComboCooldownRemaining = Math.max(0, state.demolitionComboCooldownRemaining - delta);
  if (state.demolitionComboStage > 0 && state.demolitionComboExpires < state.elapsed) {
    state.demolitionComboStage = 0;
    state.demolitionComboVeinId = null;
  }
  if (state.magneticField) {
    state.magneticField.remaining = Math.max(0, state.magneticField.remaining - delta);
    if (state.magneticField.remaining <= 0) state.magneticField = null;
  }
  for (const [key, expires] of state.laserHeatMarks) {
    if (expires < state.elapsed) state.laserHeatMarks.delete(key);
  }
  updateSuperFields(delta);
  updateSolarDrillBursts(delta);
  state.microEventCheckCooldown -= delta;
  state.triangleRefreshCooldown -= delta;
  for (const [key, expires] of state.triangleOreMemory) {
    if (expires < state.elapsed) state.triangleOreMemory.delete(key);
  }

  if (state.timeLeft <= 0) {
    const availableLastChance = Math.max(0, Math.floor(stats.lastChanceCharges || 0));
    if (state.lastChanceUsed < availableLastChance && (stats.lastChanceSeconds || 0) > 0) {
      state.lastChanceUsed += 1;
      state.timeLeft = stats.lastChanceSeconds;
      flash('#ffcc73', 0.3);
      toast('АВАРИЙНЫЙ ХРОНОЗАРЯД', 'warning');
      sound.tone(120, 0.24, 'sawtooth', 0.05, 330);
    } else {
      state.timeLeft = 0;
      updateHud();
      finishRun();
      return;
    }
  }

  const focusedOre = getFocusedOre();
  if (state.target) {
    const current = state.world.getTile(state.target.tx, state.target.ty);
    const explorationTarget = state.target.kind === 'exploration';
    const microEventTarget = state.target.kind === 'micro_event';
    const liveMicroEvent = microEventTarget && typeof state.world.getMicroEvents === 'function'
      ? state.world.getMicroEvents({ type: state.target.eventType }).find((event) => event.id === state.target.eventId)
      : null;
    const persistence = 1.05 + Math.min(0.65, (stats.sensePersistence || 0) * 0.05);
    const rememberedUntil = state.triangleOreMemory.get(`${state.target.tx}:${state.target.ty}`) || 0;
    const rememberedDistance = rememberedUntil >= state.elapsed
      ? distance(state.player.x, state.player.y, state.target.x, state.target.y) + TILE_SIZE
      : 0;
    const ghostTrailActive = (state.target.ghostUntil || 0) >= state.elapsed
      && (
        !(stats.ghostTrailMaxLayers > 0)
        || hasSenseLine(
          state.player.x,
          state.player.y,
          state.target.x,
          state.target.y,
          stats.ghostTrailMaxLayers,
        )
      );
    const targetMemoryActive = (
      ghostTrailActive
      || (state.target.echoHoldUntil || 0) >= state.elapsed
      || Boolean(state.target.rememberedRoute)
    );
    const targetMemoryDistance = targetMemoryActive
      ? distance(state.player.x, state.player.y, state.target.x, state.target.y) + TILE_SIZE
      : 0;
    const maxTargetDistance = explorationTarget
      ? EXPLORATION_SCAN_TILES * TILE_SIZE * 1.25
      : Math.max(
        state.target.lockRadius || 0,
        effectiveSenseRadius() * focusedSenseMultiplier(focusedOre),
        rememberedDistance,
        targetMemoryDistance,
      ) * persistence;
    if (
      (microEventTarget && !liveMicroEvent)
      || (!microEventTarget && !current)
      || (!microEventTarget && current.kind === 'air')
      || (!microEventTarget && current.kind === 'bedrock')
      || (!microEventTarget && !explorationTarget && !current.oreId)
      || (!microEventTarget && !explorationTarget && !state.target.motherlode && focusedOre && current.oreId !== focusedOre.id)
      || distance(state.player.x, state.player.y, state.target.x, state.target.y) > maxTargetDistance
    ) {
      state.target = null;
      state.pathWaypoint = null;
      promoteBackupTarget(focusedOre?.id || null);
    }
  }

  const hasFocusedTarget = Boolean(
    focusedOre
    && state.target?.kind === 'ore'
    && state.world.getTile(state.target.tx, state.target.ty)?.oreId === focusedOre.id
  );
  if (!focusedOre || hasFocusedTarget) state.focusMissElapsed = 0;
  else state.focusMissElapsed += delta;
  const escalationActive = Boolean(
    focusedOre
    && (stats.oreFocusEscalationBonus || 0) > 0
    && state.focusMissElapsed > (stats.oreFocusEscalationDelay || 0)
  );
  if (escalationActive && !state.focusEscalationActive) state.metrics.focusEscalations += 1;
  state.focusEscalationActive = escalationActive;

  if (state.targetCooldown <= 0) {
    const searchRadius = effectiveSenseRadius() * focusedSenseMultiplier(focusedOre);
    const priorityChest = findPriorityChestTarget();
    const priorityMotherlode = priorityChest ? null : findMotherlodePriorityTarget();
    const targets = priorityChest
      ? { primary: priorityChest, backup: state.target?.kind === 'ore' ? state.target : state.backupTarget }
      : priorityMotherlode
        ? { primary: priorityMotherlode, backup: state.target?.kind === 'ore' && !state.target.motherlode ? state.target : state.backupTarget }
      : chooseOreTargets(state.player.x, state.player.y, searchRadius, focusedOre?.id || null);
    if (targets.primary) {
      const previousKey = state.target ? `${state.target.tx}:${state.target.ty}` : '';
      const nextKey = `${targets.primary.tx}:${targets.primary.ty}`;
      targets.primary.lockRadius = Math.max(targets.primary.lockRadius || 0, searchRadius);
      if (targets.backup) targets.backup.lockRadius = Math.max(targets.backup.lockRadius || 0, searchRadius);
      state.target = targets.primary;
      state.backupTarget = targets.backup;
      noteTargetAcquired(state.target);
      if (previousKey && previousKey !== nextKey) {
        state.pathWaypoint = null;
        state.pathCooldown = 0;
      }
      if (!priorityChest) {
        state.focusMissElapsed = 0;
        refreshCrewBeacon(state.target);
      }
    }
    else if (triggerEchoPing(focusedOre)) {
      refreshCrewBeacon(state.target);
    }
    else if (!state.target || state.target.kind !== 'exploration') {
      state.target = findExplorationTarget(state.player.x, state.player.y, focusedOre?.id || null);
      noteTargetAcquired(state.target);
    }
    state.targetCooldown = 0.12 / Math.max(0.4, (stats.targetLockSpeed || 1) * (stats.aimTurnSpeed || 1));
  } else if (!state.target) {
    state.target = findExplorationTarget(state.player.x, state.player.y, focusedOre?.id || null);
    noteTargetAcquired(state.target);
  }

  if (stats.triangularFixUnlocked && state.triangleRefreshCooldown <= 0) {
    refreshTriangleOreMemory();
    state.triangleRefreshCooldown = 0.12;
  }

  if (!state.target) {
    state.metrics.searchingSeconds += delta;
  } else {
    const workRange = stats.laserUnlocked ? stats.laserRange * 0.78 : Math.max(stats.digReach, TILE_SIZE * 0.9);
    if (distance(state.player.x, state.player.y, state.target.x, state.target.y) > workRange) state.metrics.movementSeconds += delta;
    else state.metrics.miningSeconds += delta;
  }

  if (state.target) {
    if (
      stats.leastResistancePathing
      && !stats.laserUnlocked
      && typeof state.world.findLeastResistanceStep === 'function'
      && (state.pathCooldown <= 0 || !state.pathWaypoint)
    ) {
      const focusedCalibration = focusedOre ? focusedDamageMultiplier(focusedOre.id) : 1;
      const route = state.world.findLeastResistanceStep(state.player, state.target, {
        moveSpeed: stats.moveSpeed * (stats.mineMoveMultiplier || 1),
        digPowerPerSecond: stats.pickPower * stats.digSpeed,
        focusedOreId: focusedOre?.id || null,
        focusedOreDigMultiplier: focusedCalibration,
        maxDetourTiles: 9,
        minimumSavings: 0.08,
        waypointLookAhead: 4,
      });
      state.pathWaypoint = route?.waypoint
        ? { ...route.waypoint, kind: 'route', usedDetour: route.usedDetour, savedSeconds: route.savedSeconds }
        : null;
      if (route?.usedDetour) state.metrics.pathDetours += 1;
      state.pathCooldown = 0.32;
    }
    if (state.pathWaypoint && distance(state.player.x, state.player.y, state.pathWaypoint.x, state.pathWaypoint.y) < TILE_SIZE * 0.45) {
      state.pathWaypoint = null;
      state.pathCooldown = 0;
    }
    const movementTarget = state.pathWaypoint || state.target;
    const dx = movementTarget.x - state.player.x;
    const dy = movementTarget.y - state.player.y;
    const targetDistance = Math.max(0.001, Math.hypot(dx, dy));
    const nx = dx / targetDistance;
    const ny = dy / targetDistance;
    state.player.facing = nx < 0 ? -1 : 1;
    const desiredAngle = Math.atan2(ny, nx);
    const angleDelta = Math.atan2(Math.sin(desiredAngle - state.player.angle), Math.cos(desiredAngle - state.player.angle));
    state.player.angle += angleDelta * clamp(delta * 10 * (stats.aimTurnSpeed || 1), 0, 1);
    state.player.moving = lerp(state.player.moving, 1, clamp(delta * 8, 0, 1));

    const deafKnockMoveMultiplier = state.deafKnockBoostRemaining > 0 ? 1 + stats.deafKnockMoveSpeedBonus : 1;
    const eventMoveMultiplier = state.eventMoveBoostRemaining > 0 ? 1.35 : 1;
    const desiredSpeed = stats.moveSpeed
      * (stats.mineMoveMultiplier || 1)
      * deafKnockMoveMultiplier
      * eventMoveMultiplier
      * veinTravelSpeedMultiplier(state.target);
    const moveDistance = Math.min(targetDistance, desiredSpeed * delta);
    const nextX = clamp(state.player.x + nx * moveDistance, TILE_SIZE, WORLD_CONFIG.WIDTH * TILE_SIZE - TILE_SIZE);
    const nextY = clamp(state.player.y + ny * moveDistance, TILE_SIZE, WORLD_CONFIG.HEIGHT * TILE_SIZE - TILE_SIZE);
    const perpendicularX = -ny;
    const perpendicularY = nx;
    const probeOffsets = [0, -MINER_COLLISION_RADIUS, MINER_COLLISION_RADIUS];
    const blockedTiles = [];
    for (const offset of probeOffsets) {
      const probe = state.world.worldToTile(
        nextX + nx * 8 + perpendicularX * offset,
        nextY + ny * 8 + perpendicularY * offset,
      );
      const tile = state.world.getTile(probe.tx, probe.ty);
      if (tile && tile.kind !== 'air') blockedTiles.push({ ...probe, tile, probeOffset: offset });
    }
    if (!blockedTiles.length) {
      state.player.x = nextX;
      state.player.y = nextY;
      state.stuckElapsed = 0;
      if ((stats.approachStrikeTravelTime || 0) > 0 && moveDistance > 0.1) {
        state.approachTravelElapsed += delta;
      }
    } else {
      state.stuckElapsed += delta;
      if (state.stuckElapsed > 0.4) {
        state.pathWaypoint = null;
        state.pathCooldown = 0;
      }
    }

    if (state.attackCooldown <= 0) {
      const contactTarget = !stats.laserUnlocked ? clearanceTarget(blockedTiles, state.player) : null;
      attack(contactTarget || movementTarget);
      const chargeRate = stats.laserUnlocked ? (stats.laserChargeRate || 1) : 1;
      const eventDigMultiplier = state.eventDigBoostRemaining > 0 ? 1.5 : 1;
      state.attackCooldown = 1 / Math.max(
        0.2,
        stats.digSpeed
          * chargeRate
          * temporalOverclockMultiplier()
          * eventDigMultiplier
          * relicDigMultiplier()
          * quarryDigSpeedMultiplier(),
      );
    }
  } else {
    state.player.moving = lerp(state.player.moving, 0, clamp(delta * 5, 0, 1));
    if (state.targetCooldown <= 0.03) state.ping = Math.max(state.ping, 0.35);
  }

  if (dronesAreActive() && state.droneCooldown <= 0) {
    droneAttack();
    const fieldSpeed = activeMagneticField() ? 1 + stats.magneticFieldTargetingBonus : 1;
    state.droneCooldown = 1 / Math.max(0.25, (stats.droneSpeed || 1) * relicGadgetMultiplier() * fieldSpeed);
  }

  if (state.microEventCheckCooldown <= 0) {
    checkMicroEventsAt(state.player.x, state.player.y, false);
    state.microEventCheckCooldown = 0.14;
  }

  state.deepest = Math.max(state.deepest, depthFromOrigin(state.player.x, state.player.y));
  if (state.elapsed > state.comboExpires) state.combo = 0;
  updateHud();
}

function dronePosition(index, now = state.elapsed) {
  const count = Math.max(1, Math.floor(stats.droneCount));
  const angle = now * (1.2 + index * 0.07) + index / count * Math.PI * 2;
  const radius = 35 + (index % 2) * 10;
  return {
    x: state.player.x + Math.cos(angle) * radius,
    y: state.player.y - 12 + Math.sin(angle * 1.2) * radius * 0.45,
  };
}

function droneAttack() {
  const count = Math.min(8, Math.max(0, Math.floor(stats.droneCount)));
  for (let index = 0; index < count; index += 1) {
    const origin = dronePosition(index);
    const focusedOre = getFocusedOre();
    const beacon = getCrewBeacon();
    const targetOreId = beacon?.oreId || focusedOre?.id || null;
    const triangle = getTriangulationTriangle();
    const hasRememberedOre = [...state.triangleOreMemory.values()].some((expires) => expires >= state.elapsed);
    const fieldRangeMultiplier = activeMagneticField() ? 1 + stats.magneticFieldTargetingBonus : 1;
    const baseRange = (effectiveSenseRadius() * 0.85 + Math.max(0, (stats.pickupRadius || 46) - 46) * 0.35)
      * (focusedOre ? focusedSenseMultiplier(focusedOre) : 1)
      * (triangle ? 1 + stats.triangularFixRangeBonus : 1)
      * fieldRangeMultiplier;
    const triangleTarget = (triangle || hasRememberedOre) && stats.triangularFixDronePriority
      ? findBeaconAwareTarget(
        origin.x,
        origin.y,
        baseRange,
        focusedOre,
        beacon,
        {
          predicate: (candidate) => (
            pointInTriangle(candidate.x, candidate.y, triangle)
            || (state.triangleOreMemory.get(`${candidate.tx}:${candidate.ty}`) || 0) >= state.elapsed
          ),
        },
      )
      : null;
    const magneticTarget = findMagneticFieldTarget(focusedOre);
    const target = magneticTarget || triangleTarget || findBeaconAwareTarget(
      origin.x,
      origin.y,
      baseRange,
      focusedOre,
      beacon,
    );
    if (!target) continue;
    const inTriangle = pointInTriangle(target.x, target.y, triangle);
    const gadgetBonus = inTriangle ? stats.triangularFixGadgetDamageBonus : 0;
    if (triangleTarget || gadgetBonus > 0 || (triangle && stats.triangularFixRangeBonus > 0)) state.metrics.triangleBuffHits += 1;
    const power = stats.pickPower * Math.max(0.2, stats.dronePower || 0.35) * (1 + gadgetBonus)
      * magneticGadgetMultiplier(target.x, target.y);
    const hpBefore = target.tile.hp || 0;
    const comboTarget = { ...target, veinId: target.tile?.veinId || null };
    const calibration = focusedDamageMultiplier(target.tile);
    const droneRadius = Math.max(7, stats.digRadius * 0.34);
    const droneSnapshot = snapshotOreHpInCircle(target.x, target.y, droneRadius);
    const droneBreaks = state.world.damageCircle(target.x, target.y, droneRadius, power, (tile, tx, ty) => resolveBrokenTile(tile, tx, ty, 'drone'));
    collectCircleGadgetOverkill(droneBreaks, droneSnapshot, power, target.x, target.y);
    if (calibration > 1 && target.tile.kind !== 'air') {
      const calibrationPower = power * (calibration - 1);
      const calibrationHp = target.tile.hp || 0;
      const calibrationOreId = target.tile.oreId;
      const calibrationVeinId = target.tile.veinId;
      const calibrationBreaks = state.world.damageTile(target.tx, target.ty, calibrationPower, (tile, tx, ty) => resolveBrokenTile(tile, tx, ty, 'drone'));
      if (calibrationBreaks.length) storeGadgetOverkill(calibrationOreId, calibrationVeinId, calibrationHp, calibrationPower, target.x, target.y, true);
    }
    if (target.tile.kind === 'air') {
      relayCrewOverkill(target, targetOreId, Math.max(0, power * calibration - hpBefore), [`${target.tx}:${target.ty}`]);
    }
    advanceDemolitionCombo('drone', comboTarget);
    state.beams.push({ x: origin.x, y: origin.y, x2: target.x, y2: target.y, color: '#76dbff', life: 0.1, maxLife: 0.1, width: 2, kind: 'drone' });
    if ((stats.droneBombChance || 0) > 0 && Math.random() < procChance(stats.droneBombChance, 0.12)) {
      const dx = target.x - origin.x;
      const dy = target.y - origin.y;
      const length = Math.max(0.001, Math.hypot(dx, dy));
      detonate(target.x, target.y, dx / length, dy / length);
    }
  }
}

function spawnDebris(x, y, color, count) {
  const particleCount = REDUCED_MOTION ? Math.max(1, Math.ceil(count * 0.55)) : count;
  for (let index = 0; index < particleCount; index += 1) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 28 + Math.random() * 92;
    state.particles.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 25,
      size: 2 + Math.random() * 4,
      color,
      life: 0.45 + Math.random() * 0.45,
      maxLife: 0.9,
      gravity: 120,
      kind: 'debris',
    });
  }
  if (state.particles.length > 360) state.particles.splice(0, state.particles.length - 360);
}

function spawnSparks(x, y, color, count) {
  const particleCount = REDUCED_MOTION ? Math.max(1, Math.ceil(count * 0.55)) : count;
  for (let index = 0; index < particleCount; index += 1) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 80 + Math.random() * 150;
    state.particles.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, size: 1 + Math.random() * 2, color, life: 0.18 + Math.random() * 0.25, maxLife: 0.42, gravity: 85, glow: true, kind: 'spark' });
  }
}

function updateEffects(delta) {
  const interfaceDelta = state.mode === 'run' && state.paused ? 0 : delta;
  if (state.floaters.length > 200) state.floaters.splice(0, state.floaters.length - 200);
  if (state.beams.length > 160) state.beams.splice(0, state.beams.length - 160);
  if (state.shocks.length > 80) state.shocks.splice(0, state.shocks.length - 80);
  for (const particle of state.particles) {
    particle.life -= delta;
    particle.vy += (particle.gravity || 0) * delta;
    particle.x += particle.vx * delta;
    particle.y += particle.vy * delta;
    particle.vx *= Math.pow(0.45, delta);
  }
  state.particles = state.particles.filter((particle) => particle.life > 0);
  for (const floater of state.floaters) {
    floater.life -= delta;
    floater.y -= delta * 30;
  }
  state.floaters = state.floaters.filter((floater) => floater.life > 0);
  for (const beam of state.beams) beam.life -= delta;
  state.beams = state.beams.filter((beam) => beam.life > 0);
  if (state.mode === 'run' && !state.paused) {
    for (const shock of state.shocks) {
      shock.life -= delta;
      shock.tick -= delta;
      if (shock.tick <= 0 && shock.life > 0) {
        shock.tick += 0.12;
        state.world.damageCircle(shock.x, shock.y, Math.max(8, stats.digRadius * 0.42), stats.pickPower * (stats.chainPower || 0.55) * 0.18, (tile, tx, ty) => resolveBrokenTile(tile, tx, ty, 'shock'));
        spawnSparks(shock.x, shock.y, '#ba9cff', 2);
      }
    }
  }
  state.shocks = state.shocks.filter((shock) => shock.life > 0);
  if (state.eventBannerTimer > 0) {
    state.eventBannerTimer = Math.max(0, state.eventBannerTimer - interfaceDelta);
  }
  updateMicroEventIndicator();
  updatePerkStatusRail();
  state.shake = Math.max(0, state.shake - delta * 32);
}

function updateCamera(delta) {
  if (!state.player) return;
  const lookAhead = state.target ? clamp(state.target.x - state.player.x, -180, 180) * 0.18 : 0;
  const targetX = state.player.x + lookAhead - state.viewport.width * 0.5;
  const targetY = state.player.y - state.viewport.height * 0.52;
  const worldWidth = WORLD_CONFIG.WIDTH * TILE_SIZE;
  const worldHeight = WORLD_CONFIG.HEIGHT * TILE_SIZE;
  state.camera.x = clamp(lerp(state.camera.x, targetX, 1 - Math.exp(-delta * 4.6)), 0, Math.max(0, worldWidth - state.viewport.width));
  state.camera.y = clamp(lerp(state.camera.y, targetY, 1 - Math.exp(-delta * 4.6)), -70, Math.max(-70, worldHeight - state.viewport.height));
}

function tileNoise(tx, ty, salt = 0) {
  let value = Math.imul(tx + salt * 19, 374761393) ^ Math.imul(ty - salt * 31, 668265263);
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
}

function terrainMassNoise(tx, ty, salt = 0) {
  const scaleX = 7;
  const scaleY = 5;
  const gridX = Math.floor(tx / scaleX);
  const gridY = Math.floor(ty / scaleY);
  const localX = (tx - gridX * scaleX) / scaleX;
  const localY = (ty - gridY * scaleY) / scaleY;
  const smoothX = localX * localX * (3 - 2 * localX);
  const smoothY = localY * localY * (3 - 2 * localY);
  const top = lerp(tileNoise(gridX, gridY, salt), tileNoise(gridX + 1, gridY, salt), smoothX);
  const bottom = lerp(tileNoise(gridX, gridY + 1, salt), tileNoise(gridX + 1, gridY + 1, salt), smoothX);
  return lerp(top, bottom, smoothY);
}

const TERRAIN_OPEN_TOP = 1;
const TERRAIN_OPEN_RIGHT = 2;
const TERRAIN_OPEN_BOTTOM = 4;
const TERRAIN_OPEN_LEFT = 8;

// Static, allocation-free palettes. The three base tones are selected from
// coarse world-space cells so the mine reads as broad geological masses rather
// than a checkerboard of individually shaded blocks.
const TERRAIN_PALETTES = Object.freeze({
  loam: Object.freeze({
    base: Object.freeze(['#654333', '#6b4735', '#704b37', '#754f39', '#7a533b', '#80583e', '#865c40']),
    light: '#b77b50',
    side: '#8e5b40',
    shadow: '#3b2924',
    strata: '#955c3e',
    strataLight: '#c17f50',
    chip: '#ce8a58',
    chipDark: '#4b3028',
  }),
  dirt: Object.freeze({
    base: Object.freeze(['#51362e', '#563930', '#5b3d31', '#604033', '#654435', '#6a4737', '#704b39']),
    light: '#8e5d42',
    side: '#744937',
    shadow: '#332329',
    strata: '#81503a',
    strataLight: '#a96643',
    chip: '#b67349',
    chipDark: '#402a2b',
  }),
  stone: Object.freeze({
    base: Object.freeze(['#30373a', '#343a3d', '#383e40', '#3c4244', '#404648', '#444a4c', '#494e50']),
    light: '#667073',
    side: '#50595c',
    shadow: '#20262b',
    strata: '#665047',
    strataLight: '#8d604a',
    chip: '#747b7a',
    chipDark: '#292d32',
  }),
  deepstone: Object.freeze({
    base: Object.freeze(['#1d242a', '#20272d', '#232a30', '#262d33', '#293036', '#2c3339', '#30373d']),
    light: '#48545a',
    side: '#363f46',
    shadow: '#111820',
    strata: '#4c3937',
    strataLight: '#75493e',
    chip: '#566064',
    chipDark: '#171d24',
  }),
  bedrock: Object.freeze({
    base: Object.freeze(['#0a1017', '#0c1219', '#0f151c', '#12181f', '#151b22', '#181e25', '#1b2128']),
    light: '#303940',
    side: '#202930',
    shadow: '#05090e',
    strata: '#352c30',
    strataLight: '#5d3b39',
    chip: '#424b50',
    chipDark: '#080d13',
  }),
});

const GEO_COMIC_COLORS = Object.freeze({
  ink: '#0a1016',
  inkSoft: '#171c22',
  rust: '#8f4b35',
  rustLight: '#c7724b',
  damp: '#3f7778',
  dampLight: '#78a8a1',
  bone: '#c8b98d',
  root: '#4a3028',
  rootLight: '#8a573d',
  cable: '#493337',
});

// Ore identity is carried by silhouette and material as well as colour. Keep
// this table render-only: it must never influence deposit generation or yield.
const ORE_RENDER_STYLES = Object.freeze({
  copper: Object.freeze({ material: 'hammered-ribbon', veinWidth: 7, highlightWidth: 1.5, cap: 'round', nodeWidth: 17, nodeHeight: 11 }),
  coal: Object.freeze({ material: 'fractured-lump', veinWidth: 9, highlightWidth: 0, cap: 'square', nodeWidth: 16, nodeHeight: 14 }),
  iron: Object.freeze({ material: 'banded-metal', veinWidth: 9, highlightWidth: 2, cap: 'square', nodeWidth: 18, nodeHeight: 13 }),
  amber: Object.freeze({ material: 'resin-drop', veinWidth: 7, highlightWidth: 2, cap: 'round', nodeWidth: 13, nodeHeight: 17 }),
  silver: Object.freeze({ material: 'needle-thread', veinWidth: 5, highlightWidth: 2, cap: 'square', nodeWidth: 20, nodeHeight: 9 }),
  gold: Object.freeze({ material: 'nugget-cluster', veinWidth: 8, highlightWidth: 2, cap: 'round', nodeWidth: 18, nodeHeight: 14 }),
  amethyst: Object.freeze({ material: 'shard-cluster', veinWidth: 7, highlightWidth: 2, cap: 'square', nodeWidth: 16, nodeHeight: 19 }),
  prism_crystal: Object.freeze({ material: 'prismatic-facet', veinWidth: 6, highlightWidth: 2, cap: 'square', nodeWidth: 17, nodeHeight: 20 }),
  void_ore: Object.freeze({ material: 'hollow-lens', veinWidth: 10, highlightWidth: 2, cap: 'round', nodeWidth: 20, nodeHeight: 15 }),
  star_core: Object.freeze({ material: 'molten-star', veinWidth: 9, highlightWidth: 3, cap: 'round', nodeWidth: 19, nodeHeight: 19 }),
});

// Only the deterministic substrate of a solid tile is cached. Depth tint,
// exposed-edge landmarks, ore, damage cracks and every animated effect stay on
// the main canvas so their state can change independently from this surface.
const terrainBaseCache = new Map();
const terrainBaseCacheCounters = {
  hits: 0,
  misses: 0,
  bypasses: 0,
};

function getTerrainBaseCacheStats() {
  return Object.freeze({
    entries: terrainBaseCache.size,
    hits: terrainBaseCacheCounters.hits,
    misses: terrainBaseCacheCounters.misses,
    bypasses: terrainBaseCacheCounters.bypasses,
    limit: TERRAIN_BASE_CACHE_LIMIT,
  });
}

function resetTerrainBaseCache() {
  terrainBaseCache.clear();
  terrainBaseCacheCounters.hits = 0;
  terrainBaseCacheCounters.misses = 0;
  terrainBaseCacheCounters.bypasses = 0;
}

function createTerrainBaseSurface() {
  try {
    if (typeof document?.createElement !== 'function') return null;
    const surface = document.createElement('canvas');
    if (!surface || typeof surface.getContext !== 'function') return null;
    surface.width = TILE_SIZE + 1;
    surface.height = TILE_SIZE + 1;
    const surfaceContext = surface.getContext('2d', { alpha: true });
    if (!surfaceContext) return null;
    surfaceContext.imageSmoothingEnabled = false;
    return { surface, surfaceContext };
  } catch (_error) {
    return null;
  }
}

function terrainBaseCacheKey(tx, ty, kind, baseIndex, openMask) {
  return `${tx}:${ty}:${kind}:${baseIndex}:${openMask}`;
}

function drawTerrainBaseDirect(renderContext, x, y, tx, ty, kind, palette, baseIndex, openMask) {
  drawChippedTerrainCell(x, y, tx, ty, openMask, palette.base[baseIndex], renderContext);
  drawVoxelMassTexture(x, y, tx, ty, palette, openMask, renderContext);
  drawTerrainStrata(x, y, tx, ty, kind, palette, openMask, renderContext);
  drawExposedVoxelFaces(x, y, tx, ty, palette, openMask, renderContext);
}

function drawTerrainBaseLayer(x, y, tx, ty, kind, palette, baseIndex, openMask) {
  const key = terrainBaseCacheKey(tx, ty, kind, baseIndex, openMask);
  const cached = terrainBaseCache.get(key);
  if (cached) {
    terrainBaseCache.delete(key);
    terrainBaseCache.set(key, cached);
    try {
      ctx.drawImage(cached, x, y);
      terrainBaseCacheCounters.hits += 1;
      return;
    } catch (_error) {
      terrainBaseCache.delete(key);
      terrainBaseCacheCounters.bypasses += 1;
      drawTerrainBaseDirect(ctx, x, y, tx, ty, kind, palette, baseIndex, openMask);
      return;
    }
  }

  terrainBaseCacheCounters.misses += 1;
  const created = createTerrainBaseSurface();
  if (!created || typeof ctx.drawImage !== 'function') {
    terrainBaseCacheCounters.bypasses += 1;
    drawTerrainBaseDirect(ctx, x, y, tx, ty, kind, palette, baseIndex, openMask);
    return;
  }

  try {
    drawTerrainBaseDirect(created.surfaceContext, 0, 0, tx, ty, kind, palette, baseIndex, openMask);
    if (terrainBaseCache.size >= TERRAIN_BASE_CACHE_LIMIT) {
      const oldestKey = terrainBaseCache.keys().next().value;
      if (oldestKey !== undefined) terrainBaseCache.delete(oldestKey);
    }
    terrainBaseCache.set(key, created.surface);
    ctx.drawImage(created.surface, x, y);
  } catch (_error) {
    terrainBaseCache.delete(key);
    terrainBaseCacheCounters.bypasses += 1;
    drawTerrainBaseDirect(ctx, x, y, tx, ty, kind, palette, baseIndex, openMask);
  }
}

function isTerrainOpen(tx, ty) {
  const neighbor = state.world?.getTile(tx, ty);
  return !neighbor || neighbor.kind === 'air';
}

function getOpenTerrainMask(tx, ty) {
  let mask = 0;
  if (isTerrainOpen(tx, ty - 1)) mask |= TERRAIN_OPEN_TOP;
  if (isTerrainOpen(tx + 1, ty)) mask |= TERRAIN_OPEN_RIGHT;
  if (isTerrainOpen(tx, ty + 1)) mask |= TERRAIN_OPEN_BOTTOM;
  if (isTerrainOpen(tx - 1, ty)) mask |= TERRAIN_OPEN_LEFT;
  return mask;
}

function drawChippedTerrainCell(x, y, tx, ty, openMask, fillStyle, renderContext = ctx) {
  renderContext.fillStyle = fillStyle;
  if (openMask === 0) {
    renderContext.fillRect(x, y, TILE_SIZE + 1, TILE_SIZE + 1);
    return;
  }

  const topOpen = (openMask & TERRAIN_OPEN_TOP) !== 0;
  const rightOpen = (openMask & TERRAIN_OPEN_RIGHT) !== 0;
  const bottomOpen = (openMask & TERRAIN_OPEN_BOTTOM) !== 0;
  const leftOpen = (openMask & TERRAIN_OPEN_LEFT) !== 0;
  const chipA = 2 + Math.floor(tileNoise(tx, ty, 31) * 5);
  const chipB = 2 + Math.floor(tileNoise(tx, ty, 32) * 5);
  const chipC = 2 + Math.floor(tileNoise(tx, ty, 33) * 5);
  const rightEdge = x + TILE_SIZE + (rightOpen ? 0 : 1);
  const bottomEdge = y + TILE_SIZE + (bottomOpen ? 0 : 1);

  // Only edges touching air are inset. Closed sides still overlap their solid
  // neighbor by one pixel, preventing hairline seams while the camera moves.
  renderContext.beginPath();
  renderContext.moveTo(x + (leftOpen ? chipC : 0), y + (topOpen ? chipA : 0));
  renderContext.lineTo(x + 5, y + (topOpen ? chipB : 0));
  renderContext.lineTo(x + 10, y + (topOpen ? chipB : 0));
  renderContext.lineTo(x + 10, y + (topOpen ? chipC : 0));
  renderContext.lineTo(x + 18, y + (topOpen ? chipC : 0));
  renderContext.lineTo(x + 18, y + (topOpen ? chipA : 0));
  renderContext.lineTo(x + 24, y + (topOpen ? chipA : 0));
  renderContext.lineTo(rightEdge - (rightOpen ? chipB : 0), y + (topOpen ? chipB : 0));
  renderContext.lineTo(rightEdge - (rightOpen ? chipC : 0), y + 6);
  renderContext.lineTo(rightEdge - (rightOpen ? chipC : 0), y + 11);
  renderContext.lineTo(rightEdge - (rightOpen ? chipA : 0), y + 11);
  renderContext.lineTo(rightEdge - (rightOpen ? chipA : 0), y + 18);
  renderContext.lineTo(rightEdge - (rightOpen ? chipB : 0), y + 18);
  renderContext.lineTo(rightEdge - (rightOpen ? chipB : 0), y + 24);
  renderContext.lineTo(rightEdge - (rightOpen ? chipC : 0), bottomEdge - (bottomOpen ? chipA : 0));
  renderContext.lineTo(x + 24, bottomEdge - (bottomOpen ? chipB : 0));
  renderContext.lineTo(x + 18, bottomEdge - (bottomOpen ? chipB : 0));
  renderContext.lineTo(x + 18, bottomEdge - (bottomOpen ? chipA : 0));
  renderContext.lineTo(x + 10, bottomEdge - (bottomOpen ? chipA : 0));
  renderContext.lineTo(x + 10, bottomEdge - (bottomOpen ? chipC : 0));
  renderContext.lineTo(x + 5, bottomEdge - (bottomOpen ? chipC : 0));
  renderContext.lineTo(x + (leftOpen ? chipA : 0), bottomEdge - (bottomOpen ? chipB : 0));
  renderContext.lineTo(x + (leftOpen ? chipB : 0), y + 24);
  renderContext.lineTo(x + (leftOpen ? chipB : 0), y + 18);
  renderContext.lineTo(x + (leftOpen ? chipC : 0), y + 18);
  renderContext.lineTo(x + (leftOpen ? chipC : 0), y + 11);
  renderContext.lineTo(x + (leftOpen ? chipA : 0), y + 11);
  renderContext.lineTo(x + (leftOpen ? chipA : 0), y + 5);
  renderContext.closePath();
  renderContext.fill();
}

function drawTerrainStrata(x, y, tx, ty, kind, palette, openMask, renderContext = ctx) {
  const leftInset = openMask & TERRAIN_OPEN_LEFT ? 4 : 0;
  const rightInset = openMask & TERRAIN_OPEN_RIGHT ? 4 : 0;
  const usableWidth = TILE_SIZE + 1 - leftInset - rightInset;
  const spacing = kind === 'loam' ? 2 : kind === 'dirt' ? 3 : kind === 'stone' ? 5 : 6;
  const rowOffset = Math.floor(tileNoise(Math.floor(tx / 6), 0, 40) * 3);
  const bandSeed = tileNoise(Math.floor(tx / 3), ty, 41);

  if ((ty + rowOffset) % spacing === 0 && bandSeed > 0.14) {
    const bandY = 7 + Math.floor(bandSeed * 10);
    renderContext.fillStyle = palette.strata;
    renderContext.fillRect(x + leftInset, y + bandY, usableWidth, 2);
    if ((kind === 'dirt' || kind === 'loam') && bandSeed > 0.58) {
      renderContext.fillStyle = palette.strataLight;
      renderContext.fillRect(x + leftInset + 3, y + bandY - 2, Math.max(3, usableWidth - 9), 2);
    } else if (bandSeed > 0.72) {
      renderContext.fillStyle = palette.chipDark;
      renderContext.fillRect(x + leftInset + 5, y + bandY + 2, Math.max(3, usableWidth - 12), 1);
    }
  }

  const fleck = tileNoise(tx, ty, 44);
  if (fleck > 0.2) {
    const px = 4 + Math.floor(tileNoise(tx, ty, 45) * 15);
    const py = 5 + Math.floor(tileNoise(tx, ty, 46) * 15);
    renderContext.fillStyle = fleck > 0.72 ? palette.chip : palette.chipDark;
    renderContext.fillRect(x + px, y + py, 4 + Math.floor(fleck * 3), 2);
    if (fleck > 0.55) renderContext.fillRect(x + px + 2, y + py - 2, 3, 2);
    if (fleck > 0.84) {
      renderContext.fillStyle = palette.strataLight;
      renderContext.fillRect(x + px + 3, y + py, 2, 1);
    }
  }
}

function drawVoxelMassTexture(x, y, tx, ty, palette, openMask, renderContext = ctx) {
  const voxel = 4;
  const gridSize = 7;
  for (let microY = 0; microY < gridSize; microY += 1) {
    for (let microX = 0; microX < gridSize; microX += 1) {
      if (microX === 0 && (openMask & TERRAIN_OPEN_LEFT)) continue;
      if (microX === gridSize - 1 && (openMask & TERRAIN_OPEN_RIGHT)) continue;
      if (microY === 0 && (openMask & TERRAIN_OPEN_TOP)) continue;
      if (microY === gridSize - 1 && (openMask & TERRAIN_OPEN_BOTTOM)) continue;
      const globalX = tx * gridSize + microX;
      const globalY = ty * gridSize + microY;
      // Small clusters cross logical tile borders, hiding the collision grid
      // while reading as compact pieces of soil instead of full-size blocks.
      const cluster = tileNoise(Math.floor((globalX + 1) / 2), Math.floor((globalY + 1) / 2), 91);
      const detail = tileNoise(globalX, globalY, 97);
      if (cluster < 0.42 || detail < 0.4) continue;
      renderContext.globalAlpha = 0.1 + cluster * 0.2;
      renderContext.fillStyle = cluster > 0.78 ? palette.light : detail > 0.68 ? palette.side : palette.shadow;
      renderContext.fillRect(x + microX * voxel, y + microY * voxel, voxel + 1, voxel + 1);
      if (detail > 0.9 && microX < gridSize - 1) {
        renderContext.fillRect(x + microX * voxel + voxel, y + microY * voxel + 2, voxel, 2);
      }
    }
  }
  renderContext.globalAlpha = 1;
}

function drawExposedVoxelFaces(x, y, tx, ty, palette, openMask, renderContext = ctx) {
  const faceA = 2 + Math.floor(tileNoise(tx, ty, 32) * 3);
  const faceB = 2 + Math.floor(tileNoise(tx, ty, 33) * 3);

  if (openMask & TERRAIN_OPEN_TOP) {
    renderContext.fillStyle = palette.light;
    renderContext.fillRect(x + 3, y + faceA, 5, 2);
    renderContext.fillRect(x + 10, y + faceB, 4, 2);
    renderContext.fillRect(x + 17, y + faceA, 6, 2);
    renderContext.fillStyle = palette.side;
    renderContext.fillRect(x + 7, y + faceA + 2, 4, 1);
  }
  if (openMask & TERRAIN_OPEN_LEFT) {
    renderContext.fillStyle = palette.side;
    renderContext.fillRect(x + faceB, y + 4, 2, 5);
    renderContext.fillRect(x + faceA, y + 11, 2, 4);
    renderContext.fillRect(x + faceB, y + 18, 2, 5);
  }
  if (openMask & TERRAIN_OPEN_RIGHT) {
    renderContext.fillStyle = palette.shadow;
    renderContext.fillRect(x + TILE_SIZE - faceA - 1, y + 4, 2, 5);
    renderContext.fillRect(x + TILE_SIZE - faceB - 1, y + 11, 2, 4);
    renderContext.fillRect(x + TILE_SIZE - faceA - 1, y + 18, 2, 5);
  }
  if (openMask & TERRAIN_OPEN_BOTTOM) {
    renderContext.fillStyle = palette.shadow;
    renderContext.fillRect(x + 3, y + TILE_SIZE - faceB - 1, 5, 2);
    renderContext.fillRect(x + 10, y + TILE_SIZE - faceA - 1, 4, 2);
    renderContext.fillRect(x + 17, y + TILE_SIZE - faceB - 1, 6, 2);
  }
}

function terrainDepthFactor(tx, ty) {
  const clampedTx = clamp(Math.floor(tx), 0, WORLD_CONFIG.WIDTH - 1);
  const surface = state.world?.surface?.[clampedTx] ?? WORLD_CONFIG.SURFACE_BASE;
  return clamp(
    (ty - surface) / Math.max(1, WORLD_CONFIG.HEIGHT - surface - (WORLD_CONFIG.BEDROCK_ROWS || 0)),
    0,
    1,
  );
}

function drawTerrainDepthTone(x, y, tx, ty, openMask) {
  const depth = terrainDepthFactor(tx, ty);
  if (depth <= 0.08) return;
  const edgeRelief = openMask ? 0.78 : 1;
  ctx.globalAlpha = (0.025 + depth * 0.15) * edgeRelief;
  ctx.fillStyle = depth > 0.72 ? '#03070c' : '#091017';
  ctx.fillRect(x, y, TILE_SIZE + 1, TILE_SIZE + 1);
  ctx.globalAlpha = 1;
}

function drawTerrainEdgeLandmark(x, y, tx, ty, palette, openMask) {
  if (!openMask) return;
  const depth = terrainDepthFactor(tx, ty);
  const detailSeed = tileNoise(tx, ty, 141);
  ctx.save();

  // Damp seams appear only across a narrow middle-depth band and only along
  // exposed faces. Their short drips make the wet layer readable at a glance.
  if (depth > 0.38 && depth < 0.76 && detailSeed > 0.84) {
    ctx.globalAlpha = 0.34 + tileNoise(tx, ty, 142) * 0.22;
    ctx.strokeStyle = GEO_COMIC_COLORS.damp;
    ctx.fillStyle = GEO_COMIC_COLORS.dampLight;
    ctx.lineWidth = 2;
    if (openMask & TERRAIN_OPEN_TOP) {
      const start = 4 + Math.floor(tileNoise(tx, ty, 143) * 8);
      ctx.beginPath();
      ctx.moveTo(x + start, y + 2);
      ctx.lineTo(x + Math.min(TILE_SIZE - 3, start + 11), y + 2);
      ctx.stroke();
      ctx.fillRect(x + start + 5, y + 3, 2, 3 + Math.floor(detailSeed * 4));
    } else if (openMask & TERRAIN_OPEN_LEFT) {
      const start = 5 + Math.floor(tileNoise(tx, ty, 144) * 9);
      ctx.fillRect(x + 2, y + start, 2, 9);
      ctx.fillRect(x + 4, y + start + 6, 3, 2);
    } else if (openMask & TERRAIN_OPEN_RIGHT) {
      const start = 5 + Math.floor(tileNoise(tx, ty, 145) * 9);
      ctx.fillRect(x + TILE_SIZE - 3, y + start, 2, 9);
      ctx.fillRect(x + TILE_SIZE - 6, y + start + 6, 3, 2);
    }
  }

  // Sparse rust-coloured fault marks tie the cool rock to the surface palette
  // without turning every block into a noisy decal.
  if (depth > 0.2 && detailSeed < 0.035) {
    ctx.globalAlpha = 0.38;
    ctx.strokeStyle = GEO_COMIC_COLORS.rust;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x + 5, y + 5);
    ctx.lineTo(x + 12, y + 10);
    ctx.lineTo(x + 9, y + 16);
    ctx.lineTo(x + 18, y + 22);
    ctx.stroke();
  }

  // Near-surface roots terminate on exposed soil faces rather than floating
  // over the cave background.
  if (depth < 0.18 && (openMask & TERRAIN_OPEN_BOTTOM) && tileNoise(tx, ty, 146) > 0.93) {
    ctx.globalAlpha = 0.72;
    ctx.strokeStyle = GEO_COMIC_COLORS.root;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x + 7, y + TILE_SIZE - 2);
    ctx.lineTo(x + 11, y + TILE_SIZE + 5);
    ctx.lineTo(x + 8, y + TILE_SIZE + 10);
    ctx.stroke();
  }
  ctx.restore();
}

function drawCaveLandmark(x, y, tx, ty, surface) {
  if (ty < surface) return;
  const depth = terrainDepthFactor(tx, ty);
  const solidTop = !isTerrainOpen(tx, ty - 1);
  const solidLeft = !isTerrainOpen(tx - 1, ty);
  const solidRight = !isTerrainOpen(tx + 1, ty);
  const solidBottom = !isTerrainOpen(tx, ty + 1);
  const edgeCount = Number(solidTop) + Number(solidLeft) + Number(solidRight) + Number(solidBottom);
  if (edgeCount === 0) return;

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const rootSeed = tileNoise(tx, ty, 151);
  if (depth < 0.2 && rootSeed > 0.965 && (solidTop || solidLeft || solidRight)) {
    const fromX = solidLeft ? x : solidRight ? x + TILE_SIZE : x + 5 + rootSeed * 17;
    const fromY = solidTop ? y : y + 4;
    const direction = solidRight ? -1 : 1;
    ctx.globalAlpha = 0.86;
    ctx.strokeStyle = GEO_COMIC_COLORS.ink;
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(fromX, fromY);
    ctx.lineTo(fromX + direction * 4, fromY + 8);
    ctx.lineTo(fromX + direction * 1, fromY + 17);
    ctx.lineTo(fromX + direction * 6, fromY + 25);
    ctx.stroke();
    ctx.strokeStyle = GEO_COMIC_COLORS.rootLight;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
    return;
  }

  const fossilSeed = tileNoise(tx, ty, 152);
  if (depth > 0.16 && depth < 0.43 && fossilSeed > 0.982 && (solidLeft || solidRight || solidBottom)) {
    const mirror = solidRight ? -1 : 1;
    const cx = solidRight ? x + 20 : x + 8;
    const cy = y + 15;
    ctx.globalAlpha = 0.68;
    ctx.strokeStyle = GEO_COMIC_COLORS.ink;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(cx, cy, 9, -1.25, 1.35);
    ctx.stroke();
    ctx.strokeStyle = GEO_COMIC_COLORS.bone;
    ctx.lineWidth = 2;
    ctx.stroke();
    for (let rib = -1; rib <= 1; rib += 1) {
      ctx.beginPath();
      ctx.moveTo(cx + mirror * 2, cy + rib * 5);
      ctx.lineTo(cx + mirror * (8 + Math.abs(rib) * 2), cy + rib * 7);
      ctx.stroke();
    }
    ctx.restore();
    return;
  }

  const supportSeed = tileNoise(tx, ty, 153);
  if (depth > 0.28 && depth < 0.66 && supportSeed > 0.994 && edgeCount <= 2) {
    ctx.globalAlpha = 0.82;
    ctx.strokeStyle = GEO_COMIC_COLORS.ink;
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.moveTo(x + 6, y - 3);
    ctx.lineTo(x + 6, y + TILE_SIZE + 3);
    ctx.moveTo(x - 4, y + 5);
    ctx.lineTo(x + TILE_SIZE + 4, y + 5);
    ctx.stroke();
    ctx.strokeStyle = GEO_COMIC_COLORS.rust;
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.fillStyle = GEO_COMIC_COLORS.rustLight;
    ctx.fillRect(x + 3, y + 10, 6, 3);
    ctx.restore();
    return;
  }

  const cableSeed = tileNoise(tx, ty, 154);
  if (depth > 0.32 && depth < 0.72 && cableSeed > 0.988 && (solidTop || solidLeft || solidRight)) {
    ctx.globalAlpha = 0.68;
    ctx.strokeStyle = GEO_COMIC_COLORS.ink;
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(x - 3, y + 6);
    ctx.bezierCurveTo(x + 7, y + 8, x + 18, y + 22, x + TILE_SIZE + 3, y + 13);
    ctx.stroke();
    ctx.strokeStyle = GEO_COMIC_COLORS.cable;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = GEO_COMIC_COLORS.rustLight;
    ctx.fillRect(x + 13, y + 15, 3, 4);
    ctx.restore();
    return;
  }

  const crystalSeed = tileNoise(tx, ty, 155);
  if (depth > 0.66 && crystalSeed > 0.978 && (solidLeft || solidRight || solidBottom)) {
    const edgeX = solidRight ? x + TILE_SIZE - 2 : solidLeft ? x + 2 : x + 13;
    const direction = solidRight ? -1 : 1;
    ctx.globalAlpha = 0.64 + depth * 0.2;
    ctx.fillStyle = '#467a82';
    ctx.strokeStyle = GEO_COMIC_COLORS.ink;
    ctx.lineWidth = 2;
    for (let shard = 0; shard < 3; shard += 1) {
      const sy = y + 8 + shard * 6;
      const length = 6 + Math.floor(tileNoise(tx, ty, 156 + shard) * 7);
      ctx.beginPath();
      ctx.moveTo(edgeX, sy - 3);
      ctx.lineTo(edgeX + direction * length, sy);
      ctx.lineTo(edgeX, sy + 3);
      ctx.closePath();
      ctx.stroke();
      ctx.fill();
    }
    ctx.globalAlpha = 0.62;
    ctx.strokeStyle = '#a8e5dd';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(edgeX, y + 6);
    ctx.lineTo(edgeX + direction * 10, y + 8);
    ctx.stroke();
  }
  ctx.restore();
}

function hasMatchingOre(tx, ty, oreId) {
  const tile = state.world?.getTile(tx, ty);
  return Boolean(tile && tile.kind !== 'air' && tile.oreId === oreId);
}

function verticalOreEdgeOffset(boundaryTx, ty) {
  return 6 + Math.floor(tileNoise(boundaryTx, ty, 71) * 17);
}

function horizontalOreEdgeOffset(tx, boundaryTy) {
  return 6 + Math.floor(tileNoise(tx, boundaryTy, 72) * 17);
}

function drawBackground(now) {
  const { width, height } = state.viewport;
  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, '#183137');
  gradient.addColorStop(0.38, '#111f27');
  gradient.addColorStop(0.72, '#0c151d');
  gradient.addColorStop(1, '#070c12');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  const cameraDepth = Math.max(0, state.camera.y) / Math.max(1, WORLD_CONFIG.HEIGHT * TILE_SIZE);
  ctx.save();
  ctx.lineCap = 'square';
  ctx.lineJoin = 'miter';
  for (let layer = 0; layer < 4; layer += 1) {
    const y = height * (0.2 + layer * 0.22) - ((state.camera.y * (0.045 + layer * 0.016)) % 138);
    const rustBand = layer === 1 || layer === 3;
    ctx.beginPath();
    ctx.moveTo(-80, y + layer * 9);
    for (let x = -80; x <= width + 120; x += 84) {
      const worldBandX = Math.floor((x + state.camera.x * (0.025 + layer * 0.006)) / 84);
      const step = (tileNoise(worldBandX, layer, 161) - 0.5) * (24 + layer * 5);
      ctx.lineTo(x, y + step);
    }
    ctx.globalAlpha = 0.2 + cameraDepth * 0.08;
    ctx.strokeStyle = GEO_COMIC_COLORS.ink;
    ctx.lineWidth = 14 + layer * 3;
    ctx.stroke();
    ctx.globalAlpha = rustBand ? 0.15 : 0.1;
    ctx.strokeStyle = rustBand ? GEO_COMIC_COLORS.rust : GEO_COMIC_COLORS.damp;
    ctx.lineWidth = 7 + layer * 2;
    ctx.stroke();
  }

  // A handful of fixed hatch marks gives the void a printed-comic texture;
  // they are screen-cheap and anchored to camera position, never animated.
  ctx.globalAlpha = 0.07;
  ctx.strokeStyle = GEO_COMIC_COLORS.rustLight;
  ctx.lineWidth = 2;
  for (let hatch = 0; hatch < 9; hatch += 1) {
    const worldColumn = Math.floor(state.camera.x / 160) + hatch;
    const hx = ((worldColumn * 149 - state.camera.x * 0.06) % (width + 180)) - 40;
    const hy = 35 + tileNoise(worldColumn, Math.floor(state.camera.y / 140), 162) * Math.max(80, height - 90);
    ctx.beginPath();
    ctx.moveTo(hx, hy);
    ctx.lineTo(hx + 18, hy - 7);
    ctx.stroke();
  }
  ctx.restore();

  ctx.fillStyle = `rgba(3, 7, 12, ${0.07 + cameraDepth * 0.35})`;
  ctx.fillRect(0, 0, width, height);
}

function drawWorld(now) {
  if (!state.world) return;
  const shakeX = state.shake ? (Math.random() - 0.5) * state.shake : 0;
  const shakeY = state.shake ? (Math.random() - 0.5) * state.shake : 0;
  const cameraX = state.camera.x - shakeX;
  const cameraY = state.camera.y - shakeY;
  ctx.save();
  ctx.translate(-cameraX, -cameraY);

  const visible = state.world.getVisibleTiles({ x: cameraX, y: cameraY }, state.viewport.width, state.viewport.height);
  for (const entry of visible) drawTile(entry, now);

  drawSenseField(now);
  drawRuntimeFields(now);
  drawMicroEvents(now);
  drawTargeting(now);
  drawBeams();
  drawDrones(now);
  drawMiner(now);
  drawParticles();
  drawFloaters();
  ctx.restore();
  drawVignette();
}

function drawRuntimeFields(now) {
  const field = activeMagneticField();
  if (field) {
    const alpha = clamp(field.remaining / Math.max(0.01, field.maxDuration || field.remaining), 0, 1);
    const pulse = 0.96 + Math.sin(now * 0.008) * 0.04;
    ctx.save();
    ctx.translate(field.x, field.y);
    ctx.globalAlpha = 0.32 + alpha * 0.48;
    ctx.strokeStyle = '#66e5ff';
    ctx.fillStyle = 'rgba(68, 184, 218, 0.08)';
    ctx.lineWidth = 2.5;
    ctx.setLineDash([7, 5]);
    ctx.beginPath();
    ctx.arc(0, 0, field.radius * pulse, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.rotate(now * 0.0015);
    for (let index = 0; index < 4; index += 1) {
      ctx.rotate(Math.PI * 0.5);
      ctx.beginPath();
      ctx.moveTo(field.radius * 0.28, 0);
      ctx.lineTo(field.radius * 0.42, 0);
      ctx.stroke();
    }
    ctx.restore();
  }
  for (const superField of state.superFields) {
    const alpha = clamp(superField.remaining / Math.max(0.01, superField.maxDuration), 0, 1);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.16 + alpha * 0.38;
    ctx.fillStyle = 'rgba(76, 255, 218, 0.12)';
    ctx.strokeStyle = '#75ffe2';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(superField.x, superField.y, superField.radius * (0.94 + Math.sin(now * 0.014) * 0.06), 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
  for (const [key, expires] of state.laserHeatMarks) {
    if (expires < state.elapsed) continue;
    const [tx, ty] = key.split(':').map(Number);
    const tile = state.world.getTile(tx, ty);
    if (!tile || tile.kind === 'air') continue;
    const alpha = clamp((expires - state.elapsed) / Math.max(0.01, stats.laserHeatDuration), 0, 1);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.25 + alpha * 0.45;
    ctx.strokeStyle = '#ff8757';
    ctx.fillStyle = 'rgba(255, 93, 52, 0.12)';
    ctx.lineWidth = 2.5;
    ctx.fillRect(tx * TILE_SIZE + 2, ty * TILE_SIZE + 2, TILE_SIZE - 4, TILE_SIZE - 4);
    ctx.strokeRect(tx * TILE_SIZE + 2, ty * TILE_SIZE + 2, TILE_SIZE - 4, TILE_SIZE - 4);
    ctx.restore();
  }
}

function drawMicroEvents(now) {
  if (!state.world || state.mode !== 'run') return;
  const events = typeof state.world.getMicroEvents === 'function' ? state.world.getMicroEvents() : [];
  for (const event of events) {
    const radius = event.radius || event.radiusTiles * TILE_SIZE || TILE_SIZE * 3;
    const fromPlayer = state.player ? distance(state.player.x, state.player.y, event.x, event.y) : Infinity;
    const onScreen = event.x + radius >= state.camera.x
      && event.x - radius <= state.camera.x + state.viewport.width
      && event.y + radius >= state.camera.y
      && event.y - radius <= state.camera.y + state.viewport.height;
    const sensed = fromPlayer <= effectiveSenseRadius() * 1.35 + radius;
    if (!onScreen && !sensed) continue;
    const pulse = REDUCED_MOTION ? 0.62 : 0.5 + Math.sin(now * 0.012 + event.tx) * 0.5;
    const color = event.color || '#ffd170';
    const markerRadius = Math.min(68, Math.max(42, radius * 0.56));
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.08 + pulse * 0.1;
    const glow = ctx.createRadialGradient(event.x, event.y, 4, event.x, event.y, markerRadius);
    glow.addColorStop(0, color);
    glow.addColorStop(0.42, `${color}42`);
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(event.x, event.y, markerRadius, 0, Math.PI * 2);
    ctx.fill();

    // Events use a signal mast and chevrons. Circular language stays reserved
    // for sonar and explosions, so this marker cannot masquerade as a target.
    ctx.globalAlpha = 0.46 + pulse * 0.24;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.shadowColor = color;
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.moveTo(event.x, event.y - markerRadius);
    ctx.lineTo(event.x, event.y - 29);
    ctx.moveTo(event.x, event.y + 29);
    ctx.lineTo(event.x, event.y + markerRadius * 0.68);
    ctx.stroke();
    for (const side of [-1, 1]) {
      const x = event.x + side * (32 + pulse * 5);
      ctx.beginPath();
      ctx.moveTo(x + side * 8, event.y - 8);
      ctx.lineTo(x, event.y);
      ctx.lineTo(x + side * 8, event.y + 8);
      ctx.stroke();
    }

    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 0.96;
    ctx.fillStyle = '#071018';
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.beginPath();
    const plateRadius = 24 + pulse * 2;
    for (let index = 0; index < 6; index += 1) {
      const angle = index / 6 * Math.PI * 2 - Math.PI * 0.5;
      const x = event.x + Math.cos(angle) * plateRadius;
      const y = event.y + Math.sin(angle) * plateRadius;
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.font = 'bold 24px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(event.icon || '◆', event.x, event.y + 1);
    ctx.font = '900 11px system-ui, sans-serif';
    ctx.fillText(event.label || 'АНОМАЛИЯ', event.x, event.y - 38);
    ctx.restore();
  }
}

function drawTile({ tile, tx, ty, x, y }, now) {
  if (!tile) return;
  if (tile.kind === 'air') {
    const surface = state.world.surface?.[tx] ?? WORLD_CONFIG.SURFACE_BASE;
    if (ty < surface) {
      const sky = clamp(1 - ty / Math.max(1, surface), 0, 1);
      ctx.fillStyle = `rgba(27, 74, 78, ${0.2 + sky * 0.28})`;
      ctx.fillRect(x, y, TILE_SIZE + 1, TILE_SIZE + 1);
      if (ty === surface - 1) {
        ctx.fillStyle = '#617a4a';
        ctx.fillRect(x, y + TILE_SIZE - 4, TILE_SIZE + 1, 4);
      }
    } else {
      const dust = tileNoise(tx, ty, 8);
      if (dust > 0.9) {
        ctx.fillStyle = 'rgba(176, 115, 79, 0.08)';
        ctx.fillRect(x + dust * 18, y + 8, 2, 2);
      }
      drawCaveLandmark(x, y, tx, ty, surface);
    }
    return;
  }

  const palette = TERRAIN_PALETTES[tile.kind] || TERRAIN_PALETTES.stone;
  const depthTone = terrainDepthFactor(tx, ty);
  const macroNoise = terrainMassNoise(tx + ty * 0.58, ty - tx * 0.16, 2);
  const baseIndex = clamp(
    Math.round((palette.base.length - 1) * (0.36 + macroNoise * 0.32) - depthTone * 1.5),
    0,
    palette.base.length - 1,
  );
  const openMask = getOpenTerrainMask(tx, ty);
  drawTerrainBaseLayer(x, y, tx, ty, tile.kind, palette, baseIndex, openMask);
  drawTerrainDepthTone(x, y, tx, ty, openMask);
  drawTerrainEdgeLandmark(x, y, tx, ty, palette, openMask);

  if (tile.oreId) {
    const ore = oreById.get(tile.oreId);
    const oreDistance = state.player ? distance(state.player.x, state.player.y, x + TILE_SIZE / 2, y + TILE_SIZE / 2) : Infinity;
    const focusedOre = getFocusedOre();
    const lockedRadius = state.target?.tx === tx && state.target?.ty === ty ? (state.target.lockRadius || 0) : 0;
    const detectionRadius = Math.max(
      lockedRadius,
      effectiveSenseRadius() * (focusedOre && focusedOre.id === ore?.id ? focusedSenseMultiplier(focusedOre) : 1),
    );
    const sensed = (!focusedOre || focusedOre.id === ore?.id)
      && oreDistance <= detectionRadius * 1.05
      && hasSenseLine(state.player.x, state.player.y, x + TILE_SIZE / 2, y + TILE_SIZE / 2, focusedOre ? 7 : 2);
    if (sensed) {
      tile.discovered = true;
      tile.sensedUntil = Math.max(tile.sensedUntil || 0, state.elapsed + (stats.sensePersistence || 0));
    }
    const remembered = (tile.sensedUntil || 0) >= state.elapsed;
    const physicallyExposed = tile.discovered && oreDistance <= TILE_SIZE * 2.25;
    drawOreInTile(x, y, tx, ty, ore, sensed || remembered || physicallyExposed, now);
    const veinState = tile.veinId ? state.veinRuntime.get(tile.veinId) : null;
    if (veinState?.rich || veinState?.motherlode) {
      const motherlode = Boolean(veinState.motherlode);
      const glow = 0.5 + Math.sin(now * 0.006 + tx + ty) * 0.25;
      ctx.save();
      ctx.globalAlpha = motherlode ? 0.72 + glow * 0.2 : 0.42 + glow * 0.16;
      ctx.strokeStyle = motherlode ? '#fff0a6' : '#f2c95d';
      ctx.lineWidth = motherlode ? 3 : 2;
      ctx.setLineDash(motherlode ? [5, 2] : [3, 4]);
      ctx.strokeRect(x + 2.5, y + 2.5, TILE_SIZE - 5, TILE_SIZE - 5);
      ctx.restore();
    }
    if (stats.oreOutline && tile.discovered && !sensed && ore) {
      ctx.fillStyle = `${ore.accent || ore.color}88`;
      ctx.fillRect(x + 3, y + 3, 6, 1);
      ctx.fillRect(x + 3, y + 3, 1, 6);
      ctx.fillRect(x + TILE_SIZE - 9, y + 3, 6, 1);
      ctx.fillRect(x + TILE_SIZE - 4, y + 3, 1, 6);
      ctx.fillRect(x + 3, y + TILE_SIZE - 4, 6, 1);
      ctx.fillRect(x + 3, y + TILE_SIZE - 9, 1, 6);
      ctx.fillRect(x + TILE_SIZE - 9, y + TILE_SIZE - 4, 6, 1);
      ctx.fillRect(x + TILE_SIZE - 4, y + TILE_SIZE - 9, 1, 6);
    }
  }

  if (tile.cracked > 0.02 && tile.kind !== 'bedrock') drawCracks(x, y, tx, ty, tile.cracked);
}

function traceOreNodeSilhouette(oreId, width, height, noise, branchNoise) {
  const halfW = width * 0.5;
  const halfH = height * 0.5;
  ctx.beginPath();
  switch (oreId) {
    case 'copper':
      ctx.moveTo(-halfW, 1);
      ctx.lineTo(-halfW * 0.64, -halfH * 0.78);
      ctx.lineTo(-1, -halfH * 0.48);
      ctx.lineTo(halfW * 0.4, -halfH);
      ctx.lineTo(halfW, -1);
      ctx.lineTo(halfW * 0.58, halfH * 0.86);
      ctx.lineTo(1, halfH * 0.54);
      ctx.lineTo(-halfW * 0.55, halfH);
      ctx.closePath();
      break;
    case 'coal':
      ctx.moveTo(-halfW, -halfH * 0.16);
      ctx.lineTo(-halfW * 0.54, -halfH);
      ctx.lineTo(1, -halfH * 0.7);
      ctx.lineTo(halfW * 0.68, -halfH);
      ctx.lineTo(halfW, -halfH * 0.18);
      ctx.lineTo(halfW * 0.62, halfH * 0.7);
      ctx.lineTo(0, halfH);
      ctx.lineTo(-halfW * 0.75, halfH * 0.58);
      ctx.closePath();
      break;
    case 'iron':
      ctx.moveTo(-halfW, -halfH * 0.42);
      ctx.lineTo(-halfW * 0.58, -halfH);
      ctx.lineTo(halfW * 0.58, -halfH);
      ctx.lineTo(halfW, -halfH * 0.34);
      ctx.lineTo(halfW, halfH * 0.5);
      ctx.lineTo(halfW * 0.48, halfH);
      ctx.lineTo(-halfW * 0.68, halfH * 0.78);
      ctx.lineTo(-halfW, halfH * 0.24);
      ctx.closePath();
      break;
    case 'amber':
      ctx.ellipse(0, 1, halfW * 0.78, halfH, noise * 0.38 - 0.19, 0, Math.PI * 2);
      break;
    case 'silver':
      ctx.moveTo(-halfW, 2);
      ctx.lineTo(-halfW * 0.2, -2);
      ctx.lineTo(-1, -halfH);
      ctx.lineTo(2, -2);
      ctx.lineTo(halfW, -1);
      ctx.lineTo(halfW * 0.18, 2);
      ctx.lineTo(1, halfH);
      ctx.lineTo(-2, 2);
      ctx.closePath();
      break;
    case 'gold': {
      const offset = branchNoise > 0.5 ? 1 : -1;
      ctx.arc(-halfW * 0.34, 1, halfH * 0.72, 0, Math.PI * 2);
      ctx.moveTo(halfW * 0.58 + halfH * 0.72, -1);
      ctx.arc(halfW * 0.38, -1, halfH * 0.72, 0, Math.PI * 2);
      ctx.moveTo(offset * halfW * 0.08 + halfH * 0.58, halfH * 0.4);
      ctx.arc(offset * halfW * 0.08, halfH * 0.4, halfH * 0.58, 0, Math.PI * 2);
      break;
    }
    case 'amethyst':
      ctx.moveTo(-halfW, halfH);
      ctx.lineTo(-halfW * 0.76, -halfH * 0.2);
      ctx.lineTo(-halfW * 0.3, -halfH);
      ctx.lineTo(0, -halfH * 0.34);
      ctx.lineTo(halfW * 0.38, -halfH * 0.92);
      ctx.lineTo(halfW * 0.62, -halfH * 0.08);
      ctx.lineTo(halfW, -halfH * 0.5);
      ctx.lineTo(halfW * 0.78, halfH);
      ctx.closePath();
      break;
    case 'prism_crystal':
      ctx.moveTo(0, -halfH);
      ctx.lineTo(halfW * 0.78, -halfH * 0.28);
      ctx.lineTo(halfW, halfH * 0.38);
      ctx.lineTo(0, halfH);
      ctx.lineTo(-halfW, halfH * 0.28);
      ctx.lineTo(-halfW * 0.64, -halfH * 0.52);
      ctx.closePath();
      break;
    case 'void_ore':
      ctx.ellipse(0, 0, halfW, halfH, branchNoise * 0.2 - 0.1, 0, Math.PI * 2);
      break;
    case 'star_core':
      for (let point = 0; point < 12; point += 1) {
        const angle = -Math.PI * 0.5 + point * Math.PI / 6;
        const radius = point % 2 === 0 ? halfW : halfW * 0.58;
        const px = Math.cos(angle) * radius;
        const py = Math.sin(angle) * radius * (height / Math.max(1, width));
        if (point === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      break;
    default:
      ctx.rect(-halfW, -halfH, width, height);
      break;
  }
}

function drawOreMaterialDetails(ore, width, height, noise, branchNoise, revealed) {
  const halfW = width * 0.5;
  const halfH = height * 0.5;
  const accent = ore.accent || '#fff';
  ctx.globalAlpha = revealed ? 0.78 : 0.05;
  ctx.fillStyle = accent;
  ctx.strokeStyle = accent;
  ctx.lineWidth = 1.5;

  switch (ore.id) {
    case 'copper':
      ctx.fillRect(-halfW * 0.54, -2, 3, 2);
      ctx.fillRect(halfW * 0.2, 1, 2, 2);
      ctx.globalAlpha = revealed ? 0.5 : 0.04;
      ctx.strokeStyle = '#713b2d';
      ctx.beginPath();
      ctx.moveTo(-halfW * 0.2, -halfH * 0.46);
      ctx.lineTo(halfW * 0.48, -1);
      ctx.stroke();
      break;
    case 'coal':
      ctx.globalAlpha = revealed ? 0.38 : 0.04;
      ctx.strokeStyle = accent;
      ctx.beginPath();
      ctx.moveTo(-halfW * 0.55, -halfH * 0.48);
      ctx.lineTo(-1, 0);
      ctx.lineTo(-halfW * 0.2, halfH * 0.64);
      ctx.moveTo(-1, 0);
      ctx.lineTo(halfW * 0.58, -halfH * 0.34);
      ctx.stroke();
      break;
    case 'iron':
      ctx.globalAlpha = revealed ? 0.56 : 0.05;
      ctx.beginPath();
      ctx.moveTo(-halfW * 0.66, -halfH * 0.5);
      ctx.lineTo(halfW * 0.55, -halfH * 0.5);
      ctx.lineTo(halfW * 0.34, -1);
      ctx.lineTo(-halfW * 0.8, -1);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = revealed ? 0.36 : 0.03;
      ctx.fillStyle = '#354149';
      ctx.fillRect(-halfW * 0.48, halfH * 0.32, width * 0.78, 2);
      break;
    case 'amber':
      ctx.globalAlpha = revealed ? 0.46 : 0.04;
      ctx.beginPath();
      ctx.ellipse(-1, 0, halfW * 0.42, halfH * 0.62, noise * 0.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = revealed ? 0.62 : 0.04;
      ctx.fillStyle = '#7a431c';
      ctx.fillRect(branchNoise > 0.5 ? 1 : -3, 1, 2, 2);
      break;
    case 'silver':
      ctx.globalAlpha = revealed ? 0.92 : 0.06;
      ctx.beginPath();
      ctx.moveTo(-halfW * 0.72, 0);
      ctx.lineTo(halfW * 0.72, -1);
      ctx.moveTo(0, -halfH * 0.7);
      ctx.lineTo(1, halfH * 0.65);
      ctx.stroke();
      break;
    case 'gold':
      ctx.globalAlpha = revealed ? 0.76 : 0.05;
      ctx.beginPath();
      ctx.arc(-halfW * 0.38, -1, 2, 0, Math.PI * 2);
      ctx.arc(halfW * 0.34, -2, 1.7, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = revealed ? 0.32 : 0.03;
      ctx.strokeStyle = '#86571c';
      ctx.beginPath();
      ctx.moveTo(-1, -halfH * 0.5);
      ctx.lineTo(1, halfH * 0.58);
      ctx.stroke();
      break;
    case 'amethyst':
      ctx.globalAlpha = revealed ? 0.52 : 0.04;
      ctx.beginPath();
      ctx.moveTo(-halfW * 0.7, halfH * 0.7);
      ctx.lineTo(-halfW * 0.28, -halfH * 0.62);
      ctx.lineTo(0, halfH * 0.54);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = revealed ? 0.7 : 0.05;
      ctx.beginPath();
      ctx.moveTo(halfW * 0.28, -halfH * 0.56);
      ctx.lineTo(halfW * 0.48, halfH * 0.54);
      ctx.stroke();
      break;
    case 'prism_crystal':
      ctx.globalAlpha = revealed ? 0.5 : 0.04;
      ctx.fillStyle = '#d68aff';
      ctx.beginPath();
      ctx.moveTo(0, -halfH * 0.86);
      ctx.lineTo(halfW * 0.72, -halfH * 0.2);
      ctx.lineTo(0, 1);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#8fffe2';
      ctx.beginPath();
      ctx.moveTo(0, 1);
      ctx.lineTo(halfW * 0.8, halfH * 0.34);
      ctx.lineTo(0, halfH * 0.78);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = revealed ? 0.84 : 0.06;
      ctx.strokeStyle = accent;
      ctx.beginPath();
      ctx.moveTo(0, -halfH * 0.8);
      ctx.lineTo(0, halfH * 0.75);
      ctx.stroke();
      break;
    case 'void_ore':
      ctx.globalAlpha = revealed ? 0.96 : 0.08;
      ctx.fillStyle = '#070811';
      ctx.beginPath();
      ctx.ellipse(0, 0, halfW * 0.62, halfH * 0.56, branchNoise * 0.2 - 0.1, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = revealed ? 0.7 : 0.05;
      ctx.strokeStyle = accent;
      ctx.beginPath();
      ctx.arc(0, 0, halfH * 0.66, -1.2, 1.05);
      ctx.stroke();
      ctx.fillStyle = accent;
      ctx.fillRect(1, -1, 2, 2);
      break;
    case 'star_core':
      ctx.globalAlpha = revealed ? 0.88 : 0.06;
      ctx.fillStyle = accent;
      ctx.beginPath();
      ctx.arc(0, 0, halfW * 0.31, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-halfW * 0.62, 0);
      ctx.lineTo(-halfW * 0.2, 0);
      ctx.moveTo(halfW * 0.2, -1);
      ctx.lineTo(halfW * 0.68, -halfH * 0.22);
      ctx.moveTo(0, -halfH * 0.66);
      ctx.lineTo(0, -halfH * 0.22);
      ctx.stroke();
      break;
    default:
      ctx.fillRect(-2, -halfH * 0.72, 3, Math.max(3, height * 0.5));
      break;
  }
}

function drawOreInTile(x, y, tx, ty, ore, revealed, now) {
  if (!ore) return;
  const style = ORE_RENDER_STYLES[ore.id] || ORE_RENDER_STYLES.iron;
  const noise = tileNoise(tx, ty, 13);
  const branchNoise = tileNoise(tx, ty, 14);
  const pulse = 0.82 + Math.sin(now * 0.004 + tx * 0.7 + ty) * 0.18;
  const centerX = Math.round(x + 9 + noise * 10);
  const centerY = Math.round(y + 9 + tileNoise(tx, ty, 15) * 10);
  const joinsLeft = hasMatchingOre(tx - 1, ty, ore.id);
  const joinsRight = hasMatchingOre(tx + 1, ty, ore.id);
  const joinsTop = hasMatchingOre(tx, ty - 1, ore.id);
  const joinsBottom = hasMatchingOre(tx, ty + 1, ore.id);

  ctx.save();
  ctx.lineCap = style.cap;
  ctx.lineJoin = ore.id === 'coal' ? 'miter' : 'round';
  ctx.beginPath();

  let connectionCount = 0;
  if (joinsLeft) {
    const edgeY = y + verticalOreEdgeOffset(tx, ty);
    ctx.moveTo(centerX, centerY);
    ctx.lineTo(x + 7, Math.round(centerY + (edgeY - centerY) * 0.55));
    ctx.lineTo(x, edgeY);
    connectionCount += 1;
  }
  if (joinsRight) {
    const edgeY = y + verticalOreEdgeOffset(tx + 1, ty);
    ctx.moveTo(centerX, centerY);
    ctx.lineTo(x + TILE_SIZE - 7, Math.round(centerY + (edgeY - centerY) * 0.55));
    ctx.lineTo(x + TILE_SIZE, edgeY);
    connectionCount += 1;
  }
  if (joinsTop) {
    const edgeX = x + horizontalOreEdgeOffset(tx, ty);
    ctx.moveTo(centerX, centerY);
    ctx.lineTo(Math.round(centerX + (edgeX - centerX) * 0.55), y + 7);
    ctx.lineTo(edgeX, y);
    connectionCount += 1;
  }
  if (joinsBottom) {
    const edgeX = x + horizontalOreEdgeOffset(tx, ty + 1);
    ctx.moveTo(centerX, centerY);
    ctx.lineTo(Math.round(centerX + (edgeX - centerX) * 0.55), y + TILE_SIZE - 7);
    ctx.lineTo(edgeX, y + TILE_SIZE);
    connectionCount += 1;
  }

  // Edge coordinates are shared by adjacent tiles, so a deposit remains one
  // uninterrupted vein even though each tile has a different material glyph.
  if (connectionCount === 0) {
    const forkX = branchNoise > 0.5 ? 1 : -1;
    const verticalMaterial = ore.id === 'amber' || ore.id === 'amethyst' || ore.id === 'prism_crystal';
    if (verticalMaterial) {
      ctx.moveTo(centerX - 3, centerY + 10);
      ctx.lineTo(centerX, centerY);
      ctx.lineTo(centerX + forkX * 4, centerY - 10);
    } else {
      ctx.moveTo(centerX - forkX * 9, centerY + 5);
      ctx.lineTo(centerX, centerY);
      ctx.lineTo(centerX + forkX * 10, centerY - 4 + Math.floor(noise * 4));
    }
    if (ore.id === 'silver') {
      ctx.moveTo(centerX - 3, centerY - 7);
      ctx.lineTo(centerX + 3, centerY + 7);
    }
  }

  // Content tiers are zero-based, so T4 starts at ore.tier === 3 (amber).
  const glowTier = clamp((ore.tier || 0) - 2, 0, 7);
  if (revealed && glowTier > 0) {
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = (0.035 + glowTier * 0.012) * pulse;
    ctx.strokeStyle = ore.color;
    ctx.lineWidth = style.veinWidth + 7 + glowTier;
    ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';
  }

  ctx.globalAlpha = revealed ? 0.78 : 0.075;
  ctx.strokeStyle = GEO_COMIC_COLORS.ink;
  ctx.lineWidth = style.veinWidth + 5;
  ctx.stroke();
  ctx.globalAlpha = revealed ? 0.88 + pulse * 0.1 : 0.13;
  ctx.strokeStyle = ore.color;
  ctx.lineWidth = style.veinWidth;
  ctx.stroke();
  if (revealed && style.highlightWidth > 0) {
    ctx.globalAlpha = 0.28 + pulse * 0.22;
    ctx.strokeStyle = ore.accent || '#fff';
    ctx.lineWidth = style.highlightWidth;
    ctx.stroke();
  }
  if (ore.id === 'void_ore') {
    ctx.globalAlpha = revealed ? 0.72 : 0.06;
    ctx.strokeStyle = '#070811';
    ctx.lineWidth = 4;
    ctx.stroke();
  }

  if (revealed && glowTier > 0) {
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = (0.025 + glowTier * 0.01) * pulse;
    ctx.fillStyle = ore.color;
    ctx.beginPath();
    ctx.arc(centerX, centerY, 12 + glowTier * 1.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = (0.035 + glowTier * 0.008) * pulse;
    ctx.beginPath();
    ctx.arc(centerX, centerY, 8 + glowTier, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
  }

  const nodeWidth = style.nodeWidth + Math.floor(noise * 2);
  const nodeHeight = style.nodeHeight + Math.floor(branchNoise * 2);
  ctx.save();
  ctx.translate(centerX, centerY);
  traceOreNodeSilhouette(ore.id, nodeWidth, nodeHeight, noise, branchNoise);
  ctx.globalAlpha = revealed ? 0.92 : 0.075;
  ctx.strokeStyle = GEO_COMIC_COLORS.ink;
  ctx.lineWidth = ore.id === 'silver' ? 3 : 5;
  ctx.stroke();
  ctx.globalAlpha = revealed ? 1 : 0.13;
  ctx.fillStyle = ore.color;
  ctx.fill();
  drawOreMaterialDetails(ore, nodeWidth, nodeHeight, noise, branchNoise, revealed);
  ctx.restore();
  ctx.restore();
}

function drawCracks(x, y, tx, ty, amount) {
  ctx.save();
  ctx.strokeStyle = `rgba(6, 12, 18, ${0.28 + amount * 0.6})`;
  ctx.lineWidth = 1 + amount;
  ctx.beginPath();
  const seed = tileNoise(tx, ty, 22);
  const cx = x + TILE_SIZE * (0.36 + seed * 0.24);
  const cy = y + TILE_SIZE * (0.35 + (1 - seed) * 0.2);
  ctx.moveTo(cx, y + 1);
  ctx.lineTo(cx - 2, cy);
  ctx.lineTo(cx - 9, cy + 6);
  ctx.moveTo(cx - 2, cy);
  ctx.lineTo(cx + 7, cy + 8);
  if (amount > 0.52) {
    ctx.moveTo(cx + 7, cy + 8);
    ctx.lineTo(x + TILE_SIZE - 1, y + TILE_SIZE - 4);
    ctx.moveTo(cx - 9, cy + 6);
    ctx.lineTo(x + 2, y + TILE_SIZE - 2);
  }
  ctx.stroke();
  ctx.restore();
}

function drawSenseField(now) {
  if (!state.player) return;
  const motionNow = REDUCED_MOTION ? 0 : now;
  const pulse = REDUCED_MOTION ? 0.56 : (motionNow * 0.0004 * (stats.sensePulseSpeed || 1)) % 1;
  const focusedOre = getFocusedOre();
  const baseSenseRadius = effectiveSenseRadius();
  const senseRadius = baseSenseRadius * focusedSenseMultiplier(focusedOre);
  const radius = senseRadius * (0.74 + pulse * 0.26);
  const signalColor = focusedOre?.accent || focusedOre?.color || '#68e0c1';
  const signalAlpha = clamp(0.13 + (1 - pulse) * 0.25 + state.ping * 0.22, 0, 0.72);
  ctx.save();
  ctx.strokeStyle = focusedOre
    ? `${signalColor}${Math.round(signalAlpha * 255).toString(16).padStart(2, '0')}`
    : `rgba(104, 224, 193, ${signalAlpha})`;
  ctx.lineWidth = focusedOre ? 2.5 : 2;
  ctx.lineCap = 'round';

  // Three separated sonar lobes read as sensing, without boxing the target in
  // another full ring. Focus mode inherits the chosen ore's signal colour.
  const sweepAngle = motionNow * 0.00045;
  for (let index = 0; index < 3; index += 1) {
    const start = sweepAngle + index * Math.PI * 2 / 3 - 0.43;
    ctx.beginPath();
    ctx.arc(state.player.x, state.player.y, radius, start, start + 0.86);
    ctx.stroke();
  }
  ctx.globalAlpha = 0.34 + state.ping * 0.18;
  ctx.lineWidth = 1;
  for (const innerScale of [0.34, 0.54]) {
    ctx.beginPath();
    ctx.arc(
      state.player.x,
      state.player.y,
      senseRadius * innerScale,
      sweepAngle - 0.55,
      sweepAngle + 0.55,
    );
    ctx.stroke();
  }
  if (focusedOre) {
    ctx.globalAlpha = 0.16;
    ctx.strokeStyle = '#68e0c1';
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 15]);
    ctx.beginPath();
    ctx.arc(state.player.x, state.player.y, baseSenseRadius, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  const glow = ctx.createRadialGradient(state.player.x, state.player.y, 8, state.player.x, state.player.y, senseRadius);
  glow.addColorStop(0, 'rgba(94,220,191,.05)');
  glow.addColorStop(0.55, 'rgba(94,220,191,.018)');
  glow.addColorStop(1, 'rgba(94,220,191,0)');
  ctx.globalAlpha = 1;
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(state.player.x, state.player.y, senseRadius, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawTargeting(now) {
  if (!state.player || state.mode !== 'run') return;
  if (state.triangleOreMemory?.size) {
    ctx.save();
    ctx.strokeStyle = 'rgba(116, 244, 223, 0.52)';
    ctx.lineWidth = 1;
    for (const [key, expires] of state.triangleOreMemory) {
      if (expires < state.elapsed) continue;
      const [tx, ty] = key.split(':').map(Number);
      const x = tx * TILE_SIZE + 4;
      const y = ty * TILE_SIZE + 4;
      const size = TILE_SIZE - 8;
      const notch = 4;
      ctx.globalAlpha = clamp((expires - state.elapsed) / Math.max(0.01, stats.triangularFixOreMemory), 0.12, 0.42);
      ctx.beginPath();
      ctx.moveTo(x, y + notch); ctx.lineTo(x, y); ctx.lineTo(x + notch, y);
      ctx.moveTo(x + size - notch, y + size); ctx.lineTo(x + size, y + size); ctx.lineTo(x + size, y + size - notch);
      ctx.stroke();
    }
    ctx.restore();
  }
  const triangle = getTriangulationTriangle();
  if (triangle) {
    const pulse = 0.5 + Math.sin(now * 0.008) * 0.5;
    ctx.save();
    ctx.fillStyle = `rgba(91, 226, 211, ${0.025 + pulse * 0.02})`;
    ctx.strokeStyle = `rgba(117, 246, 226, ${0.26 + pulse * 0.14})`;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([7, 8]);
    ctx.lineDashOffset = REDUCED_MOTION ? 0 : -now * 0.008;
    ctx.beginPath();
    ctx.moveTo(triangle[0].x, triangle[0].y);
    ctx.lineTo(triangle[1].x, triangle[1].y);
    ctx.lineTo(triangle[2].x, triangle[2].y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.setLineDash([]);
    const centerX = (triangle[0].x + triangle[1].x + triangle[2].x) / 3;
    const centerY = (triangle[0].y + triangle[1].y + triangle[2].y) / 3;
    ctx.fillStyle = 'rgba(138, 255, 234, 0.7)';
    ctx.font = '900 9px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('ТРИАНГУЛЯЦИЯ', centerX, centerY);
    ctx.restore();
  }
  if (!state.target) return;
  ctx.save();
  if (state.pathWaypoint) {
    ctx.strokeStyle = 'rgba(116, 228, 223, 0.3)';
    ctx.lineWidth = 1.25;
    ctx.setLineDash([4, 8]);
    ctx.beginPath();
    ctx.moveTo(state.player.x, state.player.y);
    ctx.lineTo(state.pathWaypoint.x, state.pathWaypoint.y);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  const exploring = state.target.kind === 'exploration';
  const alpha = 0.28 + (REDUCED_MOTION ? 0.08 : Math.sin(now * 0.009) * 0.08);
  ctx.strokeStyle = exploring
    ? `rgba(104, 224, 193, ${alpha * 0.72})`
    : `rgba(255, 209, 112, ${alpha})`;
  ctx.lineWidth = 1.25;
  ctx.setLineDash(exploring ? [4, 10] : [2, 9]);
  ctx.beginPath();
  ctx.moveTo(state.player.x, state.player.y);
  ctx.lineTo(state.target.x, state.target.y);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.translate(state.target.x, state.target.y);
  ctx.strokeStyle = exploring ? '#68e0c1' : '#ffd170';
  ctx.globalAlpha = exploring ? 0.52 : 0.9;
  ctx.lineWidth = exploring ? 1.5 : 2;
  if (exploring) {
    const explorerTurn = REDUCED_MOTION ? 0 : now * 0.0007;
    ctx.rotate(Math.PI * 0.25 + explorerTurn);
    ctx.strokeRect(-6, -6, 12, 12);
    ctx.beginPath();
    ctx.moveTo(0, -10);
    ctx.lineTo(0, -7);
    ctx.stroke();
  } else {
    const extent = 12 + (REDUCED_MOTION ? 0 : Math.sin(now * 0.009) * 1.25);
    const arm = 6;
    ctx.beginPath();
    ctx.moveTo(-extent, -extent + arm); ctx.lineTo(-extent, -extent); ctx.lineTo(-extent + arm, -extent);
    ctx.moveTo(extent - arm, -extent); ctx.lineTo(extent, -extent); ctx.lineTo(extent, -extent + arm);
    ctx.moveTo(extent, extent - arm); ctx.lineTo(extent, extent); ctx.lineTo(extent - arm, extent);
    ctx.moveTo(-extent + arm, extent); ctx.lineTo(-extent, extent); ctx.lineTo(-extent, extent - arm);
    ctx.stroke();
    ctx.fillStyle = '#fff0ad';
    ctx.fillRect(-1.5, -1.5, 3, 3);
  }
  ctx.restore();

  if (oreTargetIsValid(state.backupTarget, getFocusedOre()?.id || null)) {
    ctx.save();
    ctx.translate(state.backupTarget.x, state.backupTarget.y);
    ctx.strokeStyle = 'rgba(127, 233, 221, 0.45)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-7, -3); ctx.lineTo(-7, -7); ctx.lineTo(-3, -7);
    ctx.moveTo(3, 7); ctx.lineTo(7, 7); ctx.lineTo(7, 3);
    ctx.stroke();
    ctx.restore();
  }

  const beacon = getCrewBeacon();
  if (beacon) {
    ctx.save();
    ctx.translate(beacon.x, beacon.y);
    ctx.rotate(REDUCED_MOTION ? 0 : -now * 0.0008);
    ctx.strokeStyle = 'rgba(255, 165, 82, 0.72)';
    ctx.fillStyle = 'rgba(255, 165, 82, 0.08)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, -11);
    ctx.lineTo(9, 0);
    ctx.lineTo(0, 11);
    ctx.lineTo(-9, 0);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, -15);
    ctx.lineTo(0, -11);
    ctx.stroke();
    ctx.restore();
  }
}

function drawBeams() {
  for (const beam of state.beams) {
    const alpha = clamp(beam.life / beam.maxLife, 0, 1);
    const dx = beam.x2 - beam.x;
    const dy = beam.y2 - beam.y;
    const length = Math.max(0.001, Math.hypot(dx, dy));
    const normalX = -dy / length;
    const normalY = dx / length;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.shadowColor = beam.color;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (beam.kind === 'chain') {
      const segments = clamp(Math.ceil(length / 20), 4, 10);
      ctx.globalAlpha = alpha * 0.92;
      ctx.strokeStyle = beam.color;
      ctx.shadowBlur = 9;
      ctx.lineWidth = Math.max(1.5, beam.width);
      ctx.beginPath();
      ctx.moveTo(beam.x, beam.y);
      for (let index = 1; index < segments; index += 1) {
        const progress = index / segments;
        const offset = (index % 2 ? 1 : -1) * (3 + (index % 3));
        ctx.lineTo(beam.x + dx * progress + normalX * offset, beam.y + dy * progress + normalY * offset);
      }
      ctx.lineTo(beam.x2, beam.y2);
      ctx.stroke();
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = '#f3ddff';
      ctx.lineWidth = 1;
      ctx.stroke();
    } else if (beam.kind === 'prism' || beam.kind === 'prism-ricochet') {
      const spread = beam.kind === 'prism' ? Math.max(2.2, beam.width * 0.28) : 2;
      const colors = ['#6fffe4', '#fff0a8', '#e59cff'];
      ctx.shadowBlur = 14;
      for (let index = 0; index < colors.length; index += 1) {
        const offset = (index - 1) * spread;
        ctx.globalAlpha = alpha * (index === 1 ? 0.95 : 0.7);
        ctx.strokeStyle = colors[index];
        ctx.lineWidth = Math.max(1.4, beam.width * (index === 1 ? 0.28 : 0.2));
        ctx.beginPath();
        ctx.moveTo(beam.x + normalX * offset, beam.y + normalY * offset);
        ctx.lineTo(beam.x2 + normalX * offset, beam.y2 + normalY * offset);
        ctx.stroke();
      }
      ctx.globalAlpha = Math.min(1, alpha * 1.25);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = Math.max(1, beam.width * 0.1);
      ctx.beginPath();
      ctx.moveTo(beam.x, beam.y);
      ctx.lineTo(beam.x2, beam.y2);
      ctx.stroke();
    } else if (beam.kind === 'drone' || beam.kind === 'beacon') {
      ctx.globalAlpha = alpha * 0.74;
      ctx.strokeStyle = beam.color;
      ctx.shadowBlur = 6;
      ctx.lineWidth = beam.kind === 'beacon' ? 2 : 1.5;
      ctx.setLineDash(beam.kind === 'beacon' ? [2, 5] : [4, 4]);
      ctx.beginPath();
      ctx.moveTo(beam.x, beam.y);
      ctx.lineTo(beam.x2, beam.y2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.translate(beam.x2, beam.y2);
      ctx.rotate(Math.atan2(dy, dx) + Math.PI * 0.25);
      ctx.globalAlpha = alpha * 0.9;
      ctx.strokeRect(-3, -3, 6, 6);
    } else if (beam.kind === 'blast-guide') {
      ctx.globalAlpha = alpha * 0.55;
      ctx.strokeStyle = beam.color;
      ctx.shadowBlur = 0;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([7, 6]);
      ctx.beginPath();
      ctx.moveTo(beam.x, beam.y);
      ctx.lineTo(beam.x2, beam.y2);
      ctx.stroke();
    } else if (beam.kind === 'heat') {
      ctx.shadowBlur = 10;
      for (const offset of [-1.7, 1.7]) {
        ctx.globalAlpha = alpha * 0.75;
        ctx.strokeStyle = offset < 0 ? '#ff6b48' : '#ffd09a';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(beam.x + normalX * offset, beam.y + normalY * offset);
        ctx.lineTo(beam.x2 + normalX * offset, beam.y2 + normalY * offset);
        ctx.stroke();
      }
    } else {
      const isSolar = beam.kind === 'solar';
      const isLaser = beam.kind === 'laser' || beam.kind === 'ricochet' || isSolar;
      ctx.globalAlpha = alpha * (beam.kind === 'impact' || beam.kind === 'sample' ? 0.72 : 1);
      ctx.strokeStyle = beam.color;
      ctx.shadowBlur = isLaser ? 14 : 7;
      ctx.lineWidth = beam.width;
      if (beam.kind === 'fault') ctx.setLineDash([10, 3, 2, 3]);
      else if (beam.kind === 'chrono' || beam.kind === 'sample') ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.moveTo(beam.x, beam.y);
      ctx.lineTo(beam.x2, beam.y2);
      ctx.stroke();
      ctx.setLineDash([]);
      if (isLaser) {
        ctx.globalAlpha = Math.min(1, alpha * 1.5);
        ctx.strokeStyle = isSolar ? '#fffde1' : '#eaffff';
        ctx.lineWidth = Math.max(1, beam.width * 0.18);
        ctx.stroke();
      }
    }
    ctx.restore();
  }
  for (const shock of state.shocks) {
    const alpha = clamp(shock.life / Math.max(0.01, shock.maxLife), 0, 1);
    const radius = shock.radius
      ? shock.radius * (0.3 + (1 - alpha) * 0.72)
      : 9 + (1 - alpha) * 14;
    ctx.save();
    ctx.strokeStyle = shock.color || '#b58cff';
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    if (shock.kind === 'blast') {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = alpha * 0.82;
      ctx.lineWidth = 3;
      ctx.fillStyle = shock.color || '#ffc45d';
      ctx.beginPath();
      const points = REDUCED_MOTION ? 12 : 18;
      for (let index = 0; index < points; index += 1) {
        const angle = index / points * Math.PI * 2;
        const spikeRadius = radius * (index % 2 ? 0.7 : 1.05);
        const x = shock.x + Math.cos(angle) * spikeRadius;
        const y = shock.y + Math.sin(angle) * spikeRadius;
        if (index === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.globalAlpha = alpha * 0.12;
      ctx.fill();
      ctx.globalAlpha = alpha * 0.82;
      ctx.stroke();
    } else if (shock.kind === 'sense-pulse' || shock.kind === 'echo') {
      ctx.globalAlpha = alpha * (shock.kind === 'echo' ? 0.75 : 0.55);
      ctx.lineWidth = shock.kind === 'echo' ? 3 : 2;
      const phase = shock.kind === 'echo' ? Math.PI / 6 : 0;
      for (let index = 0; index < 4; index += 1) {
        const start = phase + index * Math.PI * 0.5 + 0.12;
        ctx.beginPath();
        ctx.arc(shock.x, shock.y, radius, start, start + 0.76);
        ctx.stroke();
      }
    } else if (shock.kind === 'impact' || shock.kind === 'fracture') {
      ctx.translate(shock.x, shock.y);
      ctx.globalAlpha = alpha * 0.72;
      ctx.lineWidth = shock.kind === 'impact' ? 3 : 2;
      const sides = shock.kind === 'impact' ? 8 : 6;
      ctx.beginPath();
      for (let index = 0; index < sides; index += 1) {
        const angle = index / sides * Math.PI * 2 + Math.PI / 8;
        const localRadius = radius * (shock.kind === 'fracture' && index % 2 ? 0.74 : 1);
        const x = Math.cos(angle) * localRadius;
        const y = Math.sin(angle) * localRadius;
        if (index === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      if (shock.kind === 'impact') ctx.closePath();
      ctx.stroke();
    } else if (shock.kind === 'solar') {
      ctx.translate(shock.x, shock.y);
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = alpha * 0.82;
      ctx.lineWidth = 3;
      for (let index = 0; index < 8; index += 1) {
        const angle = index * Math.PI * 0.25;
        ctx.beginPath();
        ctx.moveTo(Math.cos(angle) * radius * 0.55, Math.sin(angle) * radius * 0.55);
        ctx.lineTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
        ctx.stroke();
      }
    } else {
      ctx.globalAlpha = alpha * (shock.kind === 'field' ? 0.34 : 0.62);
      ctx.lineWidth = shock.radius ? (shock.kind === 'field' ? 2 : 3) : 2;
      ctx.setLineDash(shock.kind === 'orchestra' ? [9, 4, 2, 4] : [4, 5]);
      ctx.beginPath();
      ctx.arc(shock.x, shock.y, radius, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }
}

function drawDrones() {
  if (!dronesAreActive()) return;
  const count = Math.min(8, Math.max(0, Math.floor(stats.droneCount || 0)));
  for (let index = 0; index < count; index += 1) {
    const point = dronePosition(index, state.elapsed);
    ctx.save();
    ctx.translate(point.x, point.y);
    ctx.fillStyle = '#101c28';
    ctx.strokeStyle = '#76dbff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-8, 0);
    ctx.lineTo(-3, -6);
    ctx.lineTo(6, -4);
    ctx.lineTo(8, 2);
    ctx.lineTo(0, 6);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#d8ffff';
    ctx.fillRect(1, -2, 3, 3);
    ctx.restore();
  }
}

function drawMiner(now) {
  if (!state.player) return;
  const player = state.player;
  const toolTier = Math.max(1, stats.toolTier || 1);
  const hasSuperPick = stats.superPickUnlocked || toolTier >= 5;
  const hasLaser = stats.laserUnlocked || toolTier >= 6;
  const hasPrism = stats.tool === 'prismaticLaser' || toolTier >= 7;
  const visualScale = 1.17;
  const motionNow = REDUCED_MOTION ? 0 : now;
  const walk = Math.sin(motionNow * 0.016) * player.moving;
  const bob = Math.abs(Math.sin(motionNow * 0.016)) * player.moving * 1.1;

  // The lamp sits behind the silhouette, keeping the miner's colours crisp.
  ctx.save();
  const lampX = player.x + player.facing * 12;
  const lampY = player.y - 30 - bob;
  const lampGradient = ctx.createRadialGradient(lampX, lampY, 1, lampX, lampY, hasLaser ? 122 : 112);
  lampGradient.addColorStop(0, hasPrism ? 'rgba(154,255,239,.27)' : 'rgba(255,220,132,.25)');
  lampGradient.addColorStop(0.35, hasPrism ? 'rgba(183,140,255,.08)' : 'rgba(255,205,105,.09)');
  lampGradient.addColorStop(1, 'rgba(255,205,105,0)');
  ctx.fillStyle = lampGradient;
  ctx.beginPath();
  ctx.arc(lampX, lampY, hasLaser ? 122 : 112, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.translate(player.x, player.y);
  ctx.globalAlpha = 0.35;
  ctx.fillStyle = '#03090e';
  ctx.beginPath();
  ctx.ellipse(0, 23, 24, 7, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.translate(player.x, player.y - bob);
  ctx.scale(player.facing * visualScale, visualScale);
  ctx.lineJoin = 'bevel';
  ctx.lineCap = 'square';
  const outline = '#071119';

  // Modular backpack: its silhouette grows with the installed tool platform.
  ctx.strokeStyle = outline;
  ctx.lineWidth = 3;
  ctx.fillStyle = '#142630';
  ctx.beginPath();
  ctx.moveTo(-17, -14);
  ctx.lineTo(-7, -17);
  ctx.lineTo(-4, 10);
  ctx.lineTo(-15, 12);
  ctx.lineTo(-19, 5);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#29424a';
  ctx.fillRect(-16, -10, 7, 15);
  ctx.fillStyle = '#c97732';
  ctx.fillRect(-15, -7, 2, 9);
  ctx.fillStyle = '#789092';
  ctx.fillRect(-18, -2, 3, 9);
  ctx.strokeStyle = '#789092';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(-13, -15);
  ctx.lineTo(-15, -23);
  ctx.stroke();
  if (toolTier >= 2) {
    ctx.fillStyle = '#182d35';
    ctx.strokeStyle = outline;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.rect(-21, -12, 7, 20);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = toolTier >= 4 ? '#6fc9bf' : '#a76a39';
    ctx.fillRect(-19, -8, 3, 11);
    ctx.fillStyle = '#82989b';
    ctx.fillRect(-20, -13, 5, 3);
    ctx.fillRect(-20, 7, 5, 2);
  }
  if (toolTier >= 4) {
    ctx.fillStyle = '#243e46';
    ctx.strokeStyle = outline;
    ctx.lineWidth = 1.5;
    for (let index = 0; index < 3; index += 1) {
      ctx.fillRect(-24, -9 + index * 6, 5, 3);
      ctx.strokeRect(-24, -9 + index * 6, 5, 3);
    }
    ctx.strokeStyle = '#55747a';
    ctx.beginPath();
    ctx.moveTo(-17, 8);
    ctx.bezierCurveTo(-20, 14, -4, 16, 2, 11);
    ctx.stroke();
  }
  if (hasSuperPick) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.shadowColor = '#7ff8df';
    ctx.shadowBlur = 7;
    ctx.fillStyle = hasPrism ? '#e8a3ff' : '#75e8cf';
    ctx.fillRect(-19, -6, 3, 8);
    ctx.restore();
  }
  if (hasLaser) {
    ctx.fillStyle = '#193943';
    ctx.strokeStyle = outline;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-21, -16);
    ctx.lineTo(-13, -19);
    ctx.lineTo(-8, -14);
    ctx.lineTo(-14, -10);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = hasPrism ? '#e4a0ff' : '#70e7d4';
    ctx.fillRect(-18, -16, 5, 2);
  }

  // Short legs and oversized, magnetised work boots.
  ctx.strokeStyle = outline;
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.moveTo(-6, 9);
  ctx.lineTo(-8 + walk * 3.2, 17);
  ctx.moveTo(6, 9);
  ctx.lineTo(8 - walk * 3.2, 17);
  ctx.stroke();
  ctx.fillStyle = '#22343b';
  ctx.strokeStyle = outline;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.rect(-14 + walk * 2, 15, 11, 7);
  ctx.rect(3 - walk * 2, 15, 12, 7);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#7f9697';
  ctx.fillRect(-13 + walk * 2, 19, 10, 2);
  ctx.fillRect(4 - walk * 2, 19, 10, 2);

  // Broad pressure suit and battered trapezoid chest plate.
  ctx.fillStyle = '#15242d';
  ctx.strokeStyle = outline;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(-11, -13);
  ctx.lineTo(10, -13);
  ctx.lineTo(15, 7);
  ctx.lineTo(9, 13);
  ctx.lineTo(-10, 12);
  ctx.lineTo(-15, 5);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#2c7b70';
  ctx.beginPath();
  ctx.moveTo(-8, -10);
  ctx.lineTo(8, -10);
  ctx.lineTo(11, 5);
  ctx.lineTo(5, 9);
  ctx.lineTo(-7, 8);
  ctx.lineTo(-11, 3);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#6f8b8c';
  ctx.fillRect(-7, -8, 12, 2);
  ctx.fillStyle = '#c97732';
  ctx.fillRect(7, -6, 3, 8);

  // Utility belt, asymmetrical pouches and buckle.
  ctx.fillStyle = '#1b1715';
  ctx.fillRect(-12, 6, 24, 5);
  ctx.fillStyle = '#81532f';
  ctx.fillRect(-13, 7, 7, 7);
  ctx.fillRect(7, 6, 7, 8);
  ctx.fillStyle = '#b7a15d';
  ctx.fillRect(-3, 7, 7, 4);
  ctx.fillStyle = '#263b42';
  ctx.fillRect(-1, 8, 3, 2);

  // Layered shoulder armour and the gloved tool hand.
  ctx.fillStyle = '#244e50';
  ctx.strokeStyle = outline;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(-15, -11);
  ctx.lineTo(-8, -16);
  ctx.lineTo(-3, -11);
  ctx.lineTo(-7, -5);
  ctx.lineTo(-15, -6);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#c97732';
  ctx.beginPath();
  ctx.moveTo(8, -13);
  ctx.lineTo(16, -9);
  ctx.lineTo(15, -2);
  ctx.lineTo(8, 0);
  ctx.lineTo(5, -7);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#2a373b';
  ctx.beginPath();
  ctx.arc(14, 0, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  if (toolTier >= 3) {
    ctx.fillStyle = '#6a8586';
    ctx.strokeStyle = outline;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(8, -14);
    ctx.lineTo(16, -12);
    ctx.lineTo(18, -8);
    ctx.lineTo(13, -7);
    ctx.lineTo(8, -10);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
  if (toolTier >= 4) {
    ctx.strokeStyle = hasLaser ? '#5bd9cd' : '#b4713c';
    ctx.lineWidth = hasLaser ? 2.2 : 1.8;
    ctx.beginPath();
    ctx.moveTo(-14, 5);
    ctx.bezierCurveTo(-7, 17, 9, 13, 14, 4);
    ctx.stroke();
    ctx.strokeStyle = outline;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-13, 3);
    ctx.bezierCurveTo(-6, 14, 8, 11, 13, 3);
    ctx.stroke();
  }
  if (hasLaser) {
    ctx.fillStyle = '#153842';
    ctx.strokeStyle = outline;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(10, -15);
    ctx.lineTo(18, -12);
    ctx.lineTo(19, -5);
    ctx.lineTo(14, -3);
    ctx.lineTo(9, -8);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = hasPrism ? '#e59cff' : '#6df2d9';
    ctx.fillRect(15, -10, 3, 4);
  }

  // Wide face, heavy brow and a forked beard with a metal clasp.
  ctx.fillStyle = '#d39b70';
  ctx.strokeStyle = outline;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.ellipse(1, -18, 9.5, 9, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#34211d';
  ctx.fillRect(1, -21, 7, 2);
  ctx.fillStyle = '#0b151a';
  ctx.fillRect(6, -19, 2, 2);
  ctx.fillStyle = '#b97e56';
  ctx.fillRect(8, -17, 4, 3);
  if (hasLaser) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.shadowColor = hasPrism ? '#df9bff' : '#69f4da';
    ctx.shadowBlur = 6;
    ctx.fillStyle = hasPrism ? '#e9b1ff' : '#8affea';
    ctx.beginPath();
    ctx.moveTo(-1, -22);
    ctx.lineTo(10, -21);
    ctx.lineTo(10, -17);
    ctx.lineTo(0, -18);
    ctx.closePath();
    ctx.fill();
    if (hasPrism) {
      ctx.fillStyle = '#fff0a8';
      ctx.fillRect(4, -21, 2, 3);
    }
    ctx.restore();
  }
  ctx.fillStyle = '#6b3c2a';
  ctx.beginPath();
  ctx.moveTo(-5, -14);
  ctx.lineTo(8, -14);
  ctx.lineTo(10, -8);
  ctx.lineTo(6, 1);
  ctx.lineTo(1, -2);
  ctx.lineTo(-4, 2);
  ctx.lineTo(-8, -8);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#3e241d';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(-3, -12);
  ctx.lineTo(0, -3 + Math.sin(now * 0.01) * 0.7);
  ctx.moveTo(3, -12);
  ctx.lineTo(2, -2);
  ctx.moveTo(7, -11);
  ctx.lineTo(6, -5);
  ctx.stroke();
  ctx.fillStyle = '#8da0a0';
  ctx.fillRect(-2, -3, 6, 3);

  // Industrial helmet, side guard and lamp module.
  ctx.fillStyle = '#b8662f';
  ctx.strokeStyle = '#0b1418';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(-10, -21);
  ctx.lineTo(-7, -27);
  ctx.lineTo(5, -29);
  ctx.lineTo(11, -24);
  ctx.lineTo(11, -21);
  ctx.lineTo(-10, -20);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#26383e';
  ctx.fillRect(-9, -22, 4, 8);
  ctx.fillStyle = '#7f9697';
  ctx.fillRect(-5, -26, 9, 2);
  ctx.fillStyle = '#ffd77a';
  ctx.fillRect(6, -27, 7, 6);
  ctx.strokeRect(6, -27, 7, 6);
  ctx.fillStyle = '#fff2bd';
  ctx.fillRect(9, -25, 3, 2);
  if (toolTier >= 4) {
    ctx.fillStyle = '#2a444b';
    ctx.strokeStyle = outline;
    ctx.lineWidth = 1.5;
    ctx.fillRect(-13, -26, 5, 10);
    ctx.strokeRect(-13, -26, 5, 10);
    ctx.fillStyle = '#739093';
    ctx.fillRect(-12, -24, 3, 2);
    ctx.fillRect(-12, -20, 3, 2);
  }
  if (hasLaser) {
    ctx.strokeStyle = hasPrism ? '#df9bff' : '#6debd7';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, -28);
    ctx.lineTo(1, -34);
    ctx.lineTo(5, -36);
    ctx.stroke();
    ctx.fillStyle = hasPrism ? '#f0b4ff' : '#8affea';
    ctx.fillRect(4, -37, 3, 3);
  }
  if (hasPrism) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.shadowColor = '#d7a0ff';
    ctx.shadowBlur = 7;
    ctx.fillStyle = '#d9a4ff';
    ctx.beginPath();
    ctx.moveTo(-5, -29);
    ctx.lineTo(-1, -35);
    ctx.lineTo(3, -29);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // Rivets, scratches and small wear marks.
  ctx.fillStyle = '#91aaa8';
  ctx.fillRect(-8, -8, 2, 2);
  ctx.fillRect(7, 3, 2, 2);
  ctx.fillStyle = 'rgba(219,238,227,.55)';
  ctx.fillRect(-5, -4, 6, 1);
  ctx.fillRect(2, 1, 4, 1);
  ctx.fillStyle = '#0d1b22';
  ctx.fillRect(-15, 0, 2, 2);
  ctx.fillRect(12, 5, 2, 2);
  ctx.restore();

  const targetTile = state.target ? state.world?.getTile(state.target.tx, state.target.ty) : null;
  const targetVeinId = targetTile?.veinId || state.lastBrokenVeinId || null;
  const sampleProgress = targetVeinId ? state.tripleSampleVeins.get(targetVeinId)?.count || 0 : 0;
  if (stats.tripleSampleEvery > 0 && targetVeinId) {
    ctx.save();
    ctx.font = '900 10px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const label = `ПРОБА ${sampleProgress}/${stats.tripleSampleEvery}`;
    const width = Math.max(76, ctx.measureText(label).width + 14);
    ctx.fillStyle = 'rgba(7, 12, 20, 0.88)';
    ctx.fillRect(player.x - width * 0.5, player.y - 66 - bob, width, 16);
    ctx.strokeStyle = '#e7b9ff';
    ctx.strokeRect(player.x - width * 0.5, player.y - 66 - bob, width, 16);
    ctx.fillStyle = '#f5d1ff';
    ctx.fillText(label, player.x, player.y - 58 - bob);
    ctx.restore();
  }
  if (stats.trueOverkillEnabled && state.overkillReservoir > 0) {
    const thresholdHp = Math.max(1, targetTile?.maxHp || stats.pickPower || 1) * Math.max(0.01, stats.overkillReservoirYieldThreshold || 1);
    const fill = clamp(state.overkillReservoir / thresholdHp, 0, 1);
    const barY = player.y - (stats.tripleSampleEvery > 0 && targetVeinId ? 74 : 58) - bob;
    ctx.save();
    ctx.fillStyle = 'rgba(8, 10, 18, 0.88)';
    ctx.fillRect(player.x - 34, barY, 68, 6);
    ctx.fillStyle = '#c998ff';
    ctx.fillRect(player.x - 33, barY + 1, 66 * fill, 4);
    ctx.strokeStyle = fill >= 1 ? '#fff1ff' : '#8353ae';
    ctx.strokeRect(player.x - 34, barY, 68, 6);
    ctx.restore();
  }
  if (state.demolitionComboStage > 0 && state.demolitionComboExpires >= state.elapsed) {
    ctx.save();
    ctx.font = '900 9px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = state.demolitionComboStage === 1 ? '#76dbff' : '#ca9cff';
    ctx.fillText(`ОРКЕСТР ${state.demolitionComboStage}/3`, player.x, player.y - 84 - bob);
    ctx.restore();
  }

  drawTool();
}

function drawTool() {
  const player = state.player;
  const swingOffset = Math.sin(player.swing * Math.PI) * -0.72;
  const angle = player.angle + swingOffset * player.facing;
  const tier = Math.max(1, stats.toolTier || 1);
  const hasSuperPick = stats.superPickUnlocked || tier >= 5;
  const hasPrism = stats.tool === 'prismaticLaser' || tier >= 7;
  ctx.save();
  ctx.translate(player.x, player.y - 1);
  ctx.rotate(angle);
  ctx.scale(1.08, 1.08);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (stats.laserUnlocked) {
    if (hasPrism) {
      // The final tool has an open, forked silhouette and a visible prism core.
      ctx.strokeStyle = '#07131b';
      ctx.fillStyle = '#192e42';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(-2, -6);
      ctx.lineTo(19, -8);
      ctx.lineTo(29, -5);
      ctx.lineTo(34, 0);
      ctx.lineTo(29, 5);
      ctx.lineTo(19, 8);
      ctx.lineTo(-2, 6);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#2b5360';
      ctx.fillRect(2, -4, 14, 8);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.shadowColor = '#d69cff';
      ctx.shadowBlur = 9;
      ctx.fillStyle = '#e7a9ff';
      ctx.beginPath();
      ctx.moveTo(17, 0);
      ctx.lineTo(23, -6);
      ctx.lineTo(29, 0);
      ctx.lineTo(23, 6);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      for (const offset of [-5, 0, 5]) {
        ctx.strokeStyle = offset === 0 ? '#fff0a8' : offset < 0 ? '#75ffe5' : '#e7a9ff';
        ctx.lineWidth = offset === 0 ? 2.5 : 2;
        ctx.beginPath();
        ctx.moveTo(28, offset * 0.58);
        ctx.lineTo(40, offset);
        ctx.stroke();
      }
      ctx.fillStyle = '#eaffff';
      ctx.fillRect(38, -1.5, 5, 3);
    } else {
      // The mining laser is a compact industrial cannon with a closed barrel.
      ctx.fillStyle = '#18343e';
      ctx.strokeStyle = '#07131b';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(-2, -6);
      ctx.lineTo(8, -8);
      ctx.lineTo(28, -6);
      ctx.lineTo(35, -3);
      ctx.lineTo(35, 3);
      ctx.lineTo(27, 6);
      ctx.lineTo(6, 7);
      ctx.lineTo(-2, 4);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#294d58';
      ctx.fillRect(3, -4, 9, 8);
      ctx.fillStyle = '#0e232c';
      for (let x = 14; x <= 24; x += 5) ctx.fillRect(x, -5, 2, 3);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.shadowColor = '#6df2d9';
      ctx.shadowBlur = 7;
      ctx.fillStyle = '#6df2d9';
      ctx.fillRect(11, -2, 18, 4);
      ctx.restore();
      ctx.fillStyle = '#79989e';
      ctx.fillRect(32, -5, 5, 10);
      ctx.fillStyle = '#dcffff';
      ctx.fillRect(36, -2, 6, 4);
      ctx.strokeStyle = '#7abfb8';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(4, -8);
      ctx.lineTo(9, -12);
      ctx.lineTo(16, -11);
      ctx.stroke();
    }
  } else {
    if (tier >= 4 && !hasSuperPick) {
      // Pneumatic tier swaps the pick profile for a motor housing and chisel.
      ctx.strokeStyle = '#07131b';
      ctx.fillStyle = '#374b50';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(1, -6);
      ctx.lineTo(24, -7);
      ctx.lineTo(30, -3);
      ctx.lineTo(30, 4);
      ctx.lineTo(23, 7);
      ctx.lineTo(1, 5);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#b66b34';
      ctx.fillRect(5, -4, 8, 8);
      ctx.fillStyle = '#71898b';
      ctx.fillRect(17, -5, 3, 10);
      ctx.strokeStyle = '#b8c7c8';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(29, 0);
      ctx.lineTo(41, 0);
      ctx.stroke();
      ctx.fillStyle = '#d7e1dc';
      ctx.beginPath();
      ctx.moveTo(39, -3);
      ctx.lineTo(45, 0);
      ctx.lineTo(39, 3);
      ctx.closePath();
      ctx.fill();
      if (!REDUCED_MOTION && player.swing > 0.05) {
        ctx.strokeStyle = 'rgba(232, 193, 113, 0.75)';
        ctx.lineWidth = 1;
        for (const y of [-9, 9]) {
          ctx.beginPath();
          ctx.moveTo(22, y);
          ctx.lineTo(29, y);
          ctx.stroke();
        }
      }
    } else {
      const handleColor = hasSuperPick ? '#d8ad52' : tier >= 3 ? '#789294' : tier >= 2 ? '#6f7470' : '#855737';
      ctx.strokeStyle = '#07131b';
      ctx.lineWidth = hasSuperPick ? 7 : 5;
      ctx.beginPath();
      ctx.moveTo(1, 0);
      ctx.lineTo(hasSuperPick ? 31 : 30, 0);
      ctx.stroke();
      ctx.strokeStyle = handleColor;
      ctx.lineWidth = hasSuperPick ? 4 : 3;
      ctx.stroke();
      ctx.fillStyle = tier >= 3 ? '#31454a' : '#4b3528';
      ctx.fillRect(6, -3, 8, 6);

      if (hasSuperPick) {
        ctx.strokeStyle = '#07131b';
        ctx.lineWidth = 9;
        ctx.beginPath();
        ctx.arc(31, 0, 13, -1.26, 1.26);
        ctx.stroke();
        ctx.strokeStyle = '#9ff2df';
        ctx.lineWidth = 6;
        ctx.stroke();
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.shadowColor = '#84ffe4';
        ctx.shadowBlur = 8;
        ctx.fillStyle = '#d9fff5';
        ctx.beginPath();
        ctx.arc(31, 0, 4.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        ctx.fillStyle = '#ddb660';
        ctx.fillRect(26, -3, 7, 6);
      } else if (tier >= 3) {
        ctx.fillStyle = '#a9bfc0';
        ctx.strokeStyle = '#07131b';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(27, -2);
        ctx.lineTo(29, -13);
        ctx.lineTo(35, -10);
        ctx.lineTo(38, -4);
        ctx.lineTo(32, 0);
        ctx.lineTo(38, 5);
        ctx.lineTo(34, 11);
        ctx.lineTo(29, 13);
        ctx.lineTo(27, 2);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#d0dcda';
        ctx.fillRect(29, -4, 5, 8);
      } else if (tier >= 2) {
        ctx.strokeStyle = '#07131b';
        ctx.lineWidth = 7;
        ctx.beginPath();
        ctx.moveTo(31, -11);
        ctx.lineTo(31, 11);
        ctx.stroke();
        ctx.strokeStyle = '#aebbbc';
        ctx.lineWidth = 4;
        ctx.stroke();
        ctx.fillStyle = '#ccd4d1';
        ctx.beginPath();
        ctx.moveTo(29, -12);
        ctx.lineTo(35, -9);
        ctx.lineTo(31, -5);
        ctx.closePath();
        ctx.fill();
      } else {
        ctx.fillStyle = '#9a9f9b';
        ctx.strokeStyle = '#07131b';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(27, -2);
        ctx.lineTo(29, -11);
        ctx.lineTo(34, -8);
        ctx.lineTo(36, -3);
        ctx.lineTo(31, 0);
        ctx.lineTo(30, 8);
        ctx.lineTo(27, 10);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
    }
  }
  ctx.restore();
}

function drawParticles() {
  for (const particle of state.particles) {
    const alpha = clamp(particle.life / particle.maxLife, 0, 1);
    ctx.save();
    ctx.globalAlpha = alpha;
    if (particle.glow) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.shadowColor = particle.color;
      ctx.shadowBlur = 8;
    }
    ctx.fillStyle = particle.color;
    if (particle.kind === 'spark') {
      const speed = Math.max(1, Math.hypot(particle.vx, particle.vy));
      const trail = Math.min(11, 3 + speed * 0.035);
      const nx = particle.vx / speed;
      const ny = particle.vy / speed;
      ctx.strokeStyle = particle.color;
      ctx.lineWidth = Math.max(1, particle.size * 0.75);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(particle.x, particle.y);
      ctx.lineTo(particle.x - nx * trail, particle.y - ny * trail);
      ctx.stroke();
    } else if (particle.kind === 'blast-ember') {
      ctx.translate(particle.x, particle.y);
      ctx.rotate(Math.atan2(particle.vy, particle.vx));
      ctx.beginPath();
      ctx.ellipse(0, 0, particle.size * 0.72, Math.max(1, particle.size * 0.36), 0, 0, Math.PI * 2);
      ctx.fill();
    } else if (particle.kind === 'blast-chip') {
      ctx.translate(particle.x, particle.y);
      ctx.rotate(Math.atan2(particle.vy, particle.vx));
      ctx.beginPath();
      ctx.moveTo(particle.size, 0);
      ctx.lineTo(-particle.size * 0.55, particle.size * 0.45);
      ctx.lineTo(-particle.size * 0.25, -particle.size * 0.55);
      ctx.closePath();
      ctx.fill();
    } else if (particle.kind === 'debris') {
      ctx.translate(particle.x, particle.y);
      ctx.rotate(Math.atan2(particle.vy, particle.vx) + alpha * 0.8);
      const size = particle.size;
      ctx.beginPath();
      ctx.moveTo(-size * 0.6, -size * 0.4);
      ctx.lineTo(size * 0.48, -size * 0.55);
      ctx.lineTo(size * 0.62, size * 0.25);
      ctx.lineTo(-size * 0.35, size * 0.58);
      ctx.closePath();
      ctx.fill();
    } else {
      ctx.fillRect(particle.x - particle.size / 2, particle.y - particle.size / 2, particle.size, particle.size);
    }
    ctx.restore();
  }
}

function drawFloaters() {
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '800 14px ui-monospace, monospace';
  for (const floater of state.floaters) {
    const alpha = clamp(floater.life / floater.maxLife, 0, 1);
    ctx.globalAlpha = alpha;
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#07131b';
    ctx.strokeText(floater.text, floater.x, floater.y);
    ctx.fillStyle = floater.color;
    ctx.fillText(floater.text, floater.x, floater.y);
  }
  ctx.restore();
}

function drawVignette() {
  const { width, height } = state.viewport;
  const vignette = ctx.createRadialGradient(width / 2, height / 2, Math.min(width, height) * 0.25, width / 2, height / 2, Math.max(width, height) * 0.72);
  vignette.addColorStop(0, 'rgba(0,0,0,0)');
  vignette.addColorStop(0.72, 'rgba(1,7,12,.08)');
  vignette.addColorStop(1, 'rgba(1,6,11,.58)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = 'rgba(104,224,193,.045)';
  for (let y = 0; y < height; y += 4) ctx.fillRect(0, y, width, 1);
}

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(320, Math.round(rect.width || innerWidth));
  const height = Math.max(320, Math.round(rect.height || innerHeight));
  const dpr = clamp(window.devicePixelRatio || 1, 1, 2);
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  state.viewport = { width, height, dpr };
  ctx.imageSmoothingEnabled = false;
}

function frame(now) {
  const delta = clamp((now - state.lastFrame) / 1000, 0, 0.05);
  state.lastFrame = now;
  if (state.mode === 'run') updateRun(delta, now);
  updateEffects(delta);
  updateCamera(delta);
  ctx.setTransform(state.viewport.dpr, 0, 0, state.viewport.dpr, 0, 0);
  drawBackground(now);
  drawWorld(now);
  requestAnimationFrame(frame);
}

function togglePause(force) {
  if (state.mode !== 'run') return;
  state.paused = typeof force === 'boolean' ? force : !state.paused;
  $('#pauseOverlay')?.classList.toggle('hidden', !state.paused);
  if (state.paused) {
    state.pauseStartedAt = performance.now();
    sound.tone(120, 0.08, 'square', 0.025, -30);
  }
  else {
    if (state.pauseStartedAt > 0) state.runStartedAt += performance.now() - state.pauseStartedAt;
    state.pauseStartedAt = 0;
    sound.tone(170, 0.08, 'square', 0.025, 50);
    state.lastFrame = performance.now();
  }
}

function triggerSensePulse() {
  if (state.mode !== 'run' || state.paused || state.manualPulseCooldown > 0) return;
  state.manualPulseCooldown = 0.18;
  state.ping = 1;
  state.targetCooldown = 0;
  sound.tone(290, 0.09, 'sine', 0.018, 100);
}

function bindEvents() {
  ui.startRun?.addEventListener('click', requestRunStart);
  ui.retryRun?.addEventListener('click', requestRunStart);
  ui.openUpgrades?.addEventListener('click', openUpgradeScreen);
  ui.closeUpgrades?.addEventListener('click', closeUpgradeScreen);
  ui.launchRocket?.addEventListener('click', showEnding);
  ui.endingReplay?.addEventListener('click', replayEnding);
  ui.endingContinue?.addEventListener('click', showTitle);
  ui.tutorialClose?.addEventListener('click', () => dismissTutorial(true));
  ui.tutorialNext?.addEventListener('click', () => dismissTutorial(false));
  ui.replayTutorial?.addEventListener('click', () => startOnboarding(true));
  for (const button of new Set([...$$('[data-open-journal]'), ui.openJournal].filter(Boolean))) {
    button.addEventListener('click', openJournalScreen);
  }
  for (const button of new Set([...$$('[data-open-balance]'), ui.openBalance].filter(Boolean))) {
    button.addEventListener('click', openBalanceScreen);
  }
  ui.closeJournal?.addEventListener('click', closeAuxiliaryScreen);
  ui.closeBalance?.addEventListener('click', closeAuxiliaryScreen);
  const balanceForm = $('#balanceLabForm');
  if (balanceForm) {
    balanceForm.addEventListener('submit', (event) => {
      event.preventDefault();
      runBalanceBench();
    });
  } else {
    ui.runBalance?.addEventListener('click', runBalanceBench);
  }
  ui.exportBalance?.addEventListener('click', exportBalanceReport);
  canvas.addEventListener('pointerdown', triggerSensePulse);

  ui.upgradeGrid?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-buy-upgrade]');
    if (button && !usesMobileUpgradeControls()) {
      state.selectedUpgradeId = button.dataset.buyUpgrade;
      buyUpgrade(button.dataset.buyUpgrade, { maxAffordable: event.shiftKey });
      return;
    }
    const node = event.target.closest('[data-upgrade-id]');
    if (node && state.visibleUpgradeIds.has(node.dataset.upgradeId)) {
      state.selectedUpgradeId = node.dataset.upgradeId;
      renderUpgrades();
    }
  });
  const previewUpgradeGoal = (event) => {
    const node = event.target.closest?.('[data-upgrade-id]');
    const id = node?.dataset.upgradeId;
    if (!id || !state.visibleUpgradeIds.has(id) || state.selectedUpgradeId === id) return;
    state.selectedUpgradeId = id;
    ui.upgradeNodes?.querySelectorAll('[data-upgrade-id]').forEach((item) => {
      item.classList.toggle('is-selected', item.dataset.upgradeId === id);
    });
    renderNextBreakthrough();
  };
  ui.upgradeGrid?.addEventListener('pointerover', previewUpgradeGoal);
  ui.upgradeGrid?.addEventListener('focusin', previewUpgradeGoal);
  ui.pinSelectedUpgrade?.addEventListener('click', () => {
    const selected = state.selectedUpgradeId ? upgradeById.get(state.selectedUpgradeId) : null;
    const pinned = save.pinnedUpgradeId ? upgradeById.get(save.pinnedUpgradeId) : null;
    if (pinned && (!selected || selected.id === pinned.id)) {
      save.pinnedUpgradeId = null;
      toast('ЦЕЛЬ СНЯТА', 'info');
    } else if (selected) {
      save.pinnedUpgradeId = selected.id;
      toast(`ЦЕЛЬ: ${selected.name.toUpperCase()}`, 'success');
    }
    persistSave();
    renderUpgrades();
  });
  ui.buyMaxSelectedUpgrade?.addEventListener('click', () => {
    const id = ui.buyMaxSelectedUpgrade.dataset.upgradeId;
    if (!id || !upgradeById.has(id)) return;
    state.selectedUpgradeId = id;
    buyUpgrade(id, { maxAffordable: !usesMobileUpgradeControls() });
  });
  ui.oreFocusChoices?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-focus-ore]');
    if (!button || !stats.oreFocusUnlocked) return;
    const oreId = button.dataset.focusOre || null;
    if (oreId && !oreById.has(oreId)) return;
    save.focusedOreId = oreId;
    persistSave();
    renderOreFocusPanel();
    updateFocusHud();
    toast(oreId ? `ФОКУС: ${oreById.get(oreId).name.toUpperCase()}` : 'ОБЫЧНЫЙ ПОИСК', 'success');
  });
  $$('[data-journal-filter]').forEach((button) => {
    button.addEventListener('click', () => {
      const filter = button.dataset.journalFilter;
      if (!['all', 'known', 'unknown'].includes(filter)) return;
      state.journalFilter = filter;
      renderGeologicalJournal();
    });
  });
  $$('.filter-btn[data-category]').forEach((button) => {
    button.addEventListener('click', () => {
      state.upgradeFilter = button.dataset.category || 'all';
      $$('.filter-btn[data-category]').forEach((item) => {
        const selected = item === button;
        item.classList.toggle('active', selected);
        item.classList.toggle('is-active', selected);
        item.setAttribute('aria-pressed', String(selected));
      });
      if (state.upgradeFilter !== 'all') {
        const laneNodes = getVisibleUpgradeDefinitions().filter((definition) => definition.category === state.upgradeFilter);
        state.selectedUpgradeId = laneNodes.find(upgradeIsPurchaseEligible)?.id
          || laneNodes.find(upgradeIsAvailable)?.id
          || laneNodes[0]?.id
          || state.selectedUpgradeId;
      }
      renderUpgrades();
      if (state.upgradeFilter !== 'all') {
        requestAnimationFrame(() => scrollUpgradeIntoView(upgradeById.get(state.selectedUpgradeId)));
      }
    });
  });
  ui.upgradeSearch?.addEventListener('input', () => {
    state.upgradeQuery = ui.upgradeSearch.value;
    const query = state.upgradeQuery.trim().toLocaleLowerCase('ru');
    if (query) {
      const match = getVisibleUpgradeDefinitions().find((definition) => (
        (state.upgradeFilter === 'all' || definition.category === state.upgradeFilter)
        && `${definition.name} ${definition.description}`.toLocaleLowerCase('ru').includes(query)
      ));
      if (match) state.selectedUpgradeId = match.id;
    }
    renderUpgrades();
    if (query && state.selectedUpgradeId) requestAnimationFrame(() => scrollUpgradeIntoView(upgradeById.get(state.selectedUpgradeId)));
  });

  ui.wipeSave?.addEventListener('click', () => {
    if (!window.confirm('Сбросить всю руду, забеги и уровни улучшений? Это действие нельзя отменить.')) return;
    save = createDefaultSave();
    stats = normalizeStats(calculateMetaStats(save.levels));
    clearTutorialCoach();
    Object.assign(state, {
      returnMode: 'title',
      lastHaul: createOreBag(),
      lastHaulCount: 0,
      runOre: 0,
      oreCounts: createOreBag(),
      discoveredOreIds: new Set(),
      metrics: createRunMetrics(),
      balanceReport: null,
      upgradeFilter: 'all',
      upgradeQuery: '',
      selectedUpgradeId: null,
      visibleUpgradeIds: new Set(),
      availableUpgradeIds: new Set(),
      workshopEligibilityRun: -1,
      workshopEligibleIds: new Set(),
      workshopInstallRun: -1,
      workshopInstalledIds: new Set(),
      journalFilter: 'all',
      currentSector: null,
      dryRockBlocks: 0,
      deafKnockCooldown: 0,
      deafKnockBoostRemaining: 0,
      laserShotCount: 0,
      triangleOreMemory: new Map(),
      activeMicroEvent: null,
      eventYieldBoostRemaining: 0,
      eventMoveBoostRemaining: 0,
      eventDigBoostRemaining: 0,
      eventSoftRockRemaining: 0,
      eventBannerTimer: 0,
      pityEventArmed: false,
      stagedEventId: null,
    });
    if (ui.upgradeSearch) ui.upgradeSearch.value = '';
    $$('.filter-btn[data-category]').forEach((button) => {
      const selected = button.dataset.category === 'all';
      button.classList.toggle('active', selected);
      button.classList.toggle('is-active', selected);
      button.setAttribute('aria-pressed', String(selected));
    });
    if (ui.balanceResults) ui.balanceResults.innerHTML = '<p id="balanceResultsTitle">Задайте профиль и запустите локальную серию.</p>';
    if (ui.exportBalance) ui.exportBalance.disabled = true;
    persistSave();
    renderUpgrades();
    updatePersistentLabels();
    showTitle();
    startOnboarding(false);
    toast('ПРОТОКОЛ ОЧИЩЕН', 'warning');
  });

  ui.guideToggle?.addEventListener('click', () => {
    const collapsed = ui.fieldGuide?.classList.contains('is-collapsed');
    setFieldGuideCollapsed(!collapsed);
  });

  addEventListener('keydown', (event) => {
    if (trapOverlayFocus(event)) return;
    const tag = document.activeElement?.tagName;
    const interactive = ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'A', 'SUMMARY'].includes(tag)
      || Boolean(document.activeElement?.isContentEditable);
    // Space has no game shortcut anymore, but keeps its native activation on
    // focused buttons and disclosure controls for keyboard accessibility.
    if (event.code === 'Space') {
      if (!interactive) event.preventDefault();
      return;
    }
    if (event.key === 'Escape') {
      if (state.activeTutorialId) {
        dismissTutorial();
        return;
      }
      if (state.mode === 'upgrades') closeUpgradeScreen();
      else if (state.mode === 'journal' || state.mode === 'balance') closeAuxiliaryScreen();
      else if (state.mode === 'run') togglePause();
      else if (state.mode === 'ending') showTitle();
      return;
    }
    if (interactive) return;
    if (event.key === 'Enter') {
      if (state.mode === 'title' || state.mode === 'result') requestRunStart();
    } else if (event.key.toLocaleLowerCase('ru') === 'u' || event.key.toLocaleLowerCase('ru') === 'г') {
      if (state.mode === 'upgrades') closeUpgradeScreen();
      else if (state.mode === 'title' || state.mode === 'result') openUpgradeScreen();
    } else if (event.key === '/' && state.mode === 'upgrades') {
      event.preventDefault();
      ui.upgradeSearch?.focus();
    } else if (event.key === '?') {
      ui.guideToggle?.click();
    }
  });

  addEventListener('resize', resizeCanvas, { passive: true });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && state.mode === 'run' && !state.paused) togglePause(true);
  });
}

function initialize() {
  resizeCanvas();
  newWorld(20260716);
  bindEvents();
  showTitle();
  $('#pauseOverlay')?.classList.add('hidden');
  $('#fieldGuide')?.classList.add('hidden');
  updatePersistentLabels();
  requestAnimationFrame(() => startOnboarding(false));
  requestAnimationFrame((now) => {
    state.lastFrame = now;
    requestAnimationFrame(frame);
  });
}

window.__DEPTH_ZERO__ = {
  getSnapshot: () => ({
    mode: state.mode,
    paused: state.paused,
    timeLeft: state.timeLeft,
    directTimeCap: DIRECT_MAX_RUN_SECONDS,
    bonusTimeCap: getBonusRunCap(),
    bonusTimeEarned: state.bonusTimeEarned,
    activeWallElapsed: state.activeWallElapsed,
    chronoOverflowRemaining: state.chronoOverflowRemaining,
    runOre: state.runOre,
    lastHaul: { ...(state.lastHaul || createOreBag()) },
    attackCooldown: state.attackCooldown,
    manualPulseCooldown: state.manualPulseCooldown,
    discoveredOreTypes: [...(state.discoveredOreIds || [])],
    inventory: { ...save.inventory },
    lifetimeOres: { ...save.lifetimeOres },
    target: state.target ? {
      kind: state.target.kind || 'ore',
      tx: state.target.tx,
      ty: state.target.ty,
      oreId: state.world?.getTile(state.target.tx, state.target.ty)?.oreId || null,
      distance: state.target.distance,
    } : null,
    backupTarget: state.backupTarget ? { tx: state.backupTarget.tx, ty: state.backupTarget.ty } : null,
    pathWaypoint: state.pathWaypoint ? { tx: state.pathWaypoint.tx, ty: state.pathWaypoint.ty, usedDetour: state.pathWaypoint.usedDetour } : null,
    crewBeacon: state.crewBeacon ? { ...state.crewBeacon } : null,
    metrics: {
      ...state.metrics,
      sourceBreaks: { ...(state.metrics.sourceBreaks || {}) },
      microEvents: { ...(state.metrics.microEvents || {}) },
    },
    player: state.player ? { x: state.player.x, y: state.player.y } : null,
    liftDepth: state.liftDepth,
    deepest: state.deepest,
    upgrades: UPGRADE_DEFS.length,
    purchasedLevels: countPurchasedLevels(save.levels),
    campaign: getCampaignProgress(),
    focusedOreId: save.focusedOreId,
    focusedSenseMultiplier: focusedSenseMultiplier(getFocusedOre()),
    sector: state.currentSector ? { ...state.currentSector } : null,
    microEventsRemaining: typeof state.world?.getMicroEvents === 'function' ? state.world.getMicroEvents().length : 0,
    activeMicroEvent: state.activeMicroEvent ? { ...state.activeMicroEvent } : null,
    eventPity: {
      armed: state.pityEventArmed,
      stagedEventId: state.stagedEventId,
      stagedEvent: state.stagedEventId && typeof state.world?.getMicroEvents === 'function'
        ? state.world.getMicroEvents({ includeConsumed: true }).find((event) => event.id === state.stagedEventId) || null
        : null,
      dryRuns: save.runsSinceEvent || 0,
      threshold: getEventPityThreshold(),
      totalEvents: save.totalEvents || 0,
    },
    laserShotCount: state.laserShotCount,
    deafKnockCooldown: state.deafKnockCooldown,
    deafKnockBoostRemaining: state.deafKnockBoostRemaining,
    eventYieldBoostRemaining: state.eventYieldBoostRemaining,
    eventMoveBoostRemaining: state.eventMoveBoostRemaining,
    eventDigBoostRemaining: state.eventDigBoostRemaining,
    eventSoftRockRemaining: state.eventSoftRockRemaining,
    relicSoftRockRemaining: state.relicSoftRockRemaining,
    relicChestBoostCharges: state.relicChestBoostCharges,
    perkStatus: perkStatusEntries().map((entry) => ({ ...entry })),
    overkillReservoir: state.overkillReservoir,
    overkillReservoirVeinId: state.overkillReservoirVeinId,
    dryRockBlocks: state.dryRockBlocks,
    motherlodeBreaks: state.motherlodeBreaks,
    motherlodeVeinId: state.motherlodeVeinId,
    rememberedVeins: (state.rememberedVeins || []).map((target) => ({
      tx: target.tx,
      ty: target.ty,
      oreId: target.tile?.oreId || null,
      veinId: target.tile?.veinId || null,
    })),
    triangleActive: Boolean(getTriangulationTriangle()),
    triangleRememberedOre: [...(state.triangleOreMemory || new Map())]
      .filter(([, expires]) => expires >= state.elapsed)
      .map(([key]) => key),
    tutorialSeen: { ...(save.tutorialSeen || {}) },
    oreRecords: { ...(save.oreRecords || {}) },
    lastRunReport: save.lastRunReport ? { ...save.lastRunReport } : null,
    balanceReport: state.balanceReport ? { ...state.balanceReport } : null,
    terrainBaseCache: getTerrainBaseCacheStats(),
  }),
  getStats: () => ({ ...stats }),
  getTerrainBaseCacheStats,
  getUpgradeCatalog: () => UPGRADE_DEFS.map((definition) => {
    const level = getUpgradeLevel(definition);
    const recipe = level < definition.maxLevel ? getUpgradeRecipe(definition, level) : {};
    const unlocked = requirementsMet(definition) && level < definition.maxLevel;
    const available = upgradeIsPurchaseEligible(definition);
    const pendingReason = unlocked && !available ? upgradePurchaseBlockReason(definition) : null;
    const installStatus = workshopInstallStatus();
    return {
      id: definition.id,
      category: definition.category,
      maxLevel: definition.maxLevel,
      level,
      requires: (definition.requires || []).map((requirement) => ({
        id: typeof requirement === 'string' ? requirement : requirement.id,
        level: typeof requirement === 'string' ? 1 : (requirement.level || 1),
      })),
      unlocked,
      available,
      breakthrough: BREAKTHROUGH_FIRST_RANK_IDS.has(definition.id),
      capstone: CAMPAIGN.capstones.includes(definition.id),
      pendingReason,
      firstRankSlotsRemaining: installStatus.remaining,
      affordable: available && canAffordRecipe(save.inventory, recipe),
      recipe: { ...recipe },
    };
  }),
  buyUpgrade: (upgradeId) => {
    const before = Number(save.levels[upgradeId]) || 0;
    buyUpgrade(upgradeId);
    return (Number(save.levels[upgradeId]) || 0) > before;
  },
  startRun,
  triggerSensePulse,
  requestRunStart,
  finishRun,
  openUpgrades: openUpgradeScreen,
  openJournal: openJournalScreen,
  openBalance: openBalanceScreen,
  runBalanceBench,
  debugEstimateBalanceRun: (seed = 'runtime-estimator', overrides = {}) => estimateBalanceRun(
    String(seed),
    0,
    normalizeStats({ ...calculateMetaStats({}), ...(overrides || {}) }),
  ),
  watchEnding: showEnding,
  grantOre: (oreId = 'copper', amount = 1000) => {
    if (!oreById.has(oreId)) return false;
    save.inventory[oreId] = (save.inventory[oreId] || 0) + Math.max(0, Math.floor(Number(amount) || 0));
    persistSave();
    updatePersistentLabels();
    if (state.mode === 'upgrades') renderUpgrades();
    return true;
  },
  setUpgradeLevel: (upgradeId, level = 1) => {
    const definition = upgradeById.get(upgradeId);
    if (!definition) return false;
    save.levels[upgradeId] = clamp(Math.floor(Number(level) || 0), 0, definition.maxLevel);
    invalidateWorkshopEligibility();
    invalidateWorkshopInstallSession();
    stats = normalizeStats(calculateMetaStats(save.levels));
    persistSave();
    updatePersistentLabels();
    if (state.mode === 'upgrades') renderUpgrades();
    return true;
  },
  setAllUpgrades: (enabled = true) => {
    for (const definition of UPGRADE_DEFS) save.levels[definition.id] = enabled ? definition.maxLevel : 0;
    invalidateWorkshopEligibility();
    invalidateWorkshopInstallSession();
    stats = normalizeStats(calculateMetaStats(save.levels));
    persistSave();
    updatePersistentLabels();
    if (state.mode === 'upgrades') renderUpgrades();
    return true;
  },
  setFocusedOre: (oreId = null) => {
    if (oreId && !oreById.has(oreId)) return false;
    save.focusedOreId = oreId || null;
    persistSave();
    updatePersistentLabels();
    return true;
  },
  setBestDepth: (value = 0) => {
    save.bestDepth = Math.max(0, Number(value) || 0);
    persistSave();
    updatePersistentLabels();
    return true;
  },
  setCompletedRuns: (value = 0) => {
    save.runs = Math.max(0, Math.floor(Number(value) || 0));
    invalidateWorkshopEligibility();
    invalidateWorkshopInstallSession();
    persistSave();
    updatePersistentLabels();
    return true;
  },
  grantBonusTime: (seconds = 1) => addBonusTime(seconds, state.player?.x, (state.player?.y || 0) - 36, 'ТЕСТ'),
  stepRun: (seconds = 0.1) => {
    let remaining = clamp(Number(seconds) || 0, 0, BONUS_MAX_RUN_SECONDS + 1);
    while (remaining > 0 && state.mode === 'run') {
      const step = Math.min(0.05, remaining);
      const syntheticNow = state.runStartedAt + (state.activeWallElapsed + step) * 1000;
      updateRun(step, syntheticNow);
      updateEffects(step);
      remaining -= step;
    }
    return state.mode;
  },
  breakNearestOre: (oreId = null) => {
    if (state.mode !== 'run' || (oreId && !oreById.has(oreId))) return null;
    const radius = Math.hypot(WORLD_CONFIG.WIDTH, WORLD_CONFIG.HEIGHT) * TILE_SIZE;
    const target = findBestOreTarget(state.player.x, state.player.y, radius, oreId || null, { ignoreSenseLine: true });
    if (!target) return null;
    const result = state.world.breakTile(target.tx, target.ty, (tile, tx, ty) => resolveBrokenTile(tile, tx, ty, 'debug'));
    return result ? { tx: target.tx, ty: target.ty, oreId } : null;
  },
  forceDetonate: (directionX = null, directionY = null) => {
    if (state.mode !== 'run' || !state.player) return false;
    const angle = state.player.angle || 0;
    const dx = Number(directionX);
    const dy = Number(directionY);
    const hasDirection = Number.isFinite(dx) && Number.isFinite(dy) && Math.hypot(dx, dy) > 0.001;
    detonate(
      state.player.x,
      state.player.y,
      hasDirection ? dx : Math.cos(angle),
      hasDirection ? dy : Math.sin(angle),
    );
    return true;
  },
  forceFocusMiss: (seconds = 2) => {
    state.target = null;
    state.backupTarget = null;
    state.focusMissElapsed = Math.max(0, Number(seconds) || 0);
    state.focusEscalationActive = false;
    return focusedSenseMultiplier(getFocusedOre());
  },
  acquireTargets: () => {
    if (state.mode !== 'run' || !state.player) return null;
    const focused = getFocusedOre();
    const radius = effectiveSenseRadius() * focusedSenseMultiplier(focused);
    const targets = chooseOreTargets(state.player.x, state.player.y, radius, focused?.id || null);
    if (!targets.primary) return null;
    targets.primary.lockRadius = radius;
    if (targets.backup) targets.backup.lockRadius = radius;
    state.target = targets.primary;
    state.backupTarget = targets.backup;
    refreshCrewBeacon(state.target);
    return {
      primary: { tx: targets.primary.tx, ty: targets.primary.ty },
      backup: targets.backup ? { tx: targets.backup.tx, ty: targets.backup.ty } : null,
    };
  },
  breakCurrentTarget: () => {
    if (state.mode !== 'run' || !state.target) return false;
    return Boolean(state.world.breakTile(
      state.target.tx,
      state.target.ty,
      (tile, tx, ty) => resolveBrokenTile(tile, tx, ty, 'debug'),
    ));
  },
  debugBreakTileWithSource: (tx, ty, source = 'pick') => {
    if (state.mode !== 'run' || !state.world) return false;
    const allowedSources = new Set(['pick', 'laser', 'multi', 'bomb', 'chain', 'drone', 'echo', 'event', 'shatter', 'shock', 'beacon', 'debug']);
    const safeSource = allowedSources.has(source) ? source : 'debug';
    return Boolean(state.world.breakTile(
      Math.floor(Number(tx)),
      Math.floor(Number(ty)),
      (tile, tileX, tileY) => resolveBrokenTile(tile, tileX, tileY, safeSource),
    ));
  },
  promoteBackup: () => promoteBackupTarget(getFocusedOre()?.id || null),
  attackNow: () => {
    if (state.mode !== 'run' || !state.target) return false;
    attack(state.target);
    return true;
  },
  debugPatchTile: (tx, ty, patch = {}) => {
    if (!state.world) return null;
    const tile = state.world.getTile(Math.floor(tx), Math.floor(ty));
    if (!tile) return null;
    const previousVeinId = tile.oreId && tile.veinId && tile.kind !== 'air' ? tile.veinId : null;
    for (const key of ['kind', 'oreId', 'veinId', 'hp', 'maxHp', 'discovered', 'cracked']) {
      if (Object.prototype.hasOwnProperty.call(patch, key)) tile[key] = patch[key];
    }
    const nextVeinId = tile.oreId && tile.veinId && tile.kind !== 'air' ? tile.veinId : null;
    if (previousVeinId) {
      state.veinRemainingCounts.set(previousVeinId, Math.max(0, (state.veinRemainingCounts.get(previousVeinId) || 0) - 1));
    }
    if (nextVeinId) {
      state.veinRemainingCounts.set(nextVeinId, (state.veinRemainingCounts.get(nextVeinId) || 0) + 1);
    }
    if (typeof state.world._rebuildOreIndex === 'function') state.world._rebuildOreIndex();
    return { ...tile };
  },
  debugGetTile: (tx, ty) => {
    const tile = state.world?.getTile(Math.floor(tx), Math.floor(ty));
    return tile ? { ...tile } : null;
  },
  debugRenderTerrainBaseTile: (tx, ty) => {
    const tileX = Math.floor(Number(tx));
    const tileY = Math.floor(Number(ty));
    const tile = state.world?.getTile(tileX, tileY);
    if (!tile || tile.kind === 'air') return false;
    const palette = TERRAIN_PALETTES[tile.kind] || TERRAIN_PALETTES.stone;
    const depthTone = terrainDepthFactor(tileX, tileY);
    const macroNoise = terrainMassNoise(tileX + tileY * 0.58, tileY - tileX * 0.16, 2);
    const baseIndex = clamp(
      Math.round((palette.base.length - 1) * (0.36 + macroNoise * 0.32) - depthTone * 1.5),
      0,
      palette.base.length - 1,
    );
    drawTerrainBaseLayer(
      tileX * TILE_SIZE,
      tileY * TILE_SIZE,
      tileX,
      tileY,
      tile.kind,
      palette,
      baseIndex,
      getOpenTerrainMask(tileX, tileY),
    );
    return true;
  },
  debugSetEventPity: (dryRuns = 0, totalEvents = 0) => {
    save.runs = Math.max(save.runs, 4);
    save.runsSinceEvent = Math.max(0, Math.floor(Number(dryRuns) || 0));
    save.totalEvents = Math.max(0, Math.floor(Number(totalEvents) || 0));
    persistSave();
    return { dryRuns: save.runsSinceEvent, totalEvents: save.totalEvents, threshold: getEventPityThreshold() };
  },
  debugSetPlayerTile: (tx, ty) => {
    if (state.mode !== 'run' || !state.player) return false;
    const tileX = clamp(Math.floor(tx), 0, WORLD_CONFIG.WIDTH - 1);
    const tileY = clamp(Math.floor(ty), 0, WORLD_CONFIG.HEIGHT - 1);
    state.player.x = (tileX + 0.5) * TILE_SIZE;
    state.player.y = (tileY + 0.5) * TILE_SIZE;
    return true;
  },
  debugSetTargetTile: (tx, ty) => {
    if (state.mode !== 'run' || !state.player || !state.world) return false;
    const tileX = Math.floor(tx);
    const tileY = Math.floor(ty);
    const tile = state.world.getTile(tileX, tileY);
    if (!tile?.oreId || tile.kind === 'air' || tile.kind === 'bedrock') return false;
    const x = (tileX + 0.5) * TILE_SIZE;
    const y = (tileY + 0.5) * TILE_SIZE;
    state.target = { kind: 'ore', tile, tx: tileX, ty: tileY, x, y, distance: distance(state.player.x, state.player.y, x, y) };
    state.backupTarget = null;
    refreshCrewBeacon(state.target);
    return true;
  },
  debugSetClearanceTargetTile: (tx, ty) => {
    if (state.mode !== 'run' || !state.player || !state.world) return false;
    const tileX = Math.floor(tx);
    const tileY = Math.floor(ty);
    const tile = state.world.getTile(tileX, tileY);
    if (!tile || tile.kind === 'air' || tile.kind === 'bedrock') return false;
    const x = (tileX + 0.5) * TILE_SIZE;
    const y = (tileY + 0.5) * TILE_SIZE;
    state.target = { kind: 'clearance', tile, tx: tileX, ty: tileY, x, y, distance: distance(state.player.x, state.player.y, x, y) };
    state.backupTarget = null;
    return true;
  },
  debugSetApproachTravel: (seconds) => {
    state.approachTravelElapsed = Math.max(0, Number(seconds) || 0);
    return state.approachTravelElapsed;
  },
  debugFireRicochetFrom: (tx, ty, damage = 100) => {
    const tileX = Math.floor(tx);
    const tileY = Math.floor(ty);
    const tile = state.world?.getTile(tileX, tileY);
    if (state.mode !== 'run' || !tile?.oreId) return false;
    fireLaserRicochets({
      kind: 'ore', tile, tx: tileX, ty: tileY,
      x: (tileX + 0.5) * TILE_SIZE,
      y: (tileY + 0.5) * TILE_SIZE,
    }, Math.max(0, Number(damage) || 0), () => {});
    return true;
  },
  debugFindOreTargetFromTile: (tx, ty, radius, oreId = null, excludedKeys = []) => {
    if (!state.world) return null;
    const target = findBestOreTarget(
      (Number(tx) + 0.5) * TILE_SIZE,
      (Number(ty) + 0.5) * TILE_SIZE,
      Math.max(0, Number(radius) || 0),
      oreId || null,
      { excludedKeys: new Set(excludedKeys), ignoreSenseLine: true },
    );
    return target ? { tx: target.tx, ty: target.ty, distance: target.distance, score: target.score } : null;
  },
  debugCompareIndexedTargetSearch: () => {
    if (!state.world || !state.player) return null;
    const focusedOre = getFocusedOre();
    const radius = effectiveSenseRadius() * focusedSenseMultiplier(focusedOre);
    const serialize = (targets) => targets.map((target) => `${target.tx}:${target.ty}`);
    const indexed = serialize(findBestOreTargets(
      state.player.x,
      state.player.y,
      radius,
      focusedOre?.id || null,
      {},
      2,
    ));
    const hadOwnEnumerator = Object.prototype.hasOwnProperty.call(state.world, 'forEachOreTileInBounds');
    const ownEnumerator = state.world.forEachOreTileInBounds;
    let brute;
    try {
      state.world.forEachOreTileInBounds = null;
      brute = serialize(findBestOreTargets(
        state.player.x,
        state.player.y,
        radius,
        focusedOre?.id || null,
        {},
        2,
      ));
    } finally {
      if (hadOwnEnumerator) state.world.forEachOreTileInBounds = ownEnumerator;
      else delete state.world.forEachOreTileInBounds;
    }
    return { indexed, brute, same: indexed.join('|') === brute.join('|') };
  },
  debugGetUpgradeLayout: () => {
    const layout = getUpgradeLayout();
    return {
      width: layout.width,
      height: layout.height,
      centerX: layout.centerX,
      centerY: layout.centerY,
      positions: Object.fromEntries([...layout.positions].map(([id, point]) => [id, { ...point }])),
      sizes: Object.fromEntries(UPGRADE_DEFS.map((definition) => [definition.id, getUpgradeNodeSize(definition)])),
      minimumGap: UPGRADE_NODE_GAP,
    };
  },
  debugSetAttackCooldown: (seconds = 0.42) => {
    state.attackCooldown = Math.max(0, Number(seconds) || 0);
    return state.attackCooldown;
  },
  debugResetProgress: () => {
    save = createDefaultSave();
    stats = normalizeStats(calculateMetaStats(save.levels));
    Object.assign(state, {
      mode: 'title',
      returnMode: 'title',
      target: null,
      backupTarget: null,
      pathWaypoint: null,
      lastHaul: createOreBag(),
      lastHaulCount: 0,
      runOre: 0,
      oreCounts: createOreBag(),
      discoveredOreIds: new Set(),
      visibleUpgradeIds: new Set(),
      availableUpgradeIds: new Set(),
      selectedUpgradeId: null,
      workshopEligibilityRun: -1,
      workshopEligibleIds: new Set(),
      workshopInstallRun: -1,
      workshopInstalledIds: new Set(),
      metrics: createRunMetrics(),
    });
    persistSave();
    return true;
  },
  debugAutoBuyAffordable: (limit = 200) => {
    const bought = [];
    const purchaseLimit = clamp(Math.floor(Number(limit) || 0), 0, 1_000);
    for (let purchase = 0; purchase < purchaseLimit; purchase += 1) {
      const categoryLevels = Object.fromEntries(UPGRADE_LANES.map((category) => [category, 0]));
      for (const definition of UPGRADE_DEFS) {
        if (categoryLevels[definition.category] != null) categoryLevels[definition.category] += getUpgradeLevel(definition);
      }
      const candidates = UPGRADE_DEFS
        .filter((definition) => {
          const level = getUpgradeLevel(definition);
          if (level >= definition.maxLevel || !upgradeIsPurchaseEligible(definition)) return false;
          return canAffordRecipe(save.inventory, getUpgradeRecipe(definition, level));
        })
        .map((definition) => {
          const level = getUpgradeLevel(definition);
          const recipe = getUpgradeRecipe(definition, level);
          const weightedCost = Object.entries(recipe).reduce((sum, [oreId, amount]) => (
            sum + amount * (oreById.get(oreId)?.value || 1)
          ), 0);
          const depth = getUpgradeLayout().depthById.get(definition.id) || 0;
          const categoryLoad = categoryLevels[definition.category] || 0;
          const strategicTarget = CAMPAIGN_AUTOBUY_TARGETS[definition.id] || 0;
          const strategicWeight = level < strategicTarget
            ? (CAMPAIGN_AUTOBUY_WEIGHTS[definition.id] || 1)
            : 1;
          const corePriority = definition.id === 'core_first_descent' ? -1_000_000 : 0;
          const finalPriority = definition.id === CAMPAIGN.finalUpgrade ? -100_000 : 0;
          return {
            definition,
            level,
            recipe,
            breakthrough: BREAKTHROUGH_FIRST_RANK_IDS.has(definition.id),
            strategic: level < strategicTarget,
            final: definition.id === CAMPAIGN.finalUpgrade,
            score: weightedCost * strategicWeight + depth * 4 + categoryLoad * 0.6 + corePriority + finalPriority,
          };
        })
        .sort((left, right) => (
          left.score - right.score
          || UPGRADE_DEFS.indexOf(left.definition) - UPGRADE_DEFS.indexOf(right.definition)
        ));
      let candidate = candidates[0];
      const lastFirstRankSlot = workshopInstallStatus().remaining === 1;
      const originalIsReplaceableScalar = candidate
        && candidate.level === 0
        && !candidate.breakthrough
        && !candidate.strategic
        && !candidate.final;
      if (lastFirstRankSlot && originalIsReplaceableScalar) {
        const breakthroughCandidate = candidates.find((entry) => (
          entry.level === 0
          && entry.breakthrough
          && !CAMPAIGN.capstones.includes(entry.definition.id)
        ));
        if (breakthroughCandidate) candidate = breakthroughCandidate;
      }
      if (!candidate || !spendRecipe(save.inventory, candidate.recipe)) break;
      save.levels[candidate.definition.id] = candidate.level + 1;
      if (candidate.level === 0) registerWorkshopFirstRank(candidate.definition);
      bought.push(candidate.definition.id);
      stats = normalizeStats(calculateMetaStats(save.levels));
    }
    if (!stats.oreFocusUnlocked) {
      save.focusedOreId = null;
    } else {
      const deficits = createOreBag();
      for (const definition of UPGRADE_DEFS) {
        const level = getUpgradeLevel(definition);
        if (level >= definition.maxLevel || !requirementsMet(definition)) continue;
        const recipe = getUpgradeRecipe(definition, level);
        for (const [oreId, amount] of Object.entries(recipe)) {
          deficits[oreId] += Math.max(0, amount - (save.inventory[oreId] || 0));
        }
      }
      const focus = ORE_TYPES
        .filter((ore) => deficits[ore.id] > 0 && (save.lifetimeOres[ore.id] || 0) > 0)
        .sort((left, right) => deficits[right.id] * right.value - deficits[left.id] * left.value)[0];
      save.focusedOreId = focus?.id || null;
    }
    persistSave();
    return { bought, focusedOreId: save.focusedOreId, purchasedLevels: countPurchasedLevels(save.levels) };
  },
  debugForceChain: (nx = 1, ny = 0) => {
    if (state.mode !== 'run' || !state.player) return false;
    chainStrike(state.player.x, state.player.y, Number(nx) || 0, Number(ny) || 0);
    return true;
  },
  debugForceDrones: () => {
    if (state.mode !== 'run' || !state.player) return false;
    droneAttack();
    return true;
  },
  debugDronesAreActive: () => dronesAreActive(),
  debugHardnessPierceMultiplier: (oreId = null) => hardnessPierceMultiplier(oreId),
  debugTriggerDeafKnock: () => triggerDeafKnock(state.player?.x, state.player?.y),
  debugTriggerSuperPickEcho: (damage = stats.pickPower) => {
    if (state.mode !== 'run' || !state.target) return false;
    return triggerSuperPickEcho(state.target, Math.max(0, Number(damage) || 0));
  },
  debugSetBackupTile: (tx, ty) => {
    if (state.mode !== 'run' || !state.world) return false;
    const tileX = Math.floor(tx);
    const tileY = Math.floor(ty);
    const tile = state.world.getTile(tileX, tileY);
    if (!tile?.oreId || tile.kind === 'air' || tile.kind === 'bedrock') return false;
    state.backupTarget = {
      kind: 'ore', tile, tx: tileX, ty: tileY,
      x: (tileX + 0.5) * TILE_SIZE,
      y: (tileY + 0.5) * TILE_SIZE,
    };
    refreshTriangleOreMemory();
    return true;
  },
  debugGetTriangle: () => {
    const triangle = getTriangulationTriangle();
    return triangle ? triangle.map((point) => ({ ...point })) : null;
  },
  debugTriggerMicroEvent: (type = null) => {
    if (state.mode !== 'run' || typeof state.world?.getMicroEvents !== 'function') return false;
    const event = state.world.getMicroEvents().find((candidate) => !type || candidate.type === type);
    return event ? applyMicroEvent(event) : false;
  },
  debugGetMicroEvents: () => typeof state.world?.getMicroEvents === 'function' ? state.world.getMicroEvents() : [],
  debugValidateCrewBeacon: () => Boolean(getCrewBeacon(true)),
  computeCurrentRoute: () => {
    if (state.mode !== 'run' || !state.target || typeof state.world.findLeastResistanceStep !== 'function') return null;
    const focusedOre = getFocusedOre();
    return state.world.findLeastResistanceStep(state.player, state.target, {
      moveSpeed: stats.moveSpeed * (stats.mineMoveMultiplier || 1),
      digPowerPerSecond: stats.pickPower * stats.digSpeed,
      focusedOreId: focusedOre?.id || null,
      focusedOreDigMultiplier: focusedOre ? focusedDamageMultiplier(focusedOre.id) : 1,
      maxDetourTiles: 9,
      minimumSavings: 0.08,
      waypointLookAhead: 4,
    });
  },
};

initialize();
})();
