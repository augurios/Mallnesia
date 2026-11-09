import * as THREE from "three";
import { FLOOR_HEIGHT } from "./walk";

// How the guard looks: an ordinary, stocky mall security worker, after the one in
// reference/photos/entrance_concourse-near-entrance.jpg (seen from behind): short dark hair, a black knit vest over a light
// grey short-sleeve shirt, a blue lanyard with an ID card, black trousers, black sneakers, a belt with a radio pouch and a
// key ring. Built from profiled (lathe) shapes with worn procedural fabric textures, no files to download. He holds a
// flashlight out toward whoever he talks to, and carries a small warm light of his own so the player can see him in the dark.
// Feet at y = 0, facing local +x (his right is +z).

/** A tiny deterministic generator, so the cloth wears the same on every run. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Cloth {
  base: string;
  /** Fine woven/knit lines (a color at low alpha): "v" vertical, "h" horizontal. */
  lines?: { color: string; every: number; dir: "v" | "h" };
  /** Creases and wear streaks, how many. */
  creases?: number;
  /** Grime blotches, how many. */
  grime?: number;
  seed: number;
}

/** A small tiling cloth texture: base color, fine lines, noise, creases and grime. */
function cloth(c: Cloth): THREE.CanvasTexture {
  const N = 128;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = N;
  const g = canvas.getContext("2d")!;
  const rand = rng(c.seed);
  g.fillStyle = c.base;
  g.fillRect(0, 0, N, N);
  if (c.lines) {
    g.fillStyle = c.lines.color;
    for (let i = 0; i < N; i += c.lines.every) {
      if (c.lines.dir === "v") g.fillRect(i, 0, 1, N);
      else g.fillRect(0, i, N, 1);
    }
  }
  for (let i = 0; i < 900; i++) {
    g.fillStyle = rand() < 0.5 ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.07)";
    g.fillRect(rand() * N, rand() * N, 1 + rand() * 2, 1);
  }
  g.lineWidth = 1;
  for (let i = 0; i < (c.creases ?? 0); i++) {
    const x = rand() * N;
    const y = rand() * N;
    const len = 14 + rand() * 30;
    const a = rand() * Math.PI;
    g.strokeStyle = rand() < 0.6 ? "rgba(0,0,0,0.22)" : "rgba(255,255,255,0.08)";
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len * 0.5);
    g.stroke();
  }
  for (let i = 0; i < (c.grime ?? 0); i++) {
    const x = rand() * N;
    const y = rand() * N;
    const r = 8 + rand() * 16;
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, "rgba(20,16,10,0.16)");
    grad.addColorStop(1, "rgba(20,16,10,0)");
    g.fillStyle = grad;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** What he is doing, which picks his animation. */
export type GuardPose = "idle" | "walk" | "talk";

export interface GuardView {
  /** Always in the scene (with his light at intensity 0 while he is away, so no shader recompiles when he appears). */
  object: THREE.Object3D;
  /** The warm light of his flashlight. */
  light: THREE.PointLight;
  /** Places and animates him. `facing` is the plan heading; `visible` false hides him and darkens his light. */
  update(x: number, y: number, floor: number, facing: number, visible: boolean, pose: GuardPose, seconds: number): void;
  dispose(): void;
}

/** One way of drawing him: the stand-in built from primitives, or the real model once it has loaded. */
interface GuardBody {
  object: THREE.Object3D;
  /** Where the flashlight's lens is; the light follows it. */
  lens: THREE.Object3D;
  animate(pose: GuardPose, seconds: number): void;
  dispose(): void;
}

export const GUARD_URL = "./models/guard.glb";

/** A loaded glTF, as GLTFLoader returns it (only what is used here). */
export interface GuardGltf {
  scene: THREE.Object3D;
  animations: THREE.AnimationClip[];
}

/**
 * The guard. The real model (public/models/guard.glb: an MPFB character with clips retargeted from Quaternius'
 * Universal Animation Library, both CC0; built by scripts/guard/build.sh) is fetched with `load`; until it arrives, or
 * if it fails, the procedural stand-in below is drawn instead.
 */
export function createGuardView(load?: (url: string) => Promise<GuardGltf>): GuardView {
  const root = new THREE.Group(); // always visible, so the light is always counted
  const holder = new THREE.Group(); // placed and turned each frame
  holder.visible = false;
  root.add(holder);
  const light = new THREE.PointLight(0xffe2b0, 0, 9, 1.6);
  root.add(light);
  let current: GuardBody = createStandIn();
  holder.add(current.object);
  let disposed = false;
  load?.(GUARD_URL)
    .then((gltf) => {
      if (disposed) return;
      const real = createModelBody(gltf);
      holder.remove(current.object);
      current.dispose();
      current = real;
      holder.add(real.object);
    })
    .catch((err) => console.warn("guard model failed to load; using the stand-in", err));
  const lensAt = new THREE.Vector3();
  return {
    object: root,
    light,
    update(x, y, floor, facing, visible, pose, seconds) {
      holder.visible = visible;
      light.intensity = visible ? 6 : 0; // never removed: only dimmed to nothing, so the shader count never changes
      if (!visible) return;
      holder.position.set(x, floor * FLOOR_HEIGHT, -y);
      holder.rotation.y = facing;
      current.animate(pose, seconds);
      holder.updateMatrixWorld(true);
      current.lens.getWorldPosition(lensAt);
      light.position.copy(root.worldToLocal(lensAt));
    },
    dispose() {
      disposed = true;
      current.dispose();
    },
  };
}

/** Bones of the left arm and hand (the one the library's torch clip raises): they always play the flashlight-holding
 * clip, whatever the rest of him does. */
const TORCH_ARM = /^(clavicle|upperarm|lowerarm|hand|thumb|index|middle|ring|pinky)_.*l$/;

function createModelBody(gltf: GuardGltf): GuardBody {
  const model = gltf.scene;
  model.rotation.y = Math.PI / 2; // the model faces +z; he faces local +x like the stand-in
  const object = new THREE.Group();
  object.add(model);
  model.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) o.frustumCulled = false; // skinned: the bind-pose bounds do not follow the animation
  });
  const mixer = new THREE.AnimationMixer(model);
  const clip = (name: string) => gltf.animations.find((a) => a.name === name);
  const boneOf = (track: THREE.KeyframeTrack) => track.name.split(".")[0];
  const without = (c: THREE.AnimationClip) => new THREE.AnimationClip(c.name + "_body", c.duration, c.tracks.filter((t) => !TORCH_ARM.test(boneOf(t))));
  const only = (c: THREE.AnimationClip) => new THREE.AnimationClip(c.name + "_arm", c.duration, c.tracks.filter((t) => TORCH_ARM.test(boneOf(t))));
  const base: Partial<Record<GuardPose, THREE.AnimationAction>> = {};
  for (const [pose, name] of [["idle", "idle"], ["walk", "walk"], ["talk", "talk"]] as const) {
    const c = clip(name);
    if (c) base[pose] = mixer.clipAction(without(c));
  }
  const torch = clip("torch");
  if (torch) mixer.clipAction(only(torch)).play(); // the flashlight arm, always
  let playing: THREE.AnimationAction | null = null;
  let last = -1;

  // the flashlight, in his left fist
  const metal = new THREE.MeshStandardMaterial({ color: 0x8a8d93, roughness: 0.35, metalness: 0.8 });
  const black = new THREE.MeshStandardMaterial({ color: 0x15171b, roughness: 0.4, metalness: 0.6 });
  const glass = new THREE.MeshBasicMaterial({ color: 0xfff2d0 });
  const geos = [new THREE.CylinderGeometry(0.017, 0.016, 0.17, 10), new THREE.CylinderGeometry(0.026, 0.018, 0.05, 12), new THREE.CircleGeometry(0.024, 12)];
  const torchGroup = new THREE.Group();
  const shaft = new THREE.Mesh(geos[0], black);
  const head = new THREE.Mesh(geos[1], metal);
  head.position.y = 0.105;
  const lensMesh = new THREE.Mesh(geos[2], glass);
  lensMesh.rotation.x = -Math.PI / 2;
  lensMesh.position.y = 0.131;
  torchGroup.add(shaft, head, lensMesh);
  const lens = new THREE.Object3D();
  lens.position.y = 0.2;
  torchGroup.add(lens);
  const hand = model.getObjectByName("hand_l");
  (hand ?? model).add(torchGroup);
  torchGroup.position.set(TORCH_IN_HAND.x, TORCH_IN_HAND.y, TORCH_IN_HAND.z);
  // The clip holds its prop upright; the flashlight instead always points ahead of him and a little down, at whoever
  // he faces, so each frame its rotation undoes the hand's.
  const aim = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(Math.cos(TORCH_TILT), Math.sin(TORCH_TILT), 0));
  const handQ = new THREE.Quaternion();
  const bodyQ = new THREE.Quaternion();

  return {
    object,
    lens,
    animate(pose, seconds) {
      const dt = last < 0 ? 0 : Math.min(0.1, Math.max(0, seconds - last));
      last = seconds;
      const next = base[pose] ?? base.idle ?? null;
      if (next && next !== playing) {
        next.reset().play();
        if (playing) next.crossFadeFrom(playing, 0.35, false);
        playing = next;
      }
      mixer.update(dt);
      if (hand) {
        object.updateMatrixWorld(true);
        hand.getWorldQuaternion(handQ);
        object.getWorldQuaternion(bodyQ);
        torchGroup.quaternion.copy(handQ.invert().multiply(bodyQ).multiply(aim));
      }
    },
    dispose() {
      mixer.stopAllAction();
      model.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.geometry.dispose();
        for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
          for (const v of Object.values(m)) if (v instanceof THREE.Texture) v.dispose();
          m.dispose();
        }
      });
      geos.forEach((g) => g.dispose());
      [metal, black, glass].forEach((m) => m.dispose());
    },
  };
}

/** Where the flashlight sits in his left hand, in the hand bone's space (y runs along the fingers): the middle of the
 * fist the torch clip closes, measured from the curled fingers' joints in the built model. */
const TORCH_IN_HAND = { x: -0.025, y: 0.088, z: -0.015 };
/** How far below level the flashlight points (radians). */
const TORCH_TILT = -0.2;

/** The stand-in from primitives (the first look of the guard), drawn until the model has loaded. */
function createStandIn(): GuardBody {
  const textures: THREE.Texture[] = [];
  const tex = (c: Cloth, repeatX: number, repeatY: number) => {
    const t = cloth(c);
    t.repeat.set(repeatX, repeatY);
    textures.push(t);
    return t;
  };
  const std = (color: number, rough = 0.85, map?: THREE.Texture, side: THREE.Side = THREE.FrontSide) =>
    new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0, map: map ?? null, side });

  // Materials. The colors are the real ones in the photo; the maps only add the knit, the creases and the wear.
  const vest = std(0xffffff, 0.95, tex({ base: "#17191e", lines: { color: "rgba(80,86,100,0.35)", every: 3, dir: "v" }, creases: 14, grime: 4, seed: 11 }, 2, 2), THREE.DoubleSide);
  const shirt = std(0xffffff, 0.9, tex({ base: "#8e939c", creases: 18, grime: 5, seed: 23 }, 1.5, 1.5));
  const pants = std(0xffffff, 0.92, tex({ base: "#0e0f12", lines: { color: "rgba(60,64,74,0.3)", every: 4, dir: "h" }, creases: 22, grime: 6, seed: 37 }, 2, 3));
  const skin = std(0xffffff, 0.65, tex({ base: "#a87b5c", creases: 3, grime: 2, seed: 41 }, 1, 1));
  const hair = std(0x14110f, 0.9);
  const shoe = std(0xffffff, 0.8, tex({ base: "#111214", creases: 8, grime: 6, seed: 53 }, 1, 1));
  const sole = std(0x2a2b2e, 0.6);
  const leather = std(0x0b0b0d, 0.5);
  const nylon = std(0x1b1d22, 0.7);
  const metal = new THREE.MeshStandardMaterial({ color: 0x8a8d93, roughness: 0.35, metalness: 0.8 });
  const blue = std(0x1f4aa8, 0.6);
  const card = std(0xe9e6dc, 0.5);
  const body_dark = std(0x08090b, 0.5);
  const black = new THREE.MeshStandardMaterial({ color: 0x15171b, roughness: 0.4, metalness: 0.6 });
  const lensGlow = new THREE.MeshBasicMaterial({ color: 0xfff2d0 });
  const eye = std(0x0a0807, 0.3);

  const geos: THREE.BufferGeometry[] = [];
  const g = <T extends THREE.BufferGeometry>(geo: T) => {
    geos.push(geo);
    return geo;
  };
  const mesh = (geo: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0) => {
    const o = new THREE.Mesh(g(geo), m);
    o.position.set(x, y, z);
    return o;
  };
  /** A lathe body around the y axis, squashed front to back (x is his depth, z his width). */
  const lathe = (pts: [number, number][], m: THREE.Material, depth: number, from = 0, length = Math.PI * 2, segments = 18) => {
    const o = mesh(new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), segments, from, length), m);
    o.scale.set(depth, 1, 1);
    return o;
  };
  /** A rounded blob: a sphere stretched to the given half sizes. */
  const blob = (sx: number, sy: number, sz: number, m: THREE.Material, x = 0, y = 0, z = 0) => {
    const o = mesh(new THREE.SphereGeometry(1, 12, 9), m, x, y, z);
    o.scale.set(sx, sy, sz);
    return o;
  };

  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  // ---- legs: trousers falling over black sneakers, pivoting at the hip -------------------------------------------------
  const legs = [-1, 1].map((side) => {
    const hip = new THREE.Group();
    hip.position.set(0, 0.92, side * 0.105);
    // one tapered leg with a slight break at the knee (two segments), the cuff bunching over the shoe
    hip.add(mesh(new THREE.CylinderGeometry(0.108, 0.088, 0.42, 10), pants, 0, -0.2, 0));
    const shin = mesh(new THREE.CylinderGeometry(0.088, 0.082, 0.42, 10), pants, 0.004, -0.6, 0);
    shin.rotation.z = -0.01;
    hip.add(shin);
    hip.add(mesh(new THREE.CylinderGeometry(0.085, 0.092, 0.05, 10), pants, 0.01, -0.83, 0)); // the cuff
    // sneaker: sole, rounded upper, tongue and a lighter stripe
    hip.add(blob(0.155, 0.026, 0.063, sole, 0.07, -0.89, 0));
    const upper = blob(0.14, 0.06, 0.06, shoe, 0.065, -0.855, 0);
    hip.add(upper);
    hip.add(blob(0.06, 0.035, 0.05, shoe, 0.15, -0.86, 0)); // toe cap
    hip.add(mesh(new THREE.BoxGeometry(0.1, 0.004, 0.012), std(0x44464b, 0.7), 0.08, -0.845, side * 0.06)); // side stripe
    body.add(hip);
    return hip;
  });
  // seat and hips under the vest
  body.add(lathe([[0, 0.78], [0.2, 0.79], [0.235, 0.88], [0.235, 0.96], [0.0, 0.98]], pants, 0.78));

  // ---- belt, key ring and radio pouch -------------------------------------------------------------------------------------
  const belt = lathe([[0.232, 0.915], [0.235, 0.915], [0.235, 0.955], [0.232, 0.955]], leather, 0.78, 0, Math.PI * 2, 20);
  body.add(belt);
  body.add(mesh(new THREE.BoxGeometry(0.012, 0.05, 0.065), metal, 0.186, 0.935, 0)); // buckle
  body.add(mesh(new THREE.BoxGeometry(0.014, 0.034, 0.045), body_dark, 0.188, 0.935, 0));
  const pouch = mesh(new THREE.BoxGeometry(0.06, 0.15, 0.1), nylon, -0.14, 0.86, 0.17); // the radio pouch on the right hip
  pouch.rotation.y = 0.5;
  body.add(pouch);
  const flap = mesh(new THREE.BoxGeometry(0.066, 0.05, 0.106), nylon, -0.14, 0.925, 0.17);
  flap.rotation.y = 0.5;
  body.add(flap);
  const antenna = mesh(new THREE.CylinderGeometry(0.007, 0.006, 0.12, 6), black, -0.16, 0.99, 0.19);
  body.add(antenna);
  // keys on a ring at the left hip
  const ring = mesh(new THREE.TorusGeometry(0.03, 0.004, 6, 14), metal, 0.02, 0.88, -0.226);
  ring.rotation.y = Math.PI / 2;
  body.add(ring);
  for (let i = 0; i < 3; i++) {
    const key = mesh(new THREE.BoxGeometry(0.012, 0.055, 0.016), metal, 0.02, 0.83 - i * 0.004, -0.232 + i * 0.012);
    key.rotation.x = (i - 1) * 0.25;
    body.add(key);
  }

  // ---- torso: the grey shirt, a little heavy at the belly, and the black vest over it ------------------------------
  body.add(lathe([[0.0, 0.9], [0.21, 0.92], [0.24, 1.05], [0.24, 1.2], [0.25, 1.38], [0.23, 1.47], [0.16, 1.535], [0.085, 1.575], [0, 1.585]], shirt, 0.78, 0, Math.PI * 2, 20));
  // the vest: open at the front in a V, hanging past the belt, with a slightly wider hem; front is phi = pi / 2
  const gap = 0.4;
  body.add(lathe([[0.262, 0.86], [0.27, 1.0], [0.268, 1.2], [0.266, 1.38], [0.244, 1.47], [0.175, 1.54], [0.1, 1.572]], vest, 0.78, Math.PI / 2 + gap, Math.PI * 2 - gap * 2, 22));
  // shirt buttons and collar in the opening
  for (let i = 0; i < 4; i++) body.add(blob(0.005, 0.009, 0.009, std(0x70747c, 0.4), 0.187 + i * 0.001, 1.12 + i * 0.1, 0));
  const collar = mesh(new THREE.TorusGeometry(0.062, 0.016, 6, 16), shirt, 0, 1.585, 0);
  collar.rotation.x = Math.PI / 2;
  collar.scale.set(0.9, 1, 1);
  body.add(collar);
  // vest pocket (the one by the hip in the photo)
  body.add(mesh(new THREE.BoxGeometry(0.012, 0.075, 0.1), vest, 0.15, 1.05, 0.15));
  // lanyard and ID card
  for (const s of [-1, 1]) {
    const path = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-0.035, 1.605, s * 0.075),
      new THREE.Vector3(0.03, 1.598, s * 0.08),
      new THREE.Vector3(0.1, 1.56, s * 0.07),
      new THREE.Vector3(0.195, 1.43, s * 0.04),
      new THREE.Vector3(0.208, 1.3, s * 0.012),
      new THREE.Vector3(0.209, 1.24, 0),
    ]);
    body.add(mesh(new THREE.TubeGeometry(path, 14, 0.0065, 5), blue));
  }
  body.add(mesh(new THREE.BoxGeometry(0.006, 0.085, 0.056), card, 0.212, 1.195, 0));
  body.add(mesh(new THREE.BoxGeometry(0.007, 0.022, 0.056), blue, 0.213, 1.226, 0));
  body.add(mesh(new THREE.BoxGeometry(0.007, 0.03, 0.024), std(0x8a8472, 0.6), 0.213, 1.185, 0)); // the photo
  // shoulder radio on a clip at the left
  body.add(mesh(new THREE.BoxGeometry(0.05, 0.1, 0.035), black, 0.07, 1.4, -0.215));

  // ---- neck and head ----------------------------------------------------------------------------------------------------------
  body.add(mesh(new THREE.CylinderGeometry(0.057, 0.064, 0.09, 10), skin, 0.005, 1.6, 0));
  const head = new THREE.Group();
  head.position.set(0.01, 1.7, 0);
  head.add(blob(0.108, 0.13, 0.098, skin)); // skull and face
  head.add(blob(0.07, 0.055, 0.084, skin, 0.022, -0.07, 0)); // heavy jaw
  const cap = mesh(new THREE.SphereGeometry(1, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.5), hair); // short dark hair
  cap.scale.set(0.116, 0.14, 0.106);
  cap.position.set(-0.022, 0.022, 0);
  cap.rotation.z = 0.12; // tipped back, so the forehead shows
  head.add(cap);
  for (const s of [-1, 1]) {
    head.add(blob(0.016, 0.03, 0.012, skin, -0.005, -0.01, s * 0.1)); // ears
    head.add(blob(0.012, 0.012, 0.011, eye, 0.095, 0.022, s * 0.042)); // eyes
    head.add(mesh(new THREE.BoxGeometry(0.01, 0.007, 0.04), hair, 0.098, 0.048, s * 0.042)); // brows
  }
  const nose = mesh(new THREE.ConeGeometry(0.017, 0.045, 6), skin, 0.112, -0.01, 0);
  nose.rotation.z = -Math.PI / 2;
  head.add(nose);
  head.add(mesh(new THREE.BoxGeometry(0.006, 0.006, 0.05), std(0x4a2f27, 0.6), 0.097, -0.062, 0)); // mouth
  body.add(head);

  // ---- arms: grey short sleeve, bare forearm, hand. The right one holds the flashlight out toward whoever he talks to. ---
  const arm = (side: number) => {
    const shoulder = new THREE.Group();
    shoulder.position.set(0.0, 1.46, side * 0.262);
    shoulder.add(blob(0.075, 0.07, 0.075, shirt, 0, 0.01, 0)); // the round of the shoulder
    shoulder.add(mesh(new THREE.CylinderGeometry(0.068, 0.066, 0.17, 10), shirt, 0, -0.09, 0)); // sleeve
    const hem = mesh(new THREE.TorusGeometry(0.066, 0.008, 5, 12), shirt, 0, -0.175, 0); // the turned-up sleeve hem
    hem.rotation.x = Math.PI / 2;
    shoulder.add(hem);
    shoulder.add(mesh(new THREE.CylinderGeometry(0.056, 0.05, 0.12, 9), skin, 0, -0.23, 0)); // upper arm
    const elbow = new THREE.Group();
    elbow.position.set(0, -0.29, 0);
    elbow.add(blob(0.052, 0.05, 0.05, skin, 0, 0, 0));
    elbow.add(mesh(new THREE.CylinderGeometry(0.05, 0.038, 0.26, 9), skin, 0, -0.14, 0)); // forearm
    const hand = blob(0.036, 0.055, 0.03, skin, 0, -0.3, 0);
    elbow.add(hand);
    shoulder.add(elbow);
    body.add(shoulder);
    return { shoulder, elbow, hand };
  };
  const left = arm(-1);
  const right = arm(1);
  left.shoulder.rotation.z = 0.08;
  left.elbow.rotation.z = 0.28;
  // the flashlight: gripped in the right fist, pointing along the forearm, which comes forward and up
  right.shoulder.rotation.z = 0.35;
  right.elbow.rotation.z = 1.05;
  const torch = new THREE.Group();
  torch.add(mesh(new THREE.CylinderGeometry(0.028, 0.026, 0.19, 10), black, 0, -0.34, 0)); // the body of it
  torch.add(mesh(new THREE.CylinderGeometry(0.042, 0.03, 0.06, 12), metal, 0, -0.46, 0)); // the head
  const torchLens = mesh(new THREE.CircleGeometry(0.039, 12), lensGlow, 0, -0.493, 0);
  torchLens.rotation.x = Math.PI / 2;
  torch.add(torchLens);
  right.elbow.add(torch);

  const lens = new THREE.Object3D();
  lens.position.set(0, -0.62, 0);
  right.elbow.add(lens);

  return {
    object: root,
    lens,
    animate(pose, seconds) {
      const walking = pose === "walk";
      const swing = walking ? Math.sin(seconds * 5.5) * 0.4 : 0;
      legs[0].rotation.z = swing;
      legs[1].rotation.z = -swing;
      left.shoulder.rotation.z = walking ? 0.08 - swing * 0.9 : 0.08 + 0.02 * Math.sin(seconds * 0.9);
      right.shoulder.rotation.z = 0.35 + (walking ? swing * 0.25 : 0.015 * Math.sin(seconds * 1.3));
      body.position.y = walking ? Math.abs(Math.sin(seconds * 5.5)) * 0.018 : Math.sin(seconds * 1.1) * 0.003;
      head.rotation.y = walking ? 0 : 0.06 * Math.sin(seconds * 0.5); // he looks about a little while he talks
    },
    dispose() {
      geos.forEach((geo) => geo.dispose());
      textures.forEach((t) => t.dispose());
      [vest, shirt, pants, skin, hair, shoe, sole, leather, nylon, metal, blue, card, body_dark, black, lensGlow, eye].forEach((m) => m.dispose());
    },
  };
}
