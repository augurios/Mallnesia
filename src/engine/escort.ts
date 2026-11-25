// The mall fighting to keep the player (CLAUDE.md, "Winning": finding the guard; legend 2: "some needed security guards
// to help them leave"). While the guard walks the player to an exit, the legends come one after another, harder the
// closer the door is: night noises and falling objects (legends 7, 11), the player's light and the night's glow
// flickering (11), the watchers gathering (14), the radio's "mire atrás" and then the shadow (12), and the girl in white
// on the way ahead (13). The guard sees none of it. This file only says what happens when, from how far along the walk
// is; the runtime makes each beat happen. No DOM and no Three.js, so scripts/test-escort.mts runs the exact code.
//
// Sanity goes faster on the way out: the light no longer brings it back and a steady dread drains it (`DRAIN`),
// each beat takes a little at once (`JOLT`), and the legends' own drains (the shadow, the girl, the watchers) hit
// harder (`LEGEND_DRAIN`).

export const ESCORT = {
  /** Seconds between night noises (a chair, a bin) at the start of the walk and at the door. */
  NOISE_GAP: [13, 4.5] as [number, number],
  /** Falling objects (a clatter somewhere unseen): from this far along, then every so often. */
  FALL_FROM: 0.1,
  FALL_GAP: [20, 7] as [number, number],
  /** The player's flashlight and the glow from outside stutter: from this far along. */
  FLICKER_FROM: 0.15,
  FLICKER_GAP: [26, 8] as [number, number],
  /** The radio's warning, then the shadow this many seconds later; and a second time near the door. */
  SHADOW_AT: [0.4, 0.85],
  WARNING_LEAD: 2.5,
  /** The girl in white, on the way ahead. */
  GIRL_AT: 0.62,
  /** How many watchers the mall holds by how far along the walk is (at least as many as sanity gives). */
  WATCHERS: [
    { from: 0.08, count: 1 },
    { from: 0.3, count: 2 },
    { from: 0.55, count: 3 },
    { from: 0.78, count: 4 },
  ],
  /** Sanity per second lost on the walk on top of the dark's own drain (and with the light on, which no longer restores it). */
  DRAIN: 1 / 1000,
  /** How much harder the legends' own sanity drains hit on the walk (the shadow, the girl, the watchers): a multiplier. */
  LEGEND_DRAIN: 1.5,
  /** Sanity taken at once by each beat as it happens. The shadow and the girl take theirs by being seen. */
  JOLT: { noise: 0.0015, fall: 0.004, flicker: 0.004, warning: 0.008, shadow: 0, girl: 0 } as Record<"noise" | "fall" | "flicker" | "warning" | "shadow" | "girl", number>,
  /** A beat that could not happen (nowhere to put it) is tried again this soon (s). */
  RETRY: 3,
  /** Every gap is jittered by up to this share either way. */
  JITTER: 0.3,
};

export type EscortBeat = "noise" | "fall" | "flicker" | "warning" | "shadow" | "girl";

const lerp = ([a, b]: [number, number], t: number) => a + (b - a) * t;

/** The watchers the escort calls for this far along the walk. */
export const escortWatchers = (progress: number): number => ESCORT.WATCHERS.filter((w) => progress >= w.from).reduce((n, w) => Math.max(n, w.count), 0);

export class EscortDirector {
  private noise = 0;
  private fall = 0;
  private flicker = 0;
  private shadowsDone = 0;
  private shadowIn = -1;
  private girlDone = false;
  private girlWait = 0;
  private rand: () => number;
  constructor(rand: () => number = Math.random) {
    this.rand = rand;
    this.reset();
  }

  private gap(range: [number, number], progress: number) {
    return lerp(range, progress) * (1 + ESCORT.JITTER * (this.rand() * 2 - 1));
  }

  /** A new walk: nothing has happened yet. */
  reset() {
    this.noise = 4 + this.rand() * 3;
    this.fall = 0;
    this.flicker = 0;
    this.shadowsDone = 0;
    this.shadowIn = -1;
    this.girlDone = false;
    this.girlWait = 0;
  }

  /**
   * Advances the clock. `progress` is how much of the walk is done (0 to 1). `fire` makes a beat happen and says whether
   * it could; one that could not is tried again in a few seconds (the shadow and the girl keep their turn).
   */
  update(dt: number, progress: number, fire: (beat: EscortBeat) => boolean) {
    this.noise -= dt;
    if (this.noise <= 0) this.noise = fire("noise") ? this.gap(ESCORT.NOISE_GAP, progress) : ESCORT.RETRY;
    if (progress >= ESCORT.FALL_FROM) {
      this.fall -= dt;
      if (this.fall <= 0) this.fall = fire("fall") ? this.gap(ESCORT.FALL_GAP, progress) : ESCORT.RETRY;
    }
    if (progress >= ESCORT.FLICKER_FROM) {
      this.flicker -= dt;
      if (this.flicker <= 0) this.flicker = fire("flicker") ? this.gap(ESCORT.FLICKER_GAP, progress) : ESCORT.RETRY;
    }
    if (this.shadowIn < 0 && this.shadowsDone < ESCORT.SHADOW_AT.length && progress >= ESCORT.SHADOW_AT[this.shadowsDone]) {
      fire("warning");
      this.shadowIn = ESCORT.WARNING_LEAD;
    }
    if (this.shadowIn >= 0) {
      this.shadowIn -= dt;
      if (this.shadowIn < 0) {
        if (fire("shadow")) this.shadowsDone++;
        else this.shadowIn = ESCORT.RETRY;
      }
    }
    if (!this.girlDone && progress >= ESCORT.GIRL_AT) {
      this.girlWait -= dt;
      if (this.girlWait <= 0) {
        if (fire("girl")) this.girlDone = true;
        else this.girlWait = ESCORT.RETRY;
      }
    }
  }
}
