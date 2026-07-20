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
  core: Object.freeze({ name: "ÐŸÑƒÑ‚ÑŒ", icon: "â—†" }),
  sense: Object.freeze({ name: "Ð§ÑƒÑ‚ÑŒÑ‘", icon: "â—‰" }),
  dig: Object.freeze({ name: "ÐšÐ¾Ð¿ÐºÐ°", icon: "â›" }),
  power: Object.freeze({ name: "Ð¡Ð¸Ð»Ð°", icon: "â—†" }),
  time: Object.freeze({ name: "Ð’Ñ€ÐµÐ¼Ñ", icon: "â—·" }),
  gadgets: Object.freeze({ name: "Ð“Ð°Ð´Ð¶ÐµÑ‚Ñ‹", icon: "âœ¹" }),
  tools: Object.freeze({ name: "Ð˜Ð½ÑÑ‚Ñ€ÑƒÐ¼ÐµÐ½Ñ‚Ñ‹", icon: "âš’" }),
  fortune: Object.freeze({ name: "Ð£Ð´Ð°Ñ‡Ð°", icon: "âœ¦" }),
});

const ORE_TYPES = Object.freeze(
  [
    {
      id: "copper",
      tier: 0,
      name: "ÐœÐµÐ´ÑŒ",
      description: "Ð¢Ñ‘Ð¿Ð»Ñ‹Ðµ Ð¿Ð»Ð°ÑÑ‚Ð¸Ñ‡Ð½Ñ‹Ðµ Ð¿Ñ€Ð¾Ð¶Ð¸Ð»ÐºÐ¸, Ñ ÐºÐ¾Ñ‚Ð¾Ñ€Ñ‹Ñ… Ð½Ð°Ñ‡Ð¸Ð½Ð°ÐµÑ‚ÑÑ Ð»ÑŽÐ±Ð°Ñ ÑˆÐ°Ñ…Ñ‚Ñ‘Ñ€ÑÐºÐ°Ñ ÑÐ¼ÐµÐ½Ð°.",
      color: "#c86f43",
      accent: "#ffd0a8",
      value: 1,
      hardness: 1,
      depth: 0,
    },
    {
      id: "coal",
      tier: 1,
      name: "Ð£Ð³Ð¾Ð»ÑŒ",
      description: "Ð¥Ñ€ÑƒÐ¿ÐºÐ¸Ð¹ Ñ‚Ñ‘Ð¼Ð½Ñ‹Ð¹ Ð¿Ð»Ð°ÑÑ‚: Ð´ÐµÑˆÑ‘Ð²Ñ‹Ð¹, Ñ‡Ð°ÑÑ‚Ñ‹Ð¹ Ð¸ ÑƒÐ´Ð¾Ð±Ð½Ñ‹Ð¹ Ð´Ð»Ñ Ñ€Ð°Ð½Ð½Ð¸Ñ… Ð¼ÐµÑ…Ð°Ð½Ð¸Ð·Ð¼Ð¾Ð².",
      color: "#343943",
      accent: "#9ba5b4",
      value: 2,
      hardness: 1.45,
      depth: 112,
    },
    {
      id: "iron",
      tier: 2,
      name: "Ð–ÐµÐ»ÐµÐ·Ð¾",
      description: "ÐŸÐ»Ð¾Ñ‚Ð½Ñ‹Ðµ ÑÐµÑ€Ñ‹Ðµ Ð²ÐºÐ»ÑŽÑ‡ÐµÐ½Ð¸Ñ â€” Ð¿ÐµÑ€Ð²Ð°Ñ ÑÐµÑ€ÑŒÑ‘Ð·Ð½Ð°Ñ Ð¿Ñ€Ð¾Ð²ÐµÑ€ÐºÐ° ÑÐ¸Ð»Ñ‹ Ð¸Ð½ÑÑ‚Ñ€ÑƒÐ¼ÐµÐ½Ñ‚Ð°.",
      color: "#87949c",
      accent: "#e5f0ef",
      value: 4,
      hardness: 2.2,
      depth: 420,
    },
    {
      id: "amber",
      tier: 3,
      name: "Ð¯Ð½Ñ‚Ð°Ñ€ÑŒ",
      description: "Ð—Ð°ÑÑ‚Ñ‹Ð²ÑˆÐ¸Ðµ Ð·Ð¾Ð»Ð¾Ñ‚Ð¸ÑÑ‚Ñ‹Ðµ ÐºÐ°Ð¿Ð»Ð¸ ÑÐ²ÐµÑ‚ÑÑ‚ÑÑ Ð² Ð¼ÑÐ³ÐºÐ¾Ð¹ Ð¿Ð¾Ñ€Ð¾Ð´Ðµ Ð¸ Ñ…Ð¾Ñ€Ð¾ÑˆÐ¾ Ð·Ð°Ð¼ÐµÑ‚Ð½Ñ‹ Ð¸Ð·Ð´Ð°Ð»ÐµÐºÐ°.",
      color: "#d88b1f",
      accent: "#fff0a1",
      value: 8,
      hardness: 3.35,
      depth: 952,
    },
    {
      id: "silver",
      tier: 4,
      name: "Ð¡ÐµÑ€ÐµÐ±Ñ€Ð¾",
      description: "Ð¥Ð¾Ð»Ð¾Ð´Ð½Ñ‹Ðµ ÑÐ²ÐµÑ‚Ð»Ñ‹Ðµ Ð½Ð¸Ñ‚Ð¸ Ð¾Ð±Ñ€Ð°Ð·ÑƒÑŽÑ‚ Ñ‚Ð¾Ð½ÐºÐ¸Ðµ Ð¶Ð¸Ð»Ñ‹ Ð½Ð° Ð³Ñ€Ð°Ð½Ð¸Ñ†Ðµ Ð³Ð»ÑƒÐ±Ð¾ÐºÐ¸Ñ… ÑÐ»Ð¾Ñ‘Ð².",
      color: "#aebbd0",
      accent: "#ffffff",
      value: 16,
      hardness: 5.1,
      depth: 1568,
    },
    {
      id: "gold",
      tier: 5,
      name: "Ð—Ð¾Ð»Ð¾Ñ‚Ð¾",
      description: "Ð ÐµÐ´ÐºÐ¸Ðµ Ñ‚ÑÐ¶Ñ‘Ð»Ñ‹Ðµ ÑÐ°Ð¼Ð¾Ñ€Ð¾Ð´ÐºÐ¸ Ð¾Ð¿Ñ€Ð°Ð²Ð´Ñ‹Ð²Ð°ÑŽÑ‚ Ð´Ð¾Ð»Ð³Ð¸Ð¹ Ð¿ÑƒÑ‚ÑŒ Ð¸ Ð¿Ñ€Ð¾Ñ‡Ð½ÑƒÑŽ ÐºÐ¸Ñ€ÐºÑƒ.",
      color: "#e0a922",
      accent: "#fff6a6",
      value: 32,
      hardness: 7.8,
      depth: 2128,
    },
    {
      id: "amethyst",
      tier: 6,
      name: "ÐÐ¼ÐµÑ‚Ð¸ÑÑ‚",
      description: "Ð¤Ð¸Ð¾Ð»ÐµÑ‚Ð¾Ð²Ñ‹Ðµ ÐºÑ€Ð¸ÑÑ‚Ð°Ð»Ð»Ñ‹ Ñ€Ð°ÑÑ‚ÑƒÑ‚ Ð´Ñ€ÑƒÐ·Ð°Ð¼Ð¸ Ð¸ Ñ€Ð°ÑÐºÐ°Ð»Ñ‹Ð²Ð°ÑŽÑ‚ÑÑ Ð·Ð²Ð¾Ð½ÐºÐ¸Ð¼Ð¸ Ð³Ñ€Ð°Ð½ÑÐ¼Ð¸.",
      color: "#8153c7",
      accent: "#edc7ff",
      value: 68,
      hardness: 11.8,
      depth: 2688,
    },
    {
      id: "prism_crystal",
      tier: 7,
      name: "ÐŸÑ€Ð¸Ð·Ð¼Ð°Ð»Ð¸Ñ‚",
      description: "ÐŸÐµÑ€ÐµÐ»Ð¾Ð¼Ð»ÑÐµÑ‚ ÑÐ²ÐµÑ‚ Ð²Ð½ÑƒÑ‚Ñ€Ð¸ ÐºÐ°Ð¼Ð½Ñ; ÐµÐ³Ð¾ Ð¶Ð¸Ð»Ñ‹ Ð¼ÐµÑ€Ñ†Ð°ÑŽÑ‚ Ð½ÐµÑÐºÐ¾Ð»ÑŒÐºÐ¸Ð¼Ð¸ Ñ†Ð²ÐµÑ‚Ð°Ð¼Ð¸ ÑÑ€Ð°Ð·Ñƒ.",
      color: "#31a9b6",
      accent: "#bffcff",
      value: 145,
      hardness: 17.5,
      depth: 3248,
    },
    {
      id: "void_ore",
      tier: 8,
      name: "ÐŸÑƒÑÑ‚Ð¾Ñ‚Ð½Ð°Ñ Ñ€ÑƒÐ´Ð°",
      description: "ÐŸÐ¾Ð³Ð»Ð¾Ñ‰Ð°ÐµÑ‚ Ð¾ÐºÑ€ÑƒÐ¶Ð°ÑŽÑ‰ÐµÐµ ÑÐ²ÐµÑ‡ÐµÐ½Ð¸Ðµ Ð¸ ÐºÐ°Ð¶ÐµÑ‚ÑÑ Ð¿Ñ€Ð¾Ð²Ð°Ð»Ð¾Ð¼ Ð² Ñ‚Ð¾Ð»Ñ‰Ðµ Ð¿Ð»Ð°Ð½ÐµÑ‚Ñ‹.",
      color: "#312458",
      accent: "#d56dff",
      value: 310,
      hardness: 26,
      depth: 3808,
    },
    {
      id: "star_core",
      tier: 9,
      name: "Ð—Ð²Ñ‘Ð·Ð´Ð½Ð¾Ðµ ÑÐ´Ñ€Ð¾",
      description: "Ð Ð°ÑÐºÐ°Ð»Ñ‘Ð½Ð½Ð°Ñ Ð¼Ð°Ñ‚ÐµÑ€Ð¸Ñ Ð³Ð»ÑƒÐ±Ð¸Ð½ â€” ÑÐ°Ð¼Ñ‹Ð¹ Ð¿Ð»Ð¾Ñ‚Ð½Ñ‹Ð¹ Ð¸ Ñ†ÐµÐ½Ð½Ñ‹Ð¹ Ð¾Ð±Ñ€Ð°Ð·ÐµÑ† ÑÑ‚Ð¾Ð¹ Ð¿Ð»Ð°Ð½ÐµÑ‚Ñ‹.",
      color: "#e9586e",
      accent: "#fff4dd",
      value: 700,
      hardness: 39,
      depth: 4312,
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
  name: "ÐŸÐµÑ€Ð²Ñ‹Ð¹ ÑÐ¿ÑƒÑÐº",
  description: "ÐÐ°Ñ‡Ð°Ð»Ð¾ Ð¿ÑƒÑ‚Ð¸ ÑˆÐ°Ñ…Ñ‚Ñ‘Ñ€Ð°. ÐžÛ¯7ÖÚ$z{-®éÜj×F–ÖU&VgVæD6†æ6S¢À¢F–ÖU&VgVæDÖ÷VçC¢À¢F–ÖU&VgVæD×VÇF—Æ–W#¢À¢F–ÖU6†&D6†æ6S¢À¢F–ÖU6†&E6V6öæG3¢À¢Æ7D6†æ6T6†&vW3¢À¢Æ7D6†æ6U6V6öæG3¢À¢F–ÖW$G&–å&VGV7F–öã¢À¢F–ÖW$G&–ä×VÇF—Æ–W#¢À¢6‡&öæô÷fW&6Æö6³¢fÇ6RÀ¢6‡&öæô÷fW&G&—fS¢fÇ6RÀ¢6‡&öæô÷fW&fÆ÷uF‡&W6†öÆC¢CRÀ¢6‡&öæô÷fW&fÆ÷u7VVD&öçW3¢À¢6‡&öæô÷fW&fÆ÷u&WVDWfW'“¢À ¢òòvFvWG2à¢&öÖ$6†æ6S¢À¢&öÖ%÷vW#¢À¢&öÖ%&F—W3¢3BÀ¢&öÖ$g&vÖVçG3¢À¢&öÖ$g&vÖVçE÷vW#¢ã2À¢7F–6·”&öÖ$6†æ6S¢À¢föÆF–ÆT&öÖ$6†æ6S¢À¢&öÖ%fÇVT×VÇF—Æ–W#¢À¢F—&V7F–öæÄ&öÖ'3¢fÇ6RÀ¢F—&V7F–öæÄ&öÖ$6öæUF–ÆW3¢À¢6†–ä6†æ6S¢À¢6†–ä6÷VçC¢À¢6†–å÷vW#¢ãSRÀ¢6†ö6´GW&F–öã¢À¢–6·W&F—W3¢CbÀ¢G&öæUVæÆö6¶VC¢fÇ6RÀ¢G&öæT6÷VçC¢À¢G&öæU÷vW#¢ã3RÀ¢G&öæU7VVC¢À¢G&öæTÆ–fWF–ÖS¢ãCRÀ¢G&öæT&öÖ$6†æ6S¢À¢7&Wt&V6öåVæÆö6¶VC¢fÇ6RÀ¢7&Wt&V6öä÷fW&¶–ÆÄ6''“¢À¢ÖvæWF–4f–VÆDVæ&ÆVC¢fÇ6RÀ¢ÖvæWF–4f–VÆDGW&F–öã¢À¢ÖvæWF–4f–VÆE&F—W5F–ÆW3¢À¢ÖvæWF–4f–VÆEF&vWF–æt&öçW3¢À¢FVÖöÆ—F–öä6öÖ&ôVæ&ÆVC¢fÇ6RÀ¢FVÖöÆ—F–öä6öÖ&ôÖ&´GW&F–öã¢À¢FVÖöÆ—F–öä6öÖ&ôf–æ—6…÷vW#¢À¢FVÖöÆ—F–öä6öÖ&õfV–å&F—W5F–ÆW3¢À ¢òòFööÂ&öw&W76–öâà¢FööÃ¢'–6¶†R"À¢FööÅF–W#¢À¢7WW%–6µVæÆö6¶VC¢fÇ6RÀ¢Æ6W%VæÆö6¶VC¢fÇ6RÀ¢Æ6W%&ævS¢#À¢Æ6W%÷vW#¢À¢Æ6W%v–GFƒ¢‚À¢Æ6W%–W&6S¢À¢Æ6W$&V×3¢À¢Æ6W$6†&vU&FS¢À¢Æ6W%&–6ö6†WD6÷VçC¢À¢Æ6W$f—'7E&–6ö6†WD×VÇF—Æ–W#¢ãcRÀ¢Æ6W%6V6öæE&–6ö6†WD×VÇF—Æ–W#¢ãCRÀ¢Æ6W%7WW%–6´V6†ôWfW'“¢À¢Æ6W%7WW%–6´V6†õ&F—W5F–ÆW3¢À¢Æ6W%7WW%–6´V6†õ÷vW#¢À¢Æ6W%7WW%–6´V6†ôæõ&ö73¢fÇ6RÀ¢7WW$f–VÆDVæ&ÆVC¢fÇ6RÀ¢7WW$f–VÆE&F—W5F–ÆW3¢À¢7WW$f–VÆE÷vW#¢À¢7WW$f–VÆDGW&F–öã¢À¢7WW$f–VÆDÆ6W%W'6—7FVçC¢fÇ6RÀ¢Æ6W$†VDVFvU÷vW#¢À¢Æ6W$†VDGW&F–öã¢À¢Æ6W$†VDæW‡D†—D&öçW3¢À¢6öÆ$G&–ÆÄVæ&ÆVC¢fÇ6RÀ¢6öÆ$G&–ÆÅ&ö4WfW'“¢À¢6öÆ$G&–ÆÄ&VÔGW&F–öã¢À¢6öÆ$G&–ÆÄf–æÄ'W'7E÷vW#¢À ¢òò&Wv&G2æB&ö6VGW&Âf÷'GVæRâ6öç7VÖW'26öÖ&–æRÇV6¶æBW‡Æ–6—@¢òò&ö26†æ6W3²F†—2ÖöGVÆRFöW2æ÷B&öÆÂ&æFöÒfÇVW2—G6VÆbà¢÷&UfÇVT×VÇF—Æ–W#¢À¢ÇV6³¢À¢&&T÷&T6†æ6S¢À¢&&T÷&TFF—F—fT6†æ6S¢À¢vVÕfÇVT×VÇF—Æ–W#¢À¢&–6…fV–ä6†æ6S¢À¢&–6…fV–åv†öÆT6†æ6S¢À¢&–6…fV–å––VÆD&öçW3¢À¢&–6…fV–ä6ö×ÆWF–öä&öçW3¢À¢F÷V&ÆTG&÷6†æ6S¢À¢W‡G&––VÆD6†æ6S¢À¢G&—ÆTG&÷6†æ6S¢À¢G&—ÆU6×ÆTWfW'“¢À¢G&—ÆU6×ÆT&öçW5––VÆC¢À¢G&—ÆU6×ÆTæW‡DæöFTFÖvS¢À¢÷&T6öçfW'6–öä&öçW3¢À¢G'VT÷fW&¶–ÆÄVæ&ÆVC¢fÇ6RÀ¢÷fW&¶–ÆÅ&W6W'fö—%&F–ó¢À¢÷fW&¶–ÆÅ&W6W'fö—%––VÆEF‡&W6†öÆC¢À¢FWF…fÇVT&öçW3¢À¢FWF„6öçG&7E7FW¢À¢FWF„6öçG&7D&öçW5W%7F6³¢À¢FWF„6öçG&7DÖ…7F6·3¢À¢vöÆFVä÷&T6†æ6S¢À¢vöÆFVä÷&TFF—F—fT6†æ6S¢À¢&VÆ–46†æ6S¢À¢&VÆ–4VffV7D6†æ6S¢À¢&VÆ–4VffV7DGW&F–öã¢À¢&VÆ–4VffV7E÷vW#¢À¢f÷'GVæU&ö46†æ6S¢À¢f÷'GVæUv†VVÄVæ&ÆVC¢fÇ6RÀ¢f÷'GVæU—G•F‡&W6†öÆC¢À¢f÷'GVæUv†VVÄ7–6ÆTÆVæwFƒ¢À¢Ö÷F†W&ÆöFT6†æ6S¢À¢Ö÷F†W&ÆöFTwV&çFVVC¢fÇ6RÀ¢Ö÷F†W&ÆöFUG&–vvW$'&V·3¢À¢Ö÷F†W&ÆöFU––VÆD×VÇF—Æ–W#¢À¢Ö÷F†W&ÆöFT6ö×ÆWF–öä66†S¢À¢Ö÷F†W&ÆöFT6ö×ÆWF–öåF–ÖT&öçW3¢À¢÷&TF—fW'6—G”&öçW5W%G—S¢À¢Ó°§Ð ¦6öç7B&ö&&–Æ—G”¶W—2Ò°¢'fV–å&WfVÄ6†æ6R"À¢&×VÇF”†—D6†æ6R"À¢&7&—D6†æ6R"À¢&'&Vµ7Æ6„6†æ6R"À¢&÷fW&¶–ÆÄ6''’"À¢'F–ÖU&VgVæD6†æ6R"À¢'F–ÖU6†&D6†æ6R"À¢&&öÖ$6†æ6R"À¢'7F–6·”&öÖ$6†æ6R"À¢'föÆF–ÆT&öÖ$6†æ6R"À¢&6†–ä6†æ6R"À¢&G&öæT&öÖ$6†æ6R"À¢&ÇV6²"À¢'&&T÷&T6†æ6R"À¢'&&T÷&TFF—F—fT6†æ6R"À¢'&–6…fV–ä6†æ6R"À¢'&–6…fV–åv†öÆT6†æ6R"À¢&F÷V&ÆTG&÷6†æ6R"À¢&W‡G&––VÆD6†æ6R"À¢'G&—ÆTG&÷6†æ6R"À¢&vöÆFVä÷&T6†æ6R"À¢&vöÆFVä÷&TFF—F—fT6†æ6R"À¢'&VÆ–46†æ6R"À¢'&VÆ–4VffV7D6†æ6R"À¢&f÷'GVæU&ö46†æ6R"À¢&Ö÷F†W&ÆöFT6†æ6R"À¢&fö7W6VD÷&T†&FæW75&VGV7F–öâ"À¥Ó° ¦gVæ7F–öâæ÷&ÖÆ—¦TÖWF7FG2‡7FG2’°¢7FG2ç6Vç6U&F—W2ÒÖF‚æÖ‚ƒÂ7FG2ç6Vç6U&F—W2¢7FG2ç6Vç6U&F—W4×VÇF—Æ–W"“°¢7FG2æV6†õ–æt6ööÆF÷vâÒÖF‚æÖ‚ƒÂ7FG2æV6†õ–æt6ööÆF÷vâ“°¢7FG2æV6†õ–æu&F—W4×VÇF—Æ–W"ÒÖF‚æÖ‚ƒÂ7FG2æV6†õ–æu&F—W4×VÇF—Æ–W"“°¢7FG2æV6†õ–æuF&vWD†öÆBÒÖF‚æÖ‚ƒÂ7FG2æV6†õ–æuF&vWD†öÆB“°¢7FG2çfV–åG&–Å&ævT×VÇF—Æ–W"ÒÖF‚æÖ‚ƒÂ7FG2çfV–åG&–Å&ævT×VÇF—Æ–W"“°¢7FG2çfV–åG&–ÄÖ÷fU7VVD&öçW2ÒÖF‚æÖ‚ƒÂ7FG2çfV–åG&–ÄÖ÷fU7VVD&öçW2“°¢7FG2çfV–äÆö6µ&ævT×VÇF—Æ–W"ÒÖF‚æÖ‚ƒÂ7FG2çfV–äÆö6µ&ævT×VÇF—Æ–W"“°¢7FG2çfV–äÆö6´Ö÷fU7VVD&öçW2ÒÖF‚æÖ‚ƒÂ7FG2çfV–äÆö6´Ö÷fU7VVD&öçW2“°¢7FG2ç6V—6Ö–5&÷WFU6Æ÷G2ÒÖF‚æÖ‚ƒÂÖF‚æfÆö÷"‡7FG2ç6V—6Ö–5&÷WFU6Æ÷G2’“°¢7FG2æv†÷7EG&–ÄGW&F–öâÒÖF‚æÖ‚ƒÂ7FG2æv†÷7EG&–ÄGW&F–öâ“°¢7FG2æv†÷7EG&–ÄÖ„Æ–W'2ÒÖF‚æÖ‚ƒÂÖF‚æfÆö÷"‡7FG2æv†÷7EG&–ÄÖ„Æ–W'2’“°¢7FG2æfö7W5fV–å6—¦T&–2ÒÖF‚æÖ‚ƒÂ7FG2æfö7W5fV–å6—¦T&–2“°¢7FG2æfö7W5fV–äÖ÷fU7VVEW$æöFRÒÖF‚æÖ‚ƒÂ7FG2æfö7W5fV–äÖ÷fU7VVEW$æöFR“°¢7FG2æÖ÷fU7VVBÒÖF‚æÖ‚ƒÂ7FG2æÖ÷fU7VVB¢7FG2æÖ÷fU7VVD×VÇF—Æ–W"“°¢7FG2æÖ–æTÖ÷fT×VÇF—Æ–W"ÒÖF‚æÖ‚ƒãÂ7FG2æÖ–æTÖ÷fT×VÇF—Æ–W"“°¢6öç7B&tF–u&V6‚ÒÖF‚æÖ‚ƒÂ7FG2æF–u&V6‚¢7FG2æF–u&V6„×VÇF—Æ–W"“°¢6öç7BFööÅF–W"Ò6Æ×„ÖF‚æfÆö÷"„çVÖ&W"‡7FG2çFööÅF–W"’ÇÂ’ÂÂr“°¢6öç7B&V6„&æG2Ò°¢çVÆÂÀ¢²Ö–ã¢3‚ÂÖƒ¢cBÒÀ¢²Ö–ã¢3‚ÂÖƒ¢c‚ÒÀ¢²Ö–ã¢3‚ÂÖƒ¢sbÒÀ¢²Ö–ã¢SbÂÖƒ¢ƒ‚ÒÀ¢²Ö–ã¢s"ÂÖƒ¢"ÒÀ¢²Ö–ã¢s"ÂÖƒ¢"ÒÀ¢²Ö–ã¢s"ÂÖƒ¢"ÒÀ¢Ó°¢6öç7B&V6„&æBÒ&V6„&æG5·FööÅF–W%Ó°¢7FG2çFööÅF–W"ÒFööÅF–W#°¢7FG2ç–6µ&V6„6Ò&V6„&æBæÖƒ°¢7FG2æF–u&V6‚Ò6Æ×‡&tF–u&V6‚Â&V6„&æBæÖ–âÂ&V6„&æBæÖ‚“°¢7FG2æF–u&F—W2ÒÖF‚æÖ‚ƒÂ7FG2æF–u&F—W2“°¢7FG2æF–t&2Ò6Æ×‡7FG2æF–t&2ÂÖF‚å’ò‚ÂÖF‚å’¢"“°¢7FG2æF–u7VVBÒÖF‚æÖ‚ƒãÂ7FG2æF–u7VVB¢7FG2æF–u7VVD×VÇF—Æ–W"“°¢7FG2ç6–FT6†—WfW'’ÒÖF‚æÖ‚ƒÂÖF‚æfÆö÷"‡7FG2ç6–FT6†—WfW'’’“°¢7FG2ç6–FT6†—F&vWG2ÒÖF‚æÖ‚ƒÂÖF‚æfÆö÷"‡7FG2ç6–FT6†—F&vWG2’“°¢7FG2ç6–FT6†—÷vW"Ò6Æ×‡7FG2ç6–FT6†—÷vW"ÂÂ“°¢7FG2æ&ö6…7G&–¶UG&fVÅF–ÖRÒÖF‚æÖ‚ƒÂ7FG2æ&ö6…7G&–¶UG&fVÅF–ÖR“°¢7FG2æ&ö6…7G&–¶U÷vW"ÒÖF‚æÖ‚ƒÂ7FG2æ&ö6…7G&–¶U÷vW"“°¢7FG2æ&ö6…7G&–¶U6–FT6†—÷vW"Ò6Æ×‡7FG2æ&ö6…7G&–¶U6–FT6†—÷vW"ÂÂ“°¢7FG2æ–×7EvfTWfW'’ÒÖF‚æÖ‚ƒÂÖF‚æfÆö÷"‡7FG2æ–×7EvfTWfW'’’“°¢7FG2æ–×7EvfU&F—W5F–ÆW2ÒÖF‚æÖ‚ƒÂ7FG2æ–×7EvfU&F—W5F–ÆW2“°¢7FG2æ–×7EvfU÷vW"Ò6Æ×‡7FG2æ–×7EvfU÷vW"ÂÂ“°¢7FG2çV''”ÖöFU&WV—&VD'&V·2ÒÖF‚æÖ‚ƒÂÖF‚æfÆö÷"‡7FG2çV''”ÖöFU&WV—&VD'&V·2’“°¢7FG2çV''”ÖöFUv–æF÷rÒÖF‚æÖ‚ƒÂ7FG2çV''”ÖöFUv–æF÷r“°¢7FG2çV''”ÖöFTGW&F–öâÒÖF‚æÖ‚ƒÂ7FG2çV''”ÖöFTGW&F–öâ“°¢7FG2çV''”ÖöFTÖ÷fU7VVD&öçW2ÒÖF‚æÖ‚ƒÂ7FG2çV''”ÖöFTÖ÷fU7VVD&öçW2“°¢7FG2çV''”ÖöFTF–u7VVD&öçW2ÒÖF‚æÖ‚ƒÂ7FG2çV''”ÖöFTF–u7VVD&öçW2“°¢7FG2çV''”ÖöFU6–FTg&7GW&U÷vW"Ò6Æ×‡7FG2çV''”ÖöFU6–FTg&7GW&U÷vW"ÂÂ“°¢7FG2ç–6µ÷vW"ÒÖF‚æÖ‚ƒãÂ7FG2ç–6µ÷vW"¢7FG2ç–6µ÷vW$×VÇF—Æ–W"“°¢7FG2æfVÇDÆ–æTÖ„&Æö6·2ÒÖF‚æÖ‚ƒÂÖF‚æfÆö÷"‡7FG2æfVÇDÆ–æTÖ„&Æö6·2’“°¢7FG2æfVÇDÆ–æU÷vW"Ò6Æ×‡7FG2æfVÇDÆ–æU÷vW"ÂÂ“°¢7FG2æÖ…'VäGW&F–öâÒ6Æ×‡7FG2æÖ…'VäGW&F–öâÂbÂCR“°¢7FG2ç'VäGW&F–öâÒ6Æ×‡7FG2ç'VäGW&F–öâÂbÂ7FG2æÖ…'VäGW&F–öâ“°¢7FG2æ&öçW5'VäGW&F–öä6Ò6Æ×‡7FG2æ&öçW5'VäGW&F–öä6Â7FG2æÖ…'VäGW&F–öâÂc“°¢7FG2æF—66÷fW'•F–ÖT&öçW2ÒÖF‚æÖ‚ƒÂ7FG2æF—66÷fW'•F–ÖT&öçW2“°¢7FG2æ6‡&öæô÷fW&fÆ÷uF‡&W6†öÆBÒ6Æ×‡7FG2æ6‡&öæô÷fW&fÆ÷uF‡&W6†öÆBÂCRÂc“°¢7FG2æ6‡&öæô÷fW&fÆ÷u7VVD&öçW2ÒÖF‚æÖ‚ƒÂ7FG2æ6‡&öæô÷fW&fÆ÷u7VVD&öçW2“°¢7FG2æ6‡&öæô÷fW&fÆ÷u&WVDWfW'’ÒÖF‚æÖ‚ƒÂÖF‚æfÆö÷"‡7FG2æ6‡&öæô÷fW&fÆ÷u&WVDWfW'’’“°¢7FG2çF–ÖW$G&–å&VGV7F–öâÒ6Æ×‡7FG2çF–ÖW$G&–å&VGV7F–öâÂÂãR“°¢7FG2çF–ÖW$G&–ä×VÇF—Æ–W"ÒÒ7FG2çF–ÖW$G&–å&VGV7F–öã°¢7FG2çF–ÖU&VgVæDÖ÷VçB£Ò7FG2çF–ÖU&VgVæD×VÇF—Æ–W#°¢7FG2æ&öÖ%÷vW"ÒÖF‚æÖ‚ƒÂ7FG2æ&öÖ%÷vW"“°¢7FG2æF—&V7F–öæÄ&öÖ$6öæUF–ÆW2ÒÖF‚æÖ‚ƒÂÖF‚æfÆö÷"‡7FG2æF—&V7F–öæÄ&öÖ$6öæUF–ÆW2’“°¢7FG2æ7&Wt&V6öä÷fW&¶–ÆÄ6''’Ò6Æ×‡7FG2æ7&Wt&V6öä÷fW&¶–ÆÄ6''’ÂÂ“°¢7FG2æÖvæWF–4f–VÆDGW&F–öâÒÖF‚æÖ‚ƒÂ7FG2æÖvæWF–4f–VÆDGW&F–öâ“°¢7FG2æÖvæWF–4f–VÆE&F—W5F–ÆW2ÒÖF‚æÖ‚ƒÂ7FG2æÖvæWF–4f–VÆE&F—W5F–ÆW2“°¢7FG2æÖvæWF–4f–VÆEF&vWF–æt&öçW2ÒÖF‚æÖ‚ƒÂ7FG2æÖvæWF–4f–VÆEF&vWF–æt&öçW2“°¢7FG2æFVÖöÆ—F–öä6öÖ&ôÖ&´GW&F–öâÒÖF‚æÖ‚ƒÂ7FG2æFVÖöÆ—F–öä6öÖ&ôÖ&´GW&F–öâ“°¢7FG2æFVÖöÆ—F–öä6öÖ&ôf–æ—6…÷vW"ÒÖF‚æÖ‚ƒÂ7FG2æFVÖöÆ—F–öä6öÖ&ôf–æ—6…÷vW"“°¢7FG2æFVÖöÆ—F–öä6öÖ&õfV–å&F—W5F–ÆW2ÒÖF‚æÖ‚ƒÂ7FG2æFVÖöÆ—F–öä6öÖ&õfV–å&F—W5F–ÆW2“°¢7FG2æ6†–å÷vW"ÒÖF‚æÖ‚ƒÂ7FG2æ6†–å÷vW"“°¢7FG2æG&öæU÷vW"ÒÖF‚æÖ‚ƒÂ7FG2æG&öæU÷vW"“°¢7FG2æÆ6W%&ævRÒ6Æ×‡7FG2æÆ6W%&ævRÂ#ÂC#“°¢7FG2æÆ6W%÷vW"ÒÖF‚æÖ‚ƒÂ7FG2æÆ6W%÷vW"“°¢7FG2æÆ6W%&–6ö6†WD6÷VçBÒ6Æ×„ÖF‚æfÆö÷"‡7FG2æÆ6W%&–6ö6†WD6÷VçB’ÂÂ"“°¢7FG2æÆ6W$f—'7E&–6ö6†WD×VÇF—Æ–W"Ò6Æ×‡7FG2æÆ6W$f—'7E&–6ö6†WD×VÇF—Æ–W"ÂÂ“°¢7FG2æÆ6W%6V6öæE&–6ö6†WD×VÇF—Æ–W"Ò6Æ×‡7FG2æÆ6W%6V6öæE&–6ö6†WD×VÇF—Æ–W"ÂÂ“°¢7FG2æ÷&UfÇVT×VÇF—Æ–W"ÒÖF‚æÖ‚ƒÂ7FG2æ÷&UfÇVT×VÇF—Æ–W"“°¢7FG2ævVÕfÇVT×VÇF—Æ–W"ÒÖF‚æÖ‚ƒÂ7FG2ævVÕfÇVT×VÇF—Æ–W"“°¢7FG2æ&6·WF&vWE6Æ÷G2ÒÖF‚æÖ‚ƒÂÖF‚æfÆö÷"‡7FG2æ&6·WF&vWE6Æ÷G2’“°¢7FG2æ÷&Tfö7W4W66ÆF–öäFVÆ’ÒÖF‚æÖ‚ƒÂ7FG2æ÷&Tfö7W4W66ÆF–öäFVÆ’“°¢7FG2æ÷&Tfö7W4W66ÆF–öä&öçW2ÒÖF‚æÖ‚ƒÂ7FG2æ÷&Tfö7W4W66ÆF–öä&öçW2“°¢7FG2æFVd¶æö6µ7FöæUF‡&W6†öÆBÒÖF‚æÖ‚ƒÂÖF‚æfÆö÷"‡7FG2æFVd¶æö6µ7FöæUF‡&W6†öÆB’“°¢7FG2æFVd¶æö6µ6Vç6U&F—W4×VÇF—Æ–W"ÒÖF‚æÖ‚ƒÂ7FG2æFVd¶æö6µ6Vç6U&F—W4×VÇF—Æ–W"“°¢7FG2æFVd¶æö6´Ö÷fU7VVD&öçW2ÒÖF‚æÖ‚ƒÂ7FG2æFVd¶æö6´Ö÷fU7VVD&öçW2“°¢7FG2æFVd¶æö6´Ö÷fTGW&F–öâÒÖF‚æÖ‚ƒÂ7FG2æFVd¶æö6´Ö÷fTGW&F–öâ“°¢7FG2æFVd¶æö6´6ööÆF÷vâÒÖF‚æÖ‚ƒÂ7FG2æFVd¶æö6´6ööÆF÷vâ“°¢7FG2çG&–æwVÆ$f—„÷&TÖVÖ÷'’ÒÖF‚æÖ‚ƒÂ7FG2çG&–æwVÆ$f—„÷&TÖVÖ÷'’“°¢7FG2çG&–æwVÆ$f—„vFvWDFÖvT&öçW2ÒÖF‚æÖ‚ƒÂ7FG2çG&–æwVÆ$f—„vFvWDFÖvT&öçW2“°¢7FG2çG&–æwVÆ$f—…&ævT&öçW2ÒÖF‚æÖ‚ƒÂ7FG2çG&–æwVÆ$f—…&ævT&öçW2“°¢7FG2æÖ–æTÆ–gE&V6÷&DFWF…&F–òÒ6Æ×‡7FG2æÖ–æTÆ–gE&V6÷&DFWF…&F–òÂÂã’“°¢7FG2æ÷&TF—fW'6—G”&öçW5W%G—RÒÖF‚æÖ‚ƒÂ7FG2æ÷&TF—fW'6—G”&öçW5W%G—R“°¢7FG2æÆ6W%7WW%–6´V6†ôWfW'’ÒÖF‚æÖ‚ƒÂÖF‚æfÆö÷"‡7FG2æÆ6W%7WW%–6´V6†ôWfW'’’“°¢7FG2æÆ6W%7WW%–6´V6†õ&F—W5F–ÆW2ÒÖF‚æÖ‚ƒÂ7FG2æÆ6W%7WW%–6´V6†õ&F—W5F–ÆW2“°¢7FG2æÆ6W%7WW%–6´V6†õ÷vW"Ò6Æ×‡7FG2æÆ6W%7WW%–6´V6†õ÷vW"ÂÂ“°¢7FG2ç7WW$f–VÆE&F—W5F–ÆW2ÒÖF‚æÖ‚ƒÂ7FG2ç7WW$f–VÆE&F—W5F–ÆW2“°¢7FG2ç7WW$f–VÆE÷vW"Ò6Æ×‡7FG2ç7WW$f–VÆE÷vW"ÂÂ“°¢7FG2ç7WW$f–VÆDGW&F–öâÒÖF‚æÖ‚ƒÂ7FG2ç7WW$f–VÆDGW&F–öâ“°¢7FG2æÆ6W$†VDVFvU÷vW"Ò6Æ×‡7FG2æÆ6W$†VDVFvU÷vW"ÂÂ“°¢7FG2æÆ6W$†VDGW&F–öâÒÖF‚æÖ‚ƒÂ7FG2æÆ6W$†VDGW&F–öâ“°¢7FG2æÆ6W$†VDæW‡D†—D&öçW2ÒÖF‚æÖ‚ƒÂ7FG2æÆ6W$†VDæW‡D†—D&öçW2“°¢7FG2ç6öÆ$G&–ÆÅ&ö4WfW'’ÒÖF‚æÖ‚ƒÂÖF‚æfÆö÷"‡7FG2ç6öÆ$G&–ÆÅ&ö4WfW'’’“°¢7FG2ç6öÆ$G&–ÆÄ&VÔGW&F–öâÒÖF‚æÖ‚ƒÂ7FG2ç6öÆ$G&–ÆÄ&VÔGW&F–öâ“°¢7FG2ç6öÆ$G&–ÆÄf–æÄ'W'7E÷vW"ÒÖF‚æÖ‚ƒÂ7FG2ç6öÆ$G&–ÆÄf–æÄ'W'7E÷vW"“°¢7FG2ç&–6…fV–å––VÆD&öçW2ÒÖF‚æÖ‚ƒÂ7FG2ç&–6…fV–å––VÆD&öçW2“°¢7FG2ç&–6…fV–ä6ö×ÆWF–öä&öçW2ÒÖF‚æÖ‚ƒÂÖF‚æfÆö÷"‡7FG2ç&–6…fV–ä6ö×ÆWF–öä&öçW2’“°¢7FG2çG&—ÆU6×ÆTWfW'’ÒÖF‚æÖ‚ƒÂÖF‚æfÆö÷"‡7FG2çG&—ÆU6×ÆTWfW'’’“°¢7FG2çG&—ÆU6×ÆT&öçW5––VÆBÒÖF‚æÖ‚ƒÂÖF‚æfÆö÷"‡7FG2çG&—ÆU6×ÆT&öçW5––VÆB’“°¢7FG2çG&—ÆU6×ÆTæW‡DæöFTFÖvRÒ6Æ×‡7FG2çG&—ÆU6×ÆTæW‡DæöFTFÖvRÂÂ“°¢7FG2æ÷fW&¶–ÆÅ&W6W'fö—%&F–òÒ6Æ×‡7FG2æ÷fW&¶–ÆÅ&W6W'fö—%&F–òÂÂ“°¢7FG2æ÷fW&¶–ÆÅ&W6W'fö—%––VÆEF‡&W6†öÆBÒÖF‚æÖ‚ƒÂ7FG2æ÷fW&¶–ÆÅ&W6W'fö—%––VÆEF‡&W6†öÆB“°¢7FG2æFWF„6öçG&7E7FWÒÖF‚æÖ‚ƒÂ7FG2æFWF„6öçG&7E7FW“°¢7FG2æFWF„6öçG&7D&öçW5W%7F6²ÒÖF‚æÖ‚ƒÂ7FG2æFWF„6öçG&7D&öçW5W%7F6²“°¢7FG2æFWF„6öçG&7DÖ…7F6·2ÒÖF‚æÖ‚ƒÂÖF‚æfÆö÷"‡7FG2æFWF„6öçG&7DÖ…7F6·2’“°¢7FG2ç&VÆ–4VffV7DGW&F–öâÒÖF‚æÖ‚ƒÂ7FG2ç&VÆ–4VffV7DGW&F–öâ“°¢7FG2ç&VÆ–4VffV7E÷vW"ÒÖF‚æÖ‚ƒÂ7FG2ç&VÆ–4VffV7E÷vW"“°¢7FG2æf÷'GVæU—G•F‡&W6†öÆBÒÖF‚æÖ‚ƒÂÖF‚æfÆö÷"‡7FG2æf÷'GVæU—G•F‡&W6†öÆB’“°¢7FG2æf÷'GVæUv†VVÄ7–6ÆTÆVæwF‚ÒÖF‚æÖ‚ƒÂÖF‚æfÆö÷"‡7FG2æf÷'GVæUv†VVÄ7–6ÆTÆVæwF‚’“°¢7FG2æÖ÷F†W&ÆöFUG&–vvW$'&V·2ÒÖF‚æÖ‚ƒÂÖF‚æfÆö÷"‡7FG2æÖ÷F†W&ÆöFUG&–vvW$'&V·2’“°¢7FG2æÖ÷F†W&ÆöFU––VÆD×VÇF—Æ–W"ÒÖF‚æÖ‚ƒÂ7FG2æÖ÷F†W&ÆöFU––VÆD×VÇF—Æ–W"“°¢7FG2æÖ÷F†W&ÆöFT6ö×ÆWF–öä66†RÒÖF‚æÖ‚ƒÂÖF‚æfÆö÷"‡7FG2æÖ÷F†W&ÆöFT6ö×ÆWF–öä66†R’“°¢7FG2æÖ÷F†W&ÆöFT6ö×ÆWF–öåF–ÖT&öçW2ÒÖF‚æÖ‚ƒÂ7FG2æÖ÷F†W&ÆöFT6ö×ÆWF–öåF–ÖT&öçW2“° ¢f÷"†6öç7B¶W’öb&ö&&–Æ—G”¶W—2’°¢7FG5¶¶W•ÒÒ6Æ×‡7FG5¶¶W•ÒÂÂã“R“°¢Ð ¢òò&÷VæF–ærÖ¶W26fR6ö×&—6öç2æBFWFW&Ö–æ—7F–2FW7G27F&ÆRv†–ÆP¢òò&WF–æ–ærf"Ö÷&R&V6—6–öâF†âF†RT’æVVG2à¢f÷"†6öç7B¶¶W’ÂfÇVUÒöbö&¦V7BæVçG&–W2‡7FG2’’°¢–b‡G—VöbfÇVRÓÓÒ&çVÖ&W""bbçVÖ&W"æ—4f–æ—FR‡fÇVR’’7FG5¶¶W•ÒÒ&÷VæB‡fÇVR“°¢Ð¢&WGW&â7FG3°§Ð ¦6öç7B&VDÆWfVÂÒ†ÆWfVÇ2Â–B’Óâ°¢–b†ÆWfVÇ2–ç7Fæ6VöbÖ’&WGW&âÆWfVÇ2ævWB†–B“°¢&WGW&âÆWfVÇ3òå¶–EÓ°§Ó° ¢ò¢ ¢¢6Æ7VÆFRF†R6ö×ÆWFR7FB&Æö6²g&öÒ6fRw2W&6†6VBWw&FRÆWfVÇ2à¢¢–çfÆ–BÂg&7F–öæÂÂæVvF—fRæB&÷fRÖ6ÆWfVÇ2&R6fVÇ’æ÷&ÖÆ—¦VBà¢¢ð¦gVæ7F–öâ6Æ7VÆFTÖWF7FG2†ÆWfVÇ2Ò·Ò’°¢6öç7B7FG2Ò7&VFT&6TÖWF7FG2‚“°¢f÷"†6öç7BFVf–æ—F–öâöbUu$DUôDTe2’°¢6öç7B&tÆWfVÂÒçVÖ&W"‡&VDÆWfVÂ†ÆWfVÇ2ÂFVf–æ—F–öâæ–B’“°¢6öç7BÆWfVÂÒ6Æ×„çVÖ&W"æ—4f–æ—FR‡&tÆWfVÂ’òÖF‚æfÆö÷"‡&tÆWfVÂ’¢ÂÂFVf–æ—F–öâæÖ„ÆWfVÂ“°¢–b†ÆWfVÂâ’FVf–æ—F–öâæÇ’‡7FG2ÂÆWfVÂ¢FVf–æ—F–öâæVffV7DÆWfVÄ×VÇF—Æ–W"“°¢Ð¢&WGW&âæ÷&ÖÆ—¦TÖWF7FG2‡7FG2“°§Ð ¢ò¢ ¢¢&WGW&âF†RæW‡BW&6†6R6÷7BÂ÷"–æf–æ—G’v†VâF†RFVf–æ—F–öâ—2–çfÆ–B÷ ¢¢Ç&VG’B—G2Ö†–×VÒÆWfVÂà¢¢ð¦gVæ7F–öâvWEWw&FT6÷7B†FVf–æ—F–öâÂÆWfVÂÒ’°¢–b‚FVf–æ—F–öâÇÂG—VöbFVf–æ—F–öâæ6÷7BÓÒ&gVæ7F–öâ"’&WGW&â–æf–æ—G“°¢6öç7B7W'&VçDÆWfVÂÒÖF‚æÖ‚ƒÂÖF‚æfÆö÷"„çVÖ&W"†ÆWfVÂ’ÇÂ’“°¢–b†7W'&VçDÆWfVÂãÒFVf–æ—F–öâæÖ„ÆWfVÂ’&WGW&â–æf–æ—G“°¢6öç7B&W7VÇBÒFVf–æ—F–öâæ6÷7B†7W'&VçDÆWfVÂ“°¢&WGW&âçVÖ&W"æ—4f–æ—FR‡&W7VÇB’bb&W7VÇBâòÖF‚ç&÷VæB‡&W7VÇB’¢–æf–æ—G“°§Ð ¢ò¢¢6÷VçBfÆ–BW&6†6VBÆWfVÇ2Â&W7V7F–ærWfW'’æöFRw2Ö†–×VÒâ¢ð¦gVæ7F–öâ6÷VçEW&6†6VDÆWfVÇ2†ÆWfVÇ2Ò·Ò’°¢&WGW&âUu$DUôDTe2ç&VGV6R‚‡F÷FÂÂFVf–æ—F–öâ’Óâ°¢6öç7B&tÆWfVÂÒçVÖ&W"‡&VDÆWfVÂ†ÆWfVÇ2ÂFVf–æ—F–öâæ–B’“°¢6öç7BÆWfVÂÒ6Æ×„çVÖ&W"æ—4f–æ—FR‡&tÆWfVÂ’òÖF‚æfÆö÷"‡&tÆWfVÂ’¢ÂÂFVf–æ—F–öâæÖ„ÆWfVÂ“°¢&WGW&âF÷FÂ²ÆWfVÃ°¢ÒÂ“°§Ð §v–æF÷räFWF…¦W&õWw&FW2Òö&¦V7Bæg&VW¦R‡°¢Uu$DUô4DTtõ$”U2À¢õ$UõE•U2À¢Uu$DUôDTe2À¢7&VFT÷&T&rÀ¢6æ—F—¦T÷&T&rÀ¢FD÷&T&rÀ¢6÷VçD÷&T&rÀ¢vWEWw&FU&V6—RÀ¢6äff÷&E&V6—RÀ¢7VæE&V6—RÀ¢7&VFT&6TÖWF7FG2À¢6Æ7VÆFTÖWF7FG2À¢vWEWw&FT6÷7BÀ¢6÷VçEW&6†6VDÆWfVÇ2À§Ò“°§Ò’‚“°