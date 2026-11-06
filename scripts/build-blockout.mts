// Builds the blockout GLB of the mall from docs/floorplans/floor{1,2,3}_plan.json.
// Run: npm run blockout   (writes public/models/mall_blockout.glb)
//
// Plan coordinates are meters, x east, y north. In the GLB: x = plan x, z = -plan y, y up.
// Method: rasterize each floor onto a 0.5 m grid, classify cells (walkable / solid / hole),
// then emit floor, ceiling and wall quads along the borders, merging runs of equal edges.
//
// The work is split by what a part is (see scripts/blockout/):
//   config   constants, cell classes, plan types      palette  materials (colors, roughness)
//   grid     plans, rasterizing, cell lookups         shell    floors, ceilings, walls, roof
//   geo      geometry accumulator and primitives      towers   stair towers, gardens, elevator piers
//   walls    edge runs merged into wall quads         doors    the secret-hallway doors
//   check    spawn check, reachability debug image    write    chunking, meshopt, GLB output
//   ao       baked ambient occlusion map (ao.png)
import { buildShell } from "./blockout/shell.mts";
import { paintGrid } from "./blockout/paint.mts";
import { buildTowers, buildElevatorPiers } from "./blockout/towers.mts";
import { checkSpawns, debugReachability } from "./blockout/check.mts";
import { buildBridge } from "./blockout/bridge.mts";
import { buildDoors } from "./blockout/doors.mts";
import { bakeAO } from "./blockout/ao.mts";
import { writeGlb } from "./blockout/write.mts";

// The order matters: it is the order of the triangles in the file.
paintGrid();
buildShell();
buildTowers();
buildElevatorPiers();
buildBridge();
checkSpawns();
debugReachability();
const doorNodes = buildDoors();
await writeGlb(doorNodes);
bakeAO(); // a separate file next to the GLB: the floors and ceilings sample it by world position
