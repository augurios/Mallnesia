import * as THREE from "three";
import { NOISE, Slide, Tip, type NoiseKind, type NoiseSpot } from "./night-noise";
import { FLOOR_HEIGHT } from "./walk";

// The loose objects of the night-noise events: chairs and bins that tip over or slide across the floor
// (night-noise.ts has the timing and the motions). Each is a clone of a kit piece's near meshes inside a pivot group
// that the motion turns about the base edge. They stay where they land, so the player who goes to look finds them.

export interface NoiseHooks {
  /** Hit the floor: world position (meters) and how hard, 0 to 1. */
  onImpact(x: number, y: number, z: number, strength: number): void;
  /** Started sliding: world position and how long it will scrape. */
  onScrape(x: number, y: number, z: number, seconds: number): void;
  /** Whether a body can stand at the plan point on this floor (slides stop at walls and voids). */
  walkable(floor: number, x: number, y: number): boolean;
}

interface Loose {
  group: THREE.Group;
  mesh: THREE.Object3D;
  floor: number;
  /** Plan position of the object's centre at rest upright, and the heading it moves toward. */
  x: number;
  y: number;
  heading: number;
  tip: Tip | null;
  slide: Slide | null;
  dir: THREE.Vector2; // the tip direction in scene xz
}

export interface NoiseWorld {
  object: THREE.Group;
  count(): number;
  /** Starts an event at a spot. False if the kind's model did not load or the world is full of things the player can see. */
  spawn(kind: NoiseKind, spot: NoiseSpot, floor: number, hooks: NoiseHooks, hidden: (x: number, y: number, floor: number) => boolean): boolean;
  update(dt: number, hooks: NoiseHooks): void;
  dispose(): void;
}

/** The near meshes of a loaded kit piece: no far versions, no collider. */
function nearClone(piece: THREE.Object3D): THREE.Object3D {
  const copy = piece.clone(true);
  const drop: THREE.Object3D[] = [];
  copy.traverse((o) => {
    if (o.name.endsWith("_far") || o.name === "collider") drop.push(o);
  });
  drop.forEach((o) => o.removeFromParent());
  return copy;
}

const PIECE: Record<NoiseKind, "chair" | "bin"> = { chair_tip: "chair", chair_slide: "chair", bin_tip: "bin" };

export function createNoiseWorld(pieces: { chair: THREE.Object3D | null; bin: THREE.Object3D | null }): NoiseWorld {
  const object = new THREE.Group();
  object.name = "night-noise";
  const loose: Loose[] = [];
  const axis = new THREE.Vector3();
  const rand = Math.random;

  const remove = (l: Loose) => {
    l.group.removeFromParent();
    loose.splice(loose.indexOf(l), 1);
  };

  return {
    object,
    count: () => loose.length,
    spawn(kind, spot, floor, hooks, hidden) {
      const source = pieces[PIECE[kind]];
      if (!source) return false;
      // Make room: the oldest thing the player cannot see goes. Nothing hidden to remove: skip this event.
      while (loose.length >= NOISE.MAX_OBJECTS) {
        const old = loose.find((l) => hidden(l.x, l.y, l.floor));
        if (!old) return false;
        remove(old);
      }
      const group = new THREE.Group();
      const mesh = nearClone(source);
      group.add(mesh);
      object.add(group);
      const l: Loose = { group, mesh, floor, x: spot.x, y: spot.y, heading: spot.heading, tip: null, slide: null, dir: new THREE.Vector2() };
      loose.push(l);
      const yaw = spot.heading; // chairs face the way they move or fall (backward falls add PI below)
      const world = new THREE.Vector3(spot.x, floor * FLOOR_HEIGHT, -spot.y);
      if (kind === "chair_slide") {
        mesh.rotation.y = yaw;
        group.position.copy(world);
        l.slide = new Slide(NOISE.PUSH[0] + rand() * (NOISE.PUSH[1] - NOISE.PUSH[0]));
        hooks.onScrape(world.x, world.y + 0.1, world.z, l.slide.speed / NOISE.FRICTION);
      } else {
        const chair = kind === "chair_tip";
        const backward = chair && rand() < 0.6; // chairs mostly go over backward, the way a push on the backrest tips them
        const fall = chair ? yaw + (backward ? Math.PI : 0) : yaw;
        const r = chair ? (backward ? 0.28 : 0.25) : 0.226;
        l.dir.set(Math.cos(fall), -Math.sin(fall)); // plan heading to scene xz
        mesh.rotation.y = chair ? yaw : 0;
        mesh.position.set(-l.dir.x * r, 0, -l.dir.y * r);
        group.position.set(world.x + l.dir.x * r, world.y, world.z + l.dir.y * r);
        l.tip = new Tip(chair ? (backward ? 1.32 : 1.5) : 1.55);
      }
      return true;
    },
    update(dt, hooks) {
      for (const l of loose) {
        if (l.tip && !l.tip.settled) {
          const hit = l.tip.update(dt);
          axis.set(l.dir.y, 0, -l.dir.x); // up x direction: rotating about it by +angle tips the top toward the direction
          l.group.quaternion.setFromAxisAngle(axis, l.tip.angle);
          if (hit !== null) hooks.onImpact(l.group.position.x, l.group.position.y + 0.2, l.group.position.z, Math.min(1, hit / 4.5));
        }
        if (l.slide && !l.slide.stopped) {
          const d = l.slide.update(dt);
          const nx = l.x + Math.cos(l.heading) * d;
          const ny = l.y + Math.sin(l.heading) * d;
          if (hooks.walkable(l.floor, nx, ny)) {
            l.x = nx;
            l.y = ny;
            l.group.position.set(nx, l.floor * FLOOR_HEIGHT, -ny);
          } else {
            l.slide.speed = 0; // stopped against something
            hooks.onImpact(l.group.position.x, l.group.position.y + 0.2, l.group.position.z, 0.35);
          }
        }
      }
    },
    dispose() {
      loose.length = 0;
      object.removeFromParent();
    },
  };
}
