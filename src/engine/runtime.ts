import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { AtriumTracker } from "./atrium";
import { createAudio } from "./audio";
import { NavGrid, type NavData } from "./nav";
import { Doors } from "./doors";
import {
  GARAGE,
  GARAGE_ENTRANCES,
  GARAGE_ENTRANCE_DEPTH,
  GARAGE_EXIT_INSIDE,
  STRIP_DOOR,
  STRIP_WEST,
  atGoal,
  entranceSeed,
  blockRange,
  garageToStrip,
  generateGarage,
  resolveGarage,
  gapWalls,
  rampHeight,
  pitBoxes,
  exitPen,
  seamSeen,
  stripBlockAt,
  stripBoxes,
  stripPart,
  stripRows,
  stripSeams,
  stripToGarage,
  type Box,
  type GarageEntrance,
  type GarageLayout,
} from "./garage-gen";
import { createGarageView, type GarageView } from "./garage-view";
import { GuardScene, GUARD_SCENE, placeAhead } from "./guard-scene";
import { createGuardView } from "./guard-view";
import { Fail, FAIL, pickWakeSpot } from "./fail";
import { Hiding, HIDING, headingToYaw, spotsFromProps, yawToHeading } from "./hiding";
import { setBakedAO, setMallFrame, styleBlockout } from "./materials";
import { LoadProgress } from "./load-progress";
import { NoiseDirector, pickNoiseSpot } from "./night-noise";
import { createNoiseWorld, type NoiseWorld } from "./noise-view";
import { createPost } from "./post";
import { loadProps, type Props } from "./props";
import { Sanity, stillLook } from "./sanity";
import { Stamina } from "./stamina";
import { createSaveStore, emptyProgress, type SaveSlot } from "./save";
import { Shadow, type PlayerSense } from "./shadow";
import { createShadowView } from "./shadow-view";
import { createSky } from "./sky";
import { es } from "../strings/es-CR";
import { Walk, FLOOR_HEIGHT, PLAYER_RADIUS } from "./walk";
import { FrameGovernor, pickInitialQuality } from "./auto-quality";
import { QUALITY_LEVELS, QUALITY_PRESETS, isQualityLevel, loadAutoQuality, loadQuality, saveAutoQuality, saveQuality, type QualityLevel } from "./quality";
import { loadView, normalizeView, saveView, type ViewSettings } from "./view";

export interface PlayerStatus {
  floor: number;
  /** Position in floor-plan meters (x east, y north). */
  x: number;
  y: number;
  /** Flashlight charge, 0 to 1, and whether the light is on. */
  charge: number;
  flashlightOn: boolean;
  /** Stamina, 0 to 1, and sanity, 0 to 1 (see stamina.ts and sanity.ts). */
  stamina: number;
  exhausted: boolean;
  sanity: number;
  /** What E would do right now, if anything: use a door, crawl into a hiding spot, or crawl out of one. */
  prompt: "interact" | "hide" | "leave" | null;
}

export interface RuntimeOptions {
  onLockChange?: (locked: boolean) => void;
  onStatus?: (status: PlayerStatus) => void;
  /** A short-lived message for the HUD. */
  onNotice?: (notice: "doorLocked" | "checkpoint" | "caught" | "garageDone" | "rampArrive") => void;
  /** A line of speech to show as a subtitle (the guard), or null to clear it. */
  onSubtitle?: (text: string | null) => void;
  /** A controls tip to show (after the guard's opening), or null to clear it. */
  onTip?: (tip: "move" | "flashlight" | null) => void;
  /** Loading progress for the loading screen: 0 to 1, `ready` once everything is loaded and warmed up, `error` if the mall could not load. */
  /** The game lowered the graphics preset by itself because frames were slow. */
  onQualityChange?: (level: QualityLevel) => void;
  onLoad?: (state: { progress: number; ready: boolean; error: boolean }) => void;
}

export interface Runtime {
  requestLock(): void;
  getQuality(): QualityLevel;
  /** Applies a preset right away and remembers it for next time. */
  setQuality(level: QualityLevel): void;
  /** Manual save (pause menu). "blocked" while the shadow hunts; "unsaved" if the browser will not keep it past this visit. */
  save(): "saved" | "unsaved" | "blocked";
  /** Loads a slot: the pause menu's manual save, or the last checkpoint (what being caught returns to). False if there is none. */
  load(slot: SaveSlot): boolean;
  /** When a slot was saved (ms since 1970), or null if it is empty. */
  savedAt(slot: SaveSlot): number | null;
  getView(): ViewSettings;
  /** Applies view settings right away and remembers them for next time. */
  setView(view: ViewSettings): void;
  dispose(): void;
}

const EYE_HEIGHT = 1.65;
const WALK_SPEED = 3.2;
const RUN_SPEED = 7;
const LOOK_SPEED = 0.002; // radians per mouse count, times the sensitivity setting
const ACCEL = 12; // how fast the walk speed eases in and out (1/s): about 0.1 s to reach it, never a jolt
const FOV = 80; // vertical degrees: about 107 horizontal at 16:9. A narrow view is a main cause of motion sickness
const RUN_FOV = 85; // widens a little while running (camera effects only)
const FOV_EASE = 6; // 1/s
const BOB_FREQ = 3.6; // head bob phase per meter walked
const BOB_WALK = 0.018; // head bob height in meters (camera effects only)
const BOB_RUN = 0.045;
const BOB_EASE = 8; // the bob fades in and out instead of snapping when the player starts or stops (1/s)
const MAX_DT = 0.05; // a long frame moves the player at most this much time, so a hitch never teleports the view
const MOUSE_SPIKE = 400; // counts in one event: more is the browser glitching (seen in Chrome), not a hand
const FLASH_INTENSITY = 60;
const FLASH_DRAIN = 1 / 120; // charge per second while on: 2 minutes of light
const FLASH_RECHARGE = 1 / 90; // charge per second while off: 90 seconds to refill
const FLASH_MIN_ON = 0.1; // can't switch on below this
const FLASH_DIM_BELOW = 0.2; // the beam fades out under this charge
const TIP_TIME = 14000; // how long the flashlight tip stays up if the player does not use it (ms)
const LOCK_TURN = 4; // how fast the camera turns to the guard during the opening (1/s)
const CAMERA_FOLLOW = 18; // how fast the eye follows the feet over steps (1/s)
const BLOCKOUT_URL = "./models/mall_blockout.glb";
const AO_URL = "./models/ao.png";
const PROPS_URL = "./models/props.json"; // built by scripts/build-props.mts
const NAV_URL = "./models/nav.json"; // built by scripts/build-nav.mts: the shadow walks on it

// Plan coordinates (meters). Floor 1 starts in the entrance lobby; the others at the west hall.
// Debug keys 1/2/3 jump to these until stairs and elevators exist.
const SPAWNS: { x: number; y: number }[] = [
  { x: 72, y: 28 },
  { x: 48, y: 100 },
  { x: 48, y: 100 },
];

/** First-person walk through the mall blockout: pointer-lock look, WASD, BVH wall collision. No React in here. */
export function createRuntime(root: HTMLElement, options: RuntimeOptions = {}): Runtime {
  const renderer = new THREE.WebGLRenderer({ antialias: false });
  renderer.localClippingEnabled = true;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  root.prepend(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x04060a); // near black with a blue tint: this is the night
  scene.fog = new THREE.Fog(0x04060a, 6, 70);
  const sky = createSky(); // the night outside the glass; the fog does not touch it
  scene.add(sky.mesh);
  // The mall's own objects (blockout, props, noise events) live in one group, so a ramp garage's exit doorway can show the
  // mall beyond it: the group is turned and moved into the garage's frame, and clipped to what lies outside the doorway.
  const mallRoot = new THREE.Group();
  scene.add(mallRoot);
  const mallClip = new THREE.Plane(new THREE.Vector3(-1, 0, 0), 1e6); // keeps x < constant; far away (nothing clipped) until needed
  const clipMall = (root: THREE.Object3D) =>
    root.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) (m as THREE.Material).clippingPlanes = [mallClip];
    });

  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.05, 250);
  camera.rotation.order = "YXZ";

  const params = new URLSearchParams(window.location.search);
  const urlQuality = params.get("quality"); // debug: ?quality=low|medium|high (not saved)
  const baseFov = parseFloat(params.get("fov") ?? "") || FOV; // debug: ?fov=<vertical degrees>
  camera.fov = baseFov;
  let view = loadView();

  renderer.toneMappingExposure = parseFloat(params.get("exposure") ?? "") || 1.6; // debug: ?exposure=<number>
  const ambientLevel = parseFloat(params.get("ambient") ?? "");
  const exploration = params.get("epx") === "1"; // debug: ?epx=1 is exploration mode: the flashlight and stamina never run out
  const lodOverride = parseFloat(params.get("lod") ?? ""); // debug: ?lod=<meters> (0 draws every kit piece far, 999 near)
  // debug: ?stats=1 shows triangles and draw calls per frame (all passes) in the corner
  const stats = params.get("stats") ? document.createElement("div") : null;
  if (stats) {
    stats.style.cssText = "position:absolute;left:8px;bottom:8px;z-index:10;font:12px monospace;color:#9f9;background:#000a;padding:2px 6px;pointer-events:none";
    root.append(stats);
    renderer.info.autoReset = false; // the post passes render several times a frame: count them all
  }
  // Faint cool sky glow from above, darker blue-grey bounce from below (art doc: never pure black).
  scene.add(new THREE.HemisphereLight(0x4a5a78, 0x10141c, Number.isFinite(ambientLevel) ? ambientLevel : 2.4)); // debug: ?ambient=<intensity>
  const torch = new THREE.SpotLight(0xfff2d0, FLASH_INTENSITY, 40, Math.PI / 5, 0.4);
  torch.position.set(0, 0, 0);
  torch.target.position.set(0, 0, -1);
  camera.add(torch, torch.target);
  scene.add(camera);

  const post = createPost(renderer, scene, camera);
  let blockout: THREE.Object3D | null = null;
  let props: Props | null = null;
  // The preset: ?quality= (debug), else the player's own saved choice, else where the game settled last time, else a guess
  // from the device. Only the last two are automatic: the governor then lowers the preset one level whenever frames
  // run slow (never raises it), and a pause-menu choice turns that off. ?autoquality=off disables the governor.
  const gl = renderer.getContext();
  const gpuInfo = gl.getExtension("WEBGL_debug_renderer_info");
  const nav2 = navigator as Navigator & { deviceMemory?: number };
  const device = {
    mobile: /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && Math.min(screen.width, screen.height) < 820),
    cores: navigator.hardwareConcurrency || 0,
    memoryGB: nav2.deviceMemory ?? 0,
    gpu: gpuInfo ? String(gl.getParameter(gpuInfo.UNMASKED_RENDERER_WEBGL)) : "",
  };
  const chosen = loadQuality();
  let autoQuality = !isQualityLevel(urlQuality) && chosen === null && params.get("autoquality") !== "off";
  let quality: QualityLevel = isQualityLevel(urlQuality) ? urlQuality : (chosen ?? loadAutoQuality() ?? pickInitialQuality(device));
  const governor = new FrameGovernor();
  const applyQuality = () => {
    const preset = QUALITY_PRESETS[quality];
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, preset.maxPixelRatio));
    (scene.fog as THREE.Fog).far = preset.fogFar;
    torch.distance = preset.torchDistance;
    post.setSettings({ bloom: preset.bloom, film: preset.film });
    if (blockout) styleBlockout(blockout, preset.detail);
    if (props) styleBlockout(props.group, preset.detail);
    resize();
  };

  // Player state. Plan y is north, so the three.js z axis is -y.
  const num = (key: string, fallback: number) => {
    const v = parseFloat(params.get(key) ?? "");
    return Number.isFinite(v) ? v : fallback;
  };
  // `floor` is derived from the player's height each frame (see the tick); it starts from the spawn.
  let floor = Math.min(3, Math.max(1, Math.round(num("floor", 1)))) - 1;
  const player = new THREE.Vector3(num("x", SPAWNS[floor].x), floor * FLOOR_HEIGHT, -num("y", SPAWNS[floor].y));
  const walk = new Walk(player);
  let eyeY = NaN; // smoothed camera height; NaN = snap to the player next frame
  let yaw = THREE.MathUtils.degToRad(num("yaw", 0));
  let pitch = THREE.MathUtils.degToRad(num("pitch", 0));
  const velocity = new THREE.Vector2(); // horizontal, x and three.js z, meters per second

  // Saving (save.ts). `progress` is what the notes, guard and exit systems will fill in as they get built.
  let storage: Storage | null = null;
  try {
    storage = window.localStorage;
  } catch {
    // blocked: saves live in memory for this visit
  }
  const store = createSaveStore(storage);
  const atrium = new AtriumTracker();
  atrium.reset(player.x, -player.z);
  const progress = emptyProgress();
  let shadow: Shadow | null = null; // made once the nav data has loaded (the game works without it, just without the shadow)
  const hunted = () => (shadow?.hunting ?? false) || fail.state !== "playing"; // manual saves are refused while it hunts, and during a fail
  const snapshot = () => ({ area: "mall" as const, x: player.x, y: -player.z, height: player.y, yaw, notesRead: [...progress.notesRead], guard: progress.guard, exits: [...progress.exits] });
  let walked = 0; // meters, drives the head bob phase
  let flashOn = false; // the game starts with the flashlight off
  let crouch = 0; // 0 standing, 1 fully hidden: lowers the eye
  let bob = 0; // current head bob height, eased toward the target

  const sanity = new Sanity();
  const stamina = new Stamina();
  const startSanity = parseFloat(params.get("sanity") ?? ""); // debug: ?sanity=<0 to 1> starts at that level
  if (Number.isFinite(startSanity)) {
    sanity.set(startSanity);
    sanity.snap(); // shown at once, even before the first frame the player is in control of
  }
  const audio = createAudio();
  const doors = new Doors({
    onCreak: (x, y, z) => audio.creak(x, y, z),
    onSlam: (x, y, z) => audio.slam(x, y, z),
    onLocked: (x, y, z) => {
      audio.rattle(x, y, z);
      options.onNotice?.("doorLocked");
    },
  });
  const hiding = new Hiding();
  // Night noises: chairs and bins that tip over or scrape when the player is not looking (night-noise.ts).
  // ?noise=off stops them, ?noise=now brings the first one in 3 s, key N makes one now.
  const noiseMode = params.get("noise");
  const noiseDirector = new NoiseDirector();
  noiseDirector.enabled = noiseMode !== "off";
  if (noiseMode === "now") noiseDirector.soon(3);
  let noiseWorld: NoiseWorld | null = null;
  const guardView = createGuardView((url) => new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(url)); // the stand-in until the model arrives
  scene.add(guardView.object); // with its light (at intensity 0 until he is on stage), so no shader recompiles when he appears
  // The opening: the guard is the first thing the player sees. Skipped by any debug start (?x ?y ?floor), by ?guard=off, and on a
  // game that has already met him; ?guard=now plays it from wherever the game starts.
  const guardParam = params.get("guard");
  let opening = guardParam === "off" ? "skip" : guardParam === "now" || !["x", "y", "floor"].some((k) => params.has(k)) ? "ready" : "skip";
  let guardScene: GuardScene | null = null;
  const guardAt = { x: 0, y: 0 };
  let guardLine: number | null = null;
  let tip: "move" | "flashlight" | null = null; // the controls tip being shown after the opening
  let tipAt = 0;
  const setTip = (next: typeof tip, at: number) => {
    tip = next;
    tipAt = at;
    options.onTip?.(next);
  };
  const frustum = new THREE.Frustum();
  const guardSphere = new THREE.Sphere();
  const guardPoint = new THREE.Vector3();
  const fail = new Fail();
  // Two areas: the mall, and the parking garage (a level of its own, garage-gen.ts and garage-view.ts). The mall's parking
  // strip is dressed as the garage's first column (a copy of it, turned half a turn, in each of the 6 places: 2 openings
  // x 3 floors), so entering is seamless: once the player is inside the strip and none of its holes (the opening, the
  // floor-2 secret door) is in view, the world swaps to the real garage with the same view and the maze appears beyond
  // the doorways. The way back mirrors it: after the payphone, walking into the first column swaps back to the mall.
  // Debug key P and ?area=garage still enter with a fade, standing at the south opening.
  let area: "mall" | "garage" = "mall";
  // `gapWalls`: the doorways from the first column to the second, which the mall walls up and opens while nobody looks
  // (`gapClosed`); `solid` is what the player collides with (the layout's boxes and the closed doorways).
  // Each of the six strip openings (2 x 3 floors) has its own garage (`entranceSeed`), built when first needed; `garage` is
  // the one the player is in (or last was in).
  type Garage = { layout: GarageLayout; view: GarageView; gapWalls: Box[]; gapClosed: boolean[]; solid: Box[]; pitShut: boolean };
  let garage: Garage | null = null;
  /** The garage a ramp led to (not cached: a new one every time). */
  let rampGarage: Garage | null = null;
  /** The garage above a ramp the player is near: built hidden-behind-the-ceiling, lined up with the ramp, ready to become the world. */
  let rampPrep: { host: Garage; idx: number; next: Garage; delta: number; tx: number; ty: number } | null = null;
  const garages = new Map<string, Garage>();
  const layouts = new Map<string, GarageLayout>();
  const placeKey = (e: GarageEntrance, f: number) => `${e.id}:${f}`;
  type Seams = { opening: { x: number; y: number }[]; gaps: { x: number; y: number }[][]; occluders: Box[] };
  /** What the mall holds for one opening and floor: the dressing (the garage's first column, in the mall's frame), its collision, seams and rows. */
  type StripPlace = { view: GarageView; boxes: Box[]; seams: Seams; rows: Set<number> };
  let strip: { group: THREE.Group; places: Map<string, StripPlace> } | null = null;
  const garageSeedParam = params.get("garageseed"); // debug: ?garageseed=random or a number; the default seed is fixed
  const garageSeed = garageSeedParam === "random" ? Math.floor(Math.random() * 1e9) : Number.isFinite(parseInt(garageSeedParam ?? "", 10)) ? parseInt(garageSeedParam ?? "", 10) : GARAGE.SEED;
  const GARAGE_DRAIN = 1 / 220; // sanity per second lost in the garage: full to empty in under four minutes if lost
  /** Which opening and floor the player came in by, so the way out brings them back there. */
  let stripEntry: { e: GarageEntrance; floor: number } = { e: GARAGE_ENTRANCES[1], floor: STRIP_DOOR.floor };
  /** Set once the payphone has been reached: the first column then swaps back to the mall. */
  let garageReleased = false;
  /** After the swap back the player stands inside the strip: no swap into the garage again until they have walked out of it. */
  let stripHeld = false;
  /** In the garage, standing under a working tube counts as light for sanity (like a lit area did). */
  const litByTube = (lay: GarageLayout, x: number, y: number) => lay.lights.some((l) => l.state === "on" && Math.hypot(l.x - x, l.y - y) < 3.5);
  let ringTimer = 0;
  let startInGarage = params.get("area") === "garage" || params.get("area") === "ramp"; // debug: ?area=garage (or ramp: up a ramp, see enterRampMap) starts there, once everything has loaded
  // The black of a fail (caught, fainted): a plain overlay, so it works on every quality preset, under the HUD text (z-index 5).
  const blackout = document.createElement("div");
  blackout.style.cssText = "position:absolute;inset:0;background:#000;opacity:0;pointer-events:none;z-index:2";
  root.append(blackout);
  let nav: NavGrid | null = null; // the shadow's map, also used to pick where the player wakes up after fainting
  const shadowView = createShadowView((origin, dir, far) => walk.castWall(origin, dir, far));
  scene.add(shadowView.object);
  const shadowSound = audio.shadow();
  const shadowMode = params.get("shadow"); // debug: ?shadow=off (it never comes), ?shadow=now (it comes within seconds)
  doors.auto = params.get("doors") !== "off"; // debug: ?doors=off stops the mall moving doors by itself

  // Shader warm-up (card "Compile shaders at load time"): three.js builds a material's program the first time it is
  // drawn, which can freeze a frame mid-game (the first frame the shadow, the guard or a fallen chair shows up).
  // After loading, everything that can ever appear is made visible once and compiled, then hidden again, and the
  // post-processing passes render one frame. ?precompile=off skips it (to compare); ?stats=1 shows how long it took.
  let warmMs = -1;
  let worstNow = 0; // ms
  let worstShown = 0;
  let worstSince = performance.now();
  let warmDone = false; // the warm-up changes what is visible while it runs, so nothing else may show or hide areas until it is over
  const warmUp = async () => {
    if (params.get("precompile") === "off") {
      warmDone = true;
      return;
    }
    const t0 = performance.now();
    const asleep = [shadowView.object, guardView.object, ...(garage ? [garage.view.group] : [])].filter((o) => !o.visible);
    asleep.forEach((o) => (o.visible = true));
    // A loose chair and a bin of each kind: they are plain meshes, a different shader variant from the instanced kit pieces.
    const mute = { onImpact: () => {}, onScrape: () => {}, walkable: () => true };
    noiseWorld?.spawn("chair_tip", { x: 0, y: 0, heading: 0 }, 0, mute, () => true);
    noiseWorld?.spawn("bin_tip", { x: 0, y: 0, heading: 0 }, 0, mute, () => true);
    try {
      await renderer.compileAsync(scene, camera);
    } catch (err) {
      console.error("Shader warm-up failed", err);
    }
    noiseWorld?.clear();
    asleep.forEach((o) => (o.visible = false));
    post.render(0); // bloom and film compile on their first render
    warmMs = performance.now() - t0;
    warmDone = true;
  };

  // Loading progress (load-progress.ts): the weights are about each part's share of the wait (the mall is 1.2 MB, the kit
  // pieces about 1 MB, the rest small, then the shader warm-up).
  const load = new LoadProgress([
    { name: "mall", weight: 5 },
    { name: "props", weight: 4 },
    { name: "ao", weight: 0.3 },
    { name: "nav", weight: 0.3 },
    { name: "extra", weight: 0.6 },
    { name: "warm", weight: 2 },
  ]);
  let lastAnnounced = -1;
  const announce = (error = false) => {
    const progress = load.value;
    if (!error && progress === lastAnnounced) return;
    lastAnnounced = progress;
    options.onLoad?.({ progress, ready: load.complete && !error, error });
  };
  const MALL_BYTES_GUESS = 1_300_000; // when the server does not say how long the file is
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  announce();
  void (async () => {
    try {
      // The props are optional: a missing or broken props file must not stop the mall from loading.
      const [gltf, loadedProps, ao] = await Promise.all([
        loader.loadAsync(BLOCKOUT_URL, (e) => {
          load.report("mall", e.loaded, e.lengthComputable && e.total > 0 ? e.total : MALL_BYTES_GUESS);
          announce();
        }).then((g) => (load.finish("mall"), announce(), g)),
        loadProps(
          PROPS_URL,
          async (url) => (await loader.loadAsync(url)).scene,
          (done, total) => {
            load.report("props", done, total);
            announce();
          },
        )
          .catch((err) => {
            console.error("Could not load the props", err);
            return null;
          })
          .then((p) => (load.finish("props"), announce(), p)),
        new THREE.TextureLoader()
          .loadAsync(AO_URL)
          .catch((err) => {
            console.error("Could not load the baked occlusion", err);
            return null;
          })
          .then((t) => (load.finish("ao"), announce(), t)),
      ]);
      setBakedAO(ao); // before the first styled frame: the shader samples it
      gltf.scene.traverse((o) => {
        if (!(o instanceof THREE.Mesh)) return;
        const kind = (o.material as THREE.Material).name; // chunks share the material's name; node names are made unique
        if (kind === "barrier") o.visible = false; // collision only
        if (kind === "glass" || kind === "rails") o.renderOrder = 1;
      });
      mallRoot.add(gltf.scene);
      clipMall(gltf.scene);
      blockout = gltf.scene;
      styleBlockout(gltf.scene, QUALITY_PRESETS[quality].detail);
      if (loadedProps) {
        mallRoot.add(loadedProps.group);
        clipMall(loadedProps.group);
        styleBlockout(loadedProps.group, QUALITY_PRESETS[quality].detail); // the kit pieces get the same surface detail
        props = loadedProps;
      }
      doors.load(gltf.scene);
      const piece = (name: string) => loader.loadAsync(`./models/kit/${name}.glb`).then((g) => g.scene).catch(() => null); // optional: no model, no event of that kind
      const [chairPiece, binPiece] = await Promise.all([piece("chair_loose"), piece("trash_bin")]);
      load.finish("extra");
      announce();
      noiseWorld = createNoiseWorld({ chair: chairPiece, bin: binPiece });
      mallRoot.add(noiseWorld.object);
      clipMall(noiseWorld.object);
      styleBlockout(noiseWorld.object, QUALITY_PRESETS[quality].detail);
      if (params.get("noiserest") === "1") {
        // debug (screenshots, where time stands still): a chair tipped back, a bin on its side and a slid chair, already at rest 2 to 4 m ahead
        const ahead = (d: number, side: number) => ({ x: player.x + -Math.sin(yaw) * d + Math.cos(yaw) * side, y: -player.z + Math.cos(yaw) * d + Math.sin(yaw) * side });
        const mute = { onImpact: () => {}, onScrape: () => {}, walkable: () => true };
        noiseWorld.spawn("chair_tip", { ...ahead(2.5, -0.8), heading: yawToHeading(yaw) + 0.5 }, floor, mute, () => true);
        noiseWorld.spawn("bin_tip", { ...ahead(3.5, 0.9), heading: yawToHeading(yaw) - 0.8 }, floor, mute, () => true);
        noiseWorld.spawn("chair_slide", { ...ahead(4.2, -0.2), heading: yawToHeading(yaw) + 2.4 }, floor, mute, () => true);
        for (let i = 0; i < 300; i++) noiseWorld.update(1 / 60, mute);
      }
      if (loadedProps) hiding.spots = spotsFromProps(loadedProps.instances, FLOOR_HEIGHT);
      if (params.get("hide") === "1") {
        // debug: ?hide=1 starts already hidden in the first spot on the starting floor (for screenshots, where time stands still)
        const first = hiding.spots.find((s) => s.floor === floor);
        if (first) {
          const entry = { spot: first, end: 1 as const };
          hiding.enter(entry, first.x + first.ax * HIDING.GATE, first.y + first.ay * HIDING.GATE, yaw);
          const pose = hiding.update(HIDING.ENTER_TIME, yaw);
          if (pose) {
            player.set(pose.x, floor * FLOOR_HEIGHT, -pose.y);
            yaw = pose.yaw;
            crouch = 1;
            flashOn = false;
          }
        }
      }
      walk.load(gltf.scene, loadedProps?.colliders);
      try {
        nav = NavGrid.fromData((await (await fetch(NAV_URL)).json()) as NavData);
        const made = new Shadow(nav);
        made.director = shadowMode !== "off";
        if (shadowMode === "now") made.scheduleSpawn(3);
        const at = (params.get("shadowat") ?? "").split(",").map(parseFloat); // debug: ?shadowat=x,y puts it there on the starting floor, facing the player
        if (at.length === 2 && at.every(Number.isFinite)) made.appearAt(floor, at[0], at[1], Math.atan2(-player.z - at[1], player.x - at[0]), true);
        shadow = made;
      } catch (err) {
        console.error("Could not load the navigation data; there will be no shadow", err);
      }
      load.finish("nav");
      announce();
      garage = (() => {
        try {
          buildStrip();
          return garageFor(GARAGE_ENTRANCES[1], STRIP_DOOR.floor); // the debug key's garage; the others are built when the player is in their strip
        } catch (err) {
          console.error("Could not build the garage", err);
          return null;
        }
      })();
      await warmUp();
      load.finish("warm");
      announce();
    } catch (err) {
      console.error("Could not load the mall blockout", err);
      announce(true);
    }
  })();

  /** The layout behind an opening on a floor: its own seed, generated once. */
  function layoutOf(e: GarageEntrance, f: number): GarageLayout {
    let layout = layouts.get(placeKey(e, f));
    if (!layout) {
      layout = generateGarage(entranceSeed(garageSeed, e, f));
      layouts.set(placeKey(e, f), layout);
    }
    return layout;
  }
  /** The mall's dressing for one opening and floor: the garage's first column in the mall's frame, its collision, seams and rows. */
  function makePlace(e: GarageEntrance, f: number, layout: GarageLayout, group: THREE.Group): StripPlace {
    const door = e.id === "strip_south" && f === STRIP_DOOR.floor; // the floor-2 secret door's gap in the far wall
    const part = stripPart(layout, door);
    const view = createGarageView(part, { partial: true });
    view.group.rotation.y = Math.PI;
    view.group.position.set(e.x, f * FLOOR_HEIGHT + 0.015, -blockRange(e).y1); // just above the mall's floor, no z-fighting
    group.add(view.group);
    // what differs between the strip and the garage's column 0, and the walls both share that can hide it
    const seams: Seams = { ...stripSeams(layout, door), occluders: stripPart(layout, door, false).boxes.filter((b) => b.kind === "wall" || b.kind === "column") };
    return { view, boxes: stripBoxes(part, e), seams, rows: stripRows(layout) };
  }
  /** The whole garage behind an opening on a floor, built (hidden) the first time it is asked for. */
  function garageFor(e: GarageEntrance, f: number): Garage {
    let g = garages.get(placeKey(e, f));
    if (!g) {
      g = buildGarage(layoutOf(e, f));
      garages.set(placeKey(e, f), g);
    }
    return g;
  }
  /** A garage from a layout, hidden. What the player collides with leaves out the ramps: they walk up them. */
  function buildGarage(layout: GarageLayout): Garage {
    const walls = gapWalls(layout);
    const view = createGarageView(layout, { gapWalls: walls });
    view.group.visible = false;
    scene.add(view.group);
    const g: Garage = { layout, view, gapWalls: walls, gapClosed: walls.map(() => false), solid: [], pitShut: false };
    refreshSolid(g);
    return g;
  }
  /** What the player collides with: the walls and cars (not the ramps, which are walked), the pit's walls, the doorways that are walled up. */
  function refreshSolid(g: Garage) {
    g.solid = [...g.layout.boxes.filter((b) => b.kind !== "ramp"), ...pitBoxes(g.layout, g.pitShut), ...exitPen(g.layout), ...g.gapWalls.filter((_, k) => g.gapClosed[k])];
  }

  /** Dresses the mall's parking strip as each garage's first column, in each of the 6 places (2 openings x 3 floors). */
  function buildStrip() {
    const group = new THREE.Group();
    const places = new Map<string, StripPlace>();
    for (const e of GARAGE_ENTRANCES) for (let f = 0; f < 3; f++) places.set(placeKey(e, f), makePlace(e, f, layoutOf(e, f), group));
    group.visible = area === "mall";
    scene.add(group);
    strip = { group, places };
    // nobody else walks in the strip (the shadow, a noise): the dressing has no map of its own
    nav?.blockRect(STRIP_WEST, blockRange(GARAGE_ENTRANCES[1]).y0, 15, blockRange(GARAGE_ENTRANCES[0]).y1);
  }

  const keys = new Set<string>();
  let locked = false;
  let charge = 1;
  const playerSense = (): PlayerSense => ({ x: player.x, y: -player.z, floor, speed: Math.hypot(velocity.x, velocity.y), flashlightOn: flashOn && charge > 0, hidden: hiding.hidden });
  const restore = (slot: SaveSlot): boolean => {
    const saved = store.read(slot);
    if (!saved || saved.area !== "mall") return false; // the garage is its own level, not built yet
    hiding.reset();
    guardScene?.finish(); // a load is not the opening
    opening = "skip";
    player.set(saved.x, saved.height, -saved.y);
    yaw = saved.yaw;
    pitch = 0;
    walk.fallSpeed = 0;
    velocity.set(0, 0);
    eyeY = NaN;
    progress.notesRead = [...saved.notesRead];
    progress.guard = saved.guard;
    progress.exits = [...saved.exits];
    stamina.reset();
    sanity.set(1); // sanity and the flashlight charge are not saved: they start fresh
    sanity.snap();
    charge = 1;
    atrium.reset(saved.x, saved.y); // no checkpoint from the load itself
    shadow?.reset(30); // whatever was hunting is gone; it may come back later
    return true;
  };

  /** Whether the player cannot see the plan point right now: outside the camera's view, or behind a wall. */
  const unseen = (x: number, y: number, f: number) =>
    f !== floor || !nav || !nav.sees(floor, player.x, -player.z, x, y) || !frustum.setFromProjectionMatrix(projView).intersectsSphere(guardSphere.set(guardPoint.set(x, f * FLOOR_HEIGHT + 0.5, -y), 1.2));
  const noiseHooks = {
    onImpact: (x: number, y: number, z: number, strength: number) => audio.clatter(x, y, z, strength),
    onScrape: (x: number, y: number, z: number, seconds: number) => audio.scrape(x, y, z, seconds),
    walkable: (f: number, x: number, y: number) => nav?.walkable(f, x, y) ?? false,
  };
  /** One night noise, now, out of the player's sight. False if there was nowhere to put it. */
  const fireNoise = (): boolean => {
    if (!noiseWorld || !nav) return false;
    const spot = pickNoiseSpot(nav, props?.instances.table_set ?? [], FLOOR_HEIGHT, floor, player.x, -player.z, (x, y) => unseen(x, y, floor), Math.random);
    return spot ? noiseWorld.spawn(noiseDirector.pick(), spot, floor, noiseHooks, unseen) : false;
  };

  /** Shows one area and hides the other. */
  const showArea = (next: "mall" | "garage") => {
    area = next;
    const inMall = next === "mall";
    // a garage reached by a ramp has the mall outside its exit doorway: the mall is drawn in the garage's frame (the half
    // turn that `garageToStrip` is), clipped at the doorway, so going out is the same place the whole way
    const beyond = !inMall && !!garage?.layout.arrival;
    const shown = inMall || beyond;
    if (beyond) {
      const o = garageToStrip(stripEntry.e, 0, 0);
      mallRoot.rotation.y = Math.PI;
      mallRoot.position.set(o.x, -stripEntry.floor * FLOOR_HEIGHT, -o.y);
    } else {
      mallRoot.rotation.y = 0;
      mallRoot.position.set(0, 0, 0);
    }
    mallRoot.updateMatrixWorld(true);
    setMallFrame(beyond ? mallRoot : null);
    mallClip.constant = beyond ? -0.16 : 1e6; // (just outside the garage's west wall, whose outer face is at -0.15)
    if (blockout) blockout.visible = shown;
    if (props) props.group.visible = shown;
    if (noiseWorld) noiseWorld.object.visible = shown;
    sky.mesh.visible = inMall;
    if (!inMall) {
      shadowView.object.visible = false;
      guardView.update(0, 0, 0, 0, false, "idle", 0);
    }
    if (garage) garage.view.group.visible = !inMall;
    if (strip) strip.group.visible = inMall;
  };
  /**
   * Whether a seam between the strip's block and the garage's column 0 could be on screen: `pick` chooses which (the
   * opening and the floor-2 secret door's gap, or one doorway to column 1). `inGarage` says which frame the player is in.
   * The cone is the screen's width (at the running FOV) plus a margin; looking steeply up or down counts as seeing it.
   */
  const seamInView = (e: GarageEntrance, f: number, inGarage: boolean, pick: (s: Seams) => { x: number; y: number }[]) => {
    if (!strip) return true;
    if (Math.abs(pitch) > THREE.MathUtils.degToRad(50)) return true;
    const s = strip.places.get(placeKey(e, f))?.seams;
    if (!s) return true;
    const eye = inGarage ? { x: player.x, y: -player.z } : stripToGarage(e, player.x, -player.z);
    const flip = inGarage ? 1 : -1; // the half turn reverses directions
    const fwd = { x: -Math.sin(yaw) * flip, y: Math.cos(yaw) * flip };
    const vFov = THREE.MathUtils.degToRad(Math.max(camera.fov, baseFov + RUN_FOV - FOV));
    const half = Math.atan(Math.tan(vFov / 2) * camera.aspect) + THREE.MathUtils.degToRad(6);
    return seamSeen(s.occluders, pick(s), eye, fwd, Math.cos(Math.min(half, Math.PI * 0.95)));
  };
  /** Whether an arrival garage's exit doorway could be on screen (so the garage behind the player must stay): the doorway's cone plus a margin. */
  const exitInView = (lay: GarageLayout) => {
    if (Math.abs(pitch) > THREE.MathUtils.degToRad(50)) return true;
    const dx = -player.x;
    const dy = lay.stairDoor.y + player.z;
    const d = Math.max(0.5, Math.hypot(dx, dy));
    const cosA = (-Math.sin(yaw) * dx + Math.cos(yaw) * dy) / d;
    const vFov = THREE.MathUtils.degToRad(Math.max(camera.fov, baseFov + RUN_FOV - FOV));
    const half = Math.atan(Math.tan(vFov / 2) * camera.aspect) + THREE.MathUtils.degToRad(6) + Math.atan(GARAGE.GAP / d);
    return cosA > Math.cos(Math.min(half, Math.PI * 0.95));
  };
  /** The world turns half a turn about the vertical axis at the swap: same view, other level. */
  const turnAround = () => {
    yaw += Math.PI;
    velocity.set(-velocity.x, -velocity.y);
    walk.fallSpeed = 0;
    eyeY = NaN;
  };
  /** Walls up or opens the garage's doorways from the first column to the second (view and collision). */
  const setGaps = (closed: (k: number) => boolean) => {
    if (!garage) return;
    const g = garage;
    g.gapClosed = g.gapWalls.map((_, k) => closed(k));
    g.gapClosed.forEach((c, k) => g.view.setGapWall(k, c));
    refreshSolid(g);
  };
  /** Mall to garage with nothing changing on screen: the strip's dressing is the garage's first column, closed like it. */
  const swapToGarage = (e: GarageEntrance, f: number) => {
    if (!garage) return;
    garage.view.group.visible = false;
    garage = garageFor(e, f); // each opening has its own garage
    const g = stripToGarage(e, player.x, -player.z);
    guardScene?.finish();
    opening = "skip";
    hiding.reset();
    shadow?.reset(60);
    stripEntry = { e, floor: f };
    garageReleased = false;
    setGaps(() => true); // the doorways to the second column open one by one, each while the player is not looking at it
    showArea("garage");
    floor = 0;
    player.set(g.x, 0, -g.y);
    turnAround();
    ringTimer = -8;
  };
  /** Garage to mall, the same way: the strip's block around the player, the wall of the stairwell now an opening. */
  const swapToMall = () => {
    const { e, floor: f } = stripEntry;
    const m = garageToStrip(e, player.x, -player.z);
    showArea("mall");
    sanity.setDrain("garage", 0);
    stripHeld = true;
    floor = f;
    player.set(m.x, f * FLOOR_HEIGHT, -m.y);
    turnAround();
    atrium.reset(m.x, m.y);
    shadow?.reset(40);
  };
  const enterGarage = () => {
    if (!garage) return;
    guardScene?.finish();
    opening = "skip";
    hiding.reset();
    shadow?.reset(60);
    garage.view.group.visible = false;
    garage = garageFor(GARAGE_ENTRANCES[1], STRIP_DOOR.floor); // the debug key's garage: the south opening on floor 2
    setGaps(() => false); // (by the fade: no strip to match)
    showArea("garage");
    const sp = garage.layout.spawn;
    floor = 0;
    player.set(sp.x, 0, -sp.y);
    yaw = headingToYaw(sp.heading);
    pitch = 0;
    velocity.set(0, 0);
    walk.fallSpeed = 0;
    eyeY = NaN;
    stripEntry = { e: GARAGE_ENTRANCES[1], floor: STRIP_DOOR.floor }; // the spawn is the south opening's block
    garageReleased = false;
    ringTimer = -8; // the phone starts ringing a little after the player arrives
  };
  /** A random one of the six strip openings (or the debug ?ramptarget=<north|south>:<floor 1-3>): where a ramp garage's doorway comes out. */
  const pickStripTarget = () => {
    const [side, fl] = (params.get("ramptarget") ?? "").split(":");
    const e = GARAGE_ENTRANCES.find((x) => x.id === `strip_${side}`) ?? GARAGE_ENTRANCES[Math.floor(Math.random() * GARAGE_ENTRANCES.length)];
    const f = Number.isFinite(parseInt(fl, 10)) ? Math.min(2, Math.max(0, parseInt(fl, 10) - 1)) : Math.floor(Math.random() * 3);
    return { e, floor: f };
  };
  const rampSeed = () => {
    const seedParam = parseInt(params.get("rampseed") ?? "", 10); // debug: ?rampseed=<n>
    return Number.isFinite(seedParam) ? seedParam : Math.floor(Math.random() * 1e9);
  };
  const dropPrep = () => {
    rampPrep?.next.view.dispose();
    rampPrep = null;
  };
  /**
   * The garage above a ramp, built while the player is near it: the next garage's landing (the ramp from below, the same
   * shape) is turned and placed exactly over this ramp, a ramp's rise above, so what the player sees through the ceiling's
   * hole is where they are going. Its pit stays hidden (this garage's own ramp is the one on screen).
   */
  const prepRamp = (host: Garage, idx: number) => {
    dropPrep();
    const layout = generateGarage(rampSeed(), { arrival: true });
    const r = host.layout.ramps[idx];
    const l = layout.landing;
    if (!r || !l) return;
    const next = buildGarage(layout);
    const delta = r.rise - l.rise; // the turn from the next garage's frame to this one's
    const c0 = { x: (r.box.x0 + r.box.x1) / 2, y: (r.box.y0 + r.box.y1) / 2 };
    const c1 = { x: (l.box.x0 + l.box.x1) / 2, y: (l.box.y0 + l.box.y1) / 2 };
    const tx = c0.x - (Math.cos(delta) * c1.x - Math.sin(delta) * c1.y);
    const ty = c0.y - (Math.sin(delta) * c1.x + Math.cos(delta) * c1.y);
    next.view.group.rotation.y = delta;
    next.view.group.position.set(tx, GARAGE.RAMP_RISE, -ty);
    next.view.group.visible = true;
    next.view.setPit(false);
    rampPrep = { host, idx, next, delta, tx, ty };
  };
  /**
   * Up a ramp into the next garage, with nothing changing on screen: the garage above (see prepRamp) becomes the world,
   * its frame turned back to its own axes and the player, their heading, their speed and the eye carried over with it.
   * The next garage has no booth, no payphone and no ramps; its way out is an open doorway onto a random strip.
   */
  const adoptRamp = () => {
    const p = rampPrep;
    if (!p) return;
    const c = Math.cos(-p.delta);
    const sn = Math.sin(-p.delta);
    const dx = player.x - p.tx;
    const dy = -player.z - p.ty;
    const nx = c * dx - sn * dy;
    const ny = sn * dx + c * dy;
    guardScene?.finish();
    opening = "skip";
    hiding.reset();
    shadow?.reset(60);
    p.host.view.group.visible = false;
    const previous = rampGarage; // the ramp garage before this one is hidden by now: gone
    if (previous !== p.next) previous?.view.dispose();
    rampGarage = p.next;
    rampPrep = null;
    p.next.view.group.position.set(0, 0, 0);
    p.next.view.group.rotation.y = 0;
    p.next.view.setPit(true);
    garage = p.next;
    stripEntry = pickStripTarget(); // the doorway leads out to this opening
    setGaps(() => false); // the maze is open
    garageReleased = true; // the doorway is open from the start
    showArea("garage");
    floor = 0;
    player.set(nx, rampHeight(garage.layout, nx, ny), -ny);
    yaw -= p.delta;
    const vx = velocity.x;
    const vy = -velocity.y;
    velocity.set(c * vx - sn * vy, -(sn * vx + c * vy));
    if (!Number.isNaN(eyeY)) eyeY -= GARAGE.RAMP_RISE; // the new floor is a ramp's rise lower than the old one's
    ringTimer = 0;
    options.onNotice?.("rampArrive");
  };
  /** Debug (?area=ramp): starts in an arrival garage, on its ramp, as if the player had come up it. */
  const enterRampMap = () => {
    if (!garage) return;
    guardScene?.finish();
    opening = "skip";
    hiding.reset();
    shadow?.reset(60);
    dropPrep();
    garage.view.group.visible = false;
    const previous = rampGarage;
    rampGarage = buildGarage(generateGarage(rampSeed(), { arrival: true }));
    previous?.view.dispose();
    garage = rampGarage;
    garage.view.setPit(true);
    stripEntry = pickStripTarget();
    setGaps(() => false);
    garageReleased = true;
    showArea("garage");
    const at = garage.layout.arrive;
    floor = 0;
    player.set(at.x, 0, -at.y);
    yaw = headingToYaw(at.heading);
    pitch = 0;
    velocity.set(0, 0);
    eyeY = NaN;
    ringTimer = 0;
    options.onNotice?.("rampArrive");
  };
  const leaveGarage = () => {
    if (area !== "garage") return;
    showArea("mall");
    sanity.setDrain("garage", 0);
  };

  /** Puts the player somewhere new (a fail's respawn): standing, still, nothing hunting. */
  const placePlayer = (toFloor: number, x: number, y: number, toYaw: number) => {
    hiding.reset();
    guardScene?.finish();
    floor = toFloor;
    player.set(x, toFloor * FLOOR_HEIGHT, -y);
    yaw = toYaw;
    pitch = 0;
    walk.fallSpeed = 0;
    velocity.set(0, 0);
    eyeY = NaN;
    atrium.reset(x, y); // no checkpoint from being put here
    shadow?.reset(40);
  };
  /** Runs while the screen is black after a fail. */
  const relocate = () => {
    if (fail.reason === "to_garage") {
      enterGarage();
      return;
    }
    leaveGarage(); // anything else brings the player back to the mall
    if (fail.reason === "to_mall") {
      // (debug key P) back through the opening the player came in by, just inside the mall, facing east
      placePlayer(stripEntry.floor, stripEntry.e.x + GARAGE_EXIT_INSIDE, stripEntry.e.y, headingToYaw(0));
      sanity.set(Math.max(sanity.level, 0.75));
      sanity.snap();
      charge = 1;
      return;
    }
    if (fail.reason === "caught") {
      // back to the last checkpoint, or to the start if there is none yet; a full reset like a load
      if (!restore("checkpoint")) {
        placePlayer(0, SPAWNS[0].x, SPAWNS[0].y, 0);
        sanity.set(1);
        sanity.snap();
        stamina.reset();
        charge = 1;
      }
    } else {
      // fainted: awake somewhere else in the mall, nothing is lost, a little shaken
      const spot = nav ? pickWakeSpot(nav, floor, player.x, -player.z, Math.random) : null;
      if (spot) placePlayer(spot.floor, spot.x, spot.y, Math.random() * Math.PI * 2);
      else placePlayer(floor, SPAWNS[floor].x, SPAWNS[floor].y, 0);
      stamina.reset();
      sanity.set(FAIL.FAINT_SANITY);
      sanity.snap();
      charge = 1;
    }
    flashOn = false;
  };

  const onKeyDown = (e: KeyboardEvent) => {
    keys.add(e.code);
    if (e.code === "KeyN" && !e.repeat && locked) fireNoise(); // debug: a night noise now
    if (e.code === "KeyG" && !e.repeat && locked) fail.trigger("faint"); // debug: faint now (the same thing running out of sanity does)
    if (e.code === "KeyP" && !e.repeat && locked && garage) {
      // debug: to the garage and back, with a fade
      fail.trigger(area === "mall" ? "to_garage" : "to_mall");
    }
    if (fail.locked) return; // going down or black: nothing else works
    if (e.code === "KeyF" && !e.repeat && !hiding.active) {
      if (flashOn) flashOn = false;
      else if (charge >= FLASH_MIN_ON) flashOn = true;
    }
    if ((e.code === "KeyZ" || e.code === "KeyX") && !e.repeat) sanity.set(sanity.level + (e.code === "KeyX" ? 0.1 : -0.1)); // debug
    if (e.code === "KeyE" && !e.repeat && locked) {
      if (hiding.state === "in") hiding.leave();
      else if (!hiding.active) {
        const spot = hiding.usable(player.x, -player.z, floor, yawToHeading(yaw));
        const door = spot ? null : doors.usable(player.x, player.z, floor, yaw);
        if (spot) {
          hiding.enter(spot, player.x, -player.z, yaw);
          flashOn = false; // hiding is done in the dark
        } else if (door) doors.use(door.id);
      }
    }
    if (e.code === "KeyH" && !e.repeat && shadow) {
      // Debug: bring the shadow in now (out of sight, 12 to 18 m away; or 22 to 40 if there is no such spot)
      const sense = playerSense();
      if (shadow.state === "absent" && !shadow.spawn(sense, true)) shadow.spawn(sense);
    }
    // Debug: force the nearest door on this floor open (even a locked one) or slam it shut.
    const nearestDoor = e.code === "KeyO" || e.code === "KeyK" ? doors.nearest(player.x, player.z, floor) : null;
    if (nearestDoor) {
      if (e.code === "KeyO") doors.open(nearestDoor);
      else doors.slam(nearestDoor);
    }
    const jump = { Digit1: 0, Digit2: 1, Digit3: 2 }[e.code];
    if (jump !== undefined) {
      floor = jump;
      hiding.reset();
      guardScene?.finish();
      opening = "skip";
      player.set(SPAWNS[jump].x, jump * FLOOR_HEIGHT, -SPAWNS[jump].y);
      walk.fallSpeed = 0;
      velocity.set(0, 0);
      eyeY = NaN;
      atrium.reset(player.x, -player.z);
    }
  };
  const onKeyUp = (e: KeyboardEvent) => keys.delete(e.code);
  let skipMouse = true; // the first event after locking can carry the jump of the cursor being recentred
  const onMouseMove = (e: MouseEvent) => {
    if (!locked || guardScene?.controlLocked) return; // the opening holds the camera on the guard
    if (skipMouse) {
      skipMouse = false;
      return;
    }
    if (Math.abs(e.movementX) > MOUSE_SPIKE || Math.abs(e.movementY) > MOUSE_SPIKE) return;
    const speed = LOOK_SPEED * view.sensitivity;
    yaw -= e.movementX * speed;
    pitch = Math.max(-1.4, Math.min(1.4, pitch - e.movementY * speed));
  };
  const onLockChange = () => {
    locked = document.pointerLockElement === renderer.domElement;
    skipMouse = true;
    keys.clear();
    velocity.set(0, 0); // resume from standing still, never mid-stride
    options.onLockChange?.(locked);
  };
  const resize = () => {
    const w = root.clientWidth || window.innerWidth;
    const h = root.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    post.setSize(w, h, renderer.getPixelRatio());
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };

  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("resize", resize);
  document.addEventListener("mousemove", onMouseMove);
  document.addEventListener("pointerlockchange", onLockChange);
  applyQuality();

  const projView = new THREE.Matrix4();

  let last = performance.now();
  let frame = 0;
  const forceRun = params.get("forcerun") === "1";
  let statusTimer = 0;
  const tick = () => {
    frame = requestAnimationFrame(tick);
    const now = performance.now();
    const dt = locked || forceRun ? Math.min((now - last) / 1000, MAX_DT) : 0; // paused while the pointer is free (?forcerun=1, debug: runs without it, for scripted walks)
    if (autoQuality && locked && governor.update((now - last) / 1000, true) === "drop") {
      const lower = QUALITY_LEVELS[QUALITY_LEVELS.indexOf(quality) - 1];
      if (lower) {
        quality = lower;
        saveAutoQuality(quality);
        applyQuality();
        options.onQualityChange?.(quality);
      } else autoQuality = false; // already on the lowest: nothing more to give
    }
    if (stats) {
      // the longest frame in each 5 s window, shown with ?stats=1 (a stutter shows up here even when the average is fine)
      worstNow = Math.max(worstNow, now - last);
      if (now - worstSince > 5000) {
        worstShown = worstNow;
        worstNow = 0;
        worstSince = now;
      }
    }
    last = now;

    // The guard's opening scene: created at the top of the frame, so the player is frozen from the very first one.
    if (opening === "ready" && (locked || guardParam === "now") && nav && progress.guard === 0) {
      const spot = placeAhead(nav, floor, player.x, -player.z, yawToHeading(yaw));
      opening = "playing";
      if (spot) {
        guardAt.x = spot.x;
        guardAt.y = spot.y;
        guardScene = new GuardScene([...es.guardOpening]);
      }
    }
    // Hiding takes the player over: the pose of the crawl (or of the hidden player's turned head) replaces walking.
    const pose = hiding.update(dt, yaw);
    if (pose) {
      player.x = pose.x;
      player.z = -pose.y;
      yaw = pose.yaw;
      velocity.set(0, 0);
      if (hiding.state !== "leaving") pitch = Math.max(HIDING.LOOK_PITCH_DOWN, Math.min(HIDING.LOOK_PITCH_UP, pitch));
    }
    crouch = pose ? pose.crouch : 0;
    if (hiding.active) flashOn = false;
    // The velocity eases toward what the keys ask for, so starting, stopping and turning a corner never jolt.
    const frozen = fail.locked || (guardScene?.controlLocked ?? false);
    const forward = frozen ? 0 : (keys.has("KeyW") || keys.has("ArrowUp") ? 1 : 0) - (keys.has("KeyS") || keys.has("ArrowDown") ? 1 : 0);
    const strafe = frozen ? 0 : (keys.has("KeyD") ? 1 : 0) - (keys.has("KeyA") ? 1 : 0);
    const moving = !pose && (forward !== 0 || strafe !== 0);
    const running = stamina.update(exploration ? 0 : dt, moving && (keys.has("ShiftLeft") || keys.has("ShiftRight")));
    let targetX = 0;
    let targetZ = 0;
    if (moving) {
      const speed = (running ? RUN_SPEED : WALK_SPEED) / Math.hypot(forward, strafe);
      targetX = (-Math.sin(yaw) * forward + Math.cos(yaw) * strafe) * speed;
      targetZ = (-Math.cos(yaw) * forward - Math.sin(yaw) * strafe) * speed;
    }
    const ease = 1 - Math.exp(-ACCEL * dt);
    velocity.x += (targetX - velocity.x) * ease;
    velocity.y += (targetZ - velocity.y) * ease;
    if (!moving && velocity.lengthSq() < 1e-4) velocity.set(0, 0);
    const startX = player.x;
    const startZ = player.z;
    if (!pose && (velocity.x || velocity.y)) {
      player.x += velocity.x * dt;
      player.z += velocity.y * dt;
      if (area === "garage" && garage) {
        const [gx, gy] = resolveGarage(garage.solid, player.x, -player.z, PLAYER_RADIUS);
        player.x = gx;
        player.z = -gy;
      } else {
        walk.collide();
        // inside the strip the dressing (walls, columns, cars) is solid too: the garage's own boxes, turned into the mall's frame
        const blk = strip && stripBlockAt(player.x, -player.z);
        const boxes = blk ? strip?.places.get(placeKey(blk, floor))?.boxes : undefined;
        if (boxes) {
          const [bx, by] = resolveGarage(boxes, player.x, -player.z, PLAYER_RADIUS);
          player.x = bx;
          player.z = -by;
        }
      }
    }
    walked += Math.hypot(player.x - startX, player.z - startZ);
    if (area === "mall") {
      if (!pose) walk.followGround(dt, floor);
      floor = Math.min(2, Math.max(0, Math.floor((player.y + 0.6) / FLOOR_HEIGHT)));
      doors.collide(player, PLAYER_RADIUS, floor); // also when a door closes on a player who is standing still
    } else {
      floor = 0;
      player.y = garage ? rampHeight(garage.layout, player.x, -player.z) : 0; // up a ramp, the floor rises
    }
    if (area === "mall" && atrium.update(player.x, -player.z) === "entered") {
      // entering the atrium is the auto-save: the checkpoint the player returns to after being caught (leaving saves nothing)
      store.write("checkpoint", snapshot());
      options.onNotice?.("checkpoint");
    }

    charge = flashOn ? (exploration ? 1 : Math.max(0, charge - FLASH_DRAIN * dt)) : Math.min(1, charge + FLASH_RECHARGE * dt);
    if (charge === 0) flashOn = false;
    if (fail.update(dt) === "move") relocate();
    blackout.style.opacity = String(fail.fade);
    if (startInGarage && garage && warmDone) {
      startInGarage = false;
      if (params.get("area") === "ramp") enterRampMap();
      else {
        enterGarage();
        garageReleased = params.get("released") === "1"; // debug: as if the payphone had been answered
      }
      if (params.has("x") && params.has("y")) {
        // debug (screenshots): ?x ?y ?yaw ?pitch place the player inside the garage, in garage plan coordinates
        player.set(num("x", 0), 0, -num("y", 0));
        yaw = THREE.MathUtils.degToRad(num("yaw", 0));
        pitch = THREE.MathUtils.degToRad(num("pitch", 0));
      }
    }
    // In the strip, deep enough and with nothing that differs from the garage on screen, the mall becomes the garage
    // (decided by Augusto: any opening, any floor, any time; the strip is closed, and the swap comes as the player turns
    // left or right from the entry cell's solid far wall). While a seam could be seen, the swap waits.
    if (area === "mall" && garage && strip) {
      const inBlock = stripBlockAt(player.x, -player.z);
      if (inBlock) garageFor(inBlock, floor); // built (hidden) while the player is still in the strip, so the swap itself costs nothing
    }
    if (area === "mall" && !fail.locked && garage && strip && dt > 0 && !pose && params.get("stripswap") !== "off") { // (?stripswap=off: debug, stay in the strip's dressing)
      if (stripHeld && !stripBlockAt(player.x, -player.z)) stripHeld = false;
      const blk = stripHeld ? null : stripBlockAt(player.x, -player.z, GARAGE_ENTRANCE_DEPTH);
      if (blk && !seamInView(blk, floor, false, (s) => s.opening)) swapToGarage(blk, floor);
    }
    if (strip && area === "mall") for (const p of strip.places.values()) p.view.update(now / 1000);
    if (rampPrep && area !== "garage") dropPrep(); // left the garage some other way (the strip, a fail's respawn)
    if (area === "garage" && garage) {
      const lay = garage.layout;
      // near a ramp, the garage above it is built and lined up; away from it, it goes
      if (rampPrep && (garage !== rampPrep.host || pose)) dropPrep();
      else if (!lay.arrival && !pose && dt > 0) {
        const near = (b: Box, m: number) => player.x > b.x0 - m && player.x < b.x1 + m && -player.z > b.y0 - m && -player.z < b.y1 + m;
        const idx = lay.ramps.findIndex((r) => near(r.box, 9));
        if (idx >= 0) {
          if (!rampPrep || rampPrep.idx !== idx) prepRamp(garage, idx);
        } else if (rampPrep && !near(lay.ramps[rampPrep.idx].box, 16)) dropPrep();
      }
      // (a garage reached by a ramp keeps draining until the player is out: there is no call to answer)
      sanity.setDrain("garage", garageReleased && !lay.arrival ? 0 : GARAGE_DRAIN);
      if (dt > 0 && !fail.locked) {
        if (!garageReleased || lay.arrival) {
          ringTimer += dt;
          if (ringTimer >= 3.4) {
            ringTimer = 0;
            // the payphone rings; in a garage reached by a ramp, the sound comes from the way out (the first column's door)
            if (garageReleased) audio.ring(0.6, 1.2, -lay.stairDoor.y);
            else audio.ring(lay.goal.x, 1.2, -lay.goal.y);
          }
        }
        if (!garageReleased && atGoal(lay, player.x, -player.z)) {
          // the call is answered: the line cuts, the drain stops, and the way in is the way out (the strip's first column)
          garageReleased = true;
          if (!lay.arrival) {
            sanity.set(Math.max(sanity.level, 0.75));
            sanity.snap();
            options.onNotice?.("garageDone");
          }
        } else if (sanity.level <= 0.02 && fail.trigger("faint")) options.onNotice?.("caught");
        else if (!lay.arrival && !pose && player.y >= GARAGE.RAMP_SWAP && params.get("rampswap") !== "off") adoptRamp(); // up a ramp, above the ceiling: the garage that was above it
        else if (lay.arrival && !pose && player.x < -2 && !exitInView(lay)) swapToMall(); // out through the doorway, into the mall drawn beyond it: when the garage is behind the player, the world turns into the mall
        else if (strip && !pose && !lay.arrival) {
          const { e, floor: f } = stripEntry;
          const inStrip = player.x > 0.5 && player.x < lay.cell - 0.7 && strip.places.get(placeKey(e, f))?.rows.has(Math.floor(-player.z / lay.cell));
          // The mall shifts the doorways to the second column while nobody looks: before the call they open (the maze
          // unfolds around the strip the player came in by); after it, with the player back in the strip's part of the
          // first column, they wall up again, and once all are walled and the opening is out of view, it is the mall again.
          const want = !(garageReleased && inStrip);
          let changed = false;
          const next = garage.gapClosed.map((c, k) => {
            if (c !== want || seamInView(e, f, true, (s) => s.gaps[k])) return c;
            changed = true;
            return !c;
          });
          if (changed) setGaps((k) => next[k]);
          if (garageReleased && inStrip && garage.gapClosed.every(Boolean) && !seamInView(e, f, true, (s) => s.opening)) swapToMall();
        }
      }
      if (lay.arrival && lay.landing && !garage.pitShut) {
        // once the player is out of the ramp's pit, it is closed behind them
        const b = lay.landing.box;
        const m = PLAYER_RADIUS + 0.1;
        if (player.x < b.x0 - m || player.x > b.x1 + m || -player.z < b.y0 - m || -player.z > b.y1 + m) {
          garage.pitShut = true;
          refreshSolid(garage);
        }
      }
      garage.view.update(now / 1000);
      if (rampPrep) rampPrep.next.view.update(now / 1000);
    }
    if (shadow && dt > 0 && !fail.locked && area === "mall") {
      const sense = playerSense();
      for (const ev of shadow.update(dt, sense)) {
        if (ev === "noticed") {
          audio.sting();
          sanity.drain(0.05);
        }
        if (ev === "caught" && fail.trigger("caught")) options.onNotice?.("caught");
      }
      // Seeing it drains sanity, more while it hunts. The player's heading in plan coordinates is (-sin yaw, cos yaw).
      const seen = shadow.visibleTo(sense, -Math.sin(yaw), Math.cos(yaw));
      sanity.setDrain("shadow", seen ? (shadow.hunting ? 0.03 : 0.012) : 0);
      const level = shadow.state === "absent" ? 0 : Math.max(0, 1 - shadow.distanceTo(sense) / 45) * shadow.fade;
      shadowSound.update(shadow.x, floor * FLOOR_HEIGHT + 1.2, -shadow.y, level, shadow.hunting);
    }
    if (shadow && area === "mall") shadowView.update(shadow, now / 1000, camera);
    sanity.update(dt, flashOn || (area === "garage" && garage ? litByTube(garage.layout, player.x, -player.z) : false) ? 1 : 0);
    if (sanity.level <= 0 && dt > 0) fail.trigger("faint"); // out of sanity anywhere: faint (ignored while a fail is already under way)
    doors.tempo = sanity.shift;
    post.setLook(view.motion ? sanity.look : stillLook(sanity.look)); // the moving tiers respect the camera motion setting
    torch.intensity = flashOn ? FLASH_INTENSITY * Math.min(1, charge / FLASH_DIM_BELOW) : 0;

    eyeY = Number.isNaN(eyeY) ? player.y : eyeY + (player.y - eyeY) * (1 - Math.exp(-CAMERA_FOLLOW * dt));
    // Camera effects: a small head bob that fades with speed, and a slight widening while running.
    const bobTarget = view.motion && moving && walk.fallSpeed === 0 ? (running ? BOB_RUN : BOB_WALK) : 0;
    bob += (bobTarget - bob) * (1 - Math.exp(-BOB_EASE * dt));
    // The opening holds the camera on the guard: it turns to him smoothly and stays on his chest and face.
    if (guardScene?.controlLocked) {
      const toGuard = Math.atan2(guardAt.y - -player.z, guardAt.x - player.x); // plan heading to him
      const wantYaw = headingToYaw(toGuard);
      const wantPitch = Math.atan2(1.5 - EYE_HEIGHT, Math.max(0.5, Math.hypot(guardAt.x - player.x, guardAt.y + player.z))); // his face, a little below the eye
      const turn = 1 - Math.exp(-LOCK_TURN * dt);
      yaw += Math.atan2(Math.sin(wantYaw - yaw), Math.cos(wantYaw - yaw)) * turn;
      pitch += (wantPitch - pitch) * turn;
    }
    camera.position.set(player.x, eyeY + EYE_HEIGHT - crouch * (EYE_HEIGHT - HIDING.HIDDEN_EYE) + Math.sin(walked * BOB_FREQ) * bob, player.z);
    camera.rotation.set(pitch, yaw, 0);
    const fovTarget = view.motion && running && velocity.lengthSq() > WALK_SPEED * WALK_SPEED ? baseFov + RUN_FOV - FOV : baseFov;
    if (Math.abs(camera.fov - fovTarget) > 0.01) {
      camera.fov += (fovTarget - camera.fov) * (1 - Math.exp(-FOV_EASE * dt));
      camera.updateProjectionMatrix();
    }
    camera.updateMatrixWorld();
    sky.follow(camera.position);
    projView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    if (area === "mall") doors.update(dt, player, floor, projView);
    // Night noises: the timer, and the motion of whatever has fallen.
    if (noiseWorld && area === "mall") {
      if (dt > 0 && !fail.locked && noiseDirector.update(dt, sanity.shift)) fireNoise();
      noiseWorld.update(dt, noiseHooks);
    }
    // The guard's opening scene (started at the top of the frame, so the player is frozen from the first one).
    if (area === "mall" && opening === "ready" && (locked || guardParam === "now") && nav && progress.guard === 0) {
      const spot = placeAhead(nav, floor, player.x, -player.z, yawToHeading(yaw));
      opening = "playing";
      if (spot) {
        guardAt.x = spot.x;
        guardAt.y = spot.y;
        guardScene = new GuardScene([...es.guardOpening]);
      }
    }
    if (guardScene && !guardScene.done) {
      const px = player.x;
      const py = -player.z;
      const toPlayer = Math.atan2(py - guardAt.y, px - guardAt.x); // plan heading from the guard to the player
      const distance = Math.hypot(px - guardAt.x, py - guardAt.y);
      const visible = frustum.setFromProjectionMatrix(projView).intersectsSphere(guardSphere.set(guardPoint.set(guardAt.x, floor * FLOOR_HEIGHT + 0.95, -guardAt.y), 0.7)) && nav !== null && nav.sees(floor, px, py, guardAt.x, guardAt.y);
      if (guardScene.approaching && dt > 0) {
        const dir = toPlayer;
        const nx = guardAt.x + Math.cos(dir) * GUARD_SCENE.WALK_SPEED * dt;
        const ny = guardAt.y + Math.sin(dir) * GUARD_SCENE.WALK_SPEED * dt;
        if (nav?.walkable(floor, nx, ny)) {
          guardAt.x = nx;
          guardAt.y = ny;
        } else guardScene.stop(); // blocked on the way: he talks from where he is
      }
      if (dt > 0) guardScene.update(dt, distance, visible);
      if (guardScene.line !== guardLine) {
        guardLine = guardScene.line;
        options.onSubtitle?.(guardLine === null ? null : es.guardOpening[guardLine]);
      }
      // Once he has spoken and the player is free: how to move. Once he is gone: the flashlight.
      if (guardScene.phase === "lingering" && tip === null && progress.guard === 0) setTip("move", now);
      // He faces the player while he comes up, talks, and stays.
      guardView.update(guardAt.x, guardAt.y, floor, toPlayer, !guardScene.done, guardScene.approaching ? "walk" : guardScene.line !== null ? "talk" : "idle", now / 1000);
      if (guardScene.done) {
        guardView.update(0, 0, floor, 0, false, "idle", 0);
        options.onSubtitle?.(null);
        if (tip === "move") setTip("flashlight", now);
        if (progress.guard === 0) progress.guard = 1; // the opening has been seen
      }
    }
    if (tip === "flashlight" && (flashOn || now - tipAt > TIP_TIME)) setTip(null, now); // used, or shown long enough
    const preset = QUALITY_PRESETS[quality];
    if (area === "mall") props?.update(camera, Number.isFinite(lodOverride) ? lodOverride : preset.lodDistance, preset.fogFar);
    audio.setListener(player.x, player.y + EYE_HEIGHT, player.z, yaw);
    if (stats) renderer.info.reset();
    post.render(now / 1000);
    if (stats && statusTimer === 1) stats.textContent = `${renderer.info.render.triangles.toLocaleString()} tris · ${renderer.info.render.calls} calls · zona ${area} (${player.x.toFixed(1)}, ${(-player.z).toFixed(1)}) · cordura ${sanity.level.toFixed(2)} · peor cuadro ${worstShown.toFixed(0)} ms · precarga ${warmMs < 0 ? "-" : warmMs.toFixed(0) + " ms"}${shadow ? ` · sombra ${shadow.state} ${shadow.awareness.toFixed(2)}` : ""}`;

    if (++statusTimer >= 10) {
      statusTimer = 1;
      const prompt = area === "garage" ? null : hiding.state === "in" ? "leave" : hiding.active ? null : hiding.usable(player.x, -player.z, floor, yawToHeading(yaw)) ? "hide" : doors.usable(player.x, player.z, floor, yaw) ? "interact" : null;
      options.onStatus?.({ floor: floor + 1, x: player.x, y: -player.z, charge, flashlightOn: flashOn, stamina: stamina.level, exhausted: stamina.exhausted, sanity: sanity.level, prompt });
    }
  };
  tick();

  return {
    requestLock() {
      audio.resume();
      renderer.domElement.requestPointerLock();
    },
    getQuality: () => quality,
    setQuality(level) {
      autoQuality = false; // the player decided: the game stops adjusting it
      quality = level;
      saveQuality(level);
      applyQuality();
    },
    save() {
      if (hunted() || area === "garage") return "blocked"; // a save in the garage would come back in the mall
      return store.write("manual", snapshot()) ? "saved" : "unsaved";
    },
    load: restore,
    savedAt: (slot) => store.read(slot)?.savedAt ?? null,
    getView: () => ({ ...view }),
    setView(next) {
      view = normalizeView(next);
      saveView(view);
      if (!view.motion && camera.fov !== baseFov) {
        camera.fov = baseFov;
        camera.updateProjectionMatrix();
      }
    },
    dispose() {
      cancelAnimationFrame(frame);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("resize", resize);
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("pointerlockchange", onLockChange);
      if (document.pointerLockElement === renderer.domElement) document.exitPointerLock();
      shadowSound.dispose();
      shadowView.dispose();
      audio.dispose();
      sky.dispose();
      post.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      stats?.remove();
      blackout.remove();
      guardView.dispose();
      noiseWorld?.dispose();
    },
  };
}
