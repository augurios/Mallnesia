import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { MeshBVH } from "three-mesh-bvh";

// How the player moves through the blockout: pushed out of walls horizontally, stood on the highest surface
// within step height, falling otherwise. No rendering and no DOM here, so the walk test
// (scripts/test-walk.mts) runs exactly the code the game runs.

export const FLOOR_HEIGHT = 5; // keep in sync with scripts/blockout/config.ts
export const PLAYER_RADIUS = 0.35;
const COLLIDER_HEIGHT = 1.0; // the collision sphere sits at chest height, so railings (1.1 m) block too
const STEP_UP = 0.5; // the player climbs ledges up to this high (stair risers are 0.125)
const SNAP_DOWN = 0.4; // and follows the ground down this far without falling
const GRAVITY = 18;
// Meshes of the blockout the player collides with. Keep in sync with COLLIDERS in scripts/blockout/config.ts.
export const COLLIDERS = ["walls", "glass", "rails", "stairs", "elev", "column", "steel", "planter", "barrier"];

/** The material's name, not the node's: the loader makes node names unique (walls, walls_1, ...) for chunks. */
const kindOf = (mesh: THREE.Mesh) => (mesh.material as THREE.Material).name;

export class Walk {
  fallSpeed = 0;
  /** Walls, glass, railings and the rest of COLLIDERS merged into one BVH. */
  private bvh: MeshBVH | null = null;
  /** Floor slabs and stair treads, raycast downward to find what the player stands on. */
  private groundBvh: MeshBVH | null = null;
  private sphere = new THREE.Sphere();
  private closest = new THREE.Vector3();
  private push = new THREE.Vector3();
  private groundRay = new THREE.Ray(new THREE.Vector3(), new THREE.Vector3(0, -1, 0));

  /** `player` is the feet position; it is moved in place. */
  player: THREE.Vector3;
  constructor(player: THREE.Vector3) {
    this.player = player;
  }

  /** Builds both BVHs from a loaded blockout scene. `extra` are more colliders in world space (positions only), such as props. */
  load(root: THREE.Object3D, extra: THREE.BufferGeometry[] = []) {
    const parts: THREE.BufferGeometry[] = [...extra];
    const ground: THREE.BufferGeometry[] = [];
    const plain = (mesh: THREE.Mesh) => {
      const g = (mesh.geometry as THREE.BufferGeometry).clone();
      g.deleteAttribute("normal");
      return g;
    };
    root.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      const kind = kindOf(o);
      if (kind.startsWith("floor") || kind === "stairs") ground.push(plain(o));
      if (COLLIDERS.includes(kind)) parts.push(plain(o));
    });
    this.bvh = parts.length ? new MeshBVH(mergeGeometries(parts, false)) : null;
    this.groundBvh = ground.length ? new MeshBVH(mergeGeometries(ground, false)) : null;
  }

  get ready() {
    return this.bvh !== null && this.groundBvh !== null;
  }

  /** Push the player out of any wall within PLAYER_RADIUS, horizontally only. */
  collide() {
    const { bvh, sphere, closest, push, player } = this;
    if (!bvh) return;
    const baseY = player.y;
    for (let pass = 0; pass < 3; pass++) {
      sphere.center.set(player.x, baseY + COLLIDER_HEIGHT, player.z);
      sphere.radius = PLAYER_RADIUS;
      let moved = false;
      bvh.shapecast({
        intersectsBounds: (box) => box.intersectsSphere(sphere),
        intersectsTriangle: (tri) => {
          tri.closestPointToPoint(sphere.center, closest);
          push.subVectors(sphere.center, closest);
          // Ignore geometry on other floors: it must be within reach in 3D, not just horizontally.
          const dy = push.y;
          if (Math.abs(dy) >= PLAYER_RADIUS) return false;
          push.y = 0;
          const dist = push.length();
          const reach = Math.sqrt(PLAYER_RADIUS * PLAYER_RADIUS - dy * dy);
          if (dist >= reach || dist < 1e-6) return false;
          push.multiplyScalar((reach - dist) / dist);
          sphere.center.add(push);
          player.x = sphere.center.x;
          player.z = sphere.center.z;
          moved = true;
          return false;
        },
      });
      if (!moved) break;
    }
  }

  /** Stands the player on the highest surface within step height, or lets them fall. */
  followGround(dt: number, floor: number) {
    const { groundBvh, groundRay, player } = this;
    if (!groundBvh) return;
    groundRay.origin.set(player.x, player.y + STEP_UP, player.z);
    const hit = groundBvh.raycastFirst(groundRay, THREE.FrontSide);
    if (hit && hit.point.y >= player.y - SNAP_DOWN) {
      player.y = hit.point.y;
      this.fallSpeed = 0;
      return;
    }
    this.fallSpeed += GRAVITY * dt;
    player.y -= this.fallSpeed * dt;
    if (hit && player.y < hit.point.y) {
      player.y = hit.point.y;
      this.fallSpeed = 0;
    }
    if (player.y < -3) {
      player.y = floor * FLOOR_HEIGHT; // fell out of the world: back to the last floor
      this.fallSpeed = 0;
    }
  }
}
