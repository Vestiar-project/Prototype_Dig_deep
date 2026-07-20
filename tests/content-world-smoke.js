"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

global.window = global;
const root = path.resolve(__dirname, "..");
require(path.join(root, "js", "upgrades.js"));
require(path.join(root, "js", "world.js"));

const { UPGRADE_DEFS, ORE_TYPES, calculateMetaStats, getUpgradeRecipe } = global.DepthZeroUpgrades;
const { MineWorld, WORLD_CONFIG } = global.DepthZeroWorld;
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
  /\bÑƒÐ·(?:ÐµÐ»|Ð»Ð°|Ð»Ðµ|Ð»Ð¾Ð¼|Ð»Ñ‹|Ð»Ð¾Ð²|Ð»Ð°Ð¼|Ð»Ð°Ð¼Ð¸|Ð»Ð°Ñ…)\b/iu,
  /\bÐ¾Ð±ÑŠÐµÐ´Ð¸Ð½(?:ÑÐµÑ‚|ÑÑŽÑ‚|Ñ‘Ð½|ÐµÐ½Ð°|ÐµÐ½Ð¾|ÐµÐ½Ñ‹|ÐµÐ½Ñ‹Ð¼Ð¸)\b/iu,
  /\bÐ¿Ñ€ÐµÐ¶Ð½(?:Ð¸Ð¹|ÑÑ|ÐµÐµ|Ð¸Ðµ|ÐµÐ³Ð¾|ÐµÐ¹|Ð¸Ñ…|Ð¸Ð¼|Ð¸Ð¼Ð¸|ÑŽÑŽ)\b/iu,
  /\b(?:Ñ€Ð°Ð½ÑŒÑˆÐµ|Ñ€Ð°Ð½ÐµÐµ)\b/iu,
  /\b(?:Ñ‚ÐµÑ…Ð½Ð¸Ñ‡ÐµÑÐº|Ð±Ð°Ð»Ð°Ð½ÑÐ¸Ñ€Ð¾Ð²Ð¾Ñ‡Ð½|Ñ€ÐµÑ„Ð°ÐºÑ‚Ð¾Ñ€Ð¸Ð½Ð³|Ð¿ÐµÑ€ÐµÑ€Ð°Ð±Ð¾Ñ‚Ðº)\w*/iu,
  /\bÐ·Ð°Ð¼ÐµÐ½Ñ(?:ÐµÑ‚|ÑŽÑ‚)\s+(?:Ð½ÐµÑÐºÐ¾Ð»ÑŒÐºÐ¾|ÑÑ‚Ð°Ñ€\w*)\b/iu,
  /\bÑÑ‚Ð°Ñ€\w*\s+(?:Ð²ÐµÑ€ÑÐ¸\w*|Ð¿ÐµÑ€Ðº\w*|ÑƒÐ»ÑƒÑ‡ÑˆÐµÐ½Ð¸\w*|ÑƒÐ·Ð»\w*)\b/iu,
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
const oreFocus = UPGRADE_DEFS.find((definition) => definition.id === "sense_ore_focus");
assert.equal(oreFocus?.requiresOreDiscovery, "silver", "ore focus must unlock after the first T5 sample");
assert.deepEqual(
  oreFocus?.recipeOverride,
  { silver: 5, iron: 4 },
  "ore focus should turn an existing silver sample into the tool that solves amber shortages",
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
    { amethyst: 1, gold: 1, silver: 2 },
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
assert.equal(requirementLevel("power_mountain_splitter", "power_corebreaker"), 2, "fault-line access should remain behind the second corebreaker rank");
assert.equal(requirementLevel("tools_mirror_crystal", "sense_earth_call"), 0, "mirror ricochet should bridge the late gap before through-wall sense");
assert.deepEqual(
  getUpgradeRecipe(UPGRADE_DEFS.find((definition) => definition.id === "time_capsule"), 0),
  { amber: 7, iron: 9, coal: 8 },
  "the first capsule should retain its calibrated mixed opening recipe",
);
assert.deepEqual(
  getUpgradeRecipe(UPGRADE_DEFS.find((definition) => definition.id === "sense_seismic_memory"), 0),
  { silver: 3, amber: 1, iron: 7 },
  "seismic memory should not join every other midgame mechanic behind the same amber cache",
);
assert.deepEqual(
  getUpgradeRecipe(UPGRADE_DEFS.find((definition) => definition.id === "sense_deep_resonance"), 0),
  { silver: 2, amber: 1, iron: 5 },
  "deep resonance should keep its value while replacing the stochastic four-amber wall",
);
assert.deepEqual(
  getUpgradeRecipe(UPGRADE_DEFS.find((definition) => definition.id === "sense_deep_resonance"), 1),
  { silver: 30, amber: 40, iron: 68 },
  "the second depth-sector rank should keep its value without waiting for the first gold cache",
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
  { silver: 3, amber: 1, iron: 5 },
  "sticky charges should trade the amber bottleneck for an equivalently valuable silver-led recipe",
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
  { void_ore: 45, prism_crystal: 60, amethyst: 40 },
  "mirror crystal should retain the calibrated resource order before the final tool tier",
);
const leastResistance = UPGRADE_DEFS.find((definition) => definition.id === "dig_least_resistance");
assert.deepEqual(
  leastResistance.requires,
  ["dig_sweeping_arc", "sense_echo_pulse"],
  "route planning should connect the first excavation arc to the first resonant ping",
);
assert.deepEqual(
  getUpgradeRecipe(leastResistance, 0),
  { copper: 6, coal: 6, iron: 1 },
  "route planning should use an affordable early mixed recipe",
);
assert.deepEqual(
  getUpgradeRecipe(UPGRADE_DEFS.find((definition) => definition.id === "dig_omni_swing"), 0),
  { iron: 4, amber: 1, silver: 4 },
  "impact mining should keep its weighted price without inheriting the amber drought",
);
const mineLift = UPGRADE_DEFS.find((definition) => definition.id === "dig_mine_lift");
assert.ok(
  mineLift?.requires.some((requirement) => typeof requirement === "object" && requirement.id === "time_clockwork_heart" && requirement.level === 1),
  "the first lift rank should arrive with the pneumatic/T5 package",
);
assert.deepEqual(
  getUpgradeRecipe(mineLift, 0),
  { silver: 3, amber: 5 },
  "the first lift rank must shorten repeated descent before the endgame",
);
const superPick = UPGRADE_DEFS.find((definition) => definition.id === "tools_super_pick");
assert.ok(superPick?.requires.includes("power_diamond_tip"), "the super pick must keep its thematic diamond-tip gate");
assert.equal(superPick?.requiresOreDiscovery, undefined, "the super pick's explicit prerequisites should be its only discovery gate");
assert.deepEqual(
  getUpgradeRecipe(superPick, 0),
  { silver: 10, gold: 6, amethyst: 4 },
  "the super pick should bridge into deep tools without requiring prism before it can be reached",
);
assert.deepEqual(
  getUpgradeRecipe(UPGRADE_DEFS.find((definition) => definition.id === "tools_iron_pick"), 0),
  { copper: 2, coal: 3, iron: 2 },
  "the first tool tier must soften the opening iron/copper bottleneck",
);
assert.deepEqual(
  getUpgradeRecipe(UPGRADE_DEFS.find((definition) => definition.id === "tools_pneumatic_pick"), 0),
  { silver: 4, amber: 9 },
  "the pneumatic gate must stop competing for scarce opening iron",
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
    `${id}'s late ranks must wait for the T6â€“T7 economy instead of draining current midgame shortages`,
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
assert.deepEqual(
  getUpgradeRecipe(finalUpgrade, 0),
  { prism_crystal: 5300, void_ore: 1800, star_core: 260 },
  "the final recipe must preserve the calibrated multi-ore accumulation tail",
);
assert.deepEqual(
  getUpgradeRecipe(UPGRADE_DEFS.find((definition) => definition.id === "tools_super_pick_echo"), 0),
  { void_ore: 40, prism_crystal: 40, silver: 15 },
  "the echo should not lose a full shift behind cheaper cleanup ranks before the solar drill",
);

for (const id of [
  "power_corebreaker",
  "power_one_hit_legend",
  "power_sample_calibration",
  "gadgets_shock_capsule",
  "gadgets_drone_swarm",
  "gadgets_geo_charge",
  "tools_super_pick_echo",
  "fortune_×Ov¶‰žËkºwµçu½Ù••Ù•¹Ðµ…É¡É½µ”µÕÍÐÍÑ…äÉ•µ½Ù•ˆ¤ì)…ÍÍ•ÉÐ¹‘½•Í9½Ñ5…Ñ ¡…µ•M½ÕÉ”°€½•Ù•¹ÑÍp¹ÁÕÍ¡p¡…Ñ¥Ù•p¤¼°€‰½¹ÍÕµ••Ù•¹ÑÌµÕÍÐ¹½Ð­••À„±½…°…Ñ¥Ù”±½Ü…™Ñ•ÈÑÉ¥•É¥¹œˆ¤ì()…ÍÍ•ÉÐ¹µ…Ñ  (€…µ•M½ÕÉ”°(€€½5=	%1}UAI}%9QIQ%=9}EUIeqÌ¨õqÌ©lœ‰up¡¡½Ù•Èè¹½¹•p¤…¹p¡Á½¥¹Ñ•Èè½…ÉÍ•p¥lœ‰t¼°(€€‰µ½‰¥±”Á•É¬ÁÕÉ¡…Í¥¹œµÕÍÐÉ•½¹¥é”½…ÉÍ”Ñ½Õ …Á…‰¥±¥Ñäˆ°(¤ì)…ÍÍ•ÉÐ¹µ…Ñ ¡…µ•M½ÕÉ”°€½5=	%1}UAI}9II=]}]%Q!qÌ¨õqÌ¨ØÐÁmqÍqMt¨ýÝ¥¹‘½Ýp¹¥¹¹•É]¥‘Ñ¡qÌ¨ðõqÌ©5=	%1}UAI}9II=]}]%Q ¼°€‰Ñ¡”¹…ÉÉ½Üµ½‰¥±”±…å½ÕÐµÕÍÐÕÍ”Ñ¡”Í…µ”•áÁ±¥¥ÐÁÕÉ¡…Í”½¹ÑÉ½±Ì•Ù•¸Ý¡•¸Á½¥¹Ñ•È•µÕ±…Ñ¥½¸¥ÌÕ¹…Ù…¥±…‰±”ˆ¤ì)…ÍÍ•ÉÐ¹µ…Ñ ¡¥¹‘•áM½ÕÉ”°€½±…ÍÌõlˆuÕÁÉ…‘”µ™½½Ñ•É}}‘•Í­Ñ½Àµ¡¥¹Ñlˆt¼¤ì)…ÍÍ•ÉÐ¹µ…Ñ ¡¥¹‘•áM½ÕÉ”°€½±…ÍÌõlˆuÕÁÉ…‘”µ™½½Ñ•É}}µ½‰¥±”µ¡¥¹Ñlˆt¼¤ì)…ÍÍ•ÉÐ¹µ…Ñ ¡¥¹‘•áM½ÕÉ”°€¿BÿBûBëFBÿBëBÀƒFBûBïF3BëBøƒBëB÷BûBÿBëBûBäƒ
¯BkBBBcB‹B³
ì½Ô°€‰Ñ¡”µ½‰¥±”Ý½É­Í¡½ÀµÕÍÐ•áÁ±…¥¸¥ÑÌ•áÁ±¥¥ÐÁÕÉ¡…Í”…Ñ¥½¸ˆ¤ì)…ÍÍ•ÉÐ¹µ…Ñ ¡ÍÑå±•ÍM½ÕÉ”°€½µ…àµÝ¥‘Ñ éqÌ¨ØÐÁÁámqÍqMt¨ý™¥±Ñ•ÈéqÌ©¹½¹•mqÍqMt¨ýÝ¥‘Ñ éqÌ©…±p ÄÀÁÙÝmxít­mqÍqMt¨ý½Á…¥ÑäéqÌ¨ÅmqÍqMt¨ýÙ¥Í¥‰¥±¥ÑäéqÌ©Ù¥Í¥‰±”¼°€‰Ñ¡”Í•±•Ñ•µ½‰¥±”Á•É¬Í¡••ÐµÕÍÐ•Í…Á”Ñ¡”™¥±Ñ•É•€ØÉÁà¹½‘”…¹ÕÍ”Ù¥•ÝÁ½ÉÐÝ¥‘Ñ ˆ¤ì)…ÍÍ•ÉÐ¹µ…Ñ ¡ÍÑå±•ÍM½ÕÉ”°€½™½¹ÐµÍ¥é”éqÌ©±…µÁp ÄÅÁà±qÌ¨ÍÙÜ±qÌ¨ÄÍÁáp¥mqÍqMt¨ý™½¹ÐµÝ•¥¡ÐéqÌ¨ÐÀÀ¼°€‰µ½‰¥±”Á•É¬‘•ÍÉ¥ÁÑ¥½¹ÌµÕÍÐÉ•µ…¥¸±…É•È…¹¹½Éµ…°µÝ•¥¡Ðˆ¤ì)…ÍÍ•ÉÐ¹µ…Ñ ¡ÍÑå±•ÍM½ÕÉ”°€½¹•áÐµ‰É•…­Ñ¡É½Õ¡}}µ…ámqÍqMt¨ýµ¥¸µ¡•¥¡ÐéqÌ¨ÐÑÁámqÍqMt¨ý‰½É‘•ÈéqÌ¨ÉÁàÍ½±¥€™™”É„ÁmqÍqMt¨ý‰…­É½Õ¹éqÌ©±¥¹•…ÈµÉ…‘¥•¹Ñp ™™àÜÔ±qÌ¨äáˆÌÕp¤¼°€‰Ñ¡”µ½‰¥±”ÁÕÉ¡…Í”…Ñ¥½¸µÕÍÐÉ•µ…¥¸„±…É”¡¥ µ½¹ÑÉ…ÍÐQˆ¤ì)…ÍÍ•ÉÐ¹µ…Ñ ¡ÍÑå±•ÍM½ÕÉ”°€½µ•‘¥„p¡¡½Ù•Èè¹½¹•p¤…¹p¡Á½¥¹Ñ•Èè½…ÉÍ•p¥mqÍqMt¨ýÕÁÉ…‘”µ™½½Ñ•É}}‘•Í­Ñ½Àµ¡¥¹ÑmqÍqMt¨ý‘¥ÍÁ±…äéqÌ©¹½¹•mqÍqMt¨ýÕÁÉ…‘”µ™½½Ñ•É}}µ½‰¥±”µ¡¥¹ÑmqÍqMt¨ý‘¥ÍÁ±…äéqÌ©‰±½¬¼°€‰‘•Í­Ñ½À…¹µ½‰¥±”Ý½É­Í¡½À¥¹ÍÑÉÕÑ¥½¹ÌµÕÍÐ¹•Ù•È‰”Í¡½Ý¸…Ì½¹”µ¥á•½¹ÑÉ½°Í¡•µ”ˆ¤ì)…ÍÍ•ÉÐ¹µ…Ñ ¡¥¹‘•áM½ÕÉ”°€½¥õlˆuµ½‰¥±•=É•½ÕÍQ½±•lˆumqÍqMt¨ý…É¥„µ½¹ÑÉ½±Ìõlˆuµ½‰¥±•=É•½ÕÍM¡••Ñlˆt¼°€‰Ñ½Õ Ý½É­Í¡½ÁÌ¹••„ÍÑ…‰±”™½ÕÌ½¹ÑÉ½°½ÕÑÍ¥‘”Ñ¡”…ÁÁ•Ñ½½±‰…Èˆ¤ì)…ÍÍ•ÉÐ¹µ…Ñ ¡¥¹‘•áM½ÕÉ”°€½¥õlˆuµ½‰¥±•=É•½ÕÍ¡½¥•Ílˆt¼°€‰Ñ¡”Ñ½Õ ™½ÕÌÍ¡••Ð¹••‘Ì•áÁ±¥¥Ð‘¥Í½Ù•É•µ½É”¡½¥•Ìˆ¤ì)…ÍÍ•ÉÐ¹µ…Ñ ¡ÍÑå±•ÍM½ÕÉ”°€½µ•‘¥„p¡¡½Ù•Èè¹½¹•p¤…¹p¡Á½¥¹Ñ•Èè½…ÉÍ•p¥mqÍqMt¨ýp¹ÕÁÉ…‘”µÑ½½±‰…Èp¹½É”µ™½ÕÌµÁ…¹•±qÌ©qíqÌ©‘¥ÍÁ±…äéqÌ©¹½¹•mqÍqMt¨ýp¹µ½‰¥±”µ½É”µ™½ÕÌé¹½Ñp¡p¹¡¥‘‘•¹p¥mqÍqMt¨ý‘¥ÍÁ±…äéqÌ©‰±½¬¼°€‰Ñ½Õ ™½ÕÌµÕÍÐÉ•Á±…”°¹½Ð‘ÕÁ±¥…Ñ”°Ñ¡”‘•Í­Ñ½ÀÑ½½±‰…ÈÁ…¹•°ˆ¤ì)…ÍÍ•ÉÐ¹µ…Ñ ¡ÍÑå±•ÍM½ÕÉ”°€½p¹µ½‰¥±”µ½É”µ™½ÕÍ}}Ñ½±•qÌ©qímqÍqMt¨ýµ¥¸µ¡•¥¡ÐéqÌ¨ÔÑÁà¼°€‰Ñ¡”µ½‰¥±”™½ÕÌ½¹ÑÉ½°µÕÍÐÉ•µ…¥¸…¸½‰Ù¥½ÕÌÑ½Õ Ñ…É•Ðˆ¤ì)…ÍÍ•ÉÐ¹µ…Ñ ¡ÍÑå±•ÍM½ÕÉ”°€½p¹µ½‰¥±”µ½É”µ™½ÕÍ}}¡½¥•qÌ©qímqÍqMt¨ýµ¥¸µ¡•¥¡ÐéqÌ¨ÐáÁà¼°€‰½É”¡½¥•Ì¥¸Ñ¡”µ½‰¥±”Í¡••ÐµÕÍÐÉ•µ…¥¸Ñ½Õ Í¥é•ˆ¤ì)…ÍÍ•ÉÐ¹µ…Ñ ¡…µ•M½ÕÉ”°€½µ½‰¥±•=É•½ÕÍ%ÍI•±•Ù…¹ÑmqÍqMt¨ýÍ…Ù•p¹±•Ù•±Íp¹Ñ½½±Í}ÍÑ••±}Á¥¬¼°€‰ÍÑ••°µÑ¥•ÈÁ±…å•ÉÌ¹••„Ù¥Í¥‰±”•áÁ±…¹…Ñ¥½¸½˜Ñ¡”…ÁÁÉ½…¡¥¹œ™½ÕÌµ•¡…¹¥Œˆ¤ì)…ÍÍ•ÉÐ¹µ…Ñ ¡…µ•M½ÕÉ”°€½µ½‰¥±•=É•½ÕÍQ½±•pýp¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•Ép¡lœ‰u±¥­lœ‰t±qÌ©…Ñ¥Ù…Ñ•5½‰¥±•=É•½ÕÍ½¹ÑÉ½±p¤¼°€‰Ñ¡”µ½‰¥±”™½ÕÌ½¹ÑÉ½°µÕÍÐ¹½Ð‰”½ÕÁ±•Ñ¼‘¥É•ÐÁ•É¬ÁÕÉ¡…Í¥¹œˆ¤ì)…ÍÍ•ÉÐ¹µ…Ñ ¡¥¹‘•áM½ÕÉ”°€½¥õlˆuÉ•ÍÕµ•IÕ¹lˆumxùt¨ûBBƒB{BSB{BoB[BcB‹B°ð½Ô°€‰Ñ½Õ µ½¹±äÁ±…å•ÉÌ¹••…¸•áÁ±¥¥ÐÝ…ä½ÕÐ½˜„Ù¥Í¥‰¥±¥ÑäÁ…ÕÍ”ˆ¤ì)…ÍÍ•ÉÐ¹µ…Ñ ¡ÍÑå±•ÍM½ÕÉ”°€½p¹Á…ÕÍ”µ½Ù•É±…å}}É•ÍÕµ•qÌ©qímqÍqMt¨ýµ¥¸µ¡•¥¡ÐéqÌ¨ÔÉÁà¼°€‰Ñ¡”µ½‰¥±”É•ÍÕµ”…Ñ¥½¸µÕÍÐ‰”„±…É”Ñ½Õ Ñ…É•Ðˆ¤ì)…ÍÍ•ÉÐ¹µ…Ñ ¡ÍÑå±•ÍM½ÕÉ”°€½µ•‘¥„p¡¡½Ù•Èè¹½¹•p¤…¹p¡Á½¥¹Ñ•Èè½…ÉÍ•p¥mqÍqMt¨ýp¹Á…ÕÍ”µ½Ù•É±…å}}‘•Í­Ñ½Àµ½ÁåqÌ©qíqÌ©‘¥ÍÁ±…äéqÌ©¹½¹•mqÍqMt¨ýp¹Á…ÕÍ”µ½Ù•É±…å}}É•ÍÕµ•qÌ©qímqÍqMt¨ý‘¥ÍÁ±…äéqÌ©¥¹±¥¹”µ™±•à¼°€‰µ½‰¥±”Á…ÕÍ”½ÁäµÕÍÐ¹½Ð¥¹ÍÑÉÕÐÑ¡”Á±…å•ÈÑ¼ÁÉ•ÍÌÍŒˆ¤ì)…ÍÍ•ÉÐ¹µ…Ñ ¡…µ•M½ÕÉ”°€½É•ÍÕµ•IÕ¹pýp¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•Ép¡lœ‰u±¥­lœ‰t±qÌ©p¡p¥qÌ¨ôùqÌ©Ñ½±•A…ÕÍ•p¡™…±Í•p¥p¤¼°€‰Ñ¡”É•ÍÕµ”‰ÕÑÑ½¸µÕÍÐ•áÁ±¥¥Ñ±ä±•…ÈÁ…ÕÍ”Ý¥Ñ¡½ÕÐ…ÕÑ¼µÉ•ÍÕµ¥¹œ½¸Ù¥Í¥‰¥±¥ÑäÉ•ÑÕÉ¸ˆ¤ì)…ÍÍ•ÉÐ¹µ…Ñ ¡¥¹‘•áM½ÕÉ”°€½ÍÑå±•Íp¹ÍÍpýØõ‘••ÀµÍ¡…™Ð´Ø¼¤ì)…ÍÍ•ÉÐ¹µ…Ñ ¡¥¹‘•áM½ÕÉ”°€½©Íp½ÕÁÉ…‘•Íp¹©ÍpýØõ‘••ÀµÍ¡…™Ð´Ø¼¤ì)…ÍÍ•ÉÐ¹µ…Ñ ¡¥¹‘•áM½ÕÉ”°€½©Íp½Ý½É±‘p¹©ÍpýØõ‘••ÀµÍ¡…™Ð´Ø¼¤ì)…ÍÍ•ÉÐ¹µ…Ñ ¡¥¹‘•áM½ÕÉ”°€½©Íp½µÕÍ¥p¹©ÍpýØõ‘••ÀµÍ¡…™Ð´Ø¼¤ì)…ÍÍ•ÉÐ¹µ…Ñ ¡¥¹‘•áM½ÕÉ”°€½©Íp½…µ•p¹©ÍpýØõ‘••ÀµÍ¡…™Ð´Ø¼¤ì)…ÍÍ•ÉÐ¹½¬ (€¥¹‘•áM½ÕÉ”¹¥¹‘•á=˜ ©Ì½µÕÍ¥Œ¹©ÌýØõ‘••ÀµÍ¡…™Ð´Øœ¤€ð¥¹‘•áM½ÕÉ”¹¥¹‘•á=˜ ©Ì½…µ”¹©ÌýØõ‘••ÀµÍ¡…™Ð´Øœ¤°(€€‰Ñ¡”Í½Õ¹‘ÑÉ…¬Í¥¹±•Ñ½¸µÕÍÐ±½…‰•™½É”Ñ¡”…µ”…Õ‘¥¼•¹¥¹”ˆ°(¤ì)…ÍÍ•ÉÐ¹µ…Ñ ¡¥¹‘•áM½ÕÉ”°€½¥õlˆuÍ½Õ¹‘Q½±•lˆumqÍqMt¨ý…É¥„µÁÉ•ÍÍ•õlˆuÑÉÕ•lˆt¼¤ì)…ÍÍ•ÉÐ¹µ…Ñ ¡¥¹‘•áM½ÕÉ”°€¿BB{BoB¿BƒBwBCB¼ƒB[BcBoB@½Ô°€‰Ñ¡”½É¥¥¹…°ÑÉ…¬¹••‘Ì„Ù¥Í¥‰±”Á±…å•Èµ™…¥¹œÑ¥Ñ±”ˆ¤ì)…ÍÍ•ÉÐ¹µ…Ñ ¡…µ•M½ÕÉ”°€½Ý¥¹‘½Ýp¹•ÁÑ¡i•É½5ÕÍ¥Œ¼¤ì)…ÍÍ•ÉÐ¹µ…Ñ ¡…µ•M½ÕÉ”°€½µÕÍ¥pýp¹Í•Ñ¹…‰±•‘pýp¸¼¤ì)…ÍÍ•ÉÐ¹µ…Ñ ¡…µ•M½ÕÉ”°€½Í½Õ¹‘Q½±•pýp¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•Ép¡lœ‰u±¥­lœ‰t±qÌ©Ñ½±•M½Õ¹‘AÉ•™•É•¹•p¤¼¤ì)…ÍÍ•ÉÐ¹µ…Ñ ¡ÍÑå±•ÍM½ÕÉ”°€½p¹ÕÑ¥±¥Ñäµ¹…Ù}}‰ÕÑÑ½¸´µ…Õ‘¥½qÌ©qì¼¤ì)…ÍÍ•ÉÐ¹µ…Ñ ¡ÍÑå±•ÍM½ÕÉ”°€½p¹ÕÑ¥±¥Ñäµ¹…Ùp¹¥ÌµÍÕÁÁÉ•ÍÍ•p¹ÕÑ¥±¥Ñäµ¹…Ù}}‰ÕÑÑ½¸é¹½Ñp¡p¹ÕÑ¥±¥Ñäµ¹…Ù}}‰ÕÑÑ½¸´µ…Õ‘¥½p¤¼°€‰Ñ¡”µÕÍ¥Œ½¹ÑÉ½°µÕÍÐÉ•µ…¥¸…Ù…¥±…‰±”‘ÕÉ¥¹œ„ÉÕ¸ˆ¤ì()½¹ÍÐ½É•I•¹‘•ÉMÑå±•	±½¬€ô…µ•M½ÕÉ”¹µ…Ñ  ½½¹ÍÐ=I}I9I}MQe1L€ô=‰©•Ñp¹™É••é•p¡qì¡mqÍqMt¨ü¥q¹qõp¤ì¼¤ì)…ÍÍ•ÉÐ¹½¬¡½É•I•¹‘•ÉMÑå±•	±½¬°€‰Ñ¡”•¹Ù¥É½¹µ•¹ÐÉ•¹‘•É•ÈµÕÍÐ­••À…¸•áÁ±¥¥Ð½É”µµ…Ñ•É¥…°Ñ…‰±”ˆ¤ì)™½È€¡½¹ÍÐ½É”½˜=I}QeAL¤ì(€…ÍÍ•ÉÐ¹µ…Ñ  (€€€½É•I•¹‘•ÉMÑå±•	±½­lÅt°(€€€¹•ÜI•áÀ¡qqˆ‘í½É”¹¥‘ôéqqÌ©=‰©•Ñqp¹™É••é•qp¡qqímyõt©µ…Ñ•É¥…°é€¤°(€€€€‘í½É”¹¥‘ô¹••‘Ì„Í¥±¡½Õ•ÑÑ”½µ…Ñ•É¥…°ÁÉ½™¥±”¥¹ÍÑ•…½˜½±½ÕÈµ½¹±äÉ•¹‘•É¥¹€°(€€¤ì)ô)½¹ÍÐ½É•I•¹‘•É•È€ô…µ•M½ÕÉ”¹µ…Ñ  ½™Õ¹Ñ¥½¸‘É…Ý=É•%¹Q¥±•p¡mqÍqMt¨ýq¹qõq¹q¹™Õ¹Ñ¥½¸‘É…ÝÉ…­Ì¼¤ì)…ÍÍ•ÉÐ¹½¬¡½É•I•¹‘•É•È°€‰Ñ¡”½É”É•¹‘•É•ÈµÕÍÐÉ•µ…¥¸…Ù…¥±…‰±”Ñ¼Ñ¡”…¹Ù…ÌÁ…ÍÌˆ¤ì)…ÍÍ•ÉÐ¹µ…Ñ ¡½É•I•¹‘•É•ÉlÁt°€½=I}I9I}MQe1Mqm½É•p¹¥‘qt¼°€‰½É”µ…Ñ•É¥…°ÁÉ½™¥±•ÌµÕÍÐ‘É¥Ù”Ñ¡”±¥Ù”É•¹‘•É•Èˆ¤ì)…ÍÍ•ÉÐ¹µ…Ñ ¡½É•I•¹‘•É•ÉlÁt°€½¡…Í5…Ñ¡¥¹=É•p¡Ñà€´€Ä°Ñä°½É•p¹¥‘p¤¼°€‰Ù•¥¹ÌµÕÍÐ­••ÀÑ¡•¥È±•™Ðµ•‘”½¹¹•Ñ¥½¸ˆ¤ì)…ÍÍ•ÉÐ¹µ…Ñ ¡½É•I•¹‘•É•ÉlÁt°€½¡…Í5…Ñ¡¥¹=É•p¡Ñàp¬€Ä°Ñä°½É•p¹¥‘p¤¼°€‰Ù•¥¹ÌµÕÍÐ­••ÀÑ¡•¥ÈÉ¥¡Ðµ•‘”½¹¹•Ñ¥½¸ˆ¤ì)…ÍÍ•ÉÐ¹µ…Ñ ¡½É•I•¹‘•É•ÉlÁt°€½½¹ÍÐ±½ÝQ¥•È€ô±…µÁp¡p¡½É•p¹Ñ¥•Èqñqð€Áp¤€´€È¼°€‰é•É¼µ‰…Í•PÐ¬½É”Í¡½Õ±É••¥Ù”•½±½¥…°±½Üˆ¤ì)…ÍÍ•ÉÐ¹µ…Ñ ¡½É•I•¹‘•É•ÉlÁt°€½±½‰…±½µÁ½Í¥Ñ•=Á•É…Ñ¥½¸€ô€±¥¡Ñ•Èœ¼°€‰¡¥ µÑ¥•È±½ÜµÕÍÐÉ•µ…¥¸„±½…°…‘‘¥Ñ¥Ù”Á…ÍÌˆ¤ì)…ÍÍ•ÉÐ¹‘½•Í9½Ñ5…Ñ ¡½É•I•¹‘•É•ÉlÁt°€½™¥±±I•Ñp À°€À°€ üéÝ¥‘Ñ¡ñÍÑ…Ñ•p¹Ù¥•ÝÁ½ÉÐ¤¼°€‰½É”±½ÜµÕÍÐ¹•Ù•È‰•½µ”„™Õ±°µÍÉ••¸Ý…Í ˆ¤ì()½¹ÍÐÑ•ÉÉ…¥¹I•¹‘•É•È€ô…µ•M½ÕÉ”¹µ…Ñ  ½™Õ¹Ñ¥½¸Ñ•ÉÉ…¥¹•ÁÑ¡…Ñ½Ép¡mqÍqMt¨ýq¹qõq¹q¹™Õ¹Ñ¥½¸¡…Í5…Ñ¡¥¹=É”¼¤ì)…ÍÍ•ÉÐ¹½¬¡Ñ•ÉÉ…¥¹I•¹‘•É•È°€‰‘•ÁÑ ±…¹‘µ…É­ÌµÕÍÐÍÑ…äÉ½ÕÁ•¥¸Ñ¡”Ñ•ÉÉ…¥¸É•¹‘•ÈÁ…ÍÌˆ¤ì)™½È€¡½¹ÍÐµ…É­•È½˜l‰É½½ÑM••ˆ°€‰™½ÍÍ¥±M••ˆ°€‰ÍÕÁÁ½ÉÑM••ˆ°€‰…‰±•M••ˆ°€‰ÉåÍÑ…±M••‰t¤ì(€…ÍÍ•ÉÐ¹µ…Ñ ¡Ñ•ÉÉ…¥¹I•¹‘•É•ÉlÁt°¹•ÜI•áÀ¡qqˆ‘íµ…É­•Éõqq‰€¤°€‘íµ…É­•Éô±…¹‘µ…É¬µÕÍÐÉ•µ…¥¸‘•Ñ•Éµ¥¹¥ÍÑ¥€¤ì)ô)…ÍÍ•ÉÐ¹µ…Ñ ¡Ñ•ÉÉ…¥¹I•¹‘•É•ÉlÁt°€½=}=5%}=1=IMp¹‘…µÀ¼°€‰Ý•ÐÍÑÉ…Ñ„¹••„‘¥ÍÑ¥¹Ðµ…Ñ•É¥…°Õ”ˆ¤ì)…ÍÍ•ÉÐ¹‘½•Í9½Ñ5…Ñ ¡Ñ•ÉÉ…¥¹I•¹‘•É•ÉlÁt°€½5…Ñ¡p¹É…¹‘½´¼°€‰Ñ•ÉÉ…¥¸±…¹‘µ…É­ÌµÕÍÐ¹½ÐÍ¡¥µµ•È½Èµ½Ù”‰•ÑÝ••¸™É…µ•Ìˆ¤ì()½¹ÍÐÉ½ÕÑ•…±¥‰É…Ñ¥½¹]½É±€ô¹•Ü5¥¹•]½É±¡=I}QeAL°€‰É½ÕÑ”µ…±¥‰É…Ñ¥½¸µÁÉ½‰”ˆ¤ì)±•Ð™½ÕÍ•‘I½ÕÑ•Q¥±”€ô¹Õ±°ì)±•Ð½É‘¥¹…ÉåI½ÕÑ•Q¥±”€ô¹Õ±°ì)™½È€¡±•ÐÑä€ô€ÄìÑä€ð]=I1}=9%¹!%!P€´€Ä€˜˜€ …™½ÕÍ•‘I½ÕÑ•Q¥±”ñð€…½É‘¥¹…ÉåI½ÕÑ•Q¥±”¤ìÑä€¬ô€Ä¤ì(€™½È€¡±•ÐÑà€ô€ÄìÑà€ð]=I1}=9%¹]%Q €´€Ä€˜˜€ …™½ÕÍ•‘I½ÕÑ•Q¥±”ñð€…½É‘¥¹…ÉåI½ÕÑ•Q¥±”¤ìÑà€¬ô€Ä¤ì(€€€½¹ÍÐÑ¥±”€ôÉ½ÕÑ•…±¥‰É…Ñ¥½¹]½É±¹•ÑQ¥±”¡Ñà°Ñä¤ì(€€€¥˜€ …Ñ¥±”ñðÑ¥±”¹­¥¹€ôôô€‰…¥ÈˆñðÑ¥±”¹­¥¹€ôôô€‰‰•‘É½¬ˆ¤½¹Ñ¥¹Õ”ì(€€€¥˜€¡Ñ¥±”¹½É•%€˜˜€…™½ÕÍ•‘I½ÕÑ•Q¥±”¤™½ÕÍ•‘I½ÕÑ•Q¥±”€ôìÑà°Ñä°Ñ¥±”ôì(€€€¥˜€ …Ñ¥±”¹½É•%€˜˜€…½É‘¥¹…ÉåI½ÕÑ•Q¥±”¤½É‘¥¹…ÉåI½ÕÑ•Q¥±”€ôìÑà°Ñä°Ñ¥±”ôì(€ô)ô)…ÍÍ•ÉÐ¹½¬¡™½ÕÍ•‘I½ÕÑ•Q¥±”€˜˜½É‘¥¹…ÉåI½ÕÑ•Q¥±”¤ì)½¹ÍÐ‰…Í•I½ÕÑ•=ÁÑ¥½¹Ì€ôì(€µ½Ù•MÁ••è€ÄÀÀ°(€‘¥A½Ý•ÉA•ÉM•½¹è€ÄÀ°(€¡…É‘¹•ÍÍ5Õ±Ñ¥Á±¥•Èè€Ä°(€™½ÕÍ•‘=É•%è™½ÕÍ•‘I½ÕÑ•Q¥±”¹Ñ¥±”¹½É•%°(€™½ÕÍ•‘=É•¥5Õ±Ñ¥Á±¥•Èè€Ä°)ôì)½¹ÍÐ…±¥‰É…Ñ•‘I½ÕÑ•=ÁÑ¥½¹Ì€ôì€¸¸¹‰…Í•I½ÕÑ•=ÁÑ¥½¹Ì°™½ÕÍ•‘=É•¥5Õ±Ñ¥Á±¥•Èè€Èôì)½¹ÍÐÉ½ÕÑ•MÑ•ÁÉ½´€ô€¡Á½¥¹Ð¤€ôø€¡ìÑàèÁ½¥¹Ð¹Ñà€´€Ä°ÑäèÁ½¥¹Ð¹Ñäô¤ì)…ÍÍ•ÉÐ¹½¬ (€É½ÕÑ•…±¥‰É…Ñ¥½¹]½É±¹}É½ÕÑ•MÑ•Á½ÍÐ¡É½ÕÑ•MÑ•ÁÉ½´¡™½ÕÍ•‘I½ÕÑ•Q¥±”¤°™½ÕÍ•‘I½ÕÑ•Q¥±”°…±¥‰É…Ñ•‘I½ÕÑ•=ÁÑ¥½¹Ì¤(€€€€ðÉ½ÕÑ•…±¥‰É…Ñ¥½¹]½É±¹}É½ÕÑ•MÑ•Á½ÍÐ¡É½ÕÑ•MÑ•ÁÉ½´¡™½ÕÍ•‘I½ÕÑ•Q¥±”¤°™½ÕÍ•‘I½ÕÑ•Q¥±”°‰…Í•I½ÕÑ•=ÁÑ¥½¹Ì¤°(€€‰™½ÕÍ•…±¥‰É…Ñ¥½¸µÕÍÐÉ•‘Õ”½¹±äÑ¡”™½ÕÍ•½É”ÍÑ•À½ÍÐˆ°(¤ì)…ÍÍ•ÉÐ¹•ÅÕ…° (€É½ÕÑ•…±¥‰É…Ñ¥½¹]½É±¹}É½ÕÑ•MÑ•Á½ÍÐ¡É½ÕÑ•MÑ•ÁÉ½´¡½É‘¥¹…ÉåI½ÕÑ•Q¥±”¤°½É‘¥¹…ÉåI½ÕÑ•Q¥±”°…±¥‰É…Ñ•‘I½ÕÑ•=ÁÑ¥½¹Ì¤°(€É½ÕÑ•…±¥‰É…Ñ¥½¹]½É±¹}É½ÕÑ•MÑ•Á½ÍÐ¡É½ÕÑ•MÑ•ÁÉ½´¡½É‘¥¹…ÉåI½ÕÑ•Q¥±”¤°½É‘¥¹…ÉåI½ÕÑ•Q¥±”°‰…Í•I½ÕÑ•=ÁÑ¥½¹Ì¤°(€€‰™½ÕÍ•…±¥‰É…Ñ¥½¸µÕÍÐ¹½ÐÍ½™Ñ•¸½É‘¥¹…ÉäÉ½ÕÑ”Ñ¥±•Ìˆ°(¤ì()±•Ð¡•­•‘I½ÕÑ•Ì€ô€Àì)±•Ð¡•­•‘Y•¥¹Ì€ô€Àì)™½È€¡±•ÐÍ••€ô€ÄìÍ••€ðô€ÔÀìÍ••€¬ô€Ä¤ì(€½¹ÍÐÝ½É±€ô¹•Ü5¥¹•]½É±¡=I}QeAL°ÍÑÉ•ÍÌ´‘íÍ••‘õ€¤ì(€½¹ÍÐ±¥™Ð€ôÝ½É±¹•Ñ1¥™ÑMÑ…ÉÐ ÄÈÀ°€À¸ÌÔ°€ÄÈÀ°ìÕ¹±½­•‘Q¥•É…Àè€äô¤ì(€…ÍÍ•ÉÐ¹½¬¡±¥™Ð€˜˜9Õµ‰•È¹¥Í¥¹¥Ñ”¡±¥™Ð¹à¤€˜˜9Õµ‰•È¹¥Í¥¹¥Ñ”¡±¥™Ð¹ä¤¤ì(€…ÍÍ•ÉÐ¹½¬¡±¥™Ð¹‘•ÁÑ¡Q¥±•Ì€ðô€ÐÈ€¬€Å”´ä¤ì(€…ÍÍ•ÉÐ¹½¬¡Ý½É±¹•ÑQ¥±”¡±¥™Ð¹Ñà°±¥™Ð¹Ñä¤ü¹­¥¹€ôôô€‰…¥Èˆ°€‰±¥™Ð±…¹‘¥¹œµÕÍÐ‰”½Á•¸ˆ¤ì(€…ÍÍ•ÉÐ¹½¬¡±¥™Ð¹Ñ…É•Ð€˜˜Ý½É±¹•ÑQ¥±”¡±¥™Ð¹Ñ…É•Ð¹Ñà°±¥™Ð¹Ñ…É•Ð¹Ñä¤ü¹½É•%°€‰±¥™Ð¹••‘Ì„Õ…É…¹Ñ••½É”Ñ…É•Ðˆ¤ì((€½¹ÍÐ‰•™½É•!À€ôÝ½É±¹•ÑQ¥±”¡±¥™Ð¹Ñ…É•Ð¹Ñà°±¥™Ð¹Ñ…É•Ð¹Ñä¤¹¡Àì(€½¹ÍÐÉ½ÕÑ”€ôÝ½É±¹™¥¹‘1•…ÍÑI•Í¥ÍÑ…¹•MÑ•À¡±¥™Ð°±¥™Ð¹Ñ…É•Ð°ì(€€€µ½Ù•MÁ••è€ÄÀÀ°(€€€‘¥A½Ý•ÉA•ÉM•½¹è€à°(€€€µ…á•Ñ½ÕÉQ¥±•Ìè€ä°(€ô¤ì(€…ÍÍ•ÉÐ¹½¬¡É½ÕÑ”€˜˜É½ÕÑ”¹Ý…åÁ½¥¹Ð€˜˜É½ÕÑ”¹É½ÕÑ”¹±•¹Ñ €øô€Ä¤ì(€…ÍÍ•ÉÐ¹•ÅÕ…°¡Ý½É±¹•ÑQ¥±”¡±¥™Ð¹Ñ…É•Ð¹Ñà°±¥™Ð¹Ñ…É•Ð¹Ñä¤¹¡À°‰•™½É•!À°€‰É½ÕÑ”Í•…É µÕÍÐ‰”É•…µ½¹±äˆ¤ì(€¡•­•‘I½ÕÑ•Ì€¬ô€Äì((€±•Ð½É•Q¥±•Ì€ô€Àì(€±•Ð™¥ÉÍÑ=É•½½É‘¥¹…Ñ”€ô¹Õ±°ì(€½¹ÍÐÙ•¥¹Ì€ô¹•Ü5…À ¤ì(€™½È€¡±•ÐÑä€ô€ÀìÑä€ð]=I1}=9%¹!%!PìÑä€¬ô€Ä¤ì(€€€™½È€¡±•ÐÑà€ô€ÀìÑà€ð]=I1}=9%¹]%Q ìÑà€¬ô€Ä¤ì(€€€€€½¹ÍÐÑ¥±”€ôÝ½É±¹•ÑQ¥±”¡Ñà°Ñä¤ì(€€€€€¥˜€ …Ñ¥±”ü¹½É•%¤½¹Ñ¥¹Õ”ì(€€€€€½É•Q¥±•Ì€¬ô€Äì(€€€€€¥˜€ …™¥ÉÍÑ=É•½½É‘¥¹…Ñ”¤™¥ÉÍÑ=É•½½É‘¥¹…Ñ”€ôìÑà°Ñäôì(€€€€€…ÍÍ•ÉÐ¹½¬¡Ñ¥±”¹Ù•¥¹%°½É”Ñ¥±”€‘íÑáôè‘íÑåôµÕÍÐ­••À„Ù•¥¸¥‘€¤ì(€€€€€½¹ÍÐÙ•¥¸€ôÙ•¥¹Ì¹•Ð¡Ñ¥±”¹Ù•¥¹%¤ñðì½É•%èÑ¥±”¹½É•%°•±±Ìè¹•ÜM•Ð ¤ôì(€€€€€…ÍÍ•ÉÐ¹•ÅÕ…° (€€€€€€€Ù•¥¸¹½É•%°(€€€€€€€Ñ¥±”¹½É•%°(€€€€€€€Ù•¥¸€‘íÑ¥±”¹Ù•¥¹%‘ôµÕÍÐ¹½Ð½¹Ñ…¥¸½¹™±¥Ñ¥¹œ½É”ÑåÁ•Í€°(€€€€€€¤ì(€€€€€½¹ÍÐ½½É‘¥¹…Ñ”€ô€‘íÑáôè‘íÑåõ€ì(€€€€€…ÍÍ•ÉÐ¹½¬ …Ù•¥¸¹•±±Ì¹¡…Ì¡½½É‘¥¹…Ñ”¤°Ù•¥¸€‘íÑ¥±”¹Ù•¥¹%‘ôÉ•Á•…ÑÌ•±°€‘í½½É‘¥¹…Ñ•õ€¤ì(€€€€€Ù•¥¸¹•±±Ì¹…‘¡½½É‘¥¹…Ñ”¤ì(€€€€€Ù•¥¹Ì¹Í•Ð¡Ñ¥±”¹Ù•¥¹%°Ù•¥¸¤ì(€€€ô(€ô(€…ÍÍ•ÉÐ¹½¬¡½É•Q¥±•Ì€ø€À¤ì(€™½È€¡½¹ÍÐÙ•¥¸½˜Ù•¥¹Ì¹Ù…±Õ•Ì ¤¤ì(€€€…ÍÍ•ÉÐ¹½¬¡Ù•¥¸¹•±±Ì¹Í¥é”€ø€À°€‰•Ù•Éä•¹•É…Ñ•Ù•¥¸µÕÍÐ½Ý¸…Ð±•…ÍÐ½¹”Õ¹¥ÅÕ”•±°ˆ¤ì(€€€¡•­•‘Y•¥¹Ì€¬ô€Äì(€ô((€±•Ð¥¹‘•á•‘=É•Q¥±•Ì€ô€Àì(€±•ÐÁÉ•Ù¥½ÕÍ%¹‘•à€ô€´Äì(€Ý½É±¹™½É…¡=É•Q¥±•%¹	½Õ¹‘Ì À°€À°]=I1}=9%¹]%Q €´€Ä°]=I1}=9%¹!%!P€´€Ä°€¡}Ñ¥±”°Ñà°Ñä¤€ôøì(€€€½¹ÍÐ¥¹‘•à€ôÑä€¨]=I1}=9%¹]%Q €¬Ñàì(€€€…ÍÍ•ÉÐ¹½¬¡¥¹‘•à€øÁÉ•Ù¥½ÕÍ%¹‘•à°€‰½É”¥¹‘•àµÕÍÐÁÉ•Í•ÉÙ”É½Üµµ…©½ÈÑ¥”µ‰É•…­¥¹œ½É‘•Èˆ¤ì(€€€ÁÉ•Ù¥½ÕÍ%¹‘•à€ô¥¹‘•àì(€€€¥¹‘•á•‘=É•Q¥±•Ì€¬ô€Äì(€ô¤ì(€…ÍÍ•ÉÐ¹•ÅÕ…°¡¥¹‘•á•‘=É•Q¥±•Ì°½É•Q¥±•Ì°€‰½É”¥¹‘•àµÕÍÐ•¹Õµ•É…Ñ”•Ù•Éä±¥Ù”½É”Ñ¥±”•á…Ñ±ä½¹”ˆ¤ì(€…ÍÍ•ÉÐ¹½¬¡™¥ÉÍÑ=É•½½É‘¥¹…Ñ”¤ì(€Ý½É±¹‰É•…­Q¥±”¡™¥ÉÍÑ=É•½½É‘¥¹…Ñ”¹Ñà°™¥ÉÍÑ=É•½½É‘¥¹…Ñ”¹Ñä¤ì(€±•Ð¥¹‘•á•‘™Ñ•É	É•…¬€ô€Àì(€Ý½É±¹™½É…¡=É•Q¥±•%¹	½Õ¹‘Ì À°€À°]=I1}=9%¹]%Q €´€Ä°]=I1}=9%¹!%!P€´€Ä°€ ¤€ôøì(€€€¥¹‘•á•‘™Ñ•É	É•…¬€¬ô€Äì(€ô¤ì(€…ÍÍ•ÉÐ¹•ÅÕ…°¡¥¹‘•á•‘™Ñ•É	É•…¬°½É•Q¥±•Ì€´€Ä°€‰‰É½­•¸½É”µÕÍÐ±•…Ù”Ñ¡”±¥Ù”¥¹‘•à¥µµ•‘¥…Ñ•±äˆ¤ì)ô((¼¼½É”Ñ¡”É…¹‘½´Ý…±¬Ñ¼ÍÑ…ä½¸¥ÑÌ½É¥¥¸¸Q¡”‘•Ñ•Éµ¥¹¥ÍÑ¥Œ™…±±‰…¬µÕÍÐ(¼¼ÍÑ¥±°Á±…”Ñ¡”É•ÅÕ•ÍÑ•¹Õµ‰•È½˜Õ¹¥ÅÕ”•±±Ì°…¹}…ÁÁ±å=É”µÕÍÐ¹•Ù•È‰”(¼¼…±±•ÑÝ¥”™½ÈÑ¡”Í…µ”•±°µ•É•±äÑ¼¥¹™±…Ñ”Ñ¡”É•ÑÕÉ¹•½Õ¹Ð¸)½¹ÍÐ‘ÕÁ±¥…Ñ•]½É±€ô¹•Ü5¥¹•]½É±¡=I}QeAL°€‰‘ÕÁ±¥…Ñ”µÝ…±¬µÁÉ½‰”ˆ¤ì)½¹ÍÐÉ¥¡•ÍÑ•™¥¹¥Ñ¥½¸€ô‘ÕÁ±¥…Ñ•]½É±¹}½É••™¥¹¥Ñ¥½¹Ì¹É•‘Õ” ¡É¥¡•ÍÐ°‘•™¥¹¥Ñ¥½¸¤€ôø€ (€€…É¥¡•ÍÐñð‘•™¥¹¥Ñ¥½¸¹É…¹¬€øÉ¥¡•ÍÐ¹É…¹¬€ü‘•™¥¹¥Ñ¥½¸€èÉ¥¡•ÍÐ(¤°¹Õ±°¤ì)½¹ÍÐÉ•ÅÕ•ÍÑ•‘M¥é”€ô€Üì)±•ÐÁÉ½‰•=É¥¥¸€ô¹Õ±°ì)™½È€¡±•ÐÑä€ô€ÈìÑä€ð]=I1}=9%¹!%!P€´]=I1}=9%¹	I=-}I=]L€´€È€˜˜€…ÁÉ½‰•=É¥¥¸ìÑä€¬ô€Ä¤ì(€™½È€¡±•ÐÑà€ô€ÈìÑà€ð]=I1}=9%¹]%Q €´€È€˜˜€…ÁÉ½‰•=É¥¥¸ìÑà€¬ô€Ä¤ì(€€€½¹ÍÐÑ¥±”€ô‘ÕÁ±¥…Ñ•]½É±¹•ÑQ¥±”¡Ñà°Ñä¤ì(€€€¥˜€ …Ñ¥±”ñðÑ¥±”¹­¥¹€ôôô€‰…¥ÈˆñðÑ¥±”¹­¥¹€ôôô€‰‰•‘É½¬ˆ¤½¹Ñ¥¹Õ”ì(€€€¥˜€ …‘ÕÁ±¥…Ñ•]½É±¹}…¹=É•ÁÁ•…ÉÐ¡Ñà°Ñä°É¥¡•ÍÑ•™¥¹¥Ñ¥½¸¤¤½¹Ñ¥¹Õ”ì(€€€±•Ð¹•…É‰åM½±¥€ô€Àì(€€€™½È€¡±•Ð½™™Í•Ñd€ô€´Ìì½™™Í•Ñd€ðô€Ìì½™™Í•Ñd€¬ô€Ä¤ì(€€€€€™½È€¡±•Ð½™™Í•Ñ`€ô€´Ìì½™™Í•Ñ`€ðô€Ìì½™™Í•Ñ`€¬ô€Ä¤ì(€€€€€€€¥˜€¡5…Ñ ¹…‰Ì¡½™™Í•Ñ`¤€¬5…Ñ ¹…‰Ì¡½™™Í•Ñd¤€ø€Ì¤½¹Ñ¥¹Õ”ì(€€€€€€€½¹ÍÐ¹•…É‰ä€ô‘ÕÁ±¥…Ñ•]½É±¹•ÑQ¥±”¡Ñà€¬½™™Í•Ñ`°Ñä€¬½™™Í•Ñd¤ì(€€€€€€€¥˜€ (€€€€€€€€€¹•…É‰ä(€€€€€€€€€€˜˜¹•…É‰ä¹­¥¹€„ôô€‰…¥Èˆ(€€€€€€€€€€˜˜¹•…É‰ä¹­¥¹€„ôô€‰‰•‘É½¬ˆ(€€€€€€€€€€˜˜‘ÕÁ±¥…Ñ•]½É±¹}…¹=É•ÁÁ•…ÉÐ¡Ñà€¬½™™Í•Ñ`°Ñä€¬½™™Í•Ñd°É¥¡•ÍÑ•™¥¹¥Ñ¥½¸¤(€€€€€€€€¤¹•…É‰åM½±¥€¬ô€Äì(€€€€€ô(€€€ô(€€€¥˜€¡¹•…É‰åM½±¥€øôÉ•ÅÕ•ÍÑ•‘M¥é”¤ÁÉ½‰•=É¥¥¸€ôìÑà°Ñäôì(€ô)ô)…ÍÍ•ÉÐ¹½¬¡ÁÉ½‰•=É¥¥¸°€‰‘ÕÁ±¥…Ñ”µÝ…±¬ÁÉ½‰”¹••‘Ì„ÍÕ™™¥¥•¹Ñ±äÍ½±¥½É¥¥¸ˆ¤ì()½¹ÍÐ•áÁ•Ñ•‘Y•¥¹%€ô€‘íÉ¥¡•ÍÑ•™¥¹¥Ñ¥½¸¹¥‘ôè‘í‘ÕÁ±¥…Ñ•]½É±¹}¹•áÑY•¥¹%‘õ€ì)½¹ÍÐ½É¥¥¹…±9•áÐ€ô‘ÕÁ±¥…Ñ•]½É±¹}É¹œ¹¹•áÐì)½¹ÍÐ½É¥¥¹…±ÁÁ±å=É”€ô‘ÕÁ±¥…Ñ•]½É±¹}…ÁÁ±å=É”ì)±•ÐÁÉ½‰•ÁÁ±å…±±Ì€ô€Àì)‘ÕÁ±¥…Ñ•]½É±¹}É¹œ¹¹•áÐ€ô€ ¤€ôø€Àì)‘ÕÁ±¥…Ñ•]½É±¹}…ÁÁ±å=É”€ô™Õ¹Ñ¥½¸…ÁÁ±å=É•AÉ½‰” ¸¸¹…ÉÌ¤ì(€¥˜€¡…ÉÍlÍt€ôôô•áÁ•Ñ•‘Y•¥¹%¤ÁÉ½‰•ÁÁ±å…±±Ì€¬ô€Äì(€É•ÑÕÉ¸½É¥¥¹…±ÁÁ±å=É”¹…ÁÁ±ä¡Ñ¡¥Ì°…ÉÌ¤ì)ôì)½¹ÍÐÕ¹¥ÅÕ•A±…•€ô‘ÕÁ±¥…Ñ•]½É±¹}Á±…•Y•¥¸ (€ÁÉ½‰•=É¥¥¸¹Ñà°(€ÁÉ½‰•=É¥¥¸¹Ñä°(€É¥¡•ÍÑ•™¥¹¥Ñ¥½¸°(€É•ÅÕ•ÍÑ•‘M¥é”°(¤ì)‘ÕÁ±¥…Ñ•]½É±¹}É¹œ¹¹•áÐ€ô½É¥¥¹…±9•áÐì)‘ÕÁ±¥…Ñ•]½É±¹}…ÁÁ±å=É”€ô½É¥¥¹…±ÁÁ±å=É”ì()±•Ð…ÑÕ…±AÉ½‰••±±Ì€ô€Àì)™½È€¡±•ÐÑä€ô€ÀìÑä€ð]=I1}=9%¹!%!PìÑä€¬ô€Ä¤ì(€™½È€¡±•ÐÑà€ô€ÀìÑà€ð]=I1}=9%¹]%Q ìÑà€¬ô€Ä¤ì(€€€¥˜€¡‘ÕÁ±¥…Ñ•]½É±¹•ÑQ¥±”¡Ñà°Ñä¤ü¹Ù•¥¹%€ôôô•áÁ•Ñ•‘Y•¥¹%¤…ÑÕ…±AÉ½‰••±±Ì€¬ô€Äì(€ô)ô)…ÍÍ•ÉÐ¹•ÅÕ…°¡Õ¹¥ÅÕ•A±…•°É•ÅÕ•ÍÑ•‘M¥é”°€‰™…±±‰…¬µÕÍÐ½µÁ±•Ñ”„ÍÑ…±±•É…¹‘½´µÝ…±¬Ù•¥¸ˆ¤ì)…ÍÍ•ÉÐ¹•ÅÕ…°¡…ÑÕ…±AÉ½‰••±±Ì°Õ¹¥ÅÕ•A±…•°€‰É•Á½ÉÑ•Ù•¥¸Í¥é”µÕÍÐ•ÅÕ…°¥ÑÌÕ¹¥ÅÕ”Ý½É±•±±Ìˆ¤ì)…ÍÍ•ÉÐ¹•ÅÕ…°¡ÁÉ½‰•ÁÁ±å…±±Ì°Õ¹¥ÅÕ•A±…•°€‰‘ÕÁ±¥…Ñ”Ù¥Í¥ÑÌµÕÍÐ¹½ÐÉ•…ÁÁ±ä½ÈÉ•½Õ¹ÐÑ¡”Í…µ”•±°ˆ¤ì()½¹ÍÐ‘•Ñ•Éµ¥¹¥ÍÑ¥€ô¹•Ü5¥¹•]½É±¡=I}QeAL°€‰‘•Ñ•Éµ¥¹¥Í´µÁÉ½‰”ˆ¤ì)½¹ÍÐ‘•Ñ•Éµ¥¹¥ÍÑ¥€ô¹•Ü5¥¹•]½É±¡=I}QeAL°€‰‘•Ñ•Éµ¥¹¥Í´µÁÉ½‰”ˆ¤ì)…ÍÍ•ÉÐ¹‘••ÁÅÕ…°¡‘•Ñ•Éµ¥¹¥ÍÑ¥¹ÍÕÉ™…”°‘•Ñ•Éµ¥¹¥ÍÑ¥¹ÍÕÉ™…”°€‰Í…µ”Í••µÕÍÐÉ•ÁÉ½‘Õ”Ñ¡”ÍÕÉ™…”ˆ¤ì)™½È€¡±•ÐÑä€ô€ÀìÑä€ð]=I1}=9%¹!%!PìÑä€¬ô€Ä¤ì(€™½È€¡±•ÐÑà€ô€ÀìÑà€ð]=I1}=9%¹]%Q ìÑà€¬ô€Ä¤ì(€€€…ÍÍ•ÉÐ¹‘••ÁÅÕ…° (€€€€€‘•Ñ•Éµ¥¹¥ÍÑ¥¹•ÑQ¥±”¡Ñà°Ñä¤°(€€€€€‘•Ñ•Éµ¥¹¥ÍÑ¥¹•ÑQ¥±”¡Ñà°Ñä¤°(€€€€€Í…µ”Í••µÕÍÐÉ•ÁÉ½‘Õ”Ñ¥±”€‘íÑáôè‘íÑåõ€°(€€€€¤ì(€ô)ô()½¹Í½±”¹±½œ¡)M=8¹ÍÑÉ¥¹¥™ä¡ì(€½¬èÑÉÕ”°(€¹½‘•ÌèUAI}L¹±•¹Ñ °(€±•Ù•±ÌèUAI}L¹É•‘Õ” ¡ÍÕ´°‘•™¥¹¥Ñ¥½¸¤€ôøÍÕ´€¬‘•™¥¹¥Ñ¥½¸¹µ…á1•Ù•°°€À¤°(€Í••‘Ìè€ÔÀ°(€¡•­•‘I½ÕÑ•Ì°(€¡•­•‘Y•¥¹Ì°(€‘ÕÁ±¥…Ñ•]…±­•±±Ìè…ÑÕ…±AÉ½‰••±±Ì°)ô¤¤ì(