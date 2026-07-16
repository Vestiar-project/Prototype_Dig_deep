(() => {
"use strict";

const WORLD_CONFIG = Object.freeze({
  TILE_SIZE: 28,
  WIDTH: 240,
  HEIGHT: 90,
  SURFACE_BASE: 9,
  SURFACE_VARIANCE: 4,
  SPAWN_TX: 36,
  BEDROCK_ROWS: 2,
  CAVE_COUNT: 44,
});

const DEFAULT_SEED = "deep-shift";
const UINT32_RANGE = 0x100000000;
const BEDROCK_HP = 1_000_000_000;

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
    oreId: null,
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

/**
 * Procedurally generated side-view mine. All world-space arguments are pixels.
 * The module deliberately has no browser or DOM dependencies.
 */
class MineWorld {
  constructor(oreTypes = [], seed = DEFAULT_SEED) {
    this.oreTypes = Array.isArray(oreTypes) ? [...oreTypes] : [];
    this.seed = seed ?? DEFAULT_SEED;
    this.tiles = [];
    this.surface = [];
    this._oreDefinitions = [];
    this._oreRankByTile = new Int16Array(0);
    this._spawn = { x: 0, y: 0, tx: 0, ty: 0 };
    this.reset(this.seed);
  }

  reset(seed = this.seed) {
    this.seed = seed ?? DEFAULT_SEED;
    this._rng = new SeededRandom(this.seed);
    this.surface = this._generateSurface();
    this._spawn = this._makeSpawn();
    this.tiles = this._generateBaseTiles();
    this._oreRankByTile = new Int16Array(WORLD_CONFIG.WIDTH * WORLD_CONFIG.HEIGHT);
    this._oreRankByTile.fill(-1);
    this._oreDefinitions = this._normalizeOreTypes();

    this._carveCaves();
    this._carveSpawnChamber();
    this._generateOreVeins();
    this._placeStarterOre();
    this._revealAround(this._spawn.tx, this._spawn.ty, 6);
    return this;
  }

  getTile(tx, ty) {
    const tileX = Math.floor(tx);
    const tileY = Math.floor(ty);
    if (!this._inBounds(tileX, tileY)) return null;
    return this.tiles[this._index(tileX, tileY)] ?? null;
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

  damageRay(x, y, dx, dy, range, damage, width = WORLD_CONFIG.TILE_SIZE * 0.6, onBreak) {
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
    return this._damageCandidates(candidates, amount, onBreak);
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
    tile.kind = "air";
    tile.hp = 0;
    tile.maxHp = 0;
    tile.oreId = null;
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

  _inBounds(tx, ty) {
    return tx >= 0 && tx < WORLD_CONFIG.WIDTH && ty >= 0 && ty < WORLD_CONFIG.HEIGHT;
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
          const maxHp = Math.max(1, Math.round(baseHp * (1 + difficulty * difficultyScale)));
          tile = createTile(kind, maxHp, false);
        }

        tiles[this._index(tx, ty)] = tile;
      }
    }

    return tiles;
  }

  _difficultyAt(tx, ty) {
    const surfaceY = this.surface[clamp(Math.floor(tx), 0, WORLD_CONFIG.WIDTH - 1)] ?? WORLD_CONFIG.SURFACE_BASE;
    const usableDepth = WORLD_CONFIG.HEIGHT - WORLD_CONFIG.BEDROCK_ROWS - surfaceY;
    const depthProgress = clamp((ty - surfaceY) / Math.max(1, usableDepth), 0, 1);
    const spawnX = this._spawn.tx || WORLD_CONFIG.SPAWN_TX;
    const horizontalSpan = tx < spawnX ? Math.max(1, spawnX) : Math.max(1, WORLD_CONFIG.WIDTH - 1 - spawnX);
    const distanceProgress = clamp(Math.abs(tx - spawnX) / horizontalSpan, 0, 1);
    return clamp(depthProgress * 0.76 + distanceProgress * 0.34, 0, 1);
  }

  _setAir(tx, ty, discovered = false) {
    if (!this._inBounds(tx, ty)) return;
    const tile = this.getTile(tx, ty);
    if (!tile || tile.kind === "bedrock") return;
    tile.kind = "air";
    tile.hp = 0;
    tile.maxHp = 0;
    tile.oreId = null;
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
    for (let cave = 0; cave < WORLD_CONFIG.CAVE_COUNT; cave += 1) {
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

  _oreVeinCount(definition) {
    const explicit = numericField(definition.source, ["veinCount", "veins", "clusters"], null);
    if (Number.isFinite(explicit)) return Math.max(0, Math.round(explicit));

    let multiplier = 1;
    const abundance = numericField(definition.source, ["frequency", "abundance", "spawnRate", "density"], null);
    const rarity = numericField(definition.source, ["rarity"], null);
    if (Number.isFinite(abundance)) {
      multiplier = abundance <= 1 ? 0.4 + abundance * 1.5 : clamp(abundance, 0.2, 3);
    } else if (Number.isFinite(rarity) && rarity > 0) {
      multiplier = rarity <= 1 ? 0.35 + rarity : 1 / Math.sqrt(rarity);
    }

    const base = 54 / (1 + definition.rank * 1.8);
    return clamp(Math.round(base * multiplier), 3, 90);
  }

  _oreVeinSize(definition) {
    const source = definition.source;
    const fixed = numericField(source, ["veinSize", "clusterSize"], null);
    const fallback = Math.max(2, Math.round(7 - definition.rank * 3));
    const min = Math.max(1, Math.round(numericField(source, ["veinMin", "minVeinSize"], fixed ?? fallback - 2)));
    const max = Math.max(min, Math.round(numericField(source, ["veinMax", "maxVeinSize"], fixed ?? fallback + 2)));
    return this._rng.int(min, max);
  }

  _generateOreVeins() {
    for (const definition of this._oreDefinitions) {
      const targetVeins = this._oreVeinCount(definition);
      let placedVeins = 0;
      let attempts = 0;
      const maxAttempts = Math.max(80, targetVeins * 36);

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

        const progress = this._difficultyAt(tx, ty);
        if (progress + this._rng.range(-0.04, 0.13) < definition.minProgress) continue;
        if (progress - this._rng.range(0, 0.08) > definition.maxProgress) continue;

        this._placeVein(tx, ty, definition, this._oreVeinSize(definition));
        placedVeins += 1;
      }
    }
  }

  _placeVein(originX, originY, definition, size) {
    let tx = originX;
    let ty = originY;
    let placed = 0;
    let attempts = 0;
    const maxAttempts = Math.max(12, size * 5);

    while (placed < size && attempts < maxAttempts) {
      attempts += 1;
      const tile = this.getTile(tx, ty);
      if (tile && tile.kind !== "air" && tile.kind !== "bedrock") {
        const index = this._index(tx, ty);
        const currentRank = this._oreRankByTile[index];
        const rankValue = Math.round(definition.rank * 10_000);
        if (tile.oreId === null || currentRank <= rankValue) {
          this._applyOre(tx, ty, definition);
          placed += 1;
        }
      }

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
  }

  _applyOre(tx, ty, definition) {
    const tile = this.getTile(tx, ty);
    if (!tile || tile.kind === "air" || tile.kind === "bedrock") return false;

    const source = definition.source;
    const progress = this._difficultyAt(tx, ty);
    const hardness = numericField(source, ["hardness"], null);
    const absoluteHp = numericField(source, ["hp", "maxHp", "hitPoints"], null);
    const density = numericField(source, ["oreDensity"], null);
    let targetHp;

    if (Number.isFinite(absoluteHp) && absoluteHp > 0) {
      targetHp = Math.max(tile.maxHp, absoluteHp * (1 + progress * 0.4));
    } else {
      const hardnessMultiplier = Number.isFinite(hardness) && hardness > 0
        ? hardness
        : 1.15 + definition.rank * 0.85;
      const densityMultiplier = Number.isFinite(density) && density > 0
        ? clamp(density, 0.4, 4)
        : 1;
      targetHp = tile.maxHp * hardnessMultiplier * densityMultiplier;
    }

    tile.oreId = definition.id;
    tile.maxHp = Math.max(1, Math.round(targetHp));
    tile.hp = tile.maxHp;
    tile.cracked = 0;
    this._oreRankByTile[this._index(tx, ty)] = Math.round(definition.rank * 10_000);
    return true;
  }

  _placeStarterOre() {
    const starter = this._oreDefinitions.reduce((best, current) => (
      !best || current.rank < best.rank ? current : best
    ), null);
    if (!starter) return;

    // Every 6-second opening run needs an immediately readable goal. Keep a
    // small, soft starter seam exactly two tiles below the spawn chamber; the
    // rest of the mine remains fully procedural.
    const starterX = this._spawn.tx;
    const starterY = this._spawn.ty + 2;
    let guaranteedTile = this.getTile(starterX, starterY);
    if (guaranteedTile && guaranteedTile.kind === "air") {
      guaranteedTile = createTile("loam", 2, true);
      this.tiles[this._index(starterX, starterY)] = guaranteedTile;
    }
    if (guaranteedTile && guaranteedTile.kind !== "bedrock") {
      guaranteedTile.discovered = true;
      this._applyOre(starterX, starterY, starter);
      guaranteedTile.maxHp = Math.min(guaranteedTile.maxHp, 2);
      guaranteedTile.hp = guaranteedTile.maxHp;
    }

    const offsets = [
      [4, 0],
      [3, 2],
      [-4, 1],
      [0, 4],
    ];

    for (const [offsetX, offsetY] of offsets) {
      const targetX = this._spawn.tx + offsetX;
      const targetY = this._spawn.ty + offsetY;
      const candidate = this._nearestSolidTile(targetX, targetY, 2);
      if (candidate) this._applyOre(candidate.tx, candidate.ty, starter);
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
    return Boolean(tile && tile.kind !== "air" && tile.kind !== "bedrock" && tile.maxHp > 0);
  }

  _damageCandidates(candidates, damage, onBreak) {
    const broken = [];
    for (const candidate of candidates) {
      const tile = this.getTile(candidate.tx, candidate.ty);
      if (!this._isDamageable(tile)) continue;
      tile.discovered = true;
      tile.hp = Math.max(0, tile.hp - damage);
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
  MineWorld,
});
})();
