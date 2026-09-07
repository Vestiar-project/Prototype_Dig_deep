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
    effectLevelMultiplier: Number.isFinite(definition.effectLevelMultiplier)
      ? Math.max(0.01, definition.effectLevelMultiplier)
      : 1,
    requires: Object.freeze([...(definition.requires ?? [])]),
    recipeOverride: definition.recipeOverride && typeof definition.recipeOverride === "object"
      ? Object.freeze({ ...definition.recipeOverride })
      : undefined,
    firstRecipeOverride: definition.firstRecipeOverride && typeof definition.firstRecipeOverride === "object"
      ? Object.freeze({ ...definition.firstRecipeOverride })
      : undefined,
    levelRecipeOverrides: Array.isArray(definition.levelRecipeOverrides)
      ? Object.freeze(definition.levelRecipeOverrides.map((recipe) => (
        recipe && typeof recipe === "object" ? Object.freeze({ ...recipe }) : undefined
      )))
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
      maxDepth: 644,
      generationWeight: 0.5,
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
      depth: 196,
      maxDepth: 1120,
      generationWeight: 0.6,
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
      depth: 476,
      maxDepth: 2016,
      generationWeight: 0.7,
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
      depth: 952,
      maxDepth: 3080,
      generationWeight: 0.85,
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
      depth: 1344,
      maxDepth: 5040,
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
      depth: 2352,
      maxDepth: 6720,
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
      depth: 3640,
      maxDepth: 8960,
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
      baseYield: 2,
      depth: 4592,
      maxDepth: 11424,
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
      baseYield: 2,
      depth: 5040,
      maxDepth: 11424,
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
      baseYield: 3,
      depth: 7000,
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
// Deep-ore income rises much faster than the old scalar prices.  A steeper
// material curve keeps a newly discovered tier from buying an entire backlog
// in one workshop visit, while the opening two tiers stay intentionally cheap.
const RECIPE_PACING_BY_TIER = Object.freeze([1, 1, 1.15, 1.35, 1.65, 2, 2.4, 2.9, 3.5, 4.2]);
const CATEGORY_CATALYST_TIERS = Object.freeze({
  core: Object.freeze([0, 7, 8, 9]),
  sense: Object.freeze([0, 1, 3, 4, 7]),
  dig: Object.freeze([0, 1, 2, 4, 6]),
  power: Object.freeze([1, 2, 5, 8]),
  time: Object.freeze([3, 4, 7, 9]),
  gadgets: Object.freeze([1, 2, 5, 7]),
  tools: Object.freeze([0, 1, 2, 4, 6, 7]),
  fortune: Object.freeze([0, 1, 3, 5, 6, 7]),
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
  const levelRecipe = recipeEntries(definition.levelRecipeOverrides?.[currentLevel]);
  if (levelRecipe.length > 0) return frozenRecipe(levelRecipe);
  const firstRecipe = currentLevel === 0 ? recipeEntries(definition.firstRecipeOverride) : [];
  if (firstRecipe.length > 0) return frozenRecipe(firstRecipe);

  const requirements = Array.isArray(definition.requires) ? definition.requires : [];
  if (currentLevel === 0 && requirements.length === 0) {
    const amount = safeOreAmount(ROOT_FIRST_COST[definition.category]) || 1;
    return frozenRecipe([[ORE_BY_TIER[0].id, amount]]);
  }

  // A compressed rank stands in for several old scalar purchases. Keep its
  // effect concise without deleting the material investment those purchases
  // represented: later generated recipes sample the corresponding old rank
  // and absorb its share of the skipped costs. Explicit authored recipes stay
  // exact, so mechanic unlocks and the opening are unaffected by this curve.
  const recipeRankMultiplier = Number.isFinite(definition.effectLevelMultiplier)
    ? Math.max(1, definition.effectLevelMultiplier)
    : 1;
  const virtualLevel = currentLevel > 0
    ? Math.max(currentLevel, Math.ceil((currentLevel + 1) * recipeRankMultiplier) - 1)
    : 0;
  const absorbedRankCost = currentLevel > 0 ? recipeRankMultiplier : 1;
  const legacyCost = (typeof definition.legacyCost === "function"
    ? definition.legacyCost(virtualLevel)
    : typeof definition.cost === "function"
      ? definition.cost(virtualLevel)
      : NaN
  ) * absorbedRankCost;
  if (!Number.isFinite(legacyCost) || legacyCost <= 0) return frozenRecipe();

  let tier = 0;
  for (let index = 1; index < RECIPE_TIER_FLOORS.length; index += 1) {
    if (legacyCost >= RECIPE_TIER_FLOORS[index]) tier = index;
  }
  // Repeated levels of an opening upgrade should become more expensive, not
  // silently turn into a star-core purchase.  Keep each node within two ore
  // tiers of its first level and express later growth as larger quantities.
  const firstLevelCost = typeof definition.legacyCost === "function"
    ? definition.legacyCost(0)
    : typeof definition.cost === "function"
      ? definition.cost(0)
      : legacyCost;
  let firstLevelTier = 0;
  for (let index = 1; index < RECIPE_TIER_FLOORS.length; index += 1) {
    if (firstLevelCost >= RECIPE_TIER_FLOORS[index]) firstLevelTier = index;
  }
  const materialTierSpan = 2;
  tier = Math.min(tier, firstLevelTier + materialTierSpan);
  if (Number.isFinite(definition.maximumGeneratedTier)) {
    tier = Math.min(tier, Math.floor(definition.maximumGeneratedTier));
  }
  tier = clamp(tier, 0, ORE_BY_TIER.length - 1);

  if (tier === 0) {
    return frozenRecipe([[ORE_BY_TIER[0].id, Math.ceil(legacyCost * 0.5)]]);
  }

  const ingredients = [];
  // A node's first level is the exciting unlock.  Later ranks must consume a
  // visibly larger haul so a late rare-ore gate cannot release dozens of old
  // support ranks in one workshop visit.
  const repeatLevelPacing = 1 + virtualLevel * 0.55;
  const pacingMultiplier = (RECIPE_PACING_BY_TIER[tier] || 1) * repeatLevelPacing;
  const addTier = (oreTier, weightedShare) => {
    const safeTier = clamp(oreTier, 0, ORE_BY_TIER.length - 1);
    const weight = RECIPE_WEIGHTS[safeTier] || 1;
    ingredients.push([ORE_BY_TIER[safeTier].id, Math.ceil(legacyCost * weightedShare * pacingMultiplier / weight)]);
  };

  addTier(tier, 0.25);
  addTier(tier - 1, 0.175);
  const catalystOptions = CATEGORY_CATALYST_TIERS[definition.category] || [];
  const localCatalystFloor = Math.max(0, tier - 2);
  // Category flavour may choose between nearby materials, but it must never
  // pull a late recipe three or four strata back toward copper/iron. A lift
  // run should be payable with ore found around and below its current landing.
  const catalystTier = [...catalystOptions].reverse().find((candidate) => (
    candidate <= tier - 2 && candidate >= localCatalystFloor
  )) ?? localCatalystFloor;
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
  description: "Начало пути шахтёра. Открывает семь ветвей мастерства; до отметки 100 м даёт +70% силы копки и суммарно +77% скорости движения вниз, затем сохраняет +12% скорости движения к глубокой цели.",
  category: "core",
  icon: "⛏",
  maxLevel: 1,
  baseCost: 1,
  growth: 1,
  requires: [],
  recipeOverride: { copper: 1 },
  apply: (stats, level) => {
    add(stats, "descentMoveSpeedBonus", 0.12 * level);
    add(stats, "openingDescentMoveSpeedBonus", 0.65 * level);
    add(stats, "openingDepthPowerBonus", 0.7 * level);
    add(stats, "descentTargetBias", 0.05 * level);
  },
});

const senseUpgrades = [
  defineUpgrade({
    id: "sense_instinct_spark",
    name: "Искра инстинкта",
    description: "Радиус чутья +49,5 за уровень.",
    category: "sense",
    icon: "◉",
    maxLevel: 8,
    effectLevelMultiplier: 1.5,
    baseCost: 4,
    growth: 1.29,
    requires: ["core_first_descent"],
    firstRecipeOverride: { copper: 1 },
    levelRecipeOverrides: [
      { copper: 1 },
      { copper: 5 },
      { coal: 5, copper: 6 },
      { iron: 4, coal: 4 },
      { iron: 8, amber: 2 },
      { silver: 2, amber: 4, iron: 10 },
      { gold: 4, amethyst: 2 },
      { gold: 7, amethyst: 2 },
    ],
    apply: (stats, level) => add(stats, "senseRadius", 33 * level),
  }),
  defineUpgrade({
    id: "sense_echo_pulse",
    name: "Резонансный пинг",
    description: "Если цели нет, раз в 5/4/3 секунды запускает усиленный поиск на 125/140/155% радиуса и удерживает найденную цель 1,2 секунды.",
    category: "sense",
    icon: "⌁",
    maxLevel: 3,
    baseCost: 18,
    growth: 1.55,
    requires: ["sense_instinct_spark"],
    apply: (stats, level) => {
      stats.echoPingCooldown = [0, 5, 4, 3][level] || 5;
      stats.echoPingRadiusMultiplier = [1, 1.25, 1.4, 1.55][level] || 1.25;
      stats.echoPingTargetHold = 1.2;
    },
  }),
  defineUpgrade({
    id: "sense_clear_signal",
    name: "Вектор глубины",
    description: "Чутьё сильнее предпочитает цели ниже шахтёра, а движение к ним ускоряется на 8/14/20%.",
    category: "sense",
    icon: "⌖",
    maxLevel: 3,
    baseCost: 31,
    growth: 1.54,
    requires: [{ id: "sense_instinct_spark", level: 3 }],
    apply: (stats, level) => {
      add(stats, "descentTargetBias", [0, 0.08, 0.14, 0.2][level] || 0.08);
      add(stats, "descentMoveSpeedBonus", [0, 0.08, 0.14, 0.2][level] || 0.08);
    },
  }),
  defineUpgrade({
    id: "sense_deep_resonance",
    name: "Глубинный резонанс",
    description: "Радиус чутья растёт с глубиной: до +16,7% за уровень. Глубинный сектор пробивает породу конусом вниз и отмечает 1/2/3 цели; следующие уровни расширяют, углубляют и ускоряют отклик.",
    category: "sense",
    icon: "◍",
    maxLevel: 3,
    effectLevelMultiplier: 5 / 3,
    baseCost: 76,
    growth: 1.45,
    requires: [{ id: "sense_instinct_spark", level: 6 }],
    firstRecipeOverride: { silver: 3, amber: 2 },
    levelRecipeOverrides: [
      null,
      { gold: 10, silver: 27, amber: 40 },
      null,
    ],
    apply: (stats, level) => {
      const rank = clamp(Math.round(level * 3 / 5), 1, 3);
      add(stats, "senseRadius", 10 * level);
      add(stats, "deepOreSenseBonus", 0.1 * level);
      stats.deepResonanceEnabled = true;
      stats.deepResonanceCooldown = [0, 4, 3.25, 2.5][rank];
      stats.deepResonanceRadiusMultiplier = [1, 1.55, 1.7, 1.85][rank];
      stats.deepResonanceSolidLayers = [0, 4, 5, 6][rank];
      stats.deepResonanceConeHalfAngle = [0, 35, 40, 45][rank] * Math.PI / 180;
      stats.deepResonanceTargetHold = 1.35;
      stats.deepResonanceTargetSlots = rank;
    },
  }),
  defineUpgrade({
    id: "sense_vein_whisper",
    name: "След жилы",
    description: "После первого куска продолжает искать ту же жилу на 125/145/165% радиуса; скорость движения вдоль неё +8/14/20%.",
    category: "sense",
    layoutLobe: "tools",
    icon: "〰",
    maxLevel: 3,
    baseCost: 58,
    growth: 1.58,
    requires: ["sense_echo_pulse"],
    apply: (stats, level) => {
      stats.veinTrailEnabled = true;
      stats.veinTrailRangeMultiplier = [1, 1.25, 1.45, 1.65][level] || 1.25;
      stats.veinTrailMoveSpeedBonus = [0, 0.08, 0.14, 0.2][level] || 0.08;
    },
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
    name: "Карта напряжений",
    description: "Запоминает 1/2/3 резервные жилы за пределами чутья и сразу прокладывает путь к следующей после исчерпания текущей.",
    category: "sense",
    icon: "≋",
    maxLevel: 3,
    baseCost: 104,
    growth: 1.57,
    requires: ["sense_vein_whisper"],
    levelRecipeOverrides: [
      { gold: 1, silver: 2, amber: 3 },
      { gold: 3, silver: 5, amber: 6 },
      { gold: 6, silver: 10, amber: 12 },
    ],
    apply: (stats, level) => add(stats, "seismicRouteSlots", level),
  }),
  defineUpgrade({
    id: "sense_panoramic_intuition",
    name: "Панорамная интуиция",
    description: "Итоговый радиус чутья +8,3% за уровень.",
    category: "sense",
    icon: "◎",
    maxLevel: 3,
    effectLevelMultiplier: 5 / 3,
    baseCost: 160,
    growth: 1.51,
    requires: ["sense_deep_resonance"],
    firstRecipeOverride: { gold: 1, silver: 2, amber: 3 },
    apply: (stats, level) => add(stats, "senseRadiusMultiplier", 0.05 * level),
  }),
  defineUpgrade({
    id: "sense_ore_focus",
    name: "Рудный фокус",
    description: "Открывает в мастерской выбор одного типа руды перед сменой и увеличивает радиус её поиска в 2,15 раза.",
    category: "sense",
    layoutLobe: "tools",
    icon: "⌾",
    maxLevel: 1,
    baseCost: 250,
    growth: 1,
    requires: ["sense_deep_resonance", "tools_steel_pick"],
    requiresBestDepth: 750,
    requiresOreDiscovery: "silver",
    recipeOverride: { gold: 2, silver: 2 },
    apply: (stats, level) => {
      if (level > 0) {
        stats.oreFocusUnlocked = true;
        stats.oreFocusRadiusMultiplier = 2.15;
      }
    },
  }),
  defineUpgrade({
    id: "sense_priority_tuning",
    name: "Оценка залежи",
    description: "Рудный фокус предпочитает крупные залежи. Вес размера жилы +30%, а скорость за каждый следующий её кусок +3% за уровень.",
    category: "sense",
    icon: "☷",
    maxLevel: 4,
    baseCost: 145,
    growth: 1.8,
    requires: ["sense_ore_focus"],
    levelRecipeOverrides: [
      { silver: 9 },
      { gold: 3, silver: 8 },
      { prism_crystal: 1, amethyst: 1, gold: 2 },
      { prism_crystal: 8, amethyst: 10, gold: 12 },
    ],
    apply: (stats, level) => {
      add(stats, "focusVeinSizeBias", 0.3 * level);
      add(stats, "focusVeinMoveSpeedPerNode", 0.03 * level);
    },
  }),
  defineUpgrade({
    id: "sense_ghost_outline",
    name: "Призрачный след",
    description: "Потерянная рудная цель ещё 4 секунды остаётся доступной за пределами чутья и сквозь три слоя породы.",
    category: "sense",
    icon: "▧",
    maxLevel: 1,
    baseCost: 260,
    growth: 1,
    requires: ["sense_seismic_memory", "sense_ore_focus"],
    firstRecipeOverride: { prism_crystal: 4, amethyst: 6, gold: 8 },
    apply: (stats, level) => {
      if (level > 0) {
        stats.oreOutline = true;
        stats.ghostTrailDuration = 4;
        stats.ghostTrailMaxLayers = 3;
      }
    },
  }),
  defineUpgrade({
    id: "sense_far_echo",
    name: "Дальнее эхо",
    description: "Радиус чутья +53,3 за уровень.",
    category: "sense",
    icon: "◠",
    maxLevel: 3,
    effectLevelMultiplier: 5 / 3,
    baseCost: 310,
    growth: 1.53,
    requires: ["sense_panoramic_intuition"],
    firstRecipeOverride: { gold: 3, silver: 4 },
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
    description: "Запоминает одну запасную цель и после разрушения текущей сразу продолжает маршрут к запасной отметке. При рудном фокусе обе цели относятся только к выбранной руде.",
    category: "sense",
    icon: "◎",
    maxLevel: 1,
    baseCost: 420,
    growth: 1,
    requires: ["sense_ore_focus", { id: "sense_priority_tuning", level: 2 }],
    recipeOverride: { gold: 4, silver: 8 },
    apply: (stats, level) => add(stats, "backupTargetSlots", level),
  }),
  defineUpgrade({
    id: "sense_frequency_swing",
    name: "Раскачка частоты",
    description: "Если рудный фокус не находит цель 1,5 секунды, радиус его поиска увеличивается на 25% за уровень до обнаружения руды.",
    category: "sense",
    icon: "≋",
    maxLevel: 3,
    baseCost: 290,
    growth: 1.86,
    requires: [
      "sense_ore_focus",
      "sense_second_fix",
      { id: "sense_priority_tuning", level: 3 },
    ],
    requiresOreDiscovery: "prism_crystal",
    firstRecipeOverride: { prism_crystal: 1, amethyst: 1, gold: 4 },
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
    requires: ["sense_echo_pulse", { id: "dig_wall_bite", level: 2 }],
    firstRecipeOverride: { amethyst: 4, gold: 6, silver: 8 },
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
    baseCost: 720,
    growth: 1.7,
    requires: [
      "sense_second_fix",
      "gadgets_scout_drone",
      { id: "sense_priority_tuning", level: 4 },
    ],
    requiresOreDiscovery: "prism_crystal",
    levelRecipeOverrides: [
      { prism_crystal: 4, amethyst: 6, gold: 8 },
      { void_ore: 12, prism_crystal: 18, amethyst: 22 },
    ],
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
    requires: [
      "sense_clairvoyant_miner",
      "sense_ghost_outline",
      "sense_frequency_swing",
      { id: "sense_triangular_fix", level: 2 },
    ],
    recipeOverride: { prism_crystal: 56, void_ore: 24 },
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
    description: "Дальность удара киркой +3,25 за уровень.",
    category: "dig",
    icon: "⛏",
    maxLevel: 8,
    effectLevelMultiplier: 1.5,
    baseCost: 4,
    growth: 1.29,
    requires: ["core_first_descent"],
    firstRecipeOverride: { copper: 1 },
    levelRecipeOverrides: [
      null, null, null, null, null, null,
      { gold: 4, amethyst: 2 },
      { gold: 7, amethyst: 2 },
    ],
    apply: (stats, level) => add(stats, "digReach", (26 / 12) * level),
  }),
  defineUpgrade({
    id: "dig_sweeping_arc",
    name: "Боковой скол",
    description: "Каждый 3-й/2-й/1-й удар также задевает два боковых блока на 30/45/60% силы. С лазером выпускает два коротких боковых луча.",
    category: "dig",
    icon: "⌒",
    maxLevel: 3,
    baseCost: 18,
    growth: 1.55,
    requires: ["dig_arm_swing"],
    apply: (stats, level) => {
      stats.sideChipEvery = [0, 3, 2, 1][level] || 3;
      stats.sideChipTargets = 2;
      stats.sideChipPower = [0, 0.3, 0.45, 0.6][level] || 0.3;
      stats.sideChipLaserEnabled = true;
    },
  }),
  defineUpgrade({
    id: "dig_light_footwork",
    name: "Лёгкая поступь",
    description: "Скорость перемещения +8% за уровень. На 2-м уровне открывает стартовый разгон: +40% скорости к первой цели смены до первого удара. На 4-м уровне новая рудная цель даёт рывок +18% на 0,65 секунды.",
    category: "dig",
    layoutLobe: "time",
    icon: "➜",
    maxLevel: 4,
    effectLevelMultiplier: 1.5,
    baseCost: 27,
    growth: 1.35,
    requires: ["dig_arm_swing"],
    levelRecipeOverrides: [
      null,
      { silver: 3, amber: 4, iron: 5 },
      { amber: 19, iron: 26, coal: 28 },
      null,
    ],
    apply: (stats, level) => {
      const rank = clamp(Math.round(level / 1.5), 1, 4);
      add(stats, "moveSpeedMultiplier", (0.32 / 6) * level);
      if (rank >= 2) stats.openingSprintMultiplier = 1.4;
      if (rank >= 4) {
        stats.targetRelaySprintMultiplier = 1.18;
        stats.targetRelaySprintDuration = 0.65;
      }
    },
  }),
  defineUpgrade({
    id: "dig_tunnel_step",
    name: "Туннельный шаг",
    description: "Во время копки шахтёр движется на 11,7% быстрее за уровень.",
    category: "dig",
    icon: "⇥",
    maxLevel: 3,
    effectLevelMultiplier: 5 / 3,
    baseCost: 49,
    growth: 1.43,
    requires: ["dig_light_footwork"],
    apply: (stats, level) => add(stats, "mineMoveMultiplier", 0.07 * level),
  }),
  defineUpgrade({
    id: "dig_twin_stroke",
    name: "Двойной замах",
    description: "Шанс нанести второй удар +6,7% за уровень.",
    category: "dig",
    icon: "≻",
    maxLevel: 3,
    effectLevelMultiplier: 5 / 3,
    baseCost: 61,
    growth: 1.46,
    requires: ["dig_sweeping_arc"],
    apply: (stats, level) => add(stats, "multiHitChance", 0.04 * level),
  }),
  defineUpgrade({
    id: "dig_precision_path",
    name: "Удар на сближении",
    description: "После 0,9 секунды пути первый удар получает +50/75/100% силы и скалывает бок мешающего блока на 25/35/45%. Сбрасывается при смене цели.",
    category: "dig",
    icon: "⌖",
    maxLevel: 3,
    baseCost: 73,
    growth: 1.58,
    requires: [{ id: "dig_arm_swing", level: 2 }],
    firstRecipeOverride: { amber: 3, iron: 3 },
    apply: (stats, level) => {
      stats.approachStrikeTravelTime = 0.9;
      stats.approachStrikePower = [0, 0.5, 0.75, 1][level] || 0.5;
      stats.approachStrikeSideChipPower = [0, 0.25, 0.35, 0.45][level] || 0.25;
    },
  }),
  defineUpgrade({
    id: "dig_reach_training",
    name: "Тренировка захвата",
    description: "Итоговая дальность копки +3,3% за уровень.",
    category: "dig",
    icon: "↝",
    maxLevel: 3,
    effectLevelMultiplier: 5 / 3,
    baseCost: 92,
    growth: 1.47,
    requires: [{ id: "dig_arm_swing", level: 4 }],
    apply: (stats, level) => add(stats, "digReachMultiplier", 0.02 * level),
  }),
  defineUpgrade({
    id: "dig_wall_bite",
    name: "Укус стены",
    description: "Открывает площадную копку; радиус удара +12 за уровень.",
    category: "dig",
    icon: "◖",
    maxLevel: 3,
    effectLevelMultiplier: 5 / 3,
    baseCost: 118,
    growth: 1.45,
    requires: ["dig_twin_stroke"],
    firstRecipeOverride: { iron: 8, coal: 6 },
    apply: (stats, level) => {
      if (level > 0) stats.areaMiningUnlocked = true;
      add(stats, "splashRadius", 3.6 * level);
      add(stats, "digRadius", 7.2 * level);
      add(stats, "splashDamage", 0.03 * level);
    },
  }),
  defineUpgrade({
    id: "dig_excavator_stance",
    name: "Стойка экскаватора",
    description: "Дальность +6 и скорость ударов +5% за уровень.",
    category: "dig",
    icon: "⚒",
    maxLevel: 3,
    effectLevelMultiplier: 5 / 3,
    baseCost: 205,
    growth: 1.5,
    requires: ["dig_reach_training", { id: "tools_balanced_handle", level: 4 }],
    apply: (stats, level) => {
      add(stats, "digReach", 3.6 * level);
      add(stats, "digSpeedMultiplier", 0.03 * level);
    },
  }),
  defineUpgrade({
    id: "dig_stone_dance",
    name: "Танец среди камней",
    description: "Скорость движения +10%, скорость наведения +13,3% за уровень.",
    category: "dig",
    icon: "♢",
    maxLevel: 3,
    effectLevelMultiplier: 5 / 3,
    baseCost: 240,
    growth: 1.49,
    requires: ["dig_precision_path", "dig_tunnel_step"],
    firstRecipeOverride: { gold: 2, silver: 4, amber: 4 },
    apply: (stats, level) => {
      add(stats, "moveSpeedMultiplier", 0.06 * level);
      add(stats, "aimTurnSpeed", 0.08 * level);
    },
  }),
  defineUpgrade({
    id: "dig_master_reach",
    name: "Мастерская досягаемость",
    description: "Итоговая дальность копки +5% за уровень.",
    category: "dig",
    icon: "⇀",
    maxLevel: 3,
    effectLevelMultiplier: 4 / 3,
    baseCost: 370,
    growth: 1.57,
    requires: ["dig_excavator_stance"],
    apply: (stats, level) => add(stats, "digReachMultiplier", 0.0375 * level),
  }),
  defineUpgrade({
    id: "dig_omni_swing",
    name: "Ударная волна",
    description: "Каждые 6/5/4 разрушенных блока любой инструмент создаёт ударную волну радиусом 1/1,25/1,5 блока и силой 35/50/65%.",
    category: "dig",
    icon: "⟳",
    maxLevel: 3,
    baseCost: 210,
    growth: 1.82,
    requires: ["dig_sweeping_arc", "power_furious_swing"],
    firstRecipeOverride: { silver: 5, amber: 1 },
    apply: (stats, level) => {
      stats.impactWaveEvery = [0, 6, 5, 4][level] || 6;
      stats.impactWaveRadiusTiles = [0, 1, 1.25, 1.5][level] || 1;
      stats.impactWavePower = [0, 0.35, 0.5, 0.65][level] || 0.35;
    },
  }),
  defineUpgrade({
    id: "dig_least_resistance",
    name: "Тропа наименьшего сопротивления",
    description: "Автомайнер сравнивает время прямого пробивания и обхода плотной породы, затем выбирает более быстрый маршрут.",
    category: "dig",
    icon: "⌁",
    maxLevel: 1,
    baseCost: 150,
    growth: 1,
    requires: ["dig_sweeping_arc", "sense_echo_pulse"],
    recipeOverride: { silver: 1, amber: 1 },
    apply: (stats, level) => {
      if (level > 0) stats.leastResistancePathing = true;
    },
  }),
  defineUpgrade({
    id: "dig_mine_lift",
    name: "Шахтный лифт",
    description: "Начинает забег на 95/99/100% от рекордной глубины, но не ниже уже освоенного рудного слоя.",
    category: "dig",
    icon: "⇓",
    maxLevel: 3,
    baseCost: 520,
    growth: 1.82,
    requires: ["tools_iron_pick"],
    requiresBestDepth: 70,
    levelRecipeOverrides: [
      { coal: 2 },
      { gold: 8, silver: 14, amber: 12 },
      { void_ore: 6, prism_crystal: 10, amethyst: 16 },
    ],
    apply: (stats, level) => {
      stats.mineLiftRecordDepthRatio = [0, 0.95, 0.99, 1][level] || 0;
    },
  }),
  defineUpgrade({
    id: "dig_quarry_presence",
    name: "Карьерный темп",
    description: "Три быстрых разрушения включают карьерный режим на 2,5 секунды: движение и копка +25%, каждое разрушение раскалывает боковые блоки на 40% силы.",
    category: "dig",
    icon: "◯",
    maxLevel: 1,
    baseCost: 1750,
    growth: 1,
    requires: [
      "dig_omni_swing",
      "dig_stone_dance",
      { id: "dig_mine_lift", level: 2 },
    ],
    recipeOverride: { prism_crystal: 69, star_core: 6 },
    apply: (stats, level) => {
      stats.quarryModeRequiredBreaks = 3;
      stats.quarryModeWindow = 1.2;
      stats.quarryModeDuration = 2.5;
      add(stats, "quarryModeMoveSpeedBonus", 0.25 * level);
      add(stats, "quarryModeDigSpeedBonus", 0.25 * level);
      add(stats, "quarryModeSideFracturePower", 0.4 * level);
    },
  }),
];

const powerUpgrades = [
  defineUpgrade({
    id: "power_sharpened_edge",
    name: "Острое жало",
    description: "Сила кирки +1,0125 за уровень.",
    category: "power",
    icon: "◆",
    maxLevel: 8,
    effectLevelMultiplier: 1.5,
    baseCost: 5,
    growth: 1.3,
    requires: ["core_first_descent"],
    firstRecipeOverride: { copper: 1 },
    levelRecipeOverrides: [
      null, { amber: 2 }, { silver: 1, amber: 2 },
      { silver: 2, amber: 3 },
      { gold: 2, silver: 2, amber: 5 },
      { gold: 3, silver: 4, amber: 4 },
      { gold: 5, amethyst: 3 },
      { gold: 9, amethyst: 3 },
    ],
    apply: (stats, level) => add(stats, "pickPower", 0.675 * level),
  }),
  defineUpgrade({
    id: "power_tempered_steel",
    name: "Закалённая сталь",
    description: "Игнорирование плотности руды +0,7 за уровень.",
    category: "power",
    icon: "▰",
    maxLevel: 3,
    effectLevelMultiplier: 5 / 3,
    baseCost: 24,
    growth: 1.41,
    requires: ["power_sharpened_edge"],
    apply: (stats, level) => add(stats, "hardnessPierce", 0.42 * level),
  }),
  defineUpgrade({
    id: "power_furious_swing",
    name: "Яростный взмах",
    description: "Шанс критического удара +3,75% за уровень.",
    category: "power",
    layoutLobe: "fortune",
    icon: "✦",
    maxLevel: 4,
    effectLevelMultiplier: 1.5,
    baseCost: 37,
    growth: 1.44,
    requires: [{ id: "power_sharpened_edge", level: 4 }],
    firstRecipeOverride: { amber: 3 },
    apply: (stats, level) => add(stats, "critChance", 0.025 * level),
  }),
  defineUpgrade({
    id: "power_fault_finder",
    name: "Искатель трещин",
    description: "Множитель критического удара +0,375 за уровень. С 3-го уровня каждый 18-й удар гарантированно находит трещину и становится критическим; на 4-м — каждый 15-й.",
    category: "power",
    icon: "⌁",
    maxLevel: 4,
    effectLevelMultiplier: 1.5,
    baseCost: 52,
    growth: 1.45,
    requires: ["power_tempered_steel"],
    apply: (stats, level) => {
      const rank = clamp(Math.round(level / 1.5), 1, 4);
      add(stats, "critMultiplier", 0.25 * level);
      if (rank >= 3) stats.faultFinderCadenceEvery = rank >= 4 ? 15 : 18;
    },
  }),
  defineUpgrade({
    id: "power_shatterpoint",
    name: "Точка раскола",
    description: "Разрушенный блок с шансом 8,3% за уровень ранит соседей.",
    category: "power",
    icon: "✣",
    maxLevel: 3,
    effectLevelMultiplier: 5 / 3,
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
    description: "Итоговая сила кирки +10% за уровень.",
    category: "power",
    icon: "✊",
    maxLevel: 3,
    effectLevelMultiplier: 5 / 3,
    baseCost: 96,
    growth: 1.5,
    requires: [{ id: "power_sharpened_edge", level: 4 }],
    apply: (stats, level) => add(stats, "pickPowerMultiplier", 0.06 * level),
  }),
  defineUpgrade({
    id: "power_momentum",
    name: "Накопленный импульс",
    description: "Каждый быстрый удар по одной жиле добавляет 3,3% силы за уровень.",
    category: "power",
    icon: "➤",
    maxLevel: 3,
    effectLevelMultiplier: 5 / 3,
    baseCost: 125,
    growth: 1.47,
    requires: ["power_furious_swing"],
    firstRecipeOverride: { silver: 3 },
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
    description: "Сила +1,35 и пробивание плотности +0,525 за уровень.",
    category: "power",
    icon: "◇",
    maxLevel: 4,
    effectLevelMultiplier: 1.5,
    baseCost: 105,
    growth: 1.78,
    requires: ["power_tempered_steel"],
    firstRecipeOverride: { silver: 6, amber: 3 },
    apply: (stats, level) => {
      add(stats, "pickPower", 0.9 * level);
      add(stats, "hardnessPierce", 0.35 * level);
    },
  }),
  defineUpgrade({
    id: "power_tectonic_blow",
    name: "Тектонический удар",
    description: "Урон по площади и плотной руде +13,3% за уровень.",
    category: "power",
    icon: "♒",
    maxLevel: 3,
    effectLevelMultiplier: 5 / 3,
    baseCost: 230,
    growth: 1.53,
    requires: ["power_shatterpoint"],
    firstRecipeOverride: { gold: 3, silver: 4, amber: 5 },
    apply: (stats, level) => {
      add(stats, "splashDamage", 0.08 * level);
      add(stats, "oreDamageBonus", 0.08 * level);
    },
  }),
  defineUpgrade({
    id: "power_overcharge_strike",
    name: "Перегруженный удар",
    description: "Каждый восьмой удар получает +46,7% силы за уровень.",
    category: "power",
    icon: "ϟ",
    maxLevel: 3,
    effectLevelMultiplier: 4 / 3,
    baseCost: 310,
    growth: 1.58,
    requires: ["power_momentum", "power_diamond_tip"],
    firstRecipeOverride: { gold: 4, silver: 6, amber: 5 },
    apply: (stats, level) => add(stats, "chargedHitPower", 0.35 * level),
  }),
  defineUpgrade({
    id: "power_geologist_force",
    name: "Сила геолога",
    description: "Урон по редкой руде +20% за уровень.",
    category: "power",
    icon: "▦",
    maxLevel: 3,
    effectLevelMultiplier: 5 / 3,
    baseCost: 360,
    growth: 1.55,
    requires: ["power_diamond_tip"],
    apply: (stats, level) => add(stats, "rareOreDamageBonus", 0.12 * level),
  }),
  defineUpgrade({
    id: "power_corebreaker",
    name: "Крушитель ядер",
    description: "Итоговая сила +13,3%, пробивание +0,93 за уровень.",
    category: "power",
    icon: "☄",
    maxLevel: 3,
    effectLevelMultiplier: 4 / 3,
    baseCost: 520,
    growth: 1.62,
    requires: ["power_tectonic_blow", "power_geologist_force"],
    levelRecipeOverrides: [
      { gold: 11, silver: 13 },
      { amethyst: 6, prism_crystal: 4 },
      { prism_crystal: 12, void_ore: 5 },
    ],
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
    levelRecipeOverrides: [
      { gold: 13, silver: 26 },
      { amethyst: 19, gold: 39 },
      { amethyst: 42, gold: 88 },
    ],
    apply: (stats, level) => {
      add(stats, "critMultiplier", 0.5 * level);
      add(stats, "overkillCarry", 0.04 * level);
    },
  }),
  defineUpgrade({
    id: "power_sample_calibration",
    name: "Калибровка по образцу",
    description: "Эффективная плотность выбранной перед сменой руды уменьшается на 10,7% за уровень.",
    category: "power",
    icon: "◇",
    maxLevel: 3,
    effectLevelMultiplier: 4 / 3,
    baseCost: 310,
    growth: 1.84,
    requires: [
      "tools_pneumatic_pick",
      "sense_ore_focus",
      "sense_second_fix",
      { id: "sense_priority_tuning", level: 2 },
    ],
    levelRecipeOverrides: [
      { gold: 6, silver: 14 },
      { gold: 60, silver: 65 },
      { gold: 139, silver: 150 },
    ],
    apply: (stats, level) => add(stats, "focusedOreHardnessReduction", 0.08 * level),
  }),
  defineUpgrade({
    id: "power_mountain_splitter",
    name: "Линия разлома",
    description: "Критическое разрушение переносит 75% реального лишнего урона через четыре блока по направлению удара. Каждое новое разрушение продлевает разлом ещё на блок.",
    category: "power",
    icon: "✷",
    maxLevel: 1,
    baseCost: 2200,
    growth: 1,
    requires: [
      "power_one_hit_legend",
      "power_sample_calibration",
      { id: "power_corebreaker", level: 2 },
    ],
    recipeOverride: { prism_crystal: 64, void_ore: 26 },
    apply: (stats, level) => {
      stats.faultLineEnabled = level > 0;
      stats.faultLineMaxBlocks = 4;
      stats.faultLinePower = 0.75;
      stats.faultLineExtendOnBreak = true;
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
    description: "Начальный таймер +0,75 секунды за уровень. 8 уровней дают первые дополнительные 6 секунд.",
    category: "time",
    icon: "◷",
    maxLevel: 8,
    baseCost: 4,
    growth: 1.27,
    requires: ["core_first_descent"],
    levelRecipeOverrides: [
      { copper: 1 },
      { copper: 3 },
      { copper: 3 },
      { copper: 4 },
      { copper: 5 },
      { silver: 3, amber: 4 },
      { gold: 3, silver: 5 },
      { amethyst: 3, gold: 5 },
    ],
    apply: (stats, level) => add(stats, "runDuration", 0.75 * level),
  }),
  defineUpgrade({
    id: "time_clockwork_heart",
    name: "Заводное сердце",
    description: "Таймер +1,125 секунды за уровень. На 3-м уровне даёт стартовую паузу, на 4-м — возврат времени, на 8-м — один аварийный заряд.",
    category: "time",
    layoutLobe: "dig",
    icon: "♥",
    maxLevel: 8,
    baseCost: 20,
    growth: 1.24,
    requires: [
      { id: "time_extra_breath", level: 3 },
      { id: "dig_light_footwork", level: 1 },
    ],
    levelRecipeOverrides: [
      { coal: 2, copper: 3 },
      { coal: 4, iron: 2, copper: 4 },
      { iron: 4, coal: 6, copper: 6 },
      { iron: 3, coal: 4 },
      { silver: 4, amber: 6 },
      { gold: 4, silver: 6 },
      { amethyst: 8, gold: 12 },
      { prism_crystal: 8, amethyst: 14 },
    ],
    apply: (stats, level) => {
      add(stats, "runDuration", 1.125 * level);
      if (level >= 3) add(stats, "startTimeFreeze", 0.5);
      if (level >= 4) {
        add(stats, "timeRefundChance", 0.06 + (level - 4) * 0.015);
        add(stats, "timeRefundAmount", 0.12 + (level - 4) * 0.05);
      }
      if (level >= 8) {
        add(stats, "lastChanceCharges", 1);
        add(stats, "lastChanceSeconds", 1.25);
      }
    },
  }),
  defineUpgrade({
    id: "time_capsule",
    name: "Капсула времени",
    description: "Таймер +4 секунды за уровень. Первый образец нового типа руды возвращает до 0,48 секунды; поздние уровни открывают хроноосколки. Бонусы ограничены 60 секундами.",
    category: "time",
    layoutLobe: "tools",
    icon: "⬡",
    maxLevel: 6,
    baseCost: 150,
    growth: 1.38,
    requires: [
      { id: "time_clockwork_heart", level: 4 },
      { id: "tools_balanced_handle", level: 3 },
    ],
    levelRecipeOverrides: [
      { silver: 3, amber: 4 },
      { gold: 3, silver: 5 },
      { amethyst: 3, gold: 5 },
      { prism_crystal: 3, amethyst: 5 },
      { void_ore: 3, prism_crystal: 6 },
      { void_ore: 8, star_core: 2 },
    ],
    apply: (stats, level) => {
      add(stats, "runDuration", 4 * level);
      add(stats, "discoveryTimeBonus", 0.08 * level);
      if (level >= 5) {
        add(stats, "timeShardChance", 0.04 + (level - 5) * 0.01);
        add(stats, "timeShardSeconds", 0.24 + (level - 5) * 0.04);
      }
    },
  }),
  defineUpgrade({
    id: "time_thirty_second_oath",
    name: "Хронофорсаж",
    description: "Бонусное время сверх 45 секунд становится видимой перегрузкой: инструмент работает на 25% быстрее и каждый пятый удар повторяется. Общий предел — 60 секунд.",
    category: "time",
    layoutLobe: "power",
    icon: "45",
    maxLevel: 1,
    baseCost: 3200,
    growth: 1,
    requires: [
      { id: "time_extra_breath", level: 8 },
      { id: "time_clockwork_heart", level: 8 },
      { id: "time_capsule", level: 6 },
    ],
    recipeOverride: { void_ore: 30, star_core: 7 },
    apply: (stats, level) => {
      if (level > 0) {
        stats.chronoOverclock = true;
        stats.chronoOverdrive = true;
        stats.chronoOverflowThreshold = 45;
        stats.chronoOverflowSpeedBonus = 0.25;
        stats.chronoOverflowRepeatEvery = 5;
      }
    },
  }),
];

const gadgetUpgrades = [
  defineUpgrade({
    id: "gadgets_powder_pocket",
    name: "Карман пороха",
    description: "Удар с шансом 3,3% за уровень выбрасывает бомбочку.",
    category: "gadgets",
    icon: "●",
    maxLevel: 3,
    effectLevelMultiplier: 5 / 3,
    baseCost: 8,
    growth: 1.4,
    requires: ["core_first_descent"],
    firstRecipeOverride: { copper: 1 },
    apply: (stats, level) => add(stats, "bombChance", 0.02 * level),
  }),
  defineUpgrade({
    id: "gadgets_packed_charge",
    name: "Плотный заряд",
    description: "Урон бомб +42% за уровень.",
    category: "gadgets",
    icon: "✹",
    maxLevel: 3,
    effectLevelMultiplier: 5 / 3,
    baseCost: 26,
    growth: 1.42,
    requires: ["gadgets_powder_pocket"],
    apply: (stats, level) => add(stats, "bombPower", 0.252 * level),
  }),
  defineUpgrade({
    id: "gadgets_wide_fuse",
    name: "Широкий фитиль",
    description: "Радиус взрыва +7,5 за уровень.",
    category: "gadgets",
    icon: "◉",
    maxLevel: 4,
    effectLevelMultiplier: 1.5,
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
    description: "Шанс приклеить усиленную бомбу к руде +11,7% за уровень.",
    category: "gadgets",
    icon: "⬢",
    maxLevel: 3,
    effectLevelMultiplier: 5 / 3,
    baseCost: 95,
    growth: 1.49,
    requires: ["gadgets_packed_charge"],
    firstRecipeOverride: { silver: 4, amber: 1 },
    apply: (stats, level) => add(stats, "stickyBombChance", 0.07 * level),
  }),
  defineUpgrade({
    id: "gadgets_chain_spark",
    name: "Цепная искра",
    description: "Удар с шансом 6% за уровень перескакивает на соседнюю руду.",
    category: "gadgets",
    icon: "ϟ",
    maxLevel: 3,
    effectLevelMultiplier: 5 / 3,
    baseCost: 112,
    growth: 1.48,
    requires: ["gadgets_wide_fuse"],
    apply: (stats, level) => add(stats, "chainChance", 0.036 * level),
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
    levelRecipeOverrides: [
      { gold: 2, silver: 4, amber: 4 },
      { gold: 5, silver: 8, amber: 7 },
      null,
      null,
    ],
    apply: (stats, level) => {
      add(stats, "chainCount", level);
      add(stats, "chainPower", 0.05 * level);
    },
  }),
  defineUpgrade({
    id: "gadgets_shock_capsule",
    name: "Шок-капсула",
    description: "Разряд удерживается на цели на 0,2 сек дольше за уровень.",
    category: "gadgets",
    icon: "☇",
    maxLevel: 3,
    effectLevelMultiplier: 4 / 3,
    baseCost: 205,
    growth: 1.52,
    requires: ["gadgets_chain_links"],
    levelRecipeOverrides: [
      { silver: 12 },
      { gold: 27, silver: 30 },
      { gold: 52, silver: 56 },
    ],
    apply: (stats, level) => add(stats, "shockDuration", 0.15 * level),
  }),
  defineUpgrade({
    id: "gadgets_magnet_mine",
    name: "Магнитное поле",
    description: "После взрыва на 2,55–4,8 секунды раскрывает руду в радиусе 3,75–6 клеток и заметно усиливает наведение, дальность и урон бомб, разрядов и дронов внутри поля.",
    category: "gadgets",
    layoutLobe: "fortune",
    icon: "∩",
    maxLevel: 4,
    effectLevelMultiplier: 1.5,
    baseCost: 72,
    growth: 1.45,
    requires: ["gadgets_powder_pocket"],
    apply: (stats, level) => {
      add(stats, "pickupRadius", 18 * level);
      stats.magneticFieldEnabled = true;
      stats.magneticFieldDuration = 1.8 + 0.5 * level;
      stats.magneticFieldRadiusTiles = 3 + 0.5 * level;
      add(stats, "magneticFieldTargetingBonus", 0.12 * level);
    },
  }),
  defineUpgrade({
    id: "gadgets_scout_drone",
    name: "Дрон-разведчик",
    description: "Открывает заметного автономного дрона: он ищет руду дальше обычного чутья, подсвечивает цель и старается работать по соседней ноде, а не повторять удар шахтёра.",
    category: "gadgets",
    icon: "▣",
    maxLevel: 1,
    baseCost: 190,
    growth: 1,
    requires: ["gadgets_powder_pocket", "sense_echo_pulse"],
    recipeOverride: { iron: 1, coal: 3, copper: 4 },
    apply: (stats, level) => {
      if (level > 0) stats.droneUnlocked = true;
      add(stats, "droneCount", level);
    },
  }),
  defineUpgrade({
    id: "gadgets_drone_battery",
    name: "Батарея дрона",
    description: "Скорость дронов +15%, время их работы +8,3% смены за уровень. Третий уровень даёт полную автономность.",
    category: "gadgets",
    icon: "▥",
    maxLevel: 3,
    baseCost: 360,
    growth: 1.55,
    requires: ["gadgets_scout_drone"],
    levelRecipeOverrides: [
      { iron: 3, coal: 5 },
      { amber: 5, iron: 8 },
      { silver: 4, amber: 8 },
    ],
    apply: (stats, level) => {
      add(stats, "droneSpeed", 0.15 * level);
      add(stats, "droneLifetime", (0.25 / 3) * level);
    },
  }),
  defineUpgrade({
    id: "gadgets_drone_drill",
    name: "Бур дрона",
    description: "Сила дронов +45% за уровень; бур использует пробивание плотности и часть бонусов урона по руде.",
    category: "gadgets",
    icon: "⚙",
    maxLevel: 4,
    baseCost: 410,
    growth: 1.55,
    requires: ["gadgets_scout_drone"],
    levelRecipeOverrides: [
      { iron: 4, coal: 5 },
      { amber: 5, iron: 7 },
      { silver: 5, amber: 8 },
      { gold: 3, silver: 8 },
    ],
    apply: (stats, level) => add(stats, "dronePower", 0.45 * level),
  }),
  defineUpgrade({
    id: "gadgets_drone_swarm",
    name: "Рой проходчиков",
    description: "Добавляет по одному дрону за уровень.",
    category: "gadgets",
    icon: "⬡",
    maxLevel: 3,
    baseCost: 560,
    growth: 1.68,
    requires: ["gadgets_drone_battery", "gadgets_drone_drill"],
    levelRecipeOverrides: [
      { amber: 5, iron: 8 },
      { silver: 6, amber: 10 },
      { gold: 4, silver: 10 },
    ],
    apply: (stats, level) => add(stats, "droneCount", level),
  }),
  defineUpgrade({
    id: "gadgets_volatile_jackpot",
    name: "Взрывной куш",
    description: "Шанс гигантской бомбы +2,5%, выход взорванной руды +13,3% за уровень.",
    category: "gadgets",
    icon: "✺",
    maxLevel: 3,
    effectLevelMultiplier: 4 / 3,
    baseCost: 580,
    growth: 1.6,
    requires: ["gadgets_cluster_shell", "gadgets_sticky_charge"],
    requiresOreDiscovery: "gold",
    firstRecipeOverride: { gold: 6, silver: 8, amber: 10 },
    apply: (stats, level) => {
      add(stats, "volatileBombChance", 0.01875 * level);
      add(stats, "bombValueMultiplier", 0.1 * level);
    },
  }),
  defineUpgrade({
    id: "gadgets_geo_charge",
    name: "Кумулятивный геозаряд",
    description: "Бомбы взрываются направленным конусом к цели; каждый уровень удлиняет конус на один блок.",
    category: "gadgets",
    icon: "◁",
    maxLevel: 3,
    baseCost: 760,
    growth: 1.66,
    requires: ["gadgets_cluster_shell", "power_tectonic_blow", "power_sample_calibration"],
    levelRecipeOverrides: [
      { gold: 5, silver: 5 },
      { amethyst: 18, gold: 37 },
      { amethyst: 39, gold: 83 },
    ],
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
    baseCost: 1250,
    growth: 1,
    requires: [
      "gadgets_scout_drone",
      "gadgets_sticky_charge",
      "sense_ore_focus",
      "gadgets_geo_charge",
    ],
    requiresOreDiscovery: "void_ore",
    firstRecipeOverride: { void_ore: 2, prism_crystal: 5, amethyst: 6 },
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
    description: "Открывает трёхтактное комбо: дрон ставит метку, цепной разряд заряжает её, а бомба завершает усиленным на 75% взрывом по жиле.",
    category: "gadgets",
    icon: "♫",
    maxLevel: 1,
    baseCost: 2400,
    growth: 1,
    requires: [
      "gadgets_drone_swarm",
      "gadgets_volatile_jackpot",
      "gadgets_shock_capsule",
      "gadgets_geo_charge",
      "gadgets_crew_beacon",
    ],
    recipeOverride: { void_ore: 47, star_core: 6 },
    apply: (stats, level) => {
      stats.demolitionComboEnabled = level > 0;
      stats.demolitionComboMarkDuration = 3;
      stats.demolitionComboFinishPower = 0.75;
      stats.demolitionComboVeinRadiusTiles = 2;
      add(stats, "droneBombChance", 0.1 * level);
    },
  }),
];

const toolUpgrades = [
  defineUpgrade({
    id: "tools_balanced_handle",
    name: "Сбалансированная рукоять",
    description: "Скорость ударов +10% за уровень.",
    category: "tools",
    layoutLobe: "dig",
    icon: "⚒",
    maxLevel: 6,
    effectLevelMultiplier: 1.5,
    baseCost: 7,
    growth: 1.32,
    requires: ["core_first_descent"],
    firstRecipeOverride: { copper: 1 },
    levelRecipeOverrides: [
      null, null, { iron: 4, amber: 2 }, null,
      { gold: 4, amethyst: 1 },
      { gold: 4, amethyst: 2 },
    ],
    apply: (stats, level) => add(stats, "digSpeedMultiplier", (0.6 / 9) * level),
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
    recipeOverride: { copper: 2, coal: 3, iron: 1 },
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
    baseCost: 78,
    growth: 1,
    requires: ["tools_iron_pick", "power_tempered_steel"],
    recipeOverride: { iron: 4, coal: 8 },
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
    description: "Инструмент IV ранга: скорость ударов +25%, сила +18% и пробивание плотности +0,35.",
    category: "tools",
    icon: "⚙",
    maxLevel: 1,
    baseCost: 145,
    growth: 1,
    requires: ["tools_steel_pick", { id: "tools_balanced_handle", level: 3 }],
    recipeOverride: { silver: 4, amber: 9 },
    apply: (stats, level) => {
      if (level > 0) {
        stats.tool = "pneumaticPick";
        stats.toolTier = Math.max(stats.toolTier, 4);
      }
      add(stats, "digSpeedMultiplier", 0.25 * level);
      add(stats, "pickPowerMultiplier", 0.18 * level);
      add(stats, "hardnessPierce", 0.35 * level);
    },
  }),
  defineUpgrade({
    id: "tools_super_pick",
    name: "Суперкирка",
    description: "Инструмент V ранга: сила +65%, скорость +10% и два удара за замах.",
    category: "tools",
    icon: "★",
    maxLevel: 1,
    baseCost: 420,
    growth: 1,
    requires: ["tools_pneumatic_pick", "power_diamond_tip", "dig_omni_swing"],
    recipeOverride: { silver: 30, gold: 20, amber: 8 },
    apply: (stats, level) => {
      if (level > 0) {
        stats.tool = "superPick";
        stats.toolTier = Math.max(stats.toolTier, 5);
        stats.superPickUnlocked = true;
      }
      add(stats, "pickPowerMultiplier", 0.65 * level);
      add(stats, "digSpeedMultiplier", 0.1 * level);
      add(stats, "multiHitCount", level);
    },
  }),
  defineUpgrade({
    id: "tools_super_motor",
    name: "Мотор суперкирки",
    description: "Скорость суперкирки +11,25% за уровень.",
    category: "tools",
    icon: "⚙",
    maxLevel: 4,
    effectLevelMultiplier: 1.25,
    baseCost: 320,
    growth: 1.76,
    requires: ["tools_super_pick"],
    levelRecipeOverrides: [
      { amethyst: 4, gold: 4 },
      { prism_crystal: 2, amethyst: 3 },
      { void_ore: 35, prism_crystal: 55, amethyst: 45 },
      { void_ore: 70, prism_crystal: 105, star_core: 15 },
    ],
    apply: (stats, level) => add(stats, "digSpeedMultiplier", 0.09 * level),
  }),
  defineUpgrade({
    id: "tools_super_teeth",
    name: "Зубья суперкирки",
    description: "Сила суперкирки +16,25% за уровень.",
    category: "tools",
    icon: "▴",
    maxLevel: 4,
    effectLevelMultiplier: 1.25,
    baseCost: 380,
    growth: 1.78,
    requires: ["tools_super_pick"],
    levelRecipeOverrides: [
      { amethyst: 4, gold: 5 },
      { prism_crystal: 2, amethyst: 3 },
      { void_ore: 40, prism_crystal: 60, amethyst: 50 },
      { void_ore: 80, prism_crystal: 120, star_core: 20 },
    ],
    apply: (stats, level) => add(stats, "pickPowerMultiplier", 0.13 * level),
  }),
  defineUpgrade({
    id: "tools_super_field",
    name: "Накопитель поля",
    description: "Удары суперкирки создают поле радиусом 1,0–1,75 блока и силой 30–60%. После получения лазера поле возникает в точке попадания луча.",
    category: "tools",
    icon: "◌",
    maxLevel: 4,
    baseCost: 430,
    growth: 1.82,
    requires: [
      { id: "tools_super_motor", level: 1 },
      { id: "tools_super_teeth", level: 1 },
    ],
    requiresOreDiscovery: "amethyst",
    levelRecipeOverrides: [
      { amethyst: 8, gold: 6 },
      { void_ore: 2, prism_crystal: 2, amethyst: 3 },
      { void_ore: 45, prism_crystal: 70, star_core: 12 },
      { void_ore: 95, prism_crystal: 140, star_core: 25 },
    ],
    apply: (stats, level) => {
      stats.superFieldEnabled = true;
      stats.superFieldRadiusTiles = 0.75 + 0.25 * level;
      stats.superFieldPower = 0.2 + 0.1 * level;
      stats.superFieldDuration = 0.8 + 0.2 * level;
      stats.superFieldLaserPersistent = true;
    },
  }),
  defineUpgrade({
    id: "tools_laser_emitter",
    name: "Дальнобойный лазер",
    description: "Инструмент VI ранга: заменяет кирку лучом, достающим далёкую руду.",
    category: "tools",
    icon: "━",
    maxLevel: 1,
    baseCost: 1500,
    growth: 1,
    requires: [
      { id: "tools_super_field", level: 2 },
      "sense_far_echo",
      "tools_super_pick",
      "sense_frequency_swing",
    ],
    requiresOreDiscovery: "void_ore",
    recipeOverride: { void_ore: 3, prism_crystal: 6, amethyst: 6 },
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
    description: "Дальность лазера +42 за уровень.",
    category: "tools",
    icon: "⟶",
    maxLevel: 5,
    effectLevelMultiplier: 1.2,
    baseCost: 2000,
    growth: 1.5,
    requires: ["tools_laser_emitter"],
    maximumGeneratedTier: 8,
    levelRecipeOverrides: [
      { void_ore: 6, prism_crystal: 10 },
      { void_ore: 14, prism_crystal: 24 },
      { void_ore: 25, prism_crystal: 40 },
      { void_ore: 55, prism_crystal: 80 },
      { void_ore: 100, prism_crystal: 140 },
    ],
    apply: (stats, level) => add(stats, "laserRange", 35 * level),
  }),
  defineUpgrade({
    id: "tools_laser_power",
    name: "Резонатор луча",
    description: "Мощность лазера +21,6% за уровень.",
    category: "tools",
    icon: "═",
    maxLevel: 5,
    effectLevelMultiplier: 1.2,
    baseCost: 2100,
    growth: 1.59,
    requires: ["tools_laser_emitter"],
    levelRecipeOverrides: [
      { void_ore: 7, prism_crystal: 13 },
      { void_ore: 17, prism_crystal: 29 },
      { void_ore: 30, prism_crystal: 45, star_core: 6 },
      { void_ore: 60, prism_crystal: 85, star_core: 15 },
      { void_ore: 110, prism_crystal: 150, star_core: 30 },
    ],
    apply: (stats, level) => add(stats, "laserPower", 0.18 * level),
  }),
  defineUpgrade({
    id: "tools_laser_width",
    name: "Термический след",
    description: "Ширина луча +3,75. Его края наносят 26–45% силы и на 1,2 секунды нагревают соседние блоки; следующее попадание по ним сильнее на 7,5–30%.",
    category: "tools",
    icon: "▰",
    maxLevel: 4,
    effectLevelMultiplier: 1.25,
    baseCost: 2400,
    growth: 1.61,
    requires: ["tools_laser_power", { id: "time_capsule", level: 3 }],
    levelRecipeOverrides: [
      { void_ore: 8, prism_crystal: 14 },
      { void_ore: 20, prism_crystal: 32 },
      { void_ore: 40, prism_crystal: 55, star_core: 8 },
      { void_ore: 80, prism_crystal: 105, star_core: 20 },
    ],
    apply: (stats, level) => {
      add(stats, "laserWidth", 3 * level);
      stats.laserHeatEdgePower = 0.2 + 0.05 * level;
      stats.laserHeatDuration = 1.2;
      add(stats, "laserHeatNextHitBonus", 0.06 * level);
    },
  }),
  defineUpgrade({
    id: "tools_laser_splitter",
    name: "Призматический делитель",
    description: "Добавляет боковой луч; следующий уровень усиливает расщепление.",
    category: "tools",
    icon: "⋔",
    maxLevel: 3,
    baseCost: 2800,
    growth: 1.35,
    requires: ["tools_laser_range", "tools_laser_width"],
    levelRecipeOverrides: [
      { void_ore: 9, prism_crystal: 16 },
      { void_ore: 12, prism_crystal: 18, star_core: 5 },
      { void_ore: 55, prism_crystal: 80, star_core: 20 },
    ],
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
    baseCost: 2100,
    growth: 1.72,
    requiresBestDepth: 1200,
    requires: [
      "tools_laser_emitter",
      "sense_ore_focus",
      { id: "tools_laser_range", level: 1 },
    ],
    levelRecipeOverrides: [
      { void_ore: 18, prism_crystal: 28 },
      { void_ore: 35, prism_crystal: 50, star_core: 12 },
    ],
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
    baseCost: 2800,
    growth: 1.74,
    requires: ["tools_laser_splitter", "dig_omni_swing"],
    levelRecipeOverrides: [
      { void_ore: 8, prism_crystal: 14 },
      { void_ore: 40, prism_crystal: 55, star_core: 14 },
    ],
    apply: (stats, level) => {
      stats.laserSuperPickEchoEvery = [0, 6, 4][level] || 6;
      stats.laserSuperPickEchoRadiusTiles = [0, 1, 1.4][level] || 1;
      stats.laserSuperPickEchoPower = [0, 0.6, 0.85][level] || 0.6;
      stats.laserSuperPickEchoNoProcs = true;
    },
  }),
  defineUpgrade({
    id: "tools_solar_drill",
    name: "Призмоконденсатор",
    description: "Переводит лазер на призмопитание: мощность +15%, скорость заряда +10%. Модуль нужен для сборки Солнечного бура.",
    category: "tools",
    icon: "☀",
    maxLevel: 1,
    baseCost: 7200,
    growth: 1,
    requires: [
      { id: "tools_laser_splitter", level: 2 },
      { id: "power_corebreaker", level: 2 },
      "tools_mirror_crystal",
      "tools_super_pick_echo",
    ],
    recipeOverride: { prism_crystal: 47, void_ore: 29 },
    apply: (stats, level) => {
      if (level > 0) {
        stats.tool = "prismaticLaser";
        stats.toolTier = Math.max(stats.toolTier, 7);
      }
      add(stats, "laserPower", 0.15 * level);
      add(stats, "laserChargeRate", 0.1 * level);
    },
  }),
];

const fortuneUpgrades = [
  defineUpgrade({
    id: "fortune_prospector_ledger",
    name: "Дневник старателя",
    description: "Средний выход кусков руды +9% за уровень.",
    category: "fortune",
    layoutLobe: "sense",
    icon: "▤",
    maxLevel: 8,
    effectLevelMultiplier: 1.5,
    baseCost: 5,
    growth: 1.3,
    requires: ["core_first_descent"],
    firstRecipeOverride: { copper: 1 },
    levelRecipeOverrides: [
      null, null, null, null, null, null,
      { gold: 6, amethyst: 2 },
      { gold: 9, amethyst: 3 },
    ],
    apply: (stats, level) => add(stats, "oreValueMultiplier", 0.06 * level),
  }),
  defineUpgrade({
    id: "fortune_lucky_chip",
    name: "Счастливый жетон",
    description: "Удача +7% за уровень; влияет на все редкие срабатывания.",
    category: "fortune",
    icon: "✦",
    maxLevel: 4,
    effectLevelMultiplier: 1.25,
    baseCost: 23,
    growth: 1.41,
    requires: ["fortune_prospector_ledger"],
    apply: (stats, level) => add(stats, "luck", 0.056 * level),
  }),
  defineUpgrade({
    id: "fortune_glimmer_hunter",
    name: "Охотник за блеском",
    description: "Шанс получить дополнительный кусок более редкой руды +3,6% за уровень. Исходная добыча всегда сохраняется.",
    category: "fortune",
    icon: "✧",
    maxLevel: 5,
    effectLevelMultiplier: 1.2,
    baseCost: 42,
    growth: 1.45,
    requires: ["fortune_lucky_chip"],
    firstRecipeOverride: { copper: 2, coal: 1 },
    apply: (stats, level) => add(stats, "rareOreAdditiveChance", 0.03 * level),
  }),
  defineUpgrade({
    id: "fortune_gem_polish",
    name: "Огранка самоцветов",
    description: "Аметист и более редкие жилы дают на 10,8% больше кусков за уровень.",
    category: "fortune",
    icon: "◇",
    maxLevel: 5,
    effectLevelMultiplier: 1.2,
    baseCost: 58,
    growth: 1.47,
    requires: [{ id: "fortune_prospector_ledger", level: 2 }],
    firstRecipeOverride: { coal: 3, iron: 1 },
    apply: (stats, level) => add(stats, "gemValueMultiplier", 0.09 * level),
  }),
  defineUpgrade({
    id: "fortune_rich_vein",
    name: "Богатая жила",
    description: "Первый кусок с шансом +3,6% за уровень помечает всю существующую жилу богатой: оставшиеся ноды дают +50%, а завершение приносит 1/2/3/4/6 дополнительных кусков.",
    category: "fortune",
    icon: "▦",
    maxLevel: 5,
    effectLevelMultiplier: 1.2,
    baseCost: 88,
    growth: 1.48,
    requires: ["fortune_glimmer_hunter"],
    firstRecipeOverride: { coal: 2, iron: 1 },
    apply: (stats, level) => {
      add(stats, "richVeinWholeChance", 0.03 * level);
      stats.richVeinYieldBonus = 0.5;
      add(stats, "richVeinCompletionBonus", level);
    },
  }),
  defineUpgrade({
    id: "fortune_double_yield",
    name: "Двойная добыча",
    description: "Шанс получить двойную награду +4,5% за уровень.",
    category: "fortune",
    icon: "Ⅱ",
    maxLevel: 4,
    effectLevelMultiplier: 1.25,
    baseCost: 112,
    growth: 1.5,
    requires: [{ id: "fortune_prospector_ledger", level: 2 }],
    firstRecipeOverride: { coal: 2, iron: 1 },
    apply: (stats, level) => add(stats, "doubleDropChance", 0.036 * level),
  }),
  defineUpgrade({
    id: "fortune_triple_seam",
    name: "Тройная проба",
    description: "Каждый 5-й/4-й/3-й кусок одной жилы гарантирует +1/+2/+2 добычи и раскалывает следующую ноду на 25/40/50%.",
    category: "fortune",
    icon: "Ⅲ",
    maxLevel: 3,
    baseCost: 190,
    growth: 1.68,
    requires: ["fortune_double_yield", "fortune_rich_vein"],
    levelRecipeOverrides: [
      { silver: 2 },
      { silver: 26 },
      { gold: 18, silver: 36 },
    ],
    apply: (stats, level) => {
      stats.tripleSampleEvery = [0, 5, 4, 3][level] || 5;
      stats.tripleSampleBonusYield = [0, 1, 2, 2][level] || 1;
      stats.tripleSampleNextNodeDamage = [0, 0.25, 0.4, 0.5][level] || 0.25;
    },
  }),
  defineUpgrade({
    id: "fortune_alchemist_scales",
    name: "Переплавка импульса",
    description: "25/40/55/70/85% реального лишнего урона от кирки, лазера и гаджетов сохраняется в шкале и переносится на следующую ноду жилы; полный заряд даёт дополнительную добычу.",
    category: "fortune",
    icon: "⚖",
    maxLevel: 5,
    baseCost: 230,
    growth: 1.54,
    requires: ["fortune_gem_polish", "power_shatterpoint"],
    firstRecipeOverride: { gold: 2, silver: 3, amber: 3 },
    apply: (stats, level) => {
      stats.trueOverkillEnabled = true;
      stats.overkillReservoirRatio = [0, 0.25, 0.4, 0.55, 0.7, 0.85][level] || 0.25;
      stats.overkillReservoirYieldThreshold = 1;
    },
  }),
  defineUpgrade({
    id: "fortune_deep_market",
    name: "Контракт глубины",
    description: "Каждые 100 метров общей глубины дают стак выхода руды: +3,6% за уровень. В забеге может накопиться до восьми стаков.",
    category: "fortune",
    icon: "↧",
    maxLevel: 5,
    effectLevelMultiplier: 1.2,
    baseCost: 285,
    growth: 1.56,
    requires: ["fortune_gem_polish"],
    firstRecipeOverride: { amethyst: 2, gold: 4, silver: 5 },
    apply: (stats, level) => {
      stats.depthContractStep = 100;
      add(stats, "depthContractBonusPerStack", 0.03 * level);
      stats.depthContractMaxStacks = 8;
    },
  }),
  defineUpgrade({
    id: "fortune_golden_touch",
    name: "Золотое касание",
    description: "Шанс получить дополнительный кусок золота +1,9% за уровень. Исходная руда не заменяется.",
    category: "fortune",
    icon: "☀",
    maxLevel: 4,
    baseCost: 420,
    growth: 1.59,
    requires: ["fortune_triple_seam"],
    apply: (stats, level) => add(stats, "goldenOreAdditiveChance", 0.01875 * level),
  }),
  defineUpgrade({
    id: "fortune_relic_magnet",
    name: "Магнит реликвий",
    description: "Шанс получить временную реликвию +1,9% за уровень: второй луч, мягкая порода, бонус времени или усиленный сундук. Эффект заметно показывается сверху.",
    category: "fortune",
    icon: "⌑",
    maxLevel: 4,
    effectLevelMultiplier: 1.25,
    baseCost: 510,
    growth: 1.6,
    requires: ["fortune_lucky_chip", "gadgets_magnet_mine"],
    apply: (stats, level) => {
      add(stats, "pickupRadius", 10 * level);
      add(stats, "relicEffectChance", 0.015 * level);
      stats.relicEffectDuration = 6;
      add(stats, "relicEffectPower", 0.08 * level);
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
    firstRecipeOverride: { amethyst: 3, gold: 6, silver: 8 },
    apply: (stats, level) => {
      add(stats, "oreValueMultiplier", 0.12 * level);
      add(stats, "extraYieldChance", 0.05 * level);
    },
  }),
  defineUpgrade({
    id: "fortune_wheel",
    name: "Колесо фортуны",
    description: "После 8/7/6/5 кусков руды без редкого эффекта следующий гарантирован. Колесо по кругу выдаёт добычу, бомбу, время и богатую ноду.",
    category: "fortune",
    icon: "⊛",
    maxLevel: 4,
    baseCost: 960,
    growth: 1.67,
    requires: ["fortune_relic_magnet", "fortune_kings_ransom"],
    firstRecipeOverride: { prism_crystal: 3, amethyst: 5, gold: 6 },
    apply: (stats, level) => {
      stats.fortuneWheelEnabled = true;
      stats.fortunePityThreshold = [0, 8, 7, 6, 5][level] || 8;
      stats.fortuneWheelCycleLength = 4;
    },
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
    requires: ["fortune_deep_market", "sense_vein_whisper", "sense_ore_focus"],
    firstRecipeOverride: { amethyst: 2, gold: 5, silver: 6 },
    apply: (stats, level) => add(stats, "oreDiversityBonusPerType", 0.02 * level),
  }),
  defineUpgrade({
    id: "fortune_motherlode_covenant",
    name: "Договор с Материнской жилой",
    description: "После 20 добытых кусков гарантированно помечает одну существующую жилу высшего доступного тира Материнской: выход ×2, а завершение даёт смешанный тайник и +2,5 секунды.",
    category: "fortune",
    icon: "♢",
    maxLevel: 1,
    baseCost: 2600,
    growth: 1,
    requires: ["fortune_wheel", "fortune_alchemist_scales", "fortune_findings_catalog"],
    recipeOverride: { prism_crystal: 76, star_core: 6 },
    apply: (stats, level) => {
      stats.motherlodeGuaranteed = level > 0;
      stats.motherlodeTriggerBreaks = 20;
      stats.motherlodeYieldMultiplier = 2;
      stats.motherlodeCompletionCache = 6;
      stats.motherlodeCompletionTimeBonus = 2.5;
    },
  }),
];

const coreFinalUpgrade = defineUpgrade({
  id: "core_bon_voyage",
  name: "Солнечный бур",
  description: "Даёт финальному спуску 60 секунд энергии и ведёт к Печати. Каждый пятый контакт удерживает луч 0,7 секунды: завершённый импульс плавит породу в радиусе 3,25 блока. Расплавленная руда не собирается. Три близких импульса раскроют Печать.",
  category: "core",
  icon: "☀",
  maxLevel: 1,
  baseCost: 24000,
  growth: 1,
  requiresBestDepth: 1600,
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
    prism_crystal: 40,
    void_ore: 22,
    star_core: 5,
  },
  apply: (stats, level) => {
    if (level > 0) {
      stats.tool = "prismaticLaser";
      stats.toolTier = Math.max(stats.toolTier, 7);
      stats.bonVoyageUnlocked = true;
      stats.solarDrillEnabled = true;
      stats.solarDrillProcEvery = 5;
      stats.solarDrillBeamDuration = 0.7;
      // Before the first ending, completed real-contact pulses melt their
      // local tunnel independently of the purchased optional damage ranks.
      // The damage multiplier remains the ordinary post-ending tool effect.
      stats.solarDrillFinalBurstPower = 18;
      stats.solarDrillFinalBurstRadiusTiles = 3.25;
    }
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
    echoPingCooldown: 0,
    echoPingRadiusMultiplier: 1,
    echoPingTargetHold: 0,
    deepOreSenseBonus: 0,
    deepResonanceEnabled: false,
    deepResonanceCooldown: 0,
    deepResonanceRadiusMultiplier: 1,
    deepResonanceSolidLayers: 0,
    deepResonanceConeHalfAngle: 0,
    deepResonanceTargetHold: 0,
    deepResonanceTargetSlots: 0,
    veinRevealChance: 0,
    veinTrailEnabled: false,
    veinTrailRangeMultiplier: 1,
    veinTrailMoveSpeedBonus: 0,
    descentTargetBias: 0,
    descentMoveSpeedBonus: 0,
    openingDescentMoveSpeedBonus: 0,
    openingDepthPowerBonus: 0,
    targetLockSpeed: 1,
    targetValueBias: 0.12,
    backupTargetSlots: 0,
    seismicRouteSlots: 0,
    oreOutline: false,
    ghostTrailDuration: 0,
    ghostTrailMaxLayers: 0,
    oreFocusUnlocked: false,
    oreFocusRadiusMultiplier: 1,
    focusVeinSizeBias: 0,
    focusVeinMoveSpeedPerNode: 0,
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
    openingSprintMultiplier: 1,
    targetRelaySprintMultiplier: 1,
    targetRelaySprintDuration: 0,
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
    sideChipEvery: 0,
    sideChipTargets: 0,
    sideChipPower: 0,
    sideChipLaserEnabled: false,
    approachStrikeTravelTime: 0,
    approachStrikePower: 0,
    approachStrikeSideChipPower: 0,
    splashRadius: 0,
    splashDamage: 0,
    impactWaveEvery: 0,
    impactWaveRadiusTiles: 0,
    impactWavePower: 0,
    leastResistancePathing: false,
    mineLiftRecordDepthRatio: 0,
    quarryModeRequiredBreaks: 0,
    quarryModeWindow: 0,
    quarryModeDuration: 0,
    quarryModeMoveSpeedBonus: 0,
    quarryModeDigSpeedBonus: 0,
    quarryModeSideFracturePower: 0,

    // Direct mining damage.
    pickPower: 1,
    pickPowerMultiplier: 1,
    hardnessPierce: 0,
    critChance: 0.02,
    critMultiplier: 1.75,
    faultFinderCadenceEvery: 0,
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
    faultLineEnabled: false,
    faultLineMaxBlocks: 0,
    faultLinePower: 0,
    faultLineExtendOnBreak: false,

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
    chronoOverdrive: false,
    chronoOverflowThreshold: 45,
    chronoOverflowSpeedBonus: 0,
    chronoOverflowRepeatEvery: 0,

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
    dronePower: 0.75,
    droneSpeed: 1.3,
    droneLifetime: 0.75,
    droneBombChance: 0,
    crewBeaconUnlocked: false,
    crewBeaconOverkillCarry: 0,
    magneticFieldEnabled: false,
    magneticFieldDuration: 0,
    magneticFieldRadiusTiles: 0,
    magneticFieldTargetingBonus: 0,
    demolitionComboEnabled: false,
    demolitionComboMarkDuration: 0,
    demolitionComboFinishPower: 0,
    demolitionComboVeinRadiusTiles: 0,

    // Tool progression.
    tool: "pickaxe",
    toolTier: 1,
    superPickUnlocked: false,
    laserUnlocked: false,
    laserRange: 210,
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
    superFieldEnabled: false,
    superFieldRadiusTiles: 0,
    superFieldPower: 0,
    superFieldDuration: 0,
    superFieldLaserPersistent: false,
    laserHeatEdgePower: 0,
    laserHeatDuration: 0,
    laserHeatNextHitBonus: 0,
    solarDrillEnabled: false,
    solarDrillProcEvery: 0,
    solarDrillBeamDuration: 0,
    solarDrillFinalBurstPower: 0,
    solarDrillFinalBurstRadiusTiles: 0,

    // Rewards and procedural fortune. Consumers combine `luck` and explicit
    // proc chances; this module does not roll random values itself.
    oreValueMultiplier: 1,
    luck: 0,
    rareOreChance: 0,
    rareOreAdditiveChance: 0,
    gemValueMultiplier: 1,
    richVeinChance: 0,
    richVeinWholeChance: 0,
    richVeinYieldBonus: 0,
    richVeinCompletionBonus: 0,
    doubleDropChance: 0,
    extraYieldChance: 0,
    tripleDropChance: 0,
    tripleSampleEvery: 0,
    tripleSampleBonusYield: 0,
    tripleSampleNextNodeDamage: 0,
    oreConversionBonus: 0,
    trueOverkillEnabled: false,
    overkillReservoirRatio: 0,
    overkillReservoirYieldThreshold: 0,
    depthValueBonus: 0,
    depthContractStep: 0,
    depthContractBonusPerStack: 0,
    depthContractMaxStacks: 0,
    goldenOreChance: 0,
    goldenOreAdditiveChance: 0,
    relicChance: 0,
    relicEffectChance: 0,
    relicEffectDuration: 0,
    relicEffectPower: 0,
    fortuneProcChance: 0,
    fortuneWheelEnabled: false,
    fortunePityThreshold: 0,
    fortuneWheelCycleLength: 0,
    motherlodeChance: 0,
    motherlodeGuaranteed: false,
    motherlodeTriggerBreaks: 0,
    motherlodeYieldMultiplier: 1,
    motherlodeCompletionCache: 0,
    motherlodeCompletionTimeBonus: 0,
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
  "rareOreAdditiveChance",
  "richVeinChance",
  "richVeinWholeChance",
  "doubleDropChance",
  "extraYieldChance",
  "tripleDropChance",
  "goldenOreChance",
  "goldenOreAdditiveChance",
  "relicChance",
  "relicEffectChance",
  "fortuneProcChance",
  "motherlodeChance",
  "focusedOreHardnessReduction",
];

function normalizeMetaStats(stats) {
  stats.senseRadius = Math.max(1, stats.senseRadius * stats.senseRadiusMultiplier);
  stats.echoPingCooldown = Math.max(0, stats.echoPingCooldown);
  stats.echoPingRadiusMultiplier = Math.max(1, stats.echoPingRadiusMultiplier);
  stats.echoPingTargetHold = Math.max(0, stats.echoPingTargetHold);
  stats.veinTrailRangeMultiplier = Math.max(1, stats.veinTrailRangeMultiplier);
  stats.veinTrailMoveSpeedBonus = Math.max(0, stats.veinTrailMoveSpeedBonus);
  stats.descentTargetBias = Math.max(0, stats.descentTargetBias);
  stats.descentMoveSpeedBonus = Math.max(0, stats.descentMoveSpeedBonus);
  stats.seismicRouteSlots = Math.max(0, Math.floor(stats.seismicRouteSlots));
  stats.ghostTrailDuration = Math.max(0, stats.ghostTrailDuration);
  stats.ghostTrailMaxLayers = Math.max(0, Math.floor(stats.ghostTrailMaxLayers));
  stats.focusVeinSizeBias = Math.max(0, stats.focusVeinSizeBias);
  stats.focusVeinMoveSpeedPerNode = Math.max(0, stats.focusVeinMoveSpeedPerNode);
  stats.moveSpeed = Math.max(1, stats.moveSpeed * stats.moveSpeedMultiplier);
  stats.mineMoveMultiplier = Math.max(0.1, stats.mineMoveMultiplier);
  const rawDigReach = Math.max(1, stats.digReach * stats.digReachMultiplier);
  const toolTier = clamp(Math.floor(Number(stats.toolTier) || 1), 1, 7);
  const reachBands = [
    null,
    { min: 38, max: 64 },
    { min: 38, max: 68 },
    { min: 38, max: 76 },
    { min: 56, max: 88 },
    { min: 72, max: 112 },
    { min: 72, max: 112 },
    { min: 72, max: 112 },
  ];
  const reachBand = reachBands[toolTier];
  stats.toolTier = toolTier;
  stats.pickReachCap = reachBand.max;
  stats.digReach = clamp(rawDigReach, reachBand.min, reachBand.max);
  stats.digRadius = Math.max(1, stats.digRadius);
  stats.digArc = clamp(stats.digArc, Math.PI / 18, Math.PI * 2);
  stats.digSpeed = Math.max(0.1, stats.digSpeed * stats.digSpeedMultiplier);
  stats.sideChipEvery = Math.max(0, Math.floor(stats.sideChipEvery));
  stats.sideChipTargets = Math.max(0, Math.floor(stats.sideChipTargets));
  stats.sideChipPower = clamp(stats.sideChipPower, 0, 1);
  stats.approachStrikeTravelTime = Math.max(0, stats.approachStrikeTravelTime);
  stats.approachStrikePower = Math.max(0, stats.approachStrikePower);
  stats.approachStrikeSideChipPower = clamp(stats.approachStrikeSideChipPower, 0, 1);
  stats.impactWaveEvery = Math.max(0, Math.floor(stats.impactWaveEvery));
  stats.impactWaveRadiusTiles = Math.max(0, stats.impactWaveRadiusTiles);
  stats.impactWavePower = clamp(stats.impactWavePower, 0, 1);
  stats.quarryModeRequiredBreaks = Math.max(0, Math.floor(stats.quarryModeRequiredBreaks));
  stats.quarryModeWindow = Math.max(0, stats.quarryModeWindow);
  stats.quarryModeDuration = Math.max(0, stats.quarryModeDuration);
  stats.quarryModeMoveSpeedBonus = Math.max(0, stats.quarryModeMoveSpeedBonus);
  stats.quarryModeDigSpeedBonus = Math.max(0, stats.quarryModeDigSpeedBonus);
  stats.quarryModeSideFracturePower = clamp(stats.quarryModeSideFracturePower, 0, 1);
  stats.pickPower = Math.max(0.1, stats.pickPower * stats.pickPowerMultiplier);
  stats.faultLineMaxBlocks = Math.max(0, Math.floor(stats.faultLineMaxBlocks));
  stats.faultLinePower = clamp(stats.faultLinePower, 0, 1);
  stats.maxRunDuration = clamp(stats.maxRunDuration, 6, 45);
  stats.runDuration = clamp(stats.runDuration, 6, stats.maxRunDuration);
  stats.bonusRunDurationCap = clamp(stats.bonusRunDurationCap, stats.maxRunDuration, 60);
  stats.discoveryTimeBonus = Math.max(0, stats.discoveryTimeBonus);
  stats.chronoOverflowThreshold = clamp(stats.chronoOverflowThreshold, 45, 60);
  stats.chronoOverflowSpeedBonus = Math.max(0, stats.chronoOverflowSpeedBonus);
  stats.chronoOverflowRepeatEvery = Math.max(0, Math.floor(stats.chronoOverflowRepeatEvery));
  stats.timerDrainReduction = clamp(stats.timerDrainReduction, 0, 0.5);
  stats.timerDrainMultiplier = 1 - stats.timerDrainReduction;
  stats.timeRefundAmount *= stats.timeRefundMultiplier;
  stats.bombPower = Math.max(0, stats.bombPower);
  stats.directionalBombConeTiles = Math.max(0, Math.floor(stats.directionalBombConeTiles));
  stats.crewBeaconOverkillCarry = clamp(stats.crewBeaconOverkillCarry, 0, 1);
  stats.magneticFieldDuration = Math.max(0, stats.magneticFieldDuration);
  stats.magneticFieldRadiusTiles = Math.max(0, stats.magneticFieldRadiusTiles);
  stats.magneticFieldTargetingBonus = Math.max(0, stats.magneticFieldTargetingBonus);
  stats.demolitionComboMarkDuration = Math.max(0, stats.demolitionComboMarkDuration);
  stats.demolitionComboFinishPower = Math.max(0, stats.demolitionComboFinishPower);
  stats.demolitionComboVeinRadiusTiles = Math.max(0, stats.demolitionComboVeinRadiusTiles);
  stats.chainPower = Math.max(0, stats.chainPower);
  stats.dronePower = Math.max(0, stats.dronePower);
  stats.laserRange = clamp(stats.laserRange, 210, 420);
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
  stats.mineLiftRecordDepthRatio = clamp(stats.mineLiftRecordDepthRatio, 0, 1);
  stats.oreDiversityBonusPerType = Math.max(0, stats.oreDiversityBonusPerType);
  stats.laserSuperPickEchoEvery = Math.max(0, Math.floor(stats.laserSuperPickEchoEvery));
  stats.laserSuperPickEchoRadiusTiles = Math.max(0, stats.laserSuperPickEchoRadiusTiles);
  stats.laserSuperPickEchoPower = clamp(stats.laserSuperPickEchoPower, 0, 1);
  stats.superFieldRadiusTiles = Math.max(0, stats.superFieldRadiusTiles);
  stats.superFieldPower = clamp(stats.superFieldPower, 0, 1);
  stats.superFieldDuration = Math.max(0, stats.superFieldDuration);
  stats.laserHeatEdgePower = clamp(stats.laserHeatEdgePower, 0, 1);
  stats.laserHeatDuration = Math.max(0, stats.laserHeatDuration);
  stats.laserHeatNextHitBonus = Math.max(0, stats.laserHeatNextHitBonus);
  stats.solarDrillProcEvery = Math.max(0, Math.floor(stats.solarDrillProcEvery));
  stats.solarDrillBeamDuration = Math.max(0, stats.solarDrillBeamDuration);
  stats.solarDrillFinalBurstPower = Math.max(0, stats.solarDrillFinalBurstPower);
  stats.solarDrillFinalBurstRadiusTiles = Math.max(0, stats.solarDrillFinalBurstRadiusTiles);
  stats.richVeinYieldBonus = Math.max(0, stats.richVeinYieldBonus);
  stats.richVeinCompletionBonus = Math.max(0, Math.floor(stats.richVeinCompletionBonus));
  stats.tripleSampleEvery = Math.max(0, Math.floor(stats.tripleSampleEvery));
  stats.tripleSampleBonusYield = Math.max(0, Math.floor(stats.tripleSampleBonusYield));
  stats.tripleSampleNextNodeDamage = clamp(stats.tripleSampleNextNodeDamage, 0, 1);
  stats.overkillReservoirRatio = clamp(stats.overkillReservoirRatio, 0, 1);
  stats.overkillReservoirYieldThreshold = Math.max(0, stats.overkillReservoirYieldThreshold);
  stats.depthContractStep = Math.max(0, stats.depthContractStep);
  stats.depthContractBonusPerStack = Math.max(0, stats.depthContractBonusPerStack);
  stats.depthContractMaxStacks = Math.max(0, Math.floor(stats.depthContractMaxStacks));
  stats.relicEffectDuration = Math.max(0, stats.relicEffectDuration);
  stats.relicEffectPower = Math.max(0, stats.relicEffectPower);
  stats.fortunePityThreshold = Math.max(0, Math.floor(stats.fortunePityThreshold));
  stats.fortuneWheelCycleLength = Math.max(0, Math.floor(stats.fortuneWheelCycleLength));
  stats.motherlodeTriggerBreaks = Math.max(0, Math.floor(stats.motherlodeTriggerBreaks));
  stats.motherlodeYieldMultiplier = Math.max(1, stats.motherlodeYieldMultiplier);
  stats.motherlodeCompletionCache = Math.max(0, Math.floor(stats.motherlodeCompletionCache));
  stats.motherlodeCompletionTimeBonus = Math.max(0, stats.motherlodeCompletionTimeBonus);

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
    if (level > 0) definition.apply(stats, level * definition.effectLevelMultiplier);
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
