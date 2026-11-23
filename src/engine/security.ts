// The security console and its monitors (CLAUDE.md, "Security room"): the player uses E at the console to look through
// the mall's cameras and scout other areas. The shadow can show up on a feed, so can the guard, and a watcher can pass
// for him. At low sanity the mall interferes: a feed shows a different camera than the one on its label. No DOM and no
// Three.js, so scripts/test-security.mts runs the exact code the game runs.
//
// The feeds are rendered by the game's own camera moved to the CCTV position (night vision), not a second render, so
// whatever is in the mall is on the feed. The console stands in the guard's office on floor 3, at the north end of the
// W1 N store block, against its south wall, its screens facing the open doorway on the north hall (decided by Augusto;
// the room is `security_office` in docs/floorplans/build_floorplans.py).

export interface Camera {
  id: string;
  label: string;
  /** 0-based floor. */
  floor: number;
  x: number;
  y: number;
  /** Plan heading it looks along, degrees. */
  heading: number;
}

/** Cameras at the places a guard would watch: the lobby, the atrium on each floor, the north hall, the food court. */
export const CAMERAS: Camera[] = [
  { id: "c1", label: "CAM 1 · ENTRADA", floor: 0, x: 66, y: 24, heading: 30 },
  { id: "c2", label: "CAM 2 · ATRIO A", floor: 0, x: 60, y: 90, heading: 255 },
  { id: "c3", label: "CAM 3 · PASILLO NORTE", floor: 0, x: 70, y: 140, heading: 225 },
  { id: "c4", label: "CAM 4 · COMIDAS", floor: 1, x: 60, y: 12, heading: 75 },
  { id: "c5", label: "CAM 5 · ATRIO", floor: 1, x: 48, y: 98, heading: 90 },
  { id: "c6", label: "CAM 6 · ATRIO", floor: 2, x: 48, y: 100, heading: 90 },
  { id: "c7", label: "CAM 7 · COMIDAS", floor: 2, x: 70, y: 20, heading: 135 },
];

/** Where the console stands (plan meters), the way it faces, and the floor. The player works it from the `facing` side. */
export const CONSOLE = { floor: 2, x: 21, y: 150.56, /** The way the screens face (plan heading, radians). */ facing: Math.PI / 2, /** Footprint half sizes (the Poly Haven desk: 2 x 0.95 m). */ hx: 1.0, hy: 0.48 };

export const SECURITY = {
  /** Camera height above its floor (m), and how far it tilts down (radians). */
  HEIGHT: 3.5,
  TILT: 0.2,
  FOV: 82,
  /** The player can use the console from this close (m from its centre), looking toward it. */
  REACH: 2.0,
  /** Below this sanity a feed may show another camera than its label; the chance rises to MAX_LIE at sanity 0. */
  LIE_BELOW: 0.55,
  MAX_LIE: 0.55,
  /** The lie is decided once per window of this many seconds, so it holds long enough to read. */
  LIE_WINDOW: 6,
  /** Static on the picture, 0 to 1, by sanity (the picture itself blurs with the film look). */
  /** A shadow within this distance (m) of the player while they watch the feeds: a radio voice says to look behind. */
  WARN_DISTANCE: 20,
};

/** A small deterministic hash to 0..1 for a window number, so the same window always lies the same way. */
function hash(n: number): number {
  let t = (n * 0x9e3779b1) | 0;
  t = Math.imul(t ^ (t >>> 15), 1 | t);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export class Monitoring {
  active = false;
  /** The camera the player selected: its label is always what the screen says. */
  index = 0;
  private count: number;
  constructor(count: number = CAMERAS.length) {
    this.count = count;
  }
  enter() {
    this.active = true;
  }
  exit() {
    this.active = false;
  }
  next() {
    this.index = (this.index + 1) % this.count;
  }
  prev() {
    this.index = (this.index + this.count - 1) % this.count;
  }
  /** The chance (0 to 1) that the feed shows another camera than its label, at this sanity. */
  static lieChance(sanity: number): number {
    if (sanity >= SECURITY.LIE_BELOW) return 0;
    return SECURITY.MAX_LIE * (1 - sanity / SECURITY.LIE_BELOW);
  }
  /** The camera whose picture is on screen: the selected one, unless the mall is lying this window. `seconds` is a running clock. */
  shown(sanity: number, seconds: number): number {
    const window = Math.floor(seconds / SECURITY.LIE_WINDOW);
    if (hash(window * 31 + this.index) >= Monitoring.lieChance(sanity)) return this.index;
    const other = 1 + Math.floor(hash(window * 17 + this.index + 99) * (this.count - 1));
    return (this.index + other) % this.count;
  }
  /** Static on the picture, 0 to 1: more as sanity falls. */
  static glitch(sanity: number): number {
    return Math.max(0, Math.min(1, (0.6 - sanity) / 0.6));
  }
}

/** True when the player can use the console from here: close, and looking toward it (plan heading). */
export function consoleInReach(x: number, y: number, floor: number, heading: number): boolean {
  if (floor !== CONSOLE.floor) return false;
  const dx = CONSOLE.x - x;
  const dy = CONSOLE.y - y;
  const d = Math.hypot(dx, dy);
  if (d > SECURITY.REACH) return false;
  if (d < 0.8) return true;
  return (dx * Math.cos(heading) + dy * Math.sin(heading)) / d > Math.cos((60 * Math.PI) / 180);
}
