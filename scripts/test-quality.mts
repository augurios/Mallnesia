// Automatic quality test: the first guess and the slow-frames governor (src/engine/auto-quality.ts).
// Run: npm run test:quality
import { FrameGovernor, GOVERNOR, pickInitialQuality } from "../src/engine/auto-quality.ts";

let failed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
};
const dev = (extra: Partial<{ mobile: boolean; cores: number; memoryGB: number; gpu: string }> = {}) => ({ mobile: false, cores: 8, memoryGB: 8, gpu: "ANGLE (Apple, Apple M1, Metal)", ...extra });

check("a good desktop starts on high", pickInitialQuality(dev()) === "high");
check("unknown cores and memory (Safari, Firefox): high", pickInitialQuality(dev({ cores: 0, memoryGB: 0 })) === "high");
check("a software renderer: low", pickInitialQuality(dev({ gpu: "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)" })) === "low");
check("llvmpipe: low", pickInitialQuality(dev({ gpu: "llvmpipe (LLVM 12.0.0, 256 bits)" })) === "low");
check("a 4 core laptop: medium", pickInitialQuality(dev({ cores: 4 })) === "medium");
check("4 GB of memory: medium", pickInitialQuality(dev({ memoryGB: 4 })) === "medium");
check("2 cores: low", pickInitialQuality(dev({ cores: 2 })) === "low");
check("2 GB: low", pickInitialQuality(dev({ memoryGB: 2 })) === "low");
check("an ordinary phone: low", pickInitialQuality(dev({ mobile: true, cores: 6, memoryGB: 4 })) === "low");
check("a strong phone: medium, never high", pickInitialQuality(dev({ mobile: true, cores: 8, memoryGB: 8 })) === "medium");

/** Feeds frames of a given length for `seconds` of play; returns when it first said drop (seconds), or null. */
const feed = (g: FrameGovernor, frame: number, seconds: number, playing = true) => {
  for (let t = 0; t < seconds; t += frame) if (g.update(frame, playing) === "drop") return t;
  return null;
};
{
  const g = new FrameGovernor();
  check("60 fps never drops", feed(g, 1 / 60, 120) === null);
}
{
  const g = new FrameGovernor();
  const at = feed(g, 1 / 15, 60);
  check("15 fps drops, after the grace and one window", at !== null && at >= GOVERNOR.GRACE && at <= GOVERNOR.GRACE + GOVERNOR.WINDOW + 1, `${at?.toFixed(1)} s`);
  check("then it waits a grace period before judging again", feed(g, 1 / 15, GOVERNOR.GRACE - 1) === null);
  check("and drops again if still slow", feed(g, 1 / 15, 20) !== null);
}
{
  const g = new FrameGovernor();
  check("35 fps is fine", feed(g, 1 / 35, 120) === null);
  const h = new FrameGovernor();
  check("25 fps is too slow", feed(h, 1 / 25, 30) !== null);
}
{
  const g = new FrameGovernor();
  check("a paused game never counts", feed(g, 1 / 10, 120, false) === null);
  const h = new FrameGovernor();
  let hitches = 0;
  for (let i = 0; i < 2000; i++) if (h.update(i % 50 === 0 ? 1.5 : 1 / 60, true) === "drop") hitches++;
  check("an occasional hitch (a tab switch) is not slowness", hitches === 0);
  const k = new FrameGovernor();
  let dropped = false;
  for (let i = 0; i < 4000; i++) if (k.update(i % 8 === 0 ? 0.2 : 1 / 60, true) === "drop") dropped = true;
  check("regular stutter (a 0.2 s frame every 8th) averages low and drops", dropped);
}

console.log(failed ? `\n${failed} FAILED` : "\nall good");
process.exit(failed ? 1 : 0);
