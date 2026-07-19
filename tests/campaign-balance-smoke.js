"use strict";

const assert = require("node:assert/strict");

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

function simulateCampaign(seed, maxRuns = 360) {
  api.debugResetProgress();
  Math.random = seededRandom(seed);
  const firstOreSeconds = {};
  const milestones = {};
  let activeSeconds = 0;
  let elapsedSeconds = 0;
  let completed = false;
  let runs = 0;

  for (let run = 1; run <= maxRuns; run += 1) {
    api.startRun({ seed: `campaign-${seed}-${run}` });
    api.stepRun(61);
    let snapshot = api.getSnapshot();
    const report = snapshot.lastRunReport;
    assert.equal(snapshot.mode, "result", `run ${run} must end normally`);
    activeSeconds += report?.duration || 0;
    // A first-time player needs time to read the haul, inspect icon tooltips,
    // choose/buy a node and launch the next shift. Ten seconds is still a
    // conservative surface interval for a 102-node tree.
    elapsedSeconds += (report?.duration || 0) + 10;
    runs = run;

    for (const [oreId, amount] of Object.entries(snapshot.lastHaul || {})) {
      if (amount > 0 && firstOreSeconds[oreId] == null) firstOreSeconds[oreId] = elapsedSeconds;
    }

    api.debugAutoBuyAffordable(300);
    snapshot = api.getSnapshot();
    const catalog = api.getUpgradeCatalog();
    const levelOf = (id) => catalog.find((definition) => definition.id === id)?.level || 0;
    if (!milestones.ironPick && levelOf("tools_iron_pick") > 0) milestones.ironPick = elapsedSeconds;
    if (!milestones.steelPick && levelOf("tools_steel_pick") > 0) milestones.steelPick = elapsedSeconds;
    if (!milestones.pneumaticPick && levelOf("tools_pneumatic_pick") > 0) milestones.pneumaticPick = elapsedSeconds;
    if (!milestones.scoutDrone && levelOf("gadgets_scout_drone") > 0) milestones.scoutDrone = elapsedSeconds;
    if (!milestones.superPick && levelOf("tools_super_pick") > 0) milestones.superPick = elapsedSeconds;
    if (!milestones.focus && levelOf("sense_ore_focus") > 0) milestones.focus = elapsedSeconds;
    if (!milestones.laser && levelOf("tools_laser_emitter") > 0) milestones.laser = elapsedSeconds;
    if (!milestones.solarDrill && levelOf("tools_solar_drill") > 0) milestones.solarDrill = elapsedSeconds;
    if (!milestones.secondFix && levelOf("sense_second_fix") > 0) milestones.secondFix = elapsedSeconds;
    if (!milestones.deafKnock && levelOf("sense_deaf_knock") > 0) milestones.deafKnock = elapsedSeconds;
    if (!milestones.mineLift && levelOf("dig_mine_lift") > 0) milestones.mineLift = elapsedSeconds;
    if (!milestones.leastResistance && levelOf("dig_least_resistance") > 0) milestones.leastResistance = elapsedSeconds;
    if (!milestones.triangularFix && levelOf("sense_triangular_fix") > 0) milestones.triangularFix = elapsedSeconds;
    if (!milestones.geoCharge && levelOf("gadgets_geo_charge") > 0) milestones.geoCharge = elapsedSeconds;
    if (!milestones.sampleCalibration && levelOf("power_sample_calibration") > 0) milestones.sampleCalibration = elapsedSeconds;
    if (!milestones.frequencySwing && levelOf("sense_frequency_swing") > 0) milestones.frequencySwing = elapsedSeconds;
    if (!milestones.mirrorCrystal && levelOf("tools_mirror_crystal") > 0) milestones.mirrorCrystal = elapsedSeconds;
    if (!milestones.superPickEcho && levelOf("tools_super_pick_echo") > 0) milestones.superPickEcho = elapsedSeconds;
    if (!milestones.crewBeacon && levelOf("gadgets_crew_beacon") > 0) milestones.crewBeacon = elapsedSeconds;
    if (!milestones.finalPerk && levelOf("core_bon_voyage") > 0) milestones.finalPerk = elapsedSeconds;
    if (snapshot.campaign.ready) {
      completed = true;
      break;
    }
  }

  const snapshot = api.getSnapshot();
  return {
    seed,
    completed,
    runs,
    activeMinutes: Number((activeSeconds / 60).toFixed(1)),
    elapsedMinutes: Number((elapsedSeconds / 60).toFixed(1)),
    purchasedLevels: snapshot.purchasedLevels,
    lifetimeChunks: snapshot.campaign.lifetimeChunks,
    firstOreMinutes: Object.fromEntries(Object.entries(firstOreSeconds).map(([id, seconds]) => [id, Number((seconds / 60).toFixed(1))])),
    milestoneMinutes: Object.fromEntries(Object.entries(milestones).map(([id, seconds]) => [id, Number((seconds / 60).toFixed(1))])),
  };
}

const seeds = [17, 73, 211];
const campaigns = seeds.map((seed) => simulateCampaign(seed));
for (const campaign of campaigns) {
  const progressAt = (milestone) => (campaign.milestoneMinutes[milestone] || 0) / campaign.elapsedMinutes;
  assert.ok(campaign.firstOreMinutes.coal <= 0.4, "starter coal must arrive in the first two shifts");
  assert.ok(campaign.firstOreMinutes.iron <= 15, "iron must enter the economy during the opening phase");
  assert.ok(campaign.milestoneMinutes.focus >= campaign.firstOreMinutes.amethyst, "ore focus must unlock only after its post-T5 sample appears");
  assert.ok(
    campaign.milestoneMinutes.focus >= campaign.elapsedMinutes * 0.3,
    `ore focus should sit beyond the opening 30% of progression: ${JSON.stringify(campaign)}`,
  );
  assert.equal(campaign.completed, true, `campaign ${campaign.seed} must be completable`);
  // This is an optimized bot with only ten seconds of surface reading and
  // purchasing per shift; 50+ simulated minutes maps to roughly 1–2 hours for
  // a human first playthrough.
  assert.ok(campaign.elapsedMinutes >= 50, `campaign ${campaign.seed} must not collapse into a short session`);
  assert.ok(campaign.elapsedMinutes <= 135, `campaign ${campaign.seed} must stay near the one-to-two-hour target`);
  assert.ok(progressAt("steelPick") >= 0.2 && progressAt("steelPick") <= 0.45, `steel pick needs a distinct early phase: ${JSON.stringify(campaign)}`);
  assert.ok(progressAt("pneumaticPick") >= 0.32 && progressAt("pneumaticPick") <= 0.58, `pneumatic pick must land around the first half: ${JSON.stringify(campaign)}`);
  assert.ok(progressAt("scoutDrone") >= 0.3 && progressAt("scoutDrone") <= 0.55, `scout drone must join before the middle game closes: ${JSON.stringify(campaign)}`);
  assert.ok(progressAt("superPick") >= 0.58 && progressAt("superPick") <= 0.78, `super pick needs its own late-middle phase: ${JSON.stringify(campaign)}`);
  assert.ok(progressAt("laser") >= 0.75 && progressAt("laser") <= 0.94, `laser must arrive before the final cleanup: ${JSON.stringify(campaign)}`);
  assert.ok(progressAt("solarDrill") >= 0.86 && progressAt("solarDrill") <= 0.98, `solar drill must remain a visible prefinal reward: ${JSON.stringify(campaign)}`);
}

console.log(JSON.stringify({ ok: true, campaigns }));
