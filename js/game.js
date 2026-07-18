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
const MINER_COLLISION_RADIUS = 8;
const MIN_RUN_SECONDS = 6;
const DIRECT_MAX_RUN_SECONDS = 45;
const BONUS_MAX_RUN_SECONDS = 60;
const EXPLORATION_SCAN_TILES = 18;
const STORAGE_KEY = 'depth-zero-save-v1';
const CAMPAIGN = Object.freeze({
  requiredLevels: 110,
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
const DEFAULT_SAVE = Object.freeze({
  version: 7,
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
  const extraLevel = Math.min(12, Math.ceil(Math.min(6, remainingSeconds) / 0.5));
  remainingSeconds = Math.max(0, remainingSeconds - extraLevel * 0.5);
  let heartLevel = Math.min(12, Math.ceil(Math.min(9, remainingSeconds) / 0.75));
  remainingSeconds = Math.max(0, remainingSeconds - heartLevel * 0.75);
  let capsuleLevel = Math.min(12, Math.ceil(remainingSeconds / 2));
  if (owned('time_frozen_moment') > 0) heartLevel = Math.max(heartLevel, 4);
  if (owned('time_aftershock_clock') > 0) heartLevel = Math.max(heartLevel, 8);
  if (owned('time_last_second') > 0) heartLevel = 12;
  if (owned('time_discovery_bonus') > 0) capsuleLevel = Math.max(capsuleLevel, owned('time_discovery_bonus') * 4);
  if (owned('time_chrono_shard') > 0 || owned('time_elastic_second') > 0) capsuleLevel = Math.max(capsuleLevel, 8);
  setLevel('time_extra_breath', oldOath ? 12 : extraLevel, 12);
  setLevel('time_clockwork_heart', oldOath ? 12 : heartLevel, 12);
  setLevel('time_capsule', oldOath ? 12 : capsuleLevel, 12);
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
    const levels = migrateUpgradeLevels(stored.levels, stored.version);
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
  };
}

function getCampaignProgress() {
  const purchasedLevels = countPurchasedLevels(save.levels);
  const completedCapstones = CAMPAIGN.capstones.filter((id) => (save.levels[id] || 0) >= 1).length;
  const finalInstalled = (save.levels[CAMPAIGN.finalUpgrade] || 0) >= 1;
  const capstoneFraction = completedCapstones / CAMPAIGN.capstones.length;
  const finalFraction = finalInstalled ? 1 : 0;
  const levelFraction = clamp(purchasedLevels / CAMPAIGN.requiredLevels, 0, 1);
  const oreFraction = clamp(save.lifetimeChunks / CAMPAIGN.requiredLifetimeChunks, 0, 1);
  const ready = Boolean(save.campaignComplete) || (
    finalInstalled
    && completedCapstones === CAMPAIGN.capstones.length
    && purchasedLevels >= CAMPAIGN.requiredLevels
    && save.lifetimeChunks >= CAMPAIGN.requiredLifetimeChunks
  );

  return {
    ready,
    percent: ready ? 100 : Math.min(99, Math.floor((
      finalFraction * 0.2
      + capstoneFraction * 0.35
      + levelFraction * 0.2
      + oreFraction * 0.25
    ) * 100)),
    finalInstalled,
    completedCapstones,
    totalCapstones: CAMPAIGN.capstones.length,
    purchasedLevels,
    requiredLevels: CAMPAIGN.requiredLevels,
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
let upgradeLayoutCache = null;

const BREAK_SOURCE_LABELS = Object.freeze({
  pick: 'Кирка',
  laser: 'Лазер',
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
  debug: 'Отладочное разрушение',
});
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
  lastMetricTargetKey: '',
  microEventCheckCooldown: 0,
  activeMicroEvent: null,
  eventYieldBoostRemaining: 0,
  eventMoveBoostRemaining: 0,
  eventDigBoostRemaining: 0,
  eventSoftRockRemaining: 0,
  eventBannerTimer: 0,
  balanceReport: null,
  tutorialQueue: [],
  activeTutorialId: null,
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
  state.timeLeft = Math.min(getBonusRunCap(), state.timeLeft + amount);
  const granted = Math.max(0, state.timeLeft - before);
  if (granted <= 0) return 0;
  state.bonusTimeEarned += granted;
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

function showTutorial(id, title, text, hint = '') {
  if (!id || save.tutorialSeen?.[id]) return false;
  if (state.activeTutorialId === id || state.tutorialQueue.some((lesson) => lesson.id === id)) return false;
  if (!ui.tutorialCoach) return false;
  const lesson = { id, title, text, hint };
  if (state.activeTutorialId) {
    state.tutorialQueue.push(lesson);
    return true;
  }
  state.activeTutorialId = id;
  if (ui.tutorialTitle) ui.tutorialTitle.textContent = title;
  if (ui.tutorialText) ui.tutorialText.textContent = text;
  if (ui.tutorialHint) {
    ui.tutorialHint.textContent = hint;
    ui.tutorialHint.classList.toggle('hidden', !hint);
  }
  ui.tutorialCoach.dataset.lesson = id;
  ui.tutorialCoach.classList.remove('hidden');
  return true;
}

function markTutorialSeen(id) {
  if (!id) return;
  save.tutorialSeen = { ...(save.tutorialSeen || {}), [id]: true };
}

function dismissTutorial(skipQueued = false) {
  markTutorialSeen(state.activeTutorialId);
  if (skipQueued) {
    state.tutorialQueue.forEach((lesson) => markTutorialSeen(lesson.id));
    state.tutorialQueue.length = 0;
  }
  persistSave();
  ui.tutorialCoach?.classList.add('hidden');
  state.activeTutorialId = null;
  const next = state.tutorialQueue.shift();
  if (next) {
    state.activeTutorialId = next.id;
    if (ui.tutorialTitle) ui.tutorialTitle.textContent = next.title;
    if (ui.tutorialText) ui.tutorialText.textContent = next.text;
    if (ui.tutorialHint) {
      ui.tutorialHint.textContent = next.hint;
      ui.tutorialHint.classList.toggle('hidden', !next.hint);
    }
    ui.tutorialCoach.dataset.lesson = next.id;
    ui.tutorialCoach.classList.remove('hidden');
  }
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

function startOnboarding(force = false) {
  clearTutorialCoach();
  if (force) {
    for (const lesson of ONBOARDING_LESSONS) delete save.tutorialSeen[lesson.id];
    persistSave();
  }
  for (const lesson of ONBOARDING_LESSONS) {
    showTutorial(lesson.id, lesson.title, lesson.text, lesson.hint);
  }
}

function clearTutorialCoach() {
  ui.tutorialCoach?.classList.add('hidden');
  state.activeTutorialId = null;
  state.tutorialQueue.length = 0;
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

function newWorld(seed = (Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0, options = {}) {
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
  sound.unlock();
  stats = normalizeStats(calculateMetaStats(save.levels));
  newWorld(runOptions.seed ?? getRunSeed(), {
    useLift: true,
    sectorId: runOptions.sectorId || null,
  });
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
    lastMetricTargetKey: '',
    microEventCheckCooldown: 0,
    activeMicroEvent: null,
    eventYieldBoostRemaining: 0,
    eventMoveBoostRemaining: 0,
    eventDigBoostRemaining: 0,
    eventSoftRockRemaining: 0,
    eventBannerTimer: 0,
  });
  if (state.liftDepth > 1) state.metrics.liftStarts = 1;
  state.particles.length = 0;
  state.floaters.length = 0;
  state.beams.length = 0;
  state.shocks.length = 0;
  hideAllScreens();
  updateUtilityNavState();
  ui.runHud?.classList.remove('hidden');
  $('#fieldGuide')?.classList.remove('hidden');
  updateHud();
  toast(state.liftDepth > 1 ? `ЛИФТ: СТАРТ С ${Math.floor(state.liftDepth)} М` : 'ЧУТЬЁ АКТИВНО — ИЩЕМ ЖИЛУ', 'info');
  showTutorial(
    'first_run',
    'СМЕНА НАЧАЛАСЬ',
    'Шахтёр работает сам: чутьё выбирает цель, затем он идёт к ней и копает. Забег короткий — добыча остаётся навсегда.',
    'Чутьё само обновляет цель: вмешиваться в поиск не требуется.',
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

function buildRunReport(catalog, haul, activeRunSeconds) {
  const sourceEntries = Object.entries(state.metrics.sourceBreaks || {})
    .sort((left, right) => right[1] - left[1]);
  const previous = save.lastRunReport;
  const haulCount = countOreBag(haul);
  const duration = Math.max(0.01, activeRunSeconds || state.elapsed || 0.01);
  const movement = Math.min(duration, state.metrics.movementSeconds || 0);
  const mining = Math.min(duration, state.metrics.miningSeconds || 0);
  const searching = Math.min(duration, state.metrics.searchingSeconds || 0);
  const rarest = Object.entries(state.oreCounts)
    .filter(([, amount]) => amount > 0)
    .sort(([a], [b]) => (oreById.get(b)?.tier || 0) - (oreById.get(a)?.tier || 0))[0];
  const report = {
    seed: state.seed,
    run: save.runs + 1,
    sectorId: state.currentSector?.id || 'random_strata',
    sectorLabel: state.currentSector?.label || 'Случайные пласты',
    haul: haulCount,
    rawHaul: catalog.rawCount,
    catalogBonus: catalog.bonusCount,
    duration: Number(duration.toFixed(2)),
    depth: Math.floor(state.deepest),
    blocks: state.blocksBroken,
    oreTypes: state.discoveredOreIds?.size || 0,
    rarestOreId: rarest?.[0] || null,
    rarestAmount: rarest?.[1] || 0,
    efficiency: Number((haulCount / duration).toFixed(2)),
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
    deltaDepth: previous ? Math.floor(state.deepest) - (previous.depth || 0) : null,
  };
  return report;
}

function renderRunReport(report) {
  if (!report) return;
  ui.reportPanel?.classList.remove('hidden');
  const rare = report.rarestOreId ? oreById.get(report.rarestOreId) : null;
  const deltaLabel = (value, suffix = '') => value == null
    ? 'первый замер'
    : `${value >= 0 ? '+' : ''}${value}${suffix} к прошлой смене`;
  if (ui.reportHighlights) {
    ui.reportHighlights.innerHTML = `
      <article class="diagnosis-highlight is-positive"><span aria-hidden="true">↗</span><div><small>ЭФФЕКТИВНОСТЬ</small><strong>${report.efficiency.toFixed(1)} куск./с</strong><p>${deltaLabel(report.deltaHaul)}</p></div></article>
      <article class="diagnosis-highlight is-warning"><span aria-hidden="true">⌛</span><div><small>ГЛУБИНА</small><strong>${report.depth} м</strong><p>${deltaLabel(report.deltaDepth, ' м')}</p></div></article>
      <article class="diagnosis-highlight is-neutral"><span aria-hidden="true">◇</span><div><small>ГЛАВНАЯ НАХОДКА</small><strong>${rare ? `${rare.name} ×${report.rarestAmount}` : 'нет руды'}</strong><p>${report.sectorLabel}</p></div></article>`;
  }
  if (ui.reportGrade) {
    ui.reportGrade.textContent = report.efficiency >= 1.25
      ? 'A+'
      : report.efficiency >= 0.7
        ? 'A'
        : report.efficiency >= 0.3
          ? 'B'
          : report.haul > 0 ? 'C' : 'D';
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
  save.lifetimeChunks += haulCount;
  save.bestHaul = Math.max(save.bestHaul, haulCount);
  save.bestDepth = Math.max(save.bestDepth, Math.floor(state.deepest));
  save.lastRunReport = report;
  if (!save.bestRunReport || report.haul > (save.bestRunReport.haul || 0)) save.bestRunReport = { ...report };
  persistSave();

  const rarest = Object.entries(state.oreCounts)
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
  showTutorial(
    'first_report',
    'РАЗБОР СМЕНЫ',
    'После каждого забега отчёт показывает, куда ушло время, что разрушало породу и насколько результат лучше прошлого.',
    'Геологический журнал хранит постоянные рекорды по каждому виду руды.',
  );
  requestAnimationFrame(() => ui.retryRun?.focus({ preventScroll: true }));
  sound.tone(220, 0.15, 'triangle', 0.04, -80);
}

function refreshCampaignUI() {
  const progress = getCampaignProgress();
  if (ui.campaignStatus) {
    ui.campaignStatus.textContent = progress.ready
      ? (save.endingSeen ? 'ФИНАЛ ОТКРЫТ' : 'РАКЕТА ГОТОВА')
      : `РАКЕТА · ${progress.percent}% · УР. ${progress.purchasedLevels}/${progress.requiredLevels} · РУДА ${formatNumber(progress.lifetimeChunks)}/${formatNumber(progress.requiredLifetimeChunks)}`;
    ui.campaignStatus.title = `Верхушки веток ${progress.completedCapstones}/${progress.totalCapstones} · «В добрый путь» ${progress.finalInstalled ? 'установлен' : 'не установлен'} · уровни ${progress.purchasedLevels}/${progress.requiredLevels} · добыто ${formatNumber(progress.lifetimeChunks)}/${formatNumber(progress.requiredLifetimeChunks)} кусков`;
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
}

function openUpgradeScreen() {
  if (!['title', 'result'].includes(state.mode)) return;
  state.returnMode = state.mode === 'result' ? 'result' : 'title';
  state.mode = 'upgrades';
  updateUtilityNavState();
  ui.startScreen?.classList.add('hidden');
  ui.resultScreen?.classList.add('hidden');
  ui.upgradeScreen?.classList.remove('hidden');
  renderUpgrades();
  showTutorial(
    'upgrade_tree',
    'ЕДИНОЕ ДЕРЕВО',
    'Вся мета-прокачка начинается в одном корне. Ветки расходятся, снова пересекаются и сходятся к перку «В добрый путь».',
    'Наведи курсор на иконку, чтобы увидеть эффект и цену следующего уровня.',
  );
  requestAnimationFrame(() => {
    const selected = state.selectedUpgradeId ? upgradeById.get(state.selectedUpgradeId) : null;
    scrollUpgradeIntoView(selected, false);
    ui.closeUpgrades?.focus({ preventScroll: true });
  });
}

function closeUpgradeScreen() {
  clearTutorialCoach();
  ui.upgradeScreen?.classList.add('hidden');
  if (state.returnMode === 'result') {
    state.mode = 'result';
    updateUtilityNavState();
    if (ui.bankedOre) ui.bankedOre.textContent = `+${formatNumber(state.lastHaulCount)}`;
    ui.resultScreen?.classList.remove('hidden');
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
  state.mode = 'journal';
  hideAllScreens();
  renderGeologicalJournal();
  ui.journalScreen?.classList.remove('hidden');
  updateUtilityNavState();
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
  requestAnimationFrame(() => returnFocus?.focus?.({ preventScroll: true }));
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
  const attackRate = simulatedStats.digSpeed
    * (simulatedStats.laserUnlocked ? (simulatedStats.laserChargeRate || 1) : 1)
    * overclock;
  const densityPower = 1 + Math.max(0, simulatedStats.hardnessPierce || 0) * 0.07;
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
  const bombDps = attackRate * bombChance * simulatedStats.pickPower
    * Math.max(0, simulatedStats.bombPower || 1) * 1.8 * bombArea
    * volatileFactor * stickyFactor * fragmentFactor;
  const chainDps = attackRate * chainChance
    * Math.max(1, simulatedStats.chainCount || 1) * simulatedStats.pickPower
    * Math.max(0, simulatedStats.chainPower || 0.55)
    * (1 + (simulatedStats.triangularFixGadgetDamageBonus || 0) * 0.35);
  const droneDps = Math.max(0, simulatedStats.droneCount || 0)
    * Math.max(0, simulatedStats.droneSpeed || 1)
    * simulatedStats.pickPower * Math.max(0, simulatedStats.dronePower || 0.35)
    * clamp(simulatedStats.droneLifetime || 0, 0, 1);
  const echoDps = simulatedStats.laserUnlocked && simulatedStats.laserSuperPickEchoEvery > 0
    ? attackRate / simulatedStats.laserSuperPickEchoEvery
      * simulatedStats.pickPower * simulatedStats.laserSuperPickEchoPower
      * Math.max(1, Math.PI * simulatedStats.laserSuperPickEchoRadiusTiles ** 2 * 0.28)
    : 0;
  const effectiveDps = Math.max(0.1, directDps + bombDps + chainDps + droneDps + echoDps);
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
    oreBlocks += collateral;
    mined += collateral * (1 + Math.max(0, toolSweep - 1) * 0.65)
      + legDistance / TILE_SIZE * 0.18;
    depth = Math.max(depth, target.ty - spawn.ty);
    const firstOfType = !foundTypes.has(target.ore.id);
    foundTypes.add(target.ore.id);
    const dropMultiplier = 1
      + expectedChance(simulatedStats.extraYieldChance, 0.24)
      + expectedChance(simulatedStats.doubleDropChance, 0.18)
      + expectedChance(simulatedStats.tripleDropChance, 0.12) * 2
      + expectedChance(simulatedStats.richVeinChance, 0.18)
      + expectedChance(simulatedStats.motherlodeChance, 0.08) * 4;
    const comboMultiplier = 1 + Math.min(
      1.1,
      Math.max(0, attackRate - 2) * 0.018 * Math.max(1, simulatedStats.comboMultiplier || 1),
    );
    const depthProgress = clamp((target.ty - spawn.ty) / Math.max(1, WORLD_CONFIG.HEIGHT - spawn.ty), 0, 1);
    const gemMultiplier = (target.ore.tier || 0) >= 6 ? (simulatedStats.gemValueMultiplier || 1) : 1;
    const diversityMultiplier = 1 + Math.max(0, foundTypes.size - 1)
      * Math.max(0, simulatedStats.oreDiversityBonusPerType || 0);
    const yieldPerBlock = Math.max(1,
      (simulatedStats.oreValueMultiplier || 1)
        * dropMultiplier
        * comboMultiplier
        * gemMultiplier
        * (1 + depthProgress * Math.max(0, simulatedStats.depthValueBonus || 0))
        * diversityMultiplier);
    const relicPieces = expectedChance(simulatedStats.relicChance, 0.08) * (1 + depth / 45);
    const pieces = collateral * yieldPerBlock + relicPieces;
    oreBreakdown[target.ore.id] = (oreBreakdown[target.ore.id] || 0) + pieces;
    const upgradedValue = (target.ore.value || 1)
      * (1 + expectedChance(simulatedStats.rareOreChance, 0.2))
      * (1 + expectedChance(simulatedStats.goldenOreChance, 0.12) * 0.35);
    haul += pieces;
    cargoValue += pieces * upgradedValue;
    const expectedTimeBonus = collateral * (
      ((simulatedStats.timeRefundChance || 0) > 0
        ? expectedChance(simulatedStats.timeRefundChance, 0.1) * Math.max(0, simulatedStats.timeRefundAmount || 0)
        : 0)
      + ((simulatedStats.timeShardChance || 0) > 0
        ? expectedChance(simulatedStats.timeShardChance, 0.08) * Math.max(0, simulatedStats.timeShardSeconds || 0)
        : 0)
    ) + (firstOfType ? Math.max(0, simulatedStats.discoveryTimeBonus || 0) : 0);
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
  state.mode = 'balance';
  hideAllScreens();
  ui.balanceScreen?.classList.remove('hidden');
  if (ui.balanceSeed && !ui.balanceSeed.value) ui.balanceSeed.value = 'depth-zero-bench';
  if (ui.balanceResults && !state.balanceReport) ui.balanceResults.innerHTML = '<p id="balanceResultsTitle">Задайте профиль и запустите локальную серию.</p>';
  updateUtilityNavState();
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

function buyUpgrade(id) {
  const definition = upgradeById.get(id);
  if (!definition) return;
  const campaignWasReady = getCampaignProgress().ready;
  const level = getUpgradeLevel(definition);
  if (!requirementsMet(definition)) {
    toast('УСЛОВИЯ УЛУЧШЕНИЯ ЕЩЁ НЕ ВЫПОЛНЕНЫ', 'warning');
    sound.tone(90, 0.1, 'square', 0.025, -25);
    return;
  }
  if (level >= definition.maxLevel) return;
  const recipe = getUpgradeRecipe(definition, level);
  if (!canAffordRecipe(save.inventory, recipe)) {
    const missing = Object.entries(recipe)
      .filter(([oreId, amount]) => (save.inventory[oreId] || 0) < amount)
      .map(([oreId, amount]) => `${oreById.get(oreId)?.name || oreId} ${amount - (save.inventory[oreId] || 0)}`)
      .join(' · ');
    toast(`НЕ ХВАТАЕТ: ${missing.toUpperCase()}`, 'warning');
    sound.tone(85, 0.08, 'square', 0.025, -20);
    return;
  }
  if (!spendRecipe(save.inventory, recipe)) return;
  save.levels[definition.id] = level + 1;
  stats = normalizeStats(calculateMetaStats(save.levels));
  if (!stats.oreFocusUnlocked) save.focusedOreId = null;
  persistSave();
  sound.tone(330, 0.12, 'triangle', 0.04, 210);
  flash('#68e0c1', 0.18);
  toast(`${definition.name.toUpperCase()} · УР. ${level + 1}`, 'success');
  showTutorial(
    'first_upgrade',
    'УЗЕЛ УСТАНОВЛЕН',
    'Апгрейды постоянны и действуют со следующей смены. Некоторые узлы многоуровневые, а сложные требуют несколько родительских веток.',
    'Запас руды сверху показывает все ресурсы; название появляется при наведении.',
  );
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
  if (!state.selectedUpgradeId || !visibleIds.has(state.selectedUpgradeId)) {
    const root = visible.find((definition) => definition.id === 'core_first_descent');
    const orderedAvailable = visible
      .filter(upgradeIsAvailable)
      .sort((left, right) => UPGRADE_LANES.indexOf(left.category) - UPGRADE_LANES.indexOf(right.category));
    state.selectedUpgradeId = root?.id || orderedAvailable[0]?.id || visible[0]?.id || null;
  }

  const layout = getUpgradeLayout();
  const mapWidth = Math.max(ui.upgradeViewport?.clientWidth || 0, layout.width);
  ui.upgradeWorld.style.setProperty('--map-width', `${mapWidth}px`);
  ui.upgradeWorld.style.setProperty('--map-height', `${layout.height}px`);
  ui.upgradeLanes?.replaceChildren();

  const query = state.upgradeQuery.trim().toLocaleLowerCase('ru');
  let matchingNodes = 0;
  const nodeFragment = document.createDocumentFragment();
  for (const definition of visible) {
    const level = getUpgradeLevel(definition);
    const atMax = level >= definition.maxLevel;
    const available = upgradeIsAvailable(definition);
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
      preview ? 'is-preview' : '',
      owned ? 'is-owned' : '',
      atMax ? 'is-maxed' : '',
      state.selectedUpgradeId === definition.id ? 'is-selected' : '',
      !searchMatch || !categoryMatch ? 'is-dimmed' : '',
      newlyVisible.includes(definition.id) ? 'is-new' : '',
    ].filter(Boolean).join(' ');
    node.dataset.upgradeId = definition.id;
    node.dataset.category = definition.category;
    node.dataset.state = atMax ? 'maxed' : preview ? 'preview' : owned ? 'owned' : 'available';
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
        : affordable
          ? 'Нажмите, чтобы установить'
          : 'Не хватает руды — недостающие позиции отмечены красным';
    node.setAttribute('aria-label', `${definition.name}. ${definition.description}. Уровень ${level} из ${definition.maxLevel}. ${requirements}. ${priceText}`);
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
  $('#upgradeEmpty')?.classList.toggle('hidden', matchingNodes > 0);
  const bought = countPurchasedLevels(save.levels);
  const totalLevels = UPGRADE_DEFS.reduce((sum, definition) => sum + definition.maxLevel, 0);
  const campaign = getCampaignProgress();
  if (ui.upgradeProgress) ui.upgradeProgress.textContent = `${bought} / ${totalLevels} ур. · ракета ${campaign.percent}%`;
  const miniProgress = ui.upgradeProgress?.closest('.upgrade-progress-wrap')?.querySelector('.mini-progress i');
  if (miniProgress) miniProgress.style.width = `${clamp(bought / totalLevels, 0, 1) * 100}%`;
  $$('.filter-btn[data-category]').forEach((button) => button.classList.toggle('is-active', button.dataset.category === state.upgradeFilter));
  if (newlyVisible.length && ui.upgradeLive) ui.upgradeLive.textContent = `Открыто новых узлов: ${newlyVisible.length}`;
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
  if (ui.timerValue) ui.timerValue.textContent = displayedTime.toFixed(1);
  if (ui.timerFill) {
    const fraction = clamp(displayedTime / duration, 0, 1);
    ui.timerFill.style.transform = `scaleX(${fraction})`;
    ui.timerFill.classList.toggle('is-danger', fraction < 0.28);
    ui.timerFill.classList.toggle('is-bonus', state.bonusTimeEarned > 0 && displayedTime > Math.max(0, duration - state.activeWallElapsed));
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

function temporalOverclockMultiplier() {
  if (!stats.chronoOverclock) return 1;
  return 1
    + (stats.startTimeFreeze || 0) * 0.025
    + (stats.timerDrainReduction || 0) * 0.28
    + (stats.timeRefundChance || 0) * 0.25
    + (stats.timeShardChance || 0) * 0.18
    + (stats.lastChanceCharges || 0) * 0.03;
}

function dronesAreActive() {
  if (!stats.droneUnlocked || (stats.droneCount || 0) <= 0) return false;
  const availableFor = stats.runDuration * clamp(stats.droneLifetime || 0, 0, 1);
  return state.elapsed <= availableFor;
}

function oreRank(ore) {
  return Math.max(0, ORE_TYPES.findIndex((item) => item.id === ore?.id));
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
  const resultLimit = clamp(Math.floor(Number(limit) || 1), 1, 4);
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
    const distanceToTarget = Math.sqrt(distanceSquared);
    const travelSeconds = distanceToTarget / Math.max(1, stats.moveSpeed * (stats.mineMoveMultiplier || 1));
    const expectedCritical = 1 + procChance(stats.critChance, 0.16) * Math.max(0, stats.critMultiplier - 1);
    const expectedMulti = 1 + Math.max(0, (stats.multiHitCount || 1) - 1) * 0.65 + procChance(stats.multiHitChance, 0.1) * 0.65;
    const rarePower = 1 + (oreRank(ore) >= 4 ? (stats.rareOreDamageBonus || 0) : 0);
    const laserPower = stats.laserUnlocked ? (stats.laserPower || 1) * (1 + Math.max(0, (stats.laserBeams || 1) - 1) * 0.55) : 1;
    const focusedCalibration = focusedOreId ? focusedDamageMultiplier(tile) : 1;
    const effectivePower = stats.pickPower * (1 + (stats.hardnessPierce || 0) * 0.07) * (1 + (stats.oreDamageBonus || 0)) * expectedCritical * expectedMulti * rarePower * laserPower * focusedCalibration;
    const miningSeconds = (tile.hp || 1) / Math.max(0.1, effectivePower * stats.digSpeed);
    const score = (travelSeconds + miningSeconds) / valueWeight;
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
  const targets = findBestOreTargets(
    x,
    y,
    radius,
    focusedOreId,
    {},
    (stats.backupTargetSlots || 0) > 0 ? 2 : 1,
  );
  const [primary = null, backup = null] = targets;
  return { primary, backup };
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
  state.lastMetricTargetKey = key;
  if (target.kind === 'ore') {
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
  });
  state.floaters.push({ x: aimTarget.x, y: aimTarget.y - 28, text: 'ЭХО СУПЕРКИРКИ', color: '#a4fff1', life: 0.9, maxLife: 0.9 });
  spawnSparks(aimTarget.x, aimTarget.y, '#7affea', 13);
  state.shake = Math.max(state.shake, 8);
  sound.tone(205, 0.16, 'square', 0.035, 380);
  return true;
}

function resolveBrokenTile(tile, tx, ty, source = 'pick') {
  state.blocksBroken += 1;
  const countsForDeafKnock = ['pick', 'laser', 'multi'].includes(source);
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
  const noProcSource = source === 'event' || (source === 'echo' && stats.laserSuperPickEchoNoProcs);
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
  if (countsForDeafKnock) state.dryRockBlocks = 0;

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
  let yieldCount = 1;
  const bonusChance = noProcSource ? 0 : procChance(stats.extraYieldChance, 0.24);
  if (Math.random() < bonusChance) yieldCount += 1;
  // Jackpot effects stack additively. Multiplying five independent rolls made
  // the late economy jump by two orders of magnitude and skipped whole tiers.
  if (!noProcSource && Math.random() < procChance(stats.doubleDropChance, 0.18)) yieldCount += 1;
  if (!noProcSource && Math.random() < procChance(stats.tripleDropChance, 0.12)) yieldCount += 2;
  if (!noProcSource && Math.random() < procChance(stats.richVeinChance, 0.18)) yieldCount += 1;
  const motherlode = !noProcSource && Math.random() < procChance(stats.motherlodeChance, 0.08);
  if (motherlode) {
    yieldCount += 4;
    if (state.elapsed - state.lastBigToast > 1.2) {
      state.lastBigToast = state.elapsed;
      toast('МАТЕРИНСКАЯ ЖИЛА!', 'success');
      flash('#ffe08b', 0.32);
    }
  }

  let rewardOre = ore;
  if (!noProcSource && Math.random() < procChance(stats.rareOreChance, 0.2)) {
    rewardOre = ORE_TYPES[Math.min(ORE_TYPES.length - 1, oreRank(ore) + 1)] || ore;
  }
  let golden = false;
  if (!noProcSource && Math.random() < procChance(stats.goldenOreChance, 0.12)) {
    const gold = oreById.get('gold');
    if (gold && (gold.tier || 0) > (rewardOre.tier || 0)) rewardOre = gold;
    golden = true;
  }

  const comboBonus = 1 + Math.min(1.5, Math.max(0, state.combo - 1) * 0.06 * stats.comboMultiplier);
  const gemBonus = oreRank(rewardOre) >= 6 ? (stats.gemValueMultiplier || 1) : 1;
  const depthProgress = clamp(state.deepest / 90, 0, 1);
  const depthBonus = 1 + depthProgress * (stats.depthValueBonus || 0);
  const overkill = Math.max(0, stats.pickPower - (tile.maxHp || 1)) / Math.max(1, tile.maxHp || 1);
  const conversionBonus = 1 + Math.min(1, overkill) * (stats.oreConversionBonus || 0);
  const sourceBonus = source === 'bomb' ? (stats.bombValueMultiplier || 1) : 1;
  const goldenBonus = golden ? 1.35 : 1;
  const pickupBonus = 1 + Math.max(0, (stats.pickupRadius || 46) - 46) / 1400;
  const eventYieldBonus = state.eventYieldBoostRemaining > 0 ? 1.5 : 1;
  const exactYield = Math.max(1, yieldCount * stats.oreValueMultiplier * comboBonus * gemBonus * depthBonus * conversionBonus * sourceBonus * goldenBonus * pickupBonus * eventYieldBonus);
  const remainder = Math.max(0, Number(state.yieldRemainders[rewardOre.id]) || 0);
  yieldCount = Math.floor(exactYield + remainder);
  state.yieldRemainders[rewardOre.id] = exactYield + remainder - yieldCount;
  if (!noProcSource && (stats.timeRefundChance || 0) > 0 && Math.random() < procChance(stats.timeRefundChance, 0.1)) {
    addBonusTime(stats.timeRefundAmount || 0, x, y - 28, 'ВОЗВРАТ');
  }
  if (!noProcSource && (stats.timeShardChance || 0) > 0 && Math.random() < procChance(stats.timeShardChance, 0.08)) {
    addBonusTime(stats.timeShardSeconds || 0, x + 10, y - 35, 'ХРОНО');
  }
  const relicChance = procChance((stats.relicChance || 0) * (1 + Math.max(0, (stats.pickupRadius || 46) - 46) / 300), 0.08);
  if (!noProcSource && relicChance > 0 && Math.random() < relicChance) {
    const relicPieces = 1 + Math.floor(state.deepest / 45);
    yieldCount += relicPieces;
    state.floaters.push({ x: x - 8, y: y - 42, text: `РЕЛИКТ +${relicPieces}`, color: '#ff9fe3', life: 1.15, maxLife: 1.15 });
  }
  state.runOre += yieldCount;
  state.oreCounts[rewardOre.id] = (state.oreCounts[rewardOre.id] || 0) + yieldCount;
  const existingRecord = save.oreRecords?.[ore.id] || {};
  save.oreRecords = save.oreRecords || {};
  save.oreRecords[ore.id] = {
    firstRun: existingRecord.firstRun || save.runs + 1,
    deepest: Math.max(existingRecord.deepest || 0, Math.floor(depthFromOrigin(x, y))),
    physicalBlocks: (existingRecord.physicalBlocks || 0) + 1,
    largestYield: Math.max(existingRecord.largestYield || 0, yieldCount),
  };
  if (!noProcSource && (stats.veinRevealChance || 0) > 0 && Math.random() < procChance(stats.veinRevealChance, 0.08)) revealVein(tx, ty, ore.id);
  state.floaters.push({ x, y: y - 10, text: `+${yieldCount} ${rewardOre.name.toUpperCase()}`, color: golden ? '#ffe477' : (rewardOre.accent || rewardOre.color), life: 1, maxLife: 1 });
  state.shake = Math.max(state.shake, source === 'bomb' ? 9 : 3.5);
  sound.ore(ore);
  if ((ore.tier || 0) >= 5) flash(ore.color, 0.12);
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
      stats.laserWidth,
      onBreak,
      { excludedKeys: rayExcludedKeys },
    );
    const targetHit = tileReceivedDamage(target.tx, target.ty, hpBefore);
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
  const targetKey = `${aimTarget.tx}:${aimTarget.ty}`;
  state.hitStreak = state.lastTargetKey === targetKey ? state.hitStreak + 1 : 1;
  state.lastTargetKey = targetKey;
  const aimTile = state.world.getTile(aimTarget.tx, aimTarget.ty) || aimTarget.tile;
  const targetOre = oreById.get(aimTile?.oreId);
  const aimHpBefore = targetOre ? Math.max(0, aimTile.hp || 0) : 0;
  const streakBonus = 1 + Math.min(state.hitStreak, stats.streakCap || 0) * (stats.streakPower || 0);
  const densityBonus = 1 + (stats.hardnessPierce || 0) * 0.07;
  const oreBonus = 1 + (targetOre ? (stats.oreDamageBonus || 0) : 0);
  const rareBonus = 1 + (oreRank(targetOre) >= 4 ? (stats.rareOreDamageBonus || 0) : 0);
  const focusedCalibration = focusedDamageMultiplier(aimTile);
  const charged = (stats.chargedHitPower || 0) > 0 && state.attackCount % 8 === 0;
  const chargedBonus = charged ? 1 + stats.chargedHitPower : 1;
  const critical = Math.random() < procChance(stats.critChance, 0.16);
  const eventSoftnessBonus = state.eventSoftRockRemaining > 0 && !targetOre ? 1.65 : 1;
  const damage = stats.pickPower * streakBonus * densityBonus * oreBonus * rareBonus * chargedBonus * (critical ? stats.critMultiplier : 1) * eventSoftnessBonus;
  const aimingAtMainTarget = aimTarget.tx === state.target.tx && aimTarget.ty === state.target.ty;
  const primaryHpBefore = aimingAtMainTarget && aimTile?.oreId ? Math.max(0, aimTile.hp || 0) : 0;
  const primaryOreId = aimingAtMainTarget ? aimTile?.oreId : null;
  let primaryPhaseDamage = 0;
  let primaryBasePowerApplied = 0;
  let primaryOverkill = 0;
  let maxHittingLaserDamage = 0;
  let aimReceivedPrimaryHit = false;
  const broken = [];
  const onBreak = (tile, tx, ty) => {
    broken.push({ tile, tx, ty });
    const pickSource = !aimingAtMainTarget && aimTarget.kind === 'clearance' ? 'clearance' : 'pick';
    resolveBrokenTile(tile, tx, ty, stats.laserUnlocked ? 'laser' : pickSource);
  };

  if (stats.laserUnlocked) {
    const beamCount = clamp(Math.floor(stats.laserBeams || 1), 1, 5);
    for (let beamIndex = 0; beamIndex < beamCount; beamIndex += 1) {
      const offsetIndex = beamIndex - (beamCount - 1) * 0.5;
      const splitAngle = offsetIndex * 0.075;
      const cos = Math.cos(splitAngle);
      const sin = Math.sin(splitAngle);
      const beamX = nx * cos - ny * sin;
      const beamY = nx * sin + ny * cos;
      const splitPower = beamIndex === Math.floor(beamCount / 2) ? 1 : 0.62;
      const beamDamage = damage * (stats.laserPower || 1) * (1 + (stats.laserPierce || 1) * 0.08) * splitPower;
      const beamTarget = state.world.getTile(aimTarget.tx, aimTarget.ty);
      const beamHpBefore = beamTarget?.oreId ? Math.max(0, beamTarget.hp || 0) : 0;
      state.world.damageRay(player.x, player.y, beamX, beamY, stats.laserRange, beamDamage, stats.laserWidth, onBreak);
      const beamDamageTaken = tileDamageAmount(aimTarget.tx, aimTarget.ty, beamHpBefore);
      if (beamDamageTaken > 0) {
        primaryBasePowerApplied += beamDamage;
        maxHittingLaserDamage = Math.max(maxHittingLaserDamage, beamDamage);
        if (state.world.getTile(aimTarget.tx, aimTarget.ty)?.kind === 'air') {
          primaryOverkill += Math.max(0, beamDamage - beamHpBefore);
        }
      }
      state.beams.push({ x: player.x, y: player.y, x2: player.x + beamX * stats.laserRange, y2: player.y + beamY * stats.laserRange, color: '#69f4da', life: 0.12, maxLife: 0.12, width: stats.laserWidth });
    }
    primaryPhaseDamage = tileDamageAmount(aimTarget.tx, aimTarget.ty, aimHpBefore);
    aimReceivedPrimaryHit = primaryPhaseDamage > 1e-9;
    sound.tone(420, 0.07, 'sawtooth', 0.025, 360);
  } else {
    const reach = Math.min(stats.digReach, Math.max(TILE_SIZE * 0.72, length));
    let hitX = player.x + nx * reach;
    let hitY = player.y + ny * reach;
    const impactTile = findPickContact(player, nx, ny, reach, aimTarget);
    if (impactTile) {
      hitX = (impactTile.tx + 0.5) * TILE_SIZE;
      hitY = (impactTile.ty + 0.5) * TILE_SIZE;
    }
    const arcBonus = clamp((stats.digArc - Math.PI / 3) / Math.PI, 0, 0.7);
    if (impactTile) {
      if (stats.areaMiningUnlocked) {
        state.world.damageCircle(hitX, hitY, stats.digRadius * (1 + arcBonus * 0.32), damage, onBreak);
      } else {
        state.world.damageTile(impactTile.tx, impactTile.ty, damage, onBreak);
      }
    }
    primaryPhaseDamage = tileDamageAmount(aimTarget.tx, aimTarget.ty, aimHpBefore);
    aimReceivedPrimaryHit = primaryPhaseDamage > 1e-9;
    if (aimReceivedPrimaryHit) primaryBasePowerApplied = damage;
    if (aimReceivedPrimaryHit && state.world.getTile(aimTarget.tx, aimTarget.ty)?.kind === 'air') {
      primaryOverkill += Math.max(0, damage - aimHpBefore);
    }
    if ((stats.splashDamage || 0) > 0 && (stats.splashRadius || 0) > 0) {
      state.world.damageCircle(hitX, hitY, stats.digRadius + stats.splashRadius, damage * stats.splashDamage, onBreak);
    }
    spawnSparks(hitX, hitY, critical ? '#fff1a6' : '#edbb66', critical ? 7 : 3);
    sound.hit(critical);
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
    fireLaserRicochets(aimTarget, maxHittingLaserDamage, onBreak);
  }

  if (stats.laserUnlocked && aimingAtMainTarget) {
    state.laserShotCount += 1;
    if (
      stats.laserSuperPickEchoEvery > 0
      && state.laserShotCount % stats.laserSuperPickEchoEvery === 0
      && maxHittingLaserDamage > 0
    ) {
      triggerSuperPickEcho(aimTarget, maxHittingLaserDamage);
    }
  }

  if (critical || charged) {
    state.floaters.push({ x: player.x + nx * 45, y: player.y + ny * 45, text: charged ? 'ЗАРЯД!' : 'КРИТ!', color: charged ? '#8ff7ff' : '#fff09a', life: 0.65, maxLife: 0.65 });
    state.shake = Math.max(state.shake, 6);
  }

  const impactX = player.x + nx * Math.min(length, Math.max(stats.digReach, TILE_SIZE));
  const impactY = player.y + ny * Math.min(length, Math.max(stats.digReach, TILE_SIZE));
  if (stats.bombChance > 0 && Math.random() < procChance(stats.bombChance, 0.18)) {
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

function damageBombShape(x, y, radius, power, directionX, directionY) {
  const magnitude = Math.hypot(directionX, directionY);
  const directional = Boolean(stats.directionalBombs && stats.directionalBombConeTiles > 0 && magnitude > 0.001);
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
  for (const candidate of candidates) {
    const tile = state.world.getTile(candidate.tx, candidate.ty);
    if (!tile || tile.kind === 'air' || tile.kind === 'bedrock') continue;
    const hpBefore = tile.hp || 0;
    const oreId = tile.oreId;
    const veinId = tile.veinId;
    const triangularBonus = tileInsideTriangulation(candidate.tx, candidate.ty)
      ? stats.triangularFixGadgetDamageBonus
      : 0;
    if (triangularBonus > 0) state.metrics.triangleBuffHits += 1;
    const amount = power * candidate.factor * focusedDamageMultiplier(tile) * (1 + triangularBonus);
    state.world.damageTile(candidate.tx, candidate.ty, amount, (brokenTile, tx, ty) => resolveBrokenTile(brokenTile, tx, ty, 'bomb'));
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
      });
    }
  }
}

function detonate(x, y, directionX = 0, directionY = 1) {
  sound.boom();
  state.shake = Math.max(state.shake, 15);
  flash('#f0a24c', 0.28);
  const volatile = (stats.volatileBombChance || 0) > 0 && Math.random() < procChance(stats.volatileBombChance, 0.1);
  const sticky = (stats.stickyBombChance || 0) > 0 && Math.random() < procChance(stats.stickyBombChance, 0.12);
  const beacon = getCrewBeacon();
  let blastX = x;
  let blastY = y;
  let blastDirectionX = directionX;
  let blastDirectionY = directionY;
  if (sticky && beacon) {
    blastDirectionX = beacon.x - x;
    blastDirectionY = beacon.y - y;
    blastX = beacon.x;
    blastY = beacon.y;
  }
  const radius = stats.bombRadius * (volatile ? 1.75 : 1);
  const power = stats.pickPower * stats.bombPower * 1.8 * (volatile ? 2.2 : 1) * (sticky ? 1.45 : 1);
  damageBombShape(blastX, blastY, radius, power, blastDirectionX, blastDirectionY);
  const fragments = Math.min(6, Math.floor(stats.bombFragments || 0));
  for (let index = 0; index < fragments; index += 1) {
    const angle = index / Math.max(1, fragments) * Math.PI * 2 + Math.random() * 0.4;
    const fragmentX = blastX + Math.cos(angle) * radius * 0.72;
    const fragmentY = blastY + Math.sin(angle) * radius * 0.72;
    state.world.damageCircle(fragmentX, fragmentY, radius * 0.36, power * (stats.bombFragmentPower || 0.3), (tile, tx, ty) => resolveBrokenTile(tile, tx, ty, 'bomb'));
  }
  if (volatile) toast('НЕСТАБИЛЬНЫЙ ЗАРЯД!', 'warning');
  for (let index = 0; index < 26; index += 1) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 55 + Math.random() * 180;
    state.particles.push({ x: blastX, y: blastY, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, size: 2 + Math.random() * 6, color: index % 3 ? '#e06b3e' : '#ffd67d', life: 0.65 + Math.random() * 0.5, maxLife: 1.1, gravity: 80, glow: true });
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
    const target = findBeaconAwareTarget(
      fromX + nx * TILE_SIZE,
      fromY + ny * TILE_SIZE,
      stats.senseRadius * 0.65 * (focusedOre ? focusedSenseMultiplier(focusedOre) : 1) * chainRangeBonus,
      focusedOre,
      beacon,
      { excludedKeys: visited },
    );
    if (!target) break;
    visited.add(`${target.tx}:${target.ty}`);
    const inTriangle = pointInTriangle(target.x, target.y, triangle);
    const gadgetBonus = inTriangle ? stats.triangularFixGadgetDamageBonus : 0;
    if (gadgetBonus > 0 || (triangle && stats.triangularFixRangeBonus > 0)) state.metrics.triangleBuffHits += 1;
    const power = stats.pickPower * (stats.chainPower || 0.55) * (1 + gadgetBonus);
    const hpBefore = target.tile.hp || 0;
    const calibration = focusedDamageMultiplier(target.tile);
    state.world.damageCircle(target.x, target.y, Math.max(10, stats.digRadius * 0.55), power, (tile, tx, ty) => resolveBrokenTile(tile, tx, ty, 'chain'));
    if (calibration > 1 && target.tile.kind !== 'air') {
      state.world.damageTile(target.tx, target.ty, power * (calibration - 1), (tile, tx, ty) => resolveBrokenTile(tile, tx, ty, 'chain'));
    }
    if (target.tile.kind === 'air') {
      relayCrewOverkill(target, targetOreId, Math.max(0, power * calibration - hpBefore), visited);
    }
    const beamLife = 0.18 + (stats.shockDuration || 0);
    state.beams.push({ x: fromX, y: fromY, x2: target.x, y2: target.y, color: '#b58cff', life: beamLife, maxLife: beamLife, width: 3 });
    if ((stats.shockDuration || 0) > 0) {
      state.shocks.push({ x: target.x, y: target.y, life: stats.shockDuration, maxLife: stats.shockDuration, tick: 0.12 });
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

function formatMicroEventTimer(seconds) {
  return `${Math.max(0, seconds).toFixed(1).replace('.', ',')} С`;
}

function updateMicroEventIndicator() {
  if (!ui.microEventBanner) return;
  const remaining = microEventIndicatorRemaining();
  if (state.mode !== 'run' || !state.activeMicroEvent || remaining <= 0) {
    ui.microEventBanner.classList.add('hidden');
    if (remaining <= 0) state.activeMicroEvent = null;
    return;
  }
  if (ui.microEventTimer) ui.microEventTimer.textContent = formatMicroEventTimer(remaining);
  ui.microEventBanner.classList.remove('hidden');
}

function showMicroEventIndicator(event, text) {
  if (!ui.microEventBanner || !event) return;
  if (ui.microEventTitle) ui.microEventTitle.textContent = text || event.label || event.type;
  ui.microEventBanner.style.setProperty('--event-color', event.color || '#ffd170');
  updateMicroEventIndicator();
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
    const lootEntries = Object.entries(triggered.loot || {})
      .filter(([oreId, amount]) => oreById.has(oreId) && Number(amount) > 0);
    let pieces = 0;
    const labels = [];
    for (const [oreId, rawAmount] of lootEntries) {
      const amount = Math.max(1, Math.floor(Number(rawAmount) || 0));
      const rewardOre = oreById.get(oreId);
      state.oreCounts[oreId] = (state.oreCounts[oreId] || 0) + amount;
      state.discoveredOreIds.add(oreId);
      pieces += amount;
      labels.push(`${rewardOre.name} ×${amount}`);
    }
    state.runOre += pieces;
    addBonusTime(0.5, x, y - 38, 'КОНТЕЙНЕР');
    indicatorText = `СУНДУК · ${labels.join(', ') || 'ПУСТО'}${pieces ? ' · +0,5 С' : ''}`;
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
  const chest = state.world.getMicroEventsNear(
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
  state.deafKnockCooldown = Math.max(0, state.deafKnockCooldown - delta);
  state.deafKnockBoostRemaining = Math.max(0, state.deafKnockBoostRemaining - delta);
  state.eventYieldBoostRemaining = Math.max(0, state.eventYieldBoostRemaining - delta);
  state.eventMoveBoostRemaining = Math.max(0, state.eventMoveBoostRemaining - delta);
  state.eventDigBoostRemaining = Math.max(0, state.eventDigBoostRemaining - delta);
  state.eventSoftRockRemaining = Math.max(0, state.eventSoftRockRemaining - delta);
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
    const maxTargetDistance = explorationTarget
      ? EXPLORATION_SCAN_TILES * TILE_SIZE * 1.25
      : Math.max(
        state.target.lockRadius || 0,
        effectiveSenseRadius() * focusedSenseMultiplier(focusedOre),
        rememberedDistance,
      ) * persistence;
    if (
      (microEventTarget && !liveMicroEvent)
      || (!microEventTarget && !current)
      || (!microEventTarget && current.kind === 'air')
      || (!microEventTarget && current.kind === 'bedrock')
      || (!microEventTarget && !explorationTarget && !current.oreId)
      || (!microEventTarget && !explorationTarget && focusedOre && current.oreId !== focusedOre.id)
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
    const targets = priorityChest
      ? { primary: priorityChest, backup: state.target?.kind === 'ore' ? state.target : state.backupTarget }
      : chooseOreTargets(state.player.x, state.player.y, searchRadius, focusedOre?.id || null);
    if (targets.primary) {
      const previousKey = state.target ? `${state.target.tx}:${state.target.ty}` : '';
      const nextKey = `${targets.primary.tx}:${targets.primary.ty}`;
      targets.primary.lockRadius = searchRadius;
      if (targets.backup) targets.backup.lockRadius = searchRadius;
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
    const desiredSpeed = stats.moveSpeed * (stats.mineMoveMultiplier || 1) * deafKnockMoveMultiplier * eventMoveMultiplier;
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
      state.attackCooldown = 1 / Math.max(0.2, stats.digSpeed * chargeRate * temporalOverclockMultiplier() * eventDigMultiplier);
    }
  } else {
    state.player.moving = lerp(state.player.moving, 0, clamp(delta * 5, 0, 1));
    if (state.targetCooldown <= 0.03) state.ping = Math.max(state.ping, 0.35);
  }

  if (dronesAreActive() && state.droneCooldown <= 0) {
    droneAttack();
    state.droneCooldown = 1 / Math.max(0.25, stats.droneSpeed || 1);
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
    const baseRange = (effectiveSenseRadius() * 0.85 + Math.max(0, (stats.pickupRadius || 46) - 46) * 0.35)
      * (focusedOre ? focusedSenseMultiplier(focusedOre) : 1)
      * (triangle ? 1 + stats.triangularFixRangeBonus : 1);
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
    const target = triangleTarget || findBeaconAwareTarget(
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
    const power = stats.pickPower * Math.max(0.2, stats.dronePower || 0.35) * (1 + gadgetBonus);
    const hpBefore = target.tile.hp || 0;
    const calibration = focusedDamageMultiplier(target.tile);
    state.world.damageCircle(target.x, target.y, Math.max(7, stats.digRadius * 0.34), power, (tile, tx, ty) => resolveBrokenTile(tile, tx, ty, 'drone'));
    if (calibration > 1 && target.tile.kind !== 'air') {
      state.world.damageTile(target.tx, target.ty, power * (calibration - 1), (tile, tx, ty) => resolveBrokenTile(tile, tx, ty, 'drone'));
    }
    if (target.tile.kind === 'air') {
      relayCrewOverkill(target, targetOreId, Math.max(0, power * calibration - hpBefore), [`${target.tx}:${target.ty}`]);
    }
    state.beams.push({ x: origin.x, y: origin.y, x2: target.x, y2: target.y, color: '#76dbff', life: 0.1, maxLife: 0.1, width: 2 });
    if ((stats.droneBombChance || 0) > 0 && Math.random() < procChance(stats.droneBombChance, 0.12)) {
      const dx = target.x - origin.x;
      const dy = target.y - origin.y;
      const length = Math.max(0.001, Math.hypot(dx, dy));
      detonate(target.x, target.y, dx / length, dy / length);
    }
  }
}

function spawnDebris(x, y, color, count) {
  for (let index = 0; index < count; index += 1) {
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
    });
  }
  if (state.particles.length > 360) state.particles.splice(0, state.particles.length - 360);
}

function spawnSparks(x, y, color, count) {
  for (let index = 0; index < count; index += 1) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 80 + Math.random() * 150;
    state.particles.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, size: 1 + Math.random() * 2, color, life: 0.18 + Math.random() * 0.25, maxLife: 0.42, gravity: 85, glow: true });
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
    base: Object.freeze(['#76503a', '#7b543c', '#80583e', '#855c41', '#8a6043', '#8f6546', '#946948']),
    light: '#bd8759',
    side: '#9c6c4a',
    shadow: '#4a3026',
    strata: '#a56f49',
    strataLight: '#c48b5a',
    chip: '#cf9864',
    chipDark: '#5a392a',
  }),
  dirt: Object.freeze({
    base: Object.freeze(['#604031', '#644333', '#684635', '#6c4937', '#704b38', '#744e3a', '#78513c']),
    light: '#9b6b47',
    side: '#7e563c',
    shadow: '#3e2a24',
    strata: '#89583b',
    strataLight: '#a16d47',
    chip: '#aa744b',
    chipDark: '#4a3027',
  }),
  stone: Object.freeze({
    base: Object.freeze(['#374149', '#3a444c', '#3d474f', '#404a52', '#434d55', '#465058', '#49535b']),
    light: '#68757b',
    side: '#515e66',
    shadow: '#242d35',
    strata: '#56646b',
    strataLight: '#738087',
    chip: '#78858a',
    chipDark: '#2c353d',
  }),
  deepstone: Object.freeze({
    base: Object.freeze(['#222d37', '#25303a', '#28333e', '#2b3641', '#2e3944', '#313c47', '#34404b']),
    light: '#4c5b66',
    side: '#394753',
    shadow: '#141e28',
    strata: '#344653',
    strataLight: '#536570',
    chip: '#596a73',
    chipDark: '#18242e',
  }),
  bedrock: Object.freeze({
    base: Object.freeze(['#0d151e', '#101821', '#131b24', '#162029', '#19232c', '#1c2630', '#1f2933']),
    light: '#34414b',
    side: '#222e38',
    shadow: '#070d14',
    strata: '#27343e',
    strataLight: '#3d4a53',
    chip: '#48545c',
    chipDark: '#080f17',
  }),
});

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

function drawChippedTerrainCell(x, y, tx, ty, openMask, fillStyle) {
  ctx.fillStyle = fillStyle;
  if (openMask === 0) {
    ctx.fillRect(x, y, TILE_SIZE + 1, TILE_SIZE + 1);
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
  ctx.beginPath();
  ctx.moveTo(x + (leftOpen ? chipC : 0), y + (topOpen ? chipA : 0));
  ctx.lineTo(x + 5, y + (topOpen ? chipB : 0));
  ctx.lineTo(x + 10, y + (topOpen ? chipB : 0));
  ctx.lineTo(x + 10, y + (topOpen ? chipC : 0));
  ctx.lineTo(x + 18, y + (topOpen ? chipC : 0));
  ctx.lineTo(x + 18, y + (topOpen ? chipA : 0));
  ctx.lineTo(x + 24, y + (topOpen ? chipA : 0));
  ctx.lineTo(rightEdge - (rightOpen ? chipB : 0), y + (topOpen ? chipB : 0));
  ctx.lineTo(rightEdge - (rightOpen ? chipC : 0), y + 6);
  ctx.lineTo(rightEdge - (rightOpen ? chipC : 0), y + 11);
  ctx.lineTo(rightEdge - (rightOpen ? chipA : 0), y + 11);
  ctx.lineTo(rightEdge - (rightOpen ? chipA : 0), y + 18);
  ctx.lineTo(rightEdge - (rightOpen ? chipB : 0), y + 18);
  ctx.lineTo(rightEdge - (rightOpen ? chipB : 0), y + 24);
  ctx.lineTo(rightEdge - (rightOpen ? chipC : 0), bottomEdge - (bottomOpen ? chipA : 0));
  ctx.lineTo(x + 24, bottomEdge - (bottomOpen ? chipB : 0));
  ctx.lineTo(x + 18, bottomEdge - (bottomOpen ? chipB : 0));
  ctx.lineTo(x + 18, bottomEdge - (bottomOpen ? chipA : 0));
  ctx.lineTo(x + 10, bottomEdge - (bottomOpen ? chipA : 0));
  ctx.lineTo(x + 10, bottomEdge - (bottomOpen ? chipC : 0));
  ctx.lineTo(x + 5, bottomEdge - (bottomOpen ? chipC : 0));
  ctx.lineTo(x + (leftOpen ? chipA : 0), bottomEdge - (bottomOpen ? chipB : 0));
  ctx.lineTo(x + (leftOpen ? chipB : 0), y + 24);
  ctx.lineTo(x + (leftOpen ? chipB : 0), y + 18);
  ctx.lineTo(x + (leftOpen ? chipC : 0), y + 18);
  ctx.lineTo(x + (leftOpen ? chipC : 0), y + 11);
  ctx.lineTo(x + (leftOpen ? chipA : 0), y + 11);
  ctx.lineTo(x + (leftOpen ? chipA : 0), y + 5);
  ctx.closePath();
  ctx.fill();
}

function drawTerrainStrata(x, y, tx, ty, kind, palette, openMask) {
  const leftInset = openMask & TERRAIN_OPEN_LEFT ? 4 : 0;
  const rightInset = openMask & TERRAIN_OPEN_RIGHT ? 4 : 0;
  const usableWidth = TILE_SIZE + 1 - leftInset - rightInset;
  const spacing = kind === 'loam' ? 2 : kind === 'dirt' ? 3 : kind === 'stone' ? 5 : 6;
  const rowOffset = Math.floor(tileNoise(Math.floor(tx / 6), 0, 40) * 3);
  const bandSeed = tileNoise(Math.floor(tx / 3), ty, 41);

  if ((ty + rowOffset) % spacing === 0 && bandSeed > 0.14) {
    const bandY = 7 + Math.floor(bandSeed * 10);
    ctx.fillStyle = palette.strata;
    ctx.fillRect(x + leftInset, y + bandY, usableWidth, 2);
    if ((kind === 'dirt' || kind === 'loam') && bandSeed > 0.58) {
      ctx.fillStyle = palette.strataLight;
      ctx.fillRect(x + leftInset + 3, y + bandY - 2, Math.max(3, usableWidth - 9), 2);
    } else if (bandSeed > 0.72) {
      ctx.fillStyle = palette.chipDark;
      ctx.fillRect(x + leftInset + 5, y + bandY + 2, Math.max(3, usableWidth - 12), 1);
    }
  }

  const fleck = tileNoise(tx, ty, 44);
  if (fleck > 0.2) {
    const px = 4 + Math.floor(tileNoise(tx, ty, 45) * 15);
    const py = 5 + Math.floor(tileNoise(tx, ty, 46) * 15);
    ctx.fillStyle = fleck > 0.72 ? palette.chip : palette.chipDark;
    ctx.fillRect(x + px, y + py, 4 + Math.floor(fleck * 3), 2);
    if (fleck > 0.55) ctx.fillRect(x + px + 2, y + py - 2, 3, 2);
    if (fleck > 0.84) {
      ctx.fillStyle = palette.strataLight;
      ctx.fillRect(x + px + 3, y + py, 2, 1);
    }
  }
}

function drawVoxelMassTexture(x, y, tx, ty, palette, openMask) {
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
      ctx.globalAlpha = 0.1 + cluster * 0.2;
      ctx.fillStyle = cluster > 0.78 ? palette.light : detail > 0.68 ? palette.side : palette.shadow;
      ctx.fillRect(x + microX * voxel, y + microY * voxel, voxel + 1, voxel + 1);
      if (detail > 0.9 && microX < gridSize - 1) {
        ctx.fillRect(x + microX * voxel + voxel, y + microY * voxel + 2, voxel, 2);
      }
    }
  }
  ctx.globalAlpha = 1;
}

function drawExposedVoxelFaces(x, y, tx, ty, palette, openMask) {
  const faceA = 2 + Math.floor(tileNoise(tx, ty, 32) * 3);
  const faceB = 2 + Math.floor(tileNoise(tx, ty, 33) * 3);

  if (openMask & TERRAIN_OPEN_TOP) {
    ctx.fillStyle = palette.light;
    ctx.fillRect(x + 3, y + faceA, 5, 2);
    ctx.fillRect(x + 10, y + faceB, 4, 2);
    ctx.fillRect(x + 17, y + faceA, 6, 2);
    ctx.fillStyle = palette.side;
    ctx.fillRect(x + 7, y + faceA + 2, 4, 1);
  }
  if (openMask & TERRAIN_OPEN_LEFT) {
    ctx.fillStyle = palette.side;
    ctx.fillRect(x + faceB, y + 4, 2, 5);
    ctx.fillRect(x + faceA, y + 11, 2, 4);
    ctx.fillRect(x + faceB, y + 18, 2, 5);
  }
  if (openMask & TERRAIN_OPEN_RIGHT) {
    ctx.fillStyle = palette.shadow;
    ctx.fillRect(x + TILE_SIZE - faceA - 1, y + 4, 2, 5);
    ctx.fillRect(x + TILE_SIZE - faceB - 1, y + 11, 2, 4);
    ctx.fillRect(x + TILE_SIZE - faceA - 1, y + 18, 2, 5);
  }
  if (openMask & TERRAIN_OPEN_BOTTOM) {
    ctx.fillStyle = palette.shadow;
    ctx.fillRect(x + 3, y + TILE_SIZE - faceB - 1, 5, 2);
    ctx.fillRect(x + 10, y + TILE_SIZE - faceA - 1, 4, 2);
    ctx.fillRect(x + 17, y + TILE_SIZE - faceB - 1, 6, 2);
  }
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
  gradient.addColorStop(0, '#102f3a');
  gradient.addColorStop(0.42, '#0a222d');
  gradient.addColorStop(1, '#06161f');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  const cameraDepth = Math.max(0, state.camera.y) / Math.max(1, WORLD_CONFIG.HEIGHT * TILE_SIZE);
  ctx.save();
  ctx.globalAlpha = 0.12;
  for (let layer = 0; layer < 5; layer += 1) {
    const y = height * (0.18 + layer * 0.2) - ((state.camera.y * (0.05 + layer * 0.018)) % 120);
    ctx.beginPath();
    ctx.moveTo(0, y);
    for (let x = 0; x <= width + 100; x += 100) {
      ctx.lineTo(x, y + Math.sin(x * 0.008 + layer * 2.1 + now * 0.00008) * (16 + layer * 4));
    }
    ctx.strokeStyle = layer % 2 ? '#3b7180' : '#bb784b';
    ctx.lineWidth = 10 + layer * 3;
    ctx.stroke();
  }
  ctx.restore();

  ctx.fillStyle = `rgba(5, 13, 20, ${0.08 + cameraDepth * 0.3})`;
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
    const pulse = 0.5 + Math.sin(now * 0.012 + event.tx) * 0.5;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.1 + pulse * 0.13;
    const glow = ctx.createRadialGradient(event.x, event.y, radius * 0.08, event.x, event.y, radius);
    glow.addColorStop(0, event.color || '#ffd170');
    glow.addColorStop(0.48, `${event.color || '#ffd170'}55`);
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(event.x, event.y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 0.52 + pulse * 0.28;
    ctx.strokeStyle = event.color || '#ffd170';
    ctx.lineWidth = 3;
    ctx.setLineDash([12, 8]);
    ctx.lineDashOffset = -now * 0.025;
    ctx.beginPath();
    ctx.arc(event.x, event.y, radius * (0.92 + pulse * 0.06), 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    for (let index = 0; index < 8; index += 1) {
      const angle = index / 8 * Math.PI * 2 + now * 0.0004;
      ctx.beginPath();
      ctx.moveTo(event.x + Math.cos(angle) * radius * 0.66, event.y + Math.sin(angle) * radius * 0.66);
      ctx.lineTo(event.x + Math.cos(angle) * radius * 0.88, event.y + Math.sin(angle) * radius * 0.88);
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 0.96;
    ctx.fillStyle = '#071018';
    ctx.strokeStyle = event.color || '#ffd170';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(event.x, event.y, 25 + pulse * 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = event.color || '#ffd170';
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
        ctx.fillStyle = 'rgba(111, 156, 161, 0.08)';
        ctx.fillRect(x + dust * 18, y + 8, 2, 2);
      }
    }
    return;
  }

  const palette = TERRAIN_PALETTES[tile.kind] || TERRAIN_PALETTES.stone;
  const macroNoise = terrainMassNoise(tx + ty * 0.58, ty - tx * 0.16, 2);
  const baseIndex = clamp(
    Math.round((palette.base.length - 1) * (0.34 + macroNoise * 0.32)),
    0,
    palette.base.length - 1,
  );
  const openMask = getOpenTerrainMask(tx, ty);
  drawChippedTerrainCell(x, y, tx, ty, openMask, palette.base[baseIndex]);
  drawVoxelMassTexture(x, y, tx, ty, palette, openMask);
  drawTerrainStrata(x, y, tx, ty, tile.kind, palette, openMask);
  drawExposedVoxelFaces(x, y, tx, ty, palette, openMask);

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

function drawOreInTile(x, y, tx, ty, ore, revealed, now) {
  if (!ore) return;
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
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
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

  // An isolated tile is a compact pocket; connected tiles become one broad,
  // uninterrupted ribbon instead of beads joined by hairline strokes.
  if (connectionCount === 0) {
    const forkX = branchNoise > 0.5 ? 1 : -1;
    ctx.moveTo(centerX - forkX * 8, centerY + 5);
    ctx.lineTo(centerX, centerY);
    ctx.lineTo(centerX + forkX * 9, centerY - 4 + Math.floor(noise * 4));
  }

  if (revealed) {
    ctx.globalAlpha = 0.1 + pulse * 0.12;
    ctx.strokeStyle = ore.color;
    ctx.lineWidth = 15;
    ctx.stroke();
  }

  ctx.globalAlpha = revealed ? 0.74 : 0.08;
  ctx.strokeStyle = '#071018';
  ctx.lineWidth = 12;
  ctx.stroke();
  ctx.globalAlpha = revealed ? 0.9 + pulse * 0.08 : 0.13;
  ctx.strokeStyle = ore.color;
  ctx.lineWidth = 8;
  ctx.stroke();

  const nodeWidth = 13 + Math.floor(noise * 4);
  const nodeHeight = 10 + Math.floor(branchNoise * 4);
  ctx.globalAlpha = revealed ? 0.75 : 0.08;
  ctx.fillStyle = '#071018';
  ctx.fillRect(centerX - Math.floor(nodeWidth / 2) - 2, centerY - Math.floor(nodeHeight / 2) - 2, nodeWidth + 4, nodeHeight + 4);
  ctx.fillRect(centerX - 5, centerY - Math.floor(nodeHeight / 2) - 4, 10, nodeHeight + 8);

  ctx.globalAlpha = revealed ? 1 : 0.14;
  ctx.fillStyle = ore.color;
  ctx.fillRect(centerX - Math.floor(nodeWidth / 2), centerY - Math.floor(nodeHeight / 2), nodeWidth, nodeHeight);
  ctx.fillRect(centerX - 4, centerY - Math.floor(nodeHeight / 2) - 2, 8, nodeHeight + 4);
  if (branchNoise > 0.42) {
    const side = branchNoise > 0.7 ? 1 : -1;
    ctx.fillRect(centerX + side * 7 - 3, centerY + 4, 7, 4);
  }

  ctx.globalAlpha = revealed ? 0.72 : 0.07;
  ctx.fillStyle = ore.accent || '#fff';
  ctx.fillRect(centerX - 2, centerY - Math.floor(nodeHeight / 2), 3, Math.max(3, Math.floor(nodeHeight * 0.55)));
  ctx.fillRect(centerX - Math.floor(nodeWidth / 2) + 2, centerY - 2, Math.max(3, Math.floor(nodeWidth * 0.35)), 2);
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
  const pulse = (now * 0.0004 * (stats.sensePulseSpeed || 1)) % 1;
  const focusedOre = getFocusedOre();
  const baseSenseRadius = effectiveSenseRadius();
  const senseRadius = baseSenseRadius * focusedSenseMultiplier(focusedOre);
  const radius = senseRadius * (0.82 + pulse * 0.18);
  ctx.save();
  ctx.strokeStyle = focusedOre
    ? `${focusedOre.accent || focusedOre.color}${Math.round(clamp(0.12 + (1 - pulse) * 0.28 + state.ping * 0.2, 0, 1) * 255).toString(16).padStart(2, '0')}`
    : `rgba(104, 224, 193, ${0.08 + (1 - pulse) * 0.18 + state.ping * 0.22})`;
  ctx.lineWidth = 2;
  ctx.setLineDash([5, 10]);
  ctx.lineDashOffset = -now * 0.012;
  ctx.beginPath();
  ctx.arc(state.player.x, state.player.y, radius, 0, Math.PI * 2);
  ctx.stroke();
  if (focusedOre) {
    ctx.globalAlpha = 0.32;
    ctx.strokeStyle = '#68e0c1';
    ctx.setLineDash([2, 13]);
    ctx.beginPath();
    ctx.arc(state.player.x, state.player.y, baseSenseRadius, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  const glow = ctx.createRadialGradient(state.player.x, state.player.y, 8, state.player.x, state.player.y, senseRadius);
  glow.addColorStop(0, 'rgba(94,220,191,.035)');
  glow.addColorStop(0.75, 'rgba(94,220,191,.018)');
  glow.addColorStop(1, 'rgba(94,220,191,0)');
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
    ctx.strokeStyle = 'rgba(116, 244, 223, 0.7)';
    ctx.lineWidth = 1.5;
    for (const [key, expires] of state.triangleOreMemory) {
      if (expires < state.elapsed) continue;
      const [tx, ty] = key.split(':').map(Number);
      const x = tx * TILE_SIZE + 4;
      const y = ty * TILE_SIZE + 4;
      const size = TILE_SIZE - 8;
      ctx.globalAlpha = clamp((expires - state.elapsed) / Math.max(0.01, stats.triangularFixOreMemory), 0.18, 0.75);
      ctx.strokeRect(x, y, size, size);
    }
    ctx.restore();
  }
  const triangle = getTriangulationTriangle();
  if (triangle) {
    const pulse = 0.5 + Math.sin(now * 0.008) * 0.5;
    ctx.save();
    ctx.fillStyle = `rgba(91, 226, 211, ${0.055 + pulse * 0.035})`;
    ctx.strokeStyle = `rgba(117, 246, 226, ${0.45 + pulse * 0.22})`;
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 5]);
    ctx.lineDashOffset = -now * 0.012;
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
    ctx.fillStyle = '#8affea';
    ctx.font = '900 10px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('ТРИАНГУЛЯЦИЯ', centerX, centerY);
    ctx.restore();
  }
  if (!state.target) return;
  ctx.save();
  if (state.pathWaypoint) {
    ctx.strokeStyle = 'rgba(116, 228, 223, 0.55)';
    ctx.lineWidth = 2;
    ctx.setLineDash([7, 5]);
    ctx.beginPath();
    ctx.moveTo(state.player.x, state.player.y);
    ctx.lineTo(state.pathWaypoint.x, state.pathWaypoint.y);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  const exploring = state.target.kind === 'exploration';
  const alpha = 0.36 + Math.sin(now * 0.009) * 0.14;
  ctx.strokeStyle = exploring
    ? `rgba(104, 224, 193, ${alpha * 0.72})`
    : `rgba(255, 209, 112, ${alpha})`;
  ctx.lineWidth = 1.5;
  ctx.setLineDash(exploring ? [5, 9] : [2, 7]);
  ctx.beginPath();
  ctx.moveTo(state.player.x, state.player.y);
  ctx.lineTo(state.target.x, state.target.y);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.translate(state.target.x, state.target.y);
  ctx.rotate(now * 0.0015);
  ctx.strokeStyle = exploring ? '#68e0c1' : '#ffd170';
  ctx.globalAlpha = exploring ? 0.48 : 0.72;
  ctx.strokeRect(exploring ? -7 : -10, exploring ? -7 : -10, exploring ? 14 : 20, exploring ? 14 : 20);
  ctx.restore();

  if (oreTargetIsValid(state.backupTarget, getFocusedOre()?.id || null)) {
    ctx.save();
    ctx.strokeStyle = 'rgba(127, 233, 221, 0.62)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([3, 5]);
    ctx.beginPath();
    ctx.arc(state.backupTarget.x, state.backupTarget.y, 8 + Math.sin(now * 0.008) * 2, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  const beacon = getCrewBeacon();
  if (beacon) {
    ctx.save();
    ctx.translate(beacon.x, beacon.y);
    ctx.rotate(-now * 0.002);
    ctx.strokeStyle = '#ffc95e';
    ctx.fillStyle = 'rgba(255, 201, 94, 0.18)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, -15);
    ctx.lineTo(13, 0);
    ctx.lineTo(0, 15);
    ctx.lineTo(-13, 0);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
}

function drawBeams() {
  for (const beam of state.beams) {
    const alpha = clamp(beam.life / beam.maxLife, 0, 1);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = beam.color;
    ctx.shadowColor = beam.color;
    ctx.shadowBlur = 12;
    ctx.lineWidth = beam.width;
    ctx.beginPath();
    ctx.moveTo(beam.x, beam.y);
    ctx.lineTo(beam.x2, beam.y2);
    ctx.stroke();
    ctx.globalAlpha = Math.min(1, alpha * 1.5);
    ctx.strokeStyle = '#eaffff';
    ctx.lineWidth = Math.max(1, beam.width * 0.2);
    ctx.stroke();
    ctx.restore();
  }
  for (const shock of state.shocks) {
    const alpha = clamp(shock.life / Math.max(0.01, shock.maxLife), 0, 1);
    ctx.save();
    ctx.globalAlpha = alpha * 0.86;
    ctx.strokeStyle = shock.color || '#b58cff';
    ctx.lineWidth = shock.radius ? 4 : 2;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    const radius = shock.radius
      ? shock.radius * (0.35 + (1 - alpha) * 0.75)
      : 10 + (1 - alpha) * 13;
    ctx.arc(shock.x, shock.y, radius, 0, Math.PI * 2);
    ctx.stroke();
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
  const walk = Math.sin(now * 0.016) * player.moving;
  const bob = Math.abs(Math.sin(now * 0.016)) * player.moving * 1.1;

  // The lamp sits behind the silhouette, keeping the miner's colours crisp.
  ctx.save();
  const lampX = player.x + player.facing * 10;
  const lampY = player.y - 25 - bob;
  const lampGradient = ctx.createRadialGradient(lampX, lampY, 1, lampX, lampY, 105);
  lampGradient.addColorStop(0, 'rgba(255,220,132,.23)');
  lampGradient.addColorStop(0.35, 'rgba(255,205,105,.09)');
  lampGradient.addColorStop(1, 'rgba(255,205,105,0)');
  ctx.fillStyle = lampGradient;
  ctx.beginPath();
  ctx.arc(lampX, lampY, 105, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.translate(player.x, player.y);
  ctx.globalAlpha = 0.35;
  ctx.fillStyle = '#03090e';
  ctx.beginPath();
  ctx.ellipse(0, 20, 21, 6, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.translate(player.x, player.y - bob);
  ctx.scale(player.facing, 1);
  ctx.lineJoin = 'bevel';
  ctx.lineCap = 'square';
  const outline = '#071119';

  // Reinforced backpack, battery cylinder and antenna.
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

  drawTool();
}

function drawTool() {
  const player = state.player;
  const swingOffset = Math.sin(player.swing * Math.PI) * -0.72;
  const angle = player.angle + swingOffset * player.facing;
  ctx.save();
  ctx.translate(player.x, player.y - 1);
  ctx.rotate(angle);
  if (stats.laserUnlocked) {
    ctx.fillStyle = '#1b3945';
    ctx.strokeStyle = '#07131b';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, -5);
    ctx.lineTo(27, -4);
    ctx.lineTo(34, 0);
    ctx.lineTo(27, 5);
    ctx.lineTo(0, 5);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#6df2d9';
    ctx.fillRect(12, -2, 16, 4);
    ctx.fillStyle = '#dcffff';
    ctx.fillRect(29, -1, 7, 2);
  } else {
    const tier = stats.toolTier || 1;
    ctx.strokeStyle = stats.superPickUnlocked ? '#ddb660' : tier >= 3 ? '#9bb9bb' : '#875d3d';
    ctx.lineWidth = stats.superPickUnlocked ? 5 : 3.5 + Math.min(1.5, tier * 0.2);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(2, 0);
    ctx.lineTo(30, 0);
    ctx.stroke();
    ctx.strokeStyle = stats.superPickUnlocked ? '#9ff2df' : '#b8c3c4';
    ctx.lineWidth = stats.superPickUnlocked ? 6 : 5;
    ctx.beginPath();
    ctx.arc(29, 0, 11, -1.3, 1.3);
    ctx.stroke();
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
    ctx.fillRect(particle.x - particle.size / 2, particle.y - particle.size / 2, particle.size, particle.size);
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
    if (button) {
      buyUpgrade(button.dataset.buyUpgrade);
      return;
    }
    const node = event.target.closest('[data-upgrade-id]');
    if (node && state.visibleUpgradeIds.has(node.dataset.upgradeId)) {
      state.selectedUpgradeId = node.dataset.upgradeId;
      renderUpgrades();
    }
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
        state.selectedUpgradeId = laneNodes.find(upgradeIsAvailable)?.id || laneNodes[0]?.id || state.selectedUpgradeId;
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
    toast('ПРОТОКОЛ ОЧИЩЕН', 'warning');
  });

  const guideToggle = $('#guideToggle');
  guideToggle?.addEventListener('click', () => {
    const guide = $('#fieldGuide');
    const collapsed = guide?.classList.toggle('is-collapsed');
    guideToggle.setAttribute('aria-expanded', String(!collapsed));
  });

  addEventListener('keydown', (event) => {
    // Space is intentionally unbound. Prevent its native button activation so
    // the former shortcut cannot survive through whichever control has focus.
    if (event.code === 'Space') {
      event.preventDefault();
      return;
    }
    if (trapOverlayFocus(event)) return;
    const tag = document.activeElement?.tagName;
    const interactive = ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'A', 'SUMMARY'].includes(tag)
      || Boolean(document.activeElement?.isContentEditable);
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
      guideToggle?.click();
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
    laserShotCount: state.laserShotCount,
    deafKnockCooldown: state.deafKnockCooldown,
    deafKnockBoostRemaining: state.deafKnockBoostRemaining,
    eventYieldBoostRemaining: state.eventYieldBoostRemaining,
    eventMoveBoostRemaining: state.eventMoveBoostRemaining,
    eventDigBoostRemaining: state.eventDigBoostRemaining,
    eventSoftRockRemaining: state.eventSoftRockRemaining,
    triangleActive: Boolean(getTriangulationTriangle()),
    triangleRememberedOre: [...(state.triangleOreMemory || new Map())]
      .filter(([, expires]) => expires >= state.elapsed)
      .map(([key]) => key),
    tutorialSeen: { ...(save.tutorialSeen || {}) },
    oreRecords: { ...(save.oreRecords || {}) },
    lastRunReport: save.lastRunReport ? { ...save.lastRunReport } : null,
    balanceReport: state.balanceReport ? { ...state.balanceReport } : null,
  }),
  getStats: () => ({
    runDuration: stats.runDuration,
    bonusRunDurationCap: stats.bonusRunDurationCap,
    pickPower: stats.pickPower,
    digReach: stats.digReach,
    backupTargetSlots: stats.backupTargetSlots,
    oreFocusEscalationBonus: stats.oreFocusEscalationBonus,
    leastResistancePathing: stats.leastResistancePathing,
    mineLiftRecordDepthRatio: stats.mineLiftRecordDepthRatio,
    focusedOreHardnessReduction: stats.focusedOreHardnessReduction,
    discoveryTimeBonus: stats.discoveryTimeBonus,
    directionalBombConeTiles: stats.directionalBombConeTiles,
    crewBeaconUnlocked: stats.crewBeaconUnlocked,
    laserRicochetCount: stats.laserRicochetCount,
    oreDiversityBonusPerType: stats.oreDiversityBonusPerType,
    deafKnockStoneThreshold: stats.deafKnockStoneThreshold,
    deafKnockSenseRadiusMultiplier: stats.deafKnockSenseRadiusMultiplier,
    deafKnockMoveSpeedBonus: stats.deafKnockMoveSpeedBonus,
    deafKnockMoveDuration: stats.deafKnockMoveDuration,
    deafKnockCooldown: stats.deafKnockCooldown,
    triangularFixUnlocked: stats.triangularFixUnlocked,
    triangularFixGadgetDamageBonus: stats.triangularFixGadgetDamageBonus,
    triangularFixRangeBonus: stats.triangularFixRangeBonus,
    laserSuperPickEchoEvery: stats.laserSuperPickEchoEvery,
    laserSuperPickEchoRadiusTiles: stats.laserSuperPickEchoRadiusTiles,
    laserSuperPickEchoPower: stats.laserSuperPickEchoPower,
  }),
  getUpgradeCatalog: () => UPGRADE_DEFS.map((definition) => {
    const level = getUpgradeLevel(definition);
    const recipe = level < definition.maxLevel ? getUpgradeRecipe(definition, level) : {};
    return {
      id: definition.id,
      category: definition.category,
      maxLevel: definition.maxLevel,
      level,
      requires: (definition.requires || []).map((requirement) => ({
        id: typeof requirement === 'string' ? requirement : requirement.id,
        level: typeof requirement === 'string' ? 1 : (requirement.level || 1),
      })),
      available: requirementsMet(definition) && level < definition.maxLevel,
      affordable: level < definition.maxLevel && canAffordRecipe(save.inventory, recipe),
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
    stats = normalizeStats(calculateMetaStats(save.levels));
    persistSave();
    updatePersistentLabels();
    if (state.mode === 'upgrades') renderUpgrades();
    return true;
  },
  setAllUpgrades: (enabled = true) => {
    for (const definition of UPGRADE_DEFS) save.levels[definition.id] = enabled ? definition.maxLevel : 0;
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
  forceDetonate: () => {
    if (state.mode !== 'run' || !state.player) return false;
    const angle = state.player.angle || 0;
    detonate(state.player.x, state.player.y, Math.cos(angle), Math.sin(angle));
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
    for (const key of ['kind', 'oreId', 'veinId', 'hp', 'maxHp', 'discovered', 'cracked']) {
      if (Object.prototype.hasOwnProperty.call(patch, key)) tile[key] = patch[key];
    }
    if (typeof state.world._rebuildOreIndex === 'function') state.world._rebuildOreIndex();
    return { ...tile };
  },
  debugGetTile: (tx, ty) => {
    const tile = state.world?.getTile(Math.floor(tx), Math.floor(ty));
    return tile ? { ...tile } : null;
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
      selectedUpgradeId: null,
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
          if (level >= definition.maxLevel || !requirementsMet(definition)) return false;
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
          const corePriority = definition.id === 'core_first_descent' ? -1_000_000 : 0;
          const finalPriority = definition.id === CAMPAIGN.finalUpgrade ? -100_000 : 0;
          return { definition, level, recipe, score: weightedCost + depth * 4 + categoryLoad * 0.6 + corePriority + finalPriority };
        })
        .sort((left, right) => left.score - right.score || UPGRADE_DEFS.indexOf(left.definition) - UPGRADE_DEFS.indexOf(right.definition));
      const candidate = candidates[0];
      if (!candidate || !spendRecipe(save.inventory, candidate.recipe)) break;
      save.levels[candidate.definition.id] = candidate.level + 1;
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
