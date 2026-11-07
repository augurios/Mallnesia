// Sanity test: runs the game's own sanity rules (src/engine/sanity.ts) with simulated time. Run: npm run test:sanity
import { Sanity, stillLook, DARK_DRAIN, LIGHT_RECOVER, EFFECTS_BELOW, MAX_SHIFT } from "../src/engine/sanity.ts";

let failed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
};
const run = (s: Sanity, seconds: number, light: number) => {
  for (let t = 0; t < seconds; t += 1 / 60) s.update(1 / 60, light);
};

{
  const s = new Sanity();
  run(s, 5, 0);
  check("a short stay in the dark costs nothing (grace)", s.level >= 0.999, s.level.toFixed(3));
  run(s, 60, 0);
  check("darkness drains at the set rate", Math.abs(s.level - (1 - DARK_DRAIN * (65 - 6))) < 0.02, s.level.toFixed(3));
}
{
  const s = new Sanity();
  run(s, 400, 0);
  check("five minutes of dark empties it, never below 0", s.level === 0);
  run(s, 120, 1);
  check("light brings it back", Math.abs(s.level - LIGHT_RECOVER * 120) < 0.02, s.level.toFixed(3));
  run(s, 600, 1);
  check("never above 1", s.level === 1);
}
{
  const s = new Sanity();
  s.drain(0.3);
  check("an apparition drains at once", Math.abs(s.level - 0.7) < 1e-9);
  s.setDrain("watcher", 0.01);
  run(s, 10, 1);
  check("a watcher in view outweighs the light", s.level < 0.7 + LIGHT_RECOVER * 10, s.level.toFixed(3));
  s.setDrain("watcher", 0);
  const before = s.level;
  run(s, 10, 1);
  check("a source stops when removed", s.level > before);
}
{
  const s = new Sanity();
  run(s, 2, 1);
  const calm = s.look;
  check("no effects while calm", calm.vignette === 0 && calm.drain === 0 && calm.grain === 0 && s.shift === 1);
  s.set(EFFECTS_BELOW + 0.01);
  run(s, 3, 1);
  check("no effects just above the threshold", s.look.amount < 0.02, s.look.amount.toFixed(3));
  s.set(0);
  run(s, 1, 0);
  const rising = s.look.amount;
  run(s, 8, 0);
  const lost = s.look;
  check("effects build with a delay, not a pop", rising > 0 && rising < lost.amount, `${rising.toFixed(2)} -> ${lost.amount.toFixed(2)}`);
  check("effects are full when lost", lost.amount > 0.99 && lost.vignette > 0.25 && lost.drain > 0.4);
  check("the mall shifts faster when lost", Math.abs(s.shift - MAX_SHIFT) < 1e-9, s.shift.toFixed(2));
}
{
  // The tiers arrive in order as sanity falls, and snap() shows a level at once.
  const at = (level: number) => {
    const s = new Sanity();
    s.set(level);
    s.snap();
    return s.look;
  };
  const l70 = at(0.7), l55 = at(0.55), l35 = at(0.35), l15 = at(0.15), l0 = at(0);
  check("nothing at 0.7", l70.wobble + l70.aberration + l70.tunnel + l70.ghost + l70.shake === 0);
  check("wobble comes first", l55.wobble > 0.3 && l55.aberration === 0 && l55.tunnel === 0, `wobble ${l55.wobble.toFixed(2)}`);
  check("aberration by 0.35, tunnel and ghost not yet full", l35.aberration > 0.5 && l35.tunnel < 0.5 && l35.shake === 0, `ab ${l35.aberration.toFixed(2)} tunnel ${l35.tunnel.toFixed(2)}`);
  check("tunnel and ghost by 0.15, shake not yet", l15.tunnel > 0.8 && l15.ghost > 0.6 && l15.shake === 0, `tunnel ${l15.tunnel.toFixed(2)} ghost ${l15.ghost.toFixed(2)}`);
  check("shake in the last stretch", at(0.05).shake > 0.3, at(0.05).shake.toFixed(2));
  check("everything at 0", l0.wobble === 1 && l0.aberration === 1 && l0.tunnel === 1 && l0.ghost === 1 && l0.shake === 1);
  const still = stillLook(l0);
  check("no camera motion: moving tiers off, color tiers stay", still.wobble === 0 && still.shake === 0 && still.tunnel === 0 && still.ghost === 0 && still.aberration === 1 && still.drain > 0);
}

if (failed) {
  console.log(`${failed} failed`);
  process.exit(1);
}
console.log("sanity: all checks passed");
