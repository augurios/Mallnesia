import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { Shadow } from "./shadow";
import { FLOOR_HEIGHT } from "./walk";

// How the shadow looks: a tall, faceless, near-black figure about 2 m high (a long neck, long arms hanging past the
// knees), built from a few primitives, so there is nothing to download. Its surface ignores the lights, so the
// flashlight shows it as a black hole in the lit wall behind it. In the dark a faint cold rim is all that gives it
// away. It dissolves with a noisy dither, and it sways a little with a slow wobble, never quite standing still.
// All of it is placeholder shape and tuning for Augusto to judge by playing.

const material = new THREE.ShaderMaterial({
  uniforms: {
    uTime: { value: 0 },
    uFade: { value: 1 },
    uRim: { value: 0.5 },
  },
  vertexShader: /* glsl */ `
    uniform float uTime;
    varying vec3 vNormal;
    varying vec3 vView;
    void main() {
      vec3 p = position;
      // A slow ripple, stronger toward the top, so the edges never sit quite still.
      p.x += sin(p.y * 3.1 + uTime * 1.3) * 0.018 * p.y;
      p.z += sin(p.y * 2.3 + uTime * 0.9) * 0.014 * p.y;
      vec4 mv = modelViewMatrix * vec4(p, 1.0);
      vNormal = normalize(normalMatrix * normal);
      vView = -mv.xyz;
      gl_Position = projectionMatrix * mv;
    }
  `,
  fragmentShader: /* glsl */ `
    uniform float uFade;
    uniform float uRim;
    varying vec3 vNormal;
    varying vec3 vView;
    float hash(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
    void main() {
      if (hash(gl_FragCoord.xy) > uFade) discard; // dissolves in and out as noise, not as a see-through ghost
      float rim = pow(1.0 - clamp(dot(normalize(vNormal), normalize(vView)), 0.0, 1.0), 2.2);
      vec3 c = vec3(0.004, 0.005, 0.008) + rim * uRim * vec3(0.10, 0.14, 0.21);
      gl_FragColor = vec4(c, 1.0);
    }
  `,
});

/** One merged mesh for the torso, neck and head, and an arm mesh per side. Feet at y = 0, facing local +x. */
function buildGeometry() {
  // Torso: a narrow, slightly hunched robe that flares at the foot, with a long neck.
  const profile = [
    [0.02, 0],
    [0.2, 0.02],
    [0.25, 0.4],
    [0.2, 0.95],
    [0.17, 1.25],
    [0.23, 1.48],
    [0.19, 1.6],
    [0.07, 1.68],
    [0.05, 1.9],
    [0.0, 1.9],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const torso = new THREE.LatheGeometry(profile, 14);
  torso.scale(0.72, 1, 1); // flatter front to back
  const head = new THREE.SphereGeometry(0.13, 12, 10);
  head.scale(0.9, 1.4, 0.85);
  head.rotateZ(-0.28); // hangs forward
  head.translate(0.06, 2.0, 0);
  const body = mergeGeometries([torso, head])!;

  // An arm: upper and lower section as one tapered tube, pivoting at the shoulder (y = 0 at the pivot, hanging down).
  const arm = new THREE.CylinderGeometry(0.04, 0.055, 1.3, 7, 1, true);
  arm.translate(0, -0.65, 0);
  return { body, arm };
}

export interface ShadowView {
  object: THREE.Object3D;
  update(shadow: Shadow, seconds: number): void;
  dispose(): void;
}

export function createShadowView(): ShadowView {
  const { body, arm } = buildGeometry();
  const root = new THREE.Group();
  const bodyMesh = new THREE.Mesh(body, material);
  const arms = [-1, 1].map((side) => {
    const pivot = new THREE.Group();
    pivot.position.set(0.02, 1.5, side * 0.29);
    const mesh = new THREE.Mesh(arm, material);
    mesh.frustumCulled = true;
    pivot.add(mesh);
    root.add(pivot);
    return pivot;
  });
  root.add(bodyMesh);
  root.visible = false;
  root.frustumCulled = false;

  return {
    object: root,
    update(shadow, seconds) {
      const show = shadow.state !== "absent" && shadow.fade > 0.001;
      root.visible = show;
      if (!show) return;
      root.position.set(shadow.x, shadow.floor * FLOOR_HEIGHT, -shadow.y);
      root.rotation.y = shadow.facing; // plan heading: +x local maps to (cos a, 0, -sin a) in the scene
      const hunting = shadow.state === "hunting";
      // Arms hang and swing slowly; a hunt pulls them forward and up a little.
      arms.forEach((a, i) => {
        a.rotation.z = (i === 0 ? 1 : -1) * 0.1 * Math.sin(seconds * 0.8 + i) + (hunting ? 0.0 : 0);
        a.rotation.x = (i === 0 ? -1 : 1) * (0.08 + 0.05 * Math.sin(seconds * 0.7 + i * 2) + (hunting ? 0.25 : 0));
      });
      root.rotation.z = hunting ? -0.12 : -0.03; // leans into the chase
      material.uniforms.uTime.value = seconds;
      material.uniforms.uFade.value = shadow.fade;
      material.uniforms.uRim.value = hunting ? 0.9 : shadow.state === "investigating" ? 0.65 : 0.45;
    },
    dispose() {
      body.dispose();
      arm.dispose();
    },
  };
}
