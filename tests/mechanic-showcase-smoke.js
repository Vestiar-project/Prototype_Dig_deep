"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const harness = require("./helpers/runtime-harness.js");
const { localData } = harness;
let api = harness.api;
const saveKey = "depth-zero-save-v1";
const modulePath = require.resolve(path.join(__dirname, "..", "js", "game.js"));
const definitions = global.DepthZeroUpgrades.UPGRADE_DEFS;

function reload() {
  delete require.cache[modulePath];
  require(modulePath);
  api = global.__DEPTH_ZERO__;
}

function buyNewMechanic(id, key, retained = []) {
  api.debugResetProgress();
  const prepare = (targetId) => {
    const definition = definitions.find((entry) => entry.id === targetId);
    for (const requirement of definition.requires || []) {
      const parentId = typeof requirement === "string" ? requirement : requirement.id;
      const rank = typeof requirement === "string" ? 1 : requirement.level || 1;
      prepare(parentId);
      const current = api.getUpgradeCatalog().find((entry) => entry.id === parentId).level;
      api.setUpgradeLevel(parentId, Math.max(current, rank));
    }
  };
  prepare(id);
  api.setBestDepth(2000);
  for (const ore of global.DepthZeroUpgrades.ORE_TYPES) api.grantOre(ore.id, 1_000_000);
  api.openUpgrades();
  assert.equal(api.buyUpgrade(id), true, `${id} must be bought through the normal purchase path`);
  assert.equal(JSON.parse(localData.get(saveKey)).pendingShowcases[key], true);
  assert.equal(api.debugGetMechanicShowcase().active, null, "a purchase alone must not show a trigger");
  // Isolate the purchased mechanic from its prerequisite effects. Ownership
  // and pending state still come from the real purchase, not a trigger stub.
  const keep = new Set([id, ...retained]);
  for (const entry of api.getUpgradeCatalog()) {
    if (entry.level && !keep.has(entry.id)) api.setUpgradeLevel(entry.id, 0);
  }
  api.setBestDepth(0);
}

function clearArena() {
  api.debugSetPlayerTile(40, 20);
  for (let ty = 12; ty <= 28; ty += 1) {
    for (let tx = 32; tx <= 50; tx += 1) {
      api.debugPatchTile(tx, ty, { kind: "air", hp: 0, maxHp: 0, oreId: null, veinId: null, discovered: true });
    }
  }
}

function ore(tx, ty, hp = 1000) {
  api.debugPatchTile(tx, ty, { kind: "stone", hp, maxHp: hp, oreId: "copper", veinId: "showcase-vein", discovered: true });
}

buyNewMechanic("gadgets_chain_spark", "chain");
const chainPurchase = JSON.parse(localData.get(saveKey));
reload();
assert.equal(api.debugGetMechanicShowcase().pending.chain, true, "an unused purchase survives reload");
api.startRun({ seed: "showcase-no-chain-target", sectorId: "stable_strata" });
clearArena();
api.debugForceChain();
assert.equal(api.debugGetMechanicShowcase().active, null, "an empty proc must not claim a successful chain");
api.finishRun();
reload();
assert.equal(api.debugGetMechanicShowcase().pending.chain, true, "a shift with no trigger keeps the showcase pending");

api.startRun({ seed: "showcase-real-chain", sectorId: "stable_strata" });
clearArena();
ore(42, 20);
api.debugForceChain();
assert.ok(api.debugGetTile(42, 20).hp < 1000, "the real chain must damage its ore target");
assert.equal(api.debugGetMechanicShowcase().active?.key, "chain");
assert.equal(api.debugGetMechanicShowcase().active.remaining, 1.8);
assert.equal(JSON.parse(localData.get(saveKey)).pendingShowcases.chain, false);
api.debugForceChain();
assert.equal(api.debugGetMechanicShowcase().queued.length, 0, "a repeated chain must not queue another message");
api.debugSetAttackCooldown(10);
api.stepRun(2);
assert.equal(api.debugGetMechanicShowcase().active, null, "the message expires after its short display");
api.debugForceChain();
assert.equal(api.debugGetMechanicShowcase().active, null, "later hits do not repeat it");
api.finishRun();
reload();
api.startRun({ seed: "showcase-chain-already-seen" });
clearArena();
ore(42, 20);
api.debugForceChain();
assert.equal(api.debugGetMechanicShowcase().active, null, "already shown remains consumed across reload and shifts");
api.finishRun();

buyNewMechanic("tools_mirror_crystal", "ricochet", ["tools_laser_emitter"]);
const ricochetSave = JSON.parse(localData.get(saveKey));

function runRicochetCase(showcase) {
  const fixture = structuredClone(ricochetSave);
  fixture.pendingShowcases.ricochet = showcase;
  localData.set(saveKey, JSON.stringify(fixture));
  reload();
  api.startRun({ seed: "showcase-ricochet-comparison", sectorId: "stable_strata" });
  clearArena();
  ore(41, 20);
  ore(43, 20);
  // Zero damage can still draw a ricochet beam. Only a hit may consume this.
  api.debugFireRicochetFrom(41, 20, 0);
  assert.equal(api.debugGetMechanicShowcase().active, null);
  assert.equal(api.debugGetMechanicShowcase().pending.ricochet, showcase);
  let randomCalls = 0;
  const previousRandom = Math.random;
  Math.random = () => { randomCalls += 1; return 0.999999; };
  try {
    api.debugFireRicochetFrom(41, 20, 10);
  } finally {
    Math.random = previousRandom;
  }
  const snapshot = api.getSnapshot();
  assert.ok(api.debugGetTile(43, 20).hp < 1000);
  assert.equal(api.debugGetMechanicShowcase().active?.key || null, showcase ? "ricochet" : null);
  const result = {
    hp: api.debugGetTile(43, 20).hp,
    randomCalls,
    metrics: snapshot.metrics,
    stats: api.getStats(),
    runOre: snapshot.runOre,
    player: snapshot.player,
    visualEffects: snapshot.visualEffects,
  };
  api.finishRun();
  return result;
}
assert.deepEqual(runRicochetCase(true), runRicochetCase(false), "showcase must not affect damage, yield, RNG, movement, stats or existing effects");

buyNewMechanic("gadgets_demolition_orchestra", "orchestra", ["gadgets_scout_drone", "gadgets_chain_spark", "gadgets_powder_pocket"]);
const orchestraPurchase = JSON.parse(localData.get(saveKey));
api.startRun({ seed: "showcase-orchestra-stages", sectorId: "stable_strata" });
clearArena();
ore(41, 20, 1_000_000);
api.debugSetTargetTile(41, 20);
api.debugForceDrones();
assert.equal(api.debugGetMechanicShowcase().active, null, "a drone stage alone is not a finished combination");
api.debugForceChain();
assert.equal(api.debugGetMechanicShowcase().active, null, "two stages alone are not a finished combination");
api.forceDetonate(1, 0);
assert.equal(api.getSnapshot().metrics.demolitionCombos, 1);
assert.equal(api.debugGetMechanicShowcase().active?.key, "orchestra");
assert.equal(api.debugGetMechanicShowcase().pending.orchestra, false);
api.finishRun();

// Two newly bought mechanics can fire on the same action. Keep one readable
// message on screen, then show the completed combination without repeating.
const simultaneous = structuredClone(orchestraPurchase);
simultaneous.pendingShowcases.chain = chainPurchase.pendingShowcases.chain;
localData.set(saveKey, JSON.stringify(simultaneous));
reload();
api.startRun({ seed: "showcase-sequential-messages", sectorId: "stable_strata" });
clearArena();
ore(41, 20, 1_000_000);
api.debugSetTargetTile(41, 20);
api.debugForceDrones();
api.debugForceChain();
api.forceDetonate(1, 0);
assert.equal(api.debugGetMechanicShowcase().active?.key, "chain");
assert.deepEqual(api.debugGetMechanicShowcase().queued.map((entry) => entry.key), ["orchestra"]);
assert.equal(JSON.parse(localData.get(saveKey)).pendingShowcases.orchestra, true, "queued messages are not consumed before display");
api.debugSetAttackCooldown(10);
api.stepRun(1.85);
assert.equal(api.debugGetMechanicShowcase().active?.key, "orchestra");
assert.equal(api.debugGetMechanicShowcase().queued.length, 0);
assert.equal(JSON.parse(localData.get(saveKey)).pendingShowcases.orchestra, false);
api.finishRun();

// Old saves retain their existing bomb guarantee, but do not replay newly
// introduced showcases for mechanics they already owned before this update.
const legacy = JSON.parse(localData.get(saveKey));
legacy.version = 16;
legacy.levels = { gadgets_powder_pocket: 1, gadgets_chain_spark: 1, tools_mirror_crystal: 1, gadgets_demolition_orchestra: 1 };
legacy.pendingShowcases = { bomb: true, obsolete: true };
localData.set(saveKey, JSON.stringify(legacy));
reload();
assert.deepEqual(api.debugGetMechanicShowcase().pending, { bomb: true });
api.startRun({ seed: "showcase-legacy-silent" });
clearArena();
ore(42, 20);
api.debugForceChain();
assert.equal(api.debugGetMechanicShowcase().active, null);
api.debugSetTargetTile(42, 20);
api.attackNow();
// Place a reachable ore for the existing guaranteed first-bomb contact.
ore(41, 20);
api.debugSetTargetTile(41, 20);
api.attackNow();
assert.equal(JSON.parse(localData.get(saveKey)).pendingShowcases.bomb, false);
api.debugResetProgress();
assert.deepEqual(api.debugGetMechanicShowcase(), { active: null, queued: [], pending: {} });

console.log(JSON.stringify({ ok: true, checked: ["real-purchase", "pending-reload-and-shifts", "real-chain-contact", "once-only", "short-duration", "real-ricochet-hit", "no-rng-or-gameplay-change", "complete-orchestra-only", "sequential-messages", "quiet-legacy-migration", "existing-first-bomb", "reset"] }));
