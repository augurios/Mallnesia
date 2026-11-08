// Knows when the player enters or leaves the main atrium. Entering is when the game auto-saves its checkpoint
// (leaving does not save, but the tracker still has to see it so the next entry counts)
// (CLAUDE.md, "Save, load, and checkpoints"). No DOM and no Three.js, so scripts/test-save.mts runs it.
//
// The atrium is a column through all three floors, so only the plan position matters. Both atriums count as "the
// main atrium" (decided by Augusto). The rectangles are the `atrium_a` and
// `atrium_b` boxes of docs/floorplans/*_plan.json (the test checks that they still match).

export interface Rect {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

export const ATRIUMS: Record<string, Rect> = {
  atrium_a: { x0: 51, x1: 78, y0: 51, y1: 111 },
  atrium_b: { x0: 51, x1: 78, y0: 123, y1: 159 },
};

/** Leaving counts only after the player is this far (meters) outside the edge, so standing on the edge never spams saves. */
export const LEAVE_MARGIN = 1.5;

const within = (r: Rect, x: number, y: number, grow: number) => x >= r.x0 - grow && x <= r.x1 + grow && y >= r.y0 - grow && y <= r.y1 + grow;

export type AtriumEvent = "entered" | "left";

export class AtriumTracker {
  inside = false;
  private regions: Rect[];
  constructor(regions: Rect[] = Object.values(ATRIUMS)) {
    this.regions = regions;
  }

  /** Call every frame with the plan position. Returns an event when the player crosses in or out, otherwise null. */
  update(x: number, y: number): AtriumEvent | null {
    if (!this.inside) {
      if (this.regions.some((r) => within(r, x, y, 0))) {
        this.inside = true;
        return "entered";
      }
    } else if (!this.regions.some((r) => within(r, x, y, LEAVE_MARGIN))) {
      this.inside = false;
      return "left";
    }
    return null;
  }

  /** After a load or teleport: take the new position as the starting state without firing an event. */
  reset(x: number, y: number): void {
    this.inside = this.regions.some((r) => within(r, x, y, 0));
  }
}
