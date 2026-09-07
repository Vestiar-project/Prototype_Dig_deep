"use strict";

const assert = require("node:assert/strict");

// Production stepping derives a synthetic timestamp from performance.now().
// Freeze the clock before loading the runtime: sub-millisecond process-uptime
// differences at a 50 ms boundary can otherwise add or remove one strike and
// cascade into a different campaign purchase order for the same seed.
Object.defineProperty(globalThis, "performance", {
  value: Object.freeze({ now: () => 0 }),
  configurable: true,
});
Date.now = () => 1_700_000_000_000;

// Reuse the real headless runtime: this keeps movement, targeting, exact ore
// recipes, purchases, timers, procs and save progression in the simulation.
const { api } = require("./helpers/runtime-harness.js");
const { configureCampaignRunMode } = require("./helpers/campaign-run-mode.js");
assert.ok(api, "runtime diagnostics API should initialize");

function seededRandom(seed) {
  let value = seed >>> 0;
  return () => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    return value / 0x100000000;
  };
}

const MECHANIC_UNLOCKS = Object.freeze([
  ["sense_echo_pulse", 1], ["sense_clear_signal", 1], ["sense_vein_whisper", 1],
  ["sense_seismic_memory", 1], ["sense_seismic_memory", 2], ["sense_seismic_memory", 3],
  ["sense_ore_focus", 1], ["sense_priority_tuning", 1],
  ["sense_ghost_outline", 1], ["sense_second_fix", 1], ["sense_frequency_swing", 1],
  ["sense_deaf_knock", 1], ["sense_triangular_fix", 1], ["sense_earth_call", 1],
  ["sense_triangular_fix", 2],
  ["dig_sweeping_arc", 1], ["dig_twin_stroke", 1], ["dig_precision_path", 1],
  ["dig_wall_bite", 1], ["dig_omni_swing", 1], ["dig_least_resistance", 1],
  ["dig_mine_lift", 1], ["dig_quarry_presence", 1],
  ["power_furious_swing", 1], ["power_shatterpoint", 1], ["power_momentum", 1],
  ["power_overcharge_strike", 1], ["power_one_hit_legend", 1],
  ["power_sample_calibration", 1], ["power_corebreaker", 2], ["power_mountain_splitter", 1],
  ["time_clockwork_heart", 3], ["time_clockwork_heart", 4], ["time_clockwork_heart", 8],
  ["time_capsule", 1], ["time_capsule", 5], ["time_thirty_second_oath", 1],
  ["gadgets_powder_pocket", 1], ["gadgets_cluster_shell", 1], ["gadgets_sticky_charge", 1],
  ["gadgets_chain_spark", 1], ["gadgets_shock_capsule", 1], ["gadgets_magnet_mine", 1],
  ["gadgets_scout_drone", 1], ["gadgets_drone_swarm", 1], ["gadgets_volatile_jackpot", 1],
  ["gadgets_geo_charge", 1], ["gadgets_crew_beacon", 1], ["gadgets_demolition_orchestra", 1],
  ["tools_iron_pick", 1], ["tools_steel_pick", 1], ["tools_pneumatic_pick", 1],
  ["tools_super_pick", 1], ["tools_super_field", 1], ["tools_laser_emitter", 1],
  ["tools_laser_width", 1], ["tools_laser_splitter", 1], ["tools_mirror_crystal", 1],
  ["tools_super_pick_echo", 1], ["tools_solar_drill", 1],
  ["fortune_glimmer_hunter", 1], ["fortune_rich_vein", 1], ["fortune_double_yield", 1],
  ["fortune_triple_seam", 1], ["fortune_alchemist_scales", 1], ["fortune_deep_market", 1],
  ["fortune_golden_touch", 1], ["fortune_relic_magnet", 1], ["fortune_wheel", 1],
  ["fortune_findings_catalog", 1], ["fortune_motherlode_covenant", 1],
]);

const FEATURED_MECHANICS = new Set([
  "gadgets_powder_pocket@1", "dig_sweeping_arc@1", "tools_iron_pick@1",
  "dig_least_resistance@1", "dig_omni_swing@1", "tools_steel_pick@1",
  "gadgets_scout_drone@1", "tools_pneumatic_pick@1", "sense_ore_focus@1",
  "sense_priority_tuning@1", "sense_second_fix@1", "sense_frequency_swing@1",
  "sense_clear_signal@1", "sense_vein_whisper@1",
  "sense_seismic_memory@2", "sense_seismic_memory@3",
  "sense_triangular_fix@1", "fortune_triple_seam@1", "power_sample_calibration@1",
  "sense_triangular_fix@2",
  "sense_deaf_knock@1", "time_capsule@1", "time_clockwork_heart@4",
  "tools_super_pick@1", "tools_super_field@1",
  "power_one_hit_legend@1", "power_corebreaker@2",
  "dig_mine_lift@1", "tools_laser_emitter@1", "gadgets_geo_charge@1",
  "gadgets_crew_beacon@1", "fortune_relic_magnet@1", "tools_mirror_crystal@1",
  "tools_super_pick_echo@1",
  "fortune_golden_touch@1",
  "sense_earth_call@1", "dig_quarry_presence@1", "power_mountain_splitter@1",
  "time_thirty_second_oath@1", "gadgets_demolition_orchestra@1",
  "fortune_motherlode_covenant@1", "tools_solar_drill@1",
]);

const CAPSTONES = [
  "sense_earth_call", "dig_quarry_presence", "power_mountain_splitter",
  "time_thirty_second_oath", "gadgets_demolition_orchestra",
  "fortune_motherlode_covenant", "tools_solar_drill",
];
const CAMPAIGN_AUTOBUY_TARGETS = Object.freeze({
  tools_iron_pick: 1,
  tools_steel_pick: 1,
  tools_balanced_handle: 3,
  tools_pneumatic_pick: 1,
  power_sharpened_edge: 4,
  power_tempered_steel: 1,
  power_furious_swing: 1,
  dig_sweeping_arc: 1,
  dig_omni_swing: 1,
  dig_mine_lift: 1,
  time_extra_breath: 3,
  dig_light_footwork: 1,
  time_clockwork_heart: 3,
  time_capsule: 3,
  gadgets_scout_drone: 1,
  gadgets_drone_battery: 1,
  gadgets_drone_drill: 1,
  gadgets_drone_swarm: 1,
  gadgets_powder_pocket: 1,
  sense_echo_pulse: 1,
  sense_instinct_spark: 6,
  sense_deep_resonance: 1,
  sense_panoramic_intuition: 1,
  sense_ore_focus: 1,
  sense_priority_tuning: 3,
  sense_second_fix: 1,
  sense_frequency_swing: 1,
  sense_far_echo: 1,
  power_diamond_tip: 1,
  power_sample_calibration: 1,
  tools_super_pick: 1,
  tools_super_motor: 2,
  tools_super_teeth: 2,
  tools_super_field: 2,
  tools_laser_emitter: 1,
  tools_laser_range: 1,
  tools_laser_power: 1,
  tools_laser_width: 1,
  tools_laser_splitter: 2,
  tools_mirror_crystal: 1,
  tools_super_pick_echo: 1,
  power_corebreaker: 2,
  sense_earth_call: 1,
  dig_quarry_presence: 1,
  power_mountain_splitter: 1,
  time_thirty_second_oath: 1,
  gadgets_demolition_orchestra: 1,
  tools_solar_drill: 1,
  fortune_motherlode_covenant: 1,
  core_bon_voyage: 1,
});
const DEPTH_MILESTONES = Object.freeze([
  50, 100, 200, 300, 450, 600, 750, 900,
  1050, 1200, 1350, 1500, 1650, 1800, 1950,
]);

function simulateCampaign(seed, maxRuns = 420) {
  api.debugResetProgress();
  Math.random = seededRandom(seed);
  const firstOreSeconds = {};
  const milestones = {};
  const depthMilestoneSeconds = {};
  const mechanicSeconds = {};
  let activeSeconds = 0;
  let elapsedSeconds = 0;
  let completed = false;
  let runs = 0;
  let bestMeasuredDepth = 0;
  let finalPerkRun = null;
  let finalPerkDepth = null;
  let maxWorkshopLevels = 0;
  let maxWorkshopMechanics = 0;
  let maxWorkshop = null;
  let lastPurchaseSeconds = 0;
  let maxPurchaseGapSeconds = 0;
  let maxPurchaseGap = null;
  const descentCadenceTotals = {
    pulses: 0,
    completions: 0,
    timeouts: 0,
    seconds: 0,
    eligibleSeconds: 0,
  };
  const solarApproachWindow = [];
  let solarApproach = null;
  const frequencyApproachWindow = [];
  let frequencyApproach = null;
  const depthTrace = [];
  const openingRunMotion = [];
  const runModeCounts = { descent: 0, harvest: 0 };
  const runModeChanges = [];

  for (let run = 1; run <= maxRuns; run += 1) {
    const runChoice = configureCampaignRunMode(api, bestMeasuredDepth);
    runModeCounts[runChoice.mode] += 1;
    if (runModeChanges.at(-1)?.mode !== runChoice.mode) {
      runModeChanges.push({ run, minute: Number((elapsedSeconds / 60).toFixed(2)), bestDepth: bestMeasuredDepth, ...runChoice });
    }
    api.startRun({ seed: `campaign-${seed}-${run}` });
    api.stepRun(61);
    let snapshot = api.getSnapshot();
    if (snapshot.mode === "run" && snapshot.solarFinale?.sealSequenceStarted) {
      // An impulse already in flight at the seal cap still owns its brief
      // third-fracture reveal; allow that scene to finish before inspection.
      api.stepRun(9);
      snapshot = api.getSnapshot();
    }
    const report = snapshot.lastRunReport;
    assert.ok(snapshot.mode === "result" || snapshot.mode === "ending", `run ${run} must end in results or the final comic`);
    const endingRun = snapshot.mode === "ending";
    const runDuration = endingRun
      ? Math.max(0, Number(snapshot.activeWallElapsed) || 0)
      : Math.max(0, Number(report?.duration) || 0);
    const runDepth = endingRun
      ? Math.max(0, Number(snapshot.deepest) || 0)
      : Math.max(0, Number(report?.depth) || 0);
    bestMeasuredDepth = Math.max(bestMeasuredDepth, runDepth);
    if (!endingRun) {
      descentCadenceTotals.pulses += report?.descentCadencePulses || 0;
      descentCadenceTotals.completions += report?.descentCadenceCompletions || 0;
      descentCadenceTotals.timeouts += report?.descentCadenceTimeouts || 0;
      descentCadenceTotals.seconds += report?.descentCadenceSeconds || 0;
      descentCadenceTotals.eligibleSeconds += report?.descentCadenceEligibleSeconds || 0;
      if (run <= 4) {
        openingRunMotion.push({
          run,
          movementSeconds: Number(report?.movementSeconds) || 0,
          travelMeters: Number(report?.travelMeters) || 0,
          maxDistanceFromSpawnMeters: Number(report?.maxDistanceFromSpawnMeters) || 0,
          veinContinuations: Number(report?.veinContinuations) || 0,
        });
      }
    }
    activeSeconds += runDuration;
    elapsedSeconds += runDuration + (endingRun ? 0 : 10);
    runs = run;
    for (const depth of DEPTH_MILESTONES) {
      if (depthMilestoneSeconds[depth] == null && runDepth >= depth) {
        depthMilestoneSeconds[depth] = elapsedSeconds;
      }
    }
    if (snapshot.mode === "ending") {
      completed = Boolean(snapshot.campaign.ready);
      break;
    }

    for (const [oreId, amount] of Object.entries(snapshot.lastHaul || {})) {
      if (amount > 0 && firstOreSeconds[oreId] == null) firstOreSeconds[oreId] = elapsedSeconds;
    }

    const beforeCatalog = api.getUpgradeCatalog();
    const beforeLevels = Object.fromEntries(beforeCatalog.map((definition) => [definition.id, definition.level || 0]));
    if (process.env.CAMPAIGN_SNAPSHOT_FREQUENCY === "1" && (beforeLevels.sense_ore_focus > 0) && !(beforeLevels.sense_frequency_swing > 0)) {
      const frequency = beforeCatalog.find((definition) => definition.id === "sense_frequency_swing");
      const inventory = { ...(snapshot.inventory || {}) };
      const recipe = { ...(frequency?.recipe || {}) };
      frequencyApproachWindow.push({
        run,
        minute: Number((elapsedSeconds / 60).toFixed(1)),
        priorityLevel: beforeLevels.sense_priority_tuning || 0,
        secondFixLevel: beforeLevels.sense_second_fix || 0,
        available: Boolean(frequency?.available),
        affordable: Boolean(frequency?.affordable),
        focusedOreId: snapshot.focusedOreId,
        inventory,
        recipe,
        deficits: Object.fromEntries(Object.entries(recipe).map(([oreId, amount]) => (
          [oreId, Math.max(0, amount - (inventory[oreId] || 0))]
        ))),
      });
      if (frequencyApproachWindow.length > 4) frequencyApproachWindow.shift();
    }
    if (process.env.CAMPAIGN_SNAPSHOT_SOLAR === "1" && !(beforeLevels.tools_solar_drill > 0)) {
      const solar = beforeCatalog.find((definition) => definition.id === "tools_solar_drill");
      const inventory = { ...(snapshot.inventory || {}) };
      const recipe = { ...(solar?.recipe || {}) };
      const gateIds = ["tools_laser_splitter", "power_corebreaker", "tools_mirror_crystal", "tools_super_pick_echo", "tools_solar_drill"];
      const gates = Object.fromEntries(gateIds.map((id) => {
        const definition = beforeCatalog.find((candidate) => candidate.id === id);
        const gateRecipe = { ...(definition?.recipe || {}) };
        return [id, {
          level: definition?.level || 0,
          available: Boolean(definition?.available),
          affordable: Boolean(definition?.affordable),
          recipe: gateRecipe,
          deficits: Object.fromEntries(Object.entries(gateRecipe).map(([oreId, amount]) => (
            [oreId, Math.max(0, amount - (inventory[oreId] || 0))]
          ))),
        }];
      }));
      solarApproachWindow.push({
        run,
        minute: Number((elapsedSeconds / 60).toFixed(1)),
        available: Boolean(solar?.available),
        affordable: Boolean(solar?.affordable),
        focusedOreId: snapshot.focusedOreId,
        inventory,
        recipe,
        deficits: Object.fromEntries(Object.entries(recipe).map(([oreId, amount]) => (
          [oreId, Math.max(0, amount - (inventory[oreId] || 0))]
        ))),
        gates,
      });
      if (solarApproachWindow.length > 3) solarApproachWindow.shift();
    }
    const purchase = api.debugAutoBuyAffordable(300);
    if (purchase.bought.includes("core_bon_voyage")) {
      finalPerkRun = run;
      finalPerkDepth = bestMeasuredDepth;
    }
    if (process.env.CAMPAIGN_TRACE_DEPTH === "1") {
      const runStats = api.getStats();
      depthTrace.push({
        run,
        runMode: runChoice.mode,
        liftDepth: snapshot.liftDepth,
        minute: Number((elapsedSeconds / 60).toFixed(2)),
        duration: report?.duration || 0,
        depth: report?.depth || 0,
        haul: report?.haul || 0,
        movement: report?.movementSeconds || 0,
        travelMeters: report?.travelMeters || 0,
        maxDistanceFromSpawnMeters: report?.maxDistanceFromSpawnMeters || 0,
        veinContinuations: report?.veinContinuations || 0,
        mining: report?.miningSeconds || 0,
        searching: report?.searchingSeconds || 0,
        focusedOreId: snapshot.focusedOreId || null,
        inventory: { ...(snapshot.inventory || {}) },
        lifetimeOres: { ...(snapshot.lifetimeOres || {}) },
        stats: {
          tool: runStats.tool,
          toolTier: runStats.toolTier,
          pickPower: Number(runStats.pickPower.toFixed(2)),
          digSpeed: Number(runStats.digSpeed.toFixed(2)),
          moveSpeed: Number(runStats.moveSpeed.toFixed(2)),
          digRadius: Number(runStats.digRadius.toFixed(2)),
          runDuration: Number(runStats.runDuration.toFixed(2)),
          droneCount: runStats.droneCount,
          dronePower: Number(runStats.dronePower.toFixed(2)),
          droneSpeed: Number(runStats.droneSpeed.toFixed(2)),
          droneLifetime: Number(runStats.droneLifetime.toFixed(2)),
        },
        bought: [...purchase.bought],
      });
    }
    if (purchase.bought.length > 0) {
      const gap = elapsedSeconds - lastPurchaseSeconds;
      if (gap > maxPurchaseGapSeconds) {
        maxPurchaseGapSeconds = gap;
        maxPurchaseGap = {
          fromMinute: Number((lastPurchaseSeconds / 60).toFixed(2)),
          toMinute: Number((elapsedSeconds / 60).toFixed(2)),
          bought: [...purchase.bought],
        };
      }
      lastPurchaseSeconds = elapsedSeconds;
    }
    if (process.env.CAMPAIGN_SNAPSHOT_SOLAR === "1" && purchase.bought.includes("tools_solar_drill")) {
      solarApproach = solarApproachWindow.map((entry) => ({ ...entry }));
    }
    if (process.env.CAMPAIGN_SNAPSHOT_FREQUENCY === "1" && purchase.bought.includes("sense_frequency_swing")) {
      frequencyApproach = frequencyApproachWindow.map((entry) => ({ ...entry }));
    }
    if (purchase.bought.length > maxWorkshopLevels) {
      maxWorkshopLevels = purchase.bought.length;
      maxWorkshop = { run, minute: Number((elapsedSeconds / 60).toFixed(1)), bought: [...purchase.bought] };
    }
    snapshot = api.getSnapshot();
    const catalog = api.getUpgradeCatalog();
    const levelOf = (id) => catalog.find((definition) => definition.id === id)?.level || 0;
    let workshopMechanics = 0;
    for (const [id, level] of MECHANIC_UNLOCKS) {
      const key = `${id}@${level}`;
      if ((beforeLevels[id] || 0) < level && levelOf(id) >= level) {
        mechanicSeconds[key] = elapsedSeconds;
        workshopMechanics += 1;
      }
    }
    maxWorkshopMechanics = Math.max(maxWorkshopMechanics, workshopMechanics);

    const track = (key, id, level = 1) => {
      if (!milestones[key] && levelOf(id) >= level) milestones[key] = elapsedSeconds;
    };
    track("ironPick", "tools_iron_pick");
    track("steelPick", "tools_steel_pick");
    track("pneumaticPick", "tools_pneumatic_pick");
    track("scoutDrone", "gadgets_scout_drone");
    track("droneSwarm", "gadgets_drone_swarm");
    track("superPick", "tools_super_pick");
    track("focus", "sense_ore_focus");
    track("priorityTuning", "sense_priority_tuning");
    track("laser", "tools_laser_emitter");
    track("solarDrill", "tools_solar_drill");
    track("secondFix", "sense_second_fix");
    track("frequencySwing", "sense_frequency_swing");
    track("sampleCalibration", "power_sample_calibration");
    track("timeCapsule", "time_capsule");
    track("heartFour", "time_clockwork_heart", 4);
    track("heartOne", "time_clockwork_heart", 1);
    track("tunnelStep", "dig_tunnel_step", 1);
    track("impactWave", "dig_omni_swing");
    track("mineLift", "dig_mine_lift");
    track("mineLiftTwo", "dig_mine_lift", 2);
    track("mineLiftThree", "dig_mine_lift", 3);
    track("leastResistance", "dig_least_resistance");
    track("triangularFix", "sense_triangular_fix");
    track("triangularFixTwo", "sense_triangular_fix", 2);
    track("geoCharge", "gadgets_geo_charge");
    track("mirrorCrystal", "tools_mirror_crystal");
    track("superPickEcho", "tools_super_pick_echo");
    track("crewBeacon", "gadgets_crew_beacon");
    track("earthCall", "sense_earth_call");
    track("quarry", "dig_quarry_presence");
    track("mountainSplitter", "power_mountain_splitter");
    track("chrono", "time_thirty_second_oath");
    track("orchestra", "gadgets_demolition_orchestra");
    track("motherlode", "fortune_motherlode_covenant");
    track("finalPerk", "core_bon_voyage");
    if (snapshot.campaign.ready) {
      completed = true;
      break;
    }
  }

  const snapshot = api.getSnapshot();
  const finalCatalog = api.getUpgradeCatalog();
  const pendingStrategic = finalCatalog
    .filter((definition) => {
      const targetLevel = Number(CAMPAIGN_AUTOBUY_TARGETS?.[definition.id]) || 0;
      return targetLevel > 0 && (definition.level || 0) < targetLevel;
    })
    .map((definition) => ({
      id: definition.id,
      level: definition.level || 0,
      targetLevel: CAMPAIGN_AUTOBUY_TARGETS[definition.id],
      available: Boolean(definition.available),
      affordable: Boolean(definition.affordable),
      recipe: { ...(definition.recipe || {}) },
      deficits: Object.fromEntries(Object.entries(definition.recipe || {}).map(([oreId, amount]) => (
        [oreId, Math.max(0, amount - (snapshot.inventory?.[oreId] || 0))]
      ))),
    }));
  const featuredEntries = Object.entries(mechanicSeconds)
    .filter(([key]) => FEATURED_MECHANICS.has(key))
    .sort((left, right) => left[1] - right[1]);
  const featuredTimes = featuredEntries.map(([, seconds]) => seconds);
  const featuredGaps = featuredTimes.slice(1).map((seconds, index) => seconds - featuredTimes[index]);
  const maxFeaturedGapIndex = featuredGaps.indexOf(Math.max(...featuredGaps));
  const mechanicTimes = Object.values(mechanicSeconds);
  const lastTwentyStart = elapsedSeconds * 0.8;
  const trailingPurchaseGap = elapsedSeconds - lastPurchaseSeconds;
  if (trailingPurchaseGap > maxPurchaseGapSeconds) {
    maxPurchaseGapSeconds = trailingPurchaseGap;
    maxPurchaseGap = {
      fromMinute: Number((lastPurchaseSeconds / 60).toFixed(2)),
      toMinute: Number((elapsedSeconds / 60).toFixed(2)),
      bought: [],
    };
  }
  return {
    seed,
    completed,
    runs,
    activeMinutes: Number((activeSeconds / 60).toFixed(1)),
    elapsedMinutes: Number((elapsedSeconds / 60).toFixed(2)),
    finalApproachMinutes: milestones.finalPerk == null ? null : Number(((elapsedSeconds - milestones.finalPerk) / 60).toFixed(2)),
    finalApproachRuns: finalPerkRun == null ? null : runs - finalPerkRun,
    finalPerkDepth,
    purchasedLevels: snapshot.purchasedLevels,
    lifetimeChunks: snapshot.campaign.lifetimeChunks,
    maxWorkshopLevels,
    maxWorkshopMechanics,
    maxWorkshop,
    maxPurchaseGapMinutes: Number((maxPurchaseGapSeconds / 60).toFixed(2)),
    maxPurchaseGap,
    finalInventory: { ...(snapshot.inventory || {}) },
    finalFocusedOreId: snapshot.focusedOreId || null,
    descentCadence: {
      ...descentCadenceTotals,
      seconds: Number(descentCadenceTotals.seconds.toFixed(1)),
      eligibleSeconds: Number(descentCadenceTotals.eligibleSeconds.toFixed(1)),
      activeShare: Number((
        descentCadenceTotals.seconds / Math.max(1, descentCadenceTotals.eligibleSeconds)
      ).toFixed(3)),
      overallActiveShare: Number((descentCadenceTotals.seconds / Math.max(1, activeSeconds)).toFixed(3)),
    },
    pendingStrategic,
    latestSolarApproach: process.env.CAMPAIGN_SNAPSHOT_SOLAR === "1"
      ? solarApproachWindow.map((entry) => ({ ...entry }))
      : undefined,
    ...(solarApproach ? { solarApproach } : {}),
    ...(frequencyApproach ? { frequencyApproach } : {}),
    ...(process.env.CAMPAIGN_TRACE_DEPTH === "1" ? { depthTrace } : {}),
    openingRunMotion,
    runModeCounts,
    runModeChanges,
    maxFeaturedGapMinutes: Number(((featuredGaps.length ? Math.max(...featuredGaps) : 0) / 60).toFixed(1)),
    maxFeaturedGapBetween: maxFeaturedGapIndex >= 0
      ? [featuredEntries[maxFeaturedGapIndex][0], featuredEntries[maxFeaturedGapIndex + 1][0]]
      : [],
    mechanicsFirstHalfShare: Number((mechanicTimes.filter((seconds) => seconds <= elapsedSeconds * 0.5).length / mechanicTimes.length).toFixed(3)),
    mechanicsLastTwentyShare: Number((mechanicTimes.filter((seconds) => seconds >= lastTwentyStart).length / mechanicTimes.length).toFixed(3)),
    firstOreMinutes: Object.fromEntries(Object.entries(firstOreSeconds).map(([id, seconds]) => [id, Number((seconds / 60).toFixed(1))])),
    depthMilestoneMinutes: Object.fromEntries(Object.entries(depthMilestoneSeconds).map(([depth, seconds]) => [depth, Number((seconds / 60).toFixed(2))])),
    milestoneMinutes: Object.fromEntries(Object.entries(milestones).map(([id, seconds]) => [id, Number((seconds / 60).toFixed(2))])),
  };
}

const seeds = process.env.CAMPAIGN_SINGLE_SEED
  ? [Number(process.env.CAMPAIGN_SINGLE_SEED)]
  : [17, 43, 73, 137, 211, 353];
const campaignMaxRuns = Math.max(
  1,
  Math.floor(Number(process.env.CAMPAIGN_MAX_RUNS) || 420),
);
const campaigns = seeds.map((seed) => simulateCampaign(seed, campaignMaxRuns));
if (process.env.CAMPAIGN_AUDIT_ONLY === "1") {
  console.log(JSON.stringify({ auditOnly: true, campaigns }));
  process.exit(0);
}
for (const campaign of campaigns) {
  const progressAt = (milestone) => (campaign.milestoneMinutes[milestone] || 0) / campaign.elapsedMinutes;
  assert.ok(campaign.firstOreMinutes.coal <= 0.4, "starter coal must arrive in the first two shifts");
  const averageOpeningMovement = campaign.openingRunMotion.reduce(
    (total, run) => total + run.movementSeconds,
    0,
  ) / Math.max(1, campaign.openingRunMotion.length);
  assert.ok(
    averageOpeningMovement >= 1.2,
    `the staged starter seams must make the miner visibly travel during the first four shifts: ${JSON.stringify(campaign.openingRunMotion)}`,
  );
  assert.ok(
    Math.max(...campaign.openingRunMotion.map((run) => run.maxDistanceFromSpawnMeters)) >= 15,
    `the opening scanner route must leave the spawn pocket: ${JSON.stringify(campaign.openingRunMotion)}`,
  );
  assert.ok(campaign.firstOreMinutes.iron <= 15, "iron must enter the economy during the opening phase");
  assert.ok(campaign.milestoneMinutes.focus >= campaign.firstOreMinutes.silver, "ore focus must unlock only after its T5 silver sample appears");
  assert.ok(progressAt("focus") >= 0.3, `ore focus should sit beyond the opening 30%: ${JSON.stringify(campaign)}`);
  assert.equal(campaign.completed, true, `campaign ${campaign.seed} must be completable`);
  assert.equal(campaign.finalApproachRuns, 1, `the assembled Solar Drill should finish in one final expedition: ${JSON.stringify(campaign)}`);
  assert.ok(campaign.finalApproachMinutes <= 1.3, `the final expedition must fit its sixty-second energy and short completion scene: ${JSON.stringify(campaign)}`);
  assert.ok(campaign.elapsedMinutes >= 60 && campaign.elapsedMinutes <= 120, `campaign ${campaign.seed} should remain a 60-120 minute optimized run: ${JSON.stringify(campaign)}`);
  assert.ok(
    campaign.milestoneMinutes.scoutDrone >= 1
      && campaign.milestoneMinutes.scoutDrone <= 8
      && campaign.milestoneMinutes.scoutDrone <= campaign.milestoneMinutes.pneumaticPick,
    `the strengthened scout drone must join the opening before the pneumatic pick: ${JSON.stringify(campaign)}`,
  );
  assert.ok(
    campaign.milestoneMinutes.droneSwarm >= campaign.milestoneMinutes.scoutDrone
      && campaign.milestoneMinutes.droneSwarm <= 20,
    `the first additional drone must become a visible early-midgame upgrade: ${JSON.stringify(campaign)}`,
  );
  assert.ok(campaign.depthMilestoneMinutes[100] <= 6, `the first 100 m must not recreate the copper-only opening: ${JSON.stringify(campaign)}`);
  const depthAt = (meters) => campaign.depthMilestoneMinutes[meters];
  const depthGap = (from, to) => depthAt(to) - depthAt(from);
  for (const [from, to] of [[300, 450], [450, 600], [600, 750], [750, 900]]) {
    assert.ok(
      depthGap(from, to) >= 1.5 && depthGap(from, to) <= 28,
      `${from}-${to} m must remain a deliberate but finite geological act: ${JSON.stringify(campaign)}`,
    );
  }
  assert.ok(
    depthGap(300, 600) >= 5 && depthGap(300, 600) <= 30,
    `the whole 300-600 m act must not collapse even when one cave-rich half is quick: ${JSON.stringify(campaign)}`,
  );
  assert.ok(
    depthGap(600, 900) >= 12 && depthGap(600, 900) <= 45,
    `the super-pick transition must neither stall nor skip the 600-900 m layers: ${JSON.stringify(campaign)}`,
  );
  assert.ok(
    depthGap(1200, 1650) >= 6 && depthGap(1200, 1650) <= 35,
    `late strata must remain visible after the laser without becoming another wall: ${JSON.stringify(campaign)}`,
  );
  for (const [from, to, maximumMinutes = 22] of [
    [900, 1050], [1050, 1200], [1200, 1350],
    [1350, 1500], [1500, 1650], [1650, 1800], [1800, 1950, 24],
  ]) {
    assert.ok(
      // A cave-rich laser run may clear one isolated 150 m slice in a single
      // ~55-second shift. The aggregate 1200-1650 assertion above prevents
      // the late game from collapsing, while this floor preserves the
      // intended random reward for finding one unusually open formation.
      // Returning to known layers in Harvest mode can prepare a strong build
      // for a fast final push through 1500+ m. Keep each band's upper bound,
      // but no longer require that prepared build to linger in every layer.
      // The assembled final tool likewise crosses several strata in one run.
      (from >= 1500
        || (campaign.finalPerkDepth != null && to > campaign.finalPerkDepth)
        || depthGap(from, to) >= 0.75)
        && depthGap(from, to) <= maximumMinutes,
      `${from}-${to} m must stay visible without becoming a late single wall: ${JSON.stringify(campaign)}`,
    );
  }
  assert.ok(
    campaign.maxPurchaseGapMinutes <= 8,
    `ordinary upgrade purchases must not disappear for more than eight minutes: ${JSON.stringify(campaign)}`,
  );
  const recordedDepths = Object.entries(campaign.depthMilestoneMinutes)
    .map(([depth, minute]) => [Number(depth), minute])
    .sort((left, right) => left[0] - right[0]);
  for (let index = 1; index < recordedDepths.length; index += 1) {
    assert.ok(
      recordedDepths[index][1] >= recordedDepths[index - 1][1],
      `depth milestones must remain monotonic: ${JSON.stringify(campaign)}`,
    );
  }
  assert.ok(campaign.descentCadence.eligibleSeconds > 0, `deep runs must exercise descent cadence: ${JSON.stringify(campaign)}`);
  assert.ok(campaign.descentCadence.pulses > 0, `descent cadence must produce pulses: ${JSON.stringify(campaign)}`);
  assert.ok(campaign.descentCadence.completions > 0, `descent cadence must complete real depth steps: ${JSON.stringify(campaign)}`);
  assert.ok(
    campaign.descentCadence.completions / campaign.descentCadence.pulses >= 0.1,
    `at least one in ten descent pulses must make progress: ${JSON.stringify(campaign)}`,
  );
  assert.ok(campaign.descentCadence.activeShare <= 0.35, `descent cadence must stay an intervention, not permanent steering: ${JSON.stringify(campaign)}`);
  assert.ok(campaign.descentCadence.overallActiveShare <= 0.25, `descent cadence must occupy less than a quarter of active play: ${JSON.stringify(campaign)}`);
  assert.ok(
    campaign.milestoneMinutes.leastResistance >= 2 && campaign.milestoneMinutes.leastResistance <= 18,
    `foundational route planning should arrive during the opening rather than scale with the late-game duration: ${JSON.stringify(campaign)}`,
  );
  // The wave is the first sizeable area break and now belongs to the early
  // transition out of copper/iron. Its absolute window matters more than a
  // fixed campaign percentage because slower novice paths should not delay it.
  assert.ok(
    campaign.milestoneMinutes.impactWave >= 6
      && campaign.milestoneMinutes.impactWave <= 22
      && progressAt("impactWave") <= 0.4,
    `impact wave should arrive around the early/middle transition: ${JSON.stringify(campaign)}`,
  );
  assert.ok(
    campaign.milestoneMinutes.mineLift >= 1 && campaign.milestoneMinutes.mineLift <= 6,
    `the first lift should end repeated surface returns inside the opening minutes: ${JSON.stringify(campaign)}`,
  );
  assert.ok(
    campaign.milestoneMinutes.priorityTuning >= campaign.milestoneMinutes.focus
      && campaign.milestoneMinutes.priorityTuning - campaign.milestoneMinutes.focus <= 35,
    `the first focus follow-up should remain inside the middle game: ${JSON.stringify(campaign)}`,
  );
  for (const followup of ["sampleCalibration", "frequencySwing", "secondFix"]) {
    assert.ok(
      campaign.milestoneMinutes[followup] >= campaign.milestoneMinutes.focus
        && progressAt(followup) <= 0.9,
      `${followup} should stay after ore focus but before the final preparation phase: ${JSON.stringify(campaign)}`,
    );
  }
  const capstoneMinutes = [
    campaign.milestoneMinutes.earthCall,
    campaign.milestoneMinutes.quarry,
    campaign.milestoneMinutes.mountainSplitter,
    campaign.milestoneMinutes.chrono,
    campaign.milestoneMinutes.orchestra,
    campaign.milestoneMinutes.motherlode,
    campaign.milestoneMinutes.solarDrill,
  ];
  // A cave-rich or cave-poor final formation changes the physical tail after
  // the tree is already built. Measure capstone timing against the final
  // assembly instead of that random tail: the first summit still needs a real
  // forty-minute build-up and must sit past the midpoint of the workshop path.
  const firstCapstoneMinute = Math.min(
    ...capstoneMinutes,
  );
  const firstCapstoneBuildProgress = (
    firstCapstoneMinute / Math.max(0.01, campaign.milestoneMinutes.finalPerk)
  );
  assert.ok(
    firstCapstoneBuildProgress >= 0.53 && firstCapstoneMinute >= 40,
    `capstones should start in the late game: ${JSON.stringify(campaign)}`,
  );
  const lastCapstoneMinute = Math.max(...capstoneMinutes);
  assert.ok(
    campaign.milestoneMinutes.finalPerk >= lastCapstoneMinute,
    `the Solar Drill must remain after the capstone preparation path: ${JSON.stringify(campaign)}`,
  );
  assert.ok(
    new Set(capstoneMinutes.map((minute) => minute.toFixed(2))).size >= 3,
    `the seven capstones must arrive in at least three workshop waves: ${JSON.stringify(campaign)}`,
  );
  assert.ok(
    lastCapstoneMinute - Math.min(...capstoneMinutes) >= 4,
    `capstone waves must cover several deep shifts instead of one purchase cascade: ${JSON.stringify(campaign)}`,
  );
  // Purchases have no numeric workshop quota. Keep package sizes in the
  // diagnostic output, while cadence requirements below remain independent.
  // This compact list samples headline branch moments only; the broader
  // progression audit enforces the real drought limits across every visible
  // gameplay change and several purchase strategies.
  // This compact headline subset intentionally omits many ordinary-but-useful
  // purchases. A 22-minute ceiling catches a missing campaign act while
  // allowing one cave-poor seed whose real purchase drought is only 6.7 min.
  assert.ok(campaign.maxFeaturedGapMinutes <= 22, `headline branch moments must not disappear for an entire campaign act: ${JSON.stringify(campaign)}`);
  assert.ok(campaign.mechanicsFirstHalfShare >= 0.3, `the first half needs a meaningful share of mechanics: ${JSON.stringify(campaign)}`);
  assert.ok(campaign.mechanicsLastTwentyShare <= 0.4, `the final fifth must not contain most mechanics: ${JSON.stringify(campaign)}`);
}

const elapsed = campaigns.map((campaign) => campaign.elapsedMinutes).sort((left, right) => left - right);
const median = elapsed[Math.floor(elapsed.length / 2)];
console.log(JSON.stringify({
  ok: true,
  sampleSize: campaigns.length,
  elapsedRangeMinutes: [elapsed[0], elapsed.at(-1)],
  medianElapsedMinutes: median,
  worstWorkshopLevels: Math.max(...campaigns.map((campaign) => campaign.maxWorkshopLevels)),
  worstWorkshopMechanics: Math.max(...campaigns.map((campaign) => campaign.maxWorkshopMechanics)),
  worstFeaturedGapMinutes: Math.max(...campaigns.map((campaign) => campaign.maxFeaturedGapMinutes)),
  campaigns,
}));
