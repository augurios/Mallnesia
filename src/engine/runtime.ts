import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { MeshBVH } from "three-mesh-bvh";
import { createAudio } from "./audio";
import { Doors } from "./doors";
import { styleBlockout } from "./materials";
import { createPost } from "./post";
import { QUALITY_PRESETS, isQualityLevel, loadQuality, saveQuality, type QualityLevel } from "./quality";

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
  onNotice?: (notice: "doorLocked") => void;
}

export interface Runtime {
  requestLock(): void;
  getQuality(): QualityLevel;
  /** Applies a preset right away and remembers it for next time. */
  setQuality(level: QualityLevel): void;
  dispose(): void;
}

const EYE_HEIGHT = 1.65;
const WALK_SPEED = 3.2;
const RUN_SPEED = 7;
const LOOK_SPEED = 0.0022;
const PLAYER_RADIUS = 0.35;
const COLLIDER_HEIGHT = 1.0; // the collision sphere sits at chest height, so railings (1.1 m) block too
const FLASH_INTENSITY = 60;
const FLASH_DRAIN = 1 / 120; // charge per second while on: 2 minutes of light
const FLASH_RECHARGE = 1 / 90; // charge per second while off: 90 seconds to refill
const FLASH_MIN_ON = 0.1; // can't switch on below this
const FLASH_DIM_BELOW = 0.2; // the beam fades out under this charge
const FLOOR_HEIGHT = 5; // keep in sync with scripts/build-blockout.mts
const STEP_UP = 0.5; // the player climbs ledges up to this high (stair risers are 0.125)
const SNAP_DOWN = 0.4; // and follows the ground down this far without falling
const GRAVITY = 18;
const CAMERA_FOLLOW = 18; // how fast the eye follows the feet over steps (1/s)
// Meshes of the blockout the player collides with. Keep in sync with COLLIDERS in scripts/build-blockout.mts.
const COLLIDERS = ["walls", "glass", "rails", "stairs", "elev", "column", "steel", "planter", "barrier"];
const BLOCKOUT_URL = "./models/mall_blockout.glb";

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

  const camera = new THREE.PerspectiveCamera(60, 1, 0.05, 250); // vertical fov: 60 is about 92 degrees horizontal at 16:9
  camera.rotation.order = "YXZ";

  const params = new URLSearchParams(window.location.search);
  const urlQuality = params.get("quality"); // debug: ?quality=low|medium|high (not saved)
  camera.fov = parseFloat(params.get("fov") ?? "") || camera.fov; // debug: ?fov=<vertical degrees>

  renderer.toneMappingExposure = parseFloat(params.get("exposure") ?? "") || 1.6; // debug: ?exposure=<number>
  const ambientLevel = parseFloat(params.get("ambient") ?? "");
  // Faint cool sky glow from above, darker blue-grey bounce from below (art doc: never pure black).
  scene.add(new THREE.HemisphereLight(0x4a5a78, 0x10141c, Number.isFinite(ambientLevel) ? ambientLevel : 2.4)); // debug: ?ambient=<intensity>
  const torch = new THREE.SpotLight(0xfff2d0, FLASH_INTENSITY, 40, Math.PI / 5, 0.4);
  torch.position.set(0, 0, 0);
  torch.target.position.set(0, 0, -1);
  camera.add(torch, torch.target);
  scene.add(camera);

  const post = createPost(renderer, scene, camera);
  let blockout: THREE.Object3D | null = null;
  let quality: QualityLevel = isQualityLevel(urlQuality) ? urlQuality : loadQuality();
  const applyQuality = () => {
    const preset = QUALITY_PRESETS[quality];
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, preset.maxPixelRatio));
    (scene.fog as THREE.Fog).far = preset.fogFar;
    torch.distance = preset.torchDistance;
    post.setSettings({ bloom: preset.bloom, film: preset.film });
    if (blockout) styleBlockout(blockout, preset.detail);
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
  let fallSpeed = 0;
  let eyeY = NaN; // smoothed camera height; NaN = snap to the player next frame
  let yaw = THREE.MathUtils.degToRad(num("yaw", 0));
  let pitch = THREE.MathUtils.degToRad(num("pitch", 0));

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

  // Collision: walls, glass and railings merged into one BVH.
  let bvh: MeshBVH | null = null;
  // Ground: floor slabs and stair treads, raycast downward to find what the player stands on.
  let groundBvh: MeshBVH | null = null;
  new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).load(BLOCKOUT_URL, (gltf) => {
    const parts: THREE.BufferGeometry[] = [];
    const ground: THREE.BufferGeometry[] = [];
    gltf.scene.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      // Chunks of one material share its name, but the loader makes node names unique (walls, walls_1, ...).
      const kind = (o.material as THREE.Material).name;
      if (kind.startsWith("floor") || kind === "stairs") {
        const g = (o.geometry as THREE.BufferGeometry).clone();
        g.deleteAttribute("normal");
        ground.push(g);
      }
      if (kind === "barrier") o.visible = false; // collision only
      if (COLLIDERS.includes(kind)) {
        const g = (o.geometry as THREE.BufferGeometry).clone();
        g.deleteAttribute("normal");
        parts.push(g);
      }
      if (kind === "glass" || kind === "rails") o.renderOrder = 1;
    });
    scene.add(gltf.scene);
    blockout = gltf.scene;
    styleBlockout(gltf.scene, QUALITY_PRESETS[quality].detail);
    doors.load(gltf.scene);
    if (parts.length) bvh = new MeshBVH(mergeGeometries(parts, false));
    if (ground.length) groundBvh = new MeshBVH(mergeGeometries(ground, false));
  }, undefined, (err) => console.error("Could not load the mall blockout", err));

  const keys = new Set<string>();
  let locked = false;

  const onKeyDown = (e: KeyboardEvent) => {
    keys.add(e.code);
    if (e.code === "KeyF" && !e.repeat) {
      if (flashOn) flashOn = false;
      else if (charge >= FLASH_MIN_ON) flashOn = true;
    }
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
      fallSpeed = 0;
      eyeY = NaN;
    }
  };
  const onKeyUp = (e: KeyboardEvent) => keys.delete(e.code);
  const onMouseMove = (e: MouseEvent) => {
    if (!locked) return;
    yaw -= e.movementX * LOOK_SPEED;
    pitch = Math.max(-1.4, Math.min(1.4, pitch - e.movementY * LOOK_SPEED));
  };
  const onLockChange = () => {
    locked = document.pointerLockElement === renderer.domElement;
    if (!locked) keys.clear();
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

  const sphere = new THREE.Sphere();
  const closest = new THREE.Vector3();
  const push = new THREE.Vector3();

  /** Push the player out of any wall within PLAYER_RADIUS, horizontally only. */
  function collide() {
    if (!bvh) return;
    const baseY = player.y;
    for (let pass = 0; pass < 3; pass++) {
      sphere.center.set(player.x, baseY + COLLIDER_HEIGHT, player.z);
      sphere.radius = PLAYER_RADIUS;
      let moved = false;
      bvh.shapecast({
        intersectsBounds: (box) => box.intersectsSphere(sphere),
        intersectsTriangle: (tri) => {
          tri.closestPointToPoint(sphere.center, closest);
          push.subVectors(sphere.center, closest);
          // Ignore geometry on other floors: it must be within reach in 3D, not just horizontally.
          const dy = push.y;
          if (Math.abs(dy) >= PLAYER_RADIUS) return false;
          push.y = 0;
          const dist = push.length();
          const reach = Math.sqrt(PLAYER_RADIUS * PLAYER_RADIUS - dy * dy);
          if (dist >= reach || dist < 1e-6) return false;
          push.multiplyScalar((reach - dist) / dist);
          sphere.center.add(push);
          player.x = sphere.center.x;
          player.z = sphere.center.z;
          moved = true;
          return false;
        },
      });
      if (!moved) break;
    }
  }

  const projView = new THREE.Matrix4();
  const groundRay = new THREE.Ray(new THREE.Vector3(), new THREE.Vector3(0, -1, 0));

  /** Stands the player on the highest surface within step height, or lets them fall. */
  function followGround(dt: number) {
    if (!groundBvh) return;
    groundRay.origin.set(player.x, player.y + STEP_UP, player.z);
    const hit = groundBvh.raycastFirst(groundRay, THREE.FrontSide);
    if (hit && hit.point.y >= player.y - SNAP_DOWN) {
      player.y = hit.point.y;
      fallSpeed = 0;
      return;
    }
    fallSpeed += GRAVITY * dt;
    player.y -= fallSpeed * dt;
    if (hit && player.y < hit.point.y) {
      player.y = hit.point.y;
      fallSpeed = 0;
    }
    if (player.y < -3) {
      player.y = floor * FLOOR_HEIGHT; // fell out of the world: back to the last floor
      fallSpeed = 0;
    }
  }

  let last = performance.now();
  let charge = 1;
  let flashOn = true;
  let frame = 0;
  let statusTimer = 0;
  const tick = () => {
    frame = requestAnimationFrame(tick);
    const now = performance.now();
    const dt = locked ? Math.min((now - last) / 1000, 0.1) : 0; // paused while the pointer is free
    last = now;

    const forward = (keys.has("KeyW") ? 1 : 0) - (keys.has("KeyS") ? 1 : 0);
    const strafe = (keys.has("KeyD") ? 1 : 0) - (keys.has("KeyA") ? 1 : 0);
    if (forward || strafe) {
      const len = Math.hypot(forward, strafe);
      const running = keys.has("ShiftLeft") || keys.has("ShiftRight");
      const speed = ((running ? RUN_SPEED : WALK_SPEED) * dt) / len;
      player.x += (-Math.sin(yaw) * forward + Math.cos(yaw) * strafe) * speed;
      player.z += (-Math.cos(yaw) * forward - Math.sin(yaw) * strafe) * speed;
      collide();
    }
    followGround(dt);
    floor = Math.min(2, Math.max(0, Math.floor((player.y + 0.6) / FLOOR_HEIGHT)));
    doors.collide(player, PLAYER_RADIUS, floor); // also when a door closes on a player who is standing still

    charge = flashOn ? Math.max(0, charge - FLASH_DRAIN * dt) : Math.min(1, charge + FLASH_RECHARGE * dt);
    if (charge === 0) flashOn = false;
    torch.intensity = flashOn ? FLASH_INTENSITY * Math.min(1, charge / FLASH_DIM_BELOW) : 0;

    eyeY = Number.isNaN(eyeY) ? player.y : eyeY + (player.y - eyeY) * (1 - Math.exp(-CAMERA_FOLLOW * dt));
    camera.position.set(player.x, eyeY + EYE_HEIGHT, player.z);
    camera.rotation.set(pitch, yaw, 0);
    camera.updateMatrixWorld();
    doors.update(dt, player, floor, projView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    audio.setListener(player.x, player.y + EYE_HEIGHT, player.z, yaw);
    post.render(now / 1000);

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
    dispose() {
      cancelAnimationFrame(frame);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("resize", resize);
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("pointerlockchange", onLockChange);
      if (document.pointerLockElement === renderer.domElement) document.exitPointerLock();
      audio.dispose();
      post.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
