import * as THREE from "three";
import { FLOOR_HEIGHT } from "./walk";

// How the girl in white looks. The real model (public/models/girl.glb, built by scripts/girl/build.sh: an MPFB child,
// CC0, in a first communion dress, veil and wreath modeled by script, with a "cry" clip authored over Quaternius' idle,
// CC0) is fetched with `load`; until it arrives, or if it fails, a stand-in made of a few primitives is drawn. Either
// way she fades in and out (opacity), and gives off a faint cold glow of her own, so the girl in white is a pale shape
// in the dark even with the flashlight off. Feet at y = 0, facing local +x.

export const GIRL_URL = "./models/girl.glb";
/** Sobs per second in the cry clip (scripts/girl/cry.py: 6 in 8 s); the crying sound pulses at the same rate. */
export const GIRL_SOB_HZ = 0.75;
/** How much of her own color she gives off: the dress more than her skin and hair. */
const GLOW = { dress: 0.11, skin: 0.035 };

export interface GirlView {
  object: THREE.Object3D;
  /** Places her and sets how much of her is there (0 hides her). `facing` is the plan heading. */
  update(x: number, y: number, floor: number, facing: number, opacity: number, seconds: number): void;
  dispose(): void;
}

/** A loaded glTF, as GLTFLoader returns it (only what is used here). */
export interface GirlGltf {
  scene: THREE.Object3D;
  animations: THREE.AnimationClip[];
}

/** One way of drawing her: the stand-in or the real model. */
interface GirlBody {
  object: THREE.Object3D;
  setOpacity(opacity: number): void;
  animate(seconds: number): void;
  dispose(): void;
}

export function createGirlView(load?: (url: string) => Promise<GirlGltf>): GirlView {
  const root = new THREE.Group();
  root.visible = false;
  let current: GirlBody = createStandIn();
  root.add(current.object);
  let disposed = false;
  load?.(GIRL_URL)
    .then((gltf) => {
      if (disposed) return;
      const real = createModelBody(gltf);
      root.remove(current.object);
      current.dispose();
      current = real;
      root.add(real.object);
    })
    .catch((err) => console.warn("girl model failed to load; using the stand-in", err));
  return {
    object: root,
    update(x, y, floor, facing, opacity, seconds) {
      root.visible = opacity > 0.003;
      if (!root.visible) return;
      root.position.set(x, floor * FLOOR_HEIGHT, -y);
      root.rotation.y = facing;
      current.setOpacity(opacity);
      current.animate(seconds);
    },
    dispose() {
      disposed = true;
      current.dispose();
    },
  };
}

function createModelBody(gltf: GirlGltf): GirlBody {
  const model = gltf.scene;
  model.rotation.y = Math.PI / 2; // the model faces +z; she faces local +x
  const object = new THREE.Group();
  object.add(model);
  const mats: THREE.MeshStandardMaterial[] = [];
  model.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.frustumCulled = false; // skinned: the bind-pose bounds do not follow the animation
    for (const m of (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) as THREE.MeshStandardMaterial[]) {
      if (mats.includes(m)) continue;
      mats.push(m);
      m.userData.base = m.transparent ? m.opacity : 1;
      // Opaque and cut-out materials fade by dithering (no sorting trouble); the tulle veil is blended as it is.
      if (!m.transparent) m.alphaHash = true;
      else m.depthWrite = false;
      const body = /skin|braid|eyebrow|eyelash|eyes/.test(m.name);
      m.emissive = new THREE.Color(0.86, 0.9, 1.0).multiplyScalar(body ? GLOW.skin : GLOW.dress);
      m.emissiveMap = m.map;
      m.needsUpdate = true;
    }
  });
  const mixer = new THREE.AnimationMixer(model);
  const cry = gltf.animations.find((a) => a.name === "cry") ?? gltf.animations.find((a) => a.name === "idle");
  if (cry) mixer.clipAction(cry).play();
  let last = -1;
  return {
    object,
    setOpacity(opacity) {
      for (const m of mats) m.opacity = (m.userData.base as number) * opacity;
    },
    animate(seconds) {
      const dt = last < 0 ? 0 : Math.min(0.1, Math.max(0, seconds - last));
      last = seconds;
      mixer.update(dt);
    },
    dispose() {
      mixer.stopAllAction();
      model.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh) mesh.geometry.dispose();
      });
      for (const m of mats) {
        m.map?.dispose();
        m.dispose();
      }
    },
  };
}

/** The stand-in: a child-sized figure (about 1.3 m) in a long pale dress, head a little bowed, arms hanging. */
function createStandIn(): GirlBody {
  const mats: THREE.MeshBasicMaterial[] = [];
  const mat = (color: number, base: number) => {
    const m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, depthWrite: false });
    m.userData.base = base;
    mats.push(m);
    return m;
  };
  const dress = mat(0xc4cad6, 0.85);
  const skin = mat(0xaeb4bf, 0.85);
  const hair = mat(0x07080b, 0.95);
  const geos: THREE.BufferGeometry[] = [];
  const g = <T extends THREE.BufferGeometry>(geo: T) => {
    geos.push(geo);
    return geo;
  };
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  const profile = [
    [0.01, 0.02],
    [0.26, 0.03],
    [0.27, 0.12],
    [0.2, 0.5],
    [0.1, 0.78],
    [0.11, 0.98],
    [0.12, 1.05],
    [0.05, 1.12],
    [0.0, 1.13],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const gown = new THREE.Mesh(g(new THREE.LatheGeometry(profile, 14)), dress);
  gown.scale.set(0.8, 1, 1);
  body.add(gown);
  // the head hangs forward a little; the hair falls from the crown down the back to the waist
  const head = new THREE.Mesh(g(new THREE.SphereGeometry(0.1, 12, 10)), skin);
  head.scale.set(0.92, 1.1, 0.92);
  head.position.set(0.05, 1.22, 0);
  body.add(head);
  const hairBack = new THREE.Mesh(g(new THREE.ConeGeometry(0.13, 0.62, 10, 1, true)), hair);
  hairBack.position.set(-0.03, 1.0, 0);
  hairBack.scale.set(0.9, 1, 1);
  hairBack.material.side = THREE.DoubleSide;
  body.add(hairBack);
  const fringe = new THREE.Mesh(g(new THREE.SphereGeometry(0.108, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55)), hair);
  fringe.scale.set(0.95, 1.12, 0.95);
  fringe.position.set(0.045, 1.235, 0);
  body.add(fringe);
  const armGeo = g(new THREE.CylinderGeometry(0.025, 0.02, 0.5, 6));
  for (const side of [-1, 1]) {
    const arm = new THREE.Mesh(armGeo, skin);
    arm.position.set(0.01, 0.82, side * 0.13);
    body.add(arm);
  }

  return {
    object: root,
    setOpacity(opacity) {
      for (const m of mats) m.opacity = opacity * (m.userData.base as number);
    },
    animate(seconds) {
      body.rotation.z = 0.04 * Math.sin(seconds * 0.7); // never quite still
    },
    dispose() {
      geos.forEach((geo) => geo.dispose());
      mats.forEach((m) => m.dispose());
    },
  };
}
