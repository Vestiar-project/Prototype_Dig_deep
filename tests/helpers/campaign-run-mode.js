"use strict";

// The diagnostic player returns to an already known ore layer when a live
// recipe still needs that ore and the frontier has moved well past its entry.
// This uses the visible run-mode choice; it never grants ore or changes depth.
function configureCampaignRunMode(api, bestDepth) {
  const snapshot = api.getSnapshot();
  const ore = global.DepthZeroUpgrades.ORE_TYPES.find(
    (definition) => definition.id === snapshot.focusedOreId,
  );
  const { TILE_SIZE, METERS_PER_TILE } = global.DepthZeroWorld.WORLD_CONFIG;
  const naturalDepth = ore ? Math.max(0, Number(ore.depth) || 0) / TILE_SIZE * METERS_PER_TILE : null;
  const known = Boolean(ore && (snapshot.lifetimeOres[ore.id] || 0) > 0);
  const needsFocusedOre = known && api.getUpgradeCatalog().some((definition) => (
    definition.unlocked
    && definition.level < definition.maxLevel
    && (definition.recipe?.[ore.id] || 0) > (snapshot.inventory[ore.id] || 0)
  ));
  const mode = !snapshot.campaign.finalInstalled
    && needsFocusedOre
    && bestDepth > naturalDepth + 150
    ? "harvest"
    : "descent";
  api.setRunMode(mode);
  return { mode: api.getRunModeStatus().mode, focusedOreId: ore?.id || null, naturalDepth };
}

module.exports = { configureCampaignRunMode };
