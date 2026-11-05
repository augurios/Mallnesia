import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";

// One cheap finishing pass (grain, vignette, a little color drain) plus optional bloom, as in the art doc's
// recipe. The sanity effects will drive `drain` and the vignette later. The low preset skips all of it and
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
    varying vec2 vUv;
    float hash(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      float l = dot(c.rgb, vec3(0.299, 0.587, 0.114));
      c.rgb = mix(c.rgb, vec3(l) * vec3(0.93, 0.98, 1.05), drain);
      float v = smoothstep(0.95, 0.25, length(vUv - 0.5) * 1.3);
      c.rgb *= mix(1.0 - vignette, 1.0, v);
      float g = hash(floor(vUv * resolution) + fract(time) * 91.7) - 0.5;
      c.rgb += g * grain * (1.0 - l * 0.7);
      gl_FragColor = c;
    }
  `,
};

export interface Post {
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

  return {
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
      composer.render();
    },
    dispose() {
      composer.dispose();
    },
  };
}
