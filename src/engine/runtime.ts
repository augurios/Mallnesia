import * as THREE from "three";

export interface RuntimeOptions {
  onLockChange?: (locked: boolean) => void;
}

export interface Runtime {
  requestLock(): void;
  dispose(): void;
}

const EYE_HEIGHT = 1.65;
const WALK_SPEED = 3.2;
const LOOK_SPEED = 0.0022;

/** First-person test scene: flat floor, a few blocks, keyboard + mouse look. No React in here. */
export function createRuntime(root: HTMLElement, options: RuntimeOptions = {}): Runtime {
  const renderer = new THREE.WebGLRenderer({ antialias: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  root.prepend(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x050507);
  scene.fog = new THREE.Fog(0x050507, 4, 40);

  const camera = new THREE.PerspectiveCamera(70, 1, 0.05, 200);
  camera.rotation.order = "YXZ";
  camera.position.set(0, EYE_HEIGHT, 0);

  scene.add(new THREE.AmbientLight(0x404858, 0.8));
  const torch = new THREE.SpotLight(0xfff2d0, 40, 30, Math.PI / 6, 0.4);
  torch.position.set(0, 0, 0);
  torch.target.position.set(0, 0, -1);
  camera.add(torch, torch.target);
  scene.add(camera);

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(100, 100),
    new THREE.MeshStandardMaterial({ color: 0x6a6a72, roughness: 0.9 }),
  );
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);

  const blockMaterial = new THREE.MeshStandardMaterial({ color: 0x8a8a92, roughness: 0.8 });
  for (let i = 0; i < 12; i++) {
    const block = new THREE.Mesh(new THREE.BoxGeometry(2, 3.5, 2), blockMaterial);
    block.position.set((i % 4) * 8 - 12, 1.75, -8 - Math.floor(i / 4) * 8);
    scene.add(block);
  }

  const keys = new Set<string>();
  let yaw = 0;
  let pitch = 0;
  let locked = false;

  const onKeyDown = (e: KeyboardEvent) => keys.add(e.code);
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

  let last = performance.now();
  let frame = 0;
  const tick = () => {
    frame = requestAnimationFrame(tick);
    const now = performance.now();
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    const forward = (keys.has("KeyW") ? 1 : 0) - (keys.has("KeyS") ? 1 : 0);
    const strafe = (keys.has("KeyD") ? 1 : 0) - (keys.has("KeyA") ? 1 : 0);
    if (forward || strafe) {
      const len = Math.hypot(forward, strafe);
      const speed = (WALK_SPEED * dt) / len;
      camera.position.x += (-Math.sin(yaw) * forward + Math.cos(yaw) * strafe) * speed;
      camera.position.z += (-Math.cos(yaw) * forward - Math.sin(yaw) * strafe) * speed;
    }
    camera.rotation.set(pitch, yaw, 0);
    renderer.render(scene, camera);
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
