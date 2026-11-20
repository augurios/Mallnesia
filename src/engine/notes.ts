// Readable notes (CLAUDE.md, "Interaction (E)"): papers lying about the mall that the player reads with E. No pickup,
// no inventory: the note stays where it is. Together they tell the backstory gradually and hint each exit's rule
// (legend 15). Which notes were read is saved (`progress.notesRead`). No DOM and no Three.js, so scripts/test-notes.mts
// runs the exact code the game runs. The words live in strings/es-CR.ts (`notes`), keyed by the ids here.

export interface Note {
  id: string;
  /** 0-based floor. */
  floor: number;
  /** Plan position (meters, x east, y north) on open floor, and the angle the paper lies at (radians). */
  x: number;
  y: number;
  yaw: number;
}

/**
 * Where the notes lie, in the order the player is likely to meet them: the closing notice at the start, the guard's
 * shift sheet, the story of the land and the worker, then the hints for each exit. Positions are open floor on the
 * navigation map (the test checks).
 */
export const NOTES: Note[] = [
  { id: "cierre", floor: 0, x: 66, y: 24, yaw: 0.4 },
  { id: "ronda", floor: 0, x: 80, y: 24, yaw: -0.3 },
  { id: "obra", floor: 0, x: 97, y: 60, yaw: 1.1 },
  { id: "peon", floor: 0, x: 60, y: 90, yaw: 2.4 },
  { id: "puerta", floor: 1, x: 60, y: 12, yaw: 0.9 },
  { id: "parqueo", floor: 1, x: 14, y: 90, yaw: -1.2 },
  { id: "servicio", floor: 2, x: 48, y: 100, yaw: 0.2 },
  { id: "miradas", floor: 2, x: 109, y: 155, yaw: 1.9 },
];

export const NOTE_REACH = 1.6;
const REACH_CONE = Math.cos((60 * Math.PI) / 180);

/** The note the player could read now: on this floor, within reach, and looked at roughly (plan heading). */
export function noteInReach(notes: Note[], x: number, y: number, floor: number, heading: number): Note | null {
  const hx = Math.cos(heading);
  const hy = Math.sin(heading);
  let best: Note | null = null;
  let bestD = Infinity;
  for (const n of notes) {
    if (n.floor !== floor) continue;
    const dx = n.x - x;
    const dy = n.y - y;
    const d = Math.hypot(dx, dy);
    if (d > NOTE_REACH || d >= bestD) continue;
    if (d > 0.5 && (dx * hx + dy * hy) / d < REACH_COS(d)) continue;
    bestD = d;
    best = n;
  }
  return best;
}

// A paper on the floor is below eye level: standing right over it the cone is wide, farther off it is narrower.
const REACH_COS = (d: number) => (d < 0.9 ? -1 : REACH_CONE);
