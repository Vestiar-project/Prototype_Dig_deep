"use strict";

const assert = require("node:assert/strict");
const { Worker, isMainThread, parentPort, workerData } = require("node:worker_threads");

// A deliberately explicit list: these are purchases whose effect should be
// visible in play, rather than another small scalar increase. Thresholded
// nodes are listed separately because their later levels unlock new behavior.
const NOTABLE_MECHANICS = Object.freeze([
  { id: "sense_echo_pulse", level: 1, label: "resonant ping" },
  { id: "sense_clear_signal", level: 1, label: "clear signal" },
  { id: "sense_vein_whisper", level: 1, label: "vein lock" },
  { id: "sense_seismic_memory", level: 1, label: "seismic memory" },
  { id: "sense_seismic_memory", level: 2, label: "second remembered vein" },
  { id: "sense_seismic_memory", level: 3, label: "third remembered vein" },
  { id: "sense_ore_focus", level: 1, label: "ore focus" },
  { id: "sense_priority_tuning", level: 1, label: "priority tuning" },
  { id: "sense_ghost_outline", level: 1, label: "ghost outline" },
  { id: "sense_second_fix", level: 1, label: "second fix" },
  { id: "sense_frequency_swing", level: 1, label: "frequency swing" },
  { id: "sense_deaf_knock", level: 1, label: "deaf knock" },
  { id: "sense_triangular_fix", level: 1, label: "triangulation" },
  { id: "sense_triangular_fix", level: 2, label: "triangulated gadget sector" },
  { id: "sense_earth_call", level: 1, label: "earth call" },
  { id: "dig_sweeping_arc", level: 1, label: "sweeping arc" },
  { id: "dig_twin_stroke", level: 1, label: "twin stroke" },
  { id: "dig_precision_path", level: 1, label: "precision path" },
  { id: "dig_wall_bite", level: 1, label: "wall bite" },
  { id: "dig_omni_swing", level: 1, label: "impact mining" },
  { id: "dig_least_resistance", level: 1, label: "least-resistance route" },
  { id: "dig_mine_lift", level: 1, label: "mine lift" },
  { id: "dig_quarry_presence", level: 1, label: "quarry rhythm" },
  { id: "power_furious_swing", level: 1, label: "critical strikes" },
  { id: "power_momentum", level: 1, label: "approach strike" },
  { id: "power_shatterpoint", level: 1, label: "impact wave" },
  { id: "power_overcharge_strike", level: 1, label: "true overkill" },
  { id: "power_one_hit_legend", level: 1, label: "one-hit legend" },
  { id: "power_sample_calibration", level: 1, label: "sample calibration" },
  { id: "power_corebreaker", level: 2, label: "fault-line access" },
  { id: "power_mountain_splitter", level: 1, label: "fault line" },
  { id: "time_clockwork_heart", level: 3, label: "starting pause" },
  { id: "time_clockwork_heart", level: 4, label: "time refunds" },
  { id: "time_clockwork_heart", level: 8, label: "emergency charge" },
  { id: "time_capsule", level: 1, label: "discovery time" },
  { id: "time_capsule", level: 5, label: "chrono shards" },
  { id: "time_thirty_second_oath", level: 1, label: "chrono overdrive" },
  { id: "gadgets_powder_pocket", level: 1, label: "bombs" },
  { id: "gadgets_cluster_shell", level: 1, label: "cluster shell" },
  { id: "gadgets_sticky_charge", level: 1, label: "sticky charge" },
  { id: "gadgets_chain_spark", level: 1, label: "chain spark" },
  { id: "gadgets_shock_capsule", level: 1, label: "shock capsule" },
  { id: "gadgets_magnet_mine", level: 1, label: "magnetic bomb" },
  { id: "gadgets_scout_drone", level: 1, label: "scout drone" },
  { id: "gadgets_drone_swarm", level: 1, label: "drone swarm" },
  { id: "gadgets_volatile_jackpot", level: 1, label: "volatile jackpot" },
  { id: "gadgets_geo_charge", level: 1, label: "geo charge" },
  { id: "gadgets_crew_beacon", level: 1, label: "crew beacon" },
  { id: "gadgets_demolition_orchestra", level: 1, label: "demolition orchestra" },
  { id: "tools_iron_pick", level: 1, label: "iron pick" },
  { id: "tools_steel_pick", level: 1, label: "steel pick" },
  { id: "tools_pneumatic_pick", level: 1, label: "pneumatic pick" },
  { id: "tools_super_pick", level: 1, label: "super pick" },
  { id: "tools_super_field", level: 1, label: "persistent super field" },
  { id: "tools_laser_emitter", level: 1, label: "laser" },
  { id: "tools_laser_width", level: 1, label: "wide laser" },
  { id: "tools_laser_splitter", level: 1, label: "split laser" },
  { id: "tools_mirror_crystal", level: 1, label: "laser ricochet" },
  { id: "tools_super_pick_echo", level: 1, label: "super-pick echo" },
  { id: "tools_solar_drill", level: 1, label: "solar drill" },
  { id: "fortune_glimmer_hunter", level: 1, label: "rare ore bonus" },
  { id: "fortune_rich_vein", level: 1, label: "rich veins" },
  { id: "fortune_double_yield", level: 1, label: "double yield" },
  { id: "fortune_triple_seam", level: 1, label: "triple sample" },
  { id: "fortune_alchemist_scales", level: 1, label: "alchemist scales" },
  { id: "fortune_deep_market", level: 1, label: "deep market" },
  { id: "fortune_golden_touch", level: 1, label: "golden touch" },
  { id: "fortune_relic_magnet", level: 1, label: "relics" },
  { id: "fortune_wheel", level: 1, label: "fortune wheel" },
  { id: "fortune_findings_catalog", level: 1, label: "depth contract" },
  { id: "fortune_motherlode_covenant", level: 1, label: "motherlode" },
  { id: "core_bon_voyage", level: 1, label: "bon voyage" },
]);

const ORE_VALUE = Object.freeze({
  copper: 1,
  coal: 2,
  iron: 4,
  amber: 8,
  silver: 16,
  gold: 32,
  amethyst: 68,
  prism_crystal: 145,
  void_ore: 310,
  star_core: 700,
});

const STRATEGIES = Object.freeze(["strategic", "tools-first", "final-path"]);
const CAPSTONE_IDS = new Set([
  "sense_earth_call",
  "dig_quarry_presence",
  "power_mountain_splitter",
  "time_thirty_second_oath",
  "gadgets_demolition_orchestra",
  "tools_solar_drill",
  "fortune_motherlode_covenant",
]);
const PRIMARY_SEEDS = Object.freeze([
  17, 29, 43, 59, 73, 89, 107, 127, 149, 173,
  197, 211, 239, 263, 293, 317, 347, 379, 419, 457,
]);

function seededRandom(seed) {
  let value = seed >>> 0;
  return () => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    return value / 0x100000000;
  };
}

function weightedRecipeCost(recipe = {}) {
  return Object.entries(recipe).reduce(
    (sum, [oreId, amount]) => sum + (ORE_VALUE[oreId] || 1) * amount,
    0,
  );
}

function catalogById(api) {
  return new Map(api.getUpgradeCatalog().map((definition) => [definition.id, definition]));
}

function buildFinalPathRequirements(api) {
  const catalog = catalogById(api);
  const requiredLevels = new Map();
  const visit = (id, level = 1) => {
    const definition = catalog.get(id);
    if (!definition) return;
    const previous = requiredLevels.get(id) || 0;
    if (previous >= level) return;
    requiredLevels.set(id, level);
    for (const requirement of definition.requires || []) visit(requirement.id, requirement.level || 1);
  };
  visit("core_bon_voyage", 1);
  return requiredLevels;
}

function setUsefulFocus(api, strategy, finalPath, usePathDeficit = false) {
  if (!api.getStats().oreFocusUnlocked) return;
  const snapshot = api.getSnapshot();
  let candidates = api.getUpgradeCatalog().filter(
    (definition) => definition.unlocked && definition.level < definition.maxLevel,
  );
  if (strategy !== "final-path") {
    const nearbyBreakthroughs = candidates
      .filter((definition) => (
        definition.level === 0
        && definition.breakthrough
        && !definition.capstone
      ))
      .map((definition) => ({
        definition,
        missingValue: Object.entries(definition.recipe || {}).reduce((sum, [oreId, amount]) => (
          sum + Math.max(0, amount - (snapshot.inventory[oreId] || 0)) * (ORE_VALUE[oreId] || 1)
        ), 0),
      }))
      .filter((entry) => entry.missingValue > 0)
      .sort((left, right) => left.missingValue - right.missingValue
        || weightedRecipeCost(left.definition.recipe) - weightedRecipeCost(right.definition.recipe)
        || left.definition.id.localeCompare(right.definition.id));
    // A normal player focuses the ore that completes the nearest visible new
    // mechanic. Summing every late-tree deficit lets distant capstones drown
    // out a small immediate shortage (for example, 8 silver behind a tool).
    if (nearbyBreakthroughs.length) candidates = [nearbyBreakthroughs[0].definition];
  }
  if (strategy === "final-path" && usePathDeficit) {
    const pathCandidates = candidates
      .filter((definition) => definition.level < (finalPath.get(definition.id) || 0))
      .map((definition) => ({
        definition,
        missingValue: Object.entries(definition.recipe || {}).reduce((sum, [oreId, amount]) => (
          sum + Math.max(0, amount - (snapshot.inventory[oreId] || 0)) * (ORE_VALUE[oreId] || 1)
        ), 0),
      }))
      .filter((entry) => entry.missingValue > 0)
      .sort((left, right) => left.missingValue - right.missingValue
        || weightedRecipeCost(left.definition.recipe) - weightedRecipeCost(right.definition.recipe)
        || left.definition.id.localeCompare(right.definition.id));
    // A path-following novice should search for the ore blocking its nearest
    // reachable goal, not a late aggregate deficit from every visible branch.
    if (pathCandidates.length) candidates = [pathCandidates[0].definition];
  }
  const deficits = {};
  for (const definition of candidates) {
    for (const [oreId, amount] of Object.entries(definition.recipe || {})) {
      deficits[oreId] = (deficits[oreId] || 0) + Math.max(0, amount - (snapshot.inventory[oreId] || 0));
    }
  }
  const focus = Object.keys(ORE_VALUE)
    .filter((oreId) => (snapshot.lifetimeOres[oreId] || 0) > 0 && (deficits[oreId] || 0) > 0)
    .sort((left, right) => (deficits[right] || 0) * ORE_VALUE[right] - (deficits[left] || 0) * ORE_VALUE[left])[0];
  api.setFocusedOre(focus || null);
}

function buyWithStrategy(api, strategy, finalPath, limit = 300) {
  if (strategy === "strategic") return api.debugAutoBuyAffordable(limit).bought;

  const bought = [];
  const categoryFactor = {
    tools: 0.22,
    power: 0.62,
    dig: 0.72,
    time: 0.82,
    sense: 0.95,
    gadgets: 1.05,
    fortune: 1.12,
    core: 1,
  };

  for (let purchase = 0; purchase < limit; purchase += 1) {
    const catalog = api.getUpgradeCatalog();
    const affordable = catalog.filter((definition) => definition.available && definition.affordable);
    if (!affordable.length) break;

    let candidates = affordable;
    if (strategy === "final-path") {
      const pathCandidates = affordable.filter(
        (definition) => definition.level < (finalPath.get(definition.id) || 0),
      );
      // A goal-driven novice follows the rocket path whenever possible, then
      // buys the cheapest available support level instead of deadlocking.
      if (pathCandidates.length) candidates = pathCandidates;
    }

    candidates.sort((left, right) => {
      const leftCost = weightedRecipeCost(left.recipe);
      const rightCost = weightedRecipeCost(right.recipe);
      if (strategy === "tools-first") {
        const leftScore = leftCost * (categoryFactor[left.category] || 1);
        const rightScore = rightCost * (categoryFactor[right.category] || 1);
        return leftScore - rightScore || left.id.localeCompare(right.id);
      }
      return leftCost - rightCost || left.id.localeCompare(right.id);
    });

    let candidate = candidates[0];
    const firstRankSlotsRemaining = Number(
      candidate?.firstRankSlotsRemaining ?? catalog[0]?.firstRankSlotsRemaining,
    );
    // Preserve the strategy's historical ordering for the first three slots.
    // Only keep the last installation from going to an unrelated new scalar
    // while an affordable gameplay breakthrough is already in the same
    // candidate set. Owned ranks and branch capstones are never displaced.
    if (
      firstRankSlotsRemaining === 1
      && candidate?.level === 0
      && !candidate.breakthrough
    ) {
      candidate = candidates.find((definition) => (
        definition.level === 0
        && definition.breakthrough
        && !CAPSTONE_IDS.has(definition.id)
      )) || candidate;
    }
    if (!candidate || !api.buyUpgrade(candidate.id)) break;
    bought.push(candidate.id);
  }
  return bought;
}

function levelMap(api) {
  return new Map(api.getUpgradeCatalog().map((definition) => [definition.id, definition.level]));
}

function reachedMechanics(levels) {
  return new Set(
    NOTABLE_MECHANICS
      .filter((mechanic) => (levels.get(mechanic.id) || 0) >= mechanic.level)
      .map((mechanic) => `${mechanic.id}@${mechanic.level}`),
  );
}

function simulateCampaign(api, seed, strategy, maxRuns = 480) {
  api.debugResetProgress();
  Math.random = seededRandom(seed * 1009 + STRATEGIES.indexOf(strategy) * 7919);
  const tracePurchases = process.env.PROGRESSION_TRACE_PURCHASES === "1";
  const traceIds = new Set((process.env.PROGRESSION_TRACE_IDS || "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean));
  const finalPath = buildFinalPathRequirements(api);
  const mechanicTimes = [];
  const purchaseTimeline = [];
  const targetTrace = Object.fromEntries([...traceIds].map((id) => [id, []]));
  const completedTargetTraces = new Set();
  let previousMechanics = reachedMechanics(levelMap(api));
  let elapsedSeconds = 0;
  let firstEventSeconds = null;
  let maxLevelPackage = 0;
  let maxMechanicPackage = 0;
  let maxLevelPackageDetails = null;
  let maxMechanicPackageDetails = null;
  let pathDryRuns = 0;
  let completed = false;
  let runs = 0;

  for (let run = 1; run <= maxRuns; run += 1) {
    api.startRun({ seed: `uniformity-${strategy}-${seed}-${run}` });
    api.stepRun(61);
    let snapshot = api.getSnapshot();
    assert.equal(snapshot.mode, "result", `${strategy}/${seed}: run ${run} must end normally`);
    const duration = snapshot.lastRunReport?.duration || 0;
    elapsedSeconds += duration + 10;
    runs = run;
    if (firstEventSeconds == null && (snapshot.lastRunReport?.eventCount || 0) > 0) {
      firstEventSeconds = elapsedSeconds - 10;
    }

    const beforeLevels = snapshot.purchasedLevels;
    const beforeLevelMap = levelMap(api);
    if (traceIds.size) {
      const beforeCatalog = catalogById(api);
      for (const id of traceIds) {
        if (completedTargetTraces.has(id)) continue;
        const definition = beforeCatalog.get(id);
        if (!definition) continue;
        const inventory = { ...(snapshot.inventory || {}) };
        const recipe = { ...(definition.recipe || {}) };
        const entries = targetTrace[id];
        entries.push({
          run,
          minute: Number((elapsedSeconds / 60).toFixed(2)),
          level: definition.level,
          unlocked: Boolean(definition.unlocked),
          available: Boolean(definition.available),
          affordable: Boolean(definition.affordable),
          requires: definition.requires || [],
          requiresOreDiscovery: definition.requiresOreDiscovery || null,
          recipe,
          deficits: Object.fromEntries(Object.entries(recipe).map(([oreId, amount]) => [
            oreId,
            Math.max(0, amount - (inventory[oreId] || 0)),
          ])),
          inventory,
        });
        if (entries.length > 6) entries.shift();
      }
    }
    const bought = buyWithStrategy(api, strategy, finalPath, 300);
    for (const id of traceIds) {
      if (bought.includes(id)) completedTargetTraces.add(id);
    }
    snapshot = api.getSnapshot();
    if (tracePurchases && bought.length) {
      const tracedLevels = new Map(beforeLevelMap);
      purchaseTimeline.push({
        run,
        minute: Number((elapsedSeconds / 60).toFixed(2)),
        purchases: bought.map((id) => {
          const level = (tracedLevels.get(id) || 0) + 1;
          tracedLevels.set(id, level);
          return `${id}@${level}`;
        }),
      });
    }
    const levelPackage = snapshot.purchasedLevels - beforeLevels;
    assert.equal(levelPackage, bought.length, `${strategy}/${seed}: buyer must report every purchased level`);
    const currentMechanics = reachedMechanics(levelMap(api));
    const newlyReached = [...currentMechanics].filter((key) => !previousMechanics.has(key));
    if (levelPackage > maxLevelPackage) {
      maxLevelPackage = levelPackage;
      maxLevelPackageDetails = {
        run,
        minute: Number((elapsedSeconds / 60).toFixed(2)),
        levels: levelPackage,
        mechanics: [...newlyReached],
        bought: [...bought],
      };
    }
    if (newlyReached.length > maxMechanicPackage) {
      maxMechanicPackage = newlyReached.length;
      maxMechanicPackageDetails = {
        run,
        minute: Number((elapsedSeconds / 60).toFixed(2)),
        levels: levelPackage,
        mechanics: [...newlyReached],
        bought: [...bought],
      };
    }
    for (const key of newlyReached) mechanicTimes.push({ key, seconds: elapsedSeconds });
    previousMechanics = currentMechanics;

    if (strategy === "final-path") {
      const simulatedLevels = new Map(beforeLevelMap);
      let pathPurchase = false;
      for (const id of bought) {
        const before = simulatedLevels.get(id) || 0;
        const target = finalPath.get(id) || 0;
        if (before < target) pathPurchase = true;
        simulatedLevels.set(id, before + 1);
      }
      pathDryRuns = pathPurchase ? 0 : pathDryRuns + 1;
    }
    // Aggregate focus is the normal player heuristic. A final-path player only
    // intervenes after three consecutive workshops made no path progress.
    setUsefulFocus(api, strategy, finalPath, strategy === "final-path" && pathDryRuns >= 3);

    if (snapshot.campaign.ready) {
      completed = true;
      break;
    }
    // Stop pathological strategies at 180 minutes; incompletion is reported
    // and fails below without consuming unbounded CI time.
    if (elapsedSeconds >= 180 * 60) break;
  }

  const finalSnapshot = api.getSnapshot();
  const mechanicsAtTime = new Map();
  for (const entry of mechanicTimes) {
    if (!mechanicsAtTime.has(entry.seconds)) mechanicsAtTime.set(entry.seconds, []);
    mechanicsAtTime.get(entry.seconds).push(entry.key);
  }
  const checkpoints = [
    { seconds: 0, mechanics: ["campaign-start"] },
    ...[...mechanicsAtTime]
      .sort(([left], [right]) => left - right)
      .map(([seconds, mechanics]) => ({ seconds, mechanics })),
    { seconds: elapsedSeconds, mechanics: ["campaign-end"] },
  ];
  let maxMechanicGapSeconds = 0;
  let maxMechanicGapDetails = null;
  for (let index = 1; index < checkpoints.length; index += 1) {
    const gap = checkpoints[index].seconds - checkpoints[index - 1].seconds;
    if (gap > maxMechanicGapSeconds) {
      maxMechanicGapSeconds = gap;
      maxMechanicGapDetails = {
        fromMinute: Number((checkpoints[index - 1].seconds / 60).toFixed(2)),
        toMinute: Number((checkpoints[index].seconds / 60).toFixed(2)),
        minutes: Number((gap / 60).toFixed(2)),
        after: [...checkpoints[index - 1].mechanics],
        before: [...checkpoints[index].mechanics],
      };
    }
  }

  return {
    seed,
    strategy,
    completed,
    runs,
    elapsedMinutes: Number((elapsedSeconds / 60).toFixed(2)),
    firstEventMinutes: firstEventSeconds == null ? null : Number((firstEventSeconds / 60).toFixed(2)),
    maxMechanicGapMinutes: Number((maxMechanicGapSeconds / 60).toFixed(2)),
    maxMechanicGapDetails,
    maxLevelPackage,
    maxLevelPackageDetails,
    maxMechanicPackage,
    maxMechanicPackageDetails,
    mechanicsReached: previousMechanics.size,
    milestoneMinutes: Object.fromEntries(mechanicTimes.map((entry) => [
      entry.key,
      Number((entry.seconds / 60).toFixed(2)),
    ])),
    ...(tracePurchases ? { purchaseTimeline } : {}),
    ...(traceIds.size ? { targetTrace } : {}),
    purchasedLevels: finalSnapshot.purchasedLevels,
  };
}

function percentile(values, fraction) {
  assert.ok(values.length > 0, "cannot calculate a percentile of an empty sample");
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(0, Math.ceil(sorted.length * fraction) - 1);
  return sorted[rank];
}

function summarize(campaigns) {
  const numeric = (field) => campaigns.map((campaign) => campaign[field]).filter(Number.isFinite);
  const durations = numeric("elapsedMinutes");
  const gaps = numeric("maxMechanicGapMinutes");
  const events = numeric("firstEventMinutes");
  const levelPackages = numeric("maxLevelPackage");
  const mechanicPackages = numeric("maxMechanicPackage");
  const milestoneMedians = Object.fromEntries(NOTABLE_MECHANICS.map((mechanic) => {
    const key = `${mechanic.id}@${mechanic.level}`;
    const samples = campaigns
      .map((campaign) => campaign.milestoneMinutes?.[key])
      .filter(Number.isFinite);
    return [key, {
      reached: samples.length,
      p50: samples.length ? percentile(samples, 0.5) : null,
      p90: samples.length ? percentile(samples, 0.9) : null,
    }];
  }));
  return {
    campaigns: campaigns.length,
    completed: campaigns.filter((campaign) => campaign.completed).length,
    elapsedMinutes: {
      p10: percentile(durations, 0.1),
      p50: percentile(durations, 0.5),
      p90: percentile(durations, 0.9),
      max: Math.max(...durations),
    },
    maxMechanicGapMinutes: {
      p50: percentile(gaps, 0.5),
      p90: percentile(gaps, 0.9),
      max: Math.max(...gaps),
    },
    firstEventMinutes: {
      found: events.length,
      p50: events.length ? percentile(events, 0.5) : null,
      p90: events.length ? percentile(events, 0.9) : null,
      max: events.length ? Math.max(...events) : null,
    },
    maxLevelPackage: {
      p50: percentile(levelPackages, 0.5),
      p90: percentile(levelPackages, 0.9),
      max: Math.max(...levelPackages),
    },
    maxMechanicPackage: {
      p50: percentile(mechanicPackages, 0.5),
      p90: percentile(mechanicPackages, 0.9),
      max: Math.max(...mechanicPackages),
    },
    milestoneMinutes: milestoneMedians,
  };
}

if (!isMainThread) {
  // Production run stepping derives its synthetic clock from performance.now().
  // Leaving that base tied to process uptime introduces sub-millisecond
  // floating-point differences at 50 ms run boundaries. A single extra strike
  // can then change ore income and cascade into a different purchase order.
  // Freeze both wall-clock sources before loading the runtime so identical
  // seed/strategy jobs remain bit-for-bit repeatable across fresh processes.
  Object.defineProperty(globalThis, "performance", {
    value: Object.freeze({ now: () => 0 }),
    configurable: true,
  });
  Date.now = () => 1_700_000_000_000;
  // runtime-smoke builds the same DOM/canvas shims used by the main runtime
  // suite, then loads the production upgrade, world and game modules.
  const originalLog = console.log;
  console.log = () => {};
  require("./runtime-smoke.js");
  console.log = originalLog;
  const api = global.__DEPTH_ZERO__;
  assert.ok(api, "real headless runtime must initialize in every worker");
  const job = workerData.job;
  parentPort.postMessage(simulateCampaign(api, job.seed, job.strategy));
} else {
  const startedAt = Date.now();
  // Twenty unique seeds are stratified across all three strategies. Running
  // one full real-time campaign per seed keeps this broad audit below the
  // smoke-suite budget instead of multiplying it into a long benchmark.
  const requestedSeed = Number(process.env.PROGRESSION_SINGLE_SEED);
  const requestedStrategy = process.env.PROGRESSION_SINGLE_STRATEGY;
  const requestedStrategyBatch = process.env.PROGRESSION_ONLY_STRATEGY;
  const auditOnly = process.env.PROGRESSION_AUDIT_ONLY === "1";
  const summaryOnly = process.env.PROGRESSION_SUMMARY_ONLY === "1";
  const jobs = Number.isFinite(requestedSeed) && STRATEGIES.includes(requestedStrategy)
    ? [{ seed: requestedSeed, strategy: requestedStrategy }]
    : PRIMARY_SEEDS.map((seed, index) => ({
      seed,
      strategy: STRATEGIES[index % STRATEGIES.length],
    })).filter((job) => !STRATEGIES.includes(requestedStrategyBatch) || job.strategy === requestedStrategyBatch);
  // Five isolated runtimes keep the exact 20-seed suite close to the
  // ninety-second smoke-test budget on the reference workstation.
  const workerCount = Math.min(5, jobs.length);
  // Put the slower goal-driven campaigns first. Each campaign gets a fresh
  // runtime: debug resets are intentionally not trusted to clear every
  // transient animation/proc field between independent balance samples.
  const orderedJobs = [...jobs].sort((left, right) => (
    STRATEGIES.indexOf(right.strategy) - STRATEGIES.indexOf(left.strategy)
  ));
  let nextJobIndex = 0;
  const campaignResults = [];
  const runFreshCampaign = (job) => new Promise((resolve, reject) => {
    const worker = new Worker(__filename, { workerData: { job } });
    worker.once("message", resolve);
    worker.once("error", reject);
    worker.once("exit", (code) => {
      if (code !== 0) reject(new Error(`progression worker exited with code ${code}`));
    });
  });
  const runLane = async () => {
    while (nextJobIndex < orderedJobs.length) {
      const job = orderedJobs[nextJobIndex];
      nextJobIndex += 1;
      campaignResults.push(await runFreshCampaign(job));
    }
  };

  Promise.all(Array.from({ length: workerCount }, () => runLane())).then(() => {
    const campaigns = campaignResults.sort((left, right) => (
      STRATEGIES.indexOf(left.strategy) - STRATEGIES.indexOf(right.strategy)
      || left.seed - right.seed
    ));
    const overall = summarize(campaigns);
    const byStrategy = Object.fromEntries(STRATEGIES
      .filter((strategy) => campaigns.some((campaign) => campaign.strategy === strategy))
      .map((strategy) => [
      strategy,
      summarize(campaigns.filter((campaign) => campaign.strategy === strategy)),
      ]));

    const outlierDetails = {
      longest: [...campaigns]
        .sort((left, right) => right.elapsedMinutes - left.elapsedMinutes)
        .slice(0, 3)
        .map(({ seed, strategy, elapsedMinutes }) => ({ seed, strategy, elapsedMinutes })),
      gaps: [...campaigns]
        .sort((left, right) => right.maxMechanicGapMinutes - left.maxMechanicGapMinutes)
        .slice(0, 5)
        .map(({ seed, strategy, maxMechanicGapMinutes, maxMechanicGapDetails }) => ({
          seed,
          strategy,
          maxMechanicGapMinutes,
          details: maxMechanicGapDetails,
        })),
      levelPackages: [...campaigns]
        .sort((left, right) => right.maxLevelPackage - left.maxLevelPackage)
        .slice(0, 5)
        .map(({ seed, strategy, maxLevelPackage, maxLevelPackageDetails }) => ({
          seed,
          strategy,
          maxLevelPackage,
          details: maxLevelPackageDetails,
        })),
      mechanicPackages: [...campaigns]
        .sort((left, right) => right.maxMechanicPackage - left.maxMechanicPackage)
        .slice(0, 5)
        .map(({ seed, strategy, maxMechanicPackage, maxMechanicPackageDetails }) => ({
          seed,
          strategy,
          maxMechanicPackage,
          details: maxMechanicPackageDetails,
        })),
    };
    const diagnostic = {
      uniqueSeeds: new Set(campaigns.map((campaign) => campaign.seed)).size,
      notableMechanics: NOTABLE_MECHANICS.length,
      wallSeconds: Number(((Date.now() - startedAt) / 1000).toFixed(2)),
      overall,
      byStrategy,
      outliers: outlierDetails,
      ...(summaryOnly ? {} : { campaigns }),
    };
    try {
      if (auditOnly) {
        console.log(JSON.stringify({ auditOnly: true, ...diagnostic }));
        return;
      }
      assert.equal(new Set(campaigns.map((campaign) => campaign.seed)).size, 20, "the audit must cover at least 20 unique seeds");
      assert.equal(new Set(campaigns.map((campaign) => campaign.strategy)).size, 3, "the audit must exercise three buying strategies");
      assert.equal(overall.completed, overall.campaigns, "every sampled strategy must finish the campaign");
      assert.ok(overall.elapsedMinutes.p10 >= 45, `campaign must retain a real opening and middle game: ${JSON.stringify(overall.elapsedMinutes)}`);
      assert.ok(overall.elapsedMinutes.p90 <= 135, `90% of campaigns should fit the 1-2 hour target with margin: ${JSON.stringify(overall.elapsedMinutes)}`);
      assert.ok(overall.maxMechanicGapMinutes.p90 <= 8, `90% of campaigns need a notable unlock at least every eight minutes: ${JSON.stringify(overall.maxMechanicGapMinutes)}`);
      assert.ok(overall.maxMechanicGapMinutes.max <= 10, `no sampled campaign should go ten minutes without a notable unlock: ${JSON.stringify(overall.maxMechanicGapMinutes)}`);
      assert.ok(overall.maxLevelPackage.p90 <= 35, `late economy must not collapse into giant level packages: ${JSON.stringify(overall.maxLevelPackage)}`);
      assert.ok(overall.maxMechanicPackage.p90 <= 4, `notable mechanics need room to breathe between purchases: ${JSON.stringify(overall.maxMechanicPackage)}`);
      assert.equal(overall.firstEventMinutes.found, overall.campaigns, "every sampled campaign must encounter an underground event");
      assert.ok(overall.firstEventMinutes.p90 <= 15, `events should become visible during the early game: ${JSON.stringify(overall.firstEventMinutes)}`);
      assert.ok(overall.firstEventMinutes.max <= 20, `no seed should hide its first event beyond twenty minutes: ${JSON.stringify(overall.firstEventMinutes)}`);
    } catch (error) {
      // Keep the full measurement visible when a target-state assertion fails;
      // this test is also the balancing audit used to guide the next fix.
      console.log(JSON.stringify({ diagnostic: true, ...diagnostic }));
      throw error;
    }

    console.log(JSON.stringify({ ok: true, ...diagnostic }));
  }).catch((error) => {
    console.error(error?.stack || error);
    process.exitCode = 1;
  });
}
