// Stamina: a number from 1 (rested) down to 0 (spent). No DOM and no Three.js, so scripts/test-stamina.mts runs
// the exact code the game runs. Rates follow the reference's survival rules (23 and 15 of 100 per second, back
// to running at 30) and are first guesses for Augusto to tune by playing.
//
// Running drains it. At 0 the player is exhausted and cannot run until it has recovered to RECOVER_AT, so
// tapping Shift at 1% never works as a free sprint.

export const RUN_DRAIN = 0.23; // per second running: about 4.3 s of full speed
export const REST_RECOVER = 0.15; // per second otherwise: about 6.7 s to refill
export const RECOVER_AT = 0.3; // after running out, running is allowed again from here

export class Stamina {
  level = 1;
  exhausted = false;

  /** `wantsRun`: Shift held while moving. Returns whether the player may run this frame. */
  update(dt: number, wantsRun: boolean): boolean {
    if (dt <= 0) return wantsRun && !this.exhausted;
    const running = wantsRun && !this.exhausted && this.level > 0;
    this.level = Math.min(1, Math.max(0, this.level + (running ? -RUN_DRAIN : REST_RECOVER) * dt));
    if (this.level === 0) this.exhausted = true;
    else if (this.level >= RECOVER_AT) this.exhausted = false;
    return running;
  }

  reset(): void {
    this.level = 1;
    this.exhausted = false;
  }
}
