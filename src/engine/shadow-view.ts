import * as THREE from "three";
import type { Shadow } from "./shadow";
import { FLOOR_HEIGHT } from "./walk";

// How the shadow looks: not a body but a column of dark fog that only vaguely holds the shape of a man (about 2 m tall,
// hunched, a head on a thin neck, long arms hanging past the knees). There is no surface: a box around it is raymarched
// in the shader through a density field, a soft silhouette made of capsules that is bent and eaten away by drifting 3D
// noise, so it billows, frays at every edge, sheds wisps upward and thins out before it reaches the floor, where a little
// of it pools. The fog only absorbs: in the flashlight it is a smoky black hole in the lit wall behind it, and in the
// dark a faint cold glow at its thin edges is all that gives it away. Nothing to download: the noise is a small 3D
// texture made at startup. All of it is placeholder shape and tuning for Augusto to judge by playing.

/** The box the fog lives in, in local space (feet at y = 0, facing +x). Kept tight so it rarely crosses a wall. */
const BOX_MIN = new THREE.Vector3(-0.7, 0, -0.75);
const BOX_MAX = new THREE.Vector3(1.05, 2.55, 0.75);
const SHOULDER_Y = 1.48;
const SHOULDER_Z = 0.26;

/** A tileable, smooth 3D noise texture: four independent channels (one for density, three for the warp). Random
 *  values blurred twice with a wrapping box blur, then stretched back to full contrast, so it reads as soft smoke and
 *  not as blocks. */
function makeNoise(size = 32) {
  const n = size * size * size;
  let seed = 1234567;
  const rand = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  let a = new Float32Array(n * 4).map(rand);
  let b = new Float32Array(n * 4);
  const idx = (x: number, y: number, z: number) => (((z + size) % size) * size * size + ((y + size) % size) * size + ((x + size) % size)) * 4;
  for (let pass = 0; pass < 2; pass++) {
    for (const axis of [0, 1, 2]) {
      for (let z = 0; z < size; z++)
        for (let y = 0; y < size; y++)
          for (let x = 0; x < size; x++) {
            const o = idx(x, y, z);
            const d = [axis === 0 ? 1 : 0, axis === 1 ? 1 : 0, axis === 2 ? 1 : 0];
            for (let c = 0; c < 4; c++) {
              let sum = 0;
              for (let k = -1; k <= 1; k++) sum += a[idx(x + d[0] * k, y + d[1] * k, z + d[2] * k) + c];
              b[o + c] = sum / 3;
            }
          }
      [a, b] = [b, a];
    }
  }
  const data = new Uint8Array(n * 4);
  for (let c = 0; c < 4; c++) {
    let lo = 1, hi = 0;
    for (let i = c; i < a.length; i += 4) { lo = Math.min(lo, a[i]); hi = Math.max(hi, a[i]); }
    for (let i = c; i < a.length; i += 4) data[i] = Math.round(((a[i] - lo) / (hi - lo)) * 255);
  }
  const tex = new THREE.Data3DTexture(data, size, size, size);
  tex.format = THREE.RGBAFormat;
  tex.minFilter = tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = tex.wrapR = THREE.RepeatWrapping;
  tex.unpackAlignment = 1;
  tex.needsUpdate = true;
  return tex;
}

const vertexShader = /* glsl */ `
  varying vec3 vPos;
  void main() {
    vPos = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const SY = SHOULDER_Y.toFixed(2);
const SZ = SHOULDER_Z.toFixed(2);

const fragmentShader = /* glsl */ `
  precision highp sampler3D;
  uniform sampler3D uNoise;
  uniform vec3 uCam;      // camera in local space
  uniform vec3 uBoxMin;
  uniform vec3 uBoxMax;
  uniform vec3 uHandL;    // hands, local space (the arms are capsules from the shoulders to these)
  uniform vec3 uHandR;
  uniform float uTime;
  uniform float uFade;
  uniform float uRim;
  uniform float uChurn;   // how fast and hard it billows (more when hunting)
  varying vec3 vPos;

  const int STEPS = 44;
  const float SIGMA = 10.0; // absorption per meter at full density: the core is opaque, the edges a haze

  float hash(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }

  float sdCapsule(vec3 p, vec3 a, vec3 b, float ra, float rb) {
    vec3 pa = p - a, ba = b - a;
    float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
    return length(pa - ba * h) - mix(ra, rb, h);
  }
  float smin(float a, float b, float k) { float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0); return mix(b, a, h) - k * h * (1.0 - h); }

  // The vague man: no legs, a robe of fog from the chest down, shoulders that slope away from a thin neck.
  float figure(vec3 p) {
    float d = length((p - vec3(0.11, 1.86, 0.0)) * vec3(1.0, 0.8, 1.05)) - 0.12;                  // head, hung forward
    d = smin(d, sdCapsule(p, vec3(0.08, 1.74, 0.0), vec3(0.03, 1.55, 0.0), 0.05, 0.08), 0.08);  // neck
    d = smin(d, sdCapsule(p, vec3(0.03, 1.56, 0.0), vec3(0.03, ${SY}, -${SZ}), 0.1, 0.07), 0.1); // shoulders, sloping
    d = smin(d, sdCapsule(p, vec3(0.03, 1.56, 0.0), vec3(0.03, ${SY}, ${SZ}), 0.1, 0.07), 0.1);
    d = smin(d, sdCapsule(p, vec3(0.02, 1.42, 0.0), vec3(-0.04, 0.95, 0.0), 0.17, 0.13), 0.12);   // chest
    d = smin(d, sdCapsule(p, vec3(-0.04, 0.95, 0.0), vec3(-0.1, 0.25, 0.0), 0.13, 0.24), 0.12);   // robe, widening
    d = smin(d, sdCapsule(p, vec3(0.03, ${SY}, -${SZ}), uHandL, 0.06, 0.03), 0.05);            // arms
    d = smin(d, sdCapsule(p, vec3(0.03, ${SY}, ${SZ}), uHandR, 0.06, 0.03), 0.05);
    return d;
  }

  float density(vec3 p, out float edge) {
    edge = 0.0;
    float t = uTime * uChurn;
    // The smoke rises: noise drifts up through the figure, stretched upright so it streaks.
    vec3 drift = vec3(0.07 * t, -0.32 * t, 0.05 * t);
    vec3 w = texture(uNoise, p * vec3(0.55, 0.32, 0.55) + drift * 0.6).gba - 0.5;
    float low = 1.0 - smoothstep(0.3, 1.5, p.y);
    vec3 q = p + w * (0.12 + 0.34 * low);                     // the outline never sits still, loosest low down
    float sdf = figure(q);
    // The same figure lifted a little: what has already risen off the head and shoulders.
    float rise = figure(q - vec3(0.0, 0.3 + 0.4 * w.y, 0.0)) + 0.05;
    float near = min(sdf, mix(1.0, rise, smoothstep(1.3, 1.9, p.y)));
    // A little of it pools on the floor around where it stands.
    float pool = (1.0 - smoothstep(0.0, 0.18, p.y)) * (1.0 - smoothstep(0.2, 0.8, length(p.xz - vec2(-0.08, 0.0))));
    if (near > 0.55 && pool <= 0.0) return 0.0;               // empty space: skip the noise
    vec3 s = p * vec3(1.1, 0.7, 1.1) + drift;
    // Three scales: big slow patches that thin and thicken whole parts of it, billows, and fine wisps; then stretched
    // back to full contrast, so the fog has real holes and folds in it.
    float n = texture(uNoise, p * vec3(0.4, 0.25, 0.4) + drift * 0.5).r * 0.4
            + texture(uNoise, s).r * 0.35 + texture(uNoise, s * 2.7 + 0.37).r * 0.25;
    n = smoothstep(0.32, 0.68, n);
    float body = smoothstep(0.22, -0.14, sdf);               // soft from far out to deep in
    edge = 1.0 - smoothstep(0.0, 0.6, body);
    // The body is fog of uneven thickness: dense knots and thin patches drift through it; only deep inside is it black.
    float d = body * smoothstep(0.1, 0.65, n + body * 0.45);
    // A haze around it and above it, so there is no clean outline anywhere.
    float halo = 1.0 - smoothstep(-0.05, 0.4, near);
    d += halo * smoothstep(0.4, 0.95, n) * 0.3;
    d *= smoothstep(0.05, 0.75, p.y);                        // thins out before the floor
    d += pool * n * n * 0.35;
    // Never let the box show: everything thins to nothing before its walls.
    vec3 wall = min(p - uBoxMin, uBoxMax - p);
    d *= smoothstep(0.0, 0.2, min(min(wall.x, wall.z), uBoxMax.y - p.y));
    // Fading in or out eats it from the edges inward, then the core.
    d = clamp(d - (1.0 - uFade) * 0.9, 0.0, 1.0) * uFade;
    return d;
  }

  void main() {
    vec3 ro = uCam;
    vec3 rd = normalize(vPos - uCam);
    vec3 inv = 1.0 / rd;
    vec3 t0 = (uBoxMin - ro) * inv, t1 = (uBoxMax - ro) * inv;
    vec3 tlo = min(t0, t1), thi = max(t0, t1);
    float tmin = max(max(max(tlo.x, tlo.y), tlo.z), 0.05);
    float tmax = min(min(thi.x, thi.y), thi.z);
    if (tmax <= tmin) discard;
    float dt = (tmax - tmin) / float(STEPS);
    float t = tmin + dt * hash(gl_FragCoord.xy + fract(uTime) * 61.0); // jittered start hides the step bands
    float T = 1.0; // how much of what is behind still shows through
    vec3 col = vec3(0.0);
    for (int i = 0; i < STEPS; i++) {
      float edge;
      float d = density(ro + rd * t, edge);
      if (d > 0.001) {
        float a = 1.0 - exp(-d * SIGMA * dt);
        vec3 c = vec3(0.003, 0.004, 0.006) + edge * uRim * vec3(0.05, 0.07, 0.11);
        col += T * a * c;
        T *= 1.0 - a;
        if (T < 0.02) break;
      }
      t += dt;
    }
    if (T > 0.995) discard;
    gl_FragColor = vec4(col, 1.0 - T); // premultiplied
  }
`;

export interface ShadowView {
  object: THREE.Object3D;
  /** Once per frame, with the camera it will be drawn from. */
  update(shadow: Shadow, seconds: number, camera: THREE.Camera): void;
  dispose(): void;
}

export function createShadowView(): ShadowView {
  const noise = makeNoise();
  const uniforms = {
    uNoise: { value: noise },
    uCam: { value: new THREE.Vector3() },
    uBoxMin: { value: BOX_MIN },
    uBoxMax: { value: BOX_MAX },
    uHandL: { value: new THREE.Vector3() },
    uHandR: { value: new THREE.Vector3() },
    uTime: { value: 0 },
    uFade: { value: 1 },
    uRim: { value: 0.5 },
    uChurn: { value: 1 },
  };
  const make = (side: THREE.Side) =>
    new THREE.ShaderMaterial({
      uniforms,
      vertexShader,
      fragmentShader,
      side,
      transparent: true,
      depthWrite: false,
      premultipliedAlpha: true,
    });
  // Outside the box it draws the front faces (so a wall right behind it doesn't hide it); once the camera is inside
  // (it has caught the player) it switches to the back faces. The switch happens in update(): by the time the mesh's
  // onBeforeRender runs, the material for that draw is already chosen.
  const front = make(THREE.FrontSide);
  const back = make(THREE.BackSide);

  const size = BOX_MAX.clone().sub(BOX_MIN);
  const box = new THREE.BoxGeometry(size.x, size.y, size.z);
  box.translate((BOX_MIN.x + BOX_MAX.x) / 2, (BOX_MIN.y + BOX_MAX.y) / 2, (BOX_MIN.z + BOX_MAX.z) / 2);
  const mesh = new THREE.Mesh(box, front);
  mesh.renderOrder = 10; // after the other see-through things, so it darkens them too
  const toLocal = (camera: THREE.Camera, out: THREE.Vector3) => mesh.worldToLocal(camera.getWorldPosition(out));
  // The ray origin is taken right before the draw, so it matches the camera exactly even if it moved after update().
  mesh.onBeforeRender = (_r, _s, camera) => void toLocal(camera, uniforms.uCam.value);
  const local = new THREE.Vector3();

  const root = new THREE.Group();
  root.add(mesh);
  root.visible = false;

  return {
    object: root,
    update(shadow, seconds, camera) {
      const show = shadow.state !== "absent" && shadow.fade > 0.001;
      root.visible = show;
      if (!show) return;
      root.position.set(shadow.x, shadow.floor * FLOOR_HEIGHT, -shadow.y);
      root.rotation.y = shadow.facing; // plan heading: +x local maps to (cos a, 0, -sin a) in the scene
      const hunting = shadow.state === "hunting";
      // The arms hang past the knees and drift; a hunt lifts them forward, reaching.
      [uniforms.uHandL.value, uniforms.uHandR.value].forEach((hand, i) => {
        const side = i === 0 ? -1 : 1;
        const sway = Math.sin(seconds * 0.6 + i * 2.1);
        if (hunting) hand.set(0.8 + 0.05 * sway, 1.12 + 0.06 * Math.sin(seconds * 1.7 + i), side * (0.34 + 0.04 * sway));
        else hand.set(0.12 + 0.07 * sway, 0.32 + 0.04 * Math.sin(seconds * 0.9 + i), side * (SHOULDER_Z + 0.17 + 0.03 * sway));
      });
      root.rotation.z = hunting ? -0.12 : -0.03; // leans into the chase
      root.updateMatrixWorld();
      toLocal(camera, local);
      const m = 0.3; // margin: the near plane, and a frame of movement
      const inside =
        local.x > BOX_MIN.x - m && local.x < BOX_MAX.x + m &&
        local.y > BOX_MIN.y - m && local.y < BOX_MAX.y + m &&
        local.z > BOX_MIN.z - m && local.z < BOX_MAX.z + m;
      mesh.material = inside ? back : front;
      uniforms.uTime.value = seconds;
      uniforms.uFade.value = shadow.fade;
      uniforms.uChurn.value = hunting ? 1.8 : 1;
      uniforms.uRim.value = hunting ? 0.9 : shadow.state === "investigating" ? 0.65 : 0.45;
    },
    dispose() {
      box.dispose();
      front.dispose();
      back.dispose();
      noise.dispose();
    },
  };
}
