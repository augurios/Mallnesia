// Load-time benchmark of the built game (needs `npm run build` first). It opens the game in headless Chrome on the real
// GPU and reports, for each run:
//   - the time until the game is ready ("Clic para jugar" shows);
//   - the shader programs linked before then, and how many of them are tone-mapped (the on-screen variant: the medium
//     and high presets draw through the post-processing chain and never use it);
//   - the main thread's long tasks before ready (a freeze shows up here);
//   - when each model finished downloading.
//
//   npm run bench:load                         3 runs at full speed
//   RUNS=5 MBPS=10 npm run bench:load          5 runs on an emulated 10 Mbps connection
//   QUERY="&quality=low" npm run bench:load    extra URL parameters
//   VERBOSE=1 npm run bench:load               also lists the programs of the last run, by material
//
// Text files are served gzipped, as a real host would. Chrome keeps compiled shaders between runs (and macOS keeps
// them between Chrome processes), so the runs after the first are warm-cache numbers; the first run after a build that
// changes shaders shows the cold cost, and is reported apart. CHROME=/path/to/chrome overrides the default location.
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { spawn } from "node:child_process";
import { extname, join } from "node:path";

const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const OUT_DIR = "out";
const RUNS = Math.max(1, parseInt(process.env.RUNS ?? "3", 10) || 3);
const MBPS = parseFloat(process.env.MBPS ?? "0") || 0;
const QUERY = process.env.QUERY ?? "";
const VERBOSE = process.env.VERBOSE === "1";
const PORT = 9300 + Math.floor(Math.random() * 400); // Chrome's debugging port
if (!existsSync(join(OUT_DIR, "index.html"))) throw new Error("no out/ folder: run npm run build first");
if (!existsSync(CHROME)) throw new Error(`Chrome not found at ${CHROME}: set CHROME=/path/to/chrome`);

const TYPES: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".glb": "model/gltf-binary", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };
const TEXT = new Set([".html", ".js", ".css", ".json", ".svg"]);
const gzipped = new Map<string, Buffer>();
const server = createServer((req, res) => {
  let path = join(OUT_DIR, decodeURIComponent((req.url ?? "/").split("?")[0]));
  if (existsSync(path) && statSync(path).isDirectory()) path = join(path, "index.html");
  if (!existsSync(path)) {
    res.writeHead(404).end();
    return;
  }
  const ext = extname(path);
  const headers: Record<string, string | number> = { "content-type": TYPES[ext] ?? "application/octet-stream" };
  let body: Buffer = readFileSync(path);
  if (TEXT.has(ext) && /gzip/.test(String(req.headers["accept-encoding"] ?? ""))) {
    if (!gzipped.has(path)) gzipped.set(path, gzipSync(body));
    body = gzipped.get(path)!;
    headers["content-encoding"] = "gzip";
  }
  headers["content-length"] = body.length;
  res.writeHead(200, headers).end(body);
});
await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

// Runs in the page before any of its scripts: counts the programs three.js links (with their material's name and
// whether they are tone-mapped) and records long tasks.
const HOOK = `(() => {
  const P = WebGL2RenderingContext.prototype;
  const bench = (window.__bench = { programs: [], longTasks: [] });
  const sources = new WeakMap(), attached = new WeakMap();
  const shaderSource = P.shaderSource;
  P.shaderSource = function (shader, source) { sources.set(shader, source); return shaderSource.call(this, shader, source); };
  const attachShader = P.attachShader;
  P.attachShader = function (program, shader) { (attached.get(program) || attached.set(program, []).get(program)).push(shader); return attachShader.call(this, program, shader); };
  const linkProgram = P.linkProgram;
  P.linkProgram = function (program) {
    const [vertex = "", fragment = ""] = (attached.get(program) || []).map((s) => sources.get(s) || "");
    const name = (vertex.match(/#define SHADER_NAME (.*)/) || [])[1] || (vertex.match(/#define SHADER_TYPE (.*)/) || [])[1] || "?";
    bench.programs.push({ at: performance.now(), name, toneMapped: /#define TONE_MAPPING/.test(fragment) });
    return linkProgram.call(this, program);
  };
  new PerformanceObserver((list) => { for (const e of list.getEntries()) bench.longTasks.push([e.startTime, e.duration]); }).observe({ type: "longtask", buffered: true });
})();`;

interface Program {
  at: number;
  name: string;
  toneMapped: boolean;
}
interface Result {
  ready: number;
  programs: Program[];
  longTasks: [number, number][];
  models: Record<string, number>;
  kilobytes: number;
}

const chrome = spawn(CHROME, ["--headless=new", "--use-angle=metal", `--remote-debugging-port=${PORT}`, "--window-size=1280,720", "about:blank"], { stdio: "ignore" });
let endpoint: string | null = null;
for (let i = 0; i < 100 && !endpoint; i++) {
  await new Promise((r) => setTimeout(r, 100));
  try {
    endpoint = ((await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json()) as { webSocketDebuggerUrl: string }).webSocketDebuggerUrl;
  } catch {
    // not up yet
  }
}
if (!endpoint) throw new Error("Chrome did not start");
const socket = new WebSocket(endpoint);
await new Promise((r) => (socket.onopen = r));
let nextId = 0;
const pending = new Map<number, (reply: { result?: Record<string, unknown> }) => void>();
socket.onmessage = (m) => {
  const reply = JSON.parse(String(m.data)) as { id?: number; result?: Record<string, unknown> };
  if (reply.id !== undefined) pending.get(reply.id)?.(reply);
  if (reply.id !== undefined) pending.delete(reply.id);
};
/** One DevTools protocol command (`session` for a page's own commands). */
function send(method: string, params: object = {}, session?: string): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    const id = ++nextId;
    pending.set(id, (reply) => resolve(reply.result ?? {}));
    socket.send(JSON.stringify({ id, method, params, sessionId: session }));
  });
}

async function run(): Promise<Result> {
  const { browserContextId } = await send("Target.createBrowserContext");
  const { targetId } = await send("Target.createTarget", { url: "about:blank", browserContextId });
  const { sessionId } = (await send("Target.attachToTarget", { targetId, flatten: true })) as { sessionId: string };
  const evaluate = async <T,>(expression: string): Promise<T> => ((await send("Runtime.evaluate", { expression, returnByValue: true }, sessionId)) as { result?: { value?: T } }).result?.value as T;
  await send("Network.enable", {}, sessionId);
  await send("Network.setCacheDisabled", { cacheDisabled: true }, sessionId);
  if (MBPS > 0) await send("Network.emulateNetworkConditions", { offline: false, latency: 60, downloadThroughput: (MBPS * 1e6) / 8, uploadThroughput: 1e6 }, sessionId);
  await send("Page.enable", {}, sessionId);
  await send("Page.addScriptToEvaluateOnNewDocument", { source: HOOK }, sessionId);
  // quality pinned: headless Chrome would otherwise get the automatic preset of an unknown device
  await send("Page.navigate", { url: `${origin}/?quality=high${QUERY}` }, sessionId);
  let ready = 0;
  const started = Date.now();
  while (!ready && Date.now() - started < 180_000) {
    await new Promise((r) => setTimeout(r, 40));
    ready = (await evaluate<number>("document.querySelector('.game-hint') ? performance.now() : 0")) || 0;
  }
  await new Promise((r) => setTimeout(r, 1500)); // what follows ready (late models, their warm-up)
  const result = await evaluate<Omit<Result, "ready">>(`(() => {
    const models = {}; let bytes = 0;
    for (const e of performance.getEntriesByType("resource")) { bytes += e.transferSize; const n = e.name.split("/").pop().split("?")[0]; if (n.endsWith(".glb")) models[n] = e.responseEnd; }
    return { programs: window.__bench.programs, longTasks: window.__bench.longTasks, models, kilobytes: bytes / 1024 };
  })()`);
  await send("Target.closeTarget", { targetId });
  await send("Target.disposeBrowserContext", { browserContextId });
  if (!ready) throw new Error("the game never became ready");
  return { ready, ...result };
}

const ms = (v: number) => `${Math.round(v)} ms`;
function report(label: string, r: Result) {
  const before = r.programs.filter((p) => p.at <= r.ready);
  const tasks = r.longTasks.filter(([at]) => at <= r.ready);
  const longest = Math.max(0, ...tasks.map(([, d]) => d));
  const models = Object.entries(r.models)
    .sort((a, b) => a[1] - b[1])
    .map(([n, t]) => `${n.replace(".glb", "")} ${(t / 1000).toFixed(2)}s`)
    .join(", ");
  console.log(
    `${label.padEnd(6)} ready ${ms(r.ready).padStart(8)} | programs ${before.length} (${before.filter((p) => p.toneMapped).length} tone-mapped), ${r.programs.length - before.length} after | long tasks ${tasks.length}, longest ${ms(longest)}, total ${ms(tasks.reduce((s, [, d]) => s + d, 0))} | ${Math.round(r.kilobytes)} KB | ${models}`,
  );
}

console.log(`load bench: ${RUNS} runs${MBPS ? `, ${MBPS} Mbps` : ""}${QUERY ? `, ${QUERY}` : ""}`);
const first = await run();
report("first", first);
const results: Result[] = [];
for (let i = 0; i < RUNS; i++) {
  results.push(await run());
  report(`#${i + 1}`, results[i]);
}
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
console.log(`median ready ${ms(median(results.map((r) => r.ready)))}, longest task ${ms(median(results.map((r) => Math.max(0, ...r.longTasks.filter(([at]) => at <= r.ready).map(([, d]) => d)))))}`);
if (VERBOSE) {
  const last = results[results.length - 1];
  const byName = new Map<string, number>();
  for (const p of last.programs) byName.set(`${p.name}${p.toneMapped ? " (tone-mapped)" : ""}`, (byName.get(`${p.name}${p.toneMapped ? " (tone-mapped)" : ""}`) ?? 0) + 1);
  for (const [name, n] of [...byName].sort((a, b) => b[1] - a[1])) console.log(String(n).padStart(4), name);
}
chrome.kill();
server.close();
socket.close();
