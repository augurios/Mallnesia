// Renders every kit piece, solid and as a wireframe, into shots/ (gitignored) with headless Chrome. For checking a
// piece against its reference photo before calling it done: if the wireframe looks like boxes, it is not done
// (docs/art_style_reference.md, "Kit piece detail standard").
// Run: npm run pieces   (after npm run props). ONLY=bench_red,trash_bin renders just those pieces.
import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { spawn } from "node:child_process";
import { extname, join } from "node:path";
import * as nodeModule from "node:module";
import { PIECES } from "./kit/pieces.mts";

const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const SHOTS = "shots";
const TYPES: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".glb": "model/gltf-binary", ".json": "application/json" };
const ROOT = process.cwd();
// Node 22.13+ (missing from the installed @types/node)
const { stripTypeScriptTypes } = nodeModule as unknown as { stripTypeScriptTypes: (code: string) => string };
const server = createServer((req, res) => {
  const url = decodeURIComponent((req.url ?? "/").split("?")[0]);
  // the game's own surface styling, so the shots show the wear as the game draws it
  if (url === "/materials.js") return void res.writeHead(200, { "content-type": "text/javascript" }).end(stripTypeScriptTypes(readFileSync(join(ROOT, "src/engine/materials.ts"), "utf8")));
  const path = url === "/" ? join(ROOT, "scripts/piece-viewer.html") : join(ROOT, url);
  // only the viewer, three.js and the kit files
  const allowed = path === join(ROOT, "scripts/piece-viewer.html") || path.startsWith(join(ROOT, "node_modules/three")) || path.startsWith(join(ROOT, "public/models/kit"));
  if (!allowed || !existsSync(path) || statSync(path).isDirectory()) return void res.writeHead(404).end();
  res.writeHead(200, { "content-type": TYPES[extname(path)] ?? "application/octet-stream" }).end(readFileSync(path));
});
await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
const port = (server.address() as { port: number }).port;
mkdirSync(SHOTS, { recursive: true });
const only = process.env.ONLY?.split(",");
for (const name of Object.keys(PIECES)) {
  if (only && !only.includes(name)) continue;
  // solid, wireframe, from behind, and a close-up in a flashlight beam (how the player meets it)
  for (const [suffix, query] of [["solid", ""], ["wire", "&wire=1"], ["solid_back", "&az=215"], ["close", "&lamp=1&zoom=0.45&ty=0.75&az=50"]] as const) {
    const file = `${SHOTS}/kit_${name}_${suffix}.png`;
    const code = await new Promise<number | null>((done) => {
      const chrome = spawn(CHROME, ["--headless=new", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--window-size=1000,800", "--virtual-time-budget=8000", `--screenshot=${file}`, `http://127.0.0.1:${port}/?m=${name}${query}`], { stdio: "ignore" });
      const timer = setTimeout(() => chrome.kill(), 60_000);
      chrome.on("exit", (c) => {
        clearTimeout(timer);
        done(c);
      });
    });
    console.log(`${code === 0 && existsSync(file) ? "ok  " : "FAIL"} ${file}`);
  }
}
server.close();
