import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { AtriumTracker } from "./atrium";
import { createAudio } from "./audio";
import { NavGrid, type NavData } from "./nav";
import { Doors } from "./doors";
import { GuardScene, GUARD_SCENE, placeAhead } from "./guard-scene";
import { createGuardView } from "./guard-view";
import { Fail, FAIL, pickWakeSpot } from "./fail";
import { Hiding, HIDING, spotsFromProps, yawToHeading } from "./hiding";
import { setBakedAO, styleBlockout } from "./materials";
import { NoiseDirector, pickNoiseSpot } from "./night-noise";
import { createNoiseWorld, type NoiseWorld } from "./noise-view";
import { createPost } from "./post";
import { loadProps, type Props } from "./props";
import { Sanity, stillLook } from "./sanity";
import { createSaveStore, emptyProgress, type SaveSlot } from "./save";
import { Shadow, type PlayerSense } from "./shadow";
import { createShadowView } from "./shadow-view";
import { createSky } from "./sky";
import { es } from "../strings/es-CR";
import { Walk, FLOOR_HEIGHT, PLAYER_RADIUS } from "./walk";
import { QUALITY_PRESETS, isQualityLevel, loadQuality, saveQuality, type QualityLevel } from "./quality";
import { loadView, normalizeView, saveView, type ViewSettings } from "./view";

export interface PlayerStatus {
  floor: number;
  /** Position in floor-plan meters (x east, y north). */
  x: number;
  y: number;
  /** Flashlight charge, 0 to 1, and whether the light is on. */
  charge: number;
  flashlightOn: boolean;
  /** What E would do right now, if anything: use a door, crawl into a hiding spot, or crawl out of one. */
  prompt: "interact" | "hide" | "leave" | null;
}

export interface RuntimeOptions {
  onLockChange?: (locked: boolean) => void;
  onStatus?: (status: PlayerStatus) => void;
  /** A short-lived message for the HUD. */
  onNotice?: (notice: "doorLocked" | "checkpoint" | "caught") => void;
  /** A line of speech to show as a subtitle (the guard), or null to clear it. */
  onSubtitle?: (text: string | null) => void;
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
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  root.prepend(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x04060a); // near black with a blue tint: this is the night
  scene.fog = new THREE.Fog(0x04060a, 6, 70);
  const sky = createSky(); // the night outside the glass; the fog does not touch it
  scene.add(sky.mesh);

  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.05, 250);
  camera.rotation.order = "YXZ";

  const params = new URLSearchParams(window.location.search);
  const urlQuality = params.get("quality"); // debug: ?quality=low|medium|high (not saved)
  const baseFov = parseFloat(params.get("fov") ?? "") || FOV; // debug: ?fov=<vertical degrees>
  camera.fov = baseFov;
  let view = loadView();

  renderer.toneMappingExposure = parseFloat(params.get("exposure") ?? "") || 1.6; // debug: ?exposure=<number>
  const ambientLevel = parseFloat(params.get("ambient") ?? "");
  const exploration = params.get("epx") === "1"; // debug: ?epx=1 is exploration mode: the flashlight never runs out
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
  let quality: QualityLevel = isQualityLevel(urlQuality) ? urlQuality : loadQuality();
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
  let flashOn = true;
  let crouch = 0; // 0 standing, 1 fully hidden: lowers the eye
  let bob = 0; // current head bob height, eased toward the target

  const sanity = new Sanity();
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
  const guardView = createGuardView();
  scene.add(guardView.object); // with its light (at intensity 0 until he is on stage), so no shader recompiles when he appears
  // The opening: the guard is the first thing the player sees. Skipped by any debug start (?x ?y ?floor), by ?guard=off, and on a
  // game that has already met him; ?guard=now plays it from wherever the game starts.
  const guardParam = params.get("guard");
  let opening = guardParam === "off" ? "skip" : guardParam === "now" || !["x", "y", "floor"].some((k) => params.has(k)) ? "ready" : "skip";
  let guardScene: GuardScene | null = null;
  const guardAt = { x: 0, y: 0 };
  let guardLine: number | null = null;
  const frustum = new THREE.Frustum();
  const guardSphere = new THREE.Sphere();
  const guardPoint = new THREE.Vector3();
  const fail = new Fail();
  // The black of a fail (caught, fainted): a plain overlay, so it works on every quality preset, under the HUD text (z-index 5).
  const blackout = document.createElement("div");
  blackout.style.cssText = "position:absolute;inset:0;background:#000;opacity:0;pointer-events:none;z-index:2";
  root.append(blackout);
  let nav: NavGrid | null = null; // the shadow's map, also used to pick where the player wakes up after fainting
  const shadowView = createShadowView();
  scene.add(shadowView.object);
  const shadowSound = audio.shadow();
  const shadowMode = params.get("shadow"); // debug: ?shadow=off (it never comes), ?shadow=now (it comes within seconds)
  doors.auto = params.get("doors") !== "off"; // debug: ?doors=off stops the mall moving doors by itself

  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  void (async () => {
    try {
      // The props are optional: a missing or broken props file must not stop the mall from loading.
      const [gltf, loadedProps, ao] = await Promise.all([
        loader.loadAsync(BLOCKOUT_URL),
        loadProps(PROPS_URL, async (url) => (await loader.loadAsync(url)).scene).catch((err) => {
          console.error("Could not load the props", err);
          return null;
        }),
        new THREE.TextureLoader().loadAsync(AO_URL).catch((err) => {
          console.error("Could not load the baked occlusion", err);
          return null;
        }),
      ]);
      setBakedAO(ao); // before the first styled frame: the shader samples it
      gltf.scene.traverse((o) => {
        if (!(o instanceof THREE.Mesh)) return;
        const kind = (o.material as THREE.Material).name; // chunks share the material's name; node names are made unique
        if (kind === "barrier") o.visible = false; // collision only
        if (kind === "glass" || kind === "rails") o.renderOrder = 1;
      });
      scene.add(gltf.scene);
      blockout = gltf.scene;
      styleBlockout(gltf.scene, QUALITY_PRESETS[quality].detail);
      if (loadedProps) {
        scene.add(loadedProps.group);
        styleBlockout(loadedProps.group, QUALITY_PRESETS[quality].detail); // the kit pieces get the same surface detail
        props = loadedProps;
      }
      doors.load(gltf.scene);
      const piece = (name: string) => loader.loadAsync(`./models/kit/${name}.glb`).then((g) => g.scene).catch(() => null); // optional: no model, no event of that kind
      const [chairPiece, binPiece] = await Promise.all([piece("chair_loose"), piece("trash_bin")]);
      noiseWorld = createNoiseWorld({ chair: chairPiece, bin: binPiece });
      scene.add(noiseWorld.object);
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
    } catch (err) {
      console.error("Could not load the mall blockout", err);
    }
  })();

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
    if (fail.reason === "caught") {
      // back to the last checkpoint, or to the start if there is none yet; a full reset like a load
      if (!restore("checkpoint")) {
        placePlayer(0, SPAWNS[0].x, SPAWNS[0].y, 0);
        sanity.set(1);
        sanity.snap();
        charge = 1;
      }
    } else {
      // fainted: awake somewhere else in the mall, nothing is lost, a little shaken
      const spot = nav ? pickWakeSpot(nav, floor, player.x, -player.z, Math.random) : null;
      if (spot) placePlayer(spot.floor, spot.x, spot.y, Math.random() * Math.PI * 2);
      else placePlayer(floor, SPAWNS[floor].x, SPAWNS[floor].y, 0);
      sanity.set(FAIL.FAINT_SANITY);
      sanity.snap();
      charge = 1;
    }
    flashOn = false;
  };

  const onKeyDown = (e: KeyboardEvent) => {
    keys.add(e.code);
    if (e.code === "KeyN" && !e.repeat && locked) fireNoise(); // debug: a night noise now
    if (e.code === "KeyG" && !e.repeat && locked) fail.trigger("faint"); // debug: faint now (the garage's sanity-out will do this)
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
    if (!locked) return;
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
  let statusTimer = 0;
  const tick = () => {
    frame = requestAnimationFrame(tick);
    const now = performance.now();
    const dt = locked ? Math.min((now - last) / 1000, MAX_DT) : 0; // paused while the pointer is free
    last = now;

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
    const forward = fail.locked ? 0 : (keys.has("KeyW") || keys.has("ArrowUp") ? 1 : 0) - (keys.has("KeyS") || keys.has("ArrowDown") ? 1 : 0);
    const strafe = fail.locked ? 0 : (keys.has("KeyD") ? 1 : 0) - (keys.has("KeyA") ? 1 : 0);
    const moving = !pose && (forward !== 0 || strafe !== 0);
    const running = moving && (keys.has("ShiftLeft") || keys.has("ShiftRight"));
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
      walk.collide();
    }
    walked += Math.hypot(player.x - startX, player.z - startZ);
    if (!pose) walk.followGround(dt, floor);
    floor = Math.min(2, Math.max(0, Math.floor((player.y + 0.6) / FLOOR_HEIGHT)));
    doors.collide(player, PLAYER_RADIUS, floor); // also when a door closes on a player who is standing still
    if (atrium.update(player.x, -player.z) === "entered") {
      // entering the atrium is the auto-save: the checkpoint the player returns to after being caught (leaving saves nothing)
      store.write("checkpoint", snapshot());
      options.onNotice?.("checkpoint");
    }

    charge = flashOn ? (exploration ? 1 : Math.max(0, charge - FLASH_DRAIN * dt)) : Math.min(1, charge + FLASH_RECHARGE * dt);
    if (charge === 0) flashOn = false;
    if (fail.update(dt) === "move") relocate();
    blackout.style.opacity = String(fail.fade);
    if (shadow && dt > 0 && !fail.locked) {
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
    if (shadow) shadowView.update(shadow, now / 1000);
    sanity.update(dt, flashOn ? 1 : 0);
    doors.tempo = sanity.shift;
    post.setLook(view.motion ? sanity.look : stillLook(sanity.look)); // the moving tiers respect the camera motion setting
    torch.intensity = flashOn ? FLASH_INTENSITY * Math.min(1, charge / FLASH_DIM_BELOW) : 0;

    eyeY = Number.isNaN(eyeY) ? player.y : eyeY + (player.y - eyeY) * (1 - Math.exp(-CAMERA_FOLLOW * dt));
    // Camera effects: a small head bob that fades with speed, and a slight widening while running.
    const bobTarget = view.motion && moving && walk.fallSpeed === 0 ? (running ? BOB_RUN : BOB_WALK) : 0;
    bob += (bobTarget - bob) * (1 - Math.exp(-BOB_EASE * dt));
    camera.position.set(player.x, eyeY + EYE_HEIGHT - crouch * (EYE_HEIGHT - HIDING.HIDDEN_EYE) + Math.sin(walked * BOB_FREQ) * bob, player.z);
    camera.rotation.set(pitch, yaw, 0);
    const fovTarget = view.motion && running && velocity.lengthSq() > WALK_SPEED * WALK_SPEED ? baseFov + RUN_FOV - FOV : baseFov;
    if (Math.abs(camera.fov - fovTarget) > 0.01) {
      camera.fov += (fovTarget - camera.fov) * (1 - Math.exp(-FOV_EASE * dt));
      camera.updateProjectionMatrix();
    }
    camera.updateMatrixWorld();
    sky.follow(camera.position);
    doors.update(dt, player, floor, projView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    // Night noises: the timer, and the motion of whatever has fallen.
    if (noiseWorld) {
      if (dt > 0 && !fail.locked && noiseDirector.update(dt, sanity.shift)) fireNoise();
      noiseWorld.update(dt, noiseHooks);
    }
    // The guard's opening scene.
    if (opening === "ready" && (locked || guardParam === "now") && nav && progress.guard === 0) {
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
      const visible = frustum.setFromProjectionMatrix(projView).intersectsSphere(guardSphere.set(guardPoint.set(guardAt.x, floor * FLOOR_HEIGHT + 0.95, -guardAt.y), 0.7)) && nav !== null && nav.sees(floor, px, py, guardAt.x, guardAt.y);
      const facingAway = Math.atan2(guardAt.y - py, guardAt.x - px);
      if (guardScene.walking && dt > 0) {
        const nx = guardAt.x + Math.cos(facingAway) * GUARD_SCENE.WALK_SPEED * dt;
        const ny = guardAt.y + Math.sin(facingAway) * GUARD_SCENE.WALK_SPEED * dt;
        if (nav?.walkable(floor, nx, ny)) {
          guardAt.x = nx;
          guardAt.y = ny;
        } else guardScene.finish(); // blocked: he is gone around the corner
      }
      if (dt > 0) guardScene.update(dt, visible);
      if (guardScene.line !== guardLine) {
        guardLine = guardScene.line;
        options.onSubtitle?.(guardLine === null ? null : es.guardOpening[guardLine]);
      }
      guardView.update(guardAt.x, guardAt.y, floor, guardScene.walking ? facingAway : facingAway + Math.PI, !guardScene.done, guardScene.walking, now / 1000);
      if (guardScene.done) {
        guardView.update(0, 0, floor, 0, false, false, 0);
        options.onSubtitle?.(null);
        if (progress.guard === 0) progress.guard = 1; // the opening has been seen
      }
    }
    const preset = QUALITY_PRESETS[quality];
    props?.update(camera, Number.isFinite(lodOverride) ? lodOverride : preset.lodDistance, preset.fogFar);
    audio.setListener(player.x, player.y + EYE_HEIGHT, player.z, yaw);
    if (stats) renderer.info.reset();
    post.render(now / 1000);
    if (stats && statusTimer === 1) stats.textContent = `${renderer.info.render.triangles.toLocaleString()} tris · ${renderer.info.render.calls} calls · cordura ${sanity.level.toFixed(2)}${shadow ? ` · sombra ${shadow.state} ${shadow.awareness.toFixed(2)}` : ""}`;

    if (++statusTimer >= 10) {
      statusTimer = 1;
      const prompt = hiding.state === "in" ? "leave" : hiding.active ? null : hiding.usable(player.x, -player.z, floor, yawToHeading(yaw)) ? "hide" : doors.usable(player.x, player.z, floor, yaw) ? "interact" : null;
      options.onStatus?.({ floor: floor + 1, x: player.x, y: -player.z, charge, flashlightOn: flashOn, prompt });
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
      quality = level;
      saveQuality(level);
      applyQuality();
    },
    save() {
      if (hunted()) return "blocked";
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
