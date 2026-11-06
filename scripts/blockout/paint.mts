import { paintTowers } from "./towers.mts";
import { paintBridge } from "./bridge.mts";

/**
 * Everything that changes the floor grid after the plans are rasterized (the stair zones, the bridge arc).
 * The builder, the props builder and the walk test all call this, so they all see the grid the mall is built from.
 * Add new painting steps here, not in the callers.
 */
export function paintGrid() {
  paintTowers();
  paintBridge();
}
