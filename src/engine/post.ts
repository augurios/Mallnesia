import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";

// One cheap finishing pass (grain, vignette, a little color drain) plus optional bloom, as in the art doc's
// recipe. The sanity look (sanity.ts) is added on top through `setLook`. The low preset skips all of it and
// renders straight to the screen.

export interface PostSettings {
  bloom: boolean;
  film: boolean;
}

const FilmShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    time: { value: 0 },
    resolution: { value: new THREE.Vector2(1, 1) },
    grain: { value: 0.045 },
    vignette: { value: 0.6 },
    drain: { value: 0.14 },
    // The sanity tiers (sanity.ts), all 0 while calm: then the shader takes the plain path.
    wobble: { value: 0 },
    aberration: { value: 0 },
    tunnel: { value: 0 },
    ghost: { value: 0 },
    shake: { value: 0 },
    pulse: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float time;
    uniform vec2 resolution;
    uniform float grain;
    uniform float vignette;
    uniform float drain;
    uniform float wobble;
    uniform float aberration;
    uniform float tunnel;
    uniform float ghost;
    uniform float shake;
    uniform float pulse;
    varying vec2 vUv;
    float hash(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
    void main() {
      // Where to look up the picture: bent by the tiers, in the order they arrive.
      vec2 uv = vUv;
      vec2 c = uv - 0.5;
      float d = length(c);
      uv.x += sin(uv.y * 11.0 + time * 1.7) * 0.004 * wobble;
      uv.y += sin(uv.x * 7.0 + time * 1.1) * 0.003 * wobble;
      uv += c * d * d * 0.2 * tunnel * (1.0 + 0.35 * pulse); // the edges pinch in and breathe with the heartbeat
      float tick = floor(time * 11.0); // the shake steps, so it reads as a flinch, not a smooth wobble
      uv += (vec2(hash(vec2(tick, 1.0)), hash(vec2(2.0, tick))) - 0.5) * 0.02 * shake;
      uv.x += sin(uv.y * 40.0 + time * 9.0) * 0.012 * shake; // and the picture tears in bands

      vec4 col = texture2D(tDiffuse, uv);
      float split = aberration * 0.007 + shake * 0.02;
      if (split > 0.0) {
        vec2 dir = c * split * (0.4 + d * 2.0); // strongest at the edges
        col.r = texture2D(tDiffuse, uv + dir).r;
        col.b = texture2D(tDiffuse, uv - dir).b;
      }
      if (ghost > 0.0) {
        vec2 off = vec2(0.012, 0.004) * (0.5 + 0.5 * sin(time * 1.3)); // drifts in and out
        col.rgb = mix(col.rgb, texture2D(tDiffuse, uv + off).rgb, ghost * 0.3);
      }

      float l = dot(col.rgb, vec3(0.299, 0.587, 0.114));
      col.rgb = mix(col.rgb, vec3(l) * vec3(0.93, 0.98, 1.05), drain);
      float v = smoothstep(0.95, 0.25, d * 1.3);
      col.rgb *= mix(1.0 - vignette, 1.0, v);
      float g = hash(floor(vUv * resolution) + fract(time) * 91.7) - 0.5;
      col.rgb += g * grain * (1.0 - l * 0.7);
      gl_FragColor = col;
    }
  `,
};

/** The sanity look, added on top of the base grain, vignette and color drain (see sanity.ts). */
export interface PostLook {
  vignette: number;
  drain: number;
  grain: number;
  pulse: number;
  wobble: number;
  aberration: number;
  tunnel: number;
  ghost: number;
  shake: number;
}

export interface Post {
  setLook(look: PostLook): void;
  setSize(width: number, height: number, pixelRatio: number): void;
  setSettings(settings: PostSettings): void;
  render(seconds: number): void;
  dispose(): void;
}

export function createPost(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera): Post {
  const composer = new EffectComposer(renderer);
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.32, 0.55, 0.85);
  const film = new ShaderPass(FilmShader);
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(bloom);
  composer.addPass(new OutputPass()); // tone mapping and sRGB, from the renderer's settings
  composer.addPass(film); // grain and vignette work on the final image
  let settings: PostSettings = { bloom: false, film: false };
  const base = { grain: film.uniforms.grain.value as number, vignette: film.uniforms.vignette.value as number, drain: film.uniforms.drain.value as number };
  let look: PostLook = { vignette: 0, drain: 0, grain: 0, pulse: 0, wobble: 0, aberration: 0, tunnel: 0, ghost: 0, shake: 0 };

  return {
    setLook(next) {
      look = next;
    },
    setSize(width, height, pixelRatio) {
      composer.setPixelRatio(pixelRatio);
      composer.setSize(width, height);
      film.uniforms.resolution.value.set(width * pixelRatio, height * pixelRatio);
    },
    setSettings(next) {
      settings = next;
      bloom.enabled = next.bloom;
      film.enabled = next.film;
    },
    render(seconds) {
      if (!settings.bloom && !settings.film) {
        renderer.render(scene, camera);
        return;
      }
      film.uniforms.time.value = seconds;
      film.uniforms.vignette.value = Math.min(0.95, base.vignette + look.vignette * (0.75 + 0.25 * look.pulse));
      film.uniforms.drain.value = Math.min(0.9, base.drain + look.drain);
      film.uniforms.grain.value = base.grain + look.grain;
      for (const k of ["wobble", "aberration", "tunnel", "ghost", "shake", "pulse"] as const) film.uniforms[k].value = look[k];
      composer.render();
    },
    dispose() {
      composer.dispose();
    },
  };
}
