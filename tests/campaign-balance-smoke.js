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
require("./runtime-smoke.js");

const api = global.__DEPTH_ZERO__;
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
  "sense_seismic_memory@2", "sense_seismic_memory@3",
  "sense_triangular_fix@1", "fortune_triple_seam@1", "power_sample_calibration@1",
  "sense_triangular_fix@2",
  "sense_deaf_knock@1", "time_capsule@1", "time_clockwork_heart@4",
  "tools_super_pick@1", "tools_super_field@1",
  "power_corebreaker@2",
  "dig_mine_lift@1", "tools_laser_emitter@1", "gadgets_geo_charge@1",
  "gadgets_crew_beacon@1", "fortune_relic_magnet@1", "tools_mirror_crystal@1",
  "tools_super_pick_echo@1",
  "sense_earth_call@1", "dig_quarry_presence@1", "power_mountain_splitter@1",
  "time_thirty_second_oath@1", "gadgets_demolition_orchestra@1",
  "fortune_motherlode_covenant@1", "tools_solar_drill@1",
]);

const CAPSTONES = [
  "sense_earth_call", "dig_quarry_presence", "power_mountain_splitter",
  "time_thirty_second_oath", "gadgets_demolition_orchestra",
  "fortune_motherlode_covenant", "tools_solar_drill",
];

function simulateCampaign(seed, maxRuns = 420) {
  api.debugResetProgress();
  Math.random = seededRandom(seed);
  const firstOreSeconds = {};
  const milestones = {};
  const mechanicSeconds = {};
  let activeSeconds = 0;
  let elapsedSeconds = 0;
  let completed = false;
  let runs = 0;
  let maxWorkshopLevels = 0;
  let maxWorkshopMechanics = 0;
  let maxWorkshop = null;
  const solarApproachWindow = [];
  let solarApproach = null;
  const frequencyApproachWindow = [];
  let frequencyApproach = null;

  for (let run = 1; run <= maxRuns; run += 1) {
    api.startRun({ seed: `campaign-${seed}-${run}` });
    api.stepRun(61);
    let snapshot = api.getSnapshot();
    const report = snapshot.lastRunReport;
    assert.ok(snapshot.mode === "result" || snapshot.mode === "ending", `run ${run} must end in results or the final comic`);
    activeSeconds += report?.duration || 0;
    elapsedSeconds += (report?.duration || 0) + 10;
    runs = run;
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
  const featuredEntries = Object.entries(mechanicSeconds)
    .filter(([key]) => FEATURED_MECHANICS.has(key))
    .sort((left, right) => left[1] - right[1]);
  const featuredTimes = featuredEntries.map(([, seconds]) => seconds);
  const featuredGaps = featuredTimes.slice(1).map((seconds, index) => seconds - featuredTimes[index]);
  const maxFeaturedGapIndex = featuredGaps.indexOf(Math.max(...featuredGaps));
  const mechanicTimes = Object.values(mechanicSeconds);
  const lastTwentyStart = elapsedSeconds * 0.8;
  return {
    seed,
    completed,
    runs,
    activeMinutes: Number((activeSeconds / 60).toFixed(1)),
    elapsedMinutes: Number((elapsedSeconds / 60).toFixed(2)),
    purchasedLevels: snapshot.purchasedLevels,
    lifetimeChunks: snapshot.campaign.lifetimeChunks,
    maxWorkshopLevels,
    maxWorkshopMechanics,
    maxWorkshop,
    ...(solarApproach ? { solarApproach } : {}),
    ...(frequencyApproach ? { frequencyApproach } : {}),
    maxFeaturedGapMinutes: Number(((featuredGaps.length ? Math.max(...featuredGaps) : 0) / 60).toFixed(1)),
    maxFeaturedGapBetween: maxFeaturedGapIndex >= 0
      ? [featuredEntries[maxFeaturedGapIndex][0], featuredEntries[maxFeaturedGapIndex + 1][0]]
      : [],
    mechanicsFirstHalfShare: Number((mechanicTimes.filter((seconds) => seconds <= elapsedSeconds * 0.5).length / mechanicTimes.length).toFixed(3)),
    mechanicsLastTwentyShare: Number((mechanicTimes.filter((seconds) => seconds >= lastTwentyStart).length / mechanicTimes.length).toFixed(3)),
    firstOreMinutes: Object.fromEntries(Object.entries(firstOreSeconds).map(([id, seconds]) => [id, Number((seconds / 60).toFixed(1))])),
    milestoneMinutes: Object.fromEntries(Object.entries(milestones).map(([id, seconds]) => [id, Number((seconds / 60).toFixed(2))])),
  };
}

const seeds = process.env.CAMPAIGN_SINGLE_SEED
  ? [Number(process.env.CAMPAIGN_SINGLE_SEED)]
  : [17, 43, 73, 137, 211, 353];
const campaigns = seeds.map((seed) => simulateCampaign(seed));
if (process.env.CAMPAIGN_AUDIT_ONLY === "1") {
  console.log(JSON.stringify({ auditOnly: true, campaigns }));
  process.exit(0);
}
for (const campaign of campaigns) {
  const progressAt = (milestone) => (campaign.milestoneMinutes[milestone] || 0) / campaign.elapsedMinutes;
  assert.ok(campaign.firstOreMinutes.coal <= 0.4, "starter coal must arrive in the first two shifts");
  assert.ok(campaign.firstOreMinutes.iron <= 15, "iron must enter the economy during the opening phase");
  assert.ok(campaign.milestoneMinutes.focus >= campaign.firstOreMinutes.silver, "ore focus must unlock only after its T5 silver sample appears");
  assert.ok(progressAt("focus") >= 0.3, `ore focus should sit beyond the opening 30%: ${JSON.stringify(campaign)}`);
  assert.equal(campaign.completed, true, `campaign ${campaign.seed} must be completable`);
  assert.ok(campaign.elapsedMinutes >= 55 && campaign.elapsedMinutes <= 105, `campaign ${campaign.seed} should remain a 55-105 minute optimized run: ${JSON.stringify(campaign)}`);
  assert.ok(
    campaign.milestoneMinutes.leastResistance >= 2 && campaign.milestoneMinutes.leastResistance <= 18,
    `foundational route planning should arrive during the opening rather than scale with the late-game duration: ${JSON.stringify(campaign)}`,
  );
  assert.ok(progressAt("impactWave") >= 0.15 && progressAt("impactWave") <= 0.5, `impact wave should arrive around the early/middle transition: ${JSON.stringify(campaign)}`);
  assert.ok(progressAt("mineLift") >= 0.33 && progressAt("mineLift") <= 0.65, `mine lift should arrive before repeated deep descents dominate: ${JSON.stringify(campaign)}`);
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
  const capstoneProgress = CAPSTONES.map((id) => {
    const key = ({
      sense_earth_call: "earthCall",
      dig_quarry_presence: "quarry",
      power_mountain_splitter: "mountainSplitter",
      time_thirty_second_oath: "chrono",
      gadgets_demolition_orchestra: "orchestra",
      fortune_motherlode_covenant: "motherlode",
      tools_solar_drill: "solarDrill",
    })[id];
    return progressAt(key);
  }).sort((left, right) => left - right);
  // Workshops advance in whole shifts and the seven capstones deliberately
  // overlap; the first may appear near 60%, while the final recipe remains a
  // separate preparation shift after all seven have landed.
  assert.ok(capstoneProgress[0] >= 0.6, `capstones should start in the late game: ${JSON.stringify(campaign)}`);
  const lastCapstoneMinute = Math.max(
    campaign.milestoneMinutes.earthCall,
    campaign.milestoneMinutes.quarry,
    campaign.milestoneMinutes.mountainSplitter,
    campaign.milestoneMinutes.chrono,
    campaign.milestoneMinutes.orchestra,
    campaign.milestoneMinutes.motherlode,
    campaign.milestoneMinutes.solarDrill,
  );
  assert.ok(
    campaign.milestoneMinutes.finalPerk >= lastCapstoneMinute,
    `the Solar Drill must remain after the capstone preparation path: ${JSON.stringify(campaign)}`,
  );
  const capstoneMinutes = [
    campaign.milestoneMinutes.earthCall,
    campaign.milestoneMinutes.quarry,
    campaign.milestoneMinutes.mountainSplitter,
    campaign.milestoneMinutes.chrono,
    campaign.milestoneMinutes.orchestra,
    campaign.milestoneMinutes.motherlode,
    campaign.milestoneMinutes.solarDrill,
  ];
  assert.ok(
    new Set(capstoneMinutes.map((minute) => minute.toFixed(2))).size >= 3,
    `the seven capstones must arrive in at least three workshop waves: ${JSON.stringify(campaign)}`,
  );
  assert.ok(
    lastCapstoneMinute - Math.min(...capstoneMinutes) >= 4,
    `capstone waves must cover several deep shifts instead of one purchase cascade: ${JSON.stringify(campaign)}`,
  );
  assert.ok(campaign.maxWorkshopLevels <= 40, `one haul must not collapse dozens of late levels at once: ${JSON.stringify(campaign)}`);
  assert.ok(campaign.maxWorkshopMechanics <= 4, `one haul must not introduce more than four mechanics: ${JSON.stringify(campaign)}`);
  // This compact list samples headline branch moments only; the authoritative
  // 72-mechanic audit below the campaign suite enforces the real <=10 minute
  // drought limit across every visible gameplay change.
  assert.ok(campaign.maxFeaturedGapMinutes <= 18, `headline branch moments must not disappear for an entire campaign act: ${JSON.stringify(campaign)}`);
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
