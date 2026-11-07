// Sanity: a number from 1 (calm) down to 0 (lost). No DOM and no Three.js, so scripts/test-sanity.mts runs the
// exact code the game runs. Every rate here is a first guess for Augusto to tune by playing.
//
// What moves it (CLAUDE.md, "Game mechanics"):
//   - darkness drains it: with the flashlight off the mall is dark. The flashlight is also what gets the player
//     noticed, so keeping it off to stay hidden is paid for in sanity (the tension of the game);
//   - light restores it slowly;
//   - apparitions and watchers drain it: `drain()` for a one-off scare, `setDrain()` for a source that keeps
//     draining while it lasts (a watcher in view).
// What it drives: the look of the screen (`look`), and how much the mall shifts (`shift`: faster doors now,
// wrong-floor elevators later).

export const DARK_DRAIN = 1 / 300; // per second in the dark: five minutes from calm to lost
export const LIGHT_RECOVER = 1 / 240; // per second with the light on
export const REST_RECOVER = 1 / 900; // a slow breath back when the light is off but the dark has not been long (see below)
const DARK_GRACE = 6; // seconds in the dark before it starts to drain: switching off to hide is not punished at once

/** How much faster the mall shifts when sanity is gone (doors use it as a clock speed). */
export const MAX_SHIFT = 3;

/** Sanity above this shows no effects at all. */
export const EFFECTS_BELOW = 0.7;

export interface SanityLook {
  /** 0 (no effect) to 1 (worst). Smoothed, so effects never pop. */
  amount: number;
  /** Extra vignette, color drain and grain on top of the base look. */
  vignette: number;
  drain: number;
  grain: number;
  /** A slow pulse of the vignette (0 to 1), faster as it gets worse. */
  pulse: number;
  /** The tiers, each 0 to 1, switching on one after another as sanity falls (see `ramp`). Names say what the shader does. */
  wobble: number; // the picture sways slowly, as if the floor were liquid
  aberration: number; // colors split toward the edges
  tunnel: number; // the edges pinch in and breathe
  ghost: number; // a faint second image drifts beside the first
  shake: number; // the view jitters and fractures: the last stretch
}

/** A tier that rises from 0 at effect amount `from` to 1 at `to`, eased. */
const ramp = (a: number, from: number, to: number) => {
  const t = Math.min(1, Math.max(0, (a - from) / (to - from)));
  return t * t * (3 - 2 * t);
};

/** The same look with the moving tiers off, for players who asked for no camera motion (the still tiers stay). */
export function stillLook(look: SanityLook): SanityLook {
  return { ...look, wobble: 0, tunnel: 0, ghost: 0, shake: 0, pulse: 0 };
}

export class Sanity {
  level = 1;
  private dark = 0; // seconds of darkness so far
  private sources = new Map<string, number>();
  private shown = 0; // smoothed effect amount
  private phase = 0;

  /** `light`: 0 (dark) to 1 (lit). Today that is the flashlight; street-lit spots can feed values in between later. */
  update(dt: number, light: number): void {
    if (dt <= 0) return;
    const lit = Math.min(1, Math.max(0, light));
    this.dark = lit > 0.5 ? 0 : this.dark + dt;
    let rate = lit * LIGHT_RECOVER;
    if (lit <= 0.5) rate = this.dark > DARK_GRACE ? -DARK_DRAIN : REST_RECOVER;
    for (const r of this.sources.values()) rate -= r;
    this.set(this.level + rate * dt);
    // The effect follows the level with a delay, so a scare reads as a wave and a recovery as relief.
    const target = this.target();
    this.shown += (target - this.shown) * (1 - Math.exp(-(target > this.shown ? 2.5 : 0.8) * dt));
    this.phase += dt * (0.6 + this.shown * 1.4);
  }

  /** A one-off scare (an apparition): takes `amount` (0 to 1) off at once. */
  drain(amount: number): void {
    this.set(this.level - Math.max(0, amount));
  }

  /** A source that drains `perSecond` for as long as it is set (a watcher in view). `0` removes it. */
  setDrain(id: string, perSecond: number): void {
    if (perSecond > 0) this.sources.set(id, perSecond);
    else this.sources.delete(id);
  }

  /** Debug and tests: skip the delay and show the effects for the current level right away. */
  snap(): void {
    this.shown = this.target();
  }

  /** Debug and tests: jump to a level. */
  set(level: number): void {
    this.level = Math.min(1, Math.max(0, level));
  }

  private target(): number {
    return Math.min(1, Math.max(0, (EFFECTS_BELOW - this.level) / EFFECTS_BELOW));
  }

  get look(): SanityLook {
    const a = this.shown;
    const s = a * a * (3 - 2 * a); // eased: gentle at first, heavy near the end
    return {
      amount: a,
      vignette: 0.3 * s,
      drain: 0.5 * s,
      grain: 0.04 * s,
      pulse: s * (0.5 + 0.5 * Math.sin(this.phase * Math.PI * 2)),
      // In sanity terms: wobble from about 0.7 to 0.5, aberration 0.5 to 0.3, tunnel and ghost 0.3 to 0.1, shake 0.1 to 0.
      wobble: ramp(a, 0.02, 0.3),
      aberration: ramp(a, 0.28, 0.6),
      tunnel: ramp(a, 0.55, 0.85),
      ghost: ramp(a, 0.6, 0.88),
      shake: ramp(a, 0.85, 1),
    };
  }

  /** How much more the mall shifts: 1 when calm, up to `MAX_SHIFT` when lost. Doors use it as a clock speed. */
  get shift(): number {
    return 1 + (MAX_SHIFT - 1) * this.target();
  }
}
