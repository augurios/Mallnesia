// Stamina test: runs the game's own stamina rules (src/engine/stamina.ts). Run: npm run test:stamina
import { Stamina, RUN_DRAIN, RECOVER_AT } from "../src/engine/stamina.ts";

let failed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
};
const run = (s: Stamina, seconds: number, run: boolean) => {
  let ran = false;
  for (let t = 0; t < seconds; t += 1 / 60) ran = s.update(1 / 60, run);
  return ran;
};

{
  const s = new Stamina();
  run(s, 2, true);
  check("running drains at the set rate", Math.abs(s.level - (1 - RUN_DRAIN * 2)) < 0.02, s.level.toFixed(3));
  run(s, 20, false);
  check("rest refills, never above 1", s.level === 1);
}
{
  const s = new Stamina();
  run(s, 4.5, true);
  check("running out empties it and exhausts", s.level < 0.05 && s.exhausted, s.level.toFixed(3));
  check("cannot run while exhausted", run(s, 0.2, true) === false);
  run(s, 1, false);
  check("still exhausted below the recovery level", s.level < RECOVER_AT && s.exhausted, s.level.toFixed(2));
  run(s, 1, false);
  check("running is allowed again after recovering", !s.exhausted && run(s, 0.1, true));
}
{
  const s = new Stamina();
  run(s, 4.5, true);
  s.reset();
  check("reset gives full stamina", s.level === 1 && !s.exhausted);
}
if (failed) process.exit(1);
