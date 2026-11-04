import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { MeshBVH } from "three-mesh-bvh";

export interface PlayerStatus {
  floor: number;
  /** Position in floor-plan meters (x east, y north). */
  x: number;
  y: number;
}

export interface RuntimeOptions {
  onLockChange?: (locked: boolean) => void;
  onStatus?: (status: PlayerStatus) => void;
}

export interface Runtime {
  requestLock(): void;
  dispose(): void;
}

const EYE_HEIGHT = 1.65;
const WALK_SPEED = 3.2;
const RUN_SPEED = 7;
const LOOK_SPEED = 0.0022;
const PLAYER_RADIUS = 0.35;
const COLLIDER_HEIGHT = 1.0; // the collision sphere sits at chest height, so railings (1.1 m) block too
const FLOOR_HEIGHT = 5; // keep in sync with scripts/build-blockout.mts
const BLOCKOUT_URL = "./models/mall_blockout.glb";

// Plan coordinates (meters). Floor 1 starts in the entrance lobby; the others at the west hall.
// Debug keys 1/2/3 jump to these until stairs and elevators exist.
const SPAWNS: { x: number; y: number }[] = [
  { x: 80, y: 28 },
  { x: 48, y: 100 },
  { x: 48, y: 100 },
];

/** First-person walk through the mall blockout: pointer-lock look, WASD, BVH wall collision. No React in here. */
export function createRuntime(root: HTMLElement, options: RuntimeOptions = {}): Runtime {
  const renderer = new THREE.WebGLRenderer({ antialias: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  root.prepend(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x050507);
  scene.fog = new THREE.Fog(0x050507, 6, 70);

  const camera = new THREE.PerspectiveCamera(60, 1, 0.05, 250); // vertical fov: 60 is about 92 degrees horizontal at 16:9
  camera.rotation.order = "YXZ";

  const params = new URLSearchParams(window.location.search);
  camera.fov = parseFloat(params.get("fov") ?? "") || camera.fov; // debug: ?fov=<vertical degrees>

  scene.add(new THREE.AmbientLight(0x6070a0, 0.9));
  const torch = new THREE.SpotLight(0xfff2d0, 60, 40, Math.PI / 5, 0.4);
  torch.position.set(0, 0, 0);
  torch.target.position.set(0, 0, -1);
  camera.add(torch, torch.target);
  scene.add(camera);

  // Player state. Plan y is north, so the three.js z axis is -y.
  const num = (key: string, fallback: number) => {
    const v = parseFloat(params.get(key) ?? "");
    return Number.isFinite(v) ? v : fallback;
  };
  let floor = Math.min(3, Math.max(1, Math.round(num("floor", 1)))) - 1;
  const player = new THREE.Vector3(num("x", SPAWNS[floor].x), 0, -num("y", SPAWNS[floor].y));
  let yaw = THREE.MathUtils.degToRad(num("yaw", 0));
  let pitch = THREE.MathUtils.degToRad(num("pitch", 0));

  // Collision: walls, glass and railings merged into one BVH.
  let bvh: MeshBVH | null = null;
  new GLTFLoader().load(BLOCKOUT_URL, (gltf) => {
    const parts: THREE.BufferGeometry[] = [];
    gltf.scene.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      if (o.name === "walls" || o.name === "glass" || o.name === "rails") {
        const g = (o.geometry as THREE.BufferGeometry).clone();
        g.deleteAttribute("normal");
        parts.push(g);
      }
      if (o.name === "glass" || o.name === "rails") o.renderOrder = 1;
    });
    scene.add(gltf.scene);
    if (parts.length) bvh = new MeshBVH(mergeGeometries(parts, false));
  }, undefined, (err) => console.error("Could not load the mall blockout", err));

  const keys = new Set<string>();
  let locked = false;

  const onKeyDown = (e: KeyboardEvent) => {
    keys.add(e.code);
    const jump = { Digit1: 0, Digit2: 1, Digit3: 2 }[e.code];
    if (jump !== undefined) {
      floor = jump;
      player.set(SPAWNS[jump].x, 0, -SPAWNS[jump].y);
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
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };

  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("resize", resize);
  document.addEventListener("mousemove", onMouseMove);
  document.addEventListener("pointerlockchange", onLockChange);
  resize();

  const sphere = new THREE.Sphere();
  const closest = new THREE.Vector3();
  const push = new THREE.Vector3();

  /** Push the player out of any wall within PLAYER_RADIUS, horizontally only. */
  function collide() {
    if (!bvh) return;
    const baseY = floor * FLOOR_HEIGHT;
    for (let pass = 0; pass < 3; pass++) {
      sphere.center.set(player.x, baseY + COLLIDER_HEIGHT, player.z);
      sphere.radius = PLAYER_RADIUS;
      let moved = false;
      bvh.shapecast({
        intersectsBounds: (box) => box.intersectsSphere(sphere),
        intersectsTriangle: (tri) => {
          tri.closestPointToPoint(sphere.center, closest);
          push.subVectors(sphere.center, closest);
          push.y = 0;
          const dist = push.length();
          if (dist >= PLAYER_RADIUS || dist < 1e-6) return false;
          push.multiplyScalar((PLAYER_RADIUS - dist) / dist);
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

  let last = performance.now();
  let frame = 0;
  let statusTimer = 0;
  const tick = () => {
    frame = requestAnimationFrame(tick);
    const now = performance.now();
    const dt = Math.min((now - last) / 1000, 0.1);
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

    camera.position.set(player.x, floor * FLOOR_HEIGHT + EYE_HEIGHT, player.z);
    camera.rotation.set(pitch, yaw, 0);
    renderer.render(scene, camera);

    if (++statusTimer >= 10) {
      statusTimer = 1;
      options.onStatus?.({ floor: floor + 1, x: player.x, y: -player.z });
    }
  };
  tick();

  return {
    requestLock() {
      renderer.domElement.requestPointerLock();
    },
    dispose() {
      cancelAnimationFrame(frame);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("resize", resize);
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("pointerlockchange", onLockChange);
      if (document.pointerLockElement === renderer.domElement) document.exitPointerLock();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
