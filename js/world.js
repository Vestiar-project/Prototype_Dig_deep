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
const FINAL_SEAL_HITS = 3;
const FINAL_LAYER_TY = WORLD_CONFIG.HEIGHT - WORLD_CONFIG.BEDROCK_ROWS - 1;
const DEFAULT_SECTOR_ID = "stable_strata";
const RANDOM_SECTOR_ID = "random_strata";

/**
 * Legacy named profiles remain available to deterministic diagnostics. Normal
 * shifts use a seed-derived hidden profile and never ask the player to choose.
 */
const GEOLOGICAL_SECTORS = Object.freeze([
  Object.freeze({
    id: DEFAULT_SECTOR_ID,
    label: "Стабильные пласты",
    icon: "◆",
    color: "#d6a15d",
    description: "Предсказуемый участок без резких перекосов — надёжный выбор для обычной смены.",
    forecast: Object.freeze([
      "Пещеры: умеренно",
      "Твёрдость: обычная",
      "Жилы: среднего размера",
      "Изобилие: обычное",
    ]),
    ratings: Object.freeze({
      caves: "умеренно",
      hardness: "обычная",
      veins: "средние",
      abundance: "обычное",
    }),
    modifiers: Object.freeze({ caves: 1, hardness: 1, veins: 1, abundance: 1 }),
  }),
  Object.freeze({
    id: "cavern_karst",
    label: "Пещерный карст",
    icon: "◌",
    color: "#67d5c4",
    description: "Изрезанный пустотами пласт: двигаться легче, но рудных находок немного меньше.",
    forecast: Object.freeze([
      "Пещеры: очень много",
      "Твёрдость: обычная",
      "Жилы: среднего размера",
      "Изобилие: ниже на 10%",
    ]),
    ratings: Object.freeze({
      caves: "очень много",
      hardness: "обычная",
      veins: "средние",
      abundance: "ниже среднего",
    }),
    modifiers: Object.freeze({ caves: 1.48, hardness: 1, veins: 1, abundance: 0.9 }),
  }),
  Object.freeze({
    id: "ore_ridge",
    label: "Рудная гряда",
    icon: "⬢",
    color: "#f1c84b",
    description: "Пещер меньше, зато при обычной прочности породы встречается больше рудных находок.",
    forecast: Object.freeze([
      "Пещеры: мало",
      "Твёрдость: обычная",
      "Жилы: среднего размера",
      "Изобилие: выше на 30%",
    ]),
    ratings: Object.freeze({
      caves: "мало",
      hardness: "обычная",
      veins: "средние",
      abundance: "высокое",
    }),
    modifiers: Object.freeze({ caves: 0.76, hardness: 1, veins: 1, abundance: 1.3 }),
  }),
]);

const UNDERGROUND_EVENT_TYPES = Object.freeze([
  Object.freeze({
    id: "fragile_cavity",
    effect: "soft_rock",
    durationSeconds: 5,
    effectDescription: "Короткий резонанс на несколько секунд смягчает обычную породу по всей шахте.",
    label: "ХРУПКАЯ ПОЛОСТЬ",
    icon: "✹",
    color: "#ffb45b",
    radiusTiles: 1.6,
    description: "По породе бегут яркие трещины: после активации вся обычная порода на пять секунд станет мягче.",
  }),
  Object.freeze({
    id: "gas_pocket",
    effect: "dig_speed",
    durationSeconds: 5,
    effectDescription: "Вспышка заряжает инструмент и ненадолго ускоряет удары по всей шахте.",
    label: "ГАЗОВЫЙ КАРМАН",
    icon: "☁",
    color: "#a8f06a",
    radiusTiles: 1.6,
    description: "Светящееся облако заметно пульсирует: после активации инструмент на пять секунд ускорится по всей шахте.",
  }),
  Object.freeze({
    id: "rich_lens",
    effect: "ore_yield",
    durationSeconds: 5,
    effectDescription: "Рудный импульс на несколько секунд увеличивает выход любой собранной руды.",
    label: "БОГАТАЯ ЛИНЗА",
    icon: "✦",
    color: "#ffe36e",
    radiusTiles: 1.5,
    description: "Руда в контуре переливается золотыми всполохами: на пять секунд выход любой руды станет выше.",
  }),
  Object.freeze({
    id: "ancient_container",
    effect: "chest",
    durationSeconds: 0,
    effectDescription: "Сундук с несколькими видами руды: его содержимое зависит от глубины находки.",
    label: "ДРЕВНИЙ КОНТЕЙНЕР",
    icon: "▣",
    color: "#ff7a68",
    radiusTiles: 1.1,
    description: "Из-под земли пробивается красный маяк: внутри лежат несколько случайных руд старой артели.",
  }),
  Object.freeze({
    id: "underground_flow",
    effect: "move_speed",
    durationSeconds: 5,
    effectDescription: "Подземный поток ненадолго ускоряет движение шахтёра в любой части поля.",
    label: "ПОДЗЕМНЫЙ ПОТОК",
    icon: "≈",
    color: "#58c9ff",
    radiusTiles: 1.7,
    description: "Яркий поток рассекает пласт: после активации шахтёр на пять секунд ускорится в любой части поля.",
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
    label: "Случайные пласты",
    icon: "◆",
    color: "#d6a15d",
    description: "Состав и форма выработки определяются заново для каждой смены.",
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
    this._oreColumnsByRow = [];
    this._oreIndexReady = false;
    this._undergroundEvents = [];
    this._undergroundEventById = new Map();

    this._carveCaves();
    this._carveSpawnChamber();
    this._generateOreVeins();
    this._prepareLiftStations();
    this._placeStarterOre();
    this._generateUndergroundEvents();
    this._installFinalSeal();
    this._rebuildOreIndex();
    this._revealAround(this._spawn.tx, this._spawn.ty, 6);
    return this;
  }

  getTile(tx, ty) {
    const tileX = Math.floor(tx);
    const tileY = Math.floor(ty);
    if (!this._inBounds(tileX, tileY)) return null;
    return this.tiles[this._index(tileX, tileY)] ?? null;
  }

  /**
   * Enumerates live ore only, preserving the world's row-major tile order.
   * This keeps target tie-breaking identical while avoiding scans of empty rock.
   */
  forEachOreTileInBounds(minTx, minTy, maxTx, maxTy, visitor) {
    if (typeof visitor !== "function") return true;
    if (!this._oreIndexReady) this._rebuildOreIndex();

    const left = clamp(Math.floor(asFinite(minTx, 0)), 0, WORLD_CONFIG.WIDTH - 1);
    const right = clamp(Math.floor(asFinite(maxTx, WORLD_CONFIG.WIDTH - 1)), left, WORLD_CONFIG.WIDTH - 1);
    const top = clamp(Math.floor(asFinite(minTy, 0)), 0, WORLD_CONFIG.HEIGHT - 1);
    const bottom = clamp(Math.floor(asFinite(maxTy, WORLD_CONFIG.HEIGHT - 1)), top, WORLD_CONFIG.HEIGHT - 1);

    for (let ty = top; ty <= bottom; ty += 1) {
      const columns = this._oreColumnsByRow[ty] || [];
      for (const tx of columns) {
        if (tx < left) continue;
        if (tx > right) break;
        const tile = this.getTile(tx, ty);
        if (!tile?.oreId || tile.kind === "air") continue;
        if (visitor(tile, tx, ty) === false) return false;
      }
    }
    return true;
  }

  worldToTile(x, y) {
    return {
      tx: Math.floor(asFinite(x, 0) / WORLD_CONFIG.TILE_SIZE),
      ty: Math.floor(asFinite(y, 0) / WORLD_CONFIG.TILE_SIZE),
    };
  }

  tileToWorld(tx, ty) {
    return {
      x: Math.floor(tx) * WORLD_CONFIG.TILE_SIZE,
      y: Math.floor(ty) * WORLD_CONFIG.TILE_SIZE,
    };
  }

  getSpawn() {
    return { ...this._spawn };
  }

  getAvailableOreIdsAt(tx, ty) {
    const progress = this._difficultyAt(tx, ty);
    return this._oreDefinitions
      .filter((definition) => (
        definition.minProgress <= progress + 0.025
        && definition.maxProgress + 0.025 >= progress
        && this._canOreAppearAt(tx, ty, definition)
      ))
      .sort((left, right) => left.rank - right.rank)
      .map((definition) => definition.id);
  }

  /**
   * Returns copies so presentation code cannot mutate the deterministic world
   * state. Consumed events stay hidden unless explicitly requested.
   */
  getMicroEvents(options = {}) {
    const settings = options && typeof options === "object" ? options : {};
    const allowedTypes = Array.isArray(settings.types)
      ? new Set(settings.types.map(String))
      : settings.type
        ? new Set([String(settings.type)])
        : null;

    return this._undergroundEvents
      .filter((event) => settings.includeConsumed === true || !event.consumed)
      .filter((event) => !allowedTypes || allowedTypes.has(event.type))
      .map((event) => this._publicMicroEvent(event));
  }

  /**
   * Returns one deterministic, non-spatial shift condition. These short buffs
   * are announced by the HUD and deliberately have no field coordinates or
   * marker; the ancient container remains the only physical event target.
   */
  getGlobalMicroEvent(index = 0) {
    if (!GLOBAL_EVENT_TYPES.length) return null;
    const eventIndex = Math.max(0, Math.floor(asFinite(index, 0)));
    const hash = hashSeed(`${this.seed}:${this.sectorId}:global-event:${eventIndex}`);
    const definition = GLOBAL_EVENT_TYPES[hash % GLOBAL_EVENT_TYPES.length];
    return {
      id: `global-${definition.id}-${eventIndex}-${hash.toString(36)}`,
      type: definition.id,
      typeId: definition.id,
      effect: definition.effect,
      durationSeconds: definition.durationSeconds,
      label: definition.label,
      icon: definition.icon,
      color: definition.color,
      description: definition.effectDescription || definition.description,
      announcement: `${definition.icon} ${definition.label}`,
      noticeLevel: "high",
      global: true,
      scheduled: true,
      index: eventIndex,
    };
  }

  /**
   * Moves one still-unused event into a short, reachable side passage near the
   * landing chamber. Campaign pacing calls this only after several dry shifts;
   * normal world generation and ore/rock density remain untouched.
   */
  stageMicroEventNearSpawn(preferredType = null, anchor = null) {
    const candidates = this._undergroundEvents.filter((event) => (
      !event.consumed && (!preferredType || event.type === preferredType)
    ));
    if (!candidates.length) return null;
    const event = candidates[hashSeed(`${this.seed}:staged-event:${preferredType || "any"}`) % candidates.length];
    const origin = anchor && Number.isFinite(Number(anchor.tx)) && Number.isFinite(Number(anchor.ty))
      ? { tx: Math.floor(Number(anchor.tx)), ty: Math.floor(Number(anchor.ty)) }
      : this._spawn;
    const offsets = [
      [0, 2], [2, 2], [-2, 2], [0, 3], [2, 1], [-2, 1], [1, 3], [-1, 3],
    ];
    const coordinates = offsets.map(([offsetX, offsetY]) => ({
      tx: origin.tx + offsetX,
      ty: origin.ty + offsetY,
    }));
    if (anchor?.target && Number.isFinite(Number(anchor.target.tx)) && Number.isFinite(Number(anchor.target.ty))) {
      coordinates.push({ tx: Math.floor(Number(anchor.target.tx)), ty: Math.floor(Number(anchor.target.ty)) });
    }
    // A lift chamber or a cave-heavy surface seed can make every hand-picked
    // offset air. Deterministic square rings guarantee a solid fallback while
    // keeping the nearest viable location first.
    for (let radius = 2; radius <= 7; radius += 1) {
      for (let offsetY = 0; offsetY <= radius; offsetY += 1) {
        for (let offsetX = -radius; offsetX <= radius; offsetX += 1) {
          if (Math.max(Math.abs(offsetX), Math.abs(offsetY)) !== radius) continue;
          coordinates.push({ tx: origin.tx + offsetX, ty: origin.ty + offsetY });
        }
      }
      for (let offsetY = -1; offsetY >= -radius; offsetY -= 1) {
        for (let offsetX = -radius; offsetX <= radius; offsetX += 1) {
          if (Math.max(Math.abs(offsetX), Math.abs(offsetY)) !== radius) continue;
          coordinates.push({ tx: origin.tx + offsetX, ty: origin.ty + offsetY });
        }
      }
    }
    let location = null;
    const checked = new Set();
    for (const coordinate of coordinates) {
      const tx = clamp(coordinate.tx, 2, WORLD_CONFIG.WIDTH - 3);
      const ty = clamp(coordinate.ty, 2, WORLD_CONFIG.HEIGHT - WORLD_CONFIG.BEDROCK_ROWS - 2);
      const key = `${tx}:${ty}`;
      if (checked.has(key)) continue;
      checked.add(key);
      const tile = this.getTile(tx, ty);
      if (!tile || tile.kind === "air" || tile.kind === "bedrock") continue;
      const occupied = this._undergroundEvents.some((other) => (
        other !== event
        && !other.consumed
        && Math.hypot(tx - other.tx, ty - other.ty) < event.radiusTiles + other.radiusTiles + 2
      ));
      if (!occupied) {
        location = { tx, ty };
        break;
      }
    }
    if (!location) return null;
    event.tx = location.tx;
    event.ty = location.ty;
    event.x = (location.tx + 0.5) * WORLD_CONFIG.TILE_SIZE;
    event.y = (location.ty + 0.5) * WORLD_CONFIG.TILE_SIZE;
    event.depthTiles = Math.max(0, location.ty - this._spawn.ty);
    if (event.effect === "chest") {
      event.loot = this._createContainerLoot(
        location.tx,
        location.ty,
        new SeededRandom(`${this.seed}:staged-container:${location.tx}:${location.ty}`),
      );
    }
    return this._publicMicroEvent(event);
  }

  listUndergroundEvents(options = {}) {
    return this.getMicroEvents(options);
  }

  getMicroEventsNear(tx, ty, radiusTiles = 0, options = {}) {
    const centerX = asFinite(tx, 0);
    const centerY = asFinite(ty, 0);
    const searchRadius = Math.max(0, asFinite(radiusTiles, 0));
    return this.getMicroEvents(options)
      .map((event) => {
        const distanceTiles = Math.hypot(event.tx - centerX, event.ty - centerY);
        return {
          ...event,
          distanceTiles,
          distanceToEdgeTiles: Math.max(0, distanceTiles - event.radiusTiles),
        };
      })
      .filter((event) => event.distanceTiles <= searchRadius + event.radiusTiles)
      .sort((left, right) => (
        left.distanceToEdgeTiles - right.distanceToEdgeTiles
        || left.distanceTiles - right.distanceTiles
        || left.ty - right.ty
        || left.tx - right.tx
      ));
  }

  findUndergroundEvents(x, y, radius = 0, options = {}) {
    return this.getMicroEventsNear(
      asFinite(x, 0) / WORLD_CONFIG.TILE_SIZE - 0.5,
      asFinite(y, 0) / WORLD_CONFIG.TILE_SIZE - 0.5,
      Math.max(0, asFinite(radius, 0)) / WORLD_CONFIG.TILE_SIZE,
      options,
    ).map((event) => ({
      ...event,
      distance: event.distanceTiles * WORLD_CONFIG.TILE_SIZE,
      distanceToEdge: event.distanceToEdgeTiles * WORLD_CONFIG.TILE_SIZE,
    }));
  }

  findUndergroundEvent(x, y, radius = 0, options = {}) {
    return this.findUndergroundEvents(x, y, radius, options)[0] || null;
  }

  triggerMicroEvent(idOrEvent) {
    const id = typeof idOrEvent === "string" ? idOrEvent : idOrEvent?.id;
    const event = this._undergroundEventById.get(id);
    if (!event || event.triggered || event.consumed) return null;
    event.triggered = true;
    return {
      ...this._publicMicroEvent(event),
      firstTrigger: true,
    };
  }

  triggerUndergroundEvent(idOrEvent) {
    return this.triggerMicroEvent(idOrEvent);
  }

  consumeMicroEvent(idOrEvent) {
    const id = typeof idOrEvent === "string" ? idOrEvent : idOrEvent?.id;
    const event = this._undergroundEventById.get(id);
    if (!event || event.consumed) return null;
    const wasTriggered = event.triggered;
    event.triggered = true;
    event.consumed = true;
    return {
      ...this._publicMicroEvent(event),
      wasTriggered,
      firstConsume: true,
    };
  }

  consumeUndergroundEvent(idOrEvent) {
    return this.consumeMicroEvent(idOrEvent);
  }

  /**
   * Read-only shaft-lift selector. Depth values use the same metre units as
   * the game's saved bestDepth. Either call with positional arguments:
   *   getLiftStart(bestDepth, fraction, unlockedDepthCap, options)
   * or one options object containing bestDepth, fraction, unlockedDepthCap and
   * unlockedTierCap. Fractions above 1 are treated as percentages.
   */
  getLiftStart(bestDepthOrOptions = 0, fraction = 0, unlockedDepthCap = Infinity, options = {}) {
    let settings;
    if (bestDepthOrOptions && typeof bestDepthOrOptions === "object") {
      settings = { ...bestDepthOrOptions };
    } else {
      const suppliedCap = unlockedDepthCap && typeof unlockedDepthCap === "object"
        ? unlockedDepthCap
        : {};
      settings = {
        ...(options && typeof options === "object" ? options : {}),
        ...suppliedCap,
        bestDepth: bestDepthOrOptions,
        fraction,
      };
      if (Number.isFinite(Number(unlockedDepthCap))) {
        settings.unlockedDepthCap = Number(unlockedDepthCap);
      }
    }

    const bestDepth = Math.max(0, asFinite(settings.bestDepth, 0));
    const liftFraction = normalizeFraction(settings.fraction, 0);
    const explicitDepthCap = numericField(
      settings,
      ["unlockedDepthCap", "maxDepth", "depthCap", "depth"],
      Infinity,
    );
    const depthCap = Math.max(0, Math.min(bestDepth, explicitDepthCap));
    const requestedDepth = bestDepth * liftFraction;
    const clampedDepth = Math.min(requestedDepth, depthCap);
    const tierCapValue = numericField(
      settings,
      ["unlockedTierCap", "maxTier", "tierCap", "tier"],
      Infinity,
    );
    const tierCap = Number.isFinite(tierCapValue) ? Math.max(0, Math.floor(tierCapValue)) : Infinity;

    let selected = null;
    for (const station of this._liftStations) {
      if (station.depth > clampedDepth + Number.EPSILON) continue;
      if (station.requiredTier > tierCap) continue;
      if (
        !selected
        || station.depth > selected.depth
        || (station.depth === selected.depth && station.ty > selected.ty)
        || (station.depth === selected.depth && station.ty === selected.ty && station.tx < selected.tx)
      ) {
        selected = station;
      }
    }

    if (!selected) {
      const baseSpawn = this.getSpawn();
      return {
        ...baseSpawn,
        baseSpawn,
        source: "surface-spawn",
        isSurfaceSpawn: true,
        depth: 0,
        depthTiles: 0,
        requestedDepth,
        clampedDepth,
        requiredTier: 0,
        target: this._starterTargetNear(this._spawn.tx, this._spawn.ty),
      };
    }

    return {
      x: selected.x,
      y: selected.y,
      tx: selected.tx,
      ty: selected.ty,
      baseSpawn: this.getSpawn(),
      source: "shaft-lift",
      isSurfaceSpawn: false,
      depth: selected.depth,
      depthTiles: selected.depthTiles,
      requestedDepth,
      clampedDepth,
      requiredTier: selected.requiredTier,
      target: selected.target ? { ...selected.target } : null,
    };
  }

  /**
   * Replaces the lift's one guaranteed copper node with one phase-appropriate
   * ore requested by the meta economy. This does not add nodes or change vein
   * density: every landing still has exactly one short resupply target.
   */
  retuneLiftTarget(lift, preferredOreIds = []) {
    if (!lift || lift.isSurfaceSpawn || lift.source !== "shaft-lift" || !lift.target) return null;
    const tx = Math.floor(asFinite(lift.target.tx, NaN));
    const ty = Math.floor(asFinite(lift.target.ty, NaN));
    if (!Number.isFinite(tx) || !Number.isFinite(ty)) return null;
    const tile = this.getTile(tx, ty);
    if (!tile || tile.kind === "air" || tile.kind === "bedrock") return null;
    const resupplyHpCap = Math.max(1, Math.round(asFinite(tile.maxHp, 1)));

    const tierCap = Math.max(0, Math.floor(asFinite(lift.requiredTier, 0)));
    const allowed = this._oreDefinitions
      .filter((definition) => {
        const tier = Math.max(0, Math.floor(numericField(definition.source, ["tier"], 0)));
        return tier <= tierCap && this._canOreAppearAt(tx, ty, definition);
      })
      .sort((left, right) => left.rank - right.rank);
    if (!allowed.length) return null;

    const requested = Array.isArray(preferredOreIds)
      ? preferredOreIds.map(String)
      : [String(preferredOreIds || "")];
    let definition = requested
      .map((oreId) => allowed.find((candidate) => candidate.id === oreId))
      .find(Boolean);
    if (!definition) {
      // Empty-deficit runs rotate the landing sample instead of always
      // returning copper. Limit the fallback to the four opening materials;
      // genuinely deep ore should still be earned by descending.
      const supportPool = allowed.filter((candidate) => (
        Math.max(0, Math.floor(numericField(candidate.source, ["tier"], 0))) <= 3
      ));
      const pool = supportPool.length ? supportPool : allowed;
      definition = pool[hashSeed(`${this.seed}:lift-supply:${tx}:${ty}`) % pool.length];
    }

    if (!this._applyOre(tx, ty, definition, `lift-supply:${tx}:${ty}:${definition.id}`)) return null;
    // Changing copper into a denser material must not undo the deliberately
    // short landing sample prepared by _ensureLiftTarget.
    tile.maxHp = Math.min(tile.maxHp, resupplyHpCap);
    tile.hp = tile.maxHp;
    tile.discovered = true;
    tile.liftSupply = true;
    tile.cracked = 0;
    const tier = Math.max(0, Math.floor(numericField(definition.source, ["tier"], 0)));
    return {
      tx,
      ty,
      x: (tx + 0.5) * WORLD_CONFIG.TILE_SIZE,
      y: (ty + 0.5) * WORLD_CONFIG.TILE_SIZE,
      oreId: definition.id,
      maxHp: tile.maxHp,
      tier,
      liftSupply: true,
    };
  }

  /**
   * Read-only bounded path comparison for "path of least resistance".
   * Points may be tile coordinates ({ tx, ty }) or world pixels ({ x, y }).
   * The result exposes both the immediate next tile and a short waypoint.
   */
  findLeastResistanceStep(from, target, options = {}) {
    const start = this._asTilePoint(from);
    const goal = this._asTilePoint(target);
    if (!start || !goal) return null;
    const targetTile = this.getTile(goal.tx, goal.ty);
    if (!targetTile || targetTile.kind === "bedrock") return null;

    const directRoute = this._traceTileLine(start, goal);
    const directSteps = Math.max(0, directRoute.length - 1);
    const routeOptions = {
      moveSpeed: Math.max(1, asFinite(options.moveSpeed, WORLD_CONFIG.TILE_SIZE * 4)),
      digPowerPerSecond: Math.max(0.01, asFinite(
        options.digPowerPerSecond,
        asFinite(options.digRate, 1),
      )),
      hardnessMultiplier: Math.max(0, asFinite(options.hardnessMultiplier, 1)),
      focusedOreId: typeof options.focusedOreId === "string" ? options.focusedOreId : null,
      focusedOreDigMultiplier: Math.max(1, asFinite(options.focusedOreDigMultiplier, 1)),
      maxDetourTiles: clamp(Math.floor(asFinite(options.maxDetourTiles, 8)), 0, 24),
      maxExpandedNodes: clamp(Math.floor(asFinite(options.maxExpandedNodes, 6000)), 128, 20_000),
      minimumSavings: Math.max(0, asFinite(options.minimumSavings, 0.02)),
      waypointLookAhead: clamp(Math.floor(asFinite(options.waypointLookAhead, 5)), 1, 10),
    };
    const directCost = this._routeCost(directRoute, routeOptions);
    const detourResult = routeOptions.maxDetourTiles > 0
      ? this._findBoundedRoute(start, goal, directSteps, routeOptions)
      : null;
    const detourCost = detourResult?.cost ?? Infinity;
    const useDetour = Boolean(
      detourResult
      && (
        !Number.isFinite(directCost)
        || detourCost + routeOptions.minimumSavings < directCost
      )
    );
    const route = useDetour ? detourResult.route : directRoute;
    const routeCost = useDetour ? detourCost : directCost;
    if (!route.length || !Number.isFinite(routeCost)) return null;

    const nextPoint = route[Math.min(1, route.length - 1)];
    const waypointPoint = this._selectRouteWaypoint(route, routeOptions.waypointLookAhead);
    const next = this._routePointResult(nextPoint);
    const waypoint = this._routePointResult(waypointPoint);
    const savedSeconds = Number.isFinite(directCost)
      ? Math.max(0, directCost - routeCost)
      : Infinity;
    const reason = useDetour
      ? Number.isFinite(directCost)
        ? "lower-total-time"
        : "direct-route-blocked"
      : "direct-route-cheapest";

    return {
      ...next,
      next,
      waypoint,
      target: this._routePointResult(goal),
      usedDetour: useDetour,
      reason,
      requiresDigging: next.tile?.kind !== "air",
      cost: routeCost,
      routeCost,
      directCost,
      savedSeconds,
      steps: Math.max(0, route.length - 1),
      directSteps,
      expandedNodes: detourResult?.expandedNodes ?? 0,
      route: route.map((point) => ({ tx: point.tx, ty: point.ty })),
    };
  }

  _asTilePoint(point) {
    if (!point || typeof point !== "object") return null;
    let tx;
    let ty;
    if (Number.isFinite(Number(point.tx)) && Number.isFinite(Number(point.ty))) {
      tx = Math.floor(Number(point.tx));
      ty = Math.floor(Number(point.ty));
    } else if (Number.isFinite(Number(point.x)) && Number.isFinite(Number(point.y))) {
      ({ tx, ty } = this.worldToTile(Number(point.x), Number(point.y)));
    } else {
      return null;
    }
    if (!this._inBounds(tx, ty)) return null;
    return { tx, ty };
  }

  _traceTileLine(from, target) {
    const route = [];
    let tx = from.tx;
    let ty = from.ty;
    const dx = Math.abs(target.tx - tx);
    const dy = Math.abs(target.ty - ty);
    const stepX = tx < target.tx ? 1 : -1;
    const stepY = ty < target.ty ? 1 : -1;
    let error = dx - dy;

    while (true) {
      route.push({ tx, ty });
      if (tx === target.tx && ty === target.ty) break;
      const doubledError = error * 2;
      let nextTx = tx;
      let nextTy = ty;
      if (doubledError > -dy) {
        error -= dy;
        nextTx += stepX;
      }
      if (doubledError < dx) {
        error += dx;
        nextTy += stepY;
      }

      if (nextTx !== tx && nextTy !== ty) {
        const sideX = this.getTile(nextTx, ty);
        const sideY = this.getTile(tx, nextTy);
        if (!sideX || !sideY || sideX.kind !== "air" || sideY.kind !== "air") {
          const cardinalBridges = [
            { tx: nextTx, ty, tile: sideX },
            { tx, ty: nextTy, tile: sideY },
          ]
            .filter((candidate) => candidate.tile && candidate.tile.kind !== "bedrock")
            .sort((left, right) => {
              const leftCost = left.tile.kind === "air" ? 0 : Math.max(0, left.tile.hp);
              const rightCost = right.tile.kind === "air" ? 0 : Math.max(0, right.tile.hp);
              return leftCost - rightCost || left.ty - right.ty || left.tx - right.tx;
            });
          if (cardinalBridges.length) {
            route.push({ tx: cardinalBridges[0].tx, ty: cardinalBridges[0].ty });
          }
        }
      }
      tx = nextTx;
      ty = nextTy;
    }
    return route;
  }

  _routeStepCost(from, to, options) {
    const tile = this.getTile(to.tx, to.ty);
    if (!tile || tile.kind === "bedrock") return Infinity;
    const isDiagonal = from.tx !== to.tx && from.ty !== to.ty;
    if (isDiagonal) {
      const sideX = this.getTile(to.tx, from.ty);
      const sideY = this.getTile(from.tx, to.ty);
      // A diagonal is traversable only through an already open corner. This
      // rule also applies to the direct line, so it cannot bypass the bounded
      // route search and send the miner through the seam between two blocks.
      if (!sideX || !sideY || sideX.kind !== "air" || sideY.kind !== "air") return Infinity;
    }
    const stepLength = isDiagonal ? Math.SQRT2 : 1;
    const movementSeconds = stepLength * WORLD_CONFIG.TILE_SIZE / options.moveSpeed;
    const remainingHp = tile.kind === "air" ? 0 : Math.max(0, asFinite(tile.hp, tile.maxHp || 0));
    const focusedMultiplier = options.focusedOreId && tile.oreId === options.focusedOreId
      ? options.focusedOreDigMultiplier
      : 1;
    const miningSeconds = remainingHp * options.hardnessMultiplier
      / (options.digPowerPerSecond * focusedMultiplier);
    return movementSeconds + miningSeconds;
  }

  _routeCost(route, options) {
    let cost = 0;
    for (let index = 1; index < route.length; index += 1) {
      const stepCost = this._routeStepCost(route[index - 1], route[index], options);
      if (!Number.isFinite(stepCost)) return Infinity;
      cost += stepCost;
    }
    return cost;
  }

  _findBoundedRoute(start, goal, directSteps, options) {
    if (start.tx === goal.tx && start.ty === goal.ty) {
      return { route: [{ ...start }], cost: 0, expandedNodes: 0 };
    }

    const maxSteps = directSteps + options.maxDetourTiles;
    const margin = options.maxDetourTiles;
    const minTx = clamp(Math.min(start.tx, goal.tx) - margin, 0, WORLD_CONFIG.WIDTH - 1);
    const maxTx = clamp(Math.max(start.tx, goal.tx) + margin, 0, WORLD_CONFIG.WIDTH - 1);
    const minTy = clamp(Math.min(start.ty, goal.ty) - margin, 0, WORLD_CONFIG.HEIGHT - 1);
    const maxTy = clamp(Math.max(start.ty, goal.ty) + margin, 0, WORLD_CONFIG.HEIGHT - 1);
    const neighborOffsets = [
      [1, 0],
      [0, 1],
      [-1, 0],
      [0, -1],
      [1, 1],
      [-1, 1],
      [-1, -1],
      [1, -1],
    ];
    const heap = [];
    const costs = new Map();
    const records = new Map();
    const labelsByTile = new Map();
    let insertionOrder = 0;
    let expandedNodes = 0;
    const startKey = `${this._index(start.tx, start.ty)}:0`;
    const startNode = {
      ...start,
      steps: 0,
      cost: 0,
      key: startKey,
      previous: null,
      order: insertionOrder,
    };
    costs.set(startKey, 0);
    records.set(startKey, startNode);
    labelsByTile.set(this._index(start.tx, start.ty), [
      { steps: 0, cost: 0, key: startKey },
    ]);
    pushRouteNode(heap, startNode);
    let goalNode = null;

    while (heap.length && expandedNodes < options.maxExpandedNodes) {
      const current = popRouteNode(heap);
      if (!current || costs.get(current.key) !== current.cost) continue;
      expandedNodes += 1;
      if (current.tx === goal.tx && current.ty === goal.ty) {
        goalNode = current;
        break;
      }
      if (current.steps >= maxSteps) continue;

      for (const [offsetX, offsetY] of neighborOffsets) {
        const tx = current.tx + offsetX;
        const ty = current.ty + offsetY;
        if (tx < minTx || tx > maxTx || ty < minTy || ty > maxTy) continue;
        const nextSteps = current.steps + 1;
        const minimumRemainingSteps = Math.max(Math.abs(goal.tx - tx), Math.abs(goal.ty - ty));
        if (nextSteps + minimumRemainingSteps > maxSteps) continue;

        const tile = this.getTile(tx, ty);
        if (!tile || tile.kind === "bedrock") continue;
        if (offsetX !== 0 && offsetY !== 0) {
          const sideX = this.getTile(current.tx + offsetX, current.ty);
          const sideY = this.getTile(current.tx, current.ty + offsetY);
          if (!sideX || !sideY || sideX.kind !== "air" || sideY.kind !== "air") continue;
        }

        const nextPoint = { tx, ty };
        const stepCost = this._routeStepCost(current, nextPoint, options);
        if (!Number.isFinite(stepCost)) continue;
        const nextCost = current.cost + stepCost;
        const tileIndex = this._index(tx, ty);
        const labels = labelsByTile.get(tileIndex) || [];
        if (labels.some((label) => label.steps <= nextSteps && label.cost <= nextCost + 1e-9)) continue;

        const keptLabels = [];
        for (const label of labels) {
          if (nextSteps <= label.steps && nextCost <= label.cost + 1e-9) {
            costs.delete(label.key);
          } else {
            keptLabels.push(label);
          }
        }

        insertionOrder += 1;
        const key = `${tileIndex}:${nextSteps}`;
        const node = {
          tx,
          ty,
          steps: nextSteps,
          cost: nextCost,
          key,
          previous: current.key,
          order: insertionOrder,
        };
        costs.set(key, nextCost);
        records.set(key, node);
        keptLabels.push({ steps: nextSteps, cost: nextCost, key });
        labelsByTile.set(tileIndex, keptLabels);
        pushRouteNode(heap, node);
      }
    }

    if (!goalNode) return null;
    const route = [];
    let cursor = goalNode;
    while (cursor) {
      route.push({ tx: cursor.tx, ty: cursor.ty });
      cursor = cursor.previous ? records.get(cursor.previous) : null;
    }
    route.reverse();
    return { route, cost: goalNode.cost, expandedNodes };
  }

  _selectRouteWaypoint(route, lookAhead) {
    if (route.length <= 1) return route[0];
    let waypoint = route[1];
    const limit = Math.min(route.length - 1, lookAhead);
    let directionX = route[1].tx - route[0].tx;
    let directionY = route[1].ty - route[0].ty;

    for (let index = 1; index <= limit; index += 1) {
      const point = route[index];
      const tile = this.getTile(point.tx, point.ty);
      waypoint = point;
      if (tile?.kind !== "air") break;
      if (index >= route.length - 1) break;
      const nextDirectionX = route[index + 1].tx - point.tx;
      const nextDirectionY = route[index + 1].ty - point.ty;
      if (nextDirectionX !== directionX || nextDirectionY !== directionY) break;
      directionX = nextDirectionX;
      directionY = nextDirectionY;
    }
    return waypoint;
  }

  _routePointResult(point) {
    const tile = this.getTile(point.tx, point.ty);
    return {
      tx: point.tx,
      ty: point.ty,
      x: (point.tx + 0.5) * WORLD_CONFIG.TILE_SIZE,
      y: (point.ty + 0.5) * WORLD_CONFIG.TILE_SIZE,
      tile,
    };
  }

  findNearestOre(x, y, radius) {
    const centerX = asFinite(x, 0);
    const centerY = asFinite(y, 0);
    const searchRadius = Math.max(0, asFinite(radius, 0));
    const tileSize = WORLD_CONFIG.TILE_SIZE;
    const minTx = clamp(Math.floor((centerX - searchRadius) / tileSize), 0, WORLD_CONFIG.WIDTH - 1);
    const maxTx = clamp(Math.floor((centerX + searchRadius) / tileSize), 0, WORLD_CONFIG.WIDTH - 1);
    const minTy = clamp(Math.floor((centerY - searchRadius) / tileSize), 0, WORLD_CONFIG.HEIGHT - 1);
    const maxTy = clamp(Math.floor((centerY + searchRadius) / tileSize), 0, WORLD_CONFIG.HEIGHT - 1);
    const radiusSquared = searchRadius * searchRadius;
    let nearest = null;
    let nearestSquared = radiusSquared + Number.EPSILON;

    for (let ty = minTy; ty <= maxTy; ty += 1) {
      for (let tx = minTx; tx <= maxTx; tx += 1) {
        const tile = this.getTile(tx, ty);
        if (!tile || tile.kind === "air" || tile.oreId === null) continue;

        const oreX = (tx + 0.5) * tileSize;
        const oreY = (ty + 0.5) * tileSize;
        const dx = oreX - centerX;
        const dy = oreY - centerY;
        const distanceSquared = dx * dx + dy * dy;

        if (distanceSquared < nearestSquared) {
          nearestSquared = distanceSquared;
          nearest = {
            tile,
            tx,
            ty,
            x: oreX,
            y: oreY,
            distance: Math.sqrt(distanceSquared),
          };
        }
      }
    }

    return nearest;
  }

  findNearestFinalSeal(x, y, radius = Infinity) {
    const centerX = asFinite(x, 0);
    const centerY = asFinite(y, 0);
    const searchRadius = Math.max(0, asFinite(radius, Infinity));
    let nearest = null;
    let nearestDistance = searchRadius + Number.EPSILON;
    for (let tx = 0; tx < WORLD_CONFIG.WIDTH; tx += 1) {
      const tile = this.getTile(tx, FINAL_LAYER_TY);
      if (tile?.kind !== "final_seal") continue;
      const targetX = (tx + 0.5) * WORLD_CONFIG.TILE_SIZE;
      const targetY = (FINAL_LAYER_TY + 0.5) * WORLD_CONFIG.TILE_SIZE;
      const targetDistance = Math.hypot(targetX - centerX, targetY - centerY);
      if (targetDistance >= nearestDistance) continue;
      nearestDistance = targetDistance;
      nearest = {
        kind: "final_seal",
        tile,
        tx,
        ty: FINAL_LAYER_TY,
        x: targetX,
        y: targetY,
        distance: targetDistance,
        remainingHits: Math.max(0, FINAL_SEAL_HITS - (tile.solarHits || 0)),
      };
    }
    return nearest;
  }

  strikeFinalSeal(tx, ty, onBreak) {
    const tileX = clamp(Math.floor(asFinite(tx, 0)), 0, WORLD_CONFIG.WIDTH - 1);
    const tileY = clamp(Math.floor(asFinite(ty, FINAL_LAYER_TY)), 0, WORLD_CONFIG.HEIGHT - 1);
    const tile = this.getTile(tileX, tileY);
    if (tile?.kind !== "final_seal") return null;
    tile.discovered = true;
    tile.solarHits = Math.min(FINAL_SEAL_HITS, Math.max(0, tile.solarHits || 0) + 1);
    tile.hp = Math.max(0, FINAL_SEAL_HITS - tile.solarHits);
    tile.cracked = clamp(tile.solarHits / FINAL_SEAL_HITS, 0, 1);
    if (tile.solarHits < FINAL_SEAL_HITS) {
      return {
        hit: true,
        breached: false,
        tx: tileX,
        ty: tileY,
        hits: tile.solarHits,
        remainingHits: FINAL_SEAL_HITS - tile.solarHits,
      };
    }

    const brokenTile = { ...tile, hp: 0, cracked: 1, discovered: true };
    tile.kind = "air";
    tile.hp = 0;
    tile.maxHp = 0;
    tile.terrainMaxHp = 0;
    tile.oreId = null;
    tile.veinId = null;
    tile.discovered = true;
    tile.cracked = 0;
    if (typeof onBreak === "function") onBreak(brokenTile, tileX, tileY);
    this._revealAround(tileX, tileY, 1);
    return {
      hit: true,
      breached: true,
      tx: tileX,
      ty: tileY,
      hits: FINAL_SEAL_HITS,
      remainingHits: 0,
      tile: brokenTile,
    };
  }

  damageCircle(x, y, radius, damage, onBreak) {
    const centerX = asFinite(x, 0);
    const centerY = asFinite(y, 0);
    const hitRadius = Math.max(0, asFinite(radius, 0));
    const amount = Math.max(0, asFinite(damage, 0));
    if (amount <= 0) return [];

    const tileSize = WORLD_CONFIG.TILE_SIZE;
    const minTx = clamp(Math.floor((centerX - hitRadius) / tileSize), 0, WORLD_CONFIG.WIDTH - 1);
    const maxTx = clamp(Math.floor((centerX + hitRadius) / tileSize), 0, WORLD_CONFIG.WIDTH - 1);
    const minTy = clamp(Math.floor((centerY - hitRadius) / tileSize), 0, WORLD_CONFIG.HEIGHT - 1);
    const maxTy = clamp(Math.floor((centerY + hitRadius) / tileSize), 0, WORLD_CONFIG.HEIGHT - 1);
    const candidates = [];
    const radiusSquared = hitRadius * hitRadius;

    for (let ty = minTy; ty <= maxTy; ty += 1) {
      for (let tx = minTx; tx <= maxTx; tx += 1) {
        const tile = this.getTile(tx, ty);
        if (!this._isDamageable(tile)) continue;

        const left = tx * tileSize;
        const top = ty * tileSize;
        const closestX = clamp(centerX, left, left + tileSize);
        const closestY = clamp(centerY, top, top + tileSize);
        const edgeDx = centerX - closestX;
        const edgeDy = centerY - closestY;
        if (edgeDx * edgeDx + edgeDy * edgeDy > radiusSquared) continue;

        const tileDx = (tx + 0.5) * tileSize - centerX;
        const tileDy = (ty + 0.5) * tileSize - centerY;
        candidates.push({ tx, ty, order: tileDx * tileDx + tileDy * tileDy });
      }
    }

    candidates.sort((a, b) => a.order - b.order || a.ty - b.ty || a.tx - b.tx);
    return this._damageCandidates(candidates, amount, onBreak);
  }

  damageTile(tx, ty, damage, onBreak) {
    const tileX = clamp(Math.floor(asFinite(tx, 0)), 0, WORLD_CONFIG.WIDTH - 1);
    const tileY = clamp(Math.floor(asFinite(ty, 0)), 0, WORLD_CONFIG.HEIGHT - 1);
    const amount = Math.max(0, asFinite(damage, 0));
    if (amount <= 0 || !this._isDamageable(this.getTile(tileX, tileY))) return [];
    return this._damageCandidates([{ tx: tileX, ty: tileY, order: 0 }], amount, onBreak);
  }

  damageRay(x, y, dx, dy, range, damage, width = WORLD_CONFIG.TILE_SIZE * 0.6, onBreak, options = {}) {
    const originX = asFinite(x, 0);
    const originY = asFinite(y, 0);
    const directionX = asFinite(dx, 0);
    const directionY = asFinite(dy, 0);
    const rayRange = Math.max(0, asFinite(range, 0));
    const amount = Math.max(0, asFinite(damage, 0));
    const magnitude = Math.hypot(directionX, directionY);
    if (magnitude <= Number.EPSILON || rayRange <= 0 || amount <= 0) return [];

    const unitX = directionX / magnitude;
    const unitY = directionY / magnitude;
    const endX = originX + unitX * rayRange;
    const endY = originY + unitY * rayRange;
    const halfWidth = Math.max(0, asFinite(width, WORLD_CONFIG.TILE_SIZE * 0.6)) * 0.5;
    const excludedKeys = options.excludedKeys instanceof Set
      ? options.excludedKeys
      : new Set(options.excludedKeys || []);
    const tileSize = WORLD_CONFIG.TILE_SIZE;
    const tileReach = tileSize * Math.SQRT1_2;
    const reach = halfWidth + tileReach;
    const minTx = clamp(Math.floor((Math.min(originX, endX) - reach) / tileSize), 0, WORLD_CONFIG.WIDTH - 1);
    const maxTx = clamp(Math.floor((Math.max(originX, endX) + reach) / tileSize), 0, WORLD_CONFIG.WIDTH - 1);
    const minTy = clamp(Math.floor((Math.min(originY, endY) - reach) / tileSize), 0, WORLD_CONFIG.HEIGHT - 1);
    const maxTy = clamp(Math.floor((Math.max(originY, endY) + reach) / tileSize), 0, WORLD_CONFIG.HEIGHT - 1);
    const candidates = [];

    for (let ty = minTy; ty <= maxTy; ty += 1) {
      for (let tx = minTx; tx <= maxTx; tx += 1) {
        if (excludedKeys.has(`${tx}:${ty}`)) continue;
        const tile = this.getTile(tx, ty);
        if (!this._isDamageable(tile)) continue;

        const centerX = (tx + 0.5) * tileSize;
        const centerY = (ty + 0.5) * tileSize;
        const fromOriginX = centerX - originX;
        const fromOriginY = centerY - originY;
        const projection = clamp(fromOriginX * unitX + fromOriginY * unitY, 0, rayRange);
        const closestX = originX + unitX * projection;
        const closestY = originY + unitY * projection;
        const distance = Math.hypot(centerX - closestX, centerY - closestY);
        if (distance > reach) continue;

        candidates.push({ tx, ty, order: projection });
      }
    }

    candidates.sort((a, b) => a.order - b.order || a.ty - b.ty || a.tx - b.tx);
    return this._damageCandidates(candidates, amount, onBreak, options);
  }

  breakTile(tx, ty, onBreak) {
    const tileX = Math.floor(tx);
    const tileY = Math.floor(ty);
    const tile = this.getTile(tileX, tileY);
    if (!this._isDamageable(tile)) return null;

    const brokenTile = {
      ...tile,
      hp: 0,
      discovered: true,
      cracked: 1,
    };
    if (tile.oreId) this._removeOreFromIndex(tileX, tileY);
    tile.kind = "air";
    tile.hp = 0;
    tile.maxHp = 0;
    tile.oreId = null;
    tile.veinId = null;
    tile.discovered = true;
    tile.cracked = 0;
    this._oreRankByTile[this._index(tileX, tileY)] = -1;
    this._revealAround(tileX, tileY, 1);

    const broken = {
      tile: brokenTile,
      tx: tileX,
      ty: tileY,
      x: tileX * WORLD_CONFIG.TILE_SIZE,
      y: tileY * WORLD_CONFIG.TILE_SIZE,
    };
    if (typeof onBreak === "function") onBreak(brokenTile, tileX, tileY);
    return broken;
  }

  getVisibleTiles(camera = {}, width, height) {
    const viewportWidth = Math.max(0, asFinite(width, asFinite(camera.width, 0)));
    const viewportHeight = Math.max(0, asFinite(height, asFinite(camera.height, 0)));
    let left = asFinite(camera.left, asFinite(camera.x, 0));
    let top = asFinite(camera.top, asFinite(camera.y, 0));

    if (camera.centered === true || camera.isCentered === true) {
      left -= viewportWidth * 0.5;
      top -= viewportHeight * 0.5;
    }

    const tileSize = WORLD_CONFIG.TILE_SIZE;
    const minTx = clamp(Math.floor(left / tileSize) - 1, 0, WORLD_CONFIG.WIDTH - 1);
    const maxTx = clamp(Math.floor((left + viewportWidth) / tileSize) + 1, 0, WORLD_CONFIG.WIDTH - 1);
    const minTy = clamp(Math.floor(top / tileSize) - 1, 0, WORLD_CONFIG.HEIGHT - 1);
    const maxTy = clamp(Math.floor((top + viewportHeight) / tileSize) + 1, 0, WORLD_CONFIG.HEIGHT - 1);
    const visible = [];

    for (let ty = minTy; ty <= maxTy; ty += 1) {
      for (let tx = minTx; tx <= maxTx; tx += 1) {
        visible.push({
          tile: this.getTile(tx, ty),
          tx,
          ty,
          x: tx * tileSize,
          y: ty * tileSize,
        });
      }
    }

    return visible;
  }

  _index(tx, ty) {
    return ty * WORLD_CONFIG.WIDTH + tx;
  }

  _rebuildOreIndex() {
    this._oreColumnsByRow = Array.from({ length: WORLD_CONFIG.HEIGHT }, () => []);
    for (let ty = 0; ty < WORLD_CONFIG.HEIGHT; ty += 1) {
      const row = this._oreColumnsByRow[ty];
      for (let tx = 0; tx < WORLD_CONFIG.WIDTH; tx += 1) {
        const tile = this.getTile(tx, ty);
        if (tile?.oreId && tile.kind !== "air") row.push(tx);
      }
    }
    this._oreIndexReady = true;
  }

  _addOreToIndex(tx, ty) {
    if (!this._oreIndexReady || !this._inBounds(tx, ty)) return;
    const row = this._oreColumnsByRow[ty] || (this._oreColumnsByRow[ty] = []);
    if (row.includes(tx)) return;
    let insertion = 0;
    while (insertion < row.length && row[insertion] < tx) insertion += 1;
    row.splice(insertion, 0, tx);
  }

  _removeOreFromIndex(tx, ty) {
    if (!this._oreIndexReady || !this._inBounds(tx, ty)) return;
    const row = this._oreColumnsByRow[ty];
    const index = row?.indexOf(tx) ?? -1;
    if (index >= 0) row.splice(index, 1);
  }

  _inBounds(tx, ty) {
    return tx >= 0 && tx < WORLD_CONFIG.WIDTH && ty >= 0 && ty < WORLD_CONFIG.HEIGHT;
  }

  _publicMicroEvent(event) {
    return {
      ...event,
      visual: { ...event.visual },
      loot: event.loot ? { ...event.loot } : null,
      state: event.consumed ? "consumed" : event.triggered ? "triggered" : "ready",
    };
  }

  _createContainerLoot(tx, ty, rng) {
    const availableIds = this.getAvailableOreIdsAt(tx, ty);
    const progress = this._difficultyAt(tx, ty);
    // Opening-zone containers tease grounded T1–T5 materials in small
    // quantities. Once the shaft leaves that early zone, fantastic T6+ ores
    // join the pool only where they can already occur naturally.
    const earlyIds = this._oreDefinitions
      .filter((definition) => (
        Math.max(0, Math.floor(numericField(definition.source, ["tier"], definition.rank))) <= 4
      ))
      .map((definition) => definition.id);
    const naturallyUnlockedIds = progress >= 0.25
      ? availableIds
      : availableIds.filter((oreId) => {
        const definition = this._oreDefinitions.find((candidate) => candidate.id === oreId);
        return Math.max(0, Math.floor(numericField(definition?.source, ["tier"], definition?.rank))) <= 4;
      });
    const pool = [...new Set([...earlyIds, ...naturallyUnlockedIds])];
    if (!pool.length) return {};
    for (let index = pool.length - 1; index > 0; index -= 1) {
      const swapIndex = rng.int(0, index);
      [pool[index], pool[swapIndex]] = [pool[swapIndex], pool[index]];
    }
    const typeCount = progress < 0.25
      ? Math.min(5, pool.length)
      : clamp(
        2 + Math.floor(progress * 2.5) + rng.int(0, 1),
        1,
        Math.min(5, pool.length),
      );
    const selected = pool.slice(0, typeCount);
    const highestAvailable = naturallyUnlockedIds[naturallyUnlockedIds.length - 1];
    if (highestAvailable && !selected.includes(highestAvailable)) {
      selected[selected.length - 1] = highestAvailable;
    }

    return Object.fromEntries(selected.map((oreId) => {
      const source = this.oreTypes.find((ore) => String(ore?.id) === oreId) || {};
      const tier = Math.max(0, Math.floor(numericField(source, ["tier"], 0)));
      const maximum = clamp(4 + Math.floor(progress * 2) - Math.floor(tier / 3), 1, 6);
      return [oreId, rng.int(1, maximum)];
    }));
  }

  _generateUndergroundEvents() {
    const eventRng = new SeededRandom(`${this.seed}:micro-events:${this.sectorId}`);
    const minimumTy = clamp(
      this._spawn.ty + 12,
      WORLD_CONFIG.SURFACE_BASE + 10,
      WORLD_CONFIG.HEIGHT - WORLD_CONFIG.BEDROCK_ROWS - 8,
    );
    const maximumTy = WORLD_CONFIG.HEIGHT - WORLD_CONFIG.BEDROCK_ROWS - 4;
    const placed = [];

    for (let index = 0; index < FIELD_EVENT_TYPES.length; index += 1) {
      const definition = FIELD_EVENT_TYPES[index];
      let location = null;

      for (let attempt = 0; attempt < 240 && !location; attempt += 1) {
        const tx = eventRng.int(7, WORLD_CONFIG.WIDTH - 8);
        const localMinimumTy = Math.max(minimumTy, this.surface[tx] + 7);
        const ty = eventRng.int(localMinimumTy, maximumTy);
        const tile = this.getTile(tx, ty);
        if (!tile || tile.kind === "air" || tile.kind === "bedrock") continue;
        if (Math.hypot(tx - this._spawn.tx, ty - this._spawn.ty) < 12) continue;

        const overlaps = placed.some((other) => (
          Math.hypot(tx - other.tx, ty - other.ty)
            < definition.radiusTiles + other.radiusTiles + 4
        ));
        if (!overlaps) location = { tx, ty };
      }

      // The world is wide enough that this should be rare, but a deterministic
      // row-major fallback guarantees all five event types for every seed.
      if (!location) {
        for (let ty = minimumTy; ty <= maximumTy && !location; ty += 1) {
          const rowOffset = hashSeed(`${this.seed}:${definition.id}:${ty}`) % WORLD_CONFIG.WIDTH;
          for (let offset = 0; offset < WORLD_CONFIG.WIDTH && !location; offset += 1) {
            const tx = (rowOffset + offset) % WORLD_CONFIG.WIDTH;
            if (tx < 7 || tx >= WORLD_CONFIG.WIDTH - 7 || ty <= this.surface[tx] + 6) continue;
            const tile = this.getTile(tx, ty);
            if (!tile || tile.kind === "air" || tile.kind === "bedrock") continue;
            const overlaps = placed.some((other) => (
              Math.hypot(tx - other.tx, ty - other.ty)
                < definition.radiusTiles + other.radiusTiles + 2
            ));
            if (!overlaps) location = { tx, ty };
          }
        }
      }

      if (!location) continue;
      const radius = definition.radiusTiles * WORLD_CONFIG.TILE_SIZE;
      const event = {
        id: `micro-${definition.id}-${hashSeed(`${this.seed}:${this.sectorId}:${definition.id}`).toString(36)}`,
        type: definition.id,
        typeId: definition.id,
        effect: definition.effect,
        durationSeconds: definition.durationSeconds,
        label: definition.label,
        icon: definition.icon,
        color: definition.color,
        description: definition.effectDescription || definition.description,
        radius,
        radiusTiles: definition.radiusTiles,
        tx: location.tx,
        ty: location.ty,
        x: (location.tx + 0.5) * WORLD_CONFIG.TILE_SIZE,
        y: (location.ty + 0.5) * WORLD_CONFIG.TILE_SIZE,
        depthTiles: Math.max(0, location.ty - this._spawn.ty),
        announcement: `${definition.icon} ${definition.label}`,
        noticeLevel: "high",
        visual: {
          pulse: "local",
          ringWidth: 3,
          color: definition.color,
          radius,
        },
        loot: definition.effect === "chest"
          ? this._createContainerLoot(location.tx, location.ty, eventRng)
          : null,
        triggered: false,
        consumed: false,
      };
      placed.push(event);
      this._undergroundEvents.push(event);
      this._undergroundEventById.set(event.id, event);
    }
  }

  _generateSurface() {
    const raw = [];
    let height = WORLD_CONFIG.SURFACE_BASE + this._rng.range(-1, 1);
    let drift = 0;

    for (let tx = 0; tx < WORLD_CONFIG.WIDTH; tx += 1) {
      drift = drift * 0.72 + this._rng.range(-0.7, 0.7);
      height += drift * 0.28;
      const broadWave = Math.sin(tx * 0.055 + 1.7) * 1.3;
      raw.push(height + broadWave);
    }

    let smoothed = raw;
    for (let pass = 0; pass < 2; pass += 1) {
      smoothed = smoothed.map((value, index, values) => {
        const previous = values[Math.max(0, index - 1)];
        const next = values[Math.min(values.length - 1, index + 1)];
        return previous * 0.25 + value * 0.5 + next * 0.25;
      });
    }

    const minSurface = WORLD_CONFIG.SURFACE_BASE - WORLD_CONFIG.SURFACE_VARIANCE;
    const maxSurface = WORLD_CONFIG.SURFACE_BASE + WORLD_CONFIG.SURFACE_VARIANCE;
    return smoothed.map((value) => Math.round(clamp(value, minSurface, maxSurface)));
  }

  _makeSpawn() {
    const tx = clamp(WORLD_CONFIG.SPAWN_TX, 4, WORLD_CONFIG.WIDTH - 5);
    const ty = clamp(this.surface[tx] + 3, 3, WORLD_CONFIG.HEIGHT - WORLD_CONFIG.BEDROCK_ROWS - 3);
    return {
      x: (tx + 0.5) * WORLD_CONFIG.TILE_SIZE,
      y: (ty + 0.5) * WORLD_CONFIG.TILE_SIZE,
      tx,
      ty,
    };
  }

  _generateBaseTiles() {
    const tiles = new Array(WORLD_CONFIG.WIDTH * WORLD_CONFIG.HEIGHT);
    const seedPhase = hashSeed(this.seed) / UINT32_RANGE * Math.PI * 2;

    for (let ty = 0; ty < WORLD_CONFIG.HEIGHT; ty += 1) {
      for (let tx = 0; tx < WORLD_CONFIG.WIDTH; tx += 1) {
        const surfaceY = this.surface[tx];
        let tile;

        if (ty < surfaceY) {
          tile = createTile("air", 0, true);
        } else if (ty >= WORLD_CONFIG.HEIGHT - WORLD_CONFIG.BEDROCK_ROWS) {
          tile = createTile("bedrock", BEDROCK_HP, false);
        } else {
          const depth = ty - surfaceY;
          const difficulty = this._difficultyAt(tx, ty);
          const earthBoundary = 12 + Math.round(
            Math.sin(tx * 0.17 + seedPhase) * 1.75
            + Math.sin(tx * 0.053 - seedPhase * 0.7) * 1.25,
          );
          let kind;
          let baseHp;

          if (depth <= 2) {
            kind = "loam";
            baseHp = 1.5;
          } else if (depth <= earthBoundary) {
            kind = "dirt";
            baseHp = 3.5;
          } else if (difficulty < 0.62) {
            kind = "stone";
            baseHp = 10;
          } else {
            kind = "deepstone";
            baseHp = 22;
          }

          const difficultyScale = kind === "loam" || kind === "dirt" ? 0.75 : 1.65;
          const sectorHardness = Math.max(0.1, asFinite(this._sector?.modifiers?.hardness, 1));
          // The first 60% remains governed by ordinary geology. Below that,
          // planetary pressure rises smoothly to a 250 HP floor at bedrock.
          // A fresh pick cannot casually mine the bottom, while upgraded
          // lasers and the Solar Drill still tear through it quickly.
          const usableDepth = WORLD_CONFIG.HEIGHT - WORLD_CONFIG.BEDROCK_ROWS - surfaceY;
          const verticalProgress = clamp(depth / Math.max(1, usableDepth), 0, 1);
          const pressureT = clamp((verticalProgress - 0.6) / 0.4, 0, 1);
          const pressureEase = pressureT * pressureT * (3 - 2 * pressureT);
          const pressureFloorHp = 250 * pressureEase ** 1.35;
          const geologicalHp = baseHp * (1 + difficulty * difficultyScale);
          const maxHp = Math.max(1, Math.round(
            Math.max(geologicalHp, pressureFloorHp) * sectorHardness,
          ));
          tile = createTile(kind, maxHp, false);
        }

        tiles[this._index(tx, ty)] = tile;
      }
    }

    return tiles;
  }

  _installFinalSeal() {
    for (let tx = 0; tx < WORLD_CONFIG.WIDTH; tx += 1) {
      const tile = createTile("final_seal", FINAL_SEAL_HITS, true);
      tile.solarHits = 0;
      this.tiles[this._index(tx, FINAL_LAYER_TY)] = tile;
      if (this._oreRankByTile.length) this._oreRankByTile[this._index(tx, FINAL_LAYER_TY)] = -1;
    }
  }

  _difficultyAt(tx, ty) {
    const surfaceY = this.surface[clamp(Math.floor(tx), 0, WORLD_CONFIG.WIDTH - 1)] ?? WORLD_CONFIG.SURFACE_BASE;
    const usableDepth = WORLD_CONFIG.HEIGHT - WORLD_CONFIG.BEDROCK_ROWS - surfaceY;
    const depthProgress = clamp((ty - surfaceY) / Math.max(1, usableDepth), 0, 1);
    const spawnX = this._spawn.tx || WORLD_CONFIG.SPAWN_TX;
    const horizontalSpan = tx < spawnX ? Math.max(1, spawnX) : Math.max(1, WORLD_CONFIG.WIDTH - 1 - spawnX);
    const distanceProgress = clamp(Math.abs(tx - spawnX) / horizontalSpan, 0, 1);
    return clamp(depthProgress * 0.76 + distanceProgress * 0.08, 0, 1);
  }

  _canOreAppearAt(tx, ty, definition) {
    const tier = Math.max(0, Math.floor(numericField(
      definition?.source,
      ["tier"],
      Math.round((definition?.rank || 0) * Math.max(0, this._oreDefinitions.length - 1)),
    )));
    // T1-T4 can vary through the opening strata. T5+ must cross its authored
    // vertical depth, regardless of horizontal travel or placement fuzz.
    if (tier < 4) return true;
    const requiredDepth = numericField(definition?.source, ["minDepth", "depth"], null);
    if (!Number.isFinite(requiredDepth) || requiredDepth <= 1) return true;
    const column = clamp(Math.floor(tx), 0, WORLD_CONFIG.WIDTH - 1);
    const verticalDepth = Math.max(0, Math.floor(ty) - (this.surface[column] ?? WORLD_CONFIG.SURFACE_BASE));
    return verticalDepth * WORLD_CONFIG.TILE_SIZE + 0.001 >= requiredDepth;
  }

  _setAir(tx, ty, discovered = false) {
    if (!this._inBounds(tx, ty)) return;
    const tile = this.getTile(tx, ty);
    if (!tile || tile.kind === "bedrock") return;
    if (tile.oreId) this._removeOreFromIndex(tx, ty);
    tile.kind = "air";
    tile.hp = 0;
    tile.maxHp = 0;
    tile.oreId = null;
    tile.veinId = null;
    tile.discovered = tile.discovered || discovered;
    tile.cracked = 0;
    this._oreRankByTile[this._index(tx, ty)] = -1;
  }

  _carveEllipse(centerX, centerY, radiusX, radiusY, discovered = false, preserveCrust = true) {
    const minTx = Math.floor(centerX - radiusX);
    const maxTx = Math.ceil(centerX + radiusX);
    const minTy = Math.floor(centerY - radiusY);
    const maxTy = Math.ceil(centerY + radiusY);

    for (let ty = minTy; ty <= maxTy; ty += 1) {
      for (let tx = minTx; tx <= maxTx; tx += 1) {
        if (!this._inBounds(tx, ty)) continue;
        if (preserveCrust && ty <= this.surface[tx] + 1) continue;
        const nx = (tx - centerX) / Math.max(0.1, radiusX);
        const ny = (ty - centerY) / Math.max(0.1, radiusY);
        if (nx * nx + ny * ny <= 1) this._setAir(tx, ty, discovered);
      }
    }
  }

  _carveCaves() {
    const sectorCaves = Math.max(0.1, asFinite(this._sector?.modifiers?.caves, 1));
    const caveCount = Math.max(1, Math.round(WORLD_CONFIG.CAVE_COUNT * sectorCaves));
    for (let cave = 0; cave < caveCount; cave += 1) {
      let centerX = this._rng.range(3, WORLD_CONFIG.WIDTH - 4);
      const startSurface = this.surface[Math.floor(centerX)];
      let centerY = this._rng.range(startSurface + 6, WORLD_CONFIG.HEIGHT - WORLD_CONFIG.BEDROCK_ROWS - 3);
      let angle = this._rng.range(0, Math.PI * 2);
      const steps = this._rng.int(20, 72);

      for (let step = 0; step < steps; step += 1) {
        const radiusX = this._rng.range(1.1, 2.65);
        const radiusY = this._rng.range(0.85, 2.15);
        this._carveEllipse(centerX, centerY, radiusX, radiusY, false, true);

        angle += this._rng.range(-0.68, 0.68);
        centerX += Math.cos(angle) * this._rng.range(0.7, 1.5);
        centerY += Math.sin(angle) * this._rng.range(0.45, 1.15);
        centerX = clamp(centerX, 2, WORLD_CONFIG.WIDTH - 3);
        const localSurface = this.surface[Math.floor(centerX)];
        centerY = clamp(
          centerY,
          localSurface + 4,
          WORLD_CONFIG.HEIGHT - WORLD_CONFIG.BEDROCK_ROWS - 2,
        );
      }
    }
  }

  _carveSpawnChamber() {
    this._carveEllipse(this._spawn.tx, this._spawn.ty, 2.45, 1.9, true, false);
    this._setAir(this._spawn.tx, this._spawn.ty, true);
  }

  _prepareLiftStations() {
    this._liftStations = [];
    // Five metres per tile makes closely spaced stations useful even for the
    // first 5% lift rank: the first landing is 10 m down and stations repeat
    // every 10 m instead of jumping in coarse 25 m steps.
    const firstTy = this._spawn.ty + 2;
    const lastTy = WORLD_CONFIG.HEIGHT - WORLD_CONFIG.BEDROCK_ROWS - 4;
    const starter = this._oreDefinitions.reduce((best, current) => (
      !best || current.rank < best.rank ? current : best
    ), null);

    for (let ty = firstTy; ty <= lastTy; ty += 2) {
      const stationHash = hashSeed(`${this.seed}:lift:${ty}`);
      const offset = stationHash % 17 - 8;
      const tx = clamp(this._spawn.tx + offset, 5, WORLD_CONFIG.WIDTH - 6);
      if (ty <= this.surface[tx] + 3) continue;

      this._carveEllipse(tx, ty, 1.45, 1.15, true, false);
      this._setAir(tx, ty, true);
      this._revealAround(tx, ty, 2);
      const direction = stationHash & 1 ? 1 : -1;
      const target = this._ensureLiftTarget(tx, ty, direction, starter);
      if (!target) continue;

      const depthTiles = Math.max(0, ty - this._spawn.ty);
      const depth = depthTiles * WORLD_CONFIG.METERS_PER_TILE;
      this._liftStations.push({
        tx,
        ty,
        x: (tx + 0.5) * WORLD_CONFIG.TILE_SIZE,
        y: (ty + 0.5) * WORLD_CONFIG.TILE_SIZE,
        depth,
        depthTiles,
        requiredTier: this._requiredTierForStation(tx, ty),
        target,
      });
    }

    this._liftStations.sort((left, right) => (
      left.depth - right.depth || left.ty - right.ty || left.tx - right.tx
    ));
  }

  _ensureLiftTarget(centerX, centerY, direction, starter) {
    const targetX = centerX + (direction < 0 ? -2 : 2);
    const targetY = centerY;
    if (!this._inBounds(targetX, targetY)) return null;
    let tile = this.getTile(targetX, targetY);
    if (!tile || tile.kind === "bedrock") return null;

    if (tile.kind === "air") {
      const difficulty = this._difficultyAt(targetX, targetY);
      const kind = difficulty < 0.26 ? "dirt" : difficulty < 0.62 ? "stone" : "deepstone";
      const baseHp = kind === "dirt" ? 4 : kind === "stone" ? 12 : 25;
      tile = createTile(kind, Math.max(2, Math.round(baseHp * (1 + difficulty))), true);
      this.tiles[this._index(targetX, targetY)] = tile;
    }

    if (starter) this._applyOre(targetX, targetY, starter);
    tile.discovered = true;
    const easyHpCap = Math.max(3, Math.round(3 + this._difficultyAt(targetX, targetY) * 9));
    tile.maxHp = Math.min(tile.maxHp, easyHpCap);
    tile.hp = tile.maxHp;
    tile.cracked = 0;
    return {
      tx: targetX,
      ty: targetY,
      x: (targetX + 0.5) * WORLD_CONFIG.TILE_SIZE,
      y: (targetY + 0.5) * WORLD_CONFIG.TILE_SIZE,
      oreId: tile.oreId,
      maxHp: tile.maxHp,
      tier: starter ? Math.max(0, Math.floor(numericField(starter.source, ["tier"], 0))) : 0,
    };
  }

  _requiredTierForStation(tx, ty) {
    // Ore gates are authored from each column's local surface. Using distance
    // from the central spawn here could unlock a lift 20–35 m before the same
    // tier is actually allowed under a hill or depression.
    const column = clamp(Math.floor(tx), 0, WORLD_CONFIG.WIDTH - 1);
    const depthPixels = Math.max(0, ty - (this.surface[column] ?? WORLD_CONFIG.SURFACE_BASE))
      * WORLD_CONFIG.TILE_SIZE;
    const difficulty = this._difficultyAt(tx, ty);
    let requiredTier = 0;
    for (const definition of this._oreDefinitions) {
      const tier = Math.max(0, Math.floor(numericField(
        definition.source,
        ["tier"],
        Math.round(definition.rank * Math.max(0, this._oreDefinitions.length - 1)),
      )));
      const explicitDepth = numericField(definition.source, ["minDepth", "depth"], null);
      const isReached = Number.isFinite(explicitDepth)
        ? explicitDepth <= 1
          ? definition.minProgress <= difficulty + 0.025
          : explicitDepth <= depthPixels + WORLD_CONFIG.TILE_SIZE
        : definition.minProgress <= difficulty + 0.025;
      if (isReached) requiredTier = Math.max(requiredTier, tier);
    }
    return requiredTier;
  }

  _starterTargetNear(centerX, centerY) {
    let nearest = null;
    let nearestDistance = Infinity;
    for (let ty = centerY - 8; ty <= centerY + 8; ty += 1) {
      for (let tx = centerX - 8; tx <= centerX + 8; tx += 1) {
        const tile = this.getTile(tx, ty);
        if (!tile?.oreId || tile.kind === "air" || tile.kind === "bedrock") continue;
        const distance = (tx - centerX) ** 2 + (ty - centerY) ** 2;
        if (
          distance < nearestDistance
          || (distance === nearestDistance && nearest && (ty < nearest.ty || (ty === nearest.ty && tx < nearest.tx)))
        ) {
          nearestDistance = distance;
          nearest = {
            tx,
            ty,
            x: (tx + 0.5) * WORLD_CONFIG.TILE_SIZE,
            y: (ty + 0.5) * WORLD_CONFIG.TILE_SIZE,
            oreId: tile.oreId,
            maxHp: tile.maxHp,
          };
        }
      }
    }
    return nearest;
  }

  _normalizeOreTypes() {
    const values = this.oreTypes.map((ore, index) => numericField(ore, ["tier", "value", "baseValue", "price"], index));
    const rankedValues = [...new Set(values.filter(Number.isFinite))].sort((a, b) => a - b);

    return this.oreTypes.map((source, index) => {
      const value = values[index];
      const valueRank = Number.isFinite(value) && rankedValues.length > 1
        ? rankedValues.indexOf(value) / (rankedValues.length - 1)
        : this.oreTypes.length > 1
          ? index / (this.oreTypes.length - 1)
          : 0;
      const explicitDifficulty = numericField(source, ["minDifficulty", "minProgress"], null);
      const minDepth = numericField(source, ["minDepth", "depth"], null);
      let minProgress = explicitDifficulty;

      if (!Number.isFinite(minProgress) && Number.isFinite(minDepth)) {
        minProgress = minDepth <= 1
          ? minDepth * 0.76
          : (minDepth / Math.max(
            1,
            (WORLD_CONFIG.HEIGHT - WORLD_CONFIG.SURFACE_BASE - WORLD_CONFIG.BEDROCK_ROWS)
              * WORLD_CONFIG.TILE_SIZE,
          )) * 0.76;
      }
      if (!Number.isFinite(minProgress)) minProgress = Math.max(0, valueRank * 0.78 - 0.05);

      const explicitMax = numericField(source, ["maxDifficulty", "maxProgress", "maxDepth"], null);
      let maxProgress = 1;
      if (Number.isFinite(explicitMax)) {
        maxProgress = explicitMax <= 1
          ? explicitMax
          : explicitMax / Math.max(
            1,
            (WORLD_CONFIG.HEIGHT - WORLD_CONFIG.SURFACE_BASE - WORLD_CONFIG.BEDROCK_ROWS)
              * WORLD_CONFIG.TILE_SIZE,
          );
      }

      return {
        source,
        id: getOreId(source, index),
        rank: valueRank,
        minProgress: clamp(minProgress, 0, 1),
        maxProgress: clamp(maxProgress, 0, 1),
      };
    });
  }

  _oreBasePropensity(definition) {
    const explicit = numericField(definition.source, ["veinCount", "veins", "clusters"], null);
    if (Number.isFinite(explicit)) return Math.max(0, explicit);

    let multiplier = 1;
    const abundance = numericField(definition.source, ["frequency", "abundance", "spawnRate", "density"], null);
    const rarity = numericField(definition.source, ["rarity"], null);
    if (Number.isFinite(abundance)) {
      multiplier = abundance <= 1 ? 0.4 + abundance * 1.5 : clamp(abundance, 0.2, 3);
    } else if (Number.isFinite(rarity) && rarity > 0) {
      multiplier = rarity <= 1 ? 0.35 + rarity : 1 / Math.sqrt(rarity);
    }

    return 54 * WORLD_DENSITY_SCALE / (1 + definition.rank * 1.8) * multiplier;
  }

  _oreVeinSizeRange(definition) {
    const source = definition.source;
    const fixed = numericField(source, ["veinSize", "clusterSize"], null);
    const fallback = Math.max(2, Math.round(7 - definition.rank * 3));
    const min = Math.max(1, Math.round(numericField(source, ["veinMin", "minVeinSize"], fixed ?? fallback - 2)));
    const max = Math.max(min, Math.round(numericField(source, ["veinMax", "maxVeinSize"], fixed ?? fallback + 2)));
    return { min, max };
  }

  _oreExpectedVeinSize(definition) {
    const { min, max } = this._oreVeinSizeRange(definition);
    const sectorVeins = Math.max(0.1, asFinite(this._sector?.modifiers?.veins, 1));
    let total = 0;
    for (let size = min; size <= max; size += 1) {
      total += Math.max(1, Math.round(size * sectorVeins));
    }
    return total / Math.max(1, max - min + 1);
  }

  _oreRawCompositionWeight(definition) {
    const bias = this._sector?.oreBias;
    if (!bias?.id) return 1;
    return definition.id === bias.id ? Math.max(1, asFinite(bias.strength, 1)) : 1;
  }

  _calculateOreCompositionNormalizer() {
    if (!this._sector?.oreBias?.id || !this._oreDefinitions.length) return 1;
    // Early ores form larger veins than late ores. Normalize by expected tile
    // count so a composition bias redistributes the same node budget instead
    // of silently adding nodes for copper or removing them for deep ores.
    let baseTotal = 0;
    let weightedTotal = 0;
    for (const definition of this._oreDefinitions) {
      const propensity = this._oreBasePropensity(definition);
      const expectedNodesPerVein = this._oreExpectedVeinSize(definition);
      baseTotal += propensity * expectedNodesPerVein;
      weightedTotal += propensity * this._oreRawCompositionWeight(definition) * expectedNodesPerVein;
    }
    return weightedTotal > 0 ? baseTotal / weightedTotal : 1;
  }

  _oreCompositionMultiplier(definition) {
    return this._oreRawCompositionWeight(definition) * this._oreCompositionNormalizer;
  }

  _oreVeinCount(definition) {
    const explicit = numericField(definition.source, ["veinCount", "veins", "clusters"], null);
    const sectorAbundance = Math.max(0, asFinite(this._sector?.modifiers?.abundance, 1));
    const composition = this._oreCompositionMultiplier(definition);
    const base = this._oreBasePropensity(definition);
    if (Number.isFinite(explicit)) {
      return Math.max(0, Math.round(base * sectorAbundance * composition));
    }
    return clamp(Math.round(base * sectorAbundance * composition), 3, 120);
  }

  _oreVeinSize(definition) {
    const { min, max } = this._oreVeinSizeRange(definition);
    const sectorVeins = Math.max(0.1, asFinite(this._sector?.modifiers?.veins, 1));
    return Math.max(1, Math.round(this._rng.int(min, max) * sectorVeins));
  }

  _frontierReserveOrigin(definition) {
    if (!FRONTIER_RESERVE_ORE_IDS.has(definition?.id)) return null;
    const authoredDepth = numericField(definition.source, ["minDepth", "depth"], null);
    if (!Number.isFinite(authoredDepth) || authoredDepth <= 1) return null;

    const left = clamp(this._spawn.tx - FRONTIER_RESERVE_HALF_WIDTH, 2, WORLD_CONFIG.WIDTH - 3);
    const right = clamp(this._spawn.tx + FRONTIER_RESERVE_HALF_WIDTH, left, WORLD_CONFIG.WIDTH - 3);
    const minimumDepthRows = Math.ceil(authoredDepth / WORLD_CONFIG.TILE_SIZE);
    const bottom = WORLD_CONFIG.HEIGHT - WORLD_CONFIG.BEDROCK_ROWS - 1;
    const accepts = (tx, ty) => {
      const tile = this.getTile(tx, ty);
      if (!tile || tile.kind === "air" || tile.kind === "bedrock") return false;
      if (!this._canOreAppearAt(tx, ty, definition)) return false;
      const progress = this._difficultyAt(tx, ty);
      return progress >= definition.minProgress && progress <= definition.maxProgress;
    };

    // Keep the reserve procedural inside a narrow descent corridor. The
    // deterministic scan is only a cave-safe fallback for unusually hollow
    // seeds; it still consumes the same one-vein budget below.
    for (let attempt = 0; attempt < 48; attempt += 1) {
      const tx = this._rng.int(left, right);
      const localSurface = this.surface[tx] ?? WORLD_CONFIG.SURFACE_BASE;
      const minTy = clamp(localSurface + minimumDepthRows, localSurface + 1, bottom);
      const maxTy = clamp(minTy + FRONTIER_RESERVE_DEPTH_ROWS, minTy, bottom);
      const ty = this._rng.int(minTy, maxTy);
      if (accepts(tx, ty)) return { tx, ty };
    }

    for (let tx = left; tx <= right; tx += 1) {
      const localSurface = this.surface[tx] ?? WORLD_CONFIG.SURFACE_BASE;
      const minTy = clamp(localSurface + minimumDepthRows, localSurface + 1, bottom);
      const maxTy = clamp(minTy + FRONTIER_RESERVE_DEPTH_ROWS, minTy, bottom);
      for (let ty = minTy; ty <= maxTy; ty += 1) {
        if (accepts(tx, ty)) return { tx, ty };
      }
    }
    return null;
  }

  _generateOreVeins() {
    for (const definition of this._oreDefinitions) {
      const targetVeins = this._oreVeinCount(definition);
      let placedVeins = 0;
      let attempts = 0;
      const maxAttempts = Math.max(80, targetVeins * 36);

      // One ordinary amber/gold vein is placed near the depth where its tier
      // first matters. It replaces one random origin from the existing budget:
      // vein count, rolled size and ore durability are otherwise unchanged.
      if (targetVeins > 0) {
        const reserveOrigin = this._frontierReserveOrigin(definition);
        if (reserveOrigin) {
          const placed = this._placeVein(
            reserveOrigin.tx,
            reserveOrigin.ty,
            definition,
            this._oreVeinSize(definition),
          );
          if (placed > 0) placedVeins += 1;
        }
      }

      while (placedVeins < targetVeins && attempts < maxAttempts) {
        attempts += 1;
        const tx = this._rng.int(2, WORLD_CONFIG.WIDTH - 3);
        const minY = Math.min(
          WORLD_CONFIG.HEIGHT - WORLD_CONFIG.BEDROCK_ROWS - 2,
          this.surface[tx] + 2,
        );
        const ty = this._rng.int(minY, WORLD_CONFIG.HEIGHT - WORLD_CONFIG.BEDROCK_ROWS - 1);
        const tile = this.getTile(tx, ty);
        if (!tile || tile.kind === "air" || tile.kind === "bedrock") continue;
        if (!this._canOreAppearAt(tx, ty, definition)) continue;

        const progress = this._difficultyAt(tx, ty);
        if (progress + this._rng.range(-0.025, 0.045) < definition.minProgress) continue;
        if (progress - this._rng.range(0, 0.08) > definition.maxProgress) continue;

        const placed = this._placeVein(tx, ty, definition, this._oreVeinSize(definition));
        if (placed > 0) placedVeins += 1;
      }
    }
  }

  _placeVein(originX, originY, definition, size) {
    const veinId = `${definition.id}:${this._nextVeinId++}`;
    const targetSize = Math.max(0, Math.floor(Number(size) || 0));
    const placedCells = new Set();
    const rankValue = Math.round(definition.rank * 10_000);
    let tx = originX;
    let ty = originY;
    let placed = 0;
    let attempts = 0;
    const maxAttempts = Math.max(24, targetSize * 8);

    const tryPlace = (candidateX, candidateY) => {
      const key = `${candidateX}:${candidateY}`;
      if (placedCells.has(key)) return false;

      const tile = this.getTile(candidateX, candidateY);
      if (!tile || tile.kind === "air" || tile.kind === "bedrock") return false;
      if (!this._canOreAppearAt(candidateX, candidateY, definition)) return false;

      const index = this._index(candidateX, candidateY);
      const currentRank = this._oreRankByTile[index];
      if (tile.oreId !== null && currentRank > rankValue) return false;
      if (!this._applyOre(candidateX, candidateY, definition, veinId)) return false;

      placedCells.add(key);
      placed += 1;
      return true;
    };

    while (placed < targetSize && attempts < maxAttempts) {
      attempts += 1;
      tryPlace(tx, ty);

      if (this._rng.next() < 0.28) {
        tx += Math.sign(originX - tx);
        ty += Math.sign(originY - ty);
      } else if (this._rng.next() < 0.56) {
        tx += this._rng.next() < 0.5 ? -1 : 1;
      } else {
        ty += this._rng.next() < 0.5 ? -1 : 1;
      }
      tx = clamp(tx, 1, WORLD_CONFIG.WIDTH - 2);
      ty = clamp(ty, this.surface[tx] + 1, WORLD_CONFIG.HEIGHT - WORLD_CONFIG.BEDROCK_ROWS - 1);
    }

    // A random walk can repeatedly revisit the same coordinate or get trapped
    // against a cave. Finish the small vein with a bounded, deterministic scan
    // around its origin so duplicate visits never masquerade as placed cells.
    const maxFallbackRadius = Math.min(14, Math.max(3, Math.ceil(Math.sqrt(targetSize)) * 3));
    const maxFallbackChecks = Math.max(80, targetSize * 32);
    let fallbackChecks = 0;

    for (let radius = 1;
      placed < targetSize && radius <= maxFallbackRadius && fallbackChecks < maxFallbackChecks;
      radius += 1) {
      for (let offsetY = -radius;
        placed < targetSize && offsetY <= radius && fallbackChecks < maxFallbackChecks;
        offsetY += 1) {
        const offsetX = radius - Math.abs(offsetY);
        const candidates = offsetX === 0
          ? [[originX, originY + offsetY]]
          : [
            [originX - offsetX, originY + offsetY],
            [originX + offsetX, originY + offsetY],
          ];

        for (const [candidateX, candidateY] of candidates) {
          if (placed >= targetSize || fallbackChecks >= maxFallbackChecks) break;
          fallbackChecks += 1;
          tryPlace(candidateX, candidateY);
        }
      }
    }

    return placed;
  }

  _applyOre(tx, ty, definition, veinId = null) {
    const tile = this.getTile(tx, ty);
    if (!tile || tile.kind === "air" || tile.kind === "bedrock") return false;

    const source = definition.source;
    const progress = this._difficultyAt(tx, ty);
    const hardness = numericField(source, ["hardness"], null);
    const absoluteHp = numericField(source, ["hp", "maxHp", "hitPoints"], null);
    const density = numericField(source, ["oreDensity"], null);
    // Veins may cross. Always derive ore durability from the underlying rock,
    // never from a previously applied ore multiplier, or an overlap can create
    // effectively indestructible blocks with exponentially compounded HP.
    const terrainMaxHp = Math.max(1, Number(tile.terrainMaxHp) || Number(tile.maxHp) || 1);
    let targetHp;

    if (Number.isFinite(absoluteHp) && absoluteHp > 0) {
      const sectorHardness = Math.max(0.1, asFinite(this._sector?.modifiers?.hardness, 1));
      targetHp = Math.max(terrainMaxHp, absoluteHp * (1 + progress * 0.4) * sectorHardness);
    } else {
      const hardnessMultiplier = Number.isFinite(hardness) && hardness > 0
        ? hardness
        : 1.15 + definition.rank * 0.85;
      const densityMultiplier = Number.isFinite(density) && density > 0
        ? clamp(density, 0.4, 4)
        : 1;
      targetHp = terrainMaxHp * hardnessMultiplier * densityMultiplier;
    }

    const existingVeinId = tile.oreId === definition.id ? tile.veinId : null;
    tile.oreId = definition.id;
    tile.veinId = veinId || existingVeinId || `${definition.id}:single:${tx}:${ty}`;
    tile.maxHp = Math.max(1, Math.round(targetHp));
    tile.hp = tile.maxHp;
    tile.cracked = 0;
    this._oreRankByTile[this._index(tx, ty)] = Math.round(definition.rank * 10_000);
    this._addOreToIndex(tx, ty);
    return true;
  }

  _placeStarterOre() {
    const rankedDefinitions = [...this._oreDefinitions].sort((left, right) => left.rank - right.rank);
    const copper = rankedDefinitions.find((definition) => definition.id === "copper")
      || rankedDefinitions[0];
    const coal = rankedDefinitions.find((definition) => definition.id === "coal")
      || rankedDefinitions[1]
      || copper;
    if (!copper) return;

    const placeSoftOre = (offsetY, definition, hp) => {
      const tx = this._spawn.tx;
      const ty = this._spawn.ty + offsetY;
      const current = this.getTile(tx, ty);
      if (!current || current.kind === "bedrock" || !definition) return false;

      // Caves are generated first and can occasionally erase the intended
      // opening seam. Rebuild these three cells as soft loam so every seed and
      // every geological sector starts with the same small, reachable payout.
      const tile = createTile("loam", hp, true);
      this.tiles[this._index(tx, ty)] = tile;
      this._oreRankByTile[this._index(tx, ty)] = -1;
      if (!this._applyOre(tx, ty, definition)) return false;
      tile.maxHp = hp;
      tile.hp = hp;
      tile.discovered = true;
      tile.cracked = 0;
      return true;
    };

    // The first copper is visible from the spawn chamber. Once it opens, the
    // miner is close enough to smell the coal and then the second copper. The
    // fixed HP caps keep this useful inside the initial six-second shift.
    placeSoftOre(2, copper, 2);
    placeSoftOre(3, coal, 4);
    placeSoftOre(4, copper, 3);

    const offsets = [
      [-2, 4],
      [2, 5],
      [0, 7],
    ];

    for (const [offsetX, offsetY] of offsets) {
      const targetX = this._spawn.tx + offsetX;
      const targetY = this._spawn.ty + offsetY;
      const candidate = this._nearestSolidTile(targetX, targetY, 2);
      if (candidate) this._applyOre(candidate.tx, candidate.ty, copper);
    }
  }

  _nearestSolidTile(originX, originY, radius) {
    let nearest = null;
    let nearestDistance = Infinity;

    for (let ty = originY - radius; ty <= originY + radius; ty += 1) {
      for (let tx = originX - radius; tx <= originX + radius; tx += 1) {
        const tile = this.getTile(tx, ty);
        if (!tile || tile.kind === "air" || tile.kind === "bedrock") continue;
        const distance = (tx - originX) ** 2 + (ty - originY) ** 2;
        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearest = { tx, ty };
        }
      }
    }

    return nearest;
  }

  _isDamageable(tile) {
    return Boolean(
      tile
      && tile.kind !== "air"
      && tile.kind !== "bedrock"
      && tile.kind !== "final_seal"
      && tile.maxHp > 0
    );
  }

  _damageCandidates(candidates, damage, onBreak, options = {}) {
    const broken = [];
    const damageMultiplier = typeof options.damageMultiplier === "function"
      ? options.damageMultiplier
      : null;
    for (const candidate of candidates) {
      const tile = this.getTile(candidate.tx, candidate.ty);
      if (!this._isDamageable(tile)) continue;
      const multiplier = damageMultiplier
        ? Math.max(0, asFinite(damageMultiplier(tile, candidate.tx, candidate.ty), 1))
        : 1;
      const appliedDamage = damage * multiplier;
      if (appliedDamage <= 0) continue;
      tile.discovered = true;
      tile.hp = Math.max(0, tile.hp - appliedDamage);
      tile.cracked = clamp(1 - tile.hp / tile.maxHp, 0, 1);
      if (tile.hp <= 0) {
        const result = this.breakTile(candidate.tx, candidate.ty, onBreak);
        if (result) broken.push(result);
      }
    }
    return broken;
  }

  _revealAround(centerX, centerY, radius) {
    const radiusSquared = radius * radius;
    for (let ty = centerY - radius; ty <= centerY + radius; ty += 1) {
      for (let tx = centerX - radius; tx <= centerX + radius; tx += 1) {
        if ((tx - centerX) ** 2 + (ty - centerY) ** 2 > radiusSquared) continue;
        const tile = this.getTile(tx, ty);
        if (tile) tile.discovered = true;
      }
    }
  }
}

window.DepthZeroWorld = Object.freeze({
  WORLD_CONFIG,
  FINAL_LAYER_TY,
  FINAL_SEAL_HITS,
  GEOLOGICAL_SECTORS,
  UNDERGROUND_EVENT_TYPES,
  GLOBAL_EVENT_TYPES,
  FIELD_EVENT_TYPES,
  createRandomGeologyProfile,
  getSectorChoices,
  MineWorld,
});
})();
