import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { AtriumTracker } from "./atrium";
import { createAudio } from "./audio";
import { Doors } from "./doors";
import { setBakedAO, styleBlockout } from "./materials";
import { createPost } from "./post";
import { loadProps, type Props } from "./props";
import { Sanity, stillLook } from "./sanity";
import { createSaveStore, emptyProgress, type SaveSlot } from "./save";
import { createSky } from "./sky";
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
  /** A door the player could use right now ("Presiona E"). */
  canInteract: boolean;
}

export interface RuntimeOptions {
  onLockChange?: (locked: boolean) => void;
  onStatus?: (status: PlayerStatus) => void;
  /** A short-lived message for the HUD. */
  onNotice?: (notice: "doorLocked" | "checkpoint") => void;
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
  const hunted = () => false; // true while the shadow hunts the player; the shadow card replaces this
  const snapshot = () => ({ area: "mall" as const, x: player.x, y: -player.z, height: player.y, yaw, notesRead: [...progress.notesRead], guard: progress.guard, exits: [...progress.exits] });
  let walked = 0; // meters, drives the head bob phase
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
      walk.load(gltf.scene, loadedProps?.colliders);
    } catch (err) {
      console.error("Could not load the mall blockout", err);
    }
  })();

  const keys = new Set<string>();
  let locked = false;
  let charge = 1;
  let flashOn = true;
  const restore = (slot: SaveSlot): boolean => {
    const saved = store.read(slot);
    if (!saved || saved.area !== "mall") return false; // the garage is its own level, not built yet
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
    return true;
  };

  const onKeyDown = (e: KeyboardEvent) => {
    keys.add(e.code);
    if (e.code === "KeyF" && !e.repeat) {
      if (flashOn) flashOn = false;
      else if (charge >= FLASH_MIN_ON) flashOn = true;
    }
    if ((e.code === "KeyZ" || e.code === "KeyX") && !e.repeat) sanity.set(sanity.level + (e.code === "KeyX" ? 0.1 : -0.1)); // debug
    if (e.code === "KeyE" && !e.repeat && locked) {
      const door = doors.usable(player.x, player.z, floor, yaw);
      if (door) doors.use(door.id);
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

    // The velocity eases toward what the keys ask for, so starting, stopping and turning a corner never jolt.
    const forward = (keys.has("KeyW") || keys.has("ArrowUp") ? 1 : 0) - (keys.has("KeyS") || keys.has("ArrowDown") ? 1 : 0);
    const strafe = (keys.has("KeyD") ? 1 : 0) - (keys.has("KeyA") ? 1 : 0);
    const moving = forward !== 0 || strafe !== 0;
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
    if (velocity.x || velocity.y) {
      player.x += velocity.x * dt;
      player.z += velocity.y * dt;
      walk.collide();
    }
    walked += Math.hypot(player.x - startX, player.z - startZ);
    walk.followGround(dt, floor);
    floor = Math.min(2, Math.max(0, Math.floor((player.y + 0.6) / FLOOR_HEIGHT)));
    doors.collide(player, PLAYER_RADIUS, floor); // also when a door closes on a player who is standing still
    if (atrium.update(player.x, -player.z) === "entered") {
      // entering the atrium is the auto-save: the checkpoint the player returns to after being caught (leaving saves nothing)
      store.write("checkpoint", snapshot());
      options.onNotice?.("checkpoint");
    }

    charge = flashOn ? (exploration ? 1 : Math.max(0, charge - FLASH_DRAIN * dt)) : Math.min(1, charge + FLASH_RECHARGE * dt);
    if (charge === 0) flashOn = false;
    sanity.update(dt, flashOn ? 1 : 0);
    doors.tempo = sanity.shift;
    post.setLook(view.motion ? sanity.look : stillLook(sanity.look)); // the moving tiers respect the camera motion setting
    torch.intensity = flashOn ? FLASH_INTENSITY * Math.min(1, charge / FLASH_DIM_BELOW) : 0;

    eyeY = Number.isNaN(eyeY) ? player.y : eyeY + (player.y - eyeY) * (1 - Math.exp(-CAMERA_FOLLOW * dt));
    // Camera effects: a small head bob that fades with speed, and a slight widening while running.
    const bobTarget = view.motion && moving && walk.fallSpeed === 0 ? (running ? BOB_RUN : BOB_WALK) : 0;
    bob += (bobTarget - bob) * (1 - Math.exp(-BOB_EASE * dt));
    camera.position.set(player.x, eyeY + EYE_HEIGHT + Math.sin(walked * BOB_FREQ) * bob, player.z);
    camera.rotation.set(pitch, yaw, 0);
    const fovTarget = view.motion && running && velocity.lengthSq() > WALK_SPEED * WALK_SPEED ? baseFov + RUN_FOV - FOV : baseFov;
    if (Math.abs(camera.fov - fovTarget) > 0.01) {
      camera.fov += (fovTarget - camera.fov) * (1 - Math.exp(-FOV_EASE * dt));
      camera.updateProjectionMatrix();
    }
    camera.updateMatrixWorld();
    sky.follow(camera.position);
    doors.update(dt, player, floor, projView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    const preset = QUALITY_PRESETS[quality];
    props?.update(camera, Number.isFinite(lodOverride) ? lodOverride : preset.lodDistance, preset.fogFar);
    audio.setListener(player.x, player.y + EYE_HEIGHT, player.z, yaw);
    if (stats) renderer.info.reset();
    post.render(now / 1000);
    if (stats && statusTimer === 1) stats.textContent = `${renderer.info.render.triangles.toLocaleString()} tris · ${renderer.info.render.calls} calls · cordura ${sanity.level.toFixed(2)}`;

    if (++statusTimer >= 10) {
      statusTimer = 1;
      options.onStatus?.({ floor: floor + 1, x: player.x, y: -player.z, charge, flashlightOn: flashOn, canInteract: doors.usable(player.x, player.z, floor, yaw) !== null });
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
      audio.dispose();
      sky.dispose();
      post.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      stats?.remove();
    },
  };
}
