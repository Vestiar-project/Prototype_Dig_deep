(() => {
"use strict";

const upgradesApi = window.DepthZeroUpgrades;
const worldApi = window.DepthZeroWorld;

if (!upgradesApi || !worldApi) {
  throw new Error('РќРµ СѓРґР°Р»РѕСЃСЊ Р·Р°РіСЂСѓР·РёС‚СЊ РґР°РЅРЅС‹Рµ СѓР»СѓС‡С€РµРЅРёР№ РёР»Рё РіРµРЅРµСЂР°С‚РѕСЂ РјРёСЂР°.');
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
const MOBILE_UPGRADE_NARROW_WIDTH = 640;
const usesMobileUpgradeControls = () => {
  const pointerQuery = window.matchMedia?.(MOBILE_UPGRADE_INTERACTION_QUERY);
  return Boolean(
    pointerQuery?.matches
    || window.innerWidth <= MOBILE_UPGRADE_NARROW_WIDTH
    || (!pointerQuery && window.navigator?.maxTouchPoints > 0 && window.innerWidth <= 1024)
  );
};
const formatNumber = (value) => {
  const number = Math.max(0, Number(value) || 0);
  if (number < 1_000) return Math.floor(number).toLocaleString('ru-RU');
  if (number < 1_000_000) return `${(number / 1_000).toFixed(number < 10_000 ? 1 : 0)} С‚С‹СЃ.`;
  return `${(number / 1_000_000).toFixed(number < 10_000_000 ? 1 : 0)} РјР»РЅ`;
};
const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (character) => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  "'": '&#39;',
  '"': '&quot;',
})[character]);

const TILE_SIZE = WORLD_CONFIG.TILE_SIZE || 28;
const METERS_PER_TILE = Math.max(1, WORLD_CONFIG.METERS_PER_TILE || 1);
const TERRAIN_BASE_CACHE_LIMIT = 1800;
const MINER_COLLISION_RADIUS = 8;
const MIN_RUN_SECONDS = 6;
const DIRECT_MAX_RUN_SECONDS = 45;
const BONUS_MAX_RUN_SECONDS = 60;
const EXPLORATION_SCAN_TILES = 18;
const WORKSHOP_FIRST_RANK_CAP = 4;
const WORKSHOP_BREAKTHROUGH_CAP = 4;
const WORKSHOP_LEVEL_CAP = 35;
const STORAGE_KEY = 'depth-zero-save-v1';
const CAMPAIGN = Object.freeze({
  requiredLifetimeChunks: 4_000,
  requiredSolarDrillShifts: 2,
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
  'sense_deep_resonance',
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
const BREAKTHROUGH_LEVEL_MILESTONES = new Map([
  ['sense_deep_resonance', new Set([2, 3])],
  ['sense_seismic_memory', new Set([2, 3])],
  ['sense_triangular_fix', new Set([2])],
  ['dig_light_footwork', new Set([2, 4])],
  ['power_fault_finder', new Set([3])],
  ['power_corebreaker', new Set([2])],
  ['time_clockwork_heart', new Set([3, 4, 8])],
  ['time_capsule', new Set([5])],
]);
const DEFAULT_SAVE = Object.freeze({
  version: 14,
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
  runsSinceChest: 0,
  totalChests: 0,
  solarDrillShifts: 0,
  workshopEligibilityRun: -1,
  workshopEligibleIds: [],
  workshopInstallRun: -1,
  workshopInstalledIds: [],
  workshopBreakthroughRun: -1,
  workshopBreakthroughTokens: [],
  workshopLevelRun: -1,
  workshopLevelsInstalled: 0,
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
    workshopBreakthroughTokens: [],
    workshopLevelRun: -1,
    workshopLevelsInstalled: 0,
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
    const depthScale = storedVersion < 12 ? METERS_PER_TILE : 1;
    const migrateRunReportDepth = (report) => {
      if (!report || typeof report !== 'object') return null;
      return {
        ...report,
        depth: Math.max(0, Number(report.depth) || 0) * depthScale,
        deltaDepth: Number.isFinite(Number(report.deltaDepth))
          ? Number(report.deltaDepth) * depthScale
          : report.deltaDepth,
      };
    };
    const oreRecords = stored.oreRecords && typeof stored.oreRecords === 'object'
      ? Object.fromEntries(Object.entries(stored.oreRecords).map(([oreId, record]) => [
        oreId,
        record && typeof record === 'object'
          ? { ...record, deepest: Math.max(0, Number(record.deepest) || 0) * depthScale }
          : record,
      ]))
      : {};
    const merged = {
      ...DEFAULT_SAVE,
      ...stored,
      version: DEFAULT_SAVE.version,
      tutorialVersion: DEFAULT_SAVE.tutorialVersion,
      inventory,
      lifetimeOres,
      lifetimeChunks: migratedLifetimeChunks,
      levels,
      bestDepth: Math.max(0, Number(stored.bestDepth) || 0) * depthScale,
      focusedOreId: ORE_TYPES.some((ore) => ore.id === stored.focusedOreId) ? stored.focusedOreId : null,
      tutorialSeen: stored.tutorialSeen && typeof stored.tutorialSeen === 'object' ? { ...stored.tutorialSeen } : {},
      oreRecords,
      lastRunReport: migrateRunReportDepth(stored.lastRunReport),
      bestRunReport: migrateRunReportDepth(stored.bestRunReport),
      preferredSectorId: typeof stored.preferredSectorId === 'string' ? stored.preferredSectorId : null,
      balanceHistory: Array.isArray(stored.balanceHistory) ? stored.balanceHistory.slice(-12) : [],
      pinnedUpgradeId: typeof storedЧЋwгЫh‘йм¶»§q«^vH
Ы[\
X]™›ЫЬЉ
KУФ“РУУ‘’QЛ•ТQHJH
ИЌJH
€SWФТV‘NВ€ЫЫњЭHH
Ы[\
X]™›ЫЬЉJKУФ“РУУ‘’QЛ’RQТHJH
ИЌJH
€SWФТV‘NВ€™]\›€X]›Z[Љ€Э]Л™\ЫЫќXЭX^ЭXЪЬИ€X]™›ЫЬЉ\њ›ЫSЬљYЪ[ЉJHИЭ]Л™\ЫЫќXЭЭ\
K€
NВ€K€XќYФ™[™\•\њZ[ђ\ЩU[N€
JHO€В€ЫЫњЭ[VHX]™›ЫЬЉќ[X™\Љ
JNВ€ЫЫњЭ[VHHX]™›ЫЬЉќ[X™\ЉJJNВ€ЫЫњЭ[HHЭ]KќЫЬ›Л™Щ][J[V[VJNВ€Y€
][H[KљЪ[™OOH	ШZ\‰КH™]\›€[ЩNВ€ЫЫњЭ[]HHT”ђRS—ФSUTЦЭ[KљЪ[™HT”ђRS—ФSUTЛњЭЫ™NВ€ЫЫњЭ\Ы™HH\њZ[‘\XЭЬЉ[V[VJNВ€ЫЫњЭXXЬ›У›Ъ\ЩHH\њZ[“X\ЬУ›Ъ\ЩJ[V
И[VH
€ЌN[VHH[V
€ЊM‹ЉNВ€ЫЫњЭ\ЩR[™^HЫ[\
€X]њ›Э[™

[]K\ЩK›[™ЭHJH
€
ЊН€
ИXXЬ›У›Ъ\ЩH
€ЊМЉHH\Ы™H
€KЌJK€€[]K\ЩK›[™ЭHK€
NВ€]Х\њZ[ђ\ЩS^Y\Љ€[V
€SWФТV‘K€[VH
€SWФТV‘K€[V€[VK€[KљЪ[™€[]K€\ЩR[™^€Щ]Ь[•\њZ[“X\ЪК[V[VJK€
NВ€™]\›€ќYNВ€K€XќYФЩ]]™[ќ]N€
ћTќ[њИHЭ[]™[ќИH
HO€В€Ш]™Kњќ[њИHX]›X^
Ш]™Kњќ[њЛ
NВ€Ш]™Kњќ[њФЪ[ЩQ]™[ќHX]›X^
X]™›ЫЬЉќ[X™\ЉћTќ[њКH
JNВ€Ш]™Kњќ[њФЪ[ЩPЪ\ЭHШ]™Kњќ[њФЪ[ЩQ]™[ќВ€Ш]™KќЭ[]™[ќИHX]›X^
X]™›ЫЬЉќ[X™\ЉЭ[]™[ќКH
JNВ€Ш]™KќЭ[Ъ\ЭИHШ]™KќЭ[]™[ќОВ€\њЪ\ЭШ]™J
NВ€™]\›€ИћTќ[њО€Ш]™Kњќ[њФЪ[ЩPЪ\ЭЭ[]™[ќО€Ш]™KќЭ[]™[ќЛ™\ЪЫ€Щ]]™[ќ]U™\ЪЫ

HNВ€K€XќYФЩ]^Y\•[N€
JHO€В€Y€
Э]K›[ЩHOOH	Ьќ[‰И\Э]Kњ^Y\ЉH™]\›€[ЩNВ€ЫЫњЭ[VHЫ[\
X]™›ЫЬЉ
KУФ“РУУ‘’QЛ•ТQHJNВ€ЫЫњЭ[VHHЫ[\
X]™›ЫЬЉJKУФ“РУУ‘’QЛ’RQТHJNВ€Э]Kњ^Y\‹ћH
[V
ИЌJH
€SWФТV‘NВ€Э]Kњ^Y\‹ћHH
[VH
ИЌJH
€SWФТV‘NВ€™]\›€ќYNВ€K€XќYФЩ]^Y\”ЬЪ][ЫЋ€
JHO€В€Y€
Э]K›[ЩHOOH	Ьќ[‰И\Э]Kњ^Y\ЉH™]\›€[ЩNВ€Э]Kњ^Y\‹ћHЫ[\
ќ[X™\Љ
HSWФТV‘KSWФТV‘KУФ“РУУ‘’QЛ•ТQ
€SWФТV‘HHSWФТV‘JNВ€Э]Kњ^Y\‹ћHHЫ[\
ќ[X™\ЉJHSWФТV‘KSWФТV‘KУФ“РУУ‘’QЛ’RQТ
€SWФТV‘HHSWФТV‘JNВ€™]\›€ќYNВ€K€XќYФЩ]\™Щ][N€
JHO€В€Y€
Э]K›[ЩHOOH	Ьќ[‰И\Э]Kњ^Y\€\Э]KќЫЬ›
H™]\›€[ЩNВ€ЫЫњЭ[VHX]™›ЫЬЉ
NВ€ЫЫњЭ[VHHX]™›ЫЬЉJNВ€ЫЫњЭ[HHЭ]KќЫЬ›™Щ][J[V[VJNВ€Y€
][OЛ›Ь™RY[KљЪ[™OOH	ШZ\‰И[KљЪ[™OOH	Ш™Y›ШЪЙКH™]\›€[ЩNВ€ЫЫњЭH
[V
ИЌJH
€SWФТV‘NВ€ЫЫњЭHH
[VH
ИЌJH
€SWФТV‘NВ€Э]Kќ\™Щ]HИЪ[™€	ЫЬ™IЛ[K€[VN€[VKK\Э[ЩN€\Э[ЩJЭ]Kњ^Y\‹ћЭ]Kњ^Y\‹ћKJHNВ€Э]KXЪЭ\\™Щ]Hќ[В€›ЭU\™Щ]XЬ]Z\™Y
Э]Kќ\™Щ]
NВ€™Yњ™\ЪЬ™]Р™XXЫЫЉЭ]Kќ\™Щ]
NВ€™]\›€ќYNВ€K€XќYФЩ]ЫX\[ЩU\™Щ][N€
JHO€В€Y€
Э]K›[ЩHOOH	Ьќ[‰И\Э]Kњ^Y\€\Э]KќЫЬ›
H™]\›€[ЩNВ€ЫЫњЭ[VHX]™›ЫЬЉ
NВ€ЫЫњЭ[VHHX]™›ЫЬЉJNВ€ЫЫњЭ[HHЭ]KќЫЬ›™Щ][J[V[VJNВ€Y€
][H[KљЪ[™OOH	ШZ\‰И[KљЪ[™OOH	Ш™Y›ШЪЙКH™]\›€[ЩNВ€ЫЫњЭH
[V
ИЌJH
€SWФТV‘NВ€ЫЫњЭHH
[VH
ИЌJH
€SWФТV‘NВ€Э]Kќ\™Щ]HИЪ[™€	ШЫX\[ЩIЛ[K€[VN€[VKK\Э[ЩN€\Э[ЩJЭ]Kњ^Y\‹ћЭ]Kњ^Y\‹ћKJHNВ€Э]KXЪЭ\\™Щ]Hќ[В€™]\›€ќYNВ€K€XќYФЩ]\›ШXЪ]™[€
ЩXЫЫ™КHO€В€Э]K\›ШXЪ]™[[\ЩYHX]›X^
ќ[X™\ЉЩXЫЫ™КH
NВ€™]\›€Э]K\›ШXЪ]™[[\ЩYВ€K€XќYСљ\™TљXЫШЪ]њ›ЫN€
K[XYЩHHL
HO€В€ЫЫњЭ[VHX]™›ЫЬЉ
NВ€ЫЫњЭ[VHHX]™›ЫЬЉJNВ€ЫЫњЭ[HHЭ]KќЫЬ›Л™Щ][J[V[VJNВ€Y€
Э]K›[ЩHOOH	Ьќ[‰И][OЛ›Ь™RY
H™]\›€[ЩNВ€љ\™S\Щ\”љXЫШЪ]КВ€Ъ[™€	ЫЬ™IЛ[K€[VN€[VK€€
[V
ИЌJH
€SWФТV‘K€N€
[VH
ИЌJH
€SWФТV‘K€KX]›X^
ќ[X™\Љ[XYЩJH
K

HO€ЯJNВ€™]\›€ќYNВ€K€XќYСљ[™Ь™U\™Щ]њ›ЫU[N€
KY]\ЛЬ™RYHќ[^ЫYYЩ^\ИHЧJHO€В€Y€
\Э]KќЫЬ›
H™]\›€ќ[В€ЫЫњЭ\™Щ]Hљ[™™\ЭЬ™U\™Щ]
€
ќ[X™\Љ
H
ИЌJH
€SWФТV‘K€
ќ[X™\ЉJH
ИЌJH
€SWФТV‘K€X]›X^
ќ[X™\ЉY]\КH
K€Ь™RYќ[€И^ЫYYЩ^\О€™]ИЩ]
^ЫYYЩ^\КKYЫ›Ь™TЩ[њЩS[™N€ќYHK€
NВ€™]\›€\™Щ]ИИ€\™Щ]ќN€\™Щ]ќK\Э[ЩN€\™Щ]™\Э[ЩKШЫЬ™N€\™Щ]њШЫЬ™HH€ќ[В€K€XќYРЫЫ\\™R[™^Y\™Щ]ЩX\Ъ€

HO€В€Y€
\Э]KќЫЬ›\Э]Kњ^Y\ЉH™]\›€ќ[В€ЫЫњЭ›ШЭ\ЩYЬ™HHЩ]›ШЭ\ЩYЬ™J
NВ€ЫЫњЭY]\ИHY™™XЭ]™TЩ[њЩTY]\К
H
€›ШЭ\ЩYЩ[њЩS][\Y\Љ›ШЭ\ЩYЬ™JNВ€ЫЫњЭЩ\љX[^™HH
\™Щ]КHO€\™Щ]Л›X\

\™Щ]
HO€	Э\™Щ]ќN‰Э\™Щ]ќ_X
NВ€ЫЫњЭ[™^YHЩ\љX[^™Jљ[™™\ЭЬ™U\™Щ]К€Э]Kњ^Y\‹ћ€Э]Kњ^Y\‹ћK€Y]\Л€›ШЭ\ЩYЬ™OЛљYќ[€И™\ЬXЭYќ›ЫЬЋ€ќYHK€‹€
JNВ€ЫЫњЭYЭЫ‘[ќ[Y\]Ь€HШљ™XЭњ›ЭЭ\Kљ\УЭЫ”›Ь\ќKШ[
Э]KќЫЬ›	Щ›Ь‘XXЪЬ™U[R[ђ›Э[™ЙКNВ€ЫЫњЭЭЫ‘[ќ[Y\]Ь€HЭ]KќЫЬ›™›Ь‘XXЪЬ™U[R[ђ›Э[™ОВ€]њќ]NВ€ћHВ€Э]KќЫЬ›™›Ь‘XXЪЬ™U[R[ђ›Э[™ИHќ[В€њќ]HHЩ\љX[^™Jљ[™™\ЭЬ™U\™Щ]К€Э]Kњ^Y\‹ћ€Э]Kњ^Y\‹ћK€Y]\Л€›ШЭ\ЩYЬ™OЛљYќ[€И™\ЬXЭYќ›ЫЬЋ€ќYHK€‹€
JNВ€Hљ[[HВ€Y€
YЭЫ‘[ќ[Y\]ЬЉHЭ]KќЫЬ›™›Ь‘XXЪЬ™U[R[ђ›Э[™ИHЭЫ‘[ќ[Y\]ЬЋВ€[ЩH[]HЭ]KќЫЬ›™›Ь‘XXЪЬ™U[R[ђ›Э[™ОВ€B€™]\›€И[™^Yњќ]KШ[YN€[™^Yљ›Ъ[Љ	Я	КHOOHњќ]Kљ›Ъ[Љ	Я	КHNВ€K€XќYСЩ]\ЬYS^[Э]€

HO€В€ЫЫњЭ^[Э]HЩ]\ЬYS^[Э]

NВ€™]\›€В€ЪY€^[Э]ќЪY€ZYЪ€^[Э]љZYЪ€Щ[ќ\–€^[Э]Щ[ќ\–€Щ[ќ\–N€^[Э]Щ[ќ\–K€ЬЪ][ЫњО€Шљ™XЭ™њ›ЫQ[ќљY\КЛ‹‹›^[Э]њЬЪ][ЫњЧK›X\

ЪYЪ[ќJHO€ЪYИ‹‹њЪ[ќWJJK€Ъ^™\О€Шљ™XЭ™њ›ЫQ[ќљY\КTФђQWСQ”Л›X\

Yљ[љ][ЫЉHO€ЩYљ[љ][Ы‹љYЩ]\ЬYS›ЩTЪ^™JYљ[љ][ЫЉWJJK€Z[љ[][QШ\€TФђQWУ“СWСРT€NВ€K€XќYФЩ]]XЪРЫЫЫЭЫЋ€
ЩXЫЫ™ИHЌЉHO€В€Э]K]XЪРЫЫЫЭЫ€HX]›X^
ќ[X™\ЉЩXЫЫ™КH
NВ€™]\›€Э]K]XЪРЫЫЫЭЫЋВ€K€XќYФ™\Щ]›ЩЬ™\ЬО€

HO€В€Ш]™HHЬ™X]QY][Ш]™J
NВ€Э]ИH›Ь›X[^™TЭ]КШ[Э[]SY]TЭ]КШ]™K›]™[КJNВ€Шљ™XЭ\ЬЪYЫЉЭ]KВ€[ЩN€	Э]IЛ€™]\›“[ЩN€	Э]IЛ€\™Щ]€ќ[€XЪЭ\\™Щ]€ќ[€]Ш^\Ъ[ќ€ќ[€\Э][€Ь™X]SЬ™PYК
K€\Э][ЫЭ[ќ€€ќ[“Ь™N€€Ь™PЫЭ[ќО€Ь™X]SЬ™PYК
K€\ШЫЭ™\™YЬ™RYО€™]ИЩ]

K€љ\ЪX›U\ЬYRYО€™]ИЩ]

K€]Z[X›U\ЬYRYО€™]ИЩ]

K€Щ[XЭY\ЬYRY€ќ[€ЫЬљЬЪЬ[YЪXљ[]Tќ[Ћ€LK€ЫЬљЬЪЬ[YЪX›RYО€™]ИЩ]

K€ЫЬљЬЪЬ[њЭ[ќ[Ћ€LK€ЫЬљЬЪЬ[њЭ[YYО€™]ИЩ]

K€ЫЬљЬЪЬњ™XZЭ›ЭYЪќ[Ћ€LK€ЫЬљЬЪЬњ™XZЭ›ЭYЪЪЩ[њО€™]ИЩ]

K€Y]љXЬО€Ь™X]Tќ[“Y]љXЬК
K€JNВ€\њЪ\ЭШ]™J
NВ€™]\›€ќYNВ€K€XќYР]]Рќ^PY™›Ь™X›N€
[Z]HЊ
HO€В€ЫЫњЭ›ЭYЪHЧNВ€ЫЫњЭ\Ъ\ЩS[Z]HЫ[\
X]™›ЫЬЉќ[X™\Љ[Z]
H
KWМ
NВ€›Ь€
]\Ъ\ЩHHИ\Ъ\ЩH\Ъ\ЩS[Z]И\Ъ\ЩH
ПHJHВ€ЫЫњЭШ]YЫЬћS]™[ИHШљ™XЭ™њ›ЫQ[ќљY\КTФђQWУS‘TЛ›X\

Ш]YЫЬћJHO€ШШ]YЫЬћKJJNВ€›Ь€
ЫЫњЭYљ[љ][Ы€Щ€TФђQWСQ”КHВ€Y€
Ш]YЫЬћS]™[ЦЩYљ[љ][Ы‹Ш]YЫЬћWHOHќ[
HШ]YЫЬћS]™[ЦЩYљ[љ][Ы‹Ш]YЫЬћWH
ПHЩ]\ЬYS]™[
Yљ[љ][ЫЉNВ€B€ЫЫњЭШ[™Y]\ИHTФђQWСQ”В€™љ[\Љ
Yљ[љ][ЫЉHO€В€ЫЫњЭ]™[HЩ]\ЬYS]™[
Yљ[љ][ЫЉNВ€Y€
]™[ЏHYљ[љ][Ы‹›X^]™[]\ЬYR\Ф\Ъ\ЩQ[YЪX›JYљ[љ][ЫЉJH™]\›€[ЩNВ€™]\›€Ш[ђY™›Ь™™XЪ\JШ]™Kљ[ќ™[ќЬћKЩ]\ЬYT™XЪ\JYљ[љ][Ы‹]™[
JNВ€JB€›X\

Yљ[љ][ЫЉHO€В€ЫЫњЭ]™[HЩ]\ЬYS]™[
Yљ[љ][ЫЉNВ€ЫЫњЭ™XЪ\HHЩ]\ЬYT™XЪ\JYљ[љ][Ы‹]™[
NВ€ЫЫњЭЩZYЪYЫЬЭHШљ™XЭ™[ќљY\К™XЪ\JKњ™YXЩJ
Э[KЫЬ™RY[[Э[ќJHO€
€Э[H
И[[Э[ќ
€
Ь™PћRY™Щ]
Ь™RY
OЛќ[YHJB€
K
NВ€ЫЫњЭ\HЩ]\ЬYS^[Э]

K™\ћRY™Щ]
Yљ[љ][Ы‹љY
HВ€ЫЫњЭШ]YЫЬћSШYHШ]YЫЬћS]™[ЦЩYљ[љ][Ы‹Ш]YЫЬћWHВ€ЫЫњЭЭ]YЪXХ\™Щ]HРSTRQУ—РUUР•VWХT‘СUЦЩYљ[љ][Ы‹љYHВ€ЫЫњЭЭ]YЪXХЩZYЪH]™[Э]YЪXХ\™Щ]€И
РSTRQУ—РUUР•VWХСRQТЦЩYљ[љ][Ы‹љYHJB€€NВ€ЫЫњЭЫЬ™Tљ[Ьљ]HHYљ[љ][Ы‹љYOOH	ШЫЬ™WЩљ\њЭЩ\ШЩ[ќ	ИИLWММ€В€ЫЫњЭљ[[љ[Ьљ]HHYљ[љ][Ы‹љYOOHРSTRQУ‹™љ[[\ЬYHИLLМ€В€™]\›€В€Yљ[љ][Ы‹€]™[€™XЪ\K€њ™XZЭ›ЭYЪ€”‘PRХ“ХQТС’T”ХФђS’ЧТQЛљ\КYљ[љ][Ы‹љY
K€Э]YЪXО€]™[Э]YЪXХ\™Щ]€љ[[€Yљ[љ][Ы‹љYOOHРSTRQУ‹™љ[[\ЬYK€ШЫЬ™N€ЩZYЪYЫЬЭ
€Э]YЪXХЩZYЪ
И\
€
ИШ]YЫЬћSШY
€Ќ€
ИЫЬ™Tљ[Ьљ]H
Иљ[[љ[Ьљ]K€NВ€JB€њЫЬќ

YќљYЪ
HO€
€YќњШЫЬ™HHљYЪњШЫЬ™B€TФђQWСQ”Лљ[™^ЩЉYќ™Yљ[љ][ЫЉHHTФђQWСQ”Лљ[™^ЩЉљYЪ™Yљ[љ][ЫЉB€
JNВ€]Ш[™Y]HHШ[™Y]\ЦМNВ€ЫЫњЭ\Эљ\њЭ[љФЫЭHЫЬљЬЪЬ[њЭ[Э]\К
Kњ™[XZ[љ[™ИOOHNВ€ЫЫњЭЬљYЪ[[\Ф™\XЩXX›TШШ[\€HШ[™Y]B€	‰€Ш[™Y]K›]™[OOH€	‰€XШ[™Y]Kњ™XZЭ›ЭYЪ€	‰€XШ[™Y]KњЭ]YЪXВ€	‰€XШ[™Y]K™љ[[В€Y€
\Эљ\њЭ[љФЫЭ	‰€ЬљYЪ[[\Ф™\XЩXX›TШШ[\ЉHВ€ЫЫњЭњ™XZЭ›ЭYЪШ[™Y]HHШ[™Y]\Л™љ[™

[ќћJHO€
€[ќћK›]™[OOH€	‰€[ќћKњ™XZЭ›ЭYЪ€	‰€PРSTRQУ‹Ш\ЭЫ™\Лљ[ЫY\К[ќћK™Yљ[љ][Ы‹љY
B€
JNВ€Y€
њ™XZЭ›ЭYЪШ[™Y]JHШ[™Y]HHњ™XZЭ›ЭYЪШ[™Y]NВ€B€Y€
XШ[™Y]H\Ь[™™XЪ\JШ]™Kљ[ќ™[ќЬћKШ[™Y]Kњ™XЪ\JJHњ™XZОВ€Ш]™K›]™[ЦШШ[™Y]K™Yљ[љ][Ы‹љYHHШ[™Y]K›]™[
ИNВ€™YЪ\Э\•ЫЬљЬЪЬ]™[КJNВ€Y€
Ш[™Y]K›]™[OOH
H™YЪ\Э\•ЫЬљЬЪЬљ\њЭ[љКШ[™Y]K™Yљ[љ][ЫЉNВ€™YЪ\Э\•ЫЬљЬЪЬњ™XZЭ›ЭYЪ
Ш[™Y]K™Yљ[љ][Ы‹Ш[™Y]K›]™[
ИJNВ€›ЭYЪњ\Ъ
Ш[™Y]K™Yљ[љ][Ы‹љY
NВ€Э]ИH›Ь›X[^™TЭ]КШ[Э[]SY]TЭ]КШ]™K›]™[КJNВ€B€Y€
\Э]Л›Ь™Q›ШЭ\Х[›ШЪЩY
HВ€Ш]™K™›ШЭ\ЩYЬ™RYHќ[В€H[ЩHВ€ЫЫњЭYљXЪ]ИHЬ™X]SЬ™PYК
NВ€›Ь€
ЫЫњЭYљ[љ][Ы€Щ€TФђQWСQ”КHВ€ЫЫњЭ]™[HЩ]\ЬYS]™[
Yљ[љ][ЫЉNВ€Y€
]™[ЏHYљ[љ][Ы‹›X^]™[\™\]Z\™[Y[ќУY]
Yљ[љ][ЫЉJHЫЫќ[ќYNВ€ЫЫњЭ™XЪ\HHЩ]\ЬYT™XЪ\JYљ[љ][Ы‹]™[
NВ€›Ь€
ЫЫњЭЫЬ™RY[[Э[ќHЩ€Шљ™XЭ™[ќљY\К™XЪ\JJHВ€YљXЪ]ЦЫЬ™RYH
ПHX]›X^
[[Э[ќH
Ш]™Kљ[ќ™[ќЬћVЫЬ™RYH
JNВ€B€B€ЫЫњЭ›ШЭ\ИHФ‘WХTTВ€™љ[\Љ
Ь™JHO€YљXЪ]ЦЫЬ™KљYH€	‰€
Ш]™K›Y™][YSЬ™\ЦЫЬ™KљYH
H€
B€њЫЬќ

YќљYЪ
HO€YљXЪ]ЦЬљYЪљYH
€љYЪќ[YHHYљXЪ]ЦЫYќљYH
€Yќќ[YJVМNВ€Ш]™K™›ШЭ\ЩYЬ™RYH›ШЭ\ПЛљYќ[В€B€\њЪ\ЭШ]™J
NВ€™]\›€И›ЭYЪ›ШЭ\ЩYЬ™RY€Ш]™K™›ШЭ\ЩYЬ™RY\Ъ\ЩY]™[О€ЫЭ[ќ\Ъ\ЩY]™[КШ]™K›]™[КHNВ€K€XќYС›ЬЩPЪZ[Ћ€
ћHKћHH
HO€В€Y€
Э]K›[ЩHOOH	Ьќ[‰И\Э]Kњ^Y\ЉH™]\›€[ЩNВ€ЪZ[”ЭљZЩJЭ]Kњ^Y\‹ћЭ]Kњ^Y\‹ћKќ[X™\Љћ
Hќ[X™\ЉћJH
NВ€™]\›€ќYNВ€K€XќYС›ЬЩQ›Ы™\О€

HO€В€Y€
Э]K›[ЩHOOH	Ьќ[‰И\Э]Kњ^Y\ЉH™]\›€[ЩNВ€›Ы™P]XЪК
NВ€™]\›€ќYNВ€K€XќYС›Ы™\Р\™PXЭ]™N€

HO€›Ы™\Р\™PXЭ]™J
K€XќYХљYЩЩ\‘Y\™\ЫЫ[ЩN€

HO€В€Э]Kќ\™Щ]Hќ[В€Э]KXЪЭ\\™Щ]Hќ[В€Э]K™Y\™\ЫЫ[ЩPЫЫЫЭЫ”™[XZ[љ[™ИHВ€™]\›€љYЩЩ\‘Y\™\ЫЫ[ЩJЩ]›ШЭ\ЩYЬ™J
JNВ€K€XќYТ\™™\ЬФY\ЩS][\Y\Ћ€
Ь™RYHќ[
HO€\™™\ЬФY\ЩS][\Y\ЉЬ™RY
K€XќYХљYЩЩ\‘XY’Ы›ШЪО€

HO€љYЩЩ\‘XY’Ы›ШЪКЭ]Kњ^Y\ЏЛћЭ]Kњ^Y\ЏЛћJK€XќYХљYЩЩ\”Э\\”XЪСXЪО€
[XYЩHHЭ]ЛњXЪФЭЩ\ЉHO€В€Y€
Э]K›[ЩHOOH	Ьќ[‰И\Э]Kќ\™Щ]
H™]\›€[ЩNВ€™]\›€љYЩЩ\”Э\\”XЪСXЪКЭ]Kќ\™Щ]X]›X^
ќ[X™\Љ[XYЩJH
JNВ€K€XќYФЩ]XЪЭ\[N€
JHO€В€Y€
Э]K›[ЩHOOH	Ьќ[‰И\Э]KќЫЬ›
H™]\›€[ЩNВ€ЫЫњЭ[VHX]™›ЫЬЉ
NВ€ЫЫњЭ[VHHX]™›ЫЬЉJNВ€ЫЫњЭ[HHЭ]KќЫЬ›™Щ][J[V[VJNВ€Y€
][OЛ›Ь™RY[KљЪ[™OOH	ШZ\‰И[KљЪ[™OOH	Ш™Y›ШЪЙКH™]\›€[ЩNВ€Э]KXЪЭ\\™Щ]HВ€Ъ[™€	ЫЬ™IЛ[K€[VN€[VK€€
[V
ИЌJH
€SWФТV‘K€N€
[VH
ИЌJH
€SWФТV‘K€NВ€™Yњ™\ЪљX[™ЫSЬ™SY[[ЬћJ
NВ€™]\›€ќYNВ€K€XќYСЩ]љX[™ЫN€

HO€В€ЫЫњЭљX[™ЫHHЩ]љX[™Э[][Ы•љX[™ЫJ
NВ€™]\›€љX[™ЫHИљX[™ЫK›X\

Ъ[ќ
HO€
И‹‹њЪ[ќJJH€ќ[В€K€XќYХљYЩЩ\“ZXЬ›С]™[ќ€
\HHќ[
HO€В€Y€
Э]K›[ЩHOOH	Ьќ[‰И\[Щ€Э]KќЫЬ›Л™Щ]ZXЬ›С]™[ќИOOH	Щќ[Э[Ы‰КH™]\›€[ЩNВ€ЫЫњЭ]™[ќHЭ]KќЫЬ›™Щ]ZXЬ›С]™[ќК
K™љ[™

Ш[™Y]JHO€]\HШ[™Y]Kќ\HOOH\JNВ€Y€
]™[ќ
H™]\›€\SZXЬ›С]™[ќ
]™[ќ
NВ€Y€
]\H\[Щ€Э]KќЫЬ›™Щ]ЫШ[ZXЬ›С]™[ќOOH	Щќ[Э[Ы‰КH™]\›€[ЩNВ€›Ь€
][™^HИ[™^MЋИ[™^
ПHJHВ€ЫЫњЭЫШ[]™[ќHЭ]KќЫЬ›™Щ]ЫШ[ZXЬ›С]™[ќ
[™^
NВ€Y€
ЫШ[]™[ќЛќ\HOOH\JH™]\›€\SZXЬ›С]™[ќ
ЫШ[]™[ќ
NВ€B€™]\›€[ЩNВ€K€XќYСЩ]ZXЬ›С]™[ќО€

HO€\[Щ€Э]KќЫЬ›Л™Щ]ZXЬ›С]™[ќИOOH	Щќ[Э[Ы‰ИИЭ]KќЫЬ›™Щ]ZXЬ›С]™[ќК
H€ЧK€XќYСЩ]ЫШ[ZXЬ›С]™[ќ€
[™^H
HO€
€\[Щ€Э]KќЫЬ›Л™Щ]ЫШ[ZXЬ›С]™[ќOOH	Щќ[Э[Ы‰В€ИЭ]KќЫЬ›™Щ]ЫШ[ZXЬ›С]™[ќ
[™^
B€€ќ[€
K€XќYФШЪY[QЫШ[]™[ќ€
[^HH[™љ[љ]JHO€В€ЫЫњЭЩXЫЫ™ИHќ[X™\Љ[^JNВ€Э]K›™^ЫШ[]™[ќ]Hќ[X™\‹љ\Сљ[љ]JЩXЫЫ™КB€ИЭ]K™[\ЩY
ИX]›X^
ЩXЫЫ™КB€€[™љ[љ]NВ€™]\›€ќ[X™\‹љ\Сљ[љ]JЭ]K›™^ЫШ[]™[ќ]
HИЭ]K›™^ЫШ[]™[ќ]€ќ[В€K€XќYХ[Y]PЬ™]Р™XXЫЫЋ€

HO€›ЫЫX[ЉЩ]Ь™]Р™XXЫЫЉќYJJK€ЫЫ\]PЭ\њ™[ќ›Э]N€

HO€В€Y€
Э]K›[ЩHOOH	Ьќ[‰И\Э]Kќ\™Щ]\[Щ€Э]KќЫЬ›™љ[™X\Э™\Ъ\Э[ЩTЭ\OOH	Щќ[Э[Ы‰КH™]\›€ќ[В€ЫЫњЭ›ШЭ\ЩYЬ™HHЩ]›ШЭ\ЩYЬ™J
NВ€™]\›€Э]KќЫЬ›™љ[™X\Э™\Ъ\Э[ЩTЭ\
Э]Kњ^Y\‹Э]Kќ\™Щ]В€[Э™TЬYY€Э]Л›[Э™TЬYY
€
Э]Л›Z[™S[Э™S][\Y\€JK€YФЭЩ\”\”ЩXЫЫ™€Э]ЛњXЪФЭЩ\€
€Э]Л™YФЬYY€›ШЭ\ЩYЬ™RY€›ШЭ\ЩYЬ™OЛљYќ[€›ШЭ\ЩYЬ™QYУ][\Y\Ћ€›ШЭ\ЩYЬ™HИ›ШЭ\ЩY[XYЩS][\Y\Љ›ШЭ\ЩYЬ™KљY
H€K€X^]Э\•[\О€K€Z[љ[][TШ]љ[™ЬО€Њ€Ш^\Ъ[ќЫЪРZXY€€JNВ€KџNВ‚љ[љ]X[^™J
NВџJJ
NВ