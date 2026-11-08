import * as THREE from "three";
import type { Shadow } from "./shadow";
import { FLOOR_HEIGHT, type WallHit } from "./walk";

// How the shadow looks: dark fog in the shape of something that was once a man and isn't anymore. Gaunt and too tall
// (about 2.2 m), with high, bony shoulders and the head hung low and forward between them like a predator's; a V of a
// torso pinched to a thin waist; arms far too long, elbows out, ending in long splayed claws; and no legs, only torn
// tendrils that stream below the waist and end in points. The narrow skull sits cocked to one side and every few
// seconds snaps to a new angle; while hunting it straightens and stares, and the claws come up, reaching.
//
// There is no surface: a box around it is raymarched in the shader through a density field built from tapered
// capsules, cut sharply so the silhouette stays angular, then torn by vertical streaks of drifting noise, so its edges
// are ink in water, not puffs. Smoke rises off the head and shoulders like flame. The fog only absorbs: in the
// flashlight it is a black hole in the lit wall behind it, and in the dark a faint cold glow at its thin edges is all
// that gives it away. Nothing to download: the noise is a small 3D texture made at startup. All of it is placeholder
// shape and tuning for Augusto to judge by playing.

/** The box the fog lives in, in local space (feet at y = 0, facing +x). Kept tight so it rarely crosses a wall. */
const BOX_MIN = new THREE.Vector3(-1.05, 0, -1.2);
const BOX_MAX = new THREE.Vector3(1.75, 2.95, 1.2);
/** Shoulder tips (z is the side), high and wide. */
const SHOULDER = new THREE.Vector3(0.0, 1.86, 0.3);
const NECK_BASE = new THREE.Vector3(0.03, 1.8, 0);
/** Walls near it cut the fog off at their face, so it never shows through or on the far side of one. Found by
 *  casting this many rays around it, out to the farthest corner of the box. */
const CLIP_RAYS = 8;
const CLIP_REACH = 2.3;
const CLIP_HEIGHT = 1.2; // the rays go out at chest height

/** Finds the nearest full-height wall along a ray (Walk.castWall). */
export type CastWall = (origin: THREE.Vector3, dir: THREE.Vector3, far: number) => WallHit | null;

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

const v3 = (v: THREE.Vector3) => `vec3(${v.x.toFixed(3)}, ${v.y.toFixed(3)}, ${v.z.toFixed(3)})`;
const SL = v3(new THREE.Vector3(SHOULDER.x, SHOULDER.y, -SHOULDER.z));
const SR = v3(SHOULDER);
const NB = v3(NECK_BASE);

const fragmentShader = /* glsl */ `
  precision highp sampler3D;
  uniform sampler3D uNoise;
  uniform vec3 uCam;      // camera in local space
  uniform mat4 uMV;       // local to view, and view to clip: to give each pixel the depth of the fog it shows
  uniform mat4 uProj;
  uniform vec3 uBoxMin;
  uniform vec3 uBoxMax;
  uniform vec3 uElbowL;   // arm joints, local space (driven from update())
  uniform vec3 uWristL;
  uniform vec3 uElbowR;
  uniform vec3 uWristR;
  uniform vec3 uChin;     // the skull is a capsule from chin to crown
  uniform vec3 uCrown;
  uniform float uTime;
  uniform float uFade;
  uniform float uRim;
  uniform float uChurn;   // how fast it streams (more when hunting)
  uniform vec4 uClip[${CLIP_RAYS}]; // wall planes: fog only where dot(xyz, p) + w > 0 (unused ones are (0, 0, 0, 1))
  varying vec3 vPos;

  const int MAX_STEPS = 110;
  const float MIN_STEP = 0.02;
  const float SIGMA = 60.0; // absorption per meter at full density: even the thin arms are solid black
  const float AURA = 0.6;   // how far out the aura can reach from the body (m)

  float hash(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }

  /** A capsule that tapers from radius ra at a to rb at b. */
  float cone(vec3 p, vec3 a, vec3 b, float ra, float rb) {
    vec3 pa = p - a, ba = b - a;
    float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
    return length(pa - ba * h) - mix(ra, rb, h);
  }
  float smin(float a, float b, float k) { float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0); return mix(b, a, h) - k * h * (1.0 - h); }

  /** Four long claws from the wrist, splayed and hooked toward the palm. */
  float claws(vec3 p, vec3 e, vec3 w, float side) {
    float far = length(p - w);
    if (far > 1.1) return far - 0.42; // far from the hand: a safe underestimate, past where any fog (aura too) is drawn
    vec3 f = normalize(w - e);
    vec3 s = normalize(cross(f, vec3(0.0, 0.0, 1.0)) + vec3(0.0, 1e-3, 0.0)); // spread across the hand
    vec3 palm = mix(vec3(0.0, -1.0, 0.0), vec3(0.0, 0.0, -side), clamp(-f.y, 0.0, 1.0));
    palm = normalize(palm - f * dot(palm, f));
    float d = cone(p, e + (w - e) * 0.85, w + f * 0.05, 0.03, 0.035); // the bony back of the hand
    for (int i = 0; i < 4; i++) {
      float k = float(i) - 1.5;
      float len = 0.32 - abs(k) * 0.05;
      vec3 dir = normalize(f + s * k * 0.3);
      vec3 knuckle = w + f * 0.05 + dir * len * 0.55;
      vec3 tip = knuckle + normalize(dir + palm * 0.7) * len * 0.5;
      d = min(d, cone(p, w + f * 0.04, knuckle, 0.018, 0.012));
      d = min(d, cone(p, knuckle, tip, 0.012, 0.001));
    }
    return d;
  }

  /** Head and shoulders only: where the rising smoke comes from. */
  float upper(vec3 p) {
    float d = cone(p, uChin, uCrown, 0.055, 0.095);                     // narrow jaw, long skull
    d = min(d, cone(p, ${SL}, ${NB}, 0.06, 0.08));                      // shoulders, high and bony
    d = min(d, cone(p, ${SR}, ${NB}, 0.06, 0.08));
    return d;
  }

  float figure(vec3 p) {
    float d = upper(p);
    d = smin(d, cone(p, ${NB}, uChin + vec3(-0.04, 0.03, 0.0), 0.055, 0.04), 0.04); // the neck, thrust forward
    d = smin(d, cone(p, vec3(0.03, 1.72, 0.0), vec3(-0.01, 1.32, 0.0), 0.13, 0.07), 0.05); // ribcage
    d = smin(d, cone(p, ${SL}, vec3(-0.02, 1.12, -0.02), 0.07, 0.04), 0.04); // the V of the torso
    d = smin(d, cone(p, ${SR}, vec3(-0.02, 1.12, 0.02), 0.07, 0.04), 0.04);
    d = smin(d, cone(p, vec3(-0.01, 1.35, 0.0), vec3(-0.03, 1.05, 0.0), 0.07, 0.06), 0.04); // waist
    // Arms: elbows out, forearms thin as sticks, then the claws.
    d = smin(d, cone(p, ${SL}, uElbowL, 0.05, 0.035), 0.03);
    d = min(d, cone(p, uElbowL, uWristL, 0.035, 0.022));
    d = min(d, claws(p, uElbowL, uWristL, -1.0));
    d = smin(d, cone(p, ${SR}, uElbowR, 0.05, 0.035), 0.03);
    d = min(d, cone(p, uElbowR, uWristR, 0.035, 0.022));
    d = min(d, claws(p, uElbowR, uWristR, 1.0));
    // Below the waist: torn tendrils of uneven length, streaming back, ending in points.
    if (p.y < 1.25) {
      d = smin(d, cone(p, vec3(-0.03, 1.1, 0.0), vec3(-0.12, 0.1, 0.02), 0.07, 0.0), 0.05);
      d = smin(d, cone(p, vec3(-0.02, 1.1, 0.05), vec3(0.04, 0.3, 0.2), 0.06, 0.0), 0.05);
      d = smin(d, cone(p, vec3(-0.02, 1.1, -0.05), vec3(-0.04, 0.22, -0.21), 0.06, 0.0), 0.05);
      d = smin(d, cone(p, vec3(-0.05, 1.08, 0.03), vec3(-0.34, 0.48, 0.12), 0.05, 0.0), 0.05);
      d = smin(d, cone(p, vec3(-0.05, 1.08, -0.03), vec3(-0.28, 0.36, -0.1), 0.05, 0.0), 0.05);
    }
    return d;
  }

  /** Fog density at p (0 to 1). Also: how near any fog is (for skipping empty space). */
  float density(vec3 p, out float near) {
    float t = uTime * uChurn;
    vec3 drift = vec3(0.03 * t, -0.42 * t, 0.02 * t);           // it all streams upward
    vec3 w = texture(uNoise, p * vec3(0.7, 0.35, 0.7) + drift * 0.5).gba - 0.5;
    // The upper body holds its shape; the tendrils whip, more toward their tips.
    float robe = (1.0 - smoothstep(1.0, 1.3, p.y)) * (1.0 - smoothstep(0.24, 0.4, abs(p.z))) * (1.0 - smoothstep(0.2, 0.4, p.x));
    vec3 q = p + w * (0.03 + robe * 0.24 * (1.0 - smoothstep(0.1, 1.2, p.y)));
    float sdf = figure(q);
    // Smoke rising off the head and shoulders like flame: the same shapes lifted by a streaky amount.
    float ns = texture(uNoise, p * vec3(1.5, 0.28, 1.5) + drift).r;
    float rise = p.y > 1.7 ? upper(q - vec3(0.0, 0.04 + 0.3 * ns * ns, 0.0)) + 0.025 : 1.0;
    near = min(sdf, rise);
    if (near > AURA) return 0.0;                                  // empty space: skip the rest
    float nb = texture(uNoise, p * 1.4 + drift * 0.7 + 0.37).r;
    float n = smoothstep(0.28, 0.72, ns * 0.6 + nb * 0.4);
    float body = smoothstep(0.03, -0.05, sdf);                   // a sharp cut: the outline stays angular
    float d = body * smoothstep(0.1, 0.5, n + body * 0.55);       // torn in vertical streaks where it is thin
    d += (1.0 - smoothstep(0.0, 0.16, sdf)) * smoothstep(0.62, 0.95, n) * 0.45; // ragged streaks just off the edge
    d += smoothstep(0.04, -0.03, rise) * smoothstep(0.6, 0.95, n) * 0.25 * smoothstep(1.7, 1.9, p.y);
    // The aura: a wide, faint dark haze around all of it, its edge rising in slow waves like dark flame. Its own
    // density is tiny next to the body's: seen through, it only dims what is behind.
    float ang = atan(p.z, p.x);
    float wave = pow(0.5 + 0.5 * sin(p.y * 5.0 - t * 2.0 + ang * 3.0 + nb * 4.0), 1.6);
    float reach = 0.18 + (AURA - 0.22) * wave * (0.55 + 0.45 * smoothstep(0.4, 1.8, p.y));
    float aura = (1.0 - smoothstep(reach * 0.55, reach, sdf)) * (0.55 + 0.45 * n);
    d += aura * 0.04;
    d *= smoothstep(0.02, 0.35, p.y);                             // the tendrils never touch the floor
    // Never let the box show: everything thins to nothing before its walls.
    vec3 wall = min(p - uBoxMin, uBoxMax - p);
    d *= smoothstep(0.0, 0.25, min(min(wall.x, wall.z), uBoxMax.y - p.y));
    // Nothing past a wall's face.
    for (int i = 0; i < ${CLIP_RAYS}; i++) d *= smoothstep(0.0, 0.05, dot(uClip[i].xyz, p) + uClip[i].w);
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
    float t = tmin + MIN_STEP * hash(gl_FragCoord.xy + fract(uTime) * 61.0); // jittered start hides the step bands
    float T = 1.0; // how much of what is behind still shows through
    float tHit = -1.0; // where the ray first meets fog
    for (int i = 0; i < MAX_STEPS; i++) {
      if (t > tmax) break;
      float near;
      float d = density(ro + rd * t, near);
      // Big strides through empty space (the distance field is bent by the noise, hence the safety factor), medium
      // ones through the aura, small ones in the body so the thin claws aren't stepped over.
      float dt = near > AURA ? max(0.06, (near - AURA + 0.05) * 0.6) : clamp(near * 0.5, MIN_STEP, 0.06);
      if (d > 0.001) {
        if (tHit < 0.0) tHit = t;
        float a = 1.0 - exp(-d * SIGMA * dt);
        T *= 1.0 - a;
        if (T < 0.02) break;
      }
      t += dt;
    }
    if (T > 0.995) discard;
    // Black where it is solid; where it is only partly see-through (torn edges, the aura) a touch of grey, and a
    // faint cold glow that is all that shows of it in the dark.
    float A = 1.0 - T;
    float thin = 4.0 * A * (1.0 - A);
    vec3 col = A * (vec3(0.002, 0.002, 0.003) + thin * (vec3(0.02, 0.021, 0.024) + uRim * vec3(0.05, 0.07, 0.11)));
    gl_FragColor = vec4(col, A); // premultiplied
    // The pixel's depth is that of the first fog along the ray, not of the box, so the depth test hides it behind
    // any wall between it and the camera (and still shows it through a doorway).
    vec4 clip = uProj * uMV * vec4(ro + rd * tHit, 1.0);
    gl_FragDepth = clamp(clip.z / clip.w * 0.5 + 0.5, 0.0, 1.0);
  }
`;

export interface ShadowView {
  object: THREE.Object3D;
  /** Once per frame, with the camera it will be drawn from. */
  update(shadow: Shadow, seconds: number, camera: THREE.Camera): void;
  dispose(): void;
}

/** `castWall` lets the fog stop at walls; without it (no collision data yet) the fog ignores them. */
export function createShadowView(castWall?: CastWall): ShadowView {
  const noise = makeNoise();
  const uniforms = {
    uNoise: { value: noise },
    uCam: { value: new THREE.Vector3() },
    uBoxMin: { value: BOX_MIN },
    uBoxMax: { value: BOX_MAX },
    uElbowL: { value: new THREE.Vector3() },
    uWristL: { value: new THREE.Vector3() },
    uElbowR: { value: new THREE.Vector3() },
    uWristR: { value: new THREE.Vector3() },
    uChin: { value: new THREE.Vector3() },
    uCrown: { value: new THREE.Vector3() },
    uTime: { value: 0 },
    uFade: { value: 1 },
    uRim: { value: 0.5 },
    uChurn: { value: 1 },
    uMV: { value: new THREE.Matrix4() },
    uProj: { value: new THREE.Matrix4() },
    uClip: { value: Array.from({ length: CLIP_RAYS }, () => new THREE.Vector4(0, 0, 0, 1)) },
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
  // Outside the box it draws the front faces (so a wall the box pokes into doesn't hide it); once the camera is inside
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
  // The camera is read right before the draw, so it matches exactly even if it moved after update().
  mesh.onBeforeRender = (_r, _s, camera) => {
    toLocal(camera, uniforms.uCam.value);
    uniforms.uMV.value.multiplyMatrices(camera.matrixWorldInverse, mesh.matrixWorld);
    uniforms.uProj.value.copy(camera.projectionMatrix);
  };
  const local = new THREE.Vector3();
  const origin = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const toMesh = new THREE.Matrix4();

  /** Turns the walls around it into cut planes in the fog's local space. */
  const findWalls = () => {
    const planes = uniforms.uClip.value;
    for (const p of planes) p.set(0, 0, 0, 1);
    if (!castWall) return;
    toMesh.copy(mesh.matrixWorld).invert();
    origin.set(root.position.x, root.position.y + CLIP_HEIGHT, root.position.z);
    for (let i = 0; i < CLIP_RAYS; i++) {
      const a = (i / CLIP_RAYS) * Math.PI * 2;
      const hit = castWall(origin, dir.set(Math.cos(a), 0, Math.sin(a)), CLIP_REACH);
      if (!hit) continue;
      const n = hit.normal.transformDirection(toMesh);
      const at = hit.point.applyMatrix4(toMesh);
      planes[i].set(n.x, n.y, n.z, -n.dot(at) - 0.02); // a hair in front of the face
    }
  };

  const root = new THREE.Group();
  root.add(mesh);
  root.visible = false;

  // The head twitch: it holds a tilt, then every few seconds snaps to a new one, fast.
  let last = 0;
  let tilt = 0.4;
  let tiltTarget = 0.4;
  let nextSnap = 0;
  let snaps = 0;
  const hashed = (n: number) => {
    const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
    return x - Math.floor(x);
  };

  return {
    object: root,
    update(shadow, seconds, camera) {
      const show = shadow.state !== "absent" && shadow.fade > 0.001;
      root.visible = show;
      if (!show) return;
      const dt = Math.min(0.1, Math.max(0, seconds - last));
      last = seconds;
      root.position.set(shadow.x, shadow.floor * FLOOR_HEIGHT, -shadow.y);
      root.rotation.y = shadow.facing; // plan heading: +x local maps to (cos a, 0, -sin a) in the scene
      const hunting = shadow.state === "hunting";

      // Arms: idle, they hang to the knees with the claws past them, drifting; a hunt brings them up and forward,
      // reaching at head height.
      const joints = [
        [uniforms.uElbowL.value, uniforms.uWristL.value],
        [uniforms.uElbowR.value, uniforms.uWristR.value],
      ];
      joints.forEach(([elbow, wrist], i) => {
        const side = i === 0 ? -1 : 1;
        const sway = Math.sin(seconds * 0.6 + i * 2.1);
        if (hunting) {
          elbow.set(0.4 + 0.03 * sway, 1.66, side * 0.44);
          wrist.set(0.86 + 0.04 * sway, 1.56 + 0.05 * Math.sin(seconds * 1.7 + i), side * (0.36 + 0.03 * sway));
        } else {
          elbow.set(-0.06 + 0.03 * sway, 1.3, side * 0.43);
          wrist.set(0.04 + 0.05 * sway, 0.8 + 0.03 * Math.sin(seconds * 0.9 + i), side * (0.46 + 0.02 * sway));
        }
      });

      // Head: hung forward below the shoulder line, cocked, snapping between angles; a hunt straightens it to stare.
      if (seconds >= nextSnap) {
        snaps++;
        const r = hashed(snaps);
        tiltTarget = (r < 0.5 ? -1 : 1) * (0.25 + 0.4 * hashed(snaps + 0.5));
        nextSnap = seconds + 1.5 + 3.5 * hashed(snaps + 0.25);
      }
      const goal = hunting ? 0.08 * Math.sin(seconds * 9) : tiltTarget; // while hunting, only a tremor
      tilt += (goal - tilt) * Math.min(1, dt * 22);
      const chin = uniforms.uChin.value.set(hunting ? 0.27 : 0.21, hunting ? 1.82 : 1.76, 0);
      uniforms.uCrown.value.set(chin.x - 0.02, chin.y + 0.27 * Math.cos(tilt), chin.z + 0.27 * Math.sin(tilt));

      root.rotation.z = hunting ? -0.12 : -0.04; // leans into the chase
      root.updateMatrixWorld();
      findWalls();
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
