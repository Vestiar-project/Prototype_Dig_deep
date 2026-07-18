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
    // A human needs a few seconds to read the haul, choose/buy a node and
    // launch the next shift. Six seconds is deliberately conservative.
    elapsedSeconds += (report?.duration || 0) + 6;
    runs = run;

    for (const [oreId, amount] of Object.entries(snapshot.lastHaul || {})) {
      if (amount > 0 && firstOreSeconds[oreId] == null) firstOreSeconds[oreId] = elapsedSeconds;
    }

    api.debugAutoBuyAffordable(300);
    snapshot = api.getSnapshot();
    const catalog = api.getUpgradeCatalog();
    const levelOf = (id) => catalog.find((definition) => definition.id === id)?.level || 0;
    if (!milestones.focus && levelOf("sense_ore_focus") > 0) milestones.focus = elapsedSeconds;
    if (!milestones.laser && levelOf("tools_laser_emitter") > 0) milestones.laser = elapsedSeconds;
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
  assert.ok(campaign.firstOreMinutes.coal <= 0.4, "starter coal must arrive in the first two shifts");
  assert.ok(campaign.firstOreMinutes.iron <= 15, "iron must enter the economy during the opening phase");
  assert.ok(campaign.milestoneMinutes.focus >= campaign.firstOreMinutes.silver, "ore focus must unlock only after T5 ore appears");
  assert.ok(
    campaign.milestoneMinutes.focus >= campaign.elapsedMinutes * 0.3,
    `ore focus should sit beyond the opening 30% of progression: ${JSON.stringify(campaign)}`,
  );
  assert.equal(campaign.completed, true, `campaign ${campaign.seed} must be completable`);
  // This is an optimized bot with only six seconds of surface reading and
  // purchasing per shift; 50+ simulated minutes maps to roughly 1–2 hours for
  // a human first playthrough.
  assert.ok(campaign.elapsedMinutes >= 50, `campaign ${campaign.seed} must not collapse into a short session`);
  assert.ok(campaign.elapsedMinutes <= 135, `campaign ${campaign.seed} must stay near the one-to-two-hour target`);
}

console.log(JSON.stringify({ ok: true, campaigns }));
