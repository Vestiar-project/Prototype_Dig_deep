(() => {
"use strict";

const WORLD_CONFIG = Object.freeze({
  TILE_SIZE: 28,
  WIDTH: 88,
  HEIGHT: 180,
  METERS_PER_TILE: 5,
  SURFACE_BASE: 9,
  SURFACE_VARIANCE: 4,
  SPAWN_TX: 44,
  BEDROCK_ROWS: 2,
  CAVE_COUNT: 32,
});

const REFERENCE_WORLD_WIDTH = 240;
const REFERENCE_WORLD_HEIGHT = 90;
// Strict T5+ depth gates trim a few edge cells from veins that touch a tier
// boundary. Scale the authored budget by total field area so narrowing the
// shaft changes its silhouette, not the density or size of individual veins.
const DEPTH_GATED_VEIN_COMPENSATION = 1.05;
const WORLD_DENSITY_SCALE = (
  WORLD_CONFIG.WIDTH * WORLD_CONFIG.HEIGHT
  / (REFERENCE_WORLD_WIDTH * REFERENCE_WORLD_HEIGHT)
) * DEPTH_GATED_VEIN_COMPENSATION;
const FRONTIER_RESERVE_ORE_IDS = new Set(["amber", "gold"]);
const FRONTIER_RESERVE_HALF_WIDTH = 10;
const FRONTIER_RESERVE_DEPTH_ROWS = 12;

const DEFAULT_SEED = "deep-shift";
const UINT32_RANGE = 0x100000000;
const BEDROCK_HP = 1_000_000_000;
const DEFAULT_SECTOR_ID = "stable_strata";
const RANDOM_SECTOR_ID = "random_strata";

/**
 * Legacy named profiles remain available to deterministic diagnostics. Normal
 * shifts use a seed-derived hidden profile and never ask the player to choose.
 */
const GEOLOGICAL_SECTORS = Object.freeze([
  Object.freeze({
    id: DEFAULT_SECTOR_ID,
    label: "Ð¡Ñ‚Ð°Ð±Ð¸Ð»ÑŒÐ½Ñ‹Ðµ Ð¿Ð»Ð°ÑÑ‚Ñ‹",
    icon: "â—†",
    color: "#d6a15d",
    description: "ÐŸÑ€ÐµÐ´ÑÐºÐ°Ð·ÑƒÐµÐ¼Ñ‹Ð¹ ÑƒÑ‡Ð°ÑÑ‚Ð¾Ðº Ð±ÐµÐ· Ñ€ÐµÐ·ÐºÐ¸Ñ… Ð¿ÐµÑ€ÐµÐºÐ¾ÑÐ¾Ð² â€” Ð½Ð°Ð´Ñ‘Ð¶Ð½Ñ‹Ð¹ Ð²Ñ‹Ð±Ð¾Ñ€ Ð´Ð»Ñ Ð¾Ð±Ñ‹Ñ‡Ð½Ð¾Ð¹ ÑÐ¼ÐµÐ½Ñ‹.",
    forecast: Object.freeze([
      "ÐŸÐµÑ‰ÐµÑ€Ñ‹: ÑƒÐ¼ÐµÑ€ÐµÐ½Ð½Ð¾",
      "Ð¢Ð²Ñ‘Ñ€Ð´Ð¾ÑÑ‚ÑŒ: Ð¾Ð±Ñ‹Ñ‡Ð½Ð°Ñ",
      "Ð–Ð¸Ð»Ñ‹: ÑÑ€ÐµÐ´Ð½ÐµÐ³Ð¾ Ñ€Ð°Ð·Ð¼ÐµÑ€Ð°",
      "Ð˜Ð·Ð¾Ð±Ð¸Ð»Ð¸Ðµ: Ð¾Ð±Ñ‹Ñ‡Ð½Ð¾Ðµ",
    ]),
    ratings: Object.freeze({
      caves: "ÑƒÐ¼ÐµÑ€ÐµÐ½Ð½Ð¾",
      hardness: "Ð¾Ð±Ñ‹Ñ‡Ð½Ð°Ñ",
      veins: "ÑÑ€ÐµÐ´Ð½Ð¸Ðµ",
      abundance: "Ð¾Ð±Ñ‹Ñ‡Ð½Ð¾Ðµ",
    }),
    modifiers: Object.freeze({ caves: 1, hardness: 1, veins: 1, abundance: 1 }),
  }),
  Object.freeze({
    id: "cavern_karst",
    label: "ÐŸÐµÑ‰ÐµÑ€Ð½Ñ‹Ð¹ ÐºÐ°Ñ€ÑÑ‚",
    icon: "â—Œ",
    color: "#67d5c4",
    description: "Ð˜Ð·Ñ€ÐµÐ·Ð°Ð½Ð½Ñ‹Ð¹ Ð¿ÑƒÑÑ‚Ð¾Ñ‚Ð°Ð¼Ð¸ Ð¿Ð»Ð°ÑÑ‚: Ð´Ð²Ð¸Ð³Ð°Ñ‚ÑŒÑÑ Ð»ÐµÐ³Ñ‡Ðµ, Ð½Ð¾ Ñ€ÑƒÐ´Ð½Ñ‹Ñ… Ð½Ð°Ñ…Ð¾Ð´Ð¾Ðº Ð½ÐµÐ¼Ð½Ð¾Ð³Ð¾ Ð¼ÐµÐ½ÑŒÑˆÐµ.",
    forecast: Object.freeze([
      "ÐŸÐµÑ‰ÐµÑ€Ñ‹: Ð¾Ñ‡ÐµÐ½ÑŒ Ð¼Ð½Ð¾Ð³Ð¾",
      "Ð¢Ð²Ñ‘Ñ€Ð´Ð¾ÑÑ‚ÑŒ: Ð¾Ð±Ñ‹Ñ‡Ð½Ð°Ñ",
      "Ð–Ð¸Ð»Ñ‹: ÑÑ€ÐµÐ´Ð½ÐµÐ³Ð¾ Ñ€Ð°Ð·Ð¼ÐµÑ€Ð°",
      "Ð˜Ð·Ð¾Ð±Ð¸Ð»Ð¸Ðµ: Ð½Ð¸Ð¶Ðµ Ð½Ð° 10%",
    ]),
    ratings: Object.freeze({
      caves: "Ð¾Ñ‡ÐµÐ½ÑŒ Ð¼Ð½Ð¾Ð³Ð¾",
      hardness: "Ð¾Ð±Ñ‹Ñ‡Ð½Ð°Ñ",
      veins: "ÑÑ€ÐµÐ´Ð½Ð¸Ðµ",
      abundance: "Ð½Ð¸Ð¶Ðµ ÑÑ€ÐµÐ´Ð½ÐµÐ³Ð¾",
    }),
    modifiers: Object.freeze({ caves: 1.48, hardness: 1, veins: 1, abundance: 0.9 }),
  }),
  Object.freeze({
    id: "ore_ridge",
    label: "Ð ÑƒÐ´Ð½Ð°Ñ Ð³Ñ€ÑÐ´Ð°",
    icon: "â¬¢",
    color: "#f1c84b",
    description: "ÐŸÐµÑ‰ÐµÑ€ Ð¼ÐµÐ½ÑŒÑˆÐµ, Ð·Ð°Ñ‚Ð¾ Ð¿Ñ€Ð¸ Ð¾Ð±Ñ‹Ñ‡Ð½Ð¾Ð¹ Ð¿Ñ€Ð¾Ñ‡Ð½Ð¾ÑÑ‚Ð¸ Ð¿Ð¾Ñ€Ð¾Ð´Ñ‹ Ð²ÑÑ‚Ñ€ÐµÑ‡Ð°ÐµÑ‚ÑÑ Ð±Ð¾Ð»ÑŒÑˆÐµ Ñ€ÑƒÐ´Ð½Ñ‹Ñ… Ð½Ð°Ñ…Ð¾Ð´Ð¾Ðº.",
    forecast: Object.freeze([
      "ÐŸÐµÑ‰ÐµÑ€Ñ‹: Ð¼Ð°Ð»Ð¾",
      "Ð¢Ð²Ñ‘Ñ€Ð´Ð¾ÑÑ‚ÑŒ: Ð¾Ð±Ñ‹Ñ‡Ð½Ð°Ñ",
      "Ð–Ð¸Ð»Ñ‹: ÑÑ€ÐµÐ´Ð½ÐµÐ³Ð¾ Ñ€Ð°Ð·Ð¼ÐµÑ€Ð°",
      "Ð˜Ð·Ð¾Ð±Ð¸Ð»Ð¸Ðµ: Ð²Ñ‹ÑˆÐµ Ð½Ð° 30%",
    ]),
    ratings: Object.freeze({
      caves: "Ð¼Ð°Ð»Ð¾",
      hardness: "Ð¾Ð±Ñ‹Ñ‡Ð½Ð°Ñ",
      veins: "ÑÑ€ÐµÐ´Ð½Ð¸Ðµ",
      abundance: "Ð²Ñ‹ÑÐ¾ÐºÐ¾Ðµ",
    }),
    modifiers: Object.freeze({ caves: 0.76, hardness: 1, veins: 1, abundance: 1.3 }),
  }),
]);

const UNDERGROUND_EVENT_TYPES = Object.freeze([
  Object.freeze({
    id: "fragile_cavity",
    effect: "soft_rock",
    durationSeconds: 5,
    effectDescription: "ÐšÐ¾Ñ€Ð¾Ñ‚ÐºÐ¸Ð¹ Ñ€ÐµÐ·Ð¾Ð½Ð°Ð½Ñ Ð½Ð° Ð½ÐµÑÐºÐ¾Ð»ÑŒÐºÐ¾ ÑÐµÐºÑƒÐ½Ð´ ÑÐ¼ÑÐ³Ñ‡Ð°ÐµÑ‚ Ð¾Ð±Ñ‹Ñ‡Ð½ÑƒÑŽ Ð¿Ð¾Ñ€Ð¾Ð´Ñƒ Ð¿Ð¾ Ð²ÑÐµÐ¹ ÑˆÐ°Ñ…Ñ‚Ðµ.",
    label: "Ð¥Ð Ð£ÐŸÐšÐÐ¯ ÐŸÐžÐ›ÐžÐ¡Ð¢Ð¬",
    icon: "âœ¹",
    color: "#ffb45b",
    radiusTiles: 1.6,
    description: "ÐŸÐ¾ Ð¿Ð¾Ñ€Ð¾Ð´Ðµ Ð±ÐµÐ³ÑƒÑ‚ ÑÑ€ÐºÐ¸Ðµ Ñ‚Ñ€ÐµÑ‰Ð¸Ð½Ñ‹: Ð¿Ð¾ÑÐ»Ðµ Ð°ÐºÑ‚Ð¸Ð²Ð°Ñ†Ð¸Ð¸ Ð²ÑÑ Ð¾Ð±Ñ‹Ñ‡Ð½Ð°Ñ Ð¿Ð¾Ñ€Ð¾Ð´Ð° Ð½Ð° Ð¿ÑÑ‚ÑŒ ÑÐµÐºÑƒÐ½Ð´ ÑÑ‚Ð°Ð½ÐµÑ‚ Ð¼ÑÐ³Ñ‡Ðµ.",
  }),
  Object.freeze({
    id: "gas_pocket",
    effect: "dig_speed",
    durationSeconds: 5,
    effectDescription: "Ð’ÑÐ¿Ñ‹ÑˆÐºÐ° Ð·Ð°Ñ€ÑÐ¶Ð°ÐµÑ‚ Ð¸Ð½ÑÑ‚Ñ€ÑƒÐ¼ÐµÐ½Ñ‚ Ð¸ Ð½ÐµÐ½Ð°Ð´Ð¾Ð»Ð³Ð¾ ÑƒÑÐºÐ¾Ñ€ÑÐµÑ‚ ÑƒÐ´Ð°Ñ€Ñ‹ Ð¿Ð¾ Ð²ÑÐµÐ¹ ÑˆÐ°Ñ…Ñ‚Ðµ.",
    label: "Ð“ÐÐ—ÐžÐ’Ð«Ð™ ÐšÐÐ ÐœÐÐ",
    icon: "â˜",
    color: "#a8f06a",
    radiusTiles: 1.6,
    description: "Ð¡Ð²ÐµÑ‚ÑÑ‰ÐµÐµÑÑ Ð¾Ð±Ð»Ð°ÐºÐ¾ Ð·Ð°Ð¼ÐµÑ‚Ð½Ð¾ Ð¿ÑƒÐ»ÑŒÑÐ¸Ñ€ÑƒÐµÑ‚: Ð¿Ð¾ÑÐ»Ðµ Ð°ÐºÑ‚Ð¸Ð²Ð°Ñ†Ð¸Ð¸ Ð¸Ð½ÑÑ‚Ñ€ÑƒÐ¼ÐµÐ½Ñ‚ Ð½Ð° Ð¿ÑÑ‚ÑŒ ÑÐµÐºÑƒÐ½Ð´ ÑƒÑÐºÐ¾Ñ€Ð¸Ñ‚ÑÑ Ð¿Ð¾ Ð²ÑÐµÐ¹ ÑˆÐ°Ñ…Ñ‚Ðµ.",
  }),
  Object.freeze({
    id: "rich_lens",
    effect: "ore_yield",
    durationSeconds: 5,
    effectDescription: "Ð ÑƒÐ´Ð½Ñ‹Ð¹ Ð¸Ð¼Ð¿ÑƒÐ»ÑŒÑ Ð½Ð° Ð½ÐµÑÐºÐ¾Ð»ÑŒÐºÐ¾ ÑÐµÐºÑƒÐ½Ð´ ÑƒÐ²ÐµÐ»Ð¸Ñ‡Ð¸Ð²Ð°ÐµÑ‚ Ð²Ñ‹Ñ…Ð¾Ð´ Ð»ÑŽÐ±Ð¾Ð¹ ÑÐ¾Ð±Ñ€Ð°Ð½Ð½Ð¾Ð¹ Ñ€ÑƒÐ´Ñ‹.",
    label: "Ð‘ÐžÐ“ÐÐ¢ÐÐ¯ Ð›Ð˜ÐÐ—Ð",
    icon: "âœ¦",
    color: "#ffe36e",
    radiusTiles: 1.5,
    description: "Ð ÑƒÐ´Ð° Ð² ÐºÐ¾Ð½Ñ‚ÑƒÑ€Ðµ Ð¿ÐµÑ€ÐµÐ»Ð¸Ð²Ð°ÐµÑ‚ÑÑ Ð·Ð¾Ð»Ð¾Ñ‚Ñ‹Ð¼Ð¸ Ð²ÑÐ¿Ð¾Ð»Ð¾Ñ…Ð°Ð¼Ð¸: Ð½Ð° Ð¿ÑÑ‚ÑŒ ÑÐµÐºÑƒÐ½Ð´ Ð²Ñ‹Ñ…Ð¾Ð´ Ð»ÑŽÐ±Ð¾Ð¹ Ñ€ÑƒÐ´Ñ‹ ÑÑ‚Ð°Ð½ÐµÑ‚ Ð²Ñ‹ÑˆÐµ.",
  }),
  Object.freeze({
    id: "ancient_container",
    effect: "chest",
    durationSeconds: 0,
    effectDescription: "Ð¡ÑƒÐ½Ð´ÑƒÐº Ñ Ð½ÐµÑÐºÐ¾Ð»ÑŒÐºÐ¸Ð¼Ð¸ Ð²Ð¸Ð´Ð°Ð¼Ð¸ Ñ€ÑƒÐ´Ñ‹: ÐµÐ³Ð¾ ÑÐ¾Ð´ÐµÑ€Ð¶Ð¸Ð¼Ð¾Ðµ Ð·Ð°Ð²Ð¸ÑÐ¸Ñ‚ Ð¾Ñ‚ Ð³Ð»ÑƒÐ±Ð¸Ð½Ñ‹ Ð½Ð°Ñ…Ð¾Ð´ÐºÐ¸.",
    label: "Ð”Ð Ð•Ð’ÐÐ˜Ð™ ÐšÐžÐÐ¢Ð•Ð™ÐÐ•Ð ",
    icon: "â–£",
    color: "#ff7a68",
    radiusTiles: 1.1,
    description: "Ð˜Ð·-Ð¿Ð¾Ð´ Ð·ÐµÐ¼Ð»Ð¸ Ð¿Ñ€Ð¾Ð±Ð¸Ð²Ð°ÐµÑ‚ÑÑ ÐºÑ€Ð°ÑÐ½Ñ‹Ð¹ Ð¼Ð°ÑÐº: Ð²Ð½ÑƒÑ‚Ñ€Ð¸ Ð»ÐµÐ¶Ð°Ñ‚ Ð½ÐµÑÐºÐ¾Ð»ÑŒÐºÐ¾ ÑÐ»ÑƒÑ‡Ð°Ð¹Ð½Ñ‹Ñ… Ñ€ÑƒÐ´ ÑÑ‚Ð°Ñ€Ð¾Ð¹ Ð°Ñ€Ñ‚ÐµÐ»Ð¸.",
  }),
  Object.freeze({
    id: "underground_flow",
    effect: "move_speed",
    durationSeconds: 5,
    effectDescription: "ÐŸÐ¾Ð´Ð·ÐµÐ¼Ð½Ñ‹Ð¹ Ð¿Ð¾Ñ‚Ð¾Ðº Ð½ÐµÐ½Ð°Ð´Ð¾Ð»Ð³Ð¾ ÑƒÑÐºÐ¾Ñ€ÑÐµÑ‚ Ð´Ð²Ð¸Ð¶ÐµÐ½Ð¸Ðµ ÑˆÐ°Ñ…Ñ‚Ñ‘Ñ€Ð° Ð² Ð»ÑŽÐ±Ð¾Ð¹ Ñ‡Ð°ÑÑ‚Ð¸ Ð¿Ð¾Ð»Ñ.",
    label: "ÐŸÐžÐ”Ð—Ð•ÐœÐÐ«Ð™ ÐŸÐžÐ¢ÐžÐš",
    icon: "â‰ˆ",
    color: "#58c9ff",
    radiusTiles: 1.7,
    description: "Ð¯Ñ€ÐºÐ¸Ð¹ Ð¿Ð¾Ñ‚Ð¾Ðº Ñ€Ð°ÑÑÐµÐºÐ°ÐµÑ‚ Ð¿Ð»Ð°ÑÑ‚: Ð¿Ð¾ÑÐ»Ðµ Ð°ÐºÑ‚Ð¸Ð²Ð°Ñ†Ð¸Ð¸ ÑˆÐ°Ñ…Ñ‚Ñ‘Ñ€ Ð½Ð° Ð¿ÑÑ‚ÑŒ ÑÐµÐºÑƒÐ½Ð´ ÑƒÑÐºÐ¾Ñ€Ð¸Ñ‚ÑÑ Ð² Ð»ÑŽÐ±Ð¾Ð¹ Ñ‡Ð°ÑÑ‚Ð¸ Ð¿Ð¾Ð»Ñ.",
  }),
]);

const GLOBAL_EVENT_TYPES = Object.freeze(
  UNDERGROUND_EVENT_TYPES.filter((definition) => definition.effect !== "chest"),
);
const FIELD_EVENT_TYPES = Object.freeze(
  UNDERGROUND_EVENT_TYPES.filter((definition) => definition.effect === "chest"),
);

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function asFinite(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function hashSeed(seed) {
  const text = String(seed ?? DEFAULT_SEED);
  let hash = 0x811c9dc5;

  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x7feb352d);
  hash ^= hash >>> 15;
  hash = Math.imul(hash, 0x846ca68b);
  hash ^= hash >>> 16;
  return hash >>> 0 || 0x6d2b79f5;
}

class SeededRandom {
  constructor(seed) {
    this.state = hashSeed(seed);
  }

  next() {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let value = this.state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / UINT32_RANGE;
  }

  range(min, max) {
    return min + (max - min) * this.next();
  }

  int(min, max) {
    return Math.floor(this.range(min, max + 1));
  }
}

function createTile(kind, maxHp, discovered = false) {
  return {
    kind,
    hp: maxHp,
    maxHp,
    terrainMaxHp: maxHp,
    oreId: null,
    veinId: null,
    discovered,
    cracked: 0,
  };
}

function getOreId(ore, index) {
  return String(ore?.id ?? ore?.key ?? ore?.type ?? `ore-${index + 1}`);
}

function numericField(source, keys, fallback = null) {
  for (const key of keys) {
    const value = Number(source?.[key]);
    if (Number.isFinite(value)) return value;
  }
  return fallback;
}

function normalizeFraction(value, fallback = 0) {
  const fraction = asFinite(value, fallback);
  return clamp(fraction > 1 ? fraction / 100 : fraction, 0, 1);
}

function sectorIdFrom(value, fallback = DEFAULT_SECTOR_ID) {
  const candidate = value && typeof value === "object"
    ? value.sectorId ?? value.sector?.id ?? value.sector ?? value.geologicalSectorId
    : value;
  return typeof candidate === "string" && candidate.trim() ? candidate.trim() : fallback;
}

function resolveSector(value, fallback = DEFAULT_SECTOR_ID) {
  const requestedId = sectorIdFrom(value, fallback);
  return GEOLOGICAL_SECTORS.find((sector) => sector.id === requestedId)
    || GEOLOGICAL_SECTORS.find((sector) => sector.id === fallback)
    || GEOLOGICAL_SECTORS[0];
}

function publicSector(sector) {
  return {
    ...sector,
    forecast: [...(sector.forecast || [])],
    ratings: { ...(sector.ratings || {}) },
    modifiers: { ...(sector.modifiers || {}) },
    oreBias: sector.oreBias ? { ...sector.oreBias } : null,
  };
}

function createRandomGeologyProfile(seed, oreTypes = []) {
  const rng = new SeededRandom(`${seed}:hidden-geology`);
  const traitRoll = rng.next();
  let caves = rng.range(0.88, 1.13);
  let abundance = 1;
  let trait = "mixed";

  if (traitRoll < 0.25) {
    trait = "cavernous";
    caves = rng.range(1.28, 1.5);
  } else if (traitRoll < 0.5) {
    trait = "compact";
    caves = rng.range(0.72, 0.86);
  } else if (traitRoll < 0.75) {
    trait = "ore_rich";
    abundance = rng.range(1.22, 1.38);
  } else {
    trait = "ore_bias";
  }

  const candidates = oreTypes.filter((ore) => ore && ore.id);
  const preferred = candidates.length
    ? candidates[rng.int(0, candidates.length - 1)]
    : null;
  const biasStrength = trait === "ore_bias"
    ? rng.range(2.35, 2.8)
    : rng.range(1.35, 1.7);
  const profileHash = hashSeed(`${seed}:profile`).toString(36);

  return Object.freeze({
    id: `${RANDOM_SECTOR_ID}-${profileHash}`,
    label: "Ð¡Ð»ÑƒÑ‡Ð°Ð¹Ð½Ñ‹Ðµ Ð¿Ð»Ð°ÑÑ‚Ñ‹",
    icon: "â—†",
    color: "#d6a15d",
    description: "Ð¡Ð¾ÑÑ‚Ð°Ð² Ð¸ Ñ„Ð¾Ñ€Ð¼Ð° Ð²Ñ‹Ñ€Ð°Ð±Ð¾Ñ‚ÐºÐ¸ Ð¾Ð¿Ñ€ÐµÐ´ÐµÐ»ÑÑŽÑ‚ÑÑ Ð·Ð°Ð½Ð¾Ð²Ð¾ Ð´Ð»Ñ ÐºÐ°Ð¶Ð´Ð¾Ð¹ ÑÐ¼ÐµÐ½Ñ‹.",
    forecast: Object.freeze([]),
    ratings: Object.freeze({}),
    trait,
    hidden: true,
    oreBias: preferred
      ? Object.freeze({ id: String(preferred.id), strength: biasStrength })
      : null,
    modifiers: Object.freeze({
      caves,
      abundance,
      // A run profile never changes block/ore HP or individual vein density.
      hardness: 1,
      veins: 1,
    }),
  });
}

function getSectorChoices(_seed = DEFAULT_SEED) {
  return GEOLOGICAL_SECTORS.map(publicSector);
}

function normalizeWorldSettings(seedOrOptions, optionsOrSector, fallbackSeed, fallbackSectorId) {
  const settings = seedOrOptions && typeof seedOrOptions === "object"
    ? { ...seedOrOptions }
    : { seed: seedOrOptions };

  if (typeof optionsOrSector === "string") {
    settings.sectorId = optionsOrSector;
  } else if (optionsOrSector && typeof optionsOrSector === "object") {
    Object.assign(settings, optionsOrSector);
  }

  const seed = settings.seed ?? fallbackSeed ?? DEFAULT_SEED;
  const hasExplicitSector = typeof optionsOrSector === "string"
    || settings.sectorId != null
    || settings.sector != null
    || settings.geologicalSectorId != null;
  const sector = hasExplicitSector
    ? resolveSector(settings, fallbackSectorId ?? DEFAULT_SECTOR_ID)
    : null;
  return { seed, sector };
}

function compareRouteNodes(left, right) {
  return left.cost - right.cost
    || left.steps - right.steps
    || left.ty - right.ty
    || left.tx - right.tx
    || left.order - right.order;
}

function pushRouteNode(heap, node) {
  heap.push(node);
  let index = heap.length - 1;

  while (index > 0) {
    const parent = Math.floor((index - 1) / 2);
    if (compareRouteNodes(heap[parent], node) <= 0) break;
    heap[index] = heap[parent];
    index = parent;
  }
  heap[index] = node;
}

function popRouteNode(heap) {
  if (!heap.length) return null;
  const first = heap[0];
  const last = heap.pop();
  if (!heap.length) return first;

  let index = 0;
  while (true) {
    const left = index * 2 + 1;
    const right = left + 1;
    if (left >= heap.length) break;
    let child = left;
    if (right < heap.length && compareRouteNodes(heap[right], heap[left]) < 0) child = right;
    if (compareRouteNodes(last, heap[child]) <= 0) break;
    heap[index] = heap[child];
    index = child;
  }
  heap[index] = last;
  return first;
}

/**
 * Procedurally generated side-view mine. All world-space arguments are pixels.
 * The module deliberately has no browser or DOM dependencies.
 */
class MineWorld {
  constructor(oreTypes = [], seed = DEFAULT_SEED, options = {}) {
    this.oreTypes = Array.isArray(oreTypes) ? [...oreTypes] : [];
    this.seed = DEFAULT_SEED;
    this.sectorId = DEFAULT_SECTOR_ID;
    this._sector = resolveSector(DEFAULT_SECTOR_ID);
    this.sector = publicSector(this._sector);
    this.tiles = [];
    this.surface = [];
    this._oreDefinitions = [];
    this._oreCompositionNormalizer = 1;
    this._oreRankByTile = new Int16Array(0);
    this._spawn = { x: 0, y: 0, tx: 0, ty: 0 };
    this._liftStations = [];
    this._nextVeinId = 1;
    this._oreColumnsByRow = [];
    this._oreIndexReady = false;
    this._undergroundEvents = [];
    this._undergroundEventById = new Map();
    this.reset(seed, options);
  }

  static getSectorChoices() {
    return getSectorChoices();
  }

  getSectorChoices() {
    return MineWorld.getSectorChoices();
  }

  getSector() {
    return publicSector(this._sector || resolveSector(this.sectorId));
  }

  getSectorInfo() {
    return this.getSector();
  }

  getGeologyProfile() {
    return this.getSector();
  }

  reset(seedOrOptions = this.seed, optionsOrSector = {}) {
    const settings = normalizeWorldSettings(
      seedOrOptions,
      optionsOrSector,
      this.seed,
      this.sectorId,
    );
    this.seed = settings.seed;
    const geology = settings.sector || createRandomGeologyProfile(settings.seed, this.oreTypes);
    this.sectorId = geology.id;
    this._sector = geology;
    this.sector = publicSector(geology);
    this._rng = new SeededRandom(this.seed);
    this.surface = this._generateSurface();
    this._spawn = this._makeSpawn();
    this.tiles = this._generateBaseTiles();
    this._oreRankByTile = new Int16Array(WORLD_CONFIG.WIDTH * WORLD_CONFIG.HEIGHT);
    this._oreRankByTile.fill(-1);
    this._oreDefinitions = this._normalizeOreTypes();
    this._oreCompositionNormalizer = this._calculateOreCompositionNormalizer();
    this._nextVeinId = 1;
   ×ß8æÚ$z{-®éÜj×‚æÖ‚ƒãÂ4f–æ—FR‡F†—2å÷6V7F÷#òæÖöF–f–W'3òçfV–ç2Â’“°¢ÆWBF÷FÂÒ°¢f÷"†ÆWB6—¦RÒÖ–ã²6—¦RÃÒÖƒ²6—¦R³Ò’°¢F÷FÂ³ÒÖF‚æÖ‚ƒÂÖF‚ç&÷VæB‡6—¦R¢6V7F÷%fV–ç2’“°¢Ð¢&WGW&âF÷FÂòÖF‚æÖ‚ƒÂÖ‚ÒÖ–â²“°¢Ð ¢ö÷&U&t6ö×÷6—F–öåvV–v‡B†FVf–æ—F–öâ’°¢6öç7B&–2ÒF†—2å÷6V7F÷#òæ÷&T&–3°¢–b‚&–3òæ–B’&WGW&â°¢&WGW&âFVf–æ—F–öâæ–BÓÓÒ&–2æ–BòÖF‚æÖ‚ƒÂ4f–æ—FR†&–2ç7G&VæwF‚Â’’¢°¢Ð ¢ö6Æ7VÆFT÷&T6ö×÷6—F–öäæ÷&ÖÆ—¦W"‚’°¢–b‚F†—2å÷6V7F÷#òæ÷&T&–3òæ–BÇÂF†—2åö÷&TFVf–æ—F–öç2æÆVæwF‚’&WGW&â°¢òòV&Ç’÷&W2f÷&ÒÆ&vW"fV–ç2F†âÆFR÷&W2âæ÷&ÖÆ—¦R'’W‡V7FVBF–ÆP¢òò6÷VçB6ò6ö×÷6—F–öâ&–2&VF—7G&–'WFW2F†R6ÖRæöFR'VFvWB–ç7FV@¢òòöb6–ÆVçFÇ’FF–æræöFW2f÷"6÷W"÷"&VÖ÷f–ærF†VÒf÷"FVW÷&W2à¢ÆWB&6UF÷FÂÒ°¢ÆWBvV–v‡FVEF÷FÂÒ°¢f÷"†6öç7BFVf–æ—F–öâöbF†—2åö÷&TFVf–æ—F–öç2’°¢6öç7B&÷Vç6—G’ÒF†—2åö÷&T&6U&÷Vç6—G’†FVf–æ—F–öâ“°¢6öç7BW‡V7FVDæöFW5W%fV–âÒF†—2åö÷&TW‡V7FVEfV–å6—¦R†FVf–æ—F–öâ“°¢&6UF÷FÂ³Ò&÷Vç6—G’¢W‡V7FVDæöFW5W%fV–ã°¢vV–v‡FVEF÷FÂ³Ò&÷Vç6—G’¢F†—2åö÷&U&t6ö×÷6—F–öåvV–v‡B†FVf–æ—F–öâ’¢W‡V7FVDæöFW5W%fV–ã°¢Ð¢&WGW&âvV–v‡FVEF÷FÂâò&6UF÷FÂòvV–v‡FVEF÷FÂ¢°¢Ð ¢ö÷&T6ö×÷6—F–öä×VÇF—Æ–W"†FVf–æ—F–öâ’°¢&WGW&âF†—2åö÷&U&t6ö×÷6—F–öåvV–v‡B†FVf–æ—F–öâ’¢F†—2åö÷&T6ö×÷6—F–öäæ÷&ÖÆ—¦W#°¢Ð ¢ö÷&UfV–ä6÷VçB†FVf–æ—F–öâ’°¢6öç7BW‡Æ–6—BÒçVÖW&–4f–VÆB†FVf–æ—F–öâç6÷W&6RÂ²'fV–ä6÷VçB"Â'fV–ç2"Â&6ÇW7FW'2%ÒÂçVÆÂ“°¢6öç7B6V7F÷$'VæFæ6RÒÖF‚æÖ‚ƒÂ4f–æ—FR‡F†—2å÷6V7F÷#òæÖöF–f–W'3òæ'VæFæ6RÂ’“°¢6öç7B6ö×÷6—F–öâÒF†—2åö÷&T6ö×÷6—F–öä×VÇF—Æ–W"†FVf–æ—F–öâ“°¢6öç7B&6RÒF†—2åö÷&T&6U&÷Vç6—G’†FVf–æ—F–öâ“°¢–b„çVÖ&W"æ—4f–æ—FR†W‡Æ–6—B’’°¢&WGW&âÖF‚æÖ‚ƒÂÖF‚ç&÷VæB†&6R¢6V7F÷$'VæFæ6R¢6ö×÷6—F–öâ’“°¢Ð¢&WGW&â6Æ×„ÖF‚ç&÷VæB†&6R¢6V7F÷$'VæFæ6R¢6ö×÷6—F–öâ’Â2Â#“°¢Ð ¢ö÷&UfV–å6—¦R†FVf–æ—F–öâ’°¢6öç7B²Ö–âÂÖ‚ÒÒF†—2åö÷&UfV–å6—¦U&ævR†FVf–æ—F–öâ“°¢6öç7B6V7F÷%fV–ç2ÒÖF‚æÖ‚ƒãÂ4f–æ—FR‡F†—2å÷6V7F÷#òæÖöF–f–W'3òçfV–ç2Â’“°¢&WGW&âÖF‚æÖ‚ƒÂÖF‚ç&÷VæB‡F†—2å÷&æræ–çB†Ö–âÂÖ‚’¢6V7F÷%fV–ç2’“°¢Ð ¢ög&öçF–W%&W6W'fT÷&–v–â†FVf–æ—F–öâ’°¢–b‚e$ôåD”U%õ$U4U%dUôõ$Uô”E2æ†2†FVf–æ—F–öãòæ–B’’&WGW&âçVÆÃ°¢6öç7BWF†÷&VDFWF‚ÒçVÖW&–4f–VÆB†FVf–æ—F–öâç6÷W&6RÂ²&Ö–äFWF‚"Â&FWF‚%ÒÂçVÆÂ“°¢–b‚çVÖ&W"æ—4f–æ—FR†WF†÷&VDFWF‚’ÇÂWF†÷&VDFWF‚ÃÒ’&WGW&âçVÆÃ° ¢6öç7BÆVgBÒ6Æ×‡F†—2å÷7vâçG‚Òe$ôåD”U%õ$U4U%dUô„Äeõt”ED‚Â"Âtõ$ÄEô4ôäd”råt”ED‚Ò2“°¢6öç7B&–v‡BÒ6Æ×‡F†—2å÷7vâçG‚²e$ôåD”U%õ$U4U%dUô„Äeõt”ED‚ÂÆVgBÂtõ$ÄEô4ôäd”råt”ED‚Ò2“°¢6öç7BÖ–æ–×VÔFWF…&÷w2ÒÖF‚æ6V–Â†WF†÷&VDFWF‚òtõ$ÄEô4ôäd”råD”ÄUõ4•¤R“°¢6öç7B&÷GFöÒÒtõ$ÄEô4ôäd”rä„T”t…BÒtõ$ÄEô4ôäd”rä$TE$ô4µõ$õu2Ò°¢6öç7B66WG2Ò‡G‚ÂG’’Óâ°¢6öç7BF–ÆRÒF†—2ævWEF–ÆR‡G‚ÂG’“°¢–b‚F–ÆRÇÂF–ÆRæ¶–æBÓÓÒ&—""ÇÂF–ÆRæ¶–æBÓÓÒ&&VG&ö6²"’&WGW&âfÇ6S°¢–b‚F†—2åö6ä÷&TV$B‡G‚ÂG’ÂFVf–æ—F–öâ’’&WGW&âfÇ6S°¢6öç7B&öw&W72ÒF†—2åöF–ff–7VÇG”B‡G‚ÂG’“°¢&WGW&â&öw&W72ãÒFVf–æ—F–öâæÖ–å&öw&W72bb&öw&W72ÃÒFVf–æ—F–öâæÖ…&öw&W73°¢Ó° ¢òò¶VWF†R&W6W'fR&ö6VGW&Â–ç6–FRæ'&÷rFW66VçB6÷'&–F÷"âF†P¢òòFWFW&Ö–æ—7F–266â—2öæÇ’6fR×6fRfÆÆ&6²f÷"VçW7VÆÇ’†öÆÆ÷p¢òò6VVG3²—B7F–ÆÂ6öç7VÖW2F†R6ÖRöæR×fV–â'VFvWB&VÆ÷rà¢f÷"†ÆWBGFV×BÒ²GFV×BÂCƒ²GFV×B³Ò’°¢6öç7BG‚ÒF†—2å÷&æræ–çB†ÆVgBÂ&–v‡B“°¢6öç7BÆö6Å7W&f6RÒF†—2ç7W&f6U·G…Òóòtõ$ÄEô4ôäd”rå5U$d4Uô$4S°¢6öç7BÖ–åG’Ò6Æ×†Æö6Å7W&f6R²Ö–æ–×VÔFWF…&÷w2ÂÆö6Å7W&f6R²Â&÷GFöÒ“°¢6öç7BÖ…G’Ò6Æ×†Ö–åG’²e$ôåD”U%õ$U4U%dUôDUD…õ$õu2ÂÖ–åG’Â&÷GFöÒ“°¢6öç7BG’ÒF†—2å÷&æræ–çB†Ö–åG’ÂÖ…G’“°¢–b†66WG2‡G‚ÂG’’’&WGW&â²G‚ÂG’Ó°¢Ð ¢f÷"†ÆWBG‚ÒÆVgC²G‚ÃÒ&–v‡C²G‚³Ò’°¢6öç7BÆö6Å7W&f6RÒF†—2ç7W&f6U·G…Òóòtõ$ÄEô4ôäd”rå5U$d4Uô$4S°¢6öç7BÖ–åG’Ò6Æ×†Æö6Å7W&f6R²Ö–æ–×VÔFWF…&÷w2ÂÆö6Å7W&f6R²Â&÷GFöÒ“°¢6öç7BÖ…G’Ò6Æ×†Ö–åG’²e$ôåD”U%õ$U4U%dUôDUD…õ$õu2ÂÖ–åG’Â&÷GFöÒ“°¢f÷"†ÆWBG’ÒÖ–åG“²G’ÃÒÖ…G“²G’³Ò’°¢–b†66WG2‡G‚ÂG’’’&WGW&â²G‚ÂG’Ó°¢Ð¢Ð¢&WGW&âçVÆÃ°¢Ð ¢övVæW&FT÷&UfV–ç2‚’°¢f÷"†6öç7BFVf–æ—F–öâöbF†—2åö÷&TFVf–æ—F–öç2’°¢6öç7BF&vWEfV–ç2ÒF†—2åö÷&UfV–ä6÷VçB†FVf–æ—F–öâ“°¢ÆWBÆ6VEfV–ç2Ò°¢ÆWBGFV×G2Ò°¢6öç7BÖ„GFV×G2ÒÖF‚æÖ‚ƒƒÂF&vWEfV–ç2¢3b“° ¢òòöæR÷&F–æ'’Ö&W"övöÆBfV–â—2Æ6VBæV"F†RFWF‚v†W&R—G2F–W ¢òòf—'7BÖGFW'2â—B&WÆ6W2öæR&æFöÒ÷&–v–âg&öÒF†RW†—7F–ær'VFvWC ¢òòfV–â6÷VçBÂ&öÆÆVB6—¦RæB÷&RGW&&–Æ—G’&R÷F†W'v—6RVæ6†ævVBà¢–b‡F&vWEfV–ç2â’°¢6öç7B&W6W'fT÷&–v–âÒF†—2åög&öçF–W%&W6W'fT÷&–v–â†FVf–æ—F–öâ“°¢–b‡&W6W'fT÷&–v–â’°¢6öç7BÆ6VBÒF†—2å÷Æ6UfV–â€¢&W6W'fT÷&–v–âçG‚À¢&W6W'fT÷&–v–âçG’À¢FVf–æ—F–öâÀ¢F†—2åö÷&UfV–å6—¦R†FVf–æ—F–öâ’À¢“°¢–b‡Æ6VBâ’Æ6VEfV–ç2³Ò°¢Ð¢Ð ¢v†–ÆR‡Æ6VEfV–ç2ÂF&vWEfV–ç2bbGFV×G2ÂÖ„GFV×G2’°¢GFV×G2³Ò°¢6öç7BG‚ÒF†—2å÷&æræ–çBƒ"Âtõ$ÄEô4ôäd”råt”ED‚Ò2“°¢6öç7BÖ–å’ÒÖF‚æÖ–â€¢tõ$ÄEô4ôäd”rä„T”t…BÒtõ$ÄEô4ôäd”rä$TE$ô4µõ$õu2Ò"À¢F†—2ç7W&f6U·G…Ò²"À¢“°¢6öç7BG’ÒF†—2å÷&æræ–çB†Ö–å’Âtõ$ÄEô4ôäd”rä„T”t…BÒtõ$ÄEô4ôäd”rä$TE$ô4µõ$õu2Ò“°¢6öç7BF–ÆRÒF†—2ævWEF–ÆR‡G‚ÂG’“°¢–b‚F–ÆRÇÂF–ÆRæ¶–æBÓÓÒ&—""ÇÂF–ÆRæ¶–æBÓÓÒ&&VG&ö6²"’6öçF–çVS°¢–b‚F†—2åö6ä÷&TV$B‡G‚ÂG’ÂFVf–æ—F–öâ’’6öçF–çVS° ¢6öç7B&öw&W72ÒF†—2åöF–ff–7VÇG”B‡G‚ÂG’“°¢–b‡&öw&W72²F†—2å÷&ærç&ævR‚Óã#RÂãCR’ÂFVf–æ—F–öâæÖ–å&öw&W72’6öçF–çVS°¢–b‡&öw&W72ÒF†—2å÷&ærç&ævRƒÂã‚’âFVf–æ—F–öâæÖ…&öw&W72’6öçF–çVS° ¢6öç7BÆ6VBÒF†—2å÷Æ6UfV–â‡G‚ÂG’ÂFVf–æ—F–öâÂF†—2åö÷&UfV–å6—¦R†FVf–æ—F–öâ’“°¢–b‡Æ6VBâ’Æ6VEfV–ç2³Ò°¢Ð¢Ð¢Ð ¢÷Æ6UfV–â†÷&–v–å‚Â÷&–v–å’ÂFVf–æ—F–öâÂ6—¦R’°¢6öç7BfV–ä–BÒG¶FVf–æ—F–öâæ–GÓ¢G·F†—2åöæW‡EfV–ä–B²·Ö°¢6öç7BF&vWE6—¦RÒÖF‚æÖ‚ƒÂÖF‚æfÆö÷"„çVÖ&W"‡6—¦R’ÇÂ’“°¢6öç7BÆ6VD6VÆÇ2ÒæWr6WB‚“°¢6öç7B&æµfÇVRÒÖF‚ç&÷VæB†FVf–æ—F–öâç&æ²¢ó“°¢ÆWBG‚Ò÷&–v–åƒ°¢ÆWBG’Ò÷&–v–å“°¢ÆWBÆ6VBÒ°¢ÆWBGFV×G2Ò°¢6öç7BÖ„GFV×G2ÒÖF‚æÖ‚ƒ#BÂF&vWE6—¦R¢‚“° ¢6öç7BG'•Æ6RÒ†6æF–FFU‚Â6æF–FFU’’Óâ°¢6öç7B¶W’ÒG¶6æF–FFU‡Ó¢G¶6æF–FFU—Ö°¢–b‡Æ6VD6VÆÇ2æ†2†¶W’’’&WGW&âfÇ6S° ¢6öç7BF–ÆRÒF†—2ævWEF–ÆR†6æF–FFU‚Â6æF–FFU’“°¢–b‚F–ÆRÇÂF–ÆRæ¶–æBÓÓÒ&—""ÇÂF–ÆRæ¶–æBÓÓÒ&&VG&ö6²"’&WGW&âfÇ6S°¢–b‚F†—2åö6ä÷&TV$B†6æF–FFU‚Â6æF–FFU’ÂFVf–æ—F–öâ’’&WGW&âfÇ6S° ¢6öç7B–æFW‚ÒF†—2åö–æFW‚†6æF–FFU‚Â6æF–FFU’“°¢6öç7B7W'&VçE&æ²ÒF†—2åö÷&U&æ´'•F–ÆU¶–æFW…Ó°¢–b‡F–ÆRæ÷&T–BÓÒçVÆÂbb7W'&VçE&æ²â&æµfÇVR’&WGW&âfÇ6S°¢–b‚F†—2åöÇ”÷&R†6æF–FFU‚Â6æF–FFU’ÂFVf–æ—F–öâÂfV–ä–B’’&WGW&âfÇ6S° ¢Æ6VD6VÆÇ2æFB†¶W’“°¢Æ6VB³Ò°¢&WGW&âG'VS°¢Ó° ¢v†–ÆR‡Æ6VBÂF&vWE6—¦RbbGFV×G2ÂÖ„GFV×G2’°¢GFV×G2³Ò°¢G'•Æ6R‡G‚ÂG’“° ¢–b‡F†—2å÷&ærææW‡B‚’Âã#‚’°¢G‚³ÒÖF‚ç6–vâ†÷&–v–å‚ÒG‚“°¢G’³ÒÖF‚ç6–vâ†÷&–v–å’ÒG’“°¢ÒVÇ6R–b‡F†—2å÷&ærææW‡B‚’ÂãSb’°¢G‚³ÒF†—2å÷&ærææW‡B‚’ÂãRòÓ¢°¢ÒVÇ6R°¢G’³ÒF†—2å÷&ærææW‡B‚’ÂãRòÓ¢°¢Ð¢G‚Ò6Æ×‡G‚ÂÂtõ$ÄEô4ôäd”råt”ED‚Ò"“°¢G’Ò6Æ×‡G’ÂF†—2ç7W&f6U·G…Ò²Âtõ$ÄEô4ôäd”rä„T”t…BÒtõ$ÄEô4ôäd”rä$TE$ô4µõ$õu2Ò“°¢Ð ¢òò&æFöÒvÆ²6â&WVFVFÇ’&Wf—6—BF†R6ÖR6ö÷&F–æFR÷"vWBG&V@¢òòv–ç7B6fRâf–æ—6‚F†R6ÖÆÂfV–âv—F‚&÷VæFVBÂFWFW&Ö–æ—7F–266à¢òò&÷VæB—G2÷&–v–â6òGWÆ–6FRf—6—G2æWfW"Ö7VW&FR2Æ6VB6VÆÇ2à¢6öç7BÖ„fÆÆ&6µ&F—W2ÒÖF‚æÖ–âƒBÂÖF‚æÖ‚ƒ2ÂÖF‚æ6V–Â„ÖF‚ç7'B‡F&vWE6—¦R’’¢2’“°¢6öç7BÖ„fÆÆ&6´6†V6·2ÒÖF‚æÖ‚ƒƒÂF&vWE6—¦R¢3"“°¢ÆWBfÆÆ&6´6†V6·2Ò° ¢f÷"†ÆWB&F—W2Ò°¢Æ6VBÂF&vWE6—¦Rbb&F—W2ÃÒÖ„fÆÆ&6µ&F—W2bbfÆÆ&6´6†V6·2ÂÖ„fÆÆ&6´6†V6·3°¢&F—W2³Ò’°¢f÷"†ÆWBöfg6WE’Ò×&F—W3°¢Æ6VBÂF&vWE6—¦Rbböfg6WE’ÃÒ&F—W2bbfÆÆ&6´6†V6·2ÂÖ„fÆÆ&6´6†V6·3°¢öfg6WE’³Ò’°¢6öç7Böfg6WE‚Ò&F—W2ÒÖF‚æ'2†öfg6WE’“°¢6öç7B6æF–FFW2Òöfg6WE‚ÓÓÒ ¢òµ¶÷&–v–å‚Â÷&–v–å’²öfg6WE•ÕÐ¢¢°¢¶÷&–v–å‚Òöfg6WE‚Â÷&–v–å’²öfg6WE•ÒÀ¢¶÷&–v–å‚²öfg6WE‚Â÷&–v–å’²öfg6WE•ÒÀ¢Ó° ¢f÷"†6öç7B¶6æF–FFU‚Â6æF–FFU•Òöb6æF–FFW2’°¢–b‡Æ6VBãÒF&vWE6—¦RÇÂfÆÆ&6´6†V6·2ãÒÖ„fÆÆ&6´6†V6·2’'&V³°¢fÆÆ&6´6†V6·2³Ò°¢G'•Æ6R†6æF–FFU‚Â6æF–FFU’“°¢Ð¢Ð¢Ð ¢&WGW&âÆ6VC°¢Ð ¢öÇ”÷&R‡G‚ÂG’ÂFVf–æ—F–öâÂfV–ä–BÒçVÆÂ’°¢6öç7BF–ÆRÒF†—2ævWEF–ÆR‡G‚ÂG’“°¢–b‚F–ÆRÇÂF–ÆRæ¶–æBÓÓÒ&—""ÇÂF–ÆRæ¶–æBÓÓÒ&&VG&ö6²"’&WGW&âfÇ6S° ¢6öç7B6÷W&6RÒFVf–æ—F–öâç6÷W&6S°¢6öç7B&öw&W72ÒF†—2åöF–ff–7VÇG”B‡G‚ÂG’“°¢6öç7B†&FæW72ÒçVÖW&–4f–VÆB‡6÷W&6RÂ²&†&FæW72%ÒÂçVÆÂ“°¢6öç7B'6öÇWFT‡ÒçVÖW&–4f–VÆB‡6÷W&6RÂ²&‡"Â&Ö„‡"Â&†—Eö–çG2%ÒÂçVÆÂ“°¢6öç7BFVç6—G’ÒçVÖW&–4f–VÆB‡6÷W&6RÂ²&÷&TFVç6—G’%ÒÂçVÆÂ“°¢òòfV–ç2Ö’7&÷72âÇv—2FW&—fR÷&RGW&&–Æ—G’g&öÒF†RVæFW&Ç––ær&ö6²À¢òòæWfW"g&öÒ&Wf–÷W6Ç’Æ–VB÷&R×VÇF—Æ–W"Â÷"â÷fW&Æ6â7&VFP¢òòVffV7F—fVÇ’–æFW7G'V7F–&ÆR&Æö6·2v—F‚W‡öæVçF–ÆÇ’6ö×÷VæFVB…à¢6öç7BFW'&–äÖ„‡ÒÖF‚æÖ‚ƒÂçVÖ&W"‡F–ÆRçFW'&–äÖ„‡’ÇÂçVÖ&W"‡F–ÆRæÖ„‡’ÇÂ“°¢ÆWBF&vWD‡° ¢–b„çVÖ&W"æ—4f–æ—FR†'6öÇWFT‡’bb'6öÇWFT‡â’°¢6öç7B6V7F÷$†&FæW72ÒÖF‚æÖ‚ƒãÂ4f–æ—FR‡F†—2å÷6V7F÷#òæÖöF–f–W'3òæ†&FæW72Â’“°¢F&vWD‡ÒÖF‚æÖ‚‡FW'&–äÖ„‡Â'6öÇWFT‡¢ƒ²&öw&W72¢ãB’¢6V7F÷$†&FæW72“°¢ÒVÇ6R°¢6öç7B†&FæW74×VÇF—Æ–W"ÒçVÖ&W"æ—4f–æ—FR††&FæW72’bb†&FæW72â ¢ò†&FæW70¢¢ãR²FVf–æ—F–öâç&æ²¢ãƒS°¢6öç7BFVç6—G”×VÇF—Æ–W"ÒçVÖ&W"æ—4f–æ—FR†FVç6—G’’bbFVç6—G’â ¢ò6Æ×†FVç6—G’ÂãBÂB¢¢°¢F&vWD‡ÒFW'&–äÖ„‡¢†&FæW74×VÇF—Æ–W"¢FVç6—G”×VÇF—Æ–W#°¢Ð ¢6öç7BW†—7F–æufV–ä–BÒF–ÆRæ÷&T–BÓÓÒFVf–æ—F–öâæ–BòF–ÆRçfV–ä–B¢çVÆÃ°¢F–ÆRæ÷&T–BÒFVf–æ—F–öâæ–C°¢F–ÆRçfV–ä–BÒfV–ä–BÇÂW†—7F–æufV–ä–BÇÂG¶FVf–æ—F–öâæ–GÓ§6–ævÆS¢G·G‡Ó¢G·G—Ö°¢F–ÆRæÖ„‡ÒÖF‚æÖ‚ƒÂÖF‚ç&÷VæB‡F&vWD‡’“°¢F–ÆRæ‡ÒF–ÆRæÖ„‡°¢F–ÆRæ7&6¶VBÒ°¢F†—2åö÷&U&æ´'•F–ÆU·F†—2åö–æFW‚‡G‚ÂG’•ÒÒÖF‚ç&÷VæB†FVf–æ—F–öâç&æ²¢ó“°¢F†—2åöFD÷&UFô–æFW‚‡G‚ÂG’“°¢&WGW&âG'VS°¢Ð ¢÷Æ6U7F'FW$÷&R‚’°¢6öç7B&æ¶VDFVf–æ—F–öç2Ò²ââçF†—2åö÷&TFVf–æ—F–öç5Òç6÷'B‚†ÆVgBÂ&–v‡B’ÓâÆVgBç&æ²Ò&–v‡Bç&æ²“°¢6öç7B6÷W"Ò&æ¶VDFVf–æ—F–öç2æf–æB‚†FVf–æ—F–öâ’ÓâFVf–æ—F–öâæ–BÓÓÒ&6÷W""¢ÇÂ&æ¶VDFVf–æ—F–öç5³Ó°¢6öç7B6öÂÒ&æ¶VDFVf–æ—F–öç2æf–æB‚†FVf–æ—F–öâ’ÓâFVf–æ—F–öâæ–BÓÓÒ&6öÂ"¢ÇÂ&æ¶VDFVf–æ—F–öç5³Ð¢ÇÂ6÷W#°¢–b‚6÷W"’&WGW&ã° ¢6öç7BÆ6U6ögD÷&RÒ†öfg6WE’ÂFVf–æ—F–öâÂ‡’Óâ°¢6öç7BG‚ÒF†—2å÷7vâçGƒ°¢6öç7BG’ÒF†—2å÷7vâçG’²öfg6WE“°¢6öç7B7W'&VçBÒF†—2ævWEF–ÆR‡G‚ÂG’“°¢–b‚7W'&VçBÇÂ7W'&VçBæ¶–æBÓÓÒ&&VG&ö6²"ÇÂFVf–æ—F–öâ’&WGW&âfÇ6S° ¢òò6fW2&RvVæW&FVBf—'7BæB6âö666–öæÆÇ’W&6RF†R–çFVæFV@¢òò÷Væ–ær6VÒâ&V'V–ÆBF†W6RF‡&VR6VÆÇ226ögBÆöÒ6òWfW'’6VVBæ@¢òòWfW'’vVöÆöv–6Â6V7F÷"7F'G2v—F‚F†R6ÖR6ÖÆÂÂ&V6†&ÆR–÷WBà¢6öç7BF–ÆRÒ7&VFUF–ÆR‚&ÆöÒ"Â‡ÂG'VR“°¢F†—2çF–ÆW5·F†—2åö–æFW‚‡G‚ÂG’•ÒÒF–ÆS°¢F†—2åö÷&U&æ´'•F–ÆU·F†—2åö–æFW‚‡G‚ÂG’•ÒÒÓ°¢–b‚F†—2åöÇ”÷&R‡G‚ÂG’ÂFVf–æ—F–öâ’’&WGW&âfÇ6S°¢F–ÆRæÖ„‡Ò‡°¢F–ÆRæ‡Ò‡°¢F–ÆRæF—66÷fW&VBÒG'VS°¢F–ÆRæ7&6¶VBÒ°¢&WGW&âG'VS°¢Ó° ¢òòF†Rf—'7B6÷W"—2f—6–&ÆRg&öÒF†R7vâ6†Ö&W"âöæ6R—B÷Vç2ÂF†P¢òòÖ–æW"—26Æ÷6RVæ÷Vv‚Fò6ÖVÆÂF†R6öÂæBF†VâF†R6V6öæB6÷W"âF†P¢òòf—†VB…62¶VWF†—2W6VgVÂ–ç6–FRF†R–æ—F–Â6—‚×6V6öæB6†–gBà¢Æ6U6ögD÷&Rƒ"Â6÷W"Â"“°¢Æ6U6ögD÷&Rƒ2Â6öÂÂB“°¢Æ6U6ögD÷&RƒBÂ6÷W"Â2“° ¢6öç7Böfg6WG2Ò°¢²Ó"ÂEÒÀ¢³"ÂUÒÀ¢³ÂuÒÀ¢Ó° ¢f÷"†6öç7B¶öfg6WE‚Âöfg6WE•Òöböfg6WG2’°¢6öç7BF&vWE‚ÒF†—2å÷7vâçG‚²öfg6WEƒ°¢6öç7BF&vWE’ÒF†—2å÷7vâçG’²öfg6WE“°¢6öç7B6æF–FFRÒF†—2åöæV&W7E6öÆ–EF–ÆR‡F&vWE‚ÂF&vWE’Â"“°¢–b†6æF–FFR’F†—2åöÇ”÷&R†6æF–FFRçG‚Â6æF–FFRçG’Â6÷W"“°¢Ð¢Ð ¢öæV&W7E6öÆ–EF–ÆR†÷&–v–å‚Â÷&–v–å’Â&F—W2’°¢ÆWBæV&W7BÒçVÆÃ°¢ÆWBæV&W7DF—7Fæ6RÒ–æf–æ—G“° ¢f÷"†ÆWBG’Ò÷&–v–å’Ò&F—W3²G’ÃÒ÷&–v–å’²&F—W3²G’³Ò’°¢f÷"†ÆWBG‚Ò÷&–v–å‚Ò&F—W3²G‚ÃÒ÷&–v–å‚²&F—W3²G‚³Ò’°¢6öç7BF–ÆRÒF†—2ævWEF–ÆR‡G‚ÂG’“°¢–b‚F–ÆRÇÂF–ÆRæ¶–æBÓÓÒ&—""ÇÂF–ÆRæ¶–æBÓÓÒ&&VG&ö6²"’6öçF–çVS°¢6öç7BF—7Fæ6RÒ‡G‚Ò÷&–v–å‚’¢¢"²‡G’Ò÷&–v–å’’¢¢#°¢–b†F—7Fæ6RÂæV&W7DF—7Fæ6R’°¢æV&W7DF—7Fæ6RÒF—7Fæ6S°¢æV&W7BÒ²G‚ÂG’Ó°¢Ð¢Ð¢Ð ¢&WGW&âæV&W7C°¢Ð ¢ö—4FÖvV&ÆR‡F–ÆR’°¢&WGW&â&ööÆVâ‡F–ÆRbbF–ÆRæ¶–æBÓÒ&—""bbF–ÆRæ¶–æBÓÒ&&VG&ö6²"bbF–ÆRæÖ„‡â“°¢Ð ¢öFÖvT6æF–FFW2†6æF–FFW2ÂFÖvRÂöä'&V²Â÷F–öç2Ò·Ò’°¢6öç7B'&ö¶VâÒµÓ°¢6öç7BFÖvT×VÇF—Æ–W"ÒG—Vöb÷F–öç2æFÖvT×VÇF—Æ–W"ÓÓÒ&gVæ7F–öâ ¢ò÷F–öç2æFÖvT×VÇF—Æ–W ¢¢çVÆÃ°¢f÷"†6öç7B6æF–FFRöb6æF–FFW2’°¢6öç7BF–ÆRÒF†—2ævWEF–ÆR†6æF–FFRçG‚Â6æF–FFRçG’“°¢–b‚F†—2åö—4FÖvV&ÆR‡F–ÆR’’6öçF–çVS°¢6öç7B×VÇF—Æ–W"ÒFÖvT×VÇF—Æ–W ¢òÖF‚æÖ‚ƒÂ4f–æ—FR†FÖvT×VÇF—Æ–W"‡F–ÆRÂ6æF–FFRçG‚Â6æF–FFRçG’’Â’¢¢°¢6öç7BÆ–VDFÖvRÒFÖvR¢×VÇF—Æ–W#°¢–b†Æ–VDFÖvRÃÒ’6öçF–çVS°¢F–ÆRæF—66÷fW&VBÒG'VS°¢F–ÆRæ‡ÒÖF‚æÖ‚ƒÂF–ÆRæ‡ÒÆ–VDFÖvR“°¢F–ÆRæ7&6¶VBÒ6Æ×ƒÒF–ÆRæ‡òF–ÆRæÖ„‡ÂÂ“°¢–b‡F–ÆRæ‡ÃÒ’°¢6öç7B&W7VÇBÒF†—2æ'&VµF–ÆR†6æF–FFRçG‚Â6æF–FFRçG’Âöä'&V²“°¢–b‡&W7VÇB’'&ö¶VâçW6‚‡&W7VÇB“°¢Ð¢Ð¢&WGW&â'&ö¶Vã°¢Ð ¢÷&WfVÄ&÷VæB†6VçFW%‚Â6VçFW%’Â&F—W2’°¢6öç7B&F—W57V&VBÒ&F—W2¢&F—W3°¢f÷"†ÆWBG’Ò6VçFW%’Ò&F—W3²G’ÃÒ6VçFW%’²&F—W3²G’³Ò’°¢f÷"†ÆWBG‚Ò6VçFW%‚Ò&F—W3²G‚ÃÒ6VçFW%‚²&F—W3²G‚³Ò’°¢–b‚‡G‚Ò6VçFW%‚’¢¢"²‡G’Ò6VçFW%’’¢¢"â&F—W57V&VB’6öçF–çVS°¢6öç7BF–ÆRÒF†—2ævWEF–ÆR‡G‚ÂG’“°¢–b‡F–ÆR’F–ÆRæF—66÷fW&VBÒG'VS°¢Ð¢Ð¢Ð§Ð §v–æF÷räFWF…¦W&õv÷&ÆBÒö&¦V7Bæg&VW¦R‡°¢tõ$ÄEô4ôäd”rÀ¢tTôÄôt”4Åõ4T5Dõ%2À¢TäDU$u$õTäEôUdTåEõE•U2À¢tÄô$ÅôUdTåEõE•U2À¢d”TÄEôUdTåEõE•U2À¢7&VFU&æFöÔvVöÆöw•&öf–ÆRÀ¢vWE6V7F÷$6†ö–6W2À¢Ö–æUv÷&ÆBÀ§Ò“°§Ò’‚“°