import * as THREE from "three";

// The world outside the glass: an overcast night sky with city glow low on the horizon, far hills, a ring of
// blocks with a few lit windows, a street-lit ground with distant headlights. All procedural in one shader
// (no texture files), on a dome that follows the camera, so it has no parallax: it is a backdrop, not
// geometry. Everything stays dim; the glass only shows what the street would really give at night.

const VERTEX = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAGMENT = /* glsl */ `
varying vec3 vDir;
uniform vec3 uCam;
const float PI = 3.14159265;
float h11(float n) { return fract(sin(n * 127.1) * 43758.5453); }
float h21(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
float h31(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
float vnoise(vec3 p) {
  vec3 i = floor(p); vec3 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(h31(i), h31(i + vec3(1,0,0)), f.x), mix(h31(i + vec3(0,1,0)), h31(i + vec3(1,1,0)), f.x), f.y),
    mix(mix(h31(i + vec3(0,0,1)), h31(i + vec3(1,0,1)), f.x), mix(h31(i + vec3(0,1,1)), h31(i + vec3(1,1,1)), f.x), f.y), f.z);
}

void main() {
  vec3 d = normalize(vDir);
  float e = asin(clamp(d.y, -1.0, 1.0));           // elevation, radians
  float az = atan(d.z, d.x);                        // azimuth, -pi..pi
  vec3 ring = vec3(cos(az), sin(az), 0.0);          // a seamless way to index the azimuth

  // Sky: cold dark overcast, lit warm from below by the city.
  vec3 col = mix(vec3(0.010, 0.014, 0.026), vec3(0.06, 0.047, 0.046), exp(-max(e, 0.0) * 6.5) * 0.85);
  col *= 0.75 + 0.5 * vnoise(vec3(d.x, d.z, d.y * 2.5) * 5.0 / (abs(d.y) + 0.35));

  // Far hills.
  float hills = 0.018 + 0.075 * vnoise(ring * 2.2 + 7.0) + 0.03 * vnoise(ring * 7.0);
  if (e < hills) col = mix(vec3(0.006, 0.008, 0.012), col, exp(-(hills - e) * 40.0) * 0.5);

  // A ring of blocks nearer than the hills: dark boxes with a few lit windows.
  float u = (az + PI) / (2.0 * PI) * 260.0;
  float id = floor(u);
  float on = step(0.22, h11(id + 1.7));
  float top = 0.008 + 0.05 * h11(id + 9.3) * h11(id + 4.1);
  if (on > 0.5 && e < top && e > -0.01) {
    vec2 w = vec2(u * 5.0, e / 0.0035);
    vec2 cell = floor(w);
    vec2 f = fract(w);
    float lit = step(0.9, h21(cell + id * 13.0)) * step(0.2, f.x) * step(f.x, 0.8) * step(0.25, f.y) * step(f.y, 0.75);
    vec3 glass = mix(vec3(1.0, 0.78, 0.5), vec3(0.8, 0.9, 1.0), step(0.6, h21(cell + 5.5)));
    col = mix(vec3(0.009, 0.011, 0.016), glass * 0.32, lit);
  }

  // The ground: asphalt far below, with pools of orange light under street lamps, fading into the haze.
  if (e < 0.0) {
    float height = max(uCam.y + 1.0, 3.0);
    float t = height / max(-d.y, 0.001);
    vec2 p = uCam.xz + d.xz * t;
    vec2 g = p / 30.0;
    vec2 gi = floor(g);
    float pool = 0.0;
    for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
      vec2 c = gi + vec2(float(x), float(y));
      vec2 lamp = (c + 0.2 + 0.6 * vec2(h21(c), h21(c + 3.3))) * 30.0;
      pool += exp(-dot(p - lamp, p - lamp) / 90.0) * step(0.35, h21(c + 8.8));
    }
    float haze = exp(-t / 110.0);
    vec3 ground = vec3(0.012, 0.013, 0.017) + vec3(0.075, 0.042, 0.016) * pool;
    col = mix(col, ground, haze);

    // Far headlights and tail lights along the roads, small and few.
    float lu = (az + PI) / (2.0 * PI) * 420.0;
    float lv = e / -0.0016;
    vec2 lc = vec2(floor(lu), floor(lv));
    if (lv > 2.0 && lv < 26.0) {
      vec2 lf = fract(vec2(lu, lv)) - 0.5;
      float spot = step(0.93, h21(lc)) * smoothstep(0.35, 0.05, length(lf));
      vec3 lamp = mix(vec3(1.0, 0.92, 0.8), vec3(1.0, 0.12, 0.08), step(0.5, h21(lc + 4.1)));
      col += lamp * spot * 0.45;
    }
  }

  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export interface Sky {
  mesh: THREE.Mesh;
  /** Centre the dome on the camera. Call every frame. */
  follow(position: THREE.Vector3): void;
  dispose(): void;
}

export function createSky(radius = 200): Sky {
  const uniforms = { uCam: { value: new THREE.Vector3() } };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    side: THREE.BackSide,
    depthTest: false,
    depthWrite: false,
    fog: false,
  });
  const geometry = new THREE.SphereGeometry(radius, 48, 24);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = -1000;
  mesh.frustumCulled = false;
  return {
    mesh,
    follow(position) {
      mesh.position.copy(position);
      uniforms.uCam.value.copy(position);
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
