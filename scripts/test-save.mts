// Save test: runs the game's own save format, storage and atrium checkpoint code (src/engine/save.ts, atrium.ts).
// Run: npm run test:save
import { readFileSync } from "node:fs";
import { AtriumTracker, ATRIUMS, LEAVE_MARGIN } from "../src/engine/atrium.ts";
import { createSaveStore, parseSave, SAVE_VERSION } from "../src/engine/save.ts";

let failed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
};

// A fake localStorage, and one that is blocked or full.
const fake = () => {
  const m = new Map<string, string>();
  return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
};
const blocked = {
  getItem: () => {
    throw new Error("blocked");
  },
  setItem: () => {
    throw new Error("blocked");
  },
  removeItem: () => {
    throw new Error("blocked");
  },
};
const sample = { area: "mall" as const, x: 64.5, y: 30.25, height: 4.1, yaw: 1.2, notesRead: ["n1", "n2"], guard: 1, exits: ["garage"] };

{
  const storage = fake();
  const store = createSaveStore(storage, () => 1234);
  check("nothing saved yet", store.read("manual") === null && store.read("checkpoint") === null);
  check("write reports it persisted", store.write("manual", sample) === true);
  const back = store.read("manual");
  check("a save reads back whole", back !== null && back.x === 64.5 && back.y === 30.25 && back.height === 4.1 && back.yaw === 1.2 && back.notesRead.join() === "n1,n2" && back.guard === 1 && back.exits.join() === "garage" && back.savedAt === 1234 && back.version === SAVE_VERSION);
  store.write("checkpoint", { ...sample, x: 70 });
  check("the two slots are separate", store.read("manual")?.x === 64.5 && store.read("checkpoint")?.x === 70);
  check("a fresh store over the same storage sees the save", createSaveStore(storage).read("manual")?.x === 64.5);
  store.clear("manual");
  check("clear removes a slot", store.read("manual") === null && store.read("checkpoint") !== null);
  check("what is stored never holds sanity or charge", !JSON.stringify([...storage.m.values()]).match(/sanity|charge/i));
}
{
  const store = createSaveStore(blocked);
  check("blocked storage: write says it will not persist", store.write("manual", sample) === false);
  check("blocked storage: still loads in this session", store.read("manual")?.x === 64.5);
  const none = createSaveStore(null);
  check("no storage at all: same", none.write("checkpoint", sample) === false && none.read("checkpoint")?.y === 30.25);
}
{
  const storage = fake();
  storage.m.set("elmallvivo.save.manual", "{not json");
  const store = createSaveStore(storage);
  check("corrupt save is ignored", store.read("manual") === null);
  check("wrong shapes are ignored", parseSave(null) === null && parseSave({}) === null && parseSave({ version: 1, x: "a", y: 1, height: 0 }) === null && parseSave({ version: 1, x: NaN, y: 1, height: 0 }) === null);
  check("a save from a newer build is left alone", parseSave({ version: SAVE_VERSION + 1, x: 1, y: 1, height: 0 }) === null);
  const tolerant = parseSave({ version: 1, x: 1, y: 2, height: 0, notesRead: ["a", 5, null], area: "elsewhere" });
  check("missing or odd optional fields get defaults", tolerant !== null && tolerant.yaw === 0 && tolerant.guard === 0 && tolerant.exits.length === 0 && tolerant.notesRead.join() === "a" && tolerant.area === "mall");
}
{
  // Atrium checkpoint: fires on entering and on leaving, never on the edge jitter.
  const t = new AtriumTracker();
  check("starts outside", !t.inside && t.update(72, 28) === null);
  check("entering fires once", t.update(60, 50.9) === null && t.update(60, 51.1) === "entered" && t.update(60, 60) === null);
  check("still inside while walking around", t.update(55, 100) === null && t.inside);
  check("stepping just over the edge does not count as leaving", t.update(60, 50.5) === null && t.inside);
  check("the edge jitter does not spam", t.update(60, 51.1) === null && t.update(60, 50.4) === null);
  check("leaving fires once, past the margin", t.update(60, 51 - LEAVE_MARGIN - 0.1) === "left" && t.update(60, 40) === null && !t.inside);
  check("the second atrium counts too", t.update(70, 140) === "entered" && t.update(70, 170) === "left");
  t.reset(60, 60);
  check("reset takes the new position without an event", t.inside && t.update(60, 61) === null);
  t.reset(10, 10);
  check("reset outside", !t.inside);
}
{
  // The rectangles still match the floor plans (all three floors).
  let ok = true;
  const notes: string[] = [];
  for (const f of ["floor1", "floor2", "floor3"]) {
    const plan = JSON.parse(readFileSync(`docs/floorplans/${f}_plan.json`, "utf8")) as { boxes: { id: string; x0: number; x1: number; y0: number; y1: number }[] };
    for (const [id, r] of Object.entries(ATRIUMS)) {
      const b = plan.boxes.find((x) => x.id === id);
      if (!b || b.x0 !== r.x0 || b.x1 !== r.x1 || b.y0 !== r.y0 || b.y1 !== r.y1) {
        ok = false;
        notes.push(`${f} ${id}`);
      }
    }
  }
  check("atrium rectangles match the floor plans", ok, notes.join(", "));
}

if (failed) {
  console.log(`${failed} failed`);
  process.exit(1);
}
console.log("save: all checks passed");
