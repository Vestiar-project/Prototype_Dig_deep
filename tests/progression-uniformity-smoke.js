"use strict";

const assert = require("node:assert/strict");
const { Worker, isMainThread, parentPort, workerData } = require("node:worker_threads");

// A deliberately explicit list: these are purchases whose effect should be
// visible in play, rather than another small scalar increase. Thresholded
// nodes are listed separately because their later levels unlock new behavior.
const NOTABLE_MECHANICS = Object.freeze([
  { id: "sense_echo_pulse", level: 1, label: "resonant ping" },
  { id: "sense_deep_resonance", level: 1, label: "deep sector" },
  { id: "sense_deep_resonance", level: 2, label: "deep sector backup" },
  { id: "sense_deep_resonance", level: 3, label: "deep sector map" },
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
  { id: "dig_light_footwork", level: 2, label: "opening sprint" },
  { id: "dig_light_footwork", level: 4, label: "target relay sprint" },
  { id: "dig_twin_stroke", level: 1, label: "twin stroke" },
  { id: "dig_precision_path", level: 1, label: "precision path" },
  { id: "dig_wall_bite", level: 1, label: "wall bite" },
  { id: "dig_omni_swing", level: 1, label: "impact mining" },
  { id: "dig_least_resistance", level: 1, label: "least-resistance route" },
  { id: "dig_mine_lift", level: 1, label: "mine lift" },
  { id: "dig_quarry_presence", level: 1, label: "quarry rhythm" },
  { id: "power_furious_swing", level: 1, label: "critical strikes" },
  { id: "power_fault_finder", level: 3, label: "guaranteed fault cadence" },
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
          level:зЛh‘йм¶»§q«^vK€™\]Z\™\О€Yљ[љ][Ы‹њ™\]Z\™\ИЧK€™\]Z\™\УЬ™Q\ШЫЭ™\ћN€Yљ[љ][Ы‹њ™\]Z\™\УЬ™Q\ШЫЭ™\ћHќ[€™XЪ\K€YљXЪ]О€Шљ™XЭ™њ›ЫQ[ќљY\КШљ™XЭ™[ќљY\К™XЪ\JK›X\

ЫЬ™RY[[Э[ќJHO€В€Ь™RY€X]›X^
[[Э[ќH
[ќ™[ќЬћVЫЬ™RYH
JK€JJK€[ќ™[ќЬћK€JNВ€Y€
[ќљY\Л›[™Э€ЉH[ќљY\ЛњЪYќ

NВ€B€B€ЫЫњЭ›ЭYЪHќ^UЪ]Э]YЮJ\KЭ]YЮKљ[[]М
NВ€›Ь€
ЫЫњЭYЩ€XЩRYКHВ€Y€
›ЭYЪљ[ЫY\КY
JHЫЫ\]Y\™Щ]XЩ\ЛY
Y
NВ€B€Ы\ЪЭH\K™Щ]Ы\ЪЭ

NВ€Y€
XЩT\Ъ\Щ\И	‰€›ЭYЪ›[™Э
HВ€ЫЫњЭXЩY]™[ИH™]ИX\
™Y›Ь™S]™[X\
NВ€\Ъ\ЩU[Y[[™Kњ\Ъ
В€ќ[‹€Z[ќ]N€ќ[X™\Љ
[\ЩYЩXЫЫ™ИИЊ
KќСљ^Y
ЉJK€\Ъ\Щ\О€›ЭYЪ›X\

Y
HO€В€ЫЫњЭ]™[H
XЩY]™[Л™Щ]
Y
H
H
ИNВ€XЩY]™[ЛњЩ]
Y]™[
NВ€™]\›€	ЪYP	Ы]™[XВ€JK€JNВ€B€ЫЫњЭ]™[XЪШYЩHHЫ\ЪЭњ\Ъ\ЩY]™[ИH™Y›Ь™S]™[ОВ€\ЬЩ\ќ™\]X[
]™[XЪШYЩK›ЭYЪ›[™Э	ЬЭ]YЮ_KЙЬЩYYN€ќ^Y\€]\Э™\Ьќ]™\ћH\Ъ\ЩY]™[
NВ€ЫЫњЭЭ\њ™[ќYXЪ[љXЬИH™XXЪYYXЪ[љXЬК]™[X\
\JJNВ€ЫЫњЭ™]ЫT™XXЪYHЛ‹‹Э\њ™[ќYXЪ[љXЬЧK™љ[\Љ
Щ^JHO€\™]љ[Э\УYXЪ[љXЬЛљ\КЩ^JJNВ€Y€
]™[XЪШYЩH€X^]™[XЪШYЩJHВ€X^]™[XЪШYЩHH]™[XЪШYЩNВ€X^]™[XЪШYЩQ]Z[ИHВ€ќ[‹€Z[ќ]N€ќ[X™\Љ
[\ЩYЩXЫЫ™ИИЊ
KќСљ^Y
ЉJK€]™[О€]™[XЪШYЩK€YXЪ[љXЬО€Л‹‹›™]ЫT™XXЪYK€›ЭYЪ€Л‹‹›ЭYЪK€NВ€B€Y€
™]ЫT™XXЪY›[™Э€X^YXЪ[љXФXЪШYЩJHВ€X^YXЪ[љXФXЪШYЩHH™]ЫT™XXЪY›[™ЭВ€X^YXЪ[љXФXЪШYЩQ]Z[ИHВ€ќ[‹€Z[ќ]N€ќ[X™\Љ
[\ЩYЩXЫЫ™ИИЊ
KќСљ^Y
ЉJK€]™[О€]™[XЪШYЩK€YXЪ[љXЬО€Л‹‹›™]ЫT™XXЪYK€›ЭYЪ€Л‹‹›ЭYЪK€NВ€B€›Ь€
ЫЫњЭЩ^HЩ€™]ЫT™XXЪY
HYXЪ[љXХ[Y\Лњ\Ъ
ИЩ^KЩXЫЫ™О€[\ЩYЩXЫЫ™ИJNВ€™]љ[Э\УYXЪ[љXЬИHЭ\њ™[ќYXЪ[љXЬОВ‚€Y€
Э]YЮHOOH™љ[[\]ЉHВ€ЫЫњЭЪ[][]Y]™[ИH™]ИX\
™Y›Ь™S]™[X\
NВ€]]\Ъ\ЩHH[ЩNВ€›Ь€
ЫЫњЭYЩ€›ЭYЪ
HВ€ЫЫњЭ™Y›Ь™HHЪ[][]Y]™[Л™Щ]
Y
HВ€ЫЫњЭ\™Щ]Hљ[[]™Щ]
Y
HВ€Y€
™Y›Ь™H\™Щ]
H]\Ъ\ЩHHќYNВ€Ъ[][]Y]™[ЛњЩ]
Y™Y›Ь™H
ИJNВ€B€]ћTќ[њИH]\Ъ\ЩHИ€]ћTќ[њИ
ИNВ€B€ЛИYЩЬ™YШ]H›ШЭ\И\ИH›Ь›X[^Y\€]\љ\ЭXЛ€Hљ[[\]^Y\€Ы›B€ЛИ[ќ\ќ™[™\ИYќ\€™YHЫЫњЩXЭ]]™HЫЬљЬЪЬИXYH›И]›ЩЬ™\ЬЛ‚€Щ]\ЩYќ[›ШЭ\К\KЭ]YЮKљ[[]Э]YЮHOOH™љ[[\]€	‰€]ћTќ[њИЏHКNВ‚€Y€
Ы\ЪЭШ[\ZYЫ‹њ™XYJHВ€ЫЫ\]YHќYNВ€њ™XZОВ€B€ЛИЭЬ]ЫЩЪXШ[Э]YЪY\И]NZ[ќ]\ОИ[ЫЫ\][Ы€\И™\ЬќY€ЛИ[™Z[И™[ЭИЪ]Э]ЫЫњЭ[Z[™И[›Э[™YТH[YK‚€Y€
[\ЩYЩXЫЫ™ИЏHN
€Њ
Hњ™XZОВ€B‚€ЫЫњЭљ[[Ы\ЪЭH\K™Щ]Ы\ЪЭ

NВ€ЫЫњЭYXЪ[љXЬР][YHH™]ИX\

NВ€›Ь€
ЫЫњЭ[ќћHЩ€YXЪ[љXХ[Y\КHВ€Y€
[YXЪ[љXЬР][YKљ\К[ќћKњЩXЫЫ™КJHYXЪ[љXЬР][YKњЩ]
[ќћKњЩXЫЫ™ЛЧJNВ€YXЪ[љXЬР][YK™Щ]
[ќћKњЩXЫЫ™КKњ\Ъ
[ќћKљЩ^JNВ€B€ЫЫњЭЪXЪЬЪ[ќИHВ€ИЩXЫЫ™О€YXЪ[љXЬО€ИШ[\ZYЫ‹\Э\ќ—HK€‹‹–Л‹‹›YXЪ[љXЬР][YWB€њЫЬќ

ЫYќKЬљYЪJHO€YќHљYЪ
B€›X\

ЬЩXЫЫ™ЛYXЪ[љXЬЧJHO€
ИЩXЫЫ™ЛYXЪ[љXЬИJJK€ИЩXЫЫ™О€[\ЩYЩXЫЫ™ЛYXЪ[љXЬО€ИШ[\ZYЫ‹Y[™—HK€NВ€]X^YXЪ[љXСШ\ЩXЫЫ™ИHВ€]X^YXЪ[љXСШ\]Z[ИHќ[В€›Ь€
][™^HNИ[™^ЪXЪЬЪ[ќЛ›[™ЭИ[™^
ПHJHВ€ЫЫњЭШ\HЪXЪЬЪ[ќЦЪ[™^KњЩXЫЫ™ИHЪXЪЬЪ[ќЦЪ[™^HWKњЩXЫЫ™ОВ€Y€
Ш\€X^YXЪ[љXСШ\ЩXЫЫ™КHВ€X^YXЪ[љXСШ\ЩXЫЫ™ИHШ\В€X^YXЪ[љXСШ\]Z[ИHВ€њ›ЫSZ[ќ]N€ќ[X™\Љ
ЪXЪЬЪ[ќЦЪ[™^HWKњЩXЫЫ™ИИЊ
KќСљ^Y
ЉJK€УZ[ќ]N€ќ[X™\Љ
ЪXЪЬЪ[ќЦЪ[™^KњЩXЫЫ™ИИЊ
KќСљ^Y
ЉJK€Z[ќ]\О€ќ[X™\Љ
Ш\ИЊ
KќСљ^Y
ЉJK€Yќ\Ћ€Л‹‹ЪXЪЬЪ[ќЦЪ[™^HWK›YXЪ[љXЬЧK€™Y›Ь™N€Л‹‹ЪXЪЬЪ[ќЦЪ[™^K›YXЪ[љXЬЧK€NВ€B€B‚€™]\›€В€ЩYY€Э]YЮK€ЫЫ\]Y€ќ[њЛ€[\ЩYZ[ќ]\О€ќ[X™\Љ
[\ЩYЩXЫЫ™ИИЊ
KќСљ^Y
ЉJK€љ\њЭ]™[ќZ[ќ]\О€љ\њЭ]™[ќЩXЫЫ™ИOHќ[Иќ[€ќ[X™\Љ
љ\њЭ]™[ќЩXЫЫ™ИИЊ
KќСљ^Y
ЉJK€X^YXЪ[љXСШ\Z[ќ]\О€ќ[X™\Љ
X^YXЪ[љXСШ\ЩXЫЫ™ИИЊ
KќСљ^Y
ЉJK€X^YXЪ[љXСШ\]Z[Л€X^]™[XЪШYЩK€X^]™[XЪШYЩQ]Z[Л€X^YXЪ[љXФXЪШYЩK€X^YXЪ[љXФXЪШYЩQ]Z[Л€YXЪ[љXЬФ™XXЪY€™]љ[Э\УYXЪ[љXЬЛњЪ^™K€Z[\ЭЫ™SZ[ќ]\О€Шљ™XЭ™њ›ЫQ[ќљY\КYXЪ[љXХ[Y\Л›X\

[ќћJHO€В€[ќћKљЩ^K€ќ[X™\Љ
[ќћKњЩXЫЫ™ИИЊ
KќСљ^Y
ЉJK€JJK€‹‹ЉXЩT\Ъ\Щ\ИИИ\Ъ\ЩU[Y[[™HH€ЯJK€‹‹ЉXЩRYЛњЪ^™HИИ\™Щ]XЩHH€ЯJK€\Ъ\ЩY]™[О€љ[[Ы\ЪЭњ\Ъ\ЩY]™[Л€NВџB‚™ќ[Э[Ы€\Щ[ќ[J[Y\ЛњXЭ[ЫЉHВ€\ЬЩ\ќ›ЪК[Y\Л›[™Э€Ш[››ЭШ[Э[]HH\Щ[ќ[HЩ€[€[\HШ[\HЉNВ€ЫЫњЭЫЬќYHЛ‹‹ќ[Y\ЧKњЫЬќ

KЉHO€HHЉNВ€ЫЫњЭ[љИHX]›X^
X]ЩZ[
ЫЬќY›[™Э
€њXЭ[ЫЉHHJNВ€™]\›€ЫЬќYЬ[љЧNВџB‚™ќ[Э[Ы€Э[[X\љ^™JШ[\ZYЫњКHВ€ЫЫњЭќ[Y\љXИH
љY[
HO€Ш[\ZYЫњЛ›X\

Ш[\ZYЫЉHO€Ш[\ZYЫ–ЩљY[JK™љ[\Љќ[X™\‹љ\Сљ[љ]JNВ€ЫЫњЭ\][ЫњИHќ[Y\љXК™[\ЩYZ[ќ]\ИЉNВ€ЫЫњЭШ\ИHќ[Y\љXК›X^YXЪ[љXСШ\Z[ќ]\ИЉNВ€ЫЫњЭ]™[ќИHќ[Y\љXК™љ\њЭ]™[ќZ[ќ]\ИЉNВ€ЫЫњЭ]™[XЪШYЩ\ИHќ[Y\љXК›X^]™[XЪШYЩHЉNВ€ЫЫњЭYXЪ[љXФXЪШYЩ\ИHќ[Y\љXК›X^YXЪ[љXФXЪШYЩHЉNВ€ЫЫњЭZ[\ЭЫ™SYYX[њИHШљ™XЭ™њ›ЫQ[ќљY\К“ХP“WУQPТS’PФЛ›X\

YXЪ[љXКHO€В€ЫЫњЭЩ^HH	ЫYXЪ[љXЛљYP	ЫYXЪ[љXЛ›]™[XВ€ЫЫњЭШ[\\ИHШ[\ZYЫњВ€›X\

Ш[\ZYЫЉHO€Ш[\ZYЫ‹›Z[\ЭЫ™SZ[ќ]\ПЛ–ЪЩ^WJB€™љ[\Љќ[X™\‹љ\Сљ[љ]JNВ€™]\›€ЪЩ^KВ€™XXЪY€Ш[\\Л›[™Э€L€Ш[\\Л›[™ЭИ\Щ[ќ[JШ[\\ЛЌJH€ќ[€L€Ш[\\Л›[™ЭИ\Щ[ќ[JШ[\\ЛЋJH€ќ[€WNВ€JJNВ€™]\›€В€Ш[\ZYЫњО€Ш[\ZYЫњЛ›[™Э€ЫЫ\]Y€Ш[\ZYЫњЛ™љ[\Љ
Ш[\ZYЫЉHO€Ш[\ZYЫ‹ЫЫ\]Y
K›[™Э€[\ЩYZ[ќ]\О€В€L€\Щ[ќ[J\][ЫњЛЊJK€L€\Щ[ќ[J\][ЫњЛЌJK€L€\Щ[ќ[J\][ЫњЛЋJK€X^€X]›X^
‹‹™\][ЫњКK€K€X^YXЪ[љXСШ\Z[ќ]\О€В€L€\Щ[ќ[JШ\ЛЌJK€L€\Щ[ќ[JШ\ЛЋJK€X^€X]›X^
‹‹™Ш\КK€K€љ\њЭ]™[ќZ[ќ]\О€В€›Э[™€]™[ќЛ›[™Э€L€]™[ќЛ›[™ЭИ\Щ[ќ[J]™[ќЛЌJH€ќ[€L€]™[ќЛ›[™ЭИ\Щ[ќ[J]™[ќЛЋJH€ќ[€X^€]™[ќЛ›[™ЭИX]›X^
‹‹™]™[ќКH€ќ[€K€X^]™[XЪШYЩN€В€L€\Щ[ќ[J]™[XЪШYЩ\ЛЌJK€L€\Щ[ќ[J]™[XЪШYЩ\ЛЋJK€X^€X]›X^
‹‹›]™[XЪШYЩ\КK€K€X^YXЪ[љXФXЪШYЩN€В€L€\Щ[ќ[JYXЪ[љXФXЪШYЩ\ЛЌJK€L€\Щ[ќ[JYXЪ[љXФXЪШYЩ\ЛЋJK€X^€X]›X^
‹‹›YXЪ[љXФXЪШYЩ\КK€K€Z[\ЭЫ™SZ[ќ]\О€Z[\ЭЫ™SYYX[њЛ€NВџB‚љY€
Z\УXZ[•™XY
HВ€ЛИ›ЩXЭ[Ы€ќ[€Э\[™И\љ]™\И]ИЮ[ќ]XИЫШЪИњ›ЫH\™›Ь›X[ЩK››ЭК
K‚€ЛИX]љ[™И]\ЩHYYИ›ШЩ\ЬИ\[YH[ќ›ЩXЩ\ИЭX‹[Z[\ЩXЫЫ™€ЛИ›Ш][™Л\Ъ[ќY™™\™[Щ\И]L\Иќ[€›Э[™\љY\Л€HЪ[™ЫH^HЭљZЩB€ЛИШ[€[€Ъ[™ЩHЬ™H[ЫЫYH[™Ш\ШШYH[ќИHY™™\™[ќ\Ъ\ЩHЬ™\‹‚€ЛИњ™Y^™H›ЭШ[XЫШЪИЫЭ\Щ\И™Y›Ь™HШY[™ИHќ[ќ[YHЫИY[ќXШ[€ЛИЩYYЬЭ]YЮH›ШњИ™[XZ[€љ]Y›Ь‹Xљ]™\X]X›HXЬ›ЬЬИњ™\Ъ›ШЩ\ЬЩ\Л‚€Шљ™XЭ™Yљ[™T›Ь\ќJЫШ[\Лњ\™›Ь›X[ЩH‹В€[YN€Шљ™XЭ™њ™Y^™JИ›ЭО€

HO€JK€ЫЫ™љYЭ\X›N€ќYK€JNВ€]K››ЭИH

HO€WНММММВ€ЛИќ[ќ[YK\Ы[ЪЩHќZ[ИHШ[YHУKШШ[ќ\ИЪ[\И\ЩYћHHXZ[€ќ[ќ[YB€ЛИЭZ]K[€ШYИH›ЩXЭ[Ы€\ЬYKЫЬ›[™Ш[YH[Щ[\Л‚€ЫЫњЭЬљYЪ[[ЩИHЫЫњЫЫK›ЩОВ€ЫЫњЫЫK›ЩИH

HO€ЯNВ€™\]Z\™J‹‹Ьќ[ќ[YK\Ы[ЪЩKљњИЉNВ€ЫЫњЫЫK›ЩИHЬљYЪ[[ЩОВ€ЫЫњЭ\HHЫШ[—ЧСTЦ‘T“ЧЧОВ€\ЬЩ\ќ›ЪК\Kњ™X[XY\ЬИќ[ќ[YH]\Э[љ]X[^™H[€]™\ћHЫЬљЩ\€ЉNВ€ЫЫњЭ›Ш€HЫЬљЩ\‘]Kљ›ШЋВ€\™[ќЬќњЬЭY\ЬШYЩJЪ[][]PШ[\ZYЫЉ\K›Ш‹њЩYY›Ш‹њЭ]YЮJJNВџH[ЩHВ€ЫЫњЭЭ\ќY]H]K››ЭК
NВ€ЛИЩ[ќH[љ\]YHЩYYИ\™HЭ]YљYYXЬ›ЬЬИ[™YHЭ]YЪY\Л€ќ[›љ[™В€ЛИЫ™Hќ[™X[][YHШ[\ZYЫ€\€ЩYYЩY\И\Ињ›ШY]Y]™[ЭИB€ЛИЫ[ЪЩK\ЭZ]HќYЩ][њЭXYЩ€][\Z[™И][ќИHЫ™И™[ЪX\љЛ‚€ЫЫњЭ™\]Y\ЭYЩYYHќ[X™\Љ›ШЩ\ЬЛ™[ќ‹”“СФ‘TФТSУ—ФТS‘УWФСQQ
NВ€ЫЫњЭ™\]Y\ЭYЭ]YЮHH›ШЩ\ЬЛ™[ќ‹”“СФ‘TФТSУ—ФТS‘УWФХђUQЦNВ€ЫЫњЭ™\]Y\ЭYЭ]YЮP]ЪH›ШЩ\ЬЛ™[ќ‹”“СФ‘TФТSУ—УУ“WФХђUQЦNВ€ЫЫњЭ]Y]Ы›HH›ШЩ\ЬЛ™[ќ‹”“СФ‘TФТSУ—РUQUУУ“HOOHЊHЋВ€ЫЫњЭЭ[[X\ћSЫ›HH›ШЩ\ЬЛ™[ќ‹”“СФ‘TФТSУ—ФХSSPT–WУУ“HOOHЊHЋВ€ЫЫњЭ›ШњИHќ[X™\‹љ\Сљ[љ]J™\]Y\ЭYЩYY
H	‰€ХђUQТQTЛљ[ЫY\К™\]Y\ЭYЭ]YЮJB€ИЮИЩYY€™\]Y\ЭYЩYYЭ]YЮN€™\]Y\ЭYЭ]YЮHWB€€’SPT–WФСQQЛ›X\

ЩYY[™^
HO€
В€ЩYY€Э]YЮN€ХђUQТQTЦЪ[™^	HХђUQТQTЛ›[™ЭK€JJK™љ[\Љ
›ШЉHO€TХђUQТQTЛљ[ЫY\К™\]Y\ЭYЭ]YЮP]Ъ
H›Ш‹њЭ]YЮHOOH™\]Y\ЭYЭ]YЮP]Ъ
NВ€ЛИљ]™H\ЫЫ]Yќ[ќ[Y\ИЩY\H^XЭЊ\ЩYYЭZ]HЫЬЩHИB€ЛИљ[™]K\ЩXЫЫ™Ы[ЪЩK]\ЭќYЩ]Ы€H™Y™\™[ЩHЫЬљЬЭ][Ы‹‚€ЫЫњЭЫЬљЩ\ђЫЭ[ќHX]›Z[ЉK›ШњЛ›[™Э
NВ€ЛИ]HЫЭЩ\€ЫШ[Yљ]™[€Ш[\ZYЫњИљ\њЭ€XXЪШ[\ZYЫ€Щ]ИHњ™\Ъ€ЛИќ[ќ[YN€XќYИ™\Щ]И\™H[ќ[ќ[Ы[H›Эќ\ЭYИЫX\€]™\ћB€ЛИ[њЪY[ќ[љ[X][Ы‹Ь›ШИљY[™]ЩY[€[™\[™[ќ[[ЩHШ[\\Л‚€ЫЫњЭЬ™\™Y›ШњИHЛ‹‹љ›ШњЧKњЫЬќ

YќљYЪ
HO€
€ХђUQТQTЛљ[™^ЩЉљYЪњЭ]YЮJHHХђUQТQTЛљ[™^ЩЉYќњЭ]YЮJB€
JNВ€]™^›Ш’[™^HВ€ЫЫњЭШ[\ZYЫ”™\Э[ИHЧNВ€ЫЫњЭќ[‘њ™\ЪШ[\ZYЫ€H
›ШЉHO€™]И›ЫZ\ЩJ
™\ЫЫ™K™Z™XЭ
HO€В€ЫЫњЭЫЬљЩ\€H™]ИЫЬљЩ\ЉЧЩљ[[[YKИЫЬљЩ\‘]N€И›Ш€HJNВ€ЫЬљЩ\‹›ЫЩJ›Y\ЬШYЩH‹™\ЫЫ™JNВ€ЫЬљЩ\‹›ЫЩJ™\њ›Ь€‹™Z™XЭ
NВ€ЫЬљЩ\‹›ЫЩJ™^]‹
ЫЩJHO€В€Y€
ЫЩHOOH
H™Z™XЭ
™]И\њ›ЬЉ›ЩЬ™\ЬЪ[Ы€ЫЬљЩ\€^]YЪ]ЫЩH	ШЫЩ_X
JNВ€JNВ€JNВ€ЫЫњЭќ[“[™HH\Ю[И

HO€В€Ъ[H
™^›Ш’[™^Ь™\™Y›ШњЛ›[™Э
HВ€ЫЫњЭ›Ш€HЬ™\™Y›ШњЦЫ™^›Ш’[™^NВ€™^›Ш’[™^
ПHNВ€Ш[\ZYЫ”™\Э[Лњ\Ъ
]ШZ]ќ[‘њ™\ЪШ[\ZYЫЉ›ШЉJNВ€B€NВ‚€›ЫZ\ЩK[
\њ^K™њ›ЫJИ[™Э€ЫЬљЩ\ђЫЭ[ќK

HO€ќ[“[™J
JJKќ[Љ

HO€В€ЫЫњЭШ[\ZYЫњИHШ[\ZYЫ”™\Э[ЛњЫЬќ

YќљYЪ
HO€
€ХђUQТQTЛљ[™^ЩЉYќњЭ]YЮJHHХђUQТQTЛљ[™^ЩЉљYЪњЭ]YЮJB€YќњЩYYHљYЪњЩYY€
JNВ€ЫЫњЭЭ™\[HЭ[[X\љ^™JШ[\ZYЫњКNВ€ЫЫњЭћTЭ]YЮHHШљ™XЭ™њ›ЫQ[ќљY\КХђUQТQTВ€™љ[\Љ
Э]YЮJHO€Ш[\ZYЫњЛњЫЫYJ
Ш[\ZYЫЉHO€Ш[\ZYЫ‹њЭ]YЮHOOHЭ]YЮJJB€›X\

Э]YЮJHO€В€Э]YЮK€Э[[X\љ^™JШ[\ZYЫњЛ™љ[\Љ
Ш[\ZYЫЉHO€Ш[\ZYЫ‹њЭ]YЮHOOHЭ]YЮJJK€JJNВ‚€ЫЫњЭЭ]Y\‘]Z[ИHВ€Ы™Щ\Э€Л‹‹Ш[\ZYЫњЧB€њЫЬќ

YќљYЪ
HO€љYЪ™[\ЩYZ[ќ]\ИHYќ™[\ЩYZ[ќ]\КB€њЫXЩJКB€›X\

ИЩYYЭ]YЮK[\ЩYZ[ќ]\ИJHO€
ИЩYYЭ]YЮK[\ЩYZ[ќ]\ИJJK€Ш\О€Л‹‹Ш[\ZYЫњЧB€њЫЬќ

YќљYЪ
HO€љYЪ›X^YXЪ[љXСШ\Z[ќ]\ИHYќ›X^YXЪ[љXСШ\Z[ќ]\КB€њЫXЩJJB€›X\

ИЩYYЭ]YЮKX^YXЪ[љXСШ\Z[ќ]\ЛX^YXЪ[љXСШ\]Z[ИJHO€
В€ЩYY€Э]YЮK€X^YXЪ[љXСШ\Z[ќ]\Л€]Z[О€X^YXЪ[љXСШ\]Z[Л€JJK€]™[XЪШYЩ\О€Л‹‹Ш[\ZYЫњЧB€њЫЬќ

YќљYЪ
HO€љYЪ›X^]™[XЪШYЩHHYќ›X^]™[XЪШYЩJB€њЫXЩJJB€›X\

ИЩYYЭ]YЮKX^]™[XЪШYЩKX^]™[XЪШYЩQ]Z[ИJHO€
В€ЩYY€Э]YЮK€X^]™[XЪШYЩK€]Z[О€X^]™[XЪШYЩQ]Z[Л€JJK€YXЪ[љXФXЪШYЩ\О€Л‹‹Ш[\ZYЫњЧB€њЫЬќ

YќљYЪ
HO€љYЪ›X^YXЪ[љXФXЪШYЩHHYќ›X^YXЪ[љXФXЪШYЩJB€њЫXЩJJB€›X\

ИЩYYЭ]YЮKX^YXЪ[љXФXЪШYЩKX^YXЪ[љXФXЪШYЩQ]Z[ИJHO€
В€ЩYY€Э]YЮK€X^YXЪ[љXФXЪШYЩK€]Z[О€X^YXЪ[љXФXЪШYЩQ]Z[Л€JJK€NВ€ЫЫњЭXYЫ›ЬЭXИHВ€[љ\]YTЩYYО€™]ИЩ]
Ш[\ZYЫњЛ›X\

Ш[\ZYЫЉHO€Ш[\ZYЫ‹њЩYY
JKњЪ^™K€›ЭX›SYXЪ[љXЬО€“ХP“WУQPТS’PФЛ›[™Э€Ш[ЩXЫЫ™О€ќ[X™\Љ

]K››ЭК
HHЭ\ќY]
HИL
KќСљ^Y
ЉJK€Э™\[€ћTЭ]YЮK€Э]Y\њО€Э]Y\‘]Z[Л€‹‹ЉЭ[[X\ћSЫ›HИЯH€ИШ[\ZYЫњИJK€NВ€ћHВ€Y€
]Y]Ы›JHВ€ЫЫњЫЫK›ЩК”УУ‹њЭљ[™ЪYћJИ]Y]Ы›N€ќYK‹‹™XYЫ›ЬЭXИJJNВ€™]\›ЋВ€B€\ЬЩ\ќ™\]X[
™]ИЩ]
Ш[\ZYЫњЛ›X\

Ш[\ZYЫЉHO€Ш[\ZYЫ‹њЩYY
JKњЪ^™KЊќH]Y]]\ЭЫЭ™\€]X\ЭЊ[љ\]YHЩYYИЉNВ€\ЬЩ\ќ™\]X[
™]ИЩ]
Ш[\ZYЫњЛ›X\

Ш[\ZYЫЉHO€Ш[\ZYЫ‹њЭ]YЮJJKњЪ^™KЛќH]Y]]\Э^\Ъ\ЩH™YHќ^Z[™ИЭ]YЪY\ИЉNВ€\ЬЩ\ќ™\]X[
Э™\[ЫЫ\]YЭ™\[Ш[\ZYЫњЛ™]™\ћHШ[\YЭ]YЮH]\Эљ[љ\ЪHШ[\ZYЫ€ЉNВ€\ЬЩ\ќ›ЪКЭ™\[™[\ЩYZ[ќ]\ЛњLЏHKШ[\ZYЫ€]\Э™]Z[€H™X[Ь[љ[™И[™ZYHШ[YN€	Т”УУ‹њЭљ[™ЪYћJЭ™\[™[\ЩYZ[ќ]\К_X
NВ€\ЬЩ\ќ›ЪКЭ™\[™[\ЩYZ[ќ]\ЛњLHLНKL	HЩ€Ш[\ZYЫњИЪЭ[љ]HKL€Э\€\™Щ]Ъ]X\™Ъ[Ћ€	Т”УУ‹њЭљ[™ЪYћJЭ™\[™[\ЩYZ[ќ]\К_X
NВ€\ЬЩ\ќ›ЪКЭ™\[›X^YXЪ[љXСШ\Z[ќ]\ЛњLHL	HЩ€Ш[\ZYЫњИ™YYH›ЭX›H[›ШЪИ]X\Э]™\ћHZYЪZ[ќ]\О€	Т”УУ‹њЭљ[™ЪYћJЭ™\[›X^YXЪ[љXСШ\Z[ќ]\К_X
NВ€\ЬЩ\ќ›ЪКЭ™\[›X^YXЪ[љXСШ\Z[ќ]\Л›X^HL›ИШ[\YШ[\ZYЫ€ЪЭ[ЫИ[€Z[ќ]\ИЪ]Э]H›ЭX›H[›ШЪО€	Т”УУ‹њЭљ[™ЪYћJЭ™\[›X^YXЪ[љXСШ\Z[ќ]\К_X
NВ€\ЬЩ\ќ›ЪКЭ™\[›X^]™[XЪШYЩKњLHНK]HXЫЫ›Ы^H]\Э›ЭЫЫ\ЩH[ќИЪX[ќ]™[XЪШYЩ\О€	Т”УУ‹њЭљ[™ЪYћJЭ™\[›X^]™[XЪШYЩJ_X
NВ€\ЬЩ\ќ›ЪКЭ™\[›X^YXЪ[љXФXЪШYЩKњLH›ЭX›HYXЪ[љXЬИ™YY›ЫЫHИњ™X]H™]ЩY[€\Ъ\Щ\О€	Т”УУ‹њЭљ[™ЪYћJЭ™\[›X^YXЪ[љXФXЪШYЩJ_X
NВ€\ЬЩ\ќ™\]X[
Э™\[™љ\њЭ]™[ќZ[ќ]\Л™›Э[™Э™\[Ш[\ZYЫњЛ™]™\ћHШ[\YШ[\ZYЫ€]\Э[ЫЭ[ќ\€[€[™\™Ь›Э[™]™[ќЉNВ€\ЬЩ\ќ›ЪКЭ™\[™љ\њЭ]™[ќZ[ќ]\ЛњLHMK]™[ќИЪЭ[™XЫЫYHљ\ЪX›H\љ[™ИHX\›HШ[YN€	Т”УУ‹њЭљ[™ЪYћJЭ™\[™љ\њЭ]™[ќZ[ќ]\К_X
NВ€\ЬЩ\ќ›ЪКЭ™\[™љ\њЭ]™[ќZ[ќ]\Л›X^HЊ›ИЩYYЪЭ[YH]Иљ\њЭ]™[ќ™^[Ы™Щ[ќHZ[ќ]\О€	Т”УУ‹њЭљ[™ЪYћJЭ™\[™љ\њЭ]™[ќZ[ќ]\К_X
NВ€HШ]Ъ
\њ›ЬЉHВ€ЛИЩY\Hќ[YX\Э\™[Y[ќљ\ЪX›HЪ[€H\™Щ]\Э]H\ЬЩ\ќ[Ы€Z[ОВ€ЛИ\И\Э\И[ЫИH[[Ъ[™И]Y]\ЩYИЭZYHH™^љ^‚€ЫЫњЫЫK›ЩК”УУ‹њЭљ[™ЪYћJИXYЫ›ЬЭXО€ќYK‹‹™XYЫ›ЬЭXИJJNВ€›ЭИ\њ›ЬЋВ€B‚€ЫЫњЫЫK›ЩК”УУ‹њЭљ[™ЪYћJИЪО€ќYK‹‹™XYЫ›ЬЭXИJJNВ€JKШ]Ъ

\њ›ЬЉHO€В€ЫЫњЫЫK™\њ›ЬЉ\њ›ЬЏЛњЭXЪИ\њ›ЬЉNВ€›ШЩ\ЬЛ™^]ЫЩHHNВ€JNВџB