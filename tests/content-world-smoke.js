"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

global.window = global;
const root = path.resolve(__dirname, "..");
require(path.join(root, "js", "upgrades.js"));
require(path.join(root, "js", "world.js"));

const { UPGRADE_DEFS, ORE_TYPES, calculateMetaStats, getUpgradeRecipe } = global.DepthZeroUpgrades;
const { MineWorld, WORLD_CONFIG, FINAL_LAYER_TY, FINAL_SEAL_HITS } = global.DepthZeroWorld;
const ids = new Set(UPGRADE_DEFS.map((definition) => definition.id));

assert.equal(UPGRADE_DEFS.length, 102);
assert.equal(ids.size, UPGRADE_DEFS.length, "upgrade ids must be unique");
assert.equal(UPGRADE_DEFS.reduce((sum, definition) => sum + definition.maxLevel, 0), 330);
for (const definition of UPGRADE_DEFS) {
  for (const requirement of definition.requires || []) {
    const id = typeof requirement === "string" ? requirement : requirement.id;
    assert.ok(ids.has(id), `${definition.id} references missing upgrade ${id}`);
  }
}

const forbiddenUpgradeCopy = [
  /\bуз(?:ел|ла|ле|лом|лы|лов|лам|лами|лах)\b/iu,
  /\bобъедин(?:яет|яют|ён|ена|ено|ены|еными)\b/iu,
  /\bпрежн(?:ий|яя|ее|ие|его|ей|их|им|ими|юю)\b/iu,
  /\b(?:раньше|ранее)\b/iu,
  /\b(?:техническ|балансировочн|рефакторинг|переработк)\w*/iu,
  /\bзаменя(?:ет|ют)\s+(?:несколько|стар\w*)\b/iu,
  /\bстар\w*\s+(?:верси\w*|перк\w*|улучшени\w*|узл\w*)\b/iu,
];
for (const definition of UPGRADE_DEFS) {
  const copy = `${definition.name || ""} ${definition.description || ""}`;
  for (const pattern of forbiddenUpgradeCopy) {
    assert.doesNotMatch(
      copy,
      pattern,
      `${definition.id} must use player-facing copy instead of implementation history`,
    );
  }
}

const fullLevels = Object.fromEntries(UPGRADE_DEFS.map((definition) => [definition.id, definition.maxLevel]));
const fullStats = calculateMetaStats(fullLevels);
const baseStats = calculateMetaStats({});
assert.equal(baseStats.digReach, 38, "the starter pick must remain a close-contact tool");
assert.equal(baseStats.laserRange, 210, "the first laser must immediately outrange every pick tier");
const reachLevelIds = ["dig_arm_swing", "dig_reach_training", "dig_excavator_stance", "dig_master_reach"];
const fullReachLevels = Object.fromEntries(reachLevelIds.map((id) => [
  id,
  UPGRADE_DEFS.find((definition) => definition.id === id).maxLevel,
]));
assert.equal(calculateMetaStats(fullReachLevels).digReach, 64, "starter-tier reach upgrades must cap near two tiles");
assert.equal(
  calculateMetaStats({ ...fullReachLevels, tools_pneumatic_pick: 1 }).digReach,
  88,
  "the pneumatic pick must stay below four tiles even with every reach rank",
);
assert.ok(fullStats.digReach > 100 && fullStats.digReach <= 112, "late pick reach must stay well below laser range");
assert.equal(fullStats.laserRange, 420, "the completed laser branch may reach fifteen tiles");
assert.equal(fullStats.runDuration, 45);
assert.equal(fullStats.bonusRunDurationCap, 60);
assert.equal(fullStats.echoPingCooldown, 3, "resonance ping must affect real search cadence");
assert.equal(fullStats.echoPingRadiusMultiplier, 1.55);
assert.equal(fullStats.deepResonanceEnabled, true);
assert.equal(fullStats.deepResonanceCooldown, 2.5);
assert.equal(fullStats.deepResonanceRadiusMultiplier, 1.85);
assert.equal(fullStats.deepResonanceSolidLayers, 6);
assert.equal(fullStats.deepResonanceTargetSlots, 3);
assert.equal(fullStats.openingSprintMultiplier, 1.4);
assert.equal(fullStats.targetRelaySprintMultiplier, 1.18);
assert.equal(fullStats.targetRelaySprintDuration, 0.65);
assert.equal(fullStats.faultFinderCadenceEvery, 15);
assert.equal(fullStats.descentTargetBias, 0.25);
assert.equal(fullStats.descentMoveSpeedBonus, 0.32);
assert.equal(fullStats.openingDescentMoveSpeedBonus, 0.65);
assert.equal(fullStats.openingDepthPowerBonus, 0.7);
assert.equal(fullStats.veinTrailRangeMultiplier, 1.65);
assert.equal(fullStats.seismicRouteSlots, 3);
assert.equal(fullStats.ghostTrailDuration, 4);
assert.equal(fullStats.sideChipPower, 0.6);
assert.equal(fullStats.impactWaveEvery, 4);
assert.equal(fullStats.quarryModeRequiredBreaks, 3);
assert.equal(fullStats.faultLineMaxBlocks, 4);
assert.equal(fullStats.chronoOverdrive, true);
assert.equal(fullStats.overkillReservoirRatio, 0.85);
assert.equal(fullStats.richVeinWholeChance, 0.18);
assert.equal(fullStats.superFieldLaserPersistent, true);
assert.equal(fullStats.laserHeatNextHitBonus, 0.3);
assert.equal(fullStats.rareOreAdditiveChance, 0.18);
assert.equal(fullStats.goldenOreAdditiveChance, 0.075);
assert.equal(fullStats.doubleDropChance, 0.18, "double yield must contribute exactly one independent roll");
assert.equal(fullStats.extraYieldChance, 0.2, "double yield must not also leak into the generic extra-yield roll");
assert.equal(fullStats.magneticFieldRadiusTiles, 6);
assert.equal(fullStats.magneticFieldDuration, 4.8);
assert.ok(Math.abs(fullStats.magneticFieldTargetingBonus - 0.72) < 1e-9);
assert.equal(fullStats.fortunePityThreshold, 5);
assert.equal(fullStats.motherlodeTriggerBreaks, 20);
assert.equal(fullStats.demolitionComboEnabled, true);
assert.equal(fullStats.solarDrillProcEvery, 5);
assert.equal(calculateMetaStats({ tools_solar_drill: 1 }).solarDrillProcEvery, 0, "the Prism Condenser must not inherit Solar Drill cadence");
assert.equal(calculateMetaStats({ core_bon_voyage: 1 }).solarDrillProcEvery, 5, "the final Solar Drill must own the fifth-shot cadence");
assert.equal(calculateMetaStats({ core_bon_voyage: 1 }).solarDrillEnabled, true, "only the final tool may target the planetary seal");
const oreFocus = UPGRADE_DEFS.find((definition) => definition.id === "sense_ore_focus");
assert.equal(oreFocus?.requiresOreDiscovery, "silver", "ore focus must unlock after the first T5 sample");
assert.equal(oreFocus?.requiresBestDepth, 750, "ore focus must stay beyond the opening act even if a chest teases silver");
assert.deepEqual(
  oreFocus?.recipeOverride,
  { gold: 2, silver: 2 },
  "ore focus should use its current depth band instead of asking for exhausted opening iron",
);
const priorityTuning = UPGRADE_DEFS.find((definition) => definition.id === "sense_priority_tuning");
assert.deepEqual(
  priorityTuning?.requires,
  ["sense_ore_focus"],
  "deposit appraisal should follow focus directly instead of waiting for a hidden gold gate",
);
assert.deepEqual(
  [0, 1, 2, 3].map((level) => getUpgradeRecipe(priorityTuning, level)),
  [
    { silver: 9 },
    { gold: 3, silver: 8 },
    { prism_crystal: 1, amethyst: 1, gold: 2 },
    { prism_crystal: 8, amethyst: 10, gold: 12 },
  ],
  "ore appraisal ranks should deliberately stage the focus follow-up mechanics",
);
const requireIds = (upgradeId, expectedIds) => {
  const definition = UPGRADE_DEFS.find((upgrade) => upgrade.id === upgradeId);
  const requirementIds = (definition?.requires || []).map((requirement) => (
    typeof requirement === "string" ? requirement : requirement.id
  ));
  for (const expectedId of expectedIds) {
    assert.ok(
      requirementIds.includes(expectedId),
      `${upgradeId} must keep ${expectedId} in its final-path prerequisites`,
    );
  }
};
requireIds("sense_earth_call", ["sense_frequency_swing", "sense_triangular_fix"]);
requireIds("dig_quarry_presence", ["dig_mine_lift"]);
requireIds("power_mountain_splitter", ["power_sample_calibration", "power_corebreaker"]);
requireIds("gadgets_demolition_orchestra", ["gadgets_geo_charge", "gadgets_crew_beacon"]);
requireIds("tools_solar_drill", ["tools_mirror_crystal", "tools_super_pick_echo"]);
requireIds("fortune_motherlode_covenant", ["fortune_findings_catalog"]);
const requirementLevel = (upgradeId, requirementId) => {
  const definition = UPGRADE_DEFS.find((upgrade) => upgrade.id === upgradeId);
  const requirement = (definition?.requires || []).find((candidate) => (
    (typeof candidate === "string" ? candidate : candidate.id) === requirementId
  ));
  return typeof requirement === "string" ? 1 : (requirement?.level || 0);
};
assert.equal(requirementLevel("sense_frequency_swing", "sense_priority_tuning"), 3, "frequency swing should retain its staged focus-tuning gate");
assert.equal(requirementLevel("time_capsule", "time_clockwork_heart"), 4, "the capsule should retain its established midgame heart gate");
assert.equal(requirementLevel("time_clockwork_heart", "dig_light_footwork"), 1, "the heart must not wait for the silver-priced second movement rank");
assert.equal(requirementLevel("power_mountain_splitter", "power_corebreaker"), 2, "fault-line access should remain behind the second corebreaker rank");
assert.equal(requirementLevel("tools_mirror_crystal", "sense_earth_call"), 0, "mirror ricochet should bridge the late gap before through-wall sense");
assert.equal(
  UPGRADE_DEFS.find((definition) => definition.id === "tools_mirror_crystal")?.requiresBestDepth,
  1200,
  "the first mirror must form a distinct late-depth ricochet stage",
);
assert.equal(
  requirementLevel("dig_precision_path", "dig_arm_swing"),
  2,
  "the behavioural approach strike must not require four repetitive reach ranks",
);
assert.equal(
  requirementLevel("fortune_gem_polish", "fortune_prospector_ledger"),
  2,
  "the fortune path must branch before a third shallow-resource ledger rank",
);
assert.equal(
  requirementLevel("fortune_double_yield", "fortune_prospector_ledger"),
  2,
  "double yield must share the same shortened fortune branch gate",
);
const firstRecipeById = (id) => getUpgradeRecipe(
  UPGRADE_DEFS.find((definition) => definition.id === id),
  0,
);
assert.deepEqual(firstRecipeById("dig_precision_path"), { amber: 3, iron: 3 });
assert.deepEqual(
  firstRecipeById("sense_far_echo"),
  { gold: 3, silver: 4 },
  "the mandatory laser route must not require amber after the lift starts below its layer",
);
assert.deepEqual(firstRecipeById("dig_stone_dance"), { gold: 2, silver: 4, amber: 4 });
assert.deepEqual(firstRecipeById("fortune_alchemist_scales"), { gold: 2, silver: 3, amber: 3 });
assert.deepEqual(firstRecipeById("fortune_deep_market"), { amethyst: 2, gold: 4, silver: 5 });
assert.deepEqual(firstRecipeById("fortune_kings_ransom"), { amethyst: 3, gold: 6, silver: 8 });
assert.deepEqual(firstRecipeById("fortune_wheel"), { prism_crystal: 3, amethyst: 5, gold: 6 });
assert.deepEqual(firstRecipeById("fortune_findings_catalog"), { amethyst: 2, gold: 5, silver: 6 });
assert.deepEqual(
  getUpgradeRecipe(UPGRADE_DEFS.find((definition) => definition.id === "time_capsule"), 0),
  { silver: 3, amber: 4 },
  "the capsule path must begin in its current midgame layer instead of reserving extinct opening coal",
);
assert.deepEqual(
  getUpgradeRecipe(UPGRADE_DEFS.find((definition) => definition.id === "sense_seismic_memory"), 0),
  { gold: 1, silver: 2, amber: 3 },
  "seismic memory should stay inside the active middle-depth economy",
);
assert.deepEqual(
  getUpgradeRecipe(UPGRADE_DEFS.find((definition) => definition.id === "sense_deep_resonance"), 0),
  { silver: 3, amber: 2 },
  "deep resonance should not depend on iron after its natural layer is exhausted",
);
assert.deepEqual(
  getUpgradeRecipe(UPGRADE_DEFS.find((definition) => definition.id === "sense_deep_resonance"), 1),
  { gold: 10, silver: 27, amber: 40 },
  "the second depth-sector rank should keep its value without a late 68-iron sink",
);
const lightFootwork = UPGRADE_DEFS.find((definition) => definition.id === "dig_light_footwork");
assert.deepEqual(
  getUpgradeRecipe(lightFootwork, 1),
  { silver: 3, amber: 4, iron: 5 },
  "the opening-sprint rank should use the proven mixed midgame package",
);
assert.deepEqual(
  getUpgradeRecipe(lightFootwork, 2),
  { amber: 19, iron: 26, coal: 28 },
  "the following footwork rank should retain the branch's cumulative recipe value",
);
assert.deepEqual(
  getUpgradeRecipe(UPGRADE_DEFS.find((definition) => definition.id === "gadgets_sticky_charge"), 0),
  { silver: 4, amber: 1 },
  "sticky charges should use an affordable current-layer package without opening iron",
);
assert.deepEqual(
  getUpgradeRecipe(UPGRADE_DEFS.find((definition) => definition.id === "time_clockwork_heart"), 3),
  { iron: 3, coal: 4 },
  "the first time-refund milestone must not wait on a random amber pocket",
);
assert.deepEqual(
  getUpgradeRecipe(UPGRADE_DEFS.find((definition) => definition.id === "power_momentum"), 0),
  { silver: 3 },
  "the approach-strike mechanic should use the newly reached depth tier instead of another amber bottleneck",
);
assert.deepEqual(
  getUpgradeRecipe(UPGRADE_DEFS.find((definition) => definition.id === "dig_wall_bite"), 0),
  { iron: 8, coal: 6 },
  "area mining must not wait for a random amber pocket once its path is open",
);
assert.deepEqual(
  getUpgradeRecipe(UPGRADE_DEFS.find((definition) => definition.id === "sense_frequency_swing"), 0),
  { prism_crystal: 1, amethyst: 1, gold: 4 },
  "frequency swing should become affordable in the workshop before its observed focus-followup limit",
);
assert.deepEqual(
  getUpgradeRecipe(UPGRADE_DEFS.find((definition) => definition.id === "tools_mirror_crystal"), 0),
  { void_ore: 18, prism_crystal: 28 },
  "the first mirror should form a real pre-star-core ricochet stage instead of bundling with the echo",
);
const leastResistance = UPGRADE_DEFS.find((definition) => definition.id === "dig_least_resistance");
assert.deepEqual(
  leastResistance.requires,
  ["dig_sweeping_arc", "sense_echo_pulse"],
  "route planning should connect the first excavation arc to the first resonant ping",
);
assert.deepEqual(
  getUpgradeRecipe(leastResistance, 0),
  { silver: 1, amber: 1 },
  "route planning should remain affordable without forcing a return to exhausted opening layers",
);
assert.deepEqual(
  getUpgradeRecipe(UPGRADE_DEFS.find((definition) => definition.id === "dig_omni_swing"), 0),
  { silver: 5, amber: 1 },
  "impact mining should keep its weighted price in the active middle-depth economy",
);
const mineLift = UPGRADE_DEFS.find((definition) => definition.id === "dig_mine_lift");
assert.ok(
  !mineLift?.requires.some((requirement) => typeof requirement === "object" && requirement.id === "time_clockwork_heart"),
  "the first lift must not wait for a separate time branch while shifts still restart at the surface",
);
assert.ok(
  mineLift?.requires.includes("tools_iron_pick") && !mineLift?.requires.includes("tools_steel_pick"),
  "the first lift must end repeated surface traversal before the steel-pick phase",
);
assert.ok(
  mineLift?.requires.includes("tools_iron_pick") && !mineLift?.requires.includes("dig_light_footwork"),
  "the first lift should branch directly from the iron pick instead of waiting for an optional movement branch",
);
assert.equal(mineLift?.requiresBestDepth, 70, "the first lift must follow the opening descent while still preventing repeated pre-100 m surface runs");
assert.deepEqual(
  getUpgradeRecipe(mineLift, 0),
  { coal: 2 },
  "the iron-pick prerequisite already proves the tier; the first lift must not charge the same scarce iron twice",
);
assert.deepEqual(
  [1, 2, 3].map((level) => calculateMetaStats({ dig_mine_lift: level }).mineLiftRecordDepthRatio),
  [0.95, 0.99, 1],
  "lift ranks must remove repeated ascents while preserving three distinct landing upgrades",
);
const superPick = UPGRADE_DEFS.find((definition) => definition.id === "tools_super_pick");
assert.ok(superPick?.requires.includes("power_diamond_tip"), "the super pick must keep its thematic diamond-tip gate");
assert.ok(superPick?.requires.includes("dig_omni_swing"), "the super pick should bridge from the midgame digging branch");
assert.ok(
  !superPick?.requires.includes("power_sample_calibration"),
  "the super pick must not wait for ore focus and its late depth gate",
);
assert.equal(superPick?.requiresOreDiscovery, undefined, "the super pick's explicit prerequisites should be its only discovery gate");
assert.deepEqual(
  getUpgradeRecipe(superPick, 0),
  { silver: 30, gold: 20, amber: 8 },
  "the super pick must arrive before the amethyst wall it is meant to solve",
);
const laserEmitter = UPGRADE_DEFS.find((definition) => definition.id === "tools_laser_emitter");
const superField = UPGRADE_DEFS.find((definition) => definition.id === "tools_super_field");
assert.equal(
  superField?.requiresOreDiscovery,
  "amethyst",
  "the first super-field rank must break up the amethyst act instead of arriving in a prism bundle",
);
assert.equal(requirementLevel("tools_super_field", "tools_super_motor"), 1);
assert.equal(requirementLevel("tools_super_field", "tools_super_teeth"), 1);
assert.equal(
  requirementLevel("tools_laser_emitter", "tools_super_field"),
  2,
  "the laser should branch from the second field rank; the remaining field ranks must stay useful after the tool transition",
);
assert.ok(laserEmitter?.requires.includes("tools_super_pick"), "the laser must still follow the super-pick tool stage");
const laserWidth = UPGRADE_DEFS.find((definition) => definition.id === "tools_laser_width");
assert.ok(
  laserWidth?.requires.some((requirement) => (
    typeof requirement === "object"
    && requirement.id === "time_capsule"
    && requirement.level === 3
  )),
  "the wide-laser path must prepare alongside the finale instead of waiting behind the chrono capstone",
);
assert.ok(
  !laserWidth?.requires.includes("time_thirty_second_oath"),
  "a final capstone must not serialize every laser finisher behind itself",
);
const exactRecipeLevels = {
  sense_deep_resonance: [
    { silver: 3, amber: 2 },
    { gold: 10, silver: 27, amber: 40 },
    { gold: 28, silver: 40, amber: 34 },
  ],
  sense_seismic_memory: [
    { gold: 1, silver: 2, amber: 3 },
    { gold: 3, silver: 5, amber: 6 },
    { gold: 6, silver: 10, amber: 12 },
  ],
  sense_panoramic_intuition: [
    { gold: 1, silver: 2, amber: 3 },
    { amethyst: 22, gold: 32, silver: 28 },
    { amethyst: 40, gold: 59, silver: 50 },
  ],
  sense_ore_focus: [{ gold: 2, silver: 2 }],
  dig_omni_swing: [
    { silver: 5, amber: 1 },
    { gold: 10, silver: 13, amber: 12 },
    { gold: 23, silver: 32, amber: 28 },
  ],
  dig_least_resistance: [{ silver: 1, amber: 1 }],
  power_sharpened_edge: [
    { copper: 1 }, { amber: 2 }, { silver: 1, amber: 2 },
    { silver: 2, amber: 3 }, { gold: 2, silver: 2, amber: 5 },
    { gold: 3, silver: 4, amber: 4 },
    { gold: 5, amethyst: 3 }, { gold: 9, amethyst: 3 },
  ],
  power_diamond_tip: [
    { silver: 6, amber: 3 },
    { gold: 17, silver: 23, amber: 20 },
    { gold: 80, silver: 111, amber: 95 },
    { gold: 165, silver: 231, amber: 198 },
  ],
  power_tectonic_blow: [
    { gold: 3, silver: 4, amber: 5 },
    { amethyst: 33, gold: 48, silver: 41 },
    { amethyst: 60, gold: 89, silver: 76 },
  ],
  power_overcharge_strike: [
    { gold: 4, silver: 6, amber: 5 },
    { amethyst: 20, gold: 29, silver: 25 },
    { amethyst: 39, gold: 57, silver: 49 },
  ],
  gadgets_sticky_charge: [
    { silver: 4, amber: 1 },
    { gold: 22, silver: 31, amber: 27 },
    { gold: 39, silver: 55, amber: 47 },
  ],
  gadgets_chain_links: [
    { gold: 2, silver: 4, amber: 4 },
    { gold: 5, silver: 8, amber: 7 },
    { gold: 14, silver: 19, amber: 16 },
    { gold: 26, silver: 36, amber: 31 },
  ],
  time_extra_breath: [
    { copper: 1 }, { copper: 3 }, { copper: 3 }, { copper: 4 }, { copper: 5 },
    { silver: 3, amber: 4 }, { gold: 3, silver: 5 }, { amethyst: 3, gold: 5 },
  ],
  time_clockwork_heart: [
    { coal: 2, copper: 3 }, { coal: 4, iron: 2, copper: 4 },
    { iron: 4, coal: 6, copper: 6 }, { iron: 3, coal: 4 },
    { silver: 4, amber: 6 }, { gold: 4, silver: 6 },
    { amethyst: 8, gold: 12 }, { prism_crystal: 8, amethyst: 14 },
  ],
  time_capsule: [
    { silver: 3, amber: 4 }, { gold: 3, silver: 5 },
    { amethyst: 3, gold: 5 }, { prism_crystal: 3, amethyst: 5 },
    { void_ore: 3, prism_crystal: 6 }, { void_ore: 8, star_core: 2 },
  ],
  tools_super_motor: [
    { amethyst: 4, gold: 4 }, { prism_crystal: 2, amethyst: 3 },
    { void_ore: 35, prism_crystal: 55, amethyst: 45 },
    { void_ore: 70, prism_crystal: 105, star_core: 15 },
  ],
  tools_super_teeth: [
    { amethyst: 4, gold: 5 }, { prism_crystal: 2, amethyst: 3 },
    { void_ore: 40, prism_crystal: 60, amethyst: 50 },
    { void_ore: 80, prism_crystal: 120, star_core: 20 },
  ],
  tools_super_field: [
    { amethyst: 8, gold: 6 },
    { void_ore: 2, prism_crystal: 2, amethyst: 3 },
    { void_ore: 45, prism_crystal: 70, star_core: 12 },
    { void_ore: 95, prism_crystal: 140, star_core: 25 },
  ],
  tools_laser_emitter: [{ void_ore: 3, prism_crystal: 6, amethyst: 6 }],
  tools_laser_range: [
    { void_ore: 6, prism_crystal: 10 }, { void_ore: 14, prism_crystal: 24 },
    { void_ore: 25, prism_crystal: 40 }, { void_ore: 55, prism_crystal: 80 },
    { void_ore: 100, prism_crystal: 140 },
  ],
  tools_laser_power: [
    { void_ore: 7, prism_crystal: 13 }, { void_ore: 17, prism_crystal: 29 },
    { void_ore: 30, prism_crystal: 45, star_core: 6 },
    { void_ore: 60, prism_crystal: 85, star_core: 15 },
    { void_ore: 110, prism_crystal: 150, star_core: 30 },
  ],
  tools_laser_width: [
    { void_ore: 8, prism_crystal: 14 }, { void_ore: 20, prism_crystal: 32 },
    { void_ore: 40, prism_crystal: 55, star_core: 8 },
    { void_ore: 80, prism_crystal: 105, star_core: 20 },
  ],
  tools_laser_splitter: [
    { void_ore: 9, prism_crystal: 16 },
    { void_ore: 12, prism_crystal: 18, star_core: 5 },
    { void_ore: 55, prism_crystal: 80, star_core: 20 },
  ],
  tools_mirror_crystal: [
    { void_ore: 18, prism_crystal: 28 },
    { void_ore: 35, prism_crystal: 50, star_core: 12 },
  ],
  tools_super_pick_echo: [
    { void_ore: 8, prism_crystal: 14 },
    { void_ore: 40, prism_crystal: 55, star_core: 14 },
  ],
};
for (const [id, expectedRecipes] of Object.entries(exactRecipeLevels)) {
  const definition = UPGRADE_DEFS.find((upgrade) => upgrade.id === id);
  assert.deepEqual(
    Array.from({ length: definition.maxLevel }, (_unused, level) => getUpgradeRecipe(definition, level)),
    expectedRecipes,
    `${id} must retain its staged exact-material balance`,
  );
}
assert.deepEqual(
  getUpgradeRecipe(UPGRADE_DEFS.find((definition) => definition.id === "tools_iron_pick"), 0),
  { copper: 2, coal: 3, iron: 1 },
  "the first tool tier must soften the opening iron/copper bottleneck",
);
assert.deepEqual(
  getUpgradeRecipe(UPGRADE_DEFS.find((definition) => definition.id === "tools_steel_pick"), 0),
  { iron: 4, coal: 8 },
  "the steel pick must end the iron wait without depending on a later material",
);
assert.deepEqual(
  getUpgradeRecipe(UPGRADE_DEFS.find((definition) => definition.id === "tools_pneumatic_pick"), 0),
  { silver: 4, amber: 9 },
  "the pneumatic gate must stop competing for scarce opening iron",
);
assert.deepEqual(
  getUpgradeRecipe(UPGRADE_DEFS.find((definition) => definition.id === "tools_balanced_handle"), 2),
  { iron: 4, amber: 2 },
  "the handle rank shared by pneumatic and time branches must not force a lift run back to copper and coal",
);
for (const id of [
  "sense_instinct_spark",
  "dig_arm_swing",
  "power_sharpened_edge",
  "fortune_prospector_ledger",
  "tools_balanced_handle",
]) {
  const definition = UPGRADE_DEFS.find((upgrade) => upgrade.id === id);
  assert.deepEqual(
    Object.keys(getUpgradeRecipe(definition, definition.maxLevel - 1)).sort(),
    ["amethyst", "gold"],
    `${id}'s late ranks must wait for the T6–T7 economy instead of draining current midgame shortages`,
  );
}
for (const id of [
  "gadgets_drone_drill",
  "power_geologist_force",
  "gadgets_drone_battery",
  "gadgets_volatile_jackpot",
  "power_diamond_tip",
]) {
  const definition = UPGRADE_DEFS.find((upgrade) => upgrade.id === id);
  const finalRecipe = getUpgradeRecipe(definition, definition.maxLevel - 1);
  assert.ok(
    !finalRecipe.copper && !finalRecipe.coal && !finalRecipe.iron,
    `${id}'s final rank must be farmable in its current strata instead of forcing an opening-resource detour`,
  );
}
const laserRange = UPGRADE_DEFS.find((definition) => definition.id === "tools_laser_range");
assert.ok(
  !getUpgradeRecipe(laserRange, laserRange.maxLevel - 1).star_core,
  "repeatable laser tuning must not wait and collapse into the first star-core haul",
);
const finalUpgrade = UPGRADE_DEFS.find((definition) => definition.id === "core_bon_voyage");
assert.equal(
  finalUpgrade.requiresBestDepth,
  1600,
  "the Solar Drill must join the descent near the final formation instead of idling through half the laser act",
);
const capstoneRecipes = {
  sense_earth_call: { prism_crystal: 56, void_ore: 24 },
  dig_quarry_presence: { prism_crystal: 69, star_core: 6 },
  power_mountain_splitter: { prism_crystal: 64, void_ore: 26 },
  time_thirty_second_oath: { void_ore: 30, star_core: 7 },
  gadgets_demolition_orchestra: { void_ore: 47, star_core: 6 },
  tools_solar_drill: { prism_crystal: 47, void_ore: 29 },
  fortune_motherlode_covenant: { prism_crystal: 76, star_core: 6 },
};
const capstoneTotals = { prism_crystal: 0, void_ore: 0, star_core: 0 };
for (const [id, expectedRecipe] of Object.entries(capstoneRecipes)) {
  const recipe = getUpgradeRecipe(UPGRADE_DEFS.find((definition) => definition.id === id), 0);
  assert.deepEqual(recipe, expectedRecipe, `${id} must retain its deep-only capstone recipe`);
  for (const oreId of Object.keys(capstoneTotals)) capstoneTotals[oreId] += recipe[oreId] || 0;
}
assert.deepEqual(
  capstoneTotals,
  { prism_crystal: 312, void_ore: 156, star_core: 25 },
  "the seven capstone waves must keep their aggregate late-ore budget",
);
assert.deepEqual(
  getUpgradeRecipe(finalUpgrade, 0),
  { prism_crystal: 40, void_ore: 22, star_core: 5 },
  "the final recipe must stay multi-ore without creating a second late grind after seven capstones",
);
assert.deepEqual(
  {
    prism_crystal: capstoneTotals.prism_crystal + getUpgradeRecipe(finalUpgrade, 0).prism_crystal,
    void_ore: capstoneTotals.void_ore + getUpgradeRecipe(finalUpgrade, 0).void_ore,
    star_core: capstoneTotals.star_core + getUpgradeRecipe(finalUpgrade, 0).star_core,
  },
  { prism_crystal: 352, void_ore: 178, star_core: 30 },
  "capstones plus Solar Drill must retain the final accumulation budget",
);
const prismCondenser = UPGRADE_DEFS.find((definition) => definition.id === "tools_solar_drill");
assert.ok(prismCondenser && finalUpgrade, "the late tool branch must retain both the Prism Condenser and Solar Drill");
assert.notEqual(prismCondenser.name, finalUpgrade.name, "the preparatory module and the finale tool must be distinct upgrades");
assert.equal(FINAL_LAYER_TY, WORLD_CONFIG.HEIGHT - WORLD_CONFIG.BEDROCK_ROWS - 1, "the planetary seal must occupy the final mineable row");
assert.equal(FINAL_SEAL_HITS, 3, "the planetary seal must require three Solar Drill finishes");
assert.deepEqual(
  getUpgradeRecipe(UPGRADE_DEFS.find((definition) => definition.id === "tools_super_pick_echo"), 0),
  { void_ore: 8, prism_crystal: 14 },
  "the first echo must bridge the void/prism laser act instead of waiting for the first star-core windfall",
);

for (const id of [
  "power_corebreaker",
  "power_one_hit_legend",
  "power_sample_calibration",
  "gadgets_shock_capsule",
  "gadgets_geo_charge",
  "tools_super_pick_echo",
  "fortune_triple_seam",
]) {
  const definition = UPGRADE_DEFS.find((upgrade) => upgrade.id === id);
  for (let level = 0; level < definition.maxLevel; level += 1) {
    const recipe = getUpgradeRecipe(definition, level);
    assert.ok(
      !recipe.copper && !recipe.coal && !recipe.iron && !recipe.amber,
      `${id} level ${level + 1} must use phase-appropriate ore instead of draining opening resources`,
    );
  }
}
const scoutDrone = UPGRADE_DEFS.find((definition) => definition.id === "gadgets_scout_drone");
const droneBattery = UPGRADE_DEFS.find((definition) => definition.id === "gadgets_drone_battery");
const droneDrill = UPGRADE_DEFS.find((definition) => definition.id === "gadgets_drone_drill");
const droneSwarm = UPGRADE_DEFS.find((definition) => definition.id === "gadgets_drone_swarm");
assert.deepEqual(getUpgradeRecipe(scoutDrone, 0), { iron: 1, coal: 3, copper: 4 });
const baseDroneStats = calculateMetaStats({});
assert.equal(baseDroneStats.dronePower, 0.75);
assert.equal(baseDroneStats.droneSpeed, 1.3);
assert.equal(baseDroneStats.droneLifetime, 0.75);
const scoutDroneStats = calculateMetaStats({ gadgets_scout_drone: 1 });
assert.equal(scoutDroneStats.droneUnlocked, true);
assert.equal(scoutDroneStats.droneCount, 1);
assert.equal(calculateMetaStats({ gadgets_drone_battery: 3 }).droneLifetime, 1);
assert.equal(calculateMetaStats({ gadgets_drone_drill: 4 }).dronePower, 2.55);
const fullDroneStats = calculateMetaStats({
  gadgets_scout_drone: 1,
  gadgets_drone_battery: 3,
  gadgets_drone_drill: 4,
  gadgets_drone_swarm: 3,
});
assert.equal(fullDroneStats.droneCount, 4);
assert.equal(fullDroneStats.dronePower, 2.55);
assert.equal(fullDroneStats.droneSpeed, 1.75);
assert.equal(fullDroneStats.droneLifetime, 1);
const baseDroneDpsShare = (
  scoutDroneStats.droneCount
  * scoutDroneStats.droneSpeed
  * scoutDroneStats.dronePower
  * scoutDroneStats.droneLifetime
) / (scoutDroneStats.pickPower * scoutDroneStats.digSpeed);
assert.ok(
  baseDroneDpsShare >= 0.3,
  `the first visible drone must contribute at least 30% of base miner DPS, got ${baseDroneDpsShare}`,
);
assert.deepEqual(
  Array.from({ length: droneBattery.maxLevel }, (_, level) => getUpgradeRecipe(droneBattery, level)),
  [{ iron: 3, coal: 5 }, { amber: 5, iron: 8 }, { silver: 4, amber: 8 }],
  "drone autonomy must grow one geological layer at a time",
);
assert.deepEqual(
  Array.from({ length: droneDrill.maxLevel }, (_, level) => getUpgradeRecipe(droneDrill, level)),
  [
    { iron: 4, coal: 5 },
    { amber: 5, iron: 7 },
    { silver: 5, amber: 8 },
    { gold: 3, silver: 8 },
  ],
  "drone power ranks must remain relevant from iron through gold",
);
assert.deepEqual(
  Array.from({ length: droneSwarm.maxLevel }, (_, level) => getUpgradeRecipe(droneSwarm, level)),
  [{ amber: 5, iron: 8 }, { silver: 6, amber: 10 }, { gold: 4, silver: 10 }],
  "the visible swarm must arrive before the laser economy",
);

const timerNodes = UPGRADE_DEFS.filter((definition) => definition.category === "time");
assert.deepEqual(
  timerNodes.map((definition) => definition.id),
  ["time_extra_breath", "time_clockwork_heart", "time_capsule", "time_thirty_second_oath"],
  "timer progression must stay condensed into exactly four meaningful nodes",
);
assert.equal(timerNodes.reduce((sum, definition) => sum + definition.maxLevel, 0), 23);

const removedDuplicateIds = [
  "sense_ore_scent",
  "sense_wide_sweep",
  "dig_long_handle",
  "dig_relentless_rhythm",
  "power_weighted_head",
  "tools_laser_lens",
  "fortune_ore_appraisal",
  "time_wound_spring",
  "time_sand_reserve",
  "time_stolen_second",
  "time_overtime_protocol",
  "time_frozen_moment",
  "time_aftershock_clock",
  "time_last_second",
  "time_chrono_shard",
  "time_elastic_second",
  "time_deep_shift",
  "time_keeper",
  "time_discovery_bonus",
];
for (const id of removedDuplicateIds) {
  assert.ok(!ids.has(id), `${id} must not return to the exported tree`);
}

const playerFacingSource = ["index.html", path.join("js", "game.js")]
  .map((file) => fs.readFileSync(path.join(root, file), "utf8"))
  .join("\n");
const gameSource = fs.readFileSync(path.join(root, "js", "game.js"), "utf8");
const indexSource = fs.readFileSync(path.join(root, "index.html"), "utf8");
const stylesSource = fs.readFileSync(path.join(root, "styles.css"), "utf8");
const upgradeIconDirectory = path.join(root, "assets", "icons", "upgrades");
const expectedUpgradeIcons = UPGRADE_DEFS.map((definition) => `${definition.id}.png`).sort();
const actualUpgradeIcons = fs.readdirSync(upgradeIconDirectory)
  .filter((filename) => filename.toLocaleLowerCase("en").endsWith(".png"))
  .sort();
assert.deepEqual(actualUpgradeIcons, expectedUpgradeIcons, "every upgrade must have exactly one matching PNG icon");
for (const filename of actualUpgradeIcons) {
  const png = fs.readFileSync(path.join(upgradeIconDirectory, filename));
  assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a", `${filename} must be a valid PNG`);
  assert.equal(png.readUInt32BE(16), 192, `${filename} must be 192 px wide`);
  assert.equal(png.readUInt32BE(20), 192, `${filename} must be 192 px tall`);
  assert.equal(png[25], 6, `${filename} must retain RGBA transparency`);
}
assert.match(gameSource, /assets\/icons\/upgrades/);
assert.match(gameSource, /upgradeIconAssetUrl\(definition\)/);
assert.match(gameSource, /upgrade-node__icon-fallback/);
assert.match(stylesSource, /\.upgrade-node__icon\.has-image\s+\.upgrade-node__icon-image/);
assert.doesNotMatch(
  playerFacingSource,
  /Стаж экспедиции/i,
  "expedition tenure must not remain in player-facing UI or campaign logic",
);
const spaceGuard = gameSource.match(/if\s*\(event\.code\s*===\s*["']Space["']\)\s*\{([\s\S]*?)\n\s*\}/);
assert.ok(spaceGuard, "Space must be explicitly neutralized even when a button owns focus");
assert.match(spaceGuard[1], /event\.preventDefault\(\)/);
assert.match(spaceGuard[1], /return/);
assert.doesNotMatch(spaceGuard[1], /(?:triggerSensePulse|requestRunStart|startRun)/, "Space must not trigger any game action");
assert.doesNotMatch(playerFacingSource, /(?:Пробел|<kbd>\s*Space\s*<\/kbd>)/iu, "Space must not be taught or shown");
assert.doesNotMatch(indexSource, /id=["']sectorScreen["']/i, "the removed sector picker must not return");
assert.doesNotMatch(playerFacingSource, /(?:выбери сектор|сравнение секторов|симуляций на сектор)/iu, "random geology must not be presented as a sector choice");
assert.match(indexSource, /id=["']microEventTitle["']/, "active events need one readable top-line label");
assert.match(indexSource, /id=["']microEventTimer["']/, "active events need a numeric top-line countdown");
assert.doesNotMatch(indexSource, /microEvent(?:Icon|Text|Progress)/, "the event line must not grow back into an icon, copy card, or progress bar");
assert.doesNotMatch(stylesSource, /micro-event-banner__(?:icon|copy|meter)/, "removed event-card chrome must stay removed");
assert.match(stylesSource, /\.micro-event-banner[\s\S]*?\.micro-event-banner__title[\s\S]*?\.micro-event-banner__timer[\s\S]*?\{\s*text-shadow:\s*none/, "event text must not look duplicated by a multi-layer shadow");
assert.doesNotMatch(gameSource, /events\.push\(active\)/, "consumed events must not keep a local active glow after triggering");

assert.match(
  gameSource,
  /MOBILE_UPGRADE_INTERACTION_QUERY\s*=\s*['"]\(hover: none\) and \(pointer: coarse\)['"]/,
  "mobile perk purchasing must recognize coarse touch capability",
);
assert.match(gameSource, /MOBILE_UPGRADE_NARROW_WIDTH\s*=\s*640[\s\S]*?window\.innerWidth\s*<=\s*MOBILE_UPGRADE_NARROW_WIDTH/, "the narrow mobile layout must use the same explicit purchase controls even when pointer emulation is unavailable");
assert.match(indexSource, /class=["']upgrade-footer__desktop-hint["']/);
assert.match(indexSource, /class=["']upgrade-footer__mobile-hint["']/);
assert.match(indexSource, /покупка только кнопкой «КУПИТЬ»/u, "the mobile workshop must explain its explicit purchase action");
assert.match(stylesSource, /max-width:\s*640px[\s\S]*?filter:\s*none[\s\S]*?width:\s*calc\(100vw[^;]+[\s\S]*?opacity:\s*1[\s\S]*?visibility:\s*visible/, "the selected mobile perk sheet must escape the filtered 62px node and use viewport width");
assert.match(stylesSource, /font-size:\s*clamp\(11px,\s*3vw,\s*13px\)[\s\S]*?font-weight:\s*400/, "mobile perk descriptions must remain larger and normal-weight");
assert.match(stylesSource, /next-breakthrough__max[\s\S]*?min-height:\s*44px[\s\S]*?border:\s*2px solid #ffe2a0[\s\S]*?background:\s*linear-gradient\(#ffd875,\s*#d98b35\)/, "the mobile purchase action must remain a large high-contrast CTA");
assert.match(
  stylesSource,
  /#gameShell\.theme-rust-comic \.next-breakthrough__max:disabled\s*\{[\s\S]*?opacity:\s*1[\s\S]*?color:\s*#f4ecd8[\s\S]*?linear-gradient\(#596261,\s*#303838\)[\s\S]*?text-shadow:\s*0 2px 0 #111819/,
  "the disabled Buy action must stay grey while retaining fully opaque readable text",
);
assert.doesNotMatch(
  stylesSource,
  /next-breakthrough__max:disabled\s*\{\s*opacity:\s*0\./,
  "no disabled Buy rule may fade its label back below full opacity",
);
assert.doesNotMatch(indexSource, /pinSelectedUpgrade|ЗАКРЕПИТЬ|СНЯТЬ ЦЕЛЬ|СМЕНИТЬ ЦЕЛЬ/u, "perk target pinning must be absent from the workshop UI");
assert.doesNotMatch(gameSource, /save\.pinnedUpgradeId|ui\.pinSelectedUpgrade|classList\.toggle\(['"]is-pinned/, "perk target pinning must have no runtime behavior");
assert.doesNotMatch(stylesSource, /next-breakthrough__pin|upgrade-node\.is-pinned/, "removed pin controls must leave no visual state behind");
assert.match(gameSource, /delete merged\.pinnedUpgradeId;/, "legacy saves must discard the removed pin field on load");
assert.match(indexSource, /ВЫБРАННЫЙ УЗЕЛ/u, "the remaining purchase panel must describe the current selection, not a persistent goal");
assert.match(stylesSource, /@media \(hover: none\) and \(pointer: coarse\)[\s\S]*?upgrade-footer__desktop-hint[\s\S]*?display:\s*none[\s\S]*?upgrade-footer__mobile-hint[\s\S]*?display:\s*block/, "desktop and mobile workshop instructions must never be shown as one mixed control scheme");
assert.match(indexSource, /id=["']mobileOreFocusToggle["'][\s\S]*?aria-controls=["']mobileOreFocusSheet["']/, "touch workshops need a stable focus control outside the capped toolbar");
assert.match(indexSource, /id=["']mobileOreFocusChoices["']/, "the touch focus sheet needs explicit discovered-ore choices");
assert.match(stylesSource, /@media \(hover: none\) and \(pointer: coarse\)[\s\S]*?\.upgrade-toolbar \.ore-focus-panel\s*\{\s*display:\s*none[\s\S]*?\.mobile-ore-focus:not\(\.hidden\)[\s\S]*?display:\s*block/, "touch focus must replace, not duplicate, the desktop toolbar panel");
assert.match(stylesSource, /\.mobile-ore-focus__toggle\s*\{[\s\S]*?min-height:\s*54px/, "the mobile focus control must remain an obvious touch target");
assert.match(stylesSource, /\.mobile-ore-focus__choice\s*\{[\s\S]*?min-height:\s*48px/, "ore choices in the mobile sheet must remain touch sized");
assert.match(gameSource, /mobileOreFocusIsRelevant[\s\S]*?save\.levels\.tools_steel_pick/, "steel-tier players need a visible explanation of the approaching focus mechanic");
assert.match(gameSource, /mobileOreFocusToggle\?\.addEventListener\(['"]click['"],\s*activateMobileOreFocusControl\)/, "the mobile focus control must not be coupled to direct perk purchasing");
assert.match(indexSource, /id=["']resumeRun["'][^>]*>ПРОДОЛЖИТЬ</u, "touch-only players need an explicit way out of a visibility pause");
assert.match(stylesSource, /\.pause-overlay__resume\s*\{[\s\S]*?min-height:\s*52px/, "the mobile resume action must be a large touch target");
assert.match(stylesSource, /@media \(hover: none\) and \(pointer: coarse\)[\s\S]*?\.pause-overlay__desktop-copy\s*\{\s*display:\s*none[\s\S]*?\.pause-overlay__resume\s*\{[\s\S]*?display:\s*inline-flex/, "mobile pause copy must not instruct the player to press Esc");
assert.match(gameSource, /resumeRun\?\.addEventListener\(['"]click['"],\s*\(\)\s*=>\s*togglePause\(false\)\)/, "the resume button must explicitly clear pause without auto-resuming on visibility return");
assert.match(indexSource, /id=["']focusHud["'][\s\S]*?role=["']status["']/, "the in-run focus must be a passive status readout");
assert.doesNotMatch(indexSource, /id=["']runOreFocusBackdrop["']|id=["']runOreFocusChoices["']/, "focus must not be switched from an active shift");
assert.doesNotMatch(gameSource, /focusHud\?\.addEventListener\(['"]click['"]/, "the in-run focus HUD must not install a change action");
assert.match(stylesSource, /\.focus-hud\s*\{[\s\S]*?left:\s*50%[\s\S]*?transform:\s*translateX\(-50%\)/, "focus status must sit bottom-centre instead of over the field guide");
assert.match(indexSource, /id=["']endingResetProgress["']/, "the completed comic must offer a progress reset");
assert.match(gameSource, /endingResetProgress\?\.addEventListener\(['"]click['"],\s*resetAllProgress\)/, "the ending reset action must use the normal progress reset path");
assert.match(gameSource, /version:\s*15/, "the final-seal state must be persisted in schema v15");
assert.match(indexSource, /id=["']startUpgrades["']/, "the title screen needs a direct workshop entry");
assert.match(gameSource, /startUpgrades\?\.addEventListener\(['"]click['"],\s*openUpgradeScreen\)/, "the title workshop button must open the existing upgrade screen");
assert.match(gameSource, /function selectUpgradeInPlace\(id\)[\s\S]*?renderNextBreakthrough\(\);[\s\S]*?return true;/, "perk selection must update the mounted tree in place");
assert.match(gameSource, /path\.dataset\.fromUpgrade\s*=\s*parentId;[\s\S]*?path\.dataset\.toUpgrade\s*=\s*child\.id;/, "mounted edges need stable endpoints for in-place focus updates");
assert.doesNotMatch(
  gameSource,
  /const node = event\.target\.closest\(['"]\[data-upgrade-id\]['"]\);[\s\S]{0,260}?renderUpgrades\(\);/,
  "a simple perk click must not rebuild the full tree",
);
assert.match(stylesSource, /\.result-header h2[\s\S]*?\.micro-event-banner[\s\S]*?\{\s*text-shadow:\s*none/, "the result heading must remain readable without a same-colour duplicate shadow");
assert.match(indexSource, /class=["'][^"']*theme-rust-comic/);
assert.match(indexSource, /styles\.css\?v=visual-redux-2/);
assert.match(indexSource, /js\/upgrades\.js\?v=visual-redux-2/);
assert.match(indexSource, /js\/world\.js\?v=visual-redux-2/);
assert.match(indexSource, /js\/music\.js\?v=visual-redux-2/);
assert.match(indexSource, /js\/game\.js\?v=visual-redux-2/);
assert.ok(
  indexSource.indexOf('js/music.js?v=visual-redux-2') < indexSource.indexOf('js/game.js?v=visual-redux-2'),
  "the soundtrack singleton must load before the game audio engine",
);
assert.match(indexSource, /id=["']soundToggle["'][\s\S]*?aria-pressed=["']true["']/);
assert.match(indexSource, /ПОЛЯРНАЯ ЖИЛА/u, "the original track needs a visible player-facing title");
assert.match(gameSource, /window\.DepthZeroMusic/);
assert.match(gameSource, /music\?\.setEnabled\?\./);
assert.match(gameSource, /soundToggle\?\.addEventListener\(['"]click['"],\s*toggleSoundPreference\)/);
assert.match(stylesSource, /\.utility-nav__button--audio\s*\{/);
assert.match(stylesSource, /\.utility-nav\.is-suppressed \.utility-nav__button:not\(\.utility-nav__button--audio\)/, "the music control must remain available during a run");

const oreRenderStyleBlock = gameSource.match(/const ORE_RENDER_STYLES = Object\.freeze\(\{([\s\S]*?)\n\}\);/);
assert.ok(oreRenderStyleBlock, "the environment renderer must keep an explicit ore-material table");
for (const ore of ORE_TYPES) {
  assert.match(
    oreRenderStyleBlock[1],
    new RegExp(`\\b${ore.id}:\\s*Object\\.freeze\\(\\{[^}]*material:`),
    `${ore.id} needs a silhouette/material profile instead of colour-only rendering`,
  );
}
const oreRenderer = gameSource.match(/function drawOreInTile\([\s\S]*?\n\}\n\nfunction drawCracks/);
assert.ok(oreRenderer, "the ore renderer must remain available to the canvas pass");
assert.match(oreRenderer[0], /ORE_RENDER_STYLES\[ore\.id\]/, "ore material profiles must drive the live renderer");
assert.doesNotMatch(oreRenderer[0], /drawRuntimeVein/, "connectors need their own global pass below every ore node");
assert.match(gameSource, /function drawVisibleVeinNetwork\(/, "the authored vein atlas must connect matching ore nodes");
assert.match(gameSource, /function buildVeinEdgePolyline\(/, "veins must use deterministic broken-line geometry");
assert.match(
  gameSource,
  /drawTile\(entry, now, 'terrain', oreVisualStates\);[\s\S]*drawVisibleVeinNetwork\(visible, oreVisualStates\);[\s\S]*drawTile\(entry, now, 'overlay', oreVisualStates\);/,
  "veins must render as one network before every ore node",
);
assert.doesNotMatch(oreRenderer[0], /verticalOreEdgeOffset|horizontalOreEdgeOffset/, "old random line offsets must not return");
assert.doesNotMatch(oreRenderer[0], /ctx\.lineTo\(/, "old procedural vein strokes must stay removed");
assert.match(gameSource, /tile\.oreId !== oreId[\s\S]*tile\.veinId !== veinId/, "connectors must require both ore and vein identity");
assert.match(gameSource, /for \(const \[offsetX, offsetY\] of \[\[1, 0\], \[0, 1\]\]\)/, "each cardinal edge must draw exactly once");
assert.match(gameSource, /FIELD_ORE_NODE_MIN_SIZE \+ tier \* FIELD_ORE_NODE_TIER_STEP/);
assert.match(oreRenderer[0], /const glowTier = clamp\(\(ore\.tier \|\| 0\) - 2/, "zero-based T4+ ore should receive geological glow");
assert.match(oreRenderer[0], /globalCompositeOperation = 'lighter'/, "high-tier glow must remain a local additive pass");
assert.doesNotMatch(oreRenderer[0], /fillRect\(0, 0, (?:width|state\.viewport)/, "ore glow must never become a full-screen wash");

const terrainRenderer = gameSource.match(/function terrainDepthFactor\([\s\S]*?\n\}\n\nfunction drawBackground/);
assert.ok(terrainRenderer, "depth landmarks must stay grouped in the terrain render pass");
for (const marker of ["rootSeed", "fossilSeed", "supportSeed", "cableSeed", "crystalSeed"]) {
  assert.match(terrainRenderer[0], new RegExp(`\\b${marker}\\b`), `${marker} landmark must remain deterministic`);
}
assert.match(terrainRenderer[0], /GEO_COMIC_COLORS\.damp/, "wet strata need a distinct material cue");
assert.doesNotMatch(terrainRenderer[0], /Math\.random/, "terrain landmarks must not shimmer or move between frames");

const routeCalibrationWorld = new MineWorld(ORE_TYPES, "route-calibration-probe");
let focusedRouteTile = null;
let ordinaryRouteTile = null;
for (let ty = 1; ty < WORLD_CONFIG.HEIGHT - 1 && (!focusedRouteTile || !ordinaryRouteTile); ty += 1) {
  for (let tx = 1; tx < WORLD_CONFIG.WIDTH - 1 && (!focusedRouteTile || !ordinaryRouteTile); tx += 1) {
    const tile = routeCalibrationWorld.getTile(tx, ty);
    if (!tile || tile.kind === "air" || tile.kind === "bedrock") continue;
    if (tile.oreId && !focusedRouteTile) focusedRouteTile = { tx, ty, tile };
    if (!tile.oreId && !ordinaryRouteTile) ordinaryRouteTile = { tx, ty, tile };
  }
}
assert.ok(focusedRouteTile && ordinaryRouteTile);
const baseRouteOptions = {
  moveSpeed: 100,
  digPowerPerSecond: 10,
  hardnessMultiplier: 1,
  focusedOreId: focusedRouteTile.tile.oreId,
  focusedOreDigMultiplier: 1,
};
const calibratedRouteOptions = { ...baseRouteOptions, focusedOreDigMultiplier: 2 };
const routeStepFrom = (point) => ({ tx: point.tx - 1, ty: point.ty });
assert.ok(
  routeCalibrationWorld._routeStepCost(routeStepFrom(focusedRouteTile), focusedRouteTile, calibratedRouteOptions)
    < routeCalibrationWorld._routeStepCost(routeStepFrom(focusedRouteTile), focusedRouteTile, baseRouteOptions),
  "focused calibration must reduce only the focused ore step cost",
);
assert.equal(
  routeCalibrationWorld._routeStepCost(routeStepFrom(ordinaryRouteTile), ordinaryRouteTile, calibratedRouteOptions),
  routeCalibrationWorld._routeStepCost(routeStepFrom(ordinaryRouteTile), ordinaryRouteTile, baseRouteOptions),
  "focused calibration must not soften ordinary route tiles",
);

let checkedRoutes = 0;
let checkedVeins = 0;
const countLiveOreTiles = (world) => {
  let count = 0;
  world.forEachOreTileInBounds(
    0,
    0,
    WORLD_CONFIG.WIDTH - 1,
    WORLD_CONFIG.HEIGHT - 1,
    () => {
      count += 1;
    },
  );
  return count;
};
const cardinallyReachableCount = (coordinateKeys) => {
  const remaining = new Set(coordinateKeys);
  const first = remaining.values().next().value;
  if (!first) return 0;
  const queue = [first];
  remaining.delete(first);
  let reachable = 0;
  while (queue.length) {
    const coordinate = queue.pop();
    reachable += 1;
    const [tx, ty] = coordinate.split(":").map(Number);
    for (const [offsetX, offsetY] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const neighbour = `${tx + offsetX}:${ty + offsetY}`;
      if (!remaining.delete(neighbour)) continue;
      queue.push(neighbour);
    }
  }
  return reachable;
};
for (let seed = 1; seed <= 50; seed += 1) {
  const world = new MineWorld(ORE_TYPES, `stress-${seed}`);
  const lift = world.getLiftStart(120, 0.35, 120, { unlockedTierCap: 9 });
  assert.ok(lift && Number.isFinite(lift.x) && Number.isFinite(lift.y));
  assert.ok(lift.depthTiles <= 42 + 1e-9);
  assert.ok(world.getTile(lift.tx, lift.ty)?.kind === "air", "lift landing must be open");
  assert.ok(lift.target, "lift needs an authored supply target");
  const pendingTarget = world.getTile(lift.target.tx, lift.target.ty);
  assert.ok(
    pendingTarget && !["air", "bedrock"].includes(pendingTarget.kind),
    "an unused lift target must remain mineable rock",
  );
  assert.equal(pendingTarget.oreId, null, "unused lift stations must not pre-place copper");
  assert.equal(pendingTarget.veinId, null, "unused lift stations must not create singleton veins");
  assert.equal(pendingTarget.pendingLiftSupply, true, "the selected target must wait for an explicit retune");

  const oreTilesBeforeRetune = countLiveOreTiles(world);
  const supply = world.retuneLiftTarget(lift, ["copper"]);
  assert.ok(supply, "selecting a lift must move one redistributed ore node onto its target");
  assert.equal(supply.oreId, "copper");
  assert.equal(supply.liftSupply, true);
  const selectedTarget = world.getTile(lift.target.tx, lift.target.ty);
  assert.equal(selectedTarget.pendingLiftSupply, false);
  assert.equal(selectedTarget.liftSupply, true);
  assert.equal(countLiveOreTiles(world), oreTilesBeforeRetune, "lift supply must be an exact one-node swap");
  const repeatedSupply = world.retuneLiftTarget(lift, ["iron"]);
  assert.equal(repeatedSupply?.oreId, "copper", "retuning one landing twice must be idempotent");
  assert.equal(countLiveOreTiles(world), oreTilesBeforeRetune, "repeated retuning must not consume another donor");

  const beforeHp = selectedTarget.hp;
  const route = world.findLeastResistanceStep(lift, lift.target, {
    moveSpeed: 100,
    digPowerPerSecond: 8,
    maxDetourTiles: 9,
  });
  assert.ok(route && route.waypoint && route.route.length >= 1);
  assert.equal(world.getTile(lift.target.tx, lift.target.ty).hp, beforeHp, "route search must be read-only");
  checkedRoutes += 1;

  let oreTiles = 0;
  let firstOreCoordinate = null;
  const veins = new Map();
  for (let ty = 0; ty < WORLD_CONFIG.HEIGHT; ty += 1) {
    for (let tx = 0; tx < WORLD_CONFIG.WIDTH; tx += 1) {
      const tile = world.getTile(tx, ty);
      if (!tile?.oreId) continue;
      oreTiles += 1;
      if (!firstOreCoordinate) firstOreCoordinate = { tx, ty };
      assert.ok(tile.veinId, `ore tile ${tx}:${ty} must keep a vein id`);
      const vein = veins.get(tile.veinId) || { oreId: tile.oreId, cells: new Set() };
      assert.equal(
        vein.oreId,
        tile.oreId,
        `vein ${tile.veinId} must not contain conflicting ore types`,
      );
      const coordinate = `${tx}:${ty}`;
      assert.ok(!vein.cells.has(coordinate), `vein ${tile.veinId} repeats cell ${coordinate}`);
      vein.cells.add(coordinate);
      veins.set(tile.veinId, vein);
    }
  }
  assert.ok(oreTiles > 0);
  for (const [veinId, vein] of veins) {
    assert.ok(vein.cells.size > 0, "every generated vein must own at least one unique cell");
    assert.equal(
      cardinallyReachableCount(vein.cells),
      vein.cells.size,
      `vein ${veinId} must be one cardinally connected network`,
    );
    checkedVeins += 1;
  }

  let indexedOreTiles = 0;
  let previousIndex = -1;
  world.forEachOreTileInBounds(0, 0, WORLD_CONFIG.WIDTH - 1, WORLD_CONFIG.HEIGHT - 1, (_tile, tx, ty) => {
    const index = ty * WORLD_CONFIG.WIDTH + tx;
    assert.ok(index > previousIndex, "ore index must preserve row-major tie-breaking order");
    previousIndex = index;
    indexedOreTiles += 1;
  });
  assert.equal(indexedOreTiles, oreTiles, "ore index must enumerate every live ore tile exactly once");
  assert.ok(firstOreCoordinate);
  world.breakTile(firstOreCoordinate.tx, firstOreCoordinate.ty);
  let indexedAfterBreak = 0;
  world.forEachOreTileInBounds(0, 0, WORLD_CONFIG.WIDTH - 1, WORLD_CONFIG.HEIGHT - 1, () => {
    indexedAfterBreak += 1;
  });
  assert.equal(indexedAfterBreak, oreTiles - 1, "broken ore must leave the live index immediately");
}

// Force deterministic frontier selection. The cardinal vein grower must still
// place the requested number of unique connected cells, and _applyOre must
// never be called twice for the same cell merely to inflate the returned count.
const duplicateWorld = new MineWorld(ORE_TYPES, "duplicate-walk-probe");
const richestDefinition = duplicateWorld._oreDefinitions.reduce((richest, definition) => (
  !richest || definition.rank > richest.rank ? definition : richest
), null);
const requestedSize = 7;
let probeOrigin = null;
for (let ty = 2; ty < WORLD_CONFIG.HEIGHT - WORLD_CONFIG.BEDROCK_ROWS - 2 && !probeOrigin; ty += 1) {
  for (let tx = 2; tx < WORLD_CONFIG.WIDTH - 2 && !probeOrigin; tx += 1) {
    const tile = duplicateWorld.getTile(tx, ty);
    if (!tile || tile.kind === "air" || tile.kind === "bedrock" || tile.oreId) continue;
    if (!duplicateWorld._canOreAppearAt(tx, ty, richestDefinition)) continue;
    let nearbySolid = 0;
    for (let offsetY = -3; offsetY <= 3; offsetY += 1) {
      for (let offsetX = -3; offsetX <= 3; offsetX += 1) {
        if (Math.abs(offsetX) + Math.abs(offsetY) > 3) continue;
        const nearby = duplicateWorld.getTile(tx + offsetX, ty + offsetY);
        if (
          nearby
          && nearby.kind !== "air"
          && nearby.kind !== "bedrock"
          && !nearby.oreId
          && duplicateWorld._canOreAppearAt(tx + offsetX, ty + offsetY, richestDefinition)
        ) nearbySolid += 1;
      }
    }
    if (nearbySolid >= requestedSize) probeOrigin = { tx, ty };
  }
}
assert.ok(probeOrigin, "duplicate-walk probe needs a sufficiently solid origin");

const expectedVeinId = `${richestDefinition.id}:${duplicateWorld._nextVeinId}`;
const originalNext = duplicateWorld._rng.next;
const originalApplyOre = duplicateWorld._applyOre;
let probeApplyCalls = 0;
duplicateWorld._rng.next = () => 0;
duplicateWorld._applyOre = function applyOreProbe(...args) {
  if (args[3] === expectedVeinId) probeApplyCalls += 1;
  return originalApplyOre.apply(this, args);
};
const uniquePlaced = duplicateWorld._placeVein(
  probeOrigin.tx,
  probeOrigin.ty,
  richestDefinition,
  requestedSize,
);
duplicateWorld._rng.next = originalNext;
duplicateWorld._applyOre = originalApplyOre;

let actualProbeCells = 0;
const actualProbeCoordinates = new Set();
for (let ty = 0; ty < WORLD_CONFIG.HEIGHT; ty += 1) {
  for (let tx = 0; tx < WORLD_CONFIG.WIDTH; tx += 1) {
    if (duplicateWorld.getTile(tx, ty)?.veinId !== expectedVeinId) continue;
    actualProbeCells += 1;
    actualProbeCoordinates.add(`${tx}:${ty}`);
  }
}
assert.equal(uniquePlaced, requestedSize, "cardinal growth must complete the requested vein");
assert.equal(actualProbeCells, uniquePlaced, "reported vein size must equal its unique world cells");
assert.equal(probeApplyCalls, uniquePlaced, "duplicate visits must not reapply or recount the same cell");
assert.equal(
  cardinallyReachableCount(actualProbeCoordinates),
  actualProbeCells,
  "a newly placed procedural vein must form one cardinal network",
);

const deterministicA = new MineWorld(ORE_TYPES, "determinism-probe");
const deterministicB = new MineWorld(ORE_TYPES, "determinism-probe");
assert.deepEqual(deterministicA.surface, deterministicB.surface, "same seed must reproduce the surface");
for (let ty = 0; ty < WORLD_CONFIG.HEIGHT; ty += 1) {
  for (let tx = 0; tx < WORLD_CONFIG.WIDTH; tx += 1) {
    assert.deepEqual(
      deterministicA.getTile(tx, ty),
      deterministicB.getTile(tx, ty),
      `same seed must reproduce tile ${tx}:${ty}`,
    );
  }
}

console.log(JSON.stringify({
  ok: true,
  nodes: UPGRADE_DEFS.length,
  levels: UPGRADE_DEFS.reduce((sum, definition) => sum + definition.maxLevel, 0),
  seeds: 50,
  checkedRoutes,
  checkedVeins,
  duplicateWalkCells: actualProbeCells,
}));
