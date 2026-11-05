import * as THREE from "three";

// The mall opens, closes and slams its own doors; the player never touches them. Doors come from the
// blockout GLB (see scripts/blockout/doors.mts): a root node per door with one pivot node per leaf.

const OPEN_ANGLE = THREE.MathUtils.degToRad(100);
const SLOW_SPEED = 1 / 2.4; // fraction of the swing per second
const SLAM_SPEED = 1 / 0.22;
const BLOCKS_BELOW = 0.35; // a door this far open (or less) still blocks the player
const THICKNESS = 0.1; // collision half-thickness
const REACH = 1.4; // the player can use a door when this close to it (meters from the door surface)
const REACH_CONE = Math.cos(THREE.MathUtils.degToRad(70)); // ...and when looking roughly toward it
const SEEN_DISTANCE = 25; // a door in view and closer than this is "being watched"
const KEEP_CLEAR = 2.5; // never change state with the player this close, so it can't clip them
const CHANGE_EVERY: [number, number] = [20, 50]; // seconds between the mall's changes, per door
const FIRST_CHANGE: [number, number] = [6, 20];
const SLAM_CHANCE = 0.5; // when an open door closes by itself

export interface DoorEvents {
  /** A door started to swing slowly (hinge creak). Position is the door centre in world meters. */
  onCreak(x: number, y: number, z: number): void;
  /** A door hit its frame hard. */
  onSlam(x: number, y: number, z: number): void;
  /** The player tried a door only the mall can move. */
  onLocked(x: number, y: number, z: number): void;
}

interface Door {
  id: string;
  floor: number; // 0-based
  x: number;
  y: number; // mid-height, world meters
  z: number;
  axis: "x" | "y";
  half: number;
  /** Only the mall can move this door; the player's use fails. */
  locked: boolean;
  leaves: { node: THREE.Object3D; sign: number }[];
  angle: number; // 0 closed .. 1 open
  target: number;
  speed: number;
  slamming: boolean;
  timer: number;
}

const rand = ([a, b]: [number, number]) => a + Math.random() * (b - a);
const smooth = (t: number) => t * t * (3 - 2 * t);

export class Doors {
  private doors: Door[] = [];
  private frustum = new THREE.Frustum();
  private point = new THREE.Vector3();
  auto = true;

  constructor(private events: DoorEvents) {}

  /** Finds the door nodes in a loaded scene. */
  load(scene: THREE.Object3D) {
    scene.traverse((o) => {
      if (typeof o.userData.door !== "string" || o.userData.leaf) return;
      const leaves = o.children.filter((c) => c.userData.leaf).map((c) => ({ node: c, sign: c.userData.sign as number }));
      this.doors.push({
        id: o.userData.door,
        floor: o.userData.floor,
        x: o.position.x,
        y: o.position.y + 1.2,
        z: o.position.z,
        axis: o.userData.axis,
        half: o.userData.width / 2,
        locked: o.userData.leadsTo === "garage",
        leaves,
        angle: 0,
        target: 0,
        speed: SLOW_SPEED,
        slamming: false,
        timer: rand(FIRST_CHANGE),
      });
    });
  }

  get count() {
    return this.doors.length;
  }

  /** Swings a door open or shut by name (scripted events call this). */
  open(id: string) {
    const d = this.doors.find((x) => x.id === id);
    if (d) this.swing(d, 1, false);
  }
  close(id: string) {
    const d = this.doors.find((x) => x.id === id);
    if (d) this.swing(d, 0, false);
  }
  slam(id: string) {
    const d = this.doors.find((x) => x.id === id);
    if (d) this.swing(d, 0, true);
  }

  /** The door the player could use from here (close enough and facing it), if any. */
  usable(x: number, z: number, floor: number, yaw: number): { id: string; locked: boolean } | null {
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    let best: Door | null = null;
    let bestD = Infinity;
    for (const d of this.doors) {
      if (d.floor !== floor) continue;
      const hx = d.axis === "x" ? d.half : THICKNESS;
      const hz = d.axis === "x" ? THICKNESS : d.half;
      const dx = Math.max(d.x - hx, Math.min(x, d.x + hx)) - x;
      const dz = Math.max(d.z - hz, Math.min(z, d.z + hz)) - z;
      const dist = Math.hypot(dx, dz);
      if (dist > REACH || dist >= bestD) continue;
      if (dist > 1e-6 && (dx * fx + dz * fz) / dist < REACH_CONE) continue;
      bestD = dist;
      best = d;
    }
    return best ? { id: best.id, locked: best.locked } : null;
  }

  /** The player pressed E at a door: it toggles, unless it is locked. */
  use(id: string) {
    const d = this.doors.find((x) => x.id === id);
    if (!d) return;
    if (d.locked) this.events.onLocked(d.x, d.y, d.z);
    else this.swing(d, d.target === 1 ? 0 : 1, false);
  }

  /** Debug: act on the door nearest to the player on the same floor. Returns its id. */
  nearest(x: number, z: number, floor: number): string | null {
    let best: Door | null = null;
    let bestD = Infinity;
    for (const d of this.doors) {
      if (d.floor !== floor) continue;
      const dist = Math.hypot(d.x - x, d.z - z);
      if (dist < bestD) {
        bestD = dist;
        best = d;
      }
    }
    return best?.id ?? null;
  }

  private swing(d: Door, target: number, slam: boolean) {
    if (slam && d.angle > 0) {
      d.target = 0;
      d.speed = SLAM_SPEED;
      d.slamming = true;
      return;
    }
    if (d.target === target || (target === 0 && d.angle === 0) || (target === 1 && d.angle === 1)) return;
    d.target = target;
    d.speed = SLOW_SPEED;
    d.slamming = false;
    this.events.onCreak(d.x, d.y, d.z);
  }

  /** Keeps the player out of closed (or nearly closed) doors. Mutates x and z. */
  collide(p: { x: number; z: number }, radius: number, floor: number) {
    for (const d of this.doors) {
      if (d.floor !== floor || d.angle > BLOCKS_BELOW) continue;
      const hx = d.axis === "x" ? d.half : THICKNESS;
      const hz = d.axis === "x" ? THICKNESS : d.half;
      const cx = Math.max(d.x - hx, Math.min(p.x, d.x + hx));
      const cz = Math.max(d.z - hz, Math.min(p.z, d.z + hz));
      const dx = p.x - cx;
      const dz = p.z - cz;
      const dist = Math.hypot(dx, dz);
      if (dist >= radius) continue;
      if (dist < 1e-6) {
        // Centre is inside the box (a door closed on the player): leave across the thin side.
        if (d.axis === "x") p.z = d.z + (p.z >= d.z ? 1 : -1) * (hz + radius);
        else p.x = d.x + (p.x >= d.x ? 1 : -1) * (hx + radius);
      } else {
        p.x = cx + (dx / dist) * radius;
        p.z = cz + (dz / dist) * radius;
      }
    }
  }

  /**
   * Advances animations and the mall's own door changes. `projView` is the camera's
   * projection * view matrix; a door in that frustum and within SEEN_DISTANCE counts as watched
   * (walls are ignored for now), and the mall only moves doors the player isn't watching.
   */
  update(dt: number, player: { x: number; z: number }, floor: number, projView: THREE.Matrix4) {
    this.frustum.setFromProjectionMatrix(projView);
    for (const d of this.doors) {
      if (d.angle !== d.target) {
        const dir = Math.sign(d.target - d.angle);
        d.angle = Math.max(0, Math.min(1, d.angle + dir * d.speed * dt));
        if (d.angle === d.target) {
          if (d.slamming) this.events.onSlam(d.x, d.y, d.z);
          d.slamming = false;
        }
        const swing = smooth(d.angle) * OPEN_ANGLE;
        for (const leaf of d.leaves) leaf.node.rotation.y = leaf.sign * swing;
      }

      if (!this.auto) continue;
      d.timer -= dt;
      if (d.timer > 0 || d.angle !== d.target) continue;
      const near = Math.hypot(d.x - player.x, d.z - player.z);
      const seen = d.floor === floor && near < SEEN_DISTANCE && this.frustum.containsPoint(this.point.set(d.x, d.y, d.z));
      if (seen || (d.floor === floor && near < KEEP_CLEAR)) continue; // try again next frame
      d.timer = rand(CHANGE_EVERY);
      if (d.target === 0) this.swing(d, 1, false);
      else this.swing(d, 0, Math.random() < SLAM_CHANCE);
    }
  }
}
