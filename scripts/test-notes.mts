// Notes test: where the notes lie and what they say (src/engine/notes.ts, src/strings/es-CR.ts).
// Run: npm run test:notes   (the placement check needs npm run assets)
import { existsSync, readFileSync } from "node:fs";
import { NOTES, NOTE_REACH, noteInReach } from "../src/engine/notes.ts";
import { es } from "../src/strings/es-CR.ts";
import { NavGrid, type NavData } from "../src/engine/nav.ts";

let failed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
};

check("note ids are unique", new Set(NOTES.map((n) => n.id)).size === NOTES.length);
check("every note has a title and at least two lines of text", NOTES.every((n) => es.notes[n.id]?.title && (es.notes[n.id]?.body.length ?? 0) >= 2));
check("no text without a note", Object.keys(es.notes).every((id) => NOTES.some((n) => n.id === id)));
const all = Object.values(es.notes).flatMap((n) => [n.title, ...n.body]).join(" ");
// content guidelines: no real names of the mall, its places or its businesses; nothing about suicide or real crimes
const forbidden = ["San Pedro", "Montes de Oca", "suicid", "se mató", "se quitó la vida", "asesin", "balacera", "violación"];
check("the content guidelines hold (no real names, no suicide or real crimes)", forbidden.every((w) => !all.toLowerCase().includes(w.toLowerCase())));
check("every line is short enough to read at a glance", Object.values(es.notes).every((n) => n.body.every((l) => l.length <= 120)));
check("notes are spread over the three floors", new Set(NOTES.map((n) => n.floor)).size === 3);

// reaching one
{
  const n = NOTES[0];
  check("in reach, looking at it", noteInReach(NOTES, n.x - 1.0, n.y, n.floor, 0)?.id === n.id);
  check("too far", noteInReach(NOTES, n.x - NOTE_REACH - 0.5, n.y, n.floor, 0) === null);
  check("looking away from it", noteInReach(NOTES, n.x - 1.2, n.y, n.floor, Math.PI) === null);
  check("standing over it, any direction", noteInReach(NOTES, n.x + 0.2, n.y, n.floor, Math.PI)?.id === n.id);
  check("another floor", noteInReach(NOTES, n.x - 1.0, n.y, n.floor + 1, 0) === null);
}
if (existsSync("public/models/nav.json")) {
  const nav = NavGrid.fromData(JSON.parse(readFileSync("public/models/nav.json", "utf8")) as NavData);
  check("every note lies on open floor", NOTES.every((n) => nav.walkable(n.floor, n.x, n.y)), NOTES.filter((n) => !nav.walkable(n.floor, n.x, n.y)).map((n) => n.id).join(", "));
}

console.log(failed ? `\n${failed} FAILED` : "\nall good");
process.exit(failed ? 1 : 0);
