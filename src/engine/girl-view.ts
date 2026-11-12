import * as THREE from "three";
import { FLOOR_HEIGHT } from "./walk";

// How the girl in white looks. The real model (public/models/girl.glb, built by scripts/girl/build.sh: an MPFB child,
// CC0, in a ragged, dirty first communion dress, veil and wreath modeled by script, loose messy hair grown over her in
// her crying pose, with a "cry" clip authored over Quaternius' idle, CC0) is fetched with `load`; until it arrives, or if
// it fails, a stand-in made of a few primitives is drawn. Feet at y = 0, facing local +x.
//
// She is a ghost: a little see-through even when fully there, glowing faintly cold from within and more at her edges,
// with a soft aura round her and a dim cold light on what is near her. All of it breathes slowly and swells with each
// sob, and all of it fades with her (opacity).
//
// See-through without seeing her insides: every mesh is drawn twice. First a depth-only copy, then the colored mesh,
// blended, only where it is the nearest surface (depth test "less or equal" against the copy). So the wall behind her
// shows through, but her far side, her body under the dress and the hair behind her head never do.

export const GIRL_URL = "./models/girl.glb";
/** Sobs per second in the cry clip (scripts/girl/cry.py: 6 in 8 s); the crying sound pulses at the same rate. */
export const GIRL_SOB_HZ = 0.75;
/** How much of her is there when she is fully there: 1 is solid. */
const SPECTRAL = 0.7;
/** Her own cold light: from within (the dress more than her skin and hair) and at her edges (a rim seen edge-on). */
const GLOW = {
  color: new THREE.Color(0.86, 0.9, 1.0),
  dress: 0.13,
  skin: 0.045,
  rimColor: new THREE.Color(0.55, 0.68, 1.0),
  rim: { dress: 0.5, skin: 0.32, hair: 0.1 },
  rimPower: 2.4,
};
/** The soft aura round her (an additive glow behind her, seen round her outline) and the dim light she casts. */
const AURA = { color: new THREE.Color(0.6, 0.72, 1.0), opacity: 0.11, width: 1.3, height: 1.9, centre: 0.7 };
const LIGHT = { color: 0xa9bcff, intensity: 0.45, distance: 3.5, height: 0.8 };

export interface GirlView {
  object: THREE.Object3D;
  /** Her dim cold light. Always in the scene (dimmed to nothing when she is gone, so the shader count never changes). */
  light: THREE.PointLight;
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
  /** `opacity` is how much of her is there; `glow` scales her light (it breathes). */
  setLook(opacity: number, glow: number): void;
  animate(seconds: number): void;
  dispose(): void;
}

/** Her glow breathes slowly and swells a little with each sob: about 0.8 to 1.2. */
function girlGlowPulse(seconds: number): number {
  const sob = Math.max(0, Math.sin(seconds * GIRL_SOB_HZ * 2 * Math.PI)) ** 3;
  return 0.92 + 0.1 * Math.sin(seconds * 0.9) + 0.05 * Math.sin(seconds * 2.3 + 1.3) + 0.12 * sob;
}

export function createGirlView(load?: (url: string) => Promise<GirlGltf>): GirlView {
  const root = new THREE.Group();
  root.visible = false;
  const holder = new THREE.Group(); // the body, swapped when the model arrives
  root.add(holder);
  let current: GirlBody = createStandIn();
  holder.add(current.object);
  const aura = createAura();
  root.add(aura.sprite);
  const light = new THREE.PointLight(LIGHT.color, 0, LIGHT.distance, 2);
  let disposed = false;
  load?.(GIRL_URL)
    .then((gltf) => {
      if (disposed) return;
      const real = createModelBody(gltf);
      holder.remove(current.object);
      current.dispose();
      current = real;
      holder.add(real.object);
    })
    .catch((err) => console.warn("girl model failed to load; using the stand-in", err));
  return {
    object: root,
    light,
    update(x, y, floor, facing, opacity, seconds) {
      root.visible = opacity > 0.003;
      if (!root.visible) {
        light.intensity = 0;
        return;
      }
      const glow = girlGlowPulse(seconds);
      const shimmer = 1 + 0.035 * Math.sin(seconds * 2.1) + 0.025 * Math.sin(seconds * 5.3 + 0.7); // never quite steady
      root.position.set(x, floor * FLOOR_HEIGHT, -y);
      root.rotation.y = facing;
      current.setLook(Math.min(1, opacity * SPECTRAL * shimmer), glow);
      current.animate(seconds);
      aura.set(opacity * glow);
      light.position.set(x, floor * FLOOR_HEIGHT + LIGHT.height, -y);
      light.intensity = LIGHT.intensity * opacity * glow;
    },
    dispose() {
      disposed = true;
      current.dispose();
      aura.dispose();
      light.dispose();
    },
  };
}

/** The aura: a soft oval of cold light, drawn additively behind her (her body hides its middle) and through nothing solid. */
function createAura() {
  const size = 64;
  const data = new Uint8Array(size * size * 4);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const dx = (i + 0.5) / size - 0.5;
      const dy = (j + 0.5) / size - 0.5;
      const r = Math.min(1, Math.sqrt(dx * dx + dy * dy) * 2);
      const a = Math.exp(-r * r * 3.2) * (1 - r * r);
      const k = (j * size + i) * 4;
      data[k] = data[k + 1] = data[k + 2] = 255;
      data[k + 3] = Math.round(a * 255);
    }
  }
  const map = new THREE.DataTexture(data, size, size);
  map.magFilter = map.minFilter = THREE.LinearFilter;
  map.needsUpdate = true;
  const material = new THREE.SpriteMaterial({
    map,
    color: AURA.color,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
    opacity: 0,
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(AURA.width, AURA.height, 1);
  sprite.position.y = AURA.centre;
  sprite.renderOrder = 4; // after her (see createModelBody)
  return {
    sprite,
    set(amount: number) {
      material.opacity = AURA.opacity * amount;
    },
    dispose() {
      map.dispose();
      material.dispose();
    },
  };
}

type RimMaterial = THREE.MeshStandardMaterial & { userData: { base: number; glow: number; rim: { value: number } } };

function createModelBody(gltf: GirlGltf): GirlBody {
  const model = gltf.scene;
  model.rotation.y = Math.PI / 2; // the model faces +z; she faces local +x
  const object = new THREE.Group();
  object.add(model);
  const rimColor = { value: GLOW.rimColor.clone() };
  const mats: RimMaterial[] = [];
  const depthMats = new Map<THREE.Material, THREE.Material>();
  const meshes: THREE.Mesh[] = [];
  model.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
  });
  for (const mesh of meshes) {
    mesh.frustumCulled = false; // skinned: the bind-pose bounds do not follow the animation
    const m = mesh.material as RimMaterial;
    const veil = m.transparent; // the tulle is blended already: drawn last, with no depth copy
    if (!mats.includes(m)) {
      mats.push(m);
      m.userData.base = veil ? m.opacity : 1;
      const body = /skin|hair|eyebrow|eyelash|eyes/.test(m.name);
      m.userData.glow = body ? GLOW.skin : GLOW.dress;
      m.emissive = GLOW.color.clone();
      m.emissiveMap = m.map;
      if (!veil) {
        // the depth copy keeps the cut-outs' own threshold; the colored pass lets hair fray softly below it
        const depth = m.clone();
        depth.colorWrite = false;
        depth.transparent = true; // drawn with the see-through things, after everything solid
        depth.opacity = 1;
        depthMats.set(m, depth);
        if (/hair|eyebrow|eyelash/.test(m.name)) m.alphaTest = 0.12;
      }
      m.transparent = true;
      m.depthWrite = false;
      m.userData.rim = { value: /hair|eyebrow|eyelash/.test(m.name) ? GLOW.rim.hair : body ? GLOW.rim.skin : GLOW.rim.dress };
      m.onBeforeCompile = (shader) => {
        shader.uniforms.uRimColor = rimColor;
        shader.uniforms.uRim = m.userData.rim;
        shader.fragmentShader = shader.fragmentShader
          .replace("#include <common>", "#include <common>\nuniform vec3 uRimColor;\nuniform float uRim;")
          .replace(
            "#include <emissivemap_fragment>",
            `#include <emissivemap_fragment>
            totalEmissiveRadiance += uRimColor * uRim * pow(1.0 - abs(dot(normalize(normal), normalize(vViewPosition))), ${GLOW.rimPower.toFixed(2)});`,
          );
      };
      m.customProgramCacheKey = () => "girl-rim";
      m.needsUpdate = true;
    }
    mesh.renderOrder = veil ? 3 : 2;
    const depthMat = depthMats.get(m);
    if (depthMat && mesh.parent) {
      const copy = mesh.clone(false) as THREE.Mesh; // a skinned copy shares the skeleton, so it moves with her
      copy.material = depthMat;
      copy.renderOrder = 1;
      mesh.parent.add(copy);
    }
  }
  const mixer = new THREE.AnimationMixer(model);
  const cry = gltf.animations.find((a) => a.name === "cry") ?? gltf.animations.find((a) => a.name === "idle");
  if (cry) mixer.clipAction(cry).play();
  let last = -1;
  return {
    object,
    setLook(opacity, glow) {
      for (const m of mats) {
        m.opacity = m.userData.base * opacity;
        m.emissiveIntensity = m.userData.glow * glow;
      }
      rimColor.value.copy(GLOW.rimColor).multiplyScalar(glow);
    },
    animate(seconds) {
      const dt = last < 0 ? 0 : Math.min(0.1, Math.max(0, seconds - last));
      last = seconds;
      mixer.update(dt);
    },
    dispose() {
      mixer.stopAllAction();
      for (const mesh of meshes) mesh.geometry.dispose();
      for (const m of mats) {
        m.map?.dispose();
        m.dispose();
      }
      for (const m of depthMats.values()) m.dispose();
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
  const dress = mat(0xc4cad6, 1);
  const skin = mat(0xaeb4bf, 1);
  const hair = mat(0x07080b, 1);
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
  // the head hangs forward a little; the hair falls loose from the crown, over the shoulders to the waist
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
    setLook(opacity) {
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
