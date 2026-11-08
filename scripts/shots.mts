// Screenshots of fixed views of the built game, for checking a change by eye. Needs a build first:
//   npm run build && npm run shots        (writes shots/*.png; open them or compare with the last run)
// Uses headless Chrome with software rendering, so the look is close to the game's but not identical to a real GPU.
// CHROME=/path/to/chrome overrides the default macOS location.
import { createServer } from "node:http";
import { mkdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { spawn } from "node:child_process";
import { extname, join } from "node:path";
import { plans } from "./blockout/grid.mts";

const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const OUT_DIR = "out";
const SHOTS = "shots";
if (!existsSync(join(OUT_DIR, "index.html"))) throw new Error("no out/ folder: run npm run build first");
if (!existsSync(CHROME)) throw new Error(`Chrome not found at ${CHROME}: set CHROME=/path/to/chrome`);

const box = (id: string) => plans[0].boxes.find((b) => b.id === id)!;
const a = box("a_stairs");
const b = box("b_stairs");
const c = box("b_center_stair");

// floor is 1-3; x, y are plan meters; yaw 0 looks north, 90 west; pitch up is positive (degrees).
const VIEWS: { name: string; floor: number; x: number; y: number; yaw: number; pitch: number; extra?: string }[] = [
  { name: "spawn", floor: 1, x: 72, y: 28, yaw: 0, pitch: 0 },
  { name: "stairs_a_from_hall", floor: 1, x: a.x0 + 1.5, y: a.y0 - 4, yaw: 0, pitch: 12 },
  { name: "stairs_b_from_hall", floor: 1, x: b.x0 + 1.5, y: b.y1 + 4, yaw: 180, pitch: 12 },
  { name: "stairs_a_mid_flight", floor: 2, x: a.x0 + 4.5, y: a.y0 + 4, yaw: 0, pitch: -15 },
  { name: "stairs_center_from_atrium", floor: 1, x: c.x0 + 3, y: c.y0 - 8, yaw: 0, pitch: 18 },
  { name: "foodcourt_tables", floor: 2, x: 60, y: 33, yaw: 180, pitch: 4 },
  { name: "foodcourt_tables_floor3", floor: 3, x: 66, y: 22, yaw: 180, pitch: 4 },
  { name: "sky_foodcourt", floor: 2, x: 62, y: 6, yaw: 180, pitch: 3, extra: "&fov=80" },
  { name: "sky_foodcourt_up", floor: 3, x: 62, y: 6, yaw: 180, pitch: 4, extra: "&fov=80" },
  { name: "ao_hall", floor: 2, x: 80.5, y: 113, yaw: 90, pitch: -28, extra: "&ambient=2.4&fov=90&exposure=3" },
  { name: "piece_bench_red", floor: 2, x: 51.30, y: 170.25, yaw: 270, pitch: -12, extra: "&ambient=8&fov=70" },
  { name: "piece_trash_bin", floor: 2, x: 51.33, y: 166.25, yaw: 270, pitch: -12, extra: "&ambient=8&fov=70" },
  { name: "piece_planter_plant", floor: 2, x: 44.75, y: 162.31, yaw: 360, pitch: -12, extra: "&ambient=8&fov=70" },
  { name: "piece_tray_stand", floor: 2, x: 59.74, y: 29.75, yaw: 90, pitch: -12, extra: "&ambient=8&fov=70" },
  { name: "chair_closeup", floor: 2, x: 64.4, y: 24.5, yaw: 231, pitch: -22, extra: "&ambient=30&fov=70" },
  // kit piece LOD: the triangle counter on, near everywhere against the normal switch (?lod=999 vs the preset)
  { name: "lod_foodcourt_near", floor: 2, x: 60, y: 33, yaw: 180, pitch: 4, extra: "&stats=1&lod=999&ambient=8" },
  { name: "lod_foodcourt", floor: 2, x: 60, y: 33, yaw: 180, pitch: 4, extra: "&stats=1&ambient=8" },
  // the sanity tiers (?sanity= shows a level at once): calm, wobble, aberration, tunnel and ghost, the end
  { name: "sanity_100", floor: 2, x: 60, y: 33, yaw: 180, pitch: 4, extra: "&sanity=1&ambient=8" },
  { name: "sanity_55", floor: 2, x: 60, y: 33, yaw: 180, pitch: 4, extra: "&sanity=0.55&ambient=8" },
  { name: "sanity_35", floor: 2, x: 60, y: 33, yaw: 180, pitch: 4, extra: "&sanity=0.35&ambient=8" },
  { name: "sanity_15", floor: 2, x: 60, y: 33, yaw: 180, pitch: 4, extra: "&sanity=0.15&ambient=8" },
  { name: "sanity_0", floor: 2, x: 60, y: 33, yaw: 180, pitch: 4, extra: "&sanity=0&ambient=8" },
  // the shadow, placed with ?shadowat= (the director off so it stays), flashlight on at the start
  { name: "shadow_near", floor: 2, x: 60, y: 33, yaw: 180, pitch: 2, extra: "&shadow=off&shadowat=60,26&ambient=4" },
  { name: "shadow_far", floor: 2, x: 60, y: 33, yaw: 180, pitch: 2, extra: "&shadow=off&shadowat=60,12" },
  { name: "shadow_dark_near", floor: 2, x: 60, y: 33, yaw: 180, pitch: 2, extra: "&shadow=off&shadowat=62,27&ambient=0.6" },
  // hidden under a food court table (?hide=1 starts inside the first spot on the floor), looking out
  { name: "hidden_under_table", floor: 2, x: 60, y: 10, yaw: 0, pitch: 0, extra: "&hide=1&shadow=off&ambient=3" },
  { name: "hidden_look_up", floor: 2, x: 60, y: 10, yaw: 0, pitch: 55, extra: "&hide=1&shadow=off&ambient=30" },
  { name: "hide_table_outside", floor: 2, x: 63.4, y: 5.2, yaw: 0, pitch: -12, extra: "&shadow=off&ambient=30" },
  { name: "atrium_floor2", floor: 2, x: 48, y: 100, yaw: 270, pitch: 0 },
  // lit up (ambient) to judge shapes, not the night look
  { name: "bridge_from_floor3", floor: 3, x: 48.5, y: 126, yaw: 320, pitch: -28, extra: "&ambient=30&fov=80" },
  { name: "bridge_from_ground", floor: 1, x: 73, y: 125, yaw: 25, pitch: 32, extra: "&ambient=30&fov=80" },
  { name: "bridge_hood_close", floor: 3, x: 49, y: 131, yaw: 300, pitch: -22, extra: "&ambient=30&fov=70" },
  { name: "north_hall_f3", floor: 3, x: 48, y: 162, yaw: 90, pitch: 8, extra: "&ambient=30&fov=80" },
  { name: "bridge_strip_f3", floor: 3, x: 52.2, y: 146, yaw: 180, pitch: -8, extra: "&ambient=30&fov=80" },
  { name: "bridge_strip_f3_east", floor: 3, x: 76.8, y: 138, yaw: 0, pitch: -8, extra: "&ambient=30&fov=80" },
  { name: "bridge_deck", floor: 2, x: 48.5, y: 138, yaw: 270, pitch: 5, extra: "&ambient=30&fov=80" },
];

const TYPES: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".glb": "model/gltf-binary", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };
const server = createServer((req, res) => {
  let path = join(OUT_DIR, decodeURIComponent((req.url ?? "/").split("?")[0]));
  if (existsSync(path) && statSync(path).isDirectory()) path = join(path, "index.html");
  if (!existsSync(path)) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, { "content-type": TYPES[extname(path)] ?? "application/octet-stream" }).end(readFileSync(path));
});
await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
const port = (server.address() as { port: number }).port;

mkdirSync(SHOTS, { recursive: true });
const only = process.env.ONLY?.split(","); // e.g. ONLY=ao_hall,chair_closeup: just those views
for (const v of VIEWS) {
  if (only && !only.includes(v.name)) continue;
  const url = `http://127.0.0.1:${port}/?hud=off&floor=${v.floor}&x=${v.x}&y=${v.y}&yaw=${v.yaw}&pitch=${v.pitch}${v.extra ?? ""}`;
  const file = `${SHOTS}/${v.name}.png`;
  // Async, not spawnSync: the server above lives in this process and has to answer Chrome while it waits.
  const code = await new Promise<number | null>((done) => {
    const chrome = spawn(CHROME, ["--headless=new", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--window-size=1280,720", "--virtual-time-budget=15000", `--screenshot=${file}`, url], { stdio: "ignore" });
    const timer = setTimeout(() => chrome.kill(), 90_000);
    chrome.on("exit", (c) => {
      clearTimeout(timer);
      done(c);
    });
  });
  const ok = code === 0 && existsSync(file);
  console.log(`${ok ? "ok  " : "FAIL"} ${file}`);
  if (!ok) process.exitCode = 1;
}
server.close();
