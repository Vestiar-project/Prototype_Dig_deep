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
const formatDuration = (seconds) => {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};

const TILE_SIZE = WORLD_CONFIG.TILE_SIZE || 28;
const MIN_RUN_SECONDS = 6;
const MAX_RUN_SECONDS = 45;
const EXPLORATION_SCAN_TILES = 18;
const STORAGE_KEY = 'depth-zero-save-v1';
const CAMPAIGN = Object.freeze({
  requiredLevels: 120,
  requiredLifetimeChunks: 4_000,
  requiredActiveSeconds: 5_400,
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
  version: 5,
  inventory: createOreBag(),
  lifetimeOres: createOreBag(),
  lifetimeChunks: 0,
  levels: {},
  runs: 0,
  activeMiningSeconds: 0,
  bestHaul: 0,
  bestDepth: 0,
  focusedOreId: null,
  sound: true,
  endingSeen: false,
  campaignComplete: false,
});

function createDefaultSave() {
  return {
    ...DEFAULT_SAVE,
    inventory: createOreBag(),
    lifetimeOres: createOreBag(),
    levels: {},
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

function loadSave() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (!stored || typeof stored !== 'object') return createDefaultSave();
    const levels = stored.levels && typeof stored.levels === 'object' ? { ...stored.levels } : {};
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
      inventory,
      lifetimeOres,
      lifetimeChunks: migratedLifetimeChunks,
      levels,
      focusedOreId: ORE_TYPES.some((ore) => ore.id === stored.focusedOreId) ? stored.focusedOreId : null,
    };
    delete merged.currency;
    delete merged.lifetimeOre;
    if (!Number.isFinite(Number(stored.activeMiningSeconds))) {
      const runs = Math.max(0, Number(stored.runs) || 0);
      const currentDuration = clamp(
        Number(calculateMetaStats(levels).runDuration) || MIN_RUN_SECONDS,
        MIN_RUN_SECONDS,
        MAX_RUN_SECONDS,
      );
      merged.activeMiningSeconds = stored.campaignComplete
        ? CAMPAIGN.requiredActiveSeconds
        : Math.min(CAMPAIGN.requiredActiveSeconds, runs * currentDuration * 0.65);
    }
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
    runDuration: clamp(source.runDuration ?? MIN_RUN_SECONDS, MIN_RUN_SECONDS, MAX_RUN_SECONDS),
    maxRunDuration: MAX_RUN_SECONDS,
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
  };
}

function getCampaignProgress() {
  const purchasedLevels = countPurchasedLevels(save.levels);
  const completedCapstones = CAMPAIGN.capstones.filter((id) => (save.levels[id] || 0) >= 1).length;
  const finalInstalled = (save.levels[CAMPAIGN.finalUpgrade] || 0) >= 1;
  const activeMiningSeconds = Math.max(0, Number(save.activeMiningSeconds) || 0);
  const capstoneFraction = completedCapstones / CAMPAIGN.capstones.length;
  const finalFraction = finalInstalled ? 1 : 0;
  const levelFraction = clamp(purchasedLevels / CAMPAIGN.requiredLevels, 0, 1);
  const oreFraction = clamp(save.lifetimeChunks / CAMPAIGN.requiredLifetimeChunks, 0, 1);
  const activeTimeFraction = clamp(activeMiningSeconds / CAMPAIGN.requiredActiveSeconds, 0, 1);
  const ready = Boolean(save.campaignComplete) || (
    finalInstalled
    && completedCapstones === CAMPAIGN.capstones.length
    && purchasedLevels >= CAMPAIGN.requiredLevels
    && save.lifetimeChunks >= CAMPAIGN.requiredLifetimeChunks
    && activeMiningSeconds >= CAMPAIGN.requiredActiveSeconds
  );

  return {
    ready,
    percent: ready ? 100 : Math.min(99, Math.floor((
      finalFraction * 0.2
      + capstoneFraction * 0.3
      + levelFraction * 0.18
      + oreFraction * 0.16
      + activeTimeFraction * 0.16
    ) * 100)),
    finalInstalled,
    completedCapstones,
    totalCapstones: CAMPAIGN.capstones.length,
    purchasedLevels,
    requiredLevels: CAMPAIGN.requiredLevels,
    lifetimeChunks: save.lifetimeChunks,
    requiredLifetimeChunks: CAMPAIGN.requiredLifetimeChunks,
    activeMiningSeconds,
    requiredActiveSeconds: CAMPAIGN.requiredActiveSeconds,
  };
}

const oreById = new Map(ORE_TYPES.map((ore) => [ore.id, ore]));
const upgradeById = new Map(UPGRADE_DEFS.map((definition) => [definition.id, definition]));
const UPGRADE_LANES = Object.freeze(['time', 'dig', 'tools', 'power', 'fortune', 'gadgets', 'sense']);
const UPGRADE_NODE_WIDTH = 62;
const UPGRADE_NODE_HEIGHT = 62;
const UPGRADE_NODE_STEP_X = 118;
const UPGRADE_NODE_STEP_Y = 72;
const UPGRADE_ROOT_X = 46;
let upgradeLayoutCache = null;
const ui = {
  startScreen: $('#startScreen'),
  startRun: $('#startRun'),
  runHud: $('#runHud'),
  timerValue: $('#timerValue'),
  timerFill: $('#timerFill'),
  runOre: $('#runOre'),
  depthValue: $('#depthValue'),
  toolValue: $('#toolValue'),
  comboValue: $('#comboValue'),
  resultScreen: $('#resultScreen'),
  resultTitle: $('#resultTitle'),
  resultStats: $('#resultStats'),
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
};

const state = {
  mode: 'title',
  returnMode: 'title',
  world: null,
  player: null,
  spawn: null,
  target: null,
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
  targetCooldown: 0,
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

function newWorld(seed = (Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0) {
  state.seed = seed;
  state.world = new MineWorld(ORE_TYPES, seed);
  const spawn = state.world.getSpawn();
  state.spawn = {
    ...spawn,
    x: spawn.x ?? (spawn.tx + 0.5) * TILE_SIZE,
    y: spawn.y ?? (spawn.ty + 0.5) * TILE_SIZE,
  };
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

function startRun() {
  sound.unlock();
  stats = normalizeStats(calculateMetaStats(save.levels));
  newWorld();
  Object.assign(state, {
    mode: 'run',
    target: null,
    timeLeft: stats.runDuration,
    elapsed: 0,
    runOre: 0,
    oreCounts: createOreBag(),
    yieldRemainders: {},
    blocksBroken: 0,
    deepest: 0,
    combo: 0,
    comboExpires: 0,
    attackCooldown: 0,
    targetCooldown: 0,
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
  });
  state.particles.length = 0;
  state.floaters.length = 0;
  state.beams.length = 0;
  state.shocks.length = 0;
  hideAllScreens();
  ui.runHud?.classList.remove('hidden');
  $('#fieldGuide')?.classList.remove('hidden');
  updateHud();
  toast('ЧУТЬЁ АКТИВНО — ИЩЕМ ЖИЛУ', 'info');
  sound.tone(145, 0.16, 'triangle', 0.04, 180);
}

function finishRun() {
  if (state.mode !== 'run') return;
  state.mode = 'result';
  ui.runHud?.classList.add('hidden');
  updateFocusHud();
  const activeRunSeconds = clamp(state.activeWallElapsed, 0, MAX_RUN_SECONDS);
  const haul = sanitizeOreBag(state.oreCounts);
  const haulCount = countOreBag(haul);
  state.lastHaul = haul;
  state.lastHaulCount = haulCount;
  addOreBag(save.inventory, haul);
  addOreBag(save.lifetimeOres, haul);
  save.runs += 1;
  save.lifetimeChunks += haulCount;
  save.activeMiningSeconds = Math.max(0, Number(save.activeMiningSeconds) || 0) + activeRunSeconds;
  save.bestHaul = Math.max(save.bestHaul, haulCount);
  save.bestDepth = Math.max(save.bestDepth, Math.floor(state.deepest));
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
      <div><span>Удаление</span><strong>${Math.floor(state.deepest)} м</strong></div>
      <div><span>Лучшая находка</span><strong>${rareText}</strong></div>
      <div><span>Состав груза</span><strong>${haulText}</strong></div>
      <div><span>Стаж экспедиции</span><strong>${formatDuration(save.activeMiningSeconds)} / ${formatDuration(CAMPAIGN.requiredActiveSeconds)}</strong></div>`;
  }
  if (ui.bankedOre) ui.bankedOre.textContent = `+${formatNumber(haulCount)}`;
  ui.resultScreen?.classList.remove('hidden');
  $('#fieldGuide')?.classList.add('hidden');
  updatePersistentLabels();
  sound.tone(220, 0.15, 'triangle', 0.04, -80);
}

function refreshCampaignUI() {
  const progress = getCampaignProgress();
  if (ui.campaignStatus) {
    const activeMinutes = Math.floor(progress.activeMiningSeconds / 60);
    const requiredMinutes = Math.ceil(progress.requiredActiveSeconds / 60);
    ui.campaignStatus.textContent = progress.ready
      ? (save.endingSeen ? 'ФИНАЛ ОТКРЫТ' : 'РАКЕТА ГОТОВА')
      : `РАКЕТА · ${progress.percent}% · ${activeMinutes}/${requiredMinutes} МИН`;
    ui.campaignStatus.title = `Верхушки веток ${progress.completedCapstones}/${progress.totalCapstones} · «В добрый путь» ${progress.finalInstalled ? 'установлен' : 'не установлен'} · уровни ${progress.purchasedLevels}/${progress.requiredLevels} · добыто ${formatNumber(progress.lifetimeChunks)}/${formatNumber(progress.requiredLifetimeChunks)} кусков · активная добыча ${activeMinutes}/${requiredMinutes} мин`;
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
}

function showTitle() {
  state.mode = 'title';
  hideAllScreens();
  ui.runHud?.classList.add('hidden');
  ui.startScreen?.classList.remove('hidden');
  updatePersistentLabels();
}

function openUpgradeScreen() {
  if (state.mode === 'run') return;
  state.returnMode = state.mode === 'result' ? 'result' : 'title';
  state.mode = 'upgrades';
  ui.startScreen?.classList.add('hidden');
  ui.resultScreen?.classList.add('hidden');
  ui.upgradeScreen?.classList.remove('hidden');
  renderUpgrades();
  requestAnimationFrame(() => {
    const selected = state.selectedUpgradeId ? upgradeById.get(state.selectedUpgradeId) : null;
    scrollUpgradeIntoView(selected, false);
  });
}

function closeUpgradeScreen() {
  ui.upgradeScreen?.classList.add('hidden');
  if (state.returnMode === 'result') {
    state.mode = 'result';
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
  if (ui.focusHudName) ui.focusHudName.textContent = focused ? `${focused.name.toUpperCase()} · ×${Number(stats.oreFocusRadiusMultiplier || 1).toFixed(2)}` : '—';
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
  return (definition.requires || []).every((requirement) => {
    const id = typeof requirement === 'string' ? requirement : requirement.id;
    const level = typeof requirement === 'string' ? 1 : (requirement.level || 1);
    return (save.levels[id] || 0) >= level;
  });
}

function buyUpgrade(id) {
  const definition = upgradeById.get(id);
  if (!definition) return;
  const campaignWasReady = getCampaignProgress().ready;
  const level = getUpgradeLevel(definition);
  if (!requirementsMet(definition)) {
    toast('СНАЧАЛА ОТКРОЙТЕ ПРЕДЫДУЩИЙ УЗЕЛ', 'warning');
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
  return (definition.requires || []).map((requirement) => {
    const id = typeof requirement === 'string' ? requirement : requirement.id;
    const level = typeof requirement === 'string' ? 1 : (requirement.level || 1);
    const parent = UPGRADE_DEFS.find((item) => item.id === id);
    return `${parent?.name || id}${level > 1 ? ` ${level}` : ''}`;
  }).join(', ');
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

  const branchDefinitions = UPGRADE_DEFS.filter((definition) => UPGRADE_LANES.includes(definition.category));
  const bucketByLaneDepth = new Map();
  for (const definition of branchDefinitions) {
    const key = `${definition.category}:${depthById.get(definition.id) || 0}`;
    if (!bucketByLaneDepth.has(key)) bucketByLaneDepth.set(key, []);
    bucketByLaneDepth.get(key).push(definition);
  }
  const laneHeights = new Map();
  for (const lane of UPGRADE_LANES) {
    const maxBucket = Math.max(1, ...[...bucketByLaneDepth.entries()]
      .filter(([key]) => key.startsWith(`${lane}:`))
      .map(([, definitions]) => definitions.length));
    laneHeights.set(lane, Math.max(116, 44 + maxBucket * UPGRADE_NODE_STEP_Y));
  }
  const laneY = new Map();
  let cursorY = 20;
  for (const lane of UPGRADE_LANES) {
    laneY.set(lane, cursorY);
    cursorY += laneHeights.get(lane);
  }
  const positions = new Map();
  let maxDepth = 0;
  for (const [key, definitions] of bucketByLaneDepth) {
    const [lane, depthText] = key.split(':');
    const depth = Number(depthText);
    maxDepth = Math.max(maxDepth, depth);
    definitions.sort((a, b) => UPGRADE_DEFS.indexOf(a) - UPGRADE_DEFS.indexOf(b));
    definitions.forEach((definition, index) => {
      positions.set(definition.id, {
        x: UPGRADE_ROOT_X + depth * UPGRADE_NODE_STEP_X,
        y: laneY.get(lane) + 40 + index * UPGRADE_NODE_STEP_Y,
      });
    });
  }
  const height = cursorY + 20;
  for (const definition of UPGRADE_DEFS.filter((item) => item.category === 'core')) {
    const depth = depthById.get(definition.id) || 0;
    maxDepth = Math.max(maxDepth, depth);
    const nodeHeight = definition.id === CAMPAIGN.finalUpgrade ? 68 : UPGRADE_NODE_HEIGHT;
    positions.set(definition.id, {
      x: UPGRADE_ROOT_X + depth * UPGRADE_NODE_STEP_X,
      y: Math.round((height - nodeHeight) * 0.5),
    });
  }
  upgradeLayoutCache = {
    positions,
    depthById,
    laneY,
    laneHeights,
    width: UPGRADE_ROOT_X + maxDepth * UPGRADE_NODE_STEP_X + 180,
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
  const farthestVisibleEdge = Math.max(...visible.map((definition) => {
    const position = layout.positions.get(definition.id);
    return position.x + getUpgradeNodeSize(definition).width;
  }), UPGRADE_ROOT_X + UPGRADE_NODE_WIDTH);
  const mapWidth = Math.max(
    ui.upgradeViewport?.clientWidth || 0,
    Math.min(layout.width, farthestVisibleEdge + 130),
  );
  ui.upgradeWorld.style.setProperty('--map-width', `${mapWidth}px`);
  ui.upgradeWorld.style.setProperty('--map-height', `${layout.height}px`);

  const laneFragment = document.createDocumentFragment();
  for (const lane of UPGRADE_LANES) {
    const element = document.createElement('div');
    element.className = 'upgrade-lane';
    element.dataset.category = lane;
    element.style.setProperty('--lane-y', `${layout.laneY.get(lane)}px`);
    element.style.setProperty('--lane-height', `${layout.laneHeights.get(lane)}px`);
    element.innerHTML = `<span class="upgrade-lane__label">${categoryLabel(lane)}</span>`;
    laneFragment.append(element);
  }
  ui.upgradeLanes?.replaceChildren(laneFragment);

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
    const categoryMatch = state.upgradeFilter === 'all' || definition.category === state.upgradeFilter;
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
    if (position.x + 340 > mapWidth) node.dataset.tooltipSide = 'left';
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
      const x1 = parentPosition.x + parentSize.width;
      const y1 = parentPosition.y + parentSize.height * 0.5;
      const x2 = childPosition.x;
      const y2 = childPosition.y + childSize.height * 0.5;
      const bend = Math.max(35, (x2 - x1) * 0.45);
      path.setAttribute('d', `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`);
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
  const left = Math.max(0, position.x - Math.max(28, ui.upgradeViewport.clientWidth * 0.22));
  const top = Math.max(0, position.y - Math.max(28, ui.upgradeViewport.clientHeight * 0.28));
  if (typeof ui.upgradeViewport.scrollTo === 'function') {
    ui.upgradeViewport.scrollTo({ left, top, behavior: smooth ? 'smooth' : 'auto' });
  } else {
    ui.upgradeViewport.scrollLeft = left;
    ui.upgradeViewport.scrollTop = top;
  }
}

function updateHud() {
  const duration = Math.max(0.01, stats.runDuration);
  const displayedTime = Math.max(0, Math.min(state.timeLeft, MAX_RUN_SECONDS - state.activeWallElapsed));
  if (ui.timerValue) ui.timerValue.textContent = displayedTime.toFixed(1);
  if (ui.timerFill) {
    const fraction = clamp(displayedTime / duration, 0, 1);
    ui.timerFill.style.transform = `scaleX(${fraction})`;
    ui.timerFill.classList.toggle('is-danger', fraction < 0.28);
  }
  const timerTrack = ui.timerFill?.parentElement;
  timerTrack?.setAttribute('aria-valuemax', String(duration));
  timerTrack?.setAttribute('aria-valuenow', displayedTime.toFixed(1));
  if (ui.runOre) ui.runOre.textContent = formatNumber(state.runOre);
  if (ui.depthValue) ui.depthValue.textContent = `${Math.floor(state.deepest)} м`;
  if (ui.toolValue) {
    const toolNames = {
      pickaxe: 'КИРКА',
      ironPick: 'ЖЕЛЕЗНАЯ',
      steelPick: 'СТАЛЬНАЯ',
      pneumaticPick: 'ПНЕВМОКИРКА',
      superPick: 'СУПЕРКИРКА',
      miningLaser: 'ЛАЗЕР',
      prismaticLaser: 'ПРИЗМОЛАЗЕР',
    };
    ui.toolValue.textContent = toolNames[stats.tool] || (stats.laserUnlocked ? 'ЛАЗЕР' : 'КИРКА');
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
  if (!state.player || !state.spawn) return stats.senseRadius;
  const worldProgress = clamp(
    (Math.abs(state.player.x - state.spawn.x) * 0.35 + Math.max(0, state.player.y - state.spawn.y))
      / (WORLD_CONFIG.HEIGHT * TILE_SIZE),
    0,
    1,
  );
  const deepBoost = 1 + (stats.deepOreSenseBonus || 0) * worldProgress;
  return stats.senseRadius * deepBoost;
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

function findBestOreTarget(x, y, radius, focusedOreId = null) {
  const bias = Math.max(0, stats.targetValueBias || 0);
  const center = state.world.worldToTile(x, y);
  const reach = Math.ceil(radius / TILE_SIZE);
  const radiusSquared = radius * radius;
  let best = null;
  let bestScore = Infinity;
  for (let ty = Math.max(0, center.ty - reach); ty <= Math.min(WORLD_CONFIG.HEIGHT - 1, center.ty + reach); ty += 1) {
    for (let tx = Math.max(0, center.tx - reach); tx <= Math.min(WORLD_CONFIG.WIDTH - 1, center.tx + reach); tx += 1) {
      const tile = state.world.getTile(tx, ty);
      if (!tile?.oreId || tile.kind === 'air') continue;
      if (focusedOreId && tile.oreId !== focusedOreId) continue;
      const targetX = (tx + 0.5) * TILE_SIZE;
      const targetY = (ty + 0.5) * TILE_SIZE;
      const dx = targetX - x;
      const dy = targetY - y;
      const distanceSquared = dx * dx + dy * dy;
      if (distanceSquared > radiusSquared) continue;
      if (!hasSenseLine(x, y, targetX, targetY, focusedOreId ? 7 : 2)) continue;
      const ore = oreById.get(tile.oreId);
      const valueWeight = 1 + Math.log2(1 + (ore?.value || 1)) * bias;
      const travelSeconds = Math.sqrt(distanceSquared) / Math.max(1, stats.moveSpeed * (stats.mineMoveMultiplier || 1));
      const expectedCritical = 1 + procChance(stats.critChance, 0.16) * Math.max(0, stats.critMultiplier - 1);
      const expectedMulti = 1 + Math.max(0, (stats.multiHitCount || 1) - 1) * 0.65 + procChance(stats.multiHitChance, 0.1) * 0.65;
      const rarePower = 1 + (oreRank(ore) >= 4 ? (stats.rareOreDamageBonus || 0) : 0);
      const laserPower = stats.laserUnlocked ? (stats.laserPower || 1) * (1 + Math.max(0, (stats.laserBeams || 1) - 1) * 0.55) : 1;
      const effectivePower = stats.pickPower * (1 + (stats.hardnessPierce || 0) * 0.07) * (1 + (stats.oreDamageBonus || 0)) * expectedCritical * expectedMulti * rarePower * laserPower;
      const miningSeconds = (tile.hp || 1) / Math.max(0.1, effectivePower * stats.digSpeed);
      const score = (travelSeconds + miningSeconds) / valueWeight;
      if (score < bestScore) {
        bestScore = score;
        best = { kind: 'ore', tile, tx, ty, x: targetX, y: targetY, distance: Math.sqrt(distanceSquared) };
      }
    }
  }
  return best;
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

function resolveBrokenTile(tile, tx, ty, source = 'pick') {
  state.blocksBroken += 1;
  const x = (tx + 0.5) * TILE_SIZE;
  const y = (ty + 0.5) * TILE_SIZE;
  const ore = tile?.oreId ? oreById.get(tile.oreId) : null;
  spawnDebris(x, y, ore?.color || (tile?.kind === 'dirt' ? '#74523d' : '#626779'), ore ? 8 : 4);
  if (source !== 'shatter' && (stats.breakSplashChance || 0) > 0 && Math.random() < procChance(stats.breakSplashChance, 0.12)) {
    state.world.damageCircle(x, y, Math.max(TILE_SIZE, stats.splashRadius || TILE_SIZE), stats.pickPower * (stats.breakSplashPower || 0.25), (nearTile, nearTx, nearTy) => resolveBrokenTile(nearTile, nearTx, nearTy, 'shatter'));
  }
  if (!ore) return;

  const now = state.elapsed;
  state.combo = now <= state.comboExpires ? state.combo + 1 : 1;
  state.comboExpires = now + stats.comboWindow;
  let yieldCount = 1;
  const bonusChance = procChance(stats.extraYieldChance, 0.24);
  if (Math.random() < bonusChance) yieldCount += 1;
  if (Math.random() < procChance(stats.doubleDropChance, 0.18)) yieldCount *= 2;
  if (Math.random() < procChance(stats.tripleDropChance, 0.12)) yieldCount *= 3;
  if (Math.random() < procChance(stats.richVeinChance, 0.18)) yieldCount *= 2;
  const motherlode = Math.random() < procChance(stats.motherlodeChance, 0.08);
  if (motherlode) {
    yieldCount *= 5;
    if (state.elapsed - state.lastBigToast > 1.2) {
      state.lastBigToast = state.elapsed;
      toast('МАТЕРИНСКАЯ ЖИЛА!', 'success');
      flash('#ffe08b', 0.32);
    }
  }

  let rewardOre = ore;
  if (Math.random() < procChance(stats.rareOreChance, 0.2)) {
    rewardOre = ORE_TYPES[Math.min(ORE_TYPES.length - 1, oreRank(ore) + 1)] || ore;
  }
  let golden = false;
  if (Math.random() < procChance(stats.goldenOreChance, 0.12)) {
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
  const exactYield = Math.max(1, yieldCount * stats.oreValueMultiplier * comboBonus * gemBonus * depthBonus * conversionBonus * sourceBonus * goldenBonus * pickupBonus);
  const remainder = Math.max(0, Number(state.yieldRemainders[rewardOre.id]) || 0);
  yieldCount = Math.floor(exactYield + remainder);
  state.yieldRemainders[rewardOre.id] = exactYield + remainder - yieldCount;
  if ((stats.timeRefundChance || 0) > 0 && Math.random() < procChance(stats.timeRefundChance, 0.1)) {
    state.timeLeft = Math.min(stats.runDuration, state.timeLeft + (stats.timeRefundAmount || 0));
    state.floaters.push({ x, y: y - 28, text: `+${(stats.timeRefundAmount || 0).toFixed(1)}с`, color: '#74e4df', life: 0.85, maxLife: 0.85 });
  }
  if ((stats.timeShardChance || 0) > 0 && Math.random() < procChance(stats.timeShardChance, 0.08)) {
    state.timeLeft = Math.min(stats.runDuration, state.timeLeft + (stats.timeShardSeconds || 0));
    state.floaters.push({ x: x + 10, y: y - 35, text: `ХРОНО +${(stats.timeShardSeconds || 0).toFixed(1)}с`, color: '#8cecff', life: 1, maxLife: 1 });
  }
  const relicChance = procChance((stats.relicChance || 0) * (1 + Math.max(0, (stats.pickupRadius || 46) - 46) / 300), 0.08);
  if (relicChance > 0 && Math.random() < relicChance) {
    const relicPieces = 1 + Math.floor(state.deepest / 45);
    yieldCount += relicPieces;
    state.floaters.push({ x: x - 8, y: y - 42, text: `РЕЛИКТ +${relicPieces}`, color: '#ff9fe3', life: 1.15, maxLife: 1.15 });
  }
  state.runOre += yieldCount;
  state.oreCounts[rewardOre.id] = (state.oreCounts[rewardOre.id] || 0) + yieldCount;
  if ((stats.veinRevealChance || 0) > 0 && Math.random() < procChance(stats.veinRevealChance, 0.08)) revealVein(tx, ty, ore.id);
  state.floaters.push({ x, y: y - 10, text: `+${yieldCount} ${rewardOre.name.toUpperCase()}`, color: golden ? '#ffe477' : (rewardOre.accent || rewardOre.color), life: 1, maxLife: 1 });
  state.shake = Math.max(state.shake, source === 'bomb' ? 9 : 3.5);
  sound.ore(ore);
  if ((ore.tier || 0) >= 5) flash(ore.color, 0.12);
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

function attack() {
  if (!state.target || !state.player || !state.world) return;
  const player = state.player;
  const dx = state.target.x - player.x;
  const dy = state.target.y - player.y;
  const length = Math.max(0.001, Math.hypot(dx, dy));
  const nx = dx / length;
  const ny = dy / length;
  player.facing = nx < 0 ? -1 : 1;
  player.angle = Math.atan2(ny, nx);
  player.swing = 1;

  state.attackCount += 1;
  const targetKey = `${state.target.tx}:${state.target.ty}`;
  state.hitStreak = state.lastTargetKey === targetKey ? state.hitStreak + 1 : 1;
  state.lastTargetKey = targetKey;
  const targetOre = oreById.get(state.target.tile?.oreId);
  const streakBonus = 1 + Math.min(state.hitStreak, stats.streakCap || 0) * (stats.streakPower || 0);
  const densityBonus = 1 + (stats.hardnessPierce || 0) * 0.07;
  const oreBonus = 1 + (targetOre ? (stats.oreDamageBonus || 0) : 0);
  const rareBonus = 1 + (oreRank(targetOre) >= 4 ? (stats.rareOreDamageBonus || 0) : 0);
  const charged = (stats.chargedHitPower || 0) > 0 && state.attackCount % 8 === 0;
  const chargedBonus = charged ? 1 + stats.chargedHitPower : 1;
  const critical = Math.random() < procChance(stats.critChance, 0.16);
  const damage = stats.pickPower * streakBonus * densityBonus * oreBonus * rareBonus * chargedBonus * (critical ? stats.critMultiplier : 1);
  const broken = [];
  const onBreak = (tile, tx, ty) => {
    broken.push({ tile, tx, ty });
    resolveBrokenTile(tile, tx, ty, stats.laserUnlocked ? 'laser' : 'pick');
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
      state.world.damageRay(player.x, player.y, beamX, beamY, stats.laserRange, beamDamage, stats.laserWidth, onBreak);
      state.beams.push({ x: player.x, y: player.y, x2: player.x + beamX * stats.laserRange, y2: player.y + beamY * stats.laserRange, color: '#69f4da', life: 0.12, maxLife: 0.12, width: stats.laserWidth });
    }
    sound.tone(420, 0.07, 'sawtooth', 0.025, 360);
  } else {
    const reach = Math.min(stats.digReach, Math.max(TILE_SIZE * 0.72, length));
    let hitX = player.x + nx * reach;
    let hitY = player.y + ny * reach;
    let impactTile = null;
    for (let probeDistance = 7; probeDistance <= reach + TILE_SIZE * 0.35; probeDistance += 5) {
      const probe = state.world.worldToTile(player.x + nx * probeDistance, player.y + ny * probeDistance);
      const tile = state.world.getTile(probe.tx, probe.ty);
      if (tile && tile.kind !== 'air' && tile.kind !== 'bedrock') {
        impactTile = probe;
        hitX = (probe.tx + 0.5) * TILE_SIZE;
        hitY = (probe.ty + 0.5) * TILE_SIZE;
        break;
      }
    }
    const arcBonus = clamp((stats.digArc - Math.PI / 3) / Math.PI, 0, 0.7);
    if (impactTile) {
      if (stats.areaMiningUnlocked) {
        state.world.damageCircle(hitX, hitY, stats.digRadius * (1 + arcBonus * 0.32), damage, onBreak);
      } else {
        state.world.damageTile(impactTile.tx, impactTile.ty, damage, onBreak);
      }
    }
    if ((stats.splashDamage || 0) > 0 && (stats.splashRadius || 0) > 0) {
      state.world.damageCircle(hitX, hitY, stats.digRadius + stats.splashRadius, damage * stats.splashDamage, onBreak);
    }
    spawnSparks(hitX, hitY, critical ? '#fff1a6' : '#edbb66', critical ? 7 : 3);
    sound.hit(critical);
  }

  if (critical || charged) {
    state.floaters.push({ x: player.x + nx * 45, y: player.y + ny * 45, text: charged ? 'ЗАРЯД!' : 'КРИТ!', color: charged ? '#8ff7ff' : '#fff09a', life: 0.65, maxLife: 0.65 });
    state.shake = Math.max(state.shake, 6);
  }

  const impactX = player.x + nx * Math.min(length, Math.max(stats.digReach, TILE_SIZE));
  const impactY = player.y + ny * Math.min(length, Math.max(stats.digReach, TILE_SIZE));
  if (stats.bombChance > 0 && Math.random() < procChance(stats.bombChance, 0.18)) {
    detonate(impactX, impactY);
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
      if (stats.areaMiningUnlocked) {
        state.world.damageCircle(bonusX, bonusY, stats.digRadius * 0.75, stats.pickPower * 0.65, (tile, tx, ty) => resolveBrokenTile(tile, tx, ty, 'multi'));
      } else {
        const bonusTile = state.world.worldToTile(bonusX, bonusY);
        state.world.damageTile(bonusTile.tx, bonusTile.ty, stats.pickPower * 0.65, (tile, tx, ty) => resolveBrokenTile(tile, tx, ty, 'multi'));
      }
    }
  }
  if (critical && (stats.overkillCarry || 0) > 0 && Math.random() < procChance(stats.overkillCarry, 0.08)) {
    state.world.damageCircle(impactX + nx * TILE_SIZE, impactY + ny * TILE_SIZE, stats.digRadius, damage * 0.45, onBreak);
  }
}

function detonate(x, y) {
  sound.boom();
  state.shake = Math.max(state.shake, 15);
  flash('#f0a24c', 0.28);
  const volatile = (stats.volatileBombChance || 0) > 0 && Math.random() < procChance(stats.volatileBombChance, 0.1);
  const sticky = (stats.stickyBombChance || 0) > 0 && Math.random() < procChance(stats.stickyBombChance, 0.12);
  const radius = stats.bombRadius * (volatile ? 1.75 : 1);
  const power = stats.pickPower * stats.bombPower * 1.8 * (volatile ? 2.2 : 1) * (sticky ? 1.45 : 1);
  state.world.damageCircle(x, y, radius, power, (tile, tx, ty) => resolveBrokenTile(tile, tx, ty, 'bomb'));
  const fragments = Math.min(6, Math.floor(stats.bombFragments || 0));
  for (let index = 0; index < fragments; index += 1) {
    const angle = index / Math.max(1, fragments) * Math.PI * 2 + Math.random() * 0.4;
    const fragmentX = x + Math.cos(angle) * radius * 0.72;
    const fragmentY = y + Math.sin(angle) * radius * 0.72;
    state.world.damageCircle(fragmentX, fragmentY, radius * 0.36, power * (stats.bombFragmentPower || 0.3), (tile, tx, ty) => resolveBrokenTile(tile, tx, ty, 'bomb'));
  }
  if (volatile) toast('НЕСТАБИЛЬНЫЙ ЗАРЯД!', 'warning');
  for (let index = 0; index < 26; index += 1) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 55 + Math.random() * 180;
    state.particles.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, size: 2 + Math.random() * 6, color: index % 3 ? '#e06b3e' : '#ffd67d', life: 0.65 + Math.random() * 0.5, maxLife: 1.1, gravity: 80, glow: true });
  }
}

function chainStrike(x, y, nx, ny) {
  let fromX = x;
  let fromY = y;
  for (let index = 0; index < Math.floor(stats.chainCount); index += 1) {
    const focusedOre = getFocusedOre();
    const target = findBestOreTarget(
      fromX + nx * TILE_SIZE,
      fromY + ny * TILE_SIZE,
      stats.senseRadius * 0.65 * (focusedOre ? stats.oreFocusRadiusMultiplier : 1),
      focusedOre?.id || null,
    );
    if (!target) break;
    state.world.damageCircle(target.x, target.y, Math.max(10, stats.digRadius * 0.55), stats.pickPower * (stats.chainPower || 0.55), (tile, tx, ty) => resolveBrokenTile(tile, tx, ty, 'chain'));
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

function updateRun(delta, now = performance.now()) {
  if (state.paused || !state.player || !state.world) return;
  state.activeWallElapsed = Math.max(0, (now - state.runStartedAt) / 1000);
  if (state.activeWallElapsed >= MAX_RUN_SECONDS) {
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
  state.targetCooldown -= delta;
  state.droneCooldown -= delta;

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

  if (state.target) {
    const current = state.world.getTile(state.target.tx, state.target.ty);
    const explorationTarget = state.target.kind === 'exploration';
    const focusedOre = getFocusedOre();
    const persistence = 1.05 + Math.min(0.65, (stats.sensePersistence || 0) * 0.05);
    const maxTargetDistance = explorationTarget
      ? EXPLORATION_SCAN_TILES * TILE_SIZE * 1.25
      : effectiveSenseRadius() * (focusedOre ? stats.oreFocusRadiusMultiplier : 1) * persistence;
    if (
      !current
      || current.kind === 'air'
      || current.kind === 'bedrock'
      || (!explorationTarget && !current.oreId)
      || (!explorationTarget && focusedOre && current.oreId !== focusedOre.id)
      || distance(state.player.x, state.player.y, state.target.x, state.target.y) > maxTargetDistance
    ) {
      state.target = null;
    }
  }

  if (state.targetCooldown <= 0) {
    const focusedOre = getFocusedOre();
    const searchRadius = effectiveSenseRadius() * (focusedOre ? stats.oreFocusRadiusMultiplier : 1);
    const oreTarget = findBestOreTarget(state.player.x, state.player.y, searchRadius, focusedOre?.id || null);
    if (oreTarget) state.target = oreTarget;
    else if (!state.target || state.target.kind !== 'exploration') {
      state.target = findExplorationTarget(state.player.x, state.player.y, focusedOre?.id || null);
    }
    state.targetCooldown = 0.12 / Math.max(0.4, (stats.targetLockSpeed || 1) * (stats.aimTurnSpeed || 1));
  } else if (!state.target) {
    const focusedOre = getFocusedOre();
    state.target = findExplorationTarget(state.player.x, state.player.y, focusedOre?.id || null);
  }

  if (state.target) {
    const dx = state.target.x - state.player.x;
    const dy = state.target.y - state.player.y;
    const targetDistance = Math.max(0.001, Math.hypot(dx, dy));
    const nx = dx / targetDistance;
    const ny = dy / targetDistance;
    state.player.facing = nx < 0 ? -1 : 1;
    const desiredAngle = Math.atan2(ny, nx);
    const angleDelta = Math.atan2(Math.sin(desiredAngle - state.player.angle), Math.cos(desiredAngle - state.player.angle));
    state.player.angle += angleDelta * clamp(delta * 10 * (stats.aimTurnSpeed || 1), 0, 1);
    state.player.moving = lerp(state.player.moving, 1, clamp(delta * 8, 0, 1));

    const desiredSpeed = stats.moveSpeed * (stats.mineMoveMultiplier || 1);
    const moveDistance = Math.min(targetDistance, desiredSpeed * delta);
    const nextX = clamp(state.player.x + nx * moveDistance, TILE_SIZE, WORLD_CONFIG.WIDTH * TILE_SIZE - TILE_SIZE);
    const nextY = clamp(state.player.y + ny * moveDistance, TILE_SIZE, WORLD_CONFIG.HEIGHT * TILE_SIZE - TILE_SIZE);
    const probe = state.world.worldToTile(nextX + nx * 7, nextY + ny * 7);
    const nextTile = state.world.getTile(probe.tx, probe.ty);
    if (!nextTile || nextTile.kind === 'air') {
      state.player.x = nextX;
      state.player.y = nextY;
    }

    if (state.attackCooldown <= 0) {
      attack();
      const chargeRate = stats.laserUnlocked ? (stats.laserChargeRate || 1) : 1;
      state.attackCooldown = 1 / Math.max(0.2, stats.digSpeed * chargeRate * temporalOverclockMultiplier());
    }
  } else {
    state.player.moving = lerp(state.player.moving, 0, clamp(delta * 5, 0, 1));
    if (state.targetCooldown <= 0.03) state.ping = Math.max(state.ping, 0.35);
  }

  if (dronesAreActive() && state.droneCooldown <= 0) {
    droneAttack();
    state.droneCooldown = 1 / Math.max(0.25, stats.droneSpeed || 1);
  }

  const horizontalDepth = Math.abs(state.player.x - state.spawn.x) / TILE_SIZE * 0.42;
  const verticalDepth = Math.max(0, state.player.y - state.spawn.y) / TILE_SIZE;
  state.deepest = Math.max(state.deepest, horizontalDepth + verticalDepth);
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
    const target = findBestOreTarget(
      origin.x,
      origin.y,
      (effectiveSenseRadius() * 0.85 + Math.max(0, (stats.pickupRadius || 46) - 46) * 0.35)
        * (focusedOre ? stats.oreFocusRadiusMultiplier : 1),
      focusedOre?.id || null,
    );
    if (!target) continue;
    const power = stats.pickPower * Math.max(0.2, stats.dronePower || 0.35);
    state.world.damageCircle(target.x, target.y, Math.max(7, stats.digRadius * 0.34), power, (tile, tx, ty) => resolveBrokenTile(tile, tx, ty, 'drone'));
    state.beams.push({ x: origin.x, y: origin.y, x2: target.x, y2: target.y, color: '#76dbff', life: 0.1, maxLife: 0.1, width: 2 });
    if ((stats.droneBombChance || 0) > 0 && Math.random() < procChance(stats.droneBombChance, 0.12)) detonate(target.x, target.y);
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
  const voxel = 7;
  for (let microY = 0; microY < 4; microY += 1) {
    for (let microX = 0; microX < 4; microX += 1) {
      if (microX === 0 && (openMask & TERRAIN_OPEN_LEFT)) continue;
      if (microX === 3 && (openMask & TERRAIN_OPEN_RIGHT)) continue;
      if (microY === 0 && (openMask & TERRAIN_OPEN_TOP)) continue;
      if (microY === 3 && (openMask & TERRAIN_OPEN_BOTTOM)) continue;
      const globalX = tx * 4 + microX;
      const globalY = ty * 4 + microY;
      // Two-by-two world-space clusters cross logical tile borders. This keeps
      // the collision grid invisible while retaining chunky, earthen voxels.
      const cluster = tileNoise(Math.floor((globalX + 1) / 2), Math.floor((globalY + 1) / 2), 91);
      const detail = tileNoise(globalX, globalY, 97);
      if (cluster < 0.46 || detail < 0.37) continue;
      ctx.globalAlpha = 0.15 + cluster * 0.24;
      ctx.fillStyle = cluster > 0.78 ? palette.light : detail > 0.68 ? palette.side : palette.shadow;
      ctx.fillRect(x + microX * voxel, y + microY * voxel, voxel + 1, voxel + 1);
      if (detail > 0.88 && microX < 3) {
        ctx.fillRect(x + microX * voxel + voxel, y + microY * voxel + 3, voxel, 4);
      }
    }
  }
  ctx.globalAlpha = 1;
}

function drawExposedVoxelFaces(x, y, tx, ty, palette, openMask) {
  const faceA = 2 + Math.floor(tileNoise(tx, ty, 32) * 4);
  const faceB = 2 + Math.floor(tileNoise(tx, ty, 33) * 4);

  if (openMask & TERRAIN_OPEN_TOP) {
    ctx.fillStyle = palette.light;
    ctx.fillRect(x + 4, y + faceA, 7, 3);
    ctx.fillRect(x + 14, y + faceB, 8, 3);
    ctx.fillStyle = palette.side;
    ctx.fillRect(x + 8, y + faceA + 3, 6, 1);
  }
  if (openMask & TERRAIN_OPEN_LEFT) {
    ctx.fillStyle = palette.side;
    ctx.fillRect(x + faceB, y + 5, 3, 7);
    ctx.fillRect(x + faceA, y + 16, 3, 6);
  }
  if (openMask & TERRAIN_OPEN_RIGHT) {
    ctx.fillStyle = palette.shadow;
    ctx.fillRect(x + TILE_SIZE - faceA - 2, y + 5, 3, 8);
    ctx.fillRect(x + TILE_SIZE - faceB - 2, y + 16, 3, 6);
  }
  if (openMask & TERRAIN_OPEN_BOTTOM) {
    ctx.fillStyle = palette.shadow;
    ctx.fillRect(x + 4, y + TILE_SIZE - faceB - 2, 7, 3);
    ctx.fillRect(x + 14, y + TILE_SIZE - faceA - 2, 8, 3);
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
  drawTargeting(now);
  drawBeams();
  drawDrones(now);
  drawMiner(now);
  drawParticles();
  drawFloaters();
  ctx.restore();
  drawVignette();
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
    const detectionRadius = effectiveSenseRadius() * (focusedOre && focusedOre.id === ore?.id ? stats.oreFocusRadiusMultiplier : 1);
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
  ctx.lineCap = 'square';
  ctx.lineJoin = 'miter';
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

  // Isolated deposits still read as buried seams rather than loose gems.
  if (connectionCount === 0 || branchNoise > 0.46) {
    const forkX = branchNoise > 0.5 ? 1 : -1;
    ctx.moveTo(centerX, centerY);
    ctx.lineTo(centerX + forkX * 5, centerY - 4);
    ctx.lineTo(centerX + forkX * 8, centerY - 3 + Math.floor(noise * 5));
    ctx.moveTo(centerX, centerY + 1);
    ctx.lineTo(centerX - forkX * 4, centerY + 5);
    ctx.lineTo(centerX - forkX * 7, centerY + 6);
  }

  if (revealed) {
    ctx.globalAlpha = 0.1 + pulse * 0.1;
    ctx.strokeStyle = ore.color;
    ctx.lineWidth = 9;
    ctx.stroke();
  }

  ctx.globalAlpha = revealed ? 0.72 : 0.08;
  ctx.strokeStyle = '#071018';
  ctx.lineWidth = 6;
  ctx.stroke();
  ctx.globalAlpha = revealed ? 0.9 + pulse * 0.08 : 0.13;
  ctx.strokeStyle = ore.color;
  ctx.lineWidth = 3;
  ctx.stroke();

  const nodeWidth = 7 + Math.floor(noise * 4);
  const nodeHeight = 5 + Math.floor(branchNoise * 4);
  ctx.globalAlpha = revealed ? 0.75 : 0.08;
  ctx.fillStyle = '#071018';
  ctx.fillRect(centerX - Math.floor(nodeWidth / 2) - 1, centerY - Math.floor(nodeHeight / 2) - 1, nodeWidth + 2, nodeHeight + 2);
  ctx.fillRect(centerX - 3, centerY - Math.floor(nodeHeight / 2) - 3, 6, nodeHeight + 6);

  ctx.globalAlpha = revealed ? 1 : 0.14;
  ctx.fillStyle = ore.color;
  ctx.fillRect(centerX - Math.floor(nodeWidth / 2), centerY - Math.floor(nodeHeight / 2), nodeWidth, nodeHeight);
  ctx.fillRect(centerX - 2, centerY - Math.floor(nodeHeight / 2) - 2, 4, nodeHeight + 4);
  if (branchNoise > 0.42) {
    const side = branchNoise > 0.7 ? 1 : -1;
    ctx.fillRect(centerX + side * 5 - 2, centerY + 4, 5, 3);
  }

  ctx.globalAlpha = revealed ? 0.72 : 0.07;
  ctx.fillStyle = ore.accent || '#fff';
  ctx.fillRect(centerX - 1, centerY - Math.floor(nodeHeight / 2), 2, Math.max(2, Math.floor(nodeHeight * 0.5)));
  ctx.fillRect(centerX - Math.floor(nodeWidth / 2) + 2, centerY - 1, 2, 1);
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
  const senseRadius = baseSenseRadius * (focusedOre ? stats.oreFocusRadiusMultiplier : 1);
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
  if (!state.target || !state.player || state.mode !== 'run') return;
  ctx.save();
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
    ctx.strokeStyle = `rgba(181, 140, 255, ${alpha * 0.8})`;
    ctx.lineWidth = 2;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.arc(shock.x, shock.y, 10 + (1 - alpha) * 13, 0, Math.PI * 2);
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
  if (state.mode !== 'run' || state.paused) return;
  state.ping = 1;
  state.targetCooldown = 0;
  state.attackCooldown = Math.min(0, state.attackCooldown);
  sound.tone(290, 0.09, 'sine', 0.018, 100);
}

function bindEvents() {
  ui.startRun?.addEventListener('click', startRun);
  ui.retryRun?.addEventListener('click', startRun);
  ui.openUpgrades?.addEventListener('click', openUpgradeScreen);
  ui.closeUpgrades?.addEventListener('click', closeUpgradeScreen);
  ui.launchRocket?.addEventListener('click', showEnding);
  ui.endingReplay?.addEventListener('click', replayEnding);
  ui.endingContinue?.addEventListener('click', showTitle);
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
    const tag = document.activeElement?.tagName;
    const typing = tag === 'INPUT' || tag === 'TEXTAREA';
    if (event.key === 'Escape') {
      if (state.mode === 'upgrades') closeUpgradeScreen();
      else if (state.mode === 'run') togglePause();
      else if (state.mode === 'ending') showTitle();
      return;
    }
    if (typing) return;
    if (event.key === 'Enter') {
      if (state.mode === 'title' || state.mode === 'result') startRun();
    } else if (event.code === 'Space') {
      event.preventDefault();
      if (state.mode === 'run') triggerSensePulse();
      else if (state.mode === 'title' || state.mode === 'result') startRun();
    } else if (event.key.toLocaleLowerCase('ru') === 'u' || event.key.toLocaleLowerCase('ru') === 'г') {
      if (state.mode === 'upgrades') closeUpgradeScreen();
      else if (state.mode !== 'run') openUpgradeScreen();
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
    runOre: state.runOre,
    inventory: { ...save.inventory },
    target: state.target ? { kind: state.target.kind || 'ore', tx: state.target.tx, ty: state.target.ty, distance: state.target.distance } : null,
    player: state.player ? { x: state.player.x, y: state.player.y } : null,
    upgrades: UPGRADE_DEFS.length,
    purchasedLevels: countPurchasedLevels(save.levels),
    campaign: getCampaignProgress(),
    focusedOreId: save.focusedOreId,
  }),
  startRun,
  finishRun,
  openUpgrades: openUpgradeScreen,
  watchEnding: showEnding,
  grantOre: (oreId = 'copper', amount = 1000) => {
    if (!oreById.has(oreId)) return false;
    save.inventory[oreId] = (save.inventory[oreId] || 0) + Math.max(0, Math.floor(Number(amount) || 0));
    persistSave();
    updatePersistentLabels();
    if (state.mode === 'upgrades') renderUpgrades();
    return true;
  },
};

initialize();
})();
