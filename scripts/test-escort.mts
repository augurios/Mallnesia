// Escort test: the legends during the walk out with the guard (src/engine/escort.ts). Run: npm run test:escort
import { ESCORT, EscortDirector, escortWatchers, type EscortBeat } from "../src/engine/escort.ts";
import { Sanity, DARK_DRAIN } from "../src/engine/sanity.ts";

let failed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
  if (!ok) failed++;
};
const seeded = (seed: number) => () => {
  seed = (seed * 16807) % 2147483647;
  return seed / 2147483647;
};

/** A walk of `seconds` at an even pace; returns when each beat fired, as progress. */
const walk = (seconds: number, fire: (beat: EscortBeat, progress: number) => boolean = () => true) => {
  const d = new EscortDirector(seeded(9));
  const at: Record<EscortBeat, number[]> = { noise: [], fall: [], flicker: [], warning: [], shadow: [], girl: [] };
  for (let t = 0; t < seconds; t += 0.1) {
    const p = t / seconds;
    d.update(0.1, p, (b) => {
      const ok = fire(b, p);
      if (ok) at[b].push(p);
      return ok;
    });
  }
  return at;
};

const at = walk(180);
check("night noises all along the walk", at.noise.length >= 10 && at.noise[0] < 0.1, `${at.noise.length}`);
const firstHalf = at.noise.filter((p) => p < 0.5).length;
check("more noises near the door than at the start", at.noise.length - firstHalf > firstHalf, `${firstHalf} then ${at.noise.length - firstHalf}`);
check("falling objects and flicker only once under way", at.fall.length > 0 && at.fall[0] >= ESCORT.FALL_FROM && at.flicker.length > 0 && at.flicker[0] >= ESCORT.FLICKER_FROM);
check("the radio warns before each shadow", at.warning.length === 2 && at.shadow.length === 2 && at.warning.every((w, i) => w < at.shadow[i]), `${at.warning.map((p) => p.toFixed(2))} / ${at.shadow.map((p) => p.toFixed(2))}`);
check("the first shadow comes around 40% of the way", Math.abs(at.shadow[0] - ESCORT.SHADOW_AT[0]) < 0.05, at.shadow[0].toFixed(2));
check("the girl once, past 60% of the way", at.girl.length === 1 && at.girl[0] >= ESCORT.GIRL_AT, `${at.girl.length}`);

// a girl that cannot be placed is tried again until she can
let tries = 0;
const later = walk(180, (b) => (b === "girl" ? ++tries > 5 : true));
check("a beat with nowhere to go is tried again", later.girl.length === 1 && tries === 6);

check("the watchers gather as the door nears", escortWatchers(0) === 0 && escortWatchers(0.35) === 2 && escortWatchers(0.95) === 4);

// Sanity on the walk: as the runtime does it (no recovery, the steady drain, a jolt per beat), without the legends'
// own drains, which depend on what the player looks at. A two-minute walk, with the light on and then off.
const walkSanity = (light: number) => {
  const s = new Sanity();
  s.recovers = false;
  s.setDrain("escort", ESCORT.DRAIN);
  const d = new EscortDirector(seeded(4));
  for (let t = 0; t < 120; t += 0.1) {
    d.update(0.1, t / 120, (b) => {
      s.drain(ESCORT.JOLT[b]);
      return true;
    });
    s.update(0.1, light);
  }
  return s.level;
};
const lit = walkSanity(1);
const dark = walkSanity(0);
check("with the light on the walk still costs sanity", lit < 0.85, lit.toFixed(2));
check("in the dark it costs more than the dark alone", 1 - dark > DARK_DRAIN * 114 + 0.05, dark.toFixed(2));
check("the walk alone never empties it (the legends must do that)", dark > 0.3, dark.toFixed(2));
console.log(failed ? `\n${failed} FAILED` : "\nall good");
process.exit(failed ? 1 : 0);
