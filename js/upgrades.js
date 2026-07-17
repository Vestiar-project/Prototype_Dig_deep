(() => {
"use strict";

/**
 * Pure, deterministic content and meta-progression model for the miner game.
 *
 * Upgrade levels are stored as an object (`{ [id]: level }`) or a Map. The
 * `cost(level)` callback receives the current level: `cost(0)` is the first
 * purchase. Upgrade `apply` callbacks receive the total owned level and are
 * intentionally free of DOM, storage and random-number dependencies.
 */

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const round = (value, digits = 4) => {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
};

const add = (stats, key, amount) => {
  stats[key] += amount;
};

const makeCost = (baseCost, growth) => (level) => {
  const safeLevel = clamp(Math.floor(Number(level) || 0), 0, 60);
  return Math.max(1, Math.round(baseCost * growth ** safeLevel));
};

const defineUpgrade = ({ baseCost, growth = 1.38, ...definition }) => {
  const legacyCost = makeCost(baseCost, growth);
  return Object.freeze({
    ...definition,
    baseCost,
    growth,
    maxLevel: Math.max(1, Math.floor(definition.maxLevel)),
    requires: Object.freeze([...(definition.requires ?? [])]),
    recipeOverride: definition.recipeOverride && typeof definition.recipeOverride === "object"
      ? Object.freeze({ ...definition.recipeOverride })
      : undefined,
    // Keep the scalar curve for old saves and callers while purchases migrate
    // to exact ore recipes through getUpgradeRecipe().
    cost: legacyCost,
    legacyCost,
  });
};

const UPGRADE_CATEGORIES = Object.freeze({
  core: Object.freeze({ name: "Путь", icon: "◆" }),
  sense: Object.freeze({ name: "Чутьё", icon: "◉" }),
  dig: Object.freeze({ name: "Копка", icon: "⛏" }),
  power: Object.freeze({ name: "Сила", icon: "◆" }),
  time: Object.freeze({ name: "Время", icon: "◷" }),
  gadgets: Object.freeze({ name: "Гаджеты", icon: "✹" }),
  tools: Object.freeze({ name: "Инструменты", icon: "⚒" }),
  fortune: Object.freeze({ name: "Удача", icon: "✦" }),
});

const ORE_TYPES = Object.freeze(
  [
    {
      id: "copper",
      tier: 0,
      name: "Медь",
      description: "Тёплые пластичные прожилки, с которых начинается любая шахтёрская смена.",
      color: "#c86f43",
      accent: "#ffd0a8",
      value: 1,
      hardness: 1,
      depth: 0,
    },
    {
      id: "coal",
      tier: 1,
      name: "Уголь",
      description: "Хрупкий тёмный пласт: дешёвый, частый и удобный для ранних механизмов.",
      color: "#343943",
      accent: "#9ba5b4",
      value: 2,
      hardness: 1.45,
      depth: 55,
    },
    {
      id: "iron",
      tier: 2,
      name: "Железо",
      description: "Плотные серые включения — первая серьёзная проверка силы инструмента.",
      color: "#87949c",
      accent: "#e5f0ef",
      value: 4,
      hardness: 2.2,
      depth: 125,
    },
    {
      id: "amber",
      tier: 3,
      name: "Янтарь",
      description: "Застывшие золотистые капли светятся в мягкой породе и хорошо заметны издалека.",
      color: "#d88b1f",
      accent: "#fff0a1",
      value: 8,
      hardness: 3.35,
      depth: 215,
    },
    {
      id: "silver",
      tier: 4,
      name: "Серебро",
      description: "Холодные светлые нити образуют тонкие жилы на границе глубоких слоёв.",
      color: "#aebbd0",
      accent: "#ffffff",
      value: 16,
      hardness: 5.1,
      depth: 325,
    },
    {
      id: "gold",
      tier: 5,
      name: "Золото",
      description: "Редкие тяжёлые самородки оправдывают долгий путь и прочную кирку.",
      color: "#e0a922",
      accent: "#fff6a6",
      value: 32,
      hardness: 7.8,
      depth: 465,
    },
    {
      id: "amethyst",
      tier: 6,
      name: "Аметист",
      description: "Фиолетовые кристаллы растут друзами и раскалываются звонкими гранями.",
      color: "#8153c7",
      accent: "#edc7ff",
      value: 68,
      hardness: 11.8,
      depth: 630,
    },
    {
      id: "prism_crystal",
      tier: 7,
      name: "Призмалит",
      description: "Переломляет свет внутри камня; его жилы мерцают несколькими цветами сразу.",
      color: "#31a9b6",
      accent: "#bffcff",
      value: 145,
      hardness: 17.5,
      depth: 825,
    },
    {
      id: "void_ore",
      tier: 8,
      name: "Пустотная руда",
      description: "Поглощает окружающее свечение и кажется провалом в толще планеты.",
      color: "#312458",
      accent: "#d56dff",
      value: 310,
      hardness: 26,
      depth: 1050,
    },
    {
      id: "star_core",
      tier: 9,
      name: "Звёздное ядро",
      description: "Раскалённая материя глубин — самый плотный и ценный образец этой планеты.",
      color: "#e9586e",
      accent: "#fff4dd",
      value: 700,
      hardness: 39,
      depth: 1320,
    },
  ].map(Object.freeze),
);

const ORE_ID_SET = new Set(ORE_TYPES.map((ore) => ore.id));
const ORE_BY_TIER = Object.freeze(
  [...ORE_TYPES].sort((left, right) => left.tier - right.tier),
);

// These weights are authoring constants, not an exchange rate. Runtime
// purchases always compare and spend the exact named ores in their recipe.
const RECIPE_TIER_FLOORS = Object.freeze([0, 12, 30, 70, 160, 360, 800, 1800, 4000, 9000]);
const RECIPE_WEIGHTS = Object.freeze([1, 2, 4, 8, 16, 32, 68, 145, 310, 700]);
const RECIPE_PACING_BY_TIER = Object.freeze([1, 1, 1.2, 1.4, 1.7, 2, 2.4, 2.8, 3.2, 4]);
const CATEGORY_CATALYST_TIERS = Object.freeze({
  core: Object.freeze([0, 7, 8, 9]),
  sense: Object.freeze([0, 3, 4, 7]),
  dig: Object.freeze([0, 2, 4, 6]),
  power: Object.freeze([1, 2, 5, 8]),
  time: Object.freeze([3, 4, 7, 9]),
  gadgets: Object.freeze([1, 2, 5, 7]),
  tools: Object.freeze([0, 2, 4, 6, 7]),
  fortune: Object.freeze([0, 3, 5, 6, 7]),
});
const ROOT_FIRST_COST = Object.freeze({
  core: 1,
  sense: 1,
  dig: 1,
  power: 1,
  time: 2,
  gadgets: 2,
  tools: 2,
  fortune: 2,
});

const safeOreAmount = (value) => {
  const amount = Math.floor(Number(value));
  return Number.isFinite(amount) && amount > 0 ? amount : 0;
};

/** Create a mutable bag containing every known ore id. */
function createOreBag(source = {}) {
  const bag = {};
  for (const ore of ORE_TYPES) bag[ore.id] = safeOreAmount(source?.[ore.id]);
  return bag;
}

/** Strip unknown ids, fractions, negative values and non-finite amounts. */
function sanitizeOreBag(source = {}) {
  return createOreBag(source);
}

/** Mutate target by adding non-negative, integer ore amounts from source. */
function addOreBag(target, source = {}) {
  const bag = target && typeof target === "object" ? target : createOreBag();
  for (const ore of ORE_TYPES) {
    bag[ore.id] = safeOreAmount(bag[ore.id]) + safeOreAmount(source?.[ore.id]);
  }
  return bag;
}

/** Count physical ore pieces, deliberately ignoring their former value. */
function countOreBag(source = {}) {
  return ORE_TYPES.reduce((total, ore) => total + safeOreAmount(source?.[ore.id]), 0);
}

function recipeEntries(recipe = {}) {
  const entries = [];
  if (Array.isArray(recipe)) {
    for (const ingredient of recipe) {
      const oreId = String(ingredient?.oreId ?? ingredient?.id ?? "");
      const amount = safeOreAmount(ingredient?.amount ?? ingredient?.count);
      if (ORE_ID_SET.has(oreId) && amount > 0) entries.push([oreId, amount]);
    }
  } else if (recipe && typeof recipe === "object") {
    for (const [oreId, rawAmount] of Object.entries(recipe)) {
      const amount = safeOreAmount(rawAmount);
      if (ORE_ID_SET.has(oreId) && amount > 0) entries.push([oreId, amount]);
    }
  }

  const merged = new Map();
  for (const [oreId, amount] of entries) merged.set(oreId, (merged.get(oreId) || 0) + amount);
  return [...merged.entries()];
}

function frozenRecipe(entries = []) {
  const recipe = {};
  for (const [oreId, amount] of entries) {
    const safeAmount = safeOreAmount(amount);
    if (ORE_ID_SET.has(oreId) && safeAmount > 0) recipe[oreId] = (recipe[oreId] || 0) + safeAmount;
  }
  return Object.freeze(recipe);
}

/**
 * Return the exact 1-3 ore recipe for the next level. The legacy scalar curve
 * only selects a material tier and quantities; ores are never interchangeable.
 */
function getUpgradeRecipe(definition, level = 0) {
  if (!definition) return frozenRecipe();
  const currentLevel = Math.max(0, Math.floor(Number(level) || 0));
  if (currentLevel >= definition.maxLevel) return frozenRecipe();

  const overriddenRecipe = recipeEntries(definition.recipeOverride);
  if (overriddenRecipe.length > 0) return frozenRecipe(overriddenRecipe);

  const requirements = Array.isArray(definition.requires) ? definition.requires : [];
  if (currentLevel === 0 && requirements.length === 0) {
    const amount = safeOreAmount(ROOT_FIRST_COST[definition.category]) || 1;
    return frozenRecipe([[ORE_BY_TIER[0].id, amount]]);
  }

  const legacyCost = typeof definition.legacyCost === "function"
    ? definition.legacyCost(currentLevel)
    : typeof definition.cost === "function"
      ? definition.cost(currentLevel)
      : NaN;
  if (!Number.isFinite(legacyCost) || legacyCost <= 0) return frozenRecipe();

  let tier = 0;
  for (let index = 1; index < RECIPE_TIER_FLOORS.length; index += 1) {
    if (legacyCost >= RECIPE_TIER_FLOORS[index]) tier = index;
  }
  tier = clamp(tier, 0, ORE_BY_TIER.length - 1);

  if (tier === 0) {
    return frozenRecipe([[ORE_BY_TIER[0].id, Math.ceil(legacyCost * 0.5)]]);
  }

  const ingredients = [];
  const pacingMultiplier = RECIPE_PACING_BY_TIER[tier] || 1;
  const addTier = (oreTier, weightedShare) => {
    const safeTier = clamp(oreTier, 0, ORE_BY_TIER.length - 1);
    const weight = RECIPE_WEIGHTS[safeTier] || 1;
    ingredients.push([ORE_BY_TIER[safeTier].id, Math.ceil(legacyCost * weightedShare * pacingMultiplier / weight)]);
  };

  addTier(tier, 0.25);
  addTier(tier - 1, 0.175);
  const catalystOptions = CATEGORY_CATALYST_TIERS[definition.category] || [];
  const catalystTier = [...catalystOptions].reverse().find((candidate) => candidate <= tier - 2)
    ?? Math.max(0, tier - 2);
  addTier(catalystTier, 0.075);
  return frozenRecipe(ingredients);
}

/** Check every ingredient without converting one ore into another. */
function canAffordRecipe(inventory, recipe) {
  const entries = recipeEntries(recipe);
  return entries.length > 0
    && entries.every(([oreId, amount]) => safeOreAmount(inventory?.[oreId]) >= amount);
}

/** Atomically spend a recipe; return false and leave inventory untouched on failure. */
function spendRecipe(inventory, recipe) {
  if (!inventory || typeof inventory !== "object" || !canAffordRecipe(inventory, recipe)) return false;
  for (const ore of ORE_TYPES) inventory[ore.id] = safeOreAmount(inventory[ore.id]);
  for (const [oreId, amount] of recipeEntries(recipe)) inventory[oreId] -= amount;
  return true;
}

const coreRootUpgrade = defineUpgrade({
  id: "core_first_descent",
  name: "Первый спуск",
  description: "Начало пути шахтёра. Открывает семь ветвей мастерства.",
  category: "core",
  icon: "⛏",
  maxLevel: 1,
  baseCost: 1,
  growth: 1,
  requires: [],
  recipeOverride: { copper: 1 },
  apply: () => {},
});

const senseUpgrades = [
  defineUpgrade({
    id: "sense_instinct_spark",
    name: "Искра инстинкта",
    description: "Радиус чутья +22 за уровень. Один понятный многослойный узел заменяет несколько одинаковых прибавок.",
    category: "sense",
    icon: "◉",
    maxLevel: 18,
    baseCost: 4,
    growth: 1.29,
    requires: ["core_first_descent"],
    apply: (stats, level) => add(stats, "senseRadius", 22 * level),
  }),
  defineUpgrade({
    id: "sense_echo_pulse",
    name: "Эхо-пульс",
    description: "Импульс чутья обновляется на 8% быстрее за уровень.",
    category: "sense",
    icon: "⌁",
    maxLevel: 6,
    baseCost: 18,
    growth: 1.42,
    requires: ["sense_instinct_spark"],
    apply: (stats, level) => add(stats, "sensePulseSpeed", 0.08 * level),
  }),
  defineUpgrade({
    id: "sense_clear_signal",
    name: "Чистый сигнал",
    description: "Наведение на найденную руду на 12% быстрее за уровень.",
    category: "sense",
    icon: "⌖",
    maxLevel: 5,
    baseCost: 31,
    growth: 1.43,
    requires: [{ id: "sense_instinct_spark", level: 4 }],
    apply: (stats, level) => add(stats, "targetLockSpeed", 0.12 * level),
  }),
  defineUpgrade({
    id: "sense_deep_resonance",
    name: "Глубинный резонанс",
    description: "Чутьё дальше замечает плотную руду и получает +10 к радиусу.",
    category: "sense",
    icon: "◍",
    maxLevel: 5,
    baseCost: 76,
    growth: 1.45,
    requires: [{ id: "sense_instinct_spark", level: 8 }],
    apply: (stats, level) => {
      add(stats, "senseRadius", 10 * level);
      add(stats, "deepOreSenseBonus", 0.1 * level);
    },
  }),
  defineUpgrade({
    id: "sense_vein_whisper",
    name: "Шёпот жил",
    description: "Шанс подсветить соседние куски той же жилы +7% за уровень.",
    category: "sense",
    layoutLobe: "tools",
    icon: "〰",
    maxLevel: 5,
    baseCost: 58,
    growth: 1.47,
    requires: ["sense_echo_pulse"],
    apply: (stats, level) => add(stats, "veinRevealChance", 0.07 * level),
  }),
  defineUpgrade({
    id: "sense_greed_compass",
    name: "Компас жадности",
    description: "Автокопатель сильнее предпочитает ценную руду.",
    category: "sense",
    icon: "✥",
    maxLevel: 1,
    baseCost: 115,
    growth: 1,
    requires: ["sense_clear_signal"],
    apply: (stats, level) => add(stats, "targetValueBias", 0.55 * level),
  }),
  defineUpgrade({
    id: "sense_seismic_memory",
    name: "Сейсмическая память",
    description: "Обнаруженная руда остаётся видимой на 0,8 сек дольше за уровень.",
    category: "sense",
    icon: "≋",
    maxLevel: 5,
    baseCost: 104,
    growth: 1.44,
    requires: ["sense_vein_whisper"],
    apply: (stats, level) => add(stats, "sensePersistence", 0.8 * level),
  }),
  defineUpgrade({
    id: "sense_panoramic_intuition",
    name: "Панорамная интуиция",
    description: "Итоговый радиус чутья +5% за уровень.",
    category: "sense",
    icon: "◎",
    maxLevel: 5,
    baseCost: 160,
    growth: 1.51,
    requires: ["sense_deep_resonance"],
    apply: (stats, level) => add(stats, "senseRadiusMultiplier", 0.05 * level),
  }),
  defineUpgrade({
    id: "sense_ore_focus",
    name: "Рудный фокус",
    description: "Открывает выбор одного типа руды и увеличивает радиус её поиска в 2,15 раза.",
    category: "sense",
    layoutLobe: "tools",
    icon: "⌾",
    maxLevel: 1,
    baseCost: 250,
    growth: 1,
    requires: ["sense_panoramic_intuition"],
    recipeOverride: { amber: 24, silver: 12 },
    apply: (stats, level) => {
      if (level > 0) {
        stats.oreFocusUnlocked = true;
        stats.oreFocusRadiusMultiplier = 2.15;
      }
    },
  }),
  defineUpgrade({
    id: "sense_priority_tuning",
    name: "Настройка приоритета",
    description: "Вес ценности цели +18% за уровень без потери скорости поиска.",
    category: "sense",
    icon: "☷",
    maxLevel: 5,
    baseCost: 175,
    growth: 1.48,
    requires: ["sense_greed_compass"],
    apply: (stats, level) => add(stats, "targetValueBias", 0.18 * level),
  }),
  defineUpgrade({
    id: "sense_ghost_outline",
    name: "Призрачный контур",
    description: "Открывает постоянный контур уже обнаруженной руды.",
    category: "sense",
    icon: "▧",
    maxLevel: 1,
    baseCost: 260,
    growth: 1,
    requires: ["sense_seismic_memory"],
    apply: (stats, level) => {
      if (level > 0) stats.oreOutline = true;
    },
  }),
  defineUpgrade({
    id: "sense_far_echo",
    name: "Дальнее эхо",
    description: "Радиус чутья +32 за уровень.",
    category: "sense",
    icon: "◠",
    maxLevel: 5,
    baseCost: 310,
    growth: 1.53,
    requires: ["sense_panoramic_intuition"],
    apply: (stats, level) => add(stats, "senseRadius", 32 * level),
  }),
  defineUpgrade({
    id: "sense_clairvoyant_miner",
    name: "Шахтёр-ясновидец",
    description: "Радиус +10%, скорость захвата цели +15% за уровень.",
    category: "sense",
    icon: "☉",
    maxLevel: 3,
    baseCost: 620,
    growth: 1.62,
    requires: ["sense_priority_tuning", "sense_far_echo"],
    apply: (stats, level) => {
      add(stats, "senseRadiusMultiplier", 0.1 * level);
      add(stats, "targetLockSpeed", 0.15 * level);
    },
  }),
  defineUpgrade({
    id: "sense_second_fix",
    name: "Вторая засечка",
    description: "Запоминает одну запасную цель и мгновенно переключается на неё после разрушения текущей. При рудном фокусе обе цели относятся только к выбранной руде.",
    category: "sense",
    icon: "◎",
    maxLevel: 1,
    baseCost: 520,
    growth: 1,
    requires: ["sense_seismic_memory", "sense_priority_tuning"],
    apply: (stats, level) => add(stats, "backupTargetSlots", level),
  }),
  defineUpgrade({
    id: "sense_frequency_swing",
    name: "Раскачка частоты",
    description: "Если рудный фокус не находит цель 1,5 секунды, радиус его поиска увеличивается на 25% за уровень до обнаружения руды.",
    category: "sense",
    icon: "≋",
    maxLevel: 3,
    baseCost: 720,
    growth: 1.62,
    requires: ["sense_ore_focus", { id: "time_capsule", level: 8 }],
    apply: (stats, level) => {
      stats.oreFocusEscalationDelay = 1.5;
      add(stats, "oreFocusEscalationBonus", 0.25 * level);
    },
  }),
  defineUpgrade({
    id: "sense_deaf_knock",
    name: "Глухой стук",
    description: "После 14/11/8 разрушенных блоков обычной породы запускает импульс чутья радиусом 140%. Найденная им цель даёт +20% скорости движения на 1,2 секунды. Перезарядка — 3 секунды; рудный фокус ищет только выбранную руду.",
    category: "sense",
    icon: "◫",
    maxLevel: 3,
    baseCost: 430,
    growth: 1.61,
    requires: ["sense_echo_pulse", "dig_wall_bite"],
    apply: (stats, level) => {
      stats.deafKnockStoneThreshold = [0, 14, 11, 8][level] || 14;
      stats.deafKnockSenseRadiusMultiplier = 1.4;
      stats.deafKnockMoveSpeedBonus = 0.2;
      stats.deafKnockMoveDuration = 1.2;
      stats.deafKnockCooldown = 3;
      stats.deafKnockFocusOnly = true;
    },
  }),
  defineUpgrade({
    id: "sense_triangular_fix",
    name: "Треугольная засечка",
    description: "Уровень I: руда в секторе шахтёр–основная–запасная цель запоминается на 1,5 секунды и получает приоритет дронов. Уровень II: гаджеты наносят в секторе +25% урона, а дальность цепей и дронов увеличивается на 20%.",
    category: "sense",
    icon: "△",
    maxLevel: 2,
    baseCost: 1100,
    growth: 1.7,
    requires: ["sense_second_fix", "gadgets_scout_drone"],
    apply: (stats, level) => {
      if (level > 0) {
        stats.triangularFixUnlocked = true;
        stats.triangularFixOreMemory = 1.5;
        stats.triangularFixDronePriority = true;
      }
      if (level >= 2) {
        stats.triangularFixGadgetDamageBonus = 0.25;
        stats.triangularFixRangeBonus = 0.2;
      }
    },
  }),
  defineUpgrade({
    id: "sense_earth_call",
    name: "Зов земли",
    description: "Чутьё проникает сквозь любые стены и получает +25% радиуса.",
    category: "sense",
    icon: "◉",
    maxLevel: 1,
    baseCost: 1800,
    growth: 1,
    requires: ["sense_clairvoyant_miner", "sense_ghost_outline"],
    apply: (stats, level) => {
      if (level > 0) stats.senseThroughWalls = true;
      add(stats, "senseRadiusMultiplier", 0.25 * level);
    },
  }),
];

const digUpgrades = [
  defineUpgrade({
    id: "dig_arm_swing",
    name: "Размашистая рука",
    description: "Дальность удара +5 за уровень. Здесь собрана вся базовая тренировка досягаемости.",
    category: "dig",
    icon: "⛏",
    maxLevel: 18,
    baseCost: 4,
    growth: 1.29,
    requires: ["core_first_descent"],
    apply: (stats, level) => add(stats, "digReach", 5 * level),
  }),
  defineUpgrade({
    id: "dig_sweeping_arc",
    name: "Сметающая дуга",
    description: "Сектор удара шире на 4° за уровень.",
    category: "dig",
    icon: "⌒",
    maxLevel: 6,
    baseCost: 18,
    growth: 1.39,
    requires: ["dig_arm_swing"],
    apply: (stats, level) => add(stats, "digArc", (Math.PI / 45) * level),
  }),
  defineUpgrade({
    id: "dig_light_footwork",
    name: "Лёгкая поступь",
    description: "Скорость перемещения +4% за уровень.",
    category: "dig",
    layoutLobe: "time",
    icon: "➜",
    maxLevel: 8,
    baseCost: 27,
    growth: 1.35,
    requires: ["dig_arm_swing"],
    apply: (stats, level) => add(stats, "moveSpeedMultiplier", 0.04 * level),
  }),
  defineUpgrade({
    id: "dig_tunnel_step",
    name: "Туннельный шаг",
    description: "Во время копки шахтёр движется на 7% быстрее за уровень.",
    category: "dig",
    icon: "⇥",
    maxLevel: 5,
    baseCost: 49,
    growth: 1.43,
    requires: ["dig_light_footwork"],
    apply: (stats, level) => add(stats, "mineMoveMultiplier", 0.07 * level),
  }),
  defineUpgrade({
    id: "dig_twin_stroke",
    name: "Двойной замах",
    description: "Шанс нанести второй удар +4% за уровень.",
    category: "dig",
    icon: "≻",
    maxLevel: 5,
    baseCost: 61,
    growth: 1.46,
    requires: ["dig_sweeping_arc"],
    apply: (stats, level) => add(stats, "multiHitChance", 0.04 * level),
  }),
  defineUpgrade({
    id: "dig_precision_path",
    name: "Точная траектория",
    description: "Поворот к новой цели на 15% быстрее за уровень.",
    category: "dig",
    icon: "⌖",
    maxLevel: 5,
    baseCost: 73,
    growth: 1.42,
    requires: [{ id: "dig_arm_swing", level: 6 }],
    apply: (stats, level) => add(stats, "aimTurnSpeed", 0.15 * level),
  }),
  defineUpgrade({
    id: "dig_reach_training",
    name: "Тренировка захвата",
    description: "Итоговая дальность копки +5% за уровень.",
    category: "dig",
    icon: "↝",
    maxLevel: 5,
    baseCost: 92,
    growth: 1.47,
    requires: [{ id: "dig_arm_swing", level: 6 }],
    apply: (stats, level) => add(stats, "digReachMultiplier", 0.05 * level),
  }),
  defineUpgrade({
    id: "dig_wall_bite",
    name: "Укус стены",
    description: "Открывает площадную копку; радиус удара +6 за уровень.",
    category: "dig",
    icon: "◖",
    maxLevel: 6,
    baseCost: 118,
    growth: 1.45,
    requires: ["dig_twin_stroke"],
    apply: (stats, level) => {
      if (level > 0) stats.areaMiningUnlocked = true;
      add(stats, "splashRadius", 3 * level);
      add(stats, "digRadius", 6 * level);
      add(stats, "splashDamage", 0.025 * level);
    },
  }),
  defineUpgrade({
    id: "dig_excavator_stance",
    name: "Стойка экскаватора",
    description: "Дальность +8 и скорость ударов +3% за уровень.",
    category: "dig",
    icon: "⚒",
    maxLevel: 5,
    baseCost: 205,
    growth: 1.5,
    requires: ["dig_reach_training", { id: "tools_balanced_handle", level: 5 }],
    apply: (stats, level) => {
      add(stats, "digReach", 8 * level);
      add(stats, "digSpeedMultiplier", 0.03 * level);
    },
  }),
  defineUpgrade({
    id: "dig_stone_dance",
    name: "Танец среди камней",
    description: "Скорость движения +6%, скорость наведения +8% за уровень.",
    category: "dig",
    icon: "♢",
    maxLevel: 5,
    baseCost: 240,
    growth: 1.49,
    requires: ["dig_precision_path", "dig_tunnel_step"],
    apply: (stats, level) => {
      add(stats, "moveSpeedMultiplier", 0.06 * level);
      add(stats, "aimTurnSpeed", 0.08 * level);
    },
  }),
  defineUpgrade({
    id: "dig_master_reach",
    name: "Мастерская досягаемость",
    description: "Итоговая дальность копки +9% за уровень.",
    category: "dig",
    icon: "⇀",
    maxLevel: 4,
    baseCost: 370,
    growth: 1.57,
    requires: ["dig_excavator_stance"],
    apply: (stats, level) => add(stats, "digReachMultiplier", 0.09 * level),
  }),
  defineUpgrade({
    id: "dig_omni_swing",
    name: "Круговой замах",
    description: "Сектор удара шире на 12° и урон по площади +5% за уровень.",
    category: "dig",
    icon: "⟳",
    maxLevel: 3,
    baseCost: 590,
    growth: 1.63,
    requires: ["dig_wall_bite", "dig_master_reach"],
    apply: (stats, level) => {
      add(stats, "digArc", (Math.PI / 15) * level);
      add(stats, "splashDamage", 0.05 * level);
    },
  }),
  defineUpgrade({
    id: "dig_least_resistance",
    name: "Тропа наименьшего сопротивления",
    description: "Автомайнер сравнивает время прямого пробивания и обхода плотной породы, затем выбирает более быстрый маршрут.",
    category: "dig",
    icon: "⌁",
    maxLevel: 1,
    baseCost: 240,
    growth: 1,
    requires: ["dig_precision_path", "sense_clear_signal"],
    apply: (stats, level) => {
      if (level > 0) stats.leastResistancePathing = true;
    },
  }),
  defineUpgrade({
    id: "dig_mine_lift",
    name: "Шахтный лифт",
    description: "Начинает забег на 15/25/35% от рекордной глубины, но не ниже уже освоенного рудного слоя.",
    category: "dig",
    icon: "⇓",
    maxLevel: 3,
    baseCost: 520,
    growth: 1.64,
    requires: ["dig_tunnel_step", "time_capsule"],
    apply: (stats, level) => {
      stats.mineLiftRecordDepthRatio = [0, 0.15, 0.25, 0.35][level] || 0;
    },
  }),
  defineUpgrade({
    id: "dig_quarry_presence",
    name: "Присутствие карьера",
    description: "Дальность копки +25%, скорость ударов +15%, сектор становится шире.",
    category: "dig",
    icon: "◯",
    maxLevel: 1,
    baseCost: 1750,
    growth: 1,
    requires: ["dig_omni_swing", "dig_stone_dance"],
    apply: (stats, level) => {
      add(stats, "digReachMultiplier", 0.25 * level);
      add(stats, "digSpeedMultiplier", 0.15 * level);
      add(stats, "digArc", (Math.PI / 9) * level);
    },
  }),
];

const powerUpgrades = [
  defineUpgrade({
    id: "power_sharpened_edge",
    name: "Острое жало",
    description: "Сила кирки +0,45 за уровень. Базовая мощность теперь растёт в одном многослойном узле.",
    category: "power",
    icon: "◆",
    maxLevel: 18,
    baseCost: 5,
    growth: 1.3,
    requires: ["core_first_descent"],
    apply: (stats, level) => add(stats, "pickPower", 0.45 * level),
  }),
  defineUpgrade({
    id: "power_tempered_steel",
    name: "Закалённая сталь",
    description: "Игнорирование плотности руды +0,3 за уровень.",
    category: "power",
    icon: "▰",
    maxLevel: 7,
    baseCost: 24,
    growth: 1.41,
    requires: ["power_sharpened_edge"],
    apply: (stats, level) => add(stats, "hardnessPierce", 0.3 * level),
  }),
  defineUpgrade({
    id: "power_furious_swing",
    name: "Яростный взмах",
    description: "Шанс критического удара +2,5% за уровень.",
    category: "power",
    layoutLobe: "fortune",
    icon: "✦",
    maxLevel: 6,
    baseCost: 37,
    growth: 1.44,
    requires: [{ id: "power_sharpened_edge", level: 5 }],
    apply: (stats, level) => add(stats, "critChance", 0.025 * level),
  }),
  defineUpgrade({
    id: "power_fault_finder",
    name: "Искатель трещин",
    description: "Множитель критического удара +0,25 за уровень.",
    category: "power",
    icon: "⌁",
    maxLevel: 6,
    baseCost: 52,
    growth: 1.45,
    requires: ["power_tempered_steel"],
    apply: (stats, level) => add(stats, "critMultiplier", 0.25 * level),
  }),
  defineUpgrade({
    id: "power_shatterpoint",
    name: "Точка раскола",
    description: "Разрушенный блок с шансом 5% за уровень ранит соседей.",
    category: "power",
    icon: "✣",
    maxLevel: 5,
    baseCost: 78,
    growth: 1.48,
    requires: ["power_furious_swing"],
    apply: (stats, level) => {
      add(stats, "breakSplashChance", 0.05 * level);
      add(stats, "breakSplashPower", 0.04 * level);
    },
  }),
  defineUpgrade({
    id: "power_adamant_grip",
    name: "Адамантовая хватка",
    description: "Итоговая сила кирки +5% за уровень.",
    category: "power",
    icon: "✊",
    maxLevel: 6,
    baseCost: 96,
    growth: 1.5,
    requires: [{ id: "power_sharpened_edge", level: 8 }],
    apply: (stats, level) => add(stats, "pickPowerMultiplier", 0.05 * level),
  }),
  defineUpgrade({
    id: "power_momentum",
    name: "Накопленный импульс",
    description: "Каждый быстрый удар по одной жиле добавляет 2% силы за уровень.",
    category: "power",
    icon: "➤",
    maxLevel: 5,
    baseCost: 125,
    growth: 1.47,
    requires: ["power_furious_swing"],
    apply: (stats, level) => {
      add(stats, "streakPower", 0.02 * level);
      add(stats, "streakCap", 1 * level);
      add(stats, "comboWindow", 0.06 * level);
      add(stats, "comboMultiplier", 0.03 * level);
    },
  }),
  defineUpgrade({
    id: "power_diamond_tip",
    name: "Алмазный наконечник",
    description: "Сила +0,9 и пробивание плотности +0,35 за уровень.",
    category: "power",
    icon: "◇",
    maxLevel: 6,
    baseCost: 165,
    growth: 1.51,
    requires: ["power_fault_finder", "power_adamant_grip"],
    apply: (stats, level) => {
      add(stats, "pickPower", 0.9 * level);
      add(stats, "hardnessPierce", 0.35 * level);
    },
  }),
  defineUpgrade({
    id: "power_tectonic_blow",
    name: "Тектонический удар",
    description: "Урон по площади и плотной руде +8% за уровень.",
    category: "power",
    icon: "♒",
    maxLevel: 5,
    baseCost: 230,
    growth: 1.53,
    requires: ["power_shatterpoint"],
    apply: (stats, level) => {
      add(stats, "splashDamage", 0.08 * level);
      add(stats, "oreDamageBonus", 0.08 * level);
    },
  }),
  defineUpgrade({
    id: "power_overcharge_strike",
    name: "Перегруженный удар",
    description: "Каждый восьмой удар получает +35% силы за уровень.",
    category: "power",
    icon: "ϟ",
    maxLevel: 4,
    baseCost: 310,
    growth: 1.58,
    requires: ["power_momentum", "power_diamond_tip"],
    apply: (stats, level) => add(stats, "chargedHitPower", 0.35 * level),
  }),
  defineUpgrade({
    id: "power_geologist_force",
    name: "Сила геолога",
    description: "Урон по редкой руде +12% за уровень.",
    category: "power",
    icon: "▦",
    maxLevel: 5,
    baseCost: 360,
    growth: 1.55,
    requires: ["power_diamond_tip"],
    apply: (stats, level) => add(stats, "rareOreDamageBonus", 0.12 * level),
  }),
  defineUpgrade({
    id: "power_corebreaker",
    name: "Крушитель ядер",
    description: "Итоговая сила +10%, пробивание +0,7 за уровень.",
    category: "power",
    icon: "☄",
    maxLevel: 4,
    baseCost: 520,
    growth: 1.62,
    requires: ["power_tectonic_blow", "power_geologist_force"],
    apply: (stats, level) => {
      add(stats, "pickPowerMultiplier", 0.1 * level);
      add(stats, "hardnessPierce", 0.7 * level);
    },
  }),
  defineUpgrade({
    id: "power_one_hit_legend",
    name: "Легенда одного удара",
    description: "Криты сильнее на 0,5 и с шансом 4% переносят лишний урон дальше.",
    category: "power",
    icon: "★",
    maxLevel: 3,
    baseCost: 790,
    growth: 1.68,
    requires: ["power_overcharge_strike", "power_corebreaker"],
    apply: (stats, level) => {
      add(stats, "critMultiplier", 0.5 * level);
      add(stats, "overkillCarry", 0.04 * level);
    },
  }),
  defineUpgrade({
    id: "power_sample_calibration",
    name: "Калибровка по образцу",
    description: "Эффективная плотность выбранной через рудный фокус руды уменьшается на 8% за уровень; смена фокуса меняет специализацию.",
    category: "power",
    icon: "◇",
    maxLevel: 4,
    baseCost: 980,
    growth: 1.65,
    requires: ["power_geologist_force", "sense_ore_focus"],
    apply: (stats, level) => add(stats, "focusedOreHardnessReduction", 0.08 * level),
  }),
  defineUpgrade({
    id: "power_mountain_splitter",
    name: "Раскалывающий горы",
    description: "Сила кирки +30%, критический шанс +10%.",
    category: "power",
    icon: "✷",
    maxLevel: 1,
    baseCost: 2200,
    growth: 1,
    requires: ["power_one_hit_legend"],
    apply: (stats, level) => {
      add(stats, "pickPowerMultiplier", 0.3 * level);
      add(stats, "critChance", 0.1 * level);
    },
  }),
];

// Kept out of the exported catalog only long enough to make save migration
// readable in game.js. The live tree uses the four condensed nodes below.
const legacyTimeUpgrades = [
  defineUpgrade({
    id: "time_extra_breath",
    name: "Лишний вдох",
    description: "Начальный таймер +0,25 сек за уровень.",
    category: "time",
    icon: "◷",
    maxLevel: 5,
    baseCost: 6,
    growth: 1.38,
    requires: ["core_first_descent"],
    apply: (stats, level) => add(stats, "runDuration", 0.25 * level),
  }),
  defineUpgrade({
    id: "time_wound_spring",
    name: "Заведённая пружина",
    description: "Начальный таймер +0,35 сек за уровень.",
    category: "time",
    icon: "↻",
    maxLevel: 5,
    baseCost: 20,
    growth: 1.43,
    requires: ["time_extra_breath"],
    apply: (stats, level) => add(stats, "runDuration", 0.35 * level),
  }),
  defineUpgrade({
    id: "time_sand_reserve",
    name: "Запас песка",
    description: "Начальный таймер +0,5 сек за уровень.",
    category: "time",
    icon: "⌛",
    maxLevel: 4,
    baseCost: 36,
    growth: 1.48,
    requires: ["time_extra_breath"],
    apply: (stats, level) => add(stats, "runDuration", 0.5 * level),
  }),
  defineUpgrade({
    id: "time_stolen_second",
    name: "Украденная секунда",
    description: "Начальный таймер +0,75 сек за уровень.",
    category: "time",
    icon: "◴",
    maxLevel: 3,
    baseCost: 64,
    growth: 1.53,
    requires: ["time_wound_spring"],
    apply: (stats, level) => add(stats, "runDuration", 0.75 * level),
  }),
  defineUpgrade({
    id: "time_clockwork_heart",
    name: "Заводное сердце",
    description: "Начальный таймер +0,6 сек за уровень.",
    category: "time",
    icon: "♥",
    maxLevel: 5,
    baseCost: 89,
    growth: 1.47,
    requires: ["time_sand_reserve"],
    apply: (stats, level) => add(stats, "runDuration", 0.6 * level),
  }),
  defineUpgrade({
    id: "time_capsule",
    name: "Капсула времени",
    description: "Начальный таймер +1 сек за уровень.",
    category: "time",
    icon: "⬡",
    maxLevel: 3,
    baseCost: 145,
    growth: 1.57,
    requires: ["time_stolen_second", "time_clockwork_heart"],
    apply: (stats, level) => add(stats, "runDuration", 1 * level),
  }),
  defineUpgrade({
    id: "time_overtime_protocol",
    name: "Протокол сверхурочных",
    description: "Начальный таймер +1,25 сек за уровень.",
    category: "time",
    icon: "+",
    maxLevel: 3,
    baseCost: 235,
    growth: 1.61,
    requires: ["time_capsule"],
    apply: (stats, level) => add(stats, "runDuration", 1.25 * level),
  }),
  defineUpgrade({
    id: "time_frozen_moment",
    name: "Замёрзший миг",
    description: "В начале забега таймер не убывает 0,4 сек за уровень.",
    category: "time",
    icon: "❄",
    maxLevel: 4,
    baseCost: 120,
    growth: 1.51,
    requires: ["time_clockwork_heart"],
    apply: (stats, level) => add(stats, "startTimeFreeze", 0.4 * level),
  }),
  defineUpgrade({
    id: "time_aftershock_clock",
    name: "Часы отдачи",
    description: "Разрушение руды с шансом 2% за уровень возвращает 0,12 сек.",
    category: "time",
    icon: "◶",
    maxLevel: 5,
    baseCost: 180,
    growth: 1.55,
    requires: ["time_frozen_moment"],
    apply: (stats, level) => {
      add(stats, "timeRefundChance", 0.02 * level);
      add(stats, "timeRefundAmount", 0.12 * level);
    },
  }),
  defineUpgrade({
    id: "time_last_second",
    name: "Последняя секунда",
    description: "Один раз за забег таймер спасает шахтёра ещё на 1 секунду.",
    category: "time",
    icon: "!",
    maxLevel: 1,
    baseCost: 390,
    growth: 1,
    requires: ["time_overtime_protocol"],
    apply: (stats, level) => {
      add(stats, "lastChanceCharges", level);
      add(stats, "lastChanceSeconds", level);
    },
  }),
  defineUpgrade({
    id: "time_chrono_shard",
    name: "Хроноосколок",
    description: "Руда с шансом 1,5% за уровень роняет осколок на 0,3 сек.",
    category: "time",
    icon: "✧",
    maxLevel: 5,
    baseCost: 330,
    growth: 1.58,
    requires: ["time_aftershock_clock"],
    apply: (stats, level) => {
      add(stats, "timeShardChance", 0.015 * level);
      add(stats, "timeShardSeconds", 0.3 + 0.04 * Math.max(0, level - 1));
    },
  }),
  defineUpgrade({
    id: "time_elastic_second",
    name: "Эластичная секунда",
    description: "Таймер убывает на 3% медленнее за уровень.",
    category: "time",
    icon: "∿",
    maxLevel: 4,
    baseCost: 470,
    growth: 1.61,
    requires: ["time_last_second", "time_chrono_shard"],
    apply: (stats, level) => add(stats, "timerDrainReduction", 0.03 * level),
  }),
  defineUpgrade({
    id: "time_deep_shift",
    name: "Глубинная смена",
    description: "Начальный таймер +1,2 сек за уровень.",
    category: "time",
    icon: "▣",
    maxLevel: 4,
    baseCost: 620,
    growth: 1.63,
    requires: ["time_elastic_second"],
    apply: (stats, level) => add(stats, "runDuration", 1.2 * level),
  }),
  defineUpgrade({
    id: "time_keeper",
    name: "Хранитель хода",
    description: "Начальный таймер +1,5 сек и возврат времени +10% за уровень.",
    category: "time",
    icon: "♜",
    maxLevel: 3,
    baseCost: 980,
    growth: 1.69,
    requires: ["time_deep_shift", "time_chrono_shard"],
    apply: (stats, level) => {
      add(stats, "runDuration", 1.5 * level);
      add(stats, "timeRefundMultiplier", 0.1 * level);
    },
  }),
  defineUpgrade({
    id: "time_discovery_bonus",
    name: "Премия за открытие",
    description: "Первый добытый кусок каждого нового типа руды за забег возвращает 0,15 секунды за уровень. Бонусное время ограничено общей отметкой 60 секунд.",
    category: "time",
    icon: "◴",
    maxLevel: 3,
    baseCost: 680,
    growth: 1.64,
    requires: ["time_aftershock_clock", "fortune_glimmer_hunter"],
    apply: (stats, level) => add(stats, "discoveryTimeBonus", 0.15 * level),
  }),
  defineUpgrade({
    id: "time_thirty_second_oath",
    name: "Клятва сорока пяти секунд",
    description: "Доводит таймер до 45 секунд; лишняя хроноэнергия ускоряет инструмент.",
    category: "time",
    icon: "45",
    maxLevel: 1,
    baseCost: 3200,
    growth: 1,
    requires: [
      { id: "time_keeper", level: 3 },
      { id: "time_deep_shift", level: 3 },
      { id: "time_overtime_protocol", level: 3 },
      { id: "time_capsule", level: 3 },
      { id: "time_clockwork_heart", level: 4 },
      { id: "time_stolen_second", level: 3 },
      { id: "time_last_second", level: 1 },
    ],
    apply: (stats, level) => {
      if (level > 0) {
        stats.runDuration = stats.maxRunDuration;
        stats.chronoOverclock = true;
      }
    },
  }),
];

const timeUpgrades = [
  defineUpgrade({
    id: "time_extra_breath",
    name: "Запас смены",
    description: "Начальный таймер +0,5 секунды за уровень. 12 уровней дают первые дополнительные 6 секунд.",
    category: "time",
    icon: "◷",
    maxLevel: 12,
    baseCost: 4,
    growth: 1.27,
    requires: ["core_first_descent"],
    apply: (stats, level) => add(stats, "runDuration", 0.5 * level),
  }),
  defineUpgrade({
    id: "time_clockwork_heart",
    name: "Заводное сердце",
    description: "Таймер +0,75 секунды за уровень. На 4-м уровне даёт стартовую паузу, на 8-м — возврат времени, на 12-м — один аварийный заряд.",
    category: "time",
    layoutLobe: "dig",
    icon: "♥",
    maxLevel: 12,
    baseCost: 22,
    growth: 1.32,
    requires: [
      { id: "time_extra_breath", level: 4 },
      { id: "dig_light_footwork", level: 3 },
    ],
    apply: (stats, level) => {
      add(stats, "runDuration", 0.75 * level);
      if (level >= 4) add(stats, "startTimeFreeze", 0.5);
      if (level >= 8) {
        add(stats, "timeRefundChance", 0.08 + (level - 8) * 0.01);
        add(stats, "timeRefundAmount", 0.2 + (level - 8) * 0.03);
      }
      if (level >= 12) {
        add(stats, "lastChanceCharges", 1);
        add(stats, "lastChanceSeconds", 1.25);
      }
    },
  }),
  defineUpgrade({
    id: "time_capsule",
    name: "Капсула времени",
    description: "Таймер +2 секунды за уровень. Первый образец нового типа руды возвращает до 0,48 секунды; поздние уровни открывают хроноосколки. Бонусы ограничены 60 секундами.",
    category: "time",
    layoutLobe: "tools",
    icon: "⬡",
    maxLevel: 12,
    baseCost: 150,
    growth: 1.38,
    requires: [
      { id: "time_clockwork_heart", level: 6 },
      { id: "tools_balanced_handle", level: 5 },
    ],
    apply: (stats, level) => {
      add(stats, "runDuration", 2 * level);
      add(stats, "discoveryTimeBonus", 0.04 * level);
      if (level >= 8) {
        add(stats, "timeShardChance", 0.04 + (level - 8) * 0.005);
        add(stats, "timeShardSeconds", 0.24 + (level - 8) * 0.02);
      }
    },
  }),
  defineUpgrade({
    id: "time_thirty_second_oath",
    name: "Клятва сорока пяти секунд",
    description: "Закрепляет полностью собранный 45-секундный таймер и превращает лишнюю хроноэнергию в ускорение инструмента.",
    category: "time",
    layoutLobe: "power",
    icon: "45",
    maxLevel: 1,
    baseCost: 3200,
    growth: 1,
    requires: [
      { id: "time_extra_breath", level: 12 },
      { id: "time_clockwork_heart", level: 12 },
      { id: "time_capsule", level: 12 },
    ],
    recipeOverride: { prism_crystal: 14, void_ore: 4 },
    apply: (stats, level) => {
      if (level > 0) stats.chronoOverclock = true;
    },
  }),
];

const gadgetUpgrades = [
  defineUpgrade({
    id: "gadgets_powder_pocket",
    name: "Карман пороха",
    description: "Удар с шансом 2% за уровень выбрасывает бомбочку.",
    category: "gadgets",
    icon: "●",
    maxLevel: 5,
    baseCost: 8,
    growth: 1.4,
    requires: ["core_first_descent"],
    apply: (stats, level) => add(stats, "bombChance", 0.02 * level),
  }),
  defineUpgrade({
    id: "gadgets_packed_charge",
    name: "Плотный заряд",
    description: "Урон бомб +18% за уровень.",
    category: "gadgets",
    icon: "✹",
    maxLevel: 7,
    baseCost: 26,
    growth: 1.42,
    requires: ["gadgets_powder_pocket"],
    apply: (stats, level) => add(stats, "bombPower", 0.18 * level),
  }),
  defineUpgrade({
    id: "gadgets_wide_fuse",
    name: "Широкий фитиль",
    description: "Радиус взрыва +5 за уровень.",
    category: "gadgets",
    icon: "◉",
    maxLevel: 6,
    baseCost: 34,
    growth: 1.43,
    requires: ["gadgets_powder_pocket"],
    apply: (stats, level) => add(stats, "bombRadius", 5 * level),
  }),
  defineUpgrade({
    id: "gadgets_cluster_shell",
    name: "Кассетная оболочка",
    description: "Взрыв создаёт по одному осколочному заряду за уровень.",
    category: "gadgets",
    icon: "⁙",
    maxLevel: 3,
    baseCost: 78,
    growth: 1.52,
    requires: ["gadgets_packed_charge", "gadgets_wide_fuse"],
    apply: (stats, level) => {
      add(stats, "bombFragments", level);
      add(stats, "bombFragmentPower", 0.06 * level);
    },
  }),
  defineUpgrade({
    id: "gadgets_sticky_charge",
    name: "Липкий заряд",
    description: "Шанс приклеить усиленную бомбу к руде +7% за уровень.",
    category: "gadgets",
    icon: "⬢",
    maxLevel: 5,
    baseCost: 95,
    growth: 1.49,
    requires: ["gadgets_packed_charge"],
    apply: (stats, level) => add(stats, "stickyBombChance", 0.07 * level),
  }),
  defineUpgrade({
    id: "gadgets_chain_spark",
    name: "Цепная искра",
    description: "Удар с шансом 3% за уровень перескакивает на соседнюю руду.",
    category: "gadgets",
    icon: "ϟ",
    maxLevel: 6,
    baseCost: 112,
    growth: 1.48,
    requires: ["gadgets_wide_fuse"],
    apply: (stats, level) => add(stats, "chainChance", 0.03 * level),
  }),
  defineUpgrade({
    id: "gadgets_chain_links",
    name: "Звенья разряда",
    description: "Цепной удар получает +1 цель и +5% силы за уровень.",
    category: "gadgets",
    icon: "⛓",
    maxLevel: 4,
    baseCost: 170,
    growth: 1.54,
    requires: ["gadgets_chain_spark"],
    apply: (stats, level) => {
      add(stats, "chainCount", level);
      add(stats, "chainPower", 0.05 * level);
    },
  }),
  defineUpgrade({
    id: "gadgets_shock_capsule",
    name: "Шок-капсула",
    description: "Разряд удерживается на цели на 0,12 сек дольше за уровень.",
    category: "gadgets",
    icon: "☇",
    maxLevel: 5,
    baseCost: 205,
    growth: 1.52,
    requires: ["gadgets_chain_links"],
    apply: (stats, level) => add(stats, "shockDuration", 0.12 * level),
  }),
  defineUpgrade({
    id: "gadgets_magnet_mine",
    name: "Магнитная мина",
    description: "Магнит стягивает осколки: радиус сбора и поиска дронов +14 за уровень.",
    category: "gadgets",
    layoutLobe: "fortune",
    icon: "∩",
    maxLevel: 6,
    baseCost: 72,
    growth: 1.45,
    requires: ["gadgets_powder_pocket"],
    apply: (stats, level) => add(stats, "pickupRadius", 14 * level),
  }),
  defineUpgrade({
    id: "gadgets_scout_drone",
    name: "Дрон-разведчик",
    description: "Открывает дрона, который сам ищет и бьёт руду.",
    category: "gadgets",
    icon: "▣",
    maxLevel: 1,
    baseCost: 280,
    growth: 1,
    requires: ["gadgets_magnet_mine", "sense_echo_pulse"],
    apply: (stats, level) => {
      if (level > 0) stats.droneUnlocked = true;
      add(stats, "droneCount", level);
    },
  }),
  defineUpgrade({
    id: "gadgets_drone_battery",
    name: "Батарея дрона",
    description: "Скорость и доля смены, когда работают дроны, +12% за уровень.",
    category: "gadgets",
    icon: "▥",
    maxLevel: 5,
    baseCost: 360,
    growth: 1.55,
    requires: ["gadgets_scout_drone"],
    apply: (stats, level) => {
      add(stats, "droneSpeed", 0.12 * level);
      add(stats, "droneLifetime", 0.12 * level);
    },
  }),
  defineUpgrade({
    id: "gadgets_drone_drill",
    name: "Бур дрона",
    description: "Сила дронов +22% за уровень.",
    category: "gadgets",
    icon: "⚙",
    maxLevel: 6,
    baseCost: 410,
    growth: 1.55,
    requires: ["gadgets_scout_drone"],
    apply: (stats, level) => add(stats, "dronePower", 0.22 * level),
  }),
  defineUpgrade({
    id: "gadgets_drone_swarm",
    name: "Рой проходчиков",
    description: "Добавляет по одному дрону за уровень.",
    category: "gadgets",
    icon: "⬡",
    maxLevel: 3,
    baseCost: 690,
    growth: 1.68,
    requires: ["gadgets_drone_battery", "gadgets_drone_drill"],
    apply: (stats, level) => add(stats, "droneCount", level),
  }),
  defineUpgrade({
    id: "gadgets_volatile_jackpot",
    name: "Взрывной куш",
    description: "Шанс гигантской бомбы +1,5%, выход взорванной руды +8% за уровень.",
    category: "gadgets",
    icon: "✺",
    maxLevel: 5,
    baseCost: 580,
    growth: 1.6,
    requires: ["gadgets_cluster_shell", "gadgets_sticky_charge"],
    apply: (stats, level) => {
      add(stats, "volatileBombChance", 0.015 * level);
      add(stats, "bombValueMultiplier", 0.08 * level);
    },
  }),
  defineUpgrade({
    id: "gadgets_geo_charge",
    name: "Кумулятивный геозаряд",
    description: "Бомбы взрываются направленным конусом к цели; каждый уровень удлиняет конус на один блок.",
    category: "gadgets",
    icon: "◁",
    maxLevel: 3,
    baseCost: 920,
    growth: 1.66,
    requires: ["gadgets_cluster_shell", "power_tectonic_blow"],
    apply: (stats, level) => {
      if (level > 0) stats.directionalBombs = true;
      add(stats, "directionalBombConeTiles", level);
    },
  }),
  defineUpgrade({
    id: "gadgets_crew_beacon",
    name: "Маяк артели",
    description: "Меченая жила становится общей целью дронов, цепных разрядов и липких бомб; лишний урон переносится на соседний кусок той же жилы.",
    category: "gadgets",
    icon: "⌖",
    maxLevel: 1,
    baseCost: 1600,
    growth: 1,
    requires: ["gadgets_scout_drone", "gadgets_sticky_charge", "sense_ore_focus"],
    apply: (stats, level) => {
      if (level > 0) {
        stats.crewBeaconUnlocked = true;
        stats.crewBeaconOverkillCarry = 1;
      }
    },
  }),
  defineUpgrade({
    id: "gadgets_demolition_orchestra",
    name: "Оркестр подрывников",
    description: "Бомбы, цепи и дроны усиливают друг друга на 25%.",
    category: "gadgets",
    icon: "♫",
    maxLevel: 1,
    baseCost: 2400,
    growth: 1,
    requires: ["gadgets_drone_swarm", "gadgets_volatile_jackpot", "gadgets_shock_capsule"],
    apply: (stats, level) => {
      add(stats, "bombPower", 0.25 * level);
      add(stats, "chainPower", 0.25 * level);
      add(stats, "dronePower", 0.25 * level);
      add(stats, "droneBombChance", 0.08 * level);
    },
  }),
];

const toolUpgrades = [
  defineUpgrade({
    id: "tools_balanced_handle",
    name: "Сбалансированная рукоять",
    description: "Скорость ударов +5% за уровень. Узел объединяет базовый разгон и прежнюю тренировку ритма.",
    category: "tools",
    layoutLobe: "dig",
    icon: "⚒",
    maxLevel: 12,
    baseCost: 7,
    growth: 1.32,
    requires: ["core_first_descent"],
    apply: (stats, level) => add(stats, "digSpeedMultiplier", 0.05 * level),
  }),
  defineUpgrade({
    id: "tools_iron_pick",
    name: "Железная кирка",
    description: "Инструмент II ранга: сила +12%, скорость +5%.",
    category: "tools",
    icon: "⛏",
    maxLevel: 1,
    baseCost: 32,
    growth: 1,
    requires: ["tools_balanced_handle"],
    apply: (stats, level) => {
      if (level > 0) {
        stats.tool = "ironPick";
        stats.toolTier = Math.max(stats.toolTier, 2);
      }
      add(stats, "pickPowerMultiplier", 0.12 * level);
      add(stats, "digSpeedMultiplier", 0.05 * level);
    },
  }),
  defineUpgrade({
    id: "tools_steel_pick",
    name: "Стальная кирка",
    description: "Инструмент III ранга: сила +18%, дальность +8%.",
    category: "tools",
    icon: "⚒",
    maxLevel: 1,
    baseCost: 105,
    growth: 1,
    requires: ["tools_iron_pick", "power_tempered_steel"],
    apply: (stats, level) => {
      if (level > 0) {
        stats.tool = "steelPick";
        stats.toolTier = Math.max(stats.toolTier, 3);
      }
      add(stats, "pickPowerMultiplier", 0.18 * level);
      add(stats, "digReachMultiplier", 0.08 * level);
    },
  }),
  defineUpgrade({
    id: "tools_pneumatic_pick",
    name: "Пневматическая кирка",
    description: "Инструмент IV ранга: скорость ударов +25%.",
    category: "tools",
    icon: "⚙",
    maxLevel: 1,
    baseCost: 260,
    growth: 1,
    requires: ["tools_steel_pick", { id: "tools_balanced_handle", level: 6 }],
    apply: (stats, level) => {
      if (level > 0) {
        stats.tool = "pneumaticPick";
        stats.toolTier = Math.max(stats.toolTier, 4);
      }
      add(stats, "digSpeedMultiplier", 0.25 * level);
    },
  }),
  defineUpgrade({
    id: "tools_super_pick",
    name: "Суперкирка",
    description: "Инструмент V ранга: огромная сила и два удара за замах.",
    category: "tools",
    icon: "★",
    maxLevel: 1,
    baseCost: 620,
    growth: 1,
    requires: ["tools_pneumatic_pick", "power_diamond_tip"],
    apply: (stats, level) => {
      if (level > 0) {
        stats.tool = "superPick";
        stats.toolTier = Math.max(stats.toolTier, 5);
        stats.superPickUnlocked = true;
      }
      add(stats, "pickPowerMultiplier", 0.35 * level);
      add(stats, "multiHitCount", level);
    },
  }),
  defineUpgrade({
    id: "tools_super_motor",
    name: "Мотор суперкирки",
    description: "Скорость суперкирки +9% за уровень.",
    category: "tools",
    icon: "⚙",
    maxLevel: 5,
    baseCost: 760,
    growth: 1.56,
    requires: ["tools_super_pick"],
    apply: (stats, level) => add(stats, "digSpeedMultiplier", 0.09 * level),
  }),
  defineUpgrade({
    id: "tools_super_teeth",
    name: "Зубья суперкирки",
    description: "Сила суперкирки +13% за уровень.",
    category: "tools",
    icon: "▴",
    maxLevel: 5,
    baseCost: 810,
    growth: 1.57,
    requires: ["tools_super_pick"],
    apply: (stats, level) => add(stats, "pickPowerMultiplier", 0.13 * level),
  }),
  defineUpgrade({
    id: "tools_super_field",
    name: "Поле суперкирки",
    description: "Радиус урона +7 и урон по площади +6% за уровень.",
    category: "tools",
    icon: "◌",
    maxLevel: 4,
    baseCost: 980,
    growth: 1.6,
    requires: ["tools_super_motor", "tools_super_teeth"],
    apply: (stats, level) => {
      add(stats, "splashRadius", 7 * level);
      add(stats, "splashDamage", 0.06 * level);
    },
  }),
  defineUpgrade({
    id: "tools_laser_emitter",
    name: "Дальнобойный лазер",
    description: "Инструмент VI ранга: заменяет кирку лучом, достающим далёкую руду.",
    category: "tools",
    icon: "━",
    maxLevel: 1,
    baseCost: 2400,
    growth: 1,
    requires: ["tools_super_field", "sense_far_echo", "tools_super_pick"],
    apply: (stats, level) => {
      if (level > 0) {
        stats.tool = "miningLaser";
        stats.toolTier = Math.max(stats.toolTier, 6);
        stats.laserUnlocked = true;
      }
      add(stats, "laserPower", 0.7 * level);
    },
  }),
  defineUpgrade({
    id: "tools_laser_range",
    name: "Телескопический луч",
    description: "Дальность лазера +50 за уровень. В этом узле объединены линза и телескопическая настройка.",
    category: "tools",
    icon: "⟶",
    maxLevel: 10,
    baseCost: 2750,
    growth: 1.5,
    requires: ["tools_laser_emitter"],
    apply: (stats, level) => add(stats, "laserRange", 50 * level),
  }),
  defineUpgrade({
    id: "tools_laser_power",
    name: "Резонатор луча",
    description: "Мощность лазера +18% за уровень.",
    category: "tools",
    icon: "═",
    maxLevel: 6,
    baseCost: 2920,
    growth: 1.59,
    requires: ["tools_laser_emitter"],
    apply: (stats, level) => add(stats, "laserPower", 0.18 * level),
  }),
  defineUpgrade({
    id: "tools_laser_width",
    name: "Расширитель луча",
    description: "Ширина лазера +3 и урон соседям +4% за уровень.",
    category: "tools",
    icon: "▰",
    maxLevel: 5,
    baseCost: 3400,
    growth: 1.61,
    requires: ["tools_laser_power"],
    apply: (stats, level) => {
      add(stats, "laserWidth", 3 * level);
      add(stats, "splashDamage", 0.04 * level);
    },
  }),
  defineUpgrade({
    id: "tools_laser_splitter",
    name: "Призматический делитель",
    description: "Добавляет боковой луч; следующий уровень усиливает расщепление.",
    category: "tools",
    icon: "⋔",
    maxLevel: 3,
    baseCost: 4800,
    growth: 1.7,
    requires: ["tools_laser_range", "tools_laser_width"],
    apply: (stats, level) => {
      add(stats, "laserBeams", level);
      add(stats, "laserPierce", 0.18 * level);
    },
  }),
  defineUpgrade({
    id: "tools_mirror_crystal",
    name: "Зеркальный кристалл",
    description: "Лазер отражается к найденной руде за углом: первое отражение сохраняет 65% мощности, второе — 45%. При фокусе ищет только выбранную руду.",
    category: "tools",
    icon: "◈",
    maxLevel: 2,
    baseCost: 3600,
    growth: 1.72,
    requires: ["tools_laser_emitter", "sense_ore_focus"],
    apply: (stats, level) => {
      add(stats, "laserRicochetCount", level);
      stats.laserFirstRicochetMultiplier = 0.65;
      stats.laserSecondRicochetMultiplier = 0.45;
    },
  }),
  defineUpgrade({
    id: "tools_super_pick_echo",
    name: "Эхо суперкирки",
    description: "Каждый 6-й/4-й основной выстрел лазера создаёт в точке попадания круговой удар радиусом 1/1,4 блока и силой 60/85% прямого удара. Эхо не вызывает критов и дополнительных срабатываний.",
    category: "tools",
    icon: "✹",
    maxLevel: 2,
    baseCost: 4600,
    growth: 1.74,
    requires: ["tools_laser_emitter", "dig_omni_swing"],
    apply: (stats, level) => {
      stats.laserSuperPickEchoEvery = [0, 6, 4][level] || 6;
      stats.laserSuperPickEchoRadiusTiles = [0, 1, 1.4][level] || 1;
      stats.laserSuperPickEchoPower = [0, 0.6, 0.85][level] || 0.6;
      stats.laserSuperPickEchoNoProcs = true;
    },
  }),
  defineUpgrade({
    id: "tools_solar_drill",
    name: "Солнечный бур",
    description: "Лазер становится призмобуром: +35% мощности и быстрее заряжается.",
    category: "tools",
    icon: "☀",
    maxLevel: 1,
    baseCost: 12000,
    growth: 1,
    requires: [
      { id: "tools_laser_splitter", level: 2 },
      { id: "power_corebreaker", level: 2 },
    ],
    apply: (stats, level) => {
      if (level > 0) {
        stats.tool = "prismaticLaser";
        stats.toolTier = Math.max(stats.toolTier, 7);
      }
      add(stats, "laserPower", 0.35 * level);
      add(stats, "laserChargeRate", 0.25 * level);
    },
  }),
];

const fortuneUpgrades = [
  defineUpgrade({
    id: "fortune_prospector_ledger",
    name: "Дневник старателя",
    description: "Средний выход кусков руды +4% за уровень. Базовая оценка добычи собрана в одном узле.",
    category: "fortune",
    layoutLobe: "sense",
    icon: "▤",
    maxLevel: 18,
    baseCost: 5,
    growth: 1.3,
    requires: ["core_first_descent"],
    apply: (stats, level) => add(stats, "oreValueMultiplier", 0.04 * level),
  }),
  defineUpgrade({
    id: "fortune_lucky_chip",
    name: "Счастливый жетон",
    description: "Удача +4% за уровень; влияет на все редкие срабатывания.",
    category: "fortune",
    icon: "✦",
    maxLevel: 7,
    baseCost: 23,
    growth: 1.41,
    requires: ["fortune_prospector_ledger"],
    apply: (stats, level) => add(stats, "luck", 0.04 * level),
  }),
  defineUpgrade({
    id: "fortune_glimmer_hunter",
    name: "Охотник за блеском",
    description: "Шанс редкой руды +3% за уровень.",
    category: "fortune",
    icon: "✧",
    maxLevel: 6,
    baseCost: 42,
    growth: 1.45,
    requires: ["fortune_lucky_chip"],
    apply: (stats, level) => add(stats, "rareOreChance", 0.03 * level),
  }),
  defineUpgrade({
    id: "fortune_gem_polish",
    name: "Огранка самоцветов",
    description: "Аметист и более редкие жилы дают на 9% больше кусков за уровень.",
    category: "fortune",
    icon: "◇",
    maxLevel: 6,
    baseCost: 58,
    growth: 1.47,
    requires: [{ id: "fortune_prospector_ledger", level: 6 }],
    apply: (stats, level) => add(stats, "gemValueMultiplier", 0.09 * level),
  }),
  defineUpgrade({
    id: "fortune_rich_vein",
    name: "Богатая жила",
    description: "Шанс заменить обычную жилу богатой +2,5% за уровень.",
    category: "fortune",
    icon: "▦",
    maxLevel: 6,
    baseCost: 88,
    growth: 1.48,
    requires: ["fortune_glimmer_hunter"],
    apply: (stats, level) => add(stats, "richVeinChance", 0.025 * level),
  }),
  defineUpgrade({
    id: "fortune_double_yield",
    name: "Двойная добыча",
    description: "Шанс получить двойную награду +3% за уровень.",
    category: "fortune",
    icon: "Ⅱ",
    maxLevel: 6,
    baseCost: 112,
    growth: 1.5,
    requires: [{ id: "fortune_prospector_ledger", level: 6 }],
    apply: (stats, level) => {
      add(stats, "doubleDropChance", 0.03 * level);
      add(stats, "extraYieldChance", 0.03 * level);
    },
  }),
  defineUpgrade({
    id: "fortune_triple_seam",
    name: "Тройной пласт",
    description: "Шанс тройной награды +1% за уровень.",
    category: "fortune",
    icon: "Ⅲ",
    maxLevel: 5,
    baseCost: 190,
    growth: 1.55,
    requires: ["fortune_double_yield", "fortune_rich_vein"],
    apply: (stats, level) => add(stats, "tripleDropChance", 0.01 * level),
  }),
  defineUpgrade({
    id: "fortune_alchemist_scales",
    name: "Весы алхимика",
    description: "Лишний урон превращается в +4% выхода руды за уровень.",
    category: "fortune",
    icon: "⚖",
    maxLevel: 5,
    baseCost: 230,
    growth: 1.54,
    requires: ["fortune_gem_polish", "power_shatterpoint"],
    apply: (stats, level) => add(stats, "oreConversionBonus", 0.04 * level),
  }),
  defineUpgrade({
    id: "fortune_deep_market",
    name: "Глубинная биржа",
    description: "Бонус выхода руды за глубину +8% за уровень.",
    category: "fortune",
    icon: "↧",
    maxLevel: 6,
    baseCost: 285,
    growth: 1.56,
    requires: ["fortune_gem_polish"],
    apply: (stats, level) => add(stats, "depthValueBonus", 0.08 * level),
  }),
  defineUpgrade({
    id: "fortune_golden_touch",
    name: "Золотое касание",
    description: "Шанс сделать найденную руду золотой +1,5% за уровень.",
    category: "fortune",
    icon: "☀",
    maxLevel: 5,
    baseCost: 420,
    growth: 1.59,
    requires: ["fortune_triple_seam"],
    apply: (stats, level) => add(stats, "goldenOreChance", 0.015 * level),
  }),
  defineUpgrade({
    id: "fortune_relic_magnet",
    name: "Магнит реликвий",
    description: "Шанс реликвии +1% и радиус подбора +10 за уровень.",
    category: "fortune",
    icon: "⌑",
    maxLevel: 5,
    baseCost: 510,
    growth: 1.6,
    requires: ["fortune_lucky_chip", "gadgets_magnet_mine"],
    apply: (stats, level) => {
      add(stats, "relicChance", 0.01 * level);
      add(stats, "pickupRadius", 10 * level);
    },
  }),
  defineUpgrade({
    id: "fortune_kings_ransom",
    name: "Королевский выкуп",
    description: "Выход руды +12% и шанс дополнительного куска +5% за уровень.",
    category: "fortune",
    icon: "♛",
    maxLevel: 4,
    baseCost: 720,
    growth: 1.64,
    requires: ["fortune_deep_market", "fortune_golden_touch"],
    apply: (stats, level) => {
      add(stats, "oreValueMultiplier", 0.12 * level);
      add(stats, "extraYieldChance", 0.05 * level);
    },
  }),
  defineUpgrade({
    id: "fortune_wheel",
    name: "Колесо фортуны",
    description: "Шанс любого редкого эффекта +2% за уровень.",
    category: "fortune",
    icon: "⊛",
    maxLevel: 4,
    baseCost: 960,
    growth: 1.67,
    requires: ["fortune_relic_magnet", "fortune_kings_ransom"],
    apply: (stats, level) => add(stats, "fortuneProcChance", 0.02 * level),
  }),
  defineUpgrade({
    id: "fortune_findings_catalog",
    name: "Каталог находок",
    description: "Каждый дополнительный тип руды, добытый в текущем забеге, повышает итоговую добычу на 2% за уровень.",
    category: "fortune",
    icon: "▤",
    maxLevel: 3,
    baseCost: 550,
    growth: 1.62,
    requires: ["fortune_deep_market", "sense_vein_whisper"],
    apply: (stats, level) => add(stats, "oreDiversityBonusPerType", 0.02 * level),
  }),
  defineUpgrade({
    id: "fortune_motherlode_covenant",
    name: "Договор с Материнской жилой",
    description: "Даёт шанс открыть сверхбогатую жилу и повышает выход всей руды на 25%.",
    category: "fortune",
    icon: "♢",
    maxLevel: 1,
    baseCost: 2600,
    growth: 1,
    requires: ["fortune_wheel", "fortune_alchemist_scales"],
    apply: (stats, level) => {
      add(stats, "motherlodeChance", 0.04 * level);
      add(stats, "oreValueMultiplier", 0.25 * level);
    },
  }),
];

const coreFinalUpgrade = defineUpgrade({
  id: "core_bon_voyage",
  name: "В добрый путь",
  description: "Все семь путей освоены. Пора завершить работу на этой планете и отправляться дальше.",
  category: "core",
  icon: "🚀",
  maxLevel: 1,
  baseCost: 24000,
  growth: 1,
  requires: [
    "sense_earth_call",
    "dig_quarry_presence",
    "power_mountain_splitter",
    "time_thirty_second_oath",
    "gadgets_demolition_orchestra",
    "tools_solar_drill",
    "fortune_motherlode_covenant",
  ],
  recipeOverride: {
    prism_crystal: 500,
    void_ore: 300,
    star_core: 500,
  },
  apply: (stats, level) => {
    if (level > 0) stats.bonVoyageUnlocked = true;
  },
});

// The spreads intentionally keep the exported catalog grouped by category.
const UPGRADE_DEFS = Object.freeze([
  coreRootUpgrade,
  ...senseUpgrades,
  ...digUpgrades,
  ...powerUpgrades,
  ...timeUpgrades,
  ...gadgetUpgrades,
  ...toolUpgrades,
  ...fortuneUpgrades,
  coreFinalUpgrade,
]);

/** Create a fresh mutable stat block for one meta-progression calculation. */
function createBaseMetaStats() {
  return {
    // Detection and autonomous targeting.
    senseRadius: 76,
    senseRadiusMultiplier: 1,
    sensePulseSpeed: 1,
    sensePersistence: 0.7,
    senseThroughWalls: false,
    deepOreSenseBonus: 0,
    veinRevealChance: 0,
    targetLockSpeed: 1,
    targetValueBias: 0.12,
    backupTargetSlots: 0,
    oreOutline: false,
    oreFocusUnlocked: false,
    oreFocusRadiusMultiplier: 1,
    oreFocusEscalationDelay: 0,
    oreFocusEscalationBonus: 0,
    deafKnockStoneThreshold: 0,
    deafKnockSenseRadiusMultiplier: 1,
    deafKnockMoveSpeedBonus: 0,
    deafKnockMoveDuration: 0,
    deafKnockCooldown: 0,
    deafKnockFocusOnly: false,
    triangularFixUnlocked: false,
    triangularFixOreMemory: 0,
    triangularFixDronePriority: false,
    triangularFixGadgetDamageBonus: 0,
    triangularFixRangeBonus: 0,
    bonVoyageUnlocked: false,

    // Movement and mining geometry.
    moveSpeed: 82,
    moveSpeedMultiplier: 1,
    mineMoveMultiplier: 1,
    digReach: 38,
    digRadius: 8,
    areaMiningUnlocked: false,
    digReachMultiplier: 1,
    digArc: Math.PI / 3,
    digSpeed: 2.25,
    digSpeedMultiplier: 1,
    aimTurnSpeed: 1,
    multiHitChance: 0,
    multiHitCount: 1,
    splashRadius: 0,
    splashDamage: 0,
    leastResistancePathing: false,
    mineLiftRecordDepthRatio: 0,

    // Direct mining damage.
    pickPower: 1,
    pickPowerMultiplier: 1,
    hardnessPierce: 0,
    critChance: 0.02,
    critMultiplier: 1.75,
    breakSplashChance: 0,
    breakSplashPower: 0.25,
    streakPower: 0,
    streakCap: 0,
    comboWindow: 0.72,
    comboMultiplier: 1,
    oreDamageBonus: 0,
    rareOreDamageBonus: 0,
    chargedHitPower: 0,
    overkillCarry: 0,
    focusedOreHardnessReduction: 0,

    // Permanent upgrades stay between 6 and 45 seconds; in-run bonuses can
    // extend the live countdown only as far as the separate 60-second cap.
    runDuration: 6,
    maxRunDuration: 45,
    bonusRunDurationCap: 60,
    discoveryTimeBonus: 0,
    startTimeFreeze: 0,
    timeRefundChance: 0,
    timeRefundAmount: 0,
    timeRefundMultiplier: 1,
    timeShardChance: 0,
    timeShardSeconds: 0,
    lastChanceCharges: 0,
    lastChanceSeconds: 0,
    timerDrainReduction: 0,
    timerDrainMultiplier: 1,
    chronoOverclock: false,

    // Gadgets.
    bombChance: 0,
    bombPower: 1,
    bombRadius: 34,
    bombFragments: 0,
    bombFragmentPower: 0.3,
    stickyBombChance: 0,
    volatileBombChance: 0,
    bombValueMultiplier: 1,
    directionalBombs: false,
    directionalBombConeTiles: 0,
    chainChance: 0,
    chainCount: 1,
    chainPower: 0.55,
    shockDuration: 0,
    pickupRadius: 46,
    droneUnlocked: false,
    droneCount: 0,
    dronePower: 0.35,
    droneSpeed: 1,
    droneLifetime: 0.45,
    droneBombChance: 0,
    crewBeaconUnlocked: false,
    crewBeaconOverkillCarry: 0,

    // Tool progression.
    tool: "pickaxe",
    toolTier: 1,
    superPickUnlocked: false,
    laserUnlocked: false,
    laserRange: 185,
    laserPower: 1,
    laserWidth: 8,
    laserPierce: 1,
    laserBeams: 1,
    laserChargeRate: 1,
    laserRicochetCount: 0,
    laserFirstRicochetMultiplier: 0.65,
    laserSecondRicochetMultiplier: 0.45,
    laserSuperPickEchoEvery: 0,
    laserSuperPickEchoRadiusTiles: 0,
    laserSuperPickEchoPower: 0,
    laserSuperPickEchoNoProcs: false,

    // Rewards and procedural fortune. Consumers combine `luck` and explicit
    // proc chances; this module does not roll random values itself.
    oreValueMultiplier: 1,
    luck: 0,
    rareOreChance: 0,
    gemValueMultiplier: 1,
    richVeinChance: 0,
    doubleDropChance: 0,
    extraYieldChance: 0,
    tripleDropChance: 0,
    oreConversionBonus: 0,
    depthValueBonus: 0,
    goldenOreChance: 0,
    relicChance: 0,
    fortuneProcChance: 0,
    motherlodeChance: 0,
    oreDiversityBonusPerType: 0,
  };
}

const probabilityKeys = [
  "veinRevealChance",
  "multiHitChance",
  "critChance",
  "breakSplashChance",
  "overkillCarry",
  "timeRefundChance",
  "timeShardChance",
  "bombChance",
  "stickyBombChance",
  "volatileBombChance",
  "chainChance",
  "droneBombChance",
  "luck",
  "rareOreChance",
  "richVeinChance",
  "doubleDropChance",
  "extraYieldChance",
  "tripleDropChance",
  "goldenOreChance",
  "relicChance",
  "fortuneProcChance",
  "motherlodeChance",
  "focusedOreHardnessReduction",
];

function normalizeMetaStats(stats) {
  stats.senseRadius = Math.max(1, stats.senseRadius * stats.senseRadiusMultiplier);
  stats.moveSpeed = Math.max(1, stats.moveSpeed * stats.moveSpeedMultiplier);
  stats.mineMoveMultiplier = Math.max(0.1, stats.mineMoveMultiplier);
  stats.digReach = Math.max(1, stats.digReach * stats.digReachMultiplier);
  stats.digRadius = Math.max(1, stats.digRadius);
  stats.digArc = clamp(stats.digArc, Math.PI / 18, Math.PI * 2);
  stats.digSpeed = Math.max(0.1, stats.digSpeed * stats.digSpeedMultiplier);
  stats.pickPower = Math.max(0.1, stats.pickPower * stats.pickPowerMultiplier);
  stats.maxRunDuration = clamp(stats.maxRunDuration, 6, 45);
  stats.runDuration = clamp(stats.runDuration, 6, stats.maxRunDuration);
  stats.bonusRunDurationCap = clamp(stats.bonusRunDurationCap, stats.maxRunDuration, 60);
  stats.discoveryTimeBonus = Math.max(0, stats.discoveryTimeBonus);
  stats.timerDrainReduction = clamp(stats.timerDrainReduction, 0, 0.5);
  stats.timerDrainMultiplier = 1 - stats.timerDrainReduction;
  stats.timeRefundAmount *= stats.timeRefundMultiplier;
  stats.bombPower = Math.max(0, stats.bombPower);
  stats.directionalBombConeTiles = Math.max(0, Math.floor(stats.directionalBombConeTiles));
  stats.crewBeaconOverkillCarry = clamp(stats.crewBeaconOverkillCarry, 0, 1);
  stats.chainPower = Math.max(0, stats.chainPower);
  stats.dronePower = Math.max(0, stats.dronePower);
  stats.laserPower = Math.max(0, stats.laserPower);
  stats.laserRicochetCount = clamp(Math.floor(stats.laserRicochetCount), 0, 2);
  stats.laserFirstRicochetMultiplier = clamp(stats.laserFirstRicochetMultiplier, 0, 1);
  stats.laserSecondRicochetMultiplier = clamp(stats.laserSecondRicochetMultiplier, 0, 1);
  stats.oreValueMultiplier = Math.max(0, stats.oreValueMultiplier);
  stats.gemValueMultiplier = Math.max(0, stats.gemValueMultiplier);
  stats.backupTargetSlots = Math.max(0, Math.floor(stats.backupTargetSlots));
  stats.oreFocusEscalationDelay = Math.max(0, stats.oreFocusEscalationDelay);
  stats.oreFocusEscalationBonus = Math.max(0, stats.oreFocusEscalationBonus);
  stats.deafKnockStoneThreshold = Math.max(0, Math.floor(stats.deafKnockStoneThreshold));
  stats.deafKnockSenseRadiusMultiplier = Math.max(1, stats.deafKnockSenseRadiusMultiplier);
  stats.deafKnockMoveSpeedBonus = Math.max(0, stats.deafKnockMoveSpeedBonus);
  stats.deafKnockMoveDuration = Math.max(0, stats.deafKnockMoveDuration);
  stats.deafKnockCooldown = Math.max(0, stats.deafKnockCooldown);
  stats.triangularFixOreMemory = Math.max(0, stats.triangularFixOreMemory);
  stats.triangularFixGadgetDamageBonus = Math.max(0, stats.triangularFixGadgetDamageBonus);
  stats.triangularFixRangeBonus = Math.max(0, stats.triangularFixRangeBonus);
  stats.mineLiftRecordDepthRatio = clamp(stats.mineLiftRecordDepthRatio, 0, 0.9);
  stats.oreDiversityBonusPerType = Math.max(0, stats.oreDiversityBonusPerType);
  stats.laserSuperPickEchoEvery = Math.max(0, Math.floor(stats.laserSuperPickEchoEvery));
  stats.laserSuperPickEchoRadiusTiles = Math.max(0, stats.laserSuperPickEchoRadiusTiles);
  stats.laserSuperPickEchoPower = clamp(stats.laserSuperPickEchoPower, 0, 1);

  for (const key of probabilityKeys) {
    stats[key] = clamp(stats[key], 0, 0.95);
  }

  // Rounding makes save comparisons and deterministic tests stable while
  // retaining far more precision than the UI needs.
  for (const [key, value] of Object.entries(stats)) {
    if (typeof value === "number" && Number.isFinite(value)) stats[key] = round(value);
  }
  return stats;
}

const readLevel = (levels, id) => {
  if (levels instanceof Map) return levels.get(id);
  return levels?.[id];
};

/**
 * Calculate the complete stat block from a save's purchased upgrade levels.
 * Invalid, fractional, negative and above-cap levels are safely normalized.
 */
function calculateMetaStats(levels = {}) {
  const stats = createBaseMetaStats();
  for (const definition of UPGRADE_DEFS) {
    const rawLevel = Number(readLevel(levels, definition.id));
    const level = clamp(Number.isFinite(rawLevel) ? Math.floor(rawLevel) : 0, 0, definition.maxLevel);
    if (level > 0) definition.apply(stats, level);
  }
  return normalizeMetaStats(stats);
}

/**
 * Return the next purchase cost, or Infinity when the definition is invalid or
 * already at its maximum level.
 */
function getUpgradeCost(definition, level = 0) {
  if (!definition || typeof definition.cost !== "function") return Infinity;
  const currentLevel = Math.max(0, Math.floor(Number(level) || 0));
  if (currentLevel >= definition.maxLevel) return Infinity;
  const result = definition.cost(currentLevel);
  return Number.isFinite(result) && result > 0 ? Math.round(result) : Infinity;
}

/** Count valid purchased levels, respecting every node's maximum. */
function countPurchasedLevels(levels = {}) {
  return UPGRADE_DEFS.reduce((total, definition) => {
    const rawLevel = Number(readLevel(levels, definition.id));
    const level = clamp(Number.isFinite(rawLevel) ? Math.floor(rawLevel) : 0, 0, definition.maxLevel);
    return total + level;
  }, 0);
}

window.DepthZeroUpgrades = Object.freeze({
  UPGRADE_CATEGORIES,
  ORE_TYPES,
  UPGRADE_DEFS,
  createOreBag,
  sanitizeOreBag,
  addOreBag,
  countOreBag,
  getUpgradeRecipe,
  canAffordRecipe,
  spendRecipe,
  createBaseMetaStats,
  calculateMetaStats,
  getUpgradeCost,
  countPurchasedLevels,
});
})();
