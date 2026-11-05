import * as THREE from "three";

// Surface detail for the blockout, added to the GLB's plain materials at run time. Everything is a function
// of world position (no UVs, no texture files), keyed by the material names set in
// scripts/build-blockout.mts. The point is to break up flat color: tile grids and inserts on the floors,
// plaster grain, skirting and corner darkening on the walls, panel joints on the ceilings, stains on the
// concrete. Roughness varies with the pattern so the flashlight picks out grout, inserts and polish.

type Kind = "porcelain" | "porcelain45" | "tile" | "concrete" | "panels" | "plaster" | "stair" | "gravel" | "planter" | "foliage" | "rock";

const KINDS: Record<string, Kind> = {
  floors: "porcelain",
  floor_atrium: "porcelain45",
  floor_bath: "tile",
  floor_garage: "concrete",
  ceilings: "panels",
  walls: "plaster",
  doors: "plaster", // the same pattern as the walls: a closed secret door has to vanish into them
  stairs: "stair",
  column: "stair",
  gravel: "gravel",
  planter: "planter",
  garden: "foliage",
  garden_dark: "foliage",
  stone: "rock",
};

const HEADER = /* glsl */ `
varying vec3 vWPos;
float gGrout = 0.0;
float gBlack = 0.0;
float h12(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
float h13(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
float vnoise(vec3 p) {
  vec3 i = floor(p); vec3 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(h13(i), h13(i + vec3(1,0,0)), f.x), mix(h13(i + vec3(0,1,0)), h13(i + vec3(1,1,0)), f.x), f.y),
    mix(mix(h13(i + vec3(0,0,1)), h13(i + vec3(1,0,1)), f.x), mix(h13(i + vec3(0,1,1)), h13(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm(vec3 p) { return 0.55 * vnoise(p) + 0.3 * vnoise(p * 2.1) + 0.15 * vnoise(p * 4.3); }
`;

/** Large-format tiles with grout lines, black granite stripes and the odd black tile. */
const tiles = (size: number, angle: number, stripe: boolean) => /* glsl */ `
  {
    float c = ${Math.cos(angle).toFixed(5)}; float s = ${Math.sin(angle).toFixed(5)};
    vec2 q = mat2(c, -s, s, c) * vWPos.xz;
    vec2 g = q / ${size.toFixed(3)}; vec2 id = floor(g); vec2 f = fract(g);
    float edge = min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y)) * ${size.toFixed(3)};
    float grout = 1.0 - smoothstep(0.004, 0.011, edge);
    float black = max(${stripe ? "step(mod(id.x, 7.0), 0.5)" : "0.0"}, step(h12(id), 0.045));
    vec3 base = diffuseColor.rgb * (0.95 + 0.1 * h12(id + 7.3)) * (0.96 + 0.08 * vnoise(vWPos * 3.0));
    vec3 granite = vec3(0.03, 0.031, 0.034) * (0.85 + 0.3 * vnoise(vWPos * 45.0));
    diffuseColor.rgb = mix(base, granite, black) * (1.0 - 0.5 * grout);
    gGrout = grout; gBlack = black;
  }
`;

const COLOR: Record<Kind, string> = {
  porcelain: tiles(1.2, 0, true),
  porcelain45: tiles(1.2, Math.PI / 4, false),
  tile: /* glsl */ `
  {
    vec2 g = vWPos.xz / 0.3; vec2 id = floor(g); vec2 f = fract(g);
    float edge = min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y)) * 0.3;
    gGrout = 1.0 - smoothstep(0.003, 0.008, edge);
    float check = mod(id.x + id.y, 2.0);
    diffuseColor.rgb *= (0.8 + 0.25 * check) * (0.95 + 0.1 * h12(id)) * (1.0 - 0.45 * gGrout);
  }`,
  concrete: /* glsl */ `
  {
    float n = fbm(vWPos * 1.6);
    float stain = smoothstep(0.58, 0.8, fbm(vWPos * 0.35 + 3.1));
    diffuseColor.rgb *= (0.72 + 0.5 * n) * (1.0 - 0.55 * stain);
    float seam = 1.0 - smoothstep(0.01, 0.03, min(abs(fract(vWPos.x / 4.0 - 0.5) - 0.5), abs(fract(vWPos.z / 4.0 - 0.5) - 0.5)) * 4.0);
    diffuseColor.rgb *= 1.0 - 0.4 * seam;
    gGrout = stain * 0.3;
  }`,
  panels: /* glsl */ `
  {
    vec2 g = vWPos.xz / 0.6; vec2 f = fract(g);
    float edge = min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y)) * 0.6;
    float joint = 1.0 - smoothstep(0.004, 0.012, edge);
    diffuseColor.rgb *= (0.92 + 0.12 * fbm(vWPos * 2.5)) * (1.0 - 0.5 * joint);
  }`,
  plaster: /* glsl */ `
  {
    float h = mod(vWPos.y + 0.001, 5.0); // height within the storey
    float n = fbm(vWPos * 2.2);
    diffuseColor.rgb *= 0.9 + 0.2 * n;
    float skirt = 1.0 - smoothstep(0.1, 0.115, h);
    diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.42, 0.42, 0.45), skirt);
    // fake ambient occlusion: darker toward the floor and under the ceiling
    float ao = mix(0.55, 1.0, smoothstep(0.0, 1.5, h)) * mix(0.72, 1.0, smoothstep(3.5, 2.6, h));
    diffuseColor.rgb *= ao;
  }`,
  gravel: /* glsl */ `
  {
    // River-stone gravel: cells of rounded stones with their own brightness and tint, dark crevices between.
    // Two scales of stones (pebbles and a few larger ones), each with its own size, brightness and tint.
    float big = step(0.8, h12(floor(vWPos.xz * 3.0) + 5.1));
    vec2 p = vWPos.xz * mix(20.0, 9.0, big); vec2 i = floor(p); float md = 8.0; vec2 mid = vec2(0.0);
    for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
      vec2 g = i + vec2(float(x), float(y));
      vec2 d = g + vec2(h12(g), h12(g + 17.3)) * 0.9 - p;
      float dd = dot(d, d);
      if (dd < md) { md = dd; mid = g; }
    }
    float shade = 0.4 + 0.9 * h12(mid + 3.7);
    vec3 tint = mix(vec3(1.0, 0.93, 0.84), vec3(0.8, 0.88, 1.0), h12(mid + 9.1));
    float r0 = 0.3 + 0.25 * h12(mid + 21.7); // each stone has its own size
    float rim = smoothstep(r0, r0 + 0.14, sqrt(md));
    diffuseColor.rgb *= shade * tint * (1.0 - 0.7 * rim) * (0.85 + 0.3 * vnoise(vWPos * 5.0));
    gGrout = rim;
  }`,
  planter: /* glsl */ `
  {
    // Cast concrete: mottled, with formwork lines every 30 cm and darker toward the ground.
    float h = mod(vWPos.y + 0.001, 5.0);
    float form = 1.0 - smoothstep(0.004, 0.012, abs(fract(vWPos.y / 0.3) - 0.5) * 0.3 - 0.145 + 0.0);
    diffuseColor.rgb *= (0.8 + 0.4 * fbm(vWPos * 3.0)) * mix(0.62, 1.0, smoothstep(0.0, 0.35, h)) * (1.0 - 0.18 * form);
  }`,
  foliage: /* glsl */ `
  {
    diffuseColor.rgb *= 0.6 + 0.8 * vnoise(vWPos * 8.0);
  }`,
  rock: /* glsl */ `
  {
    diffuseColor.rgb *= (0.65 + 0.7 * fbm(vWPos * 7.0)) * mix(0.7, 1.0, vnoise(vWPos * 30.0));
  }`,
  stair: /* glsl */ `
  {
    diffuseColor.rgb *= (0.86 + 0.28 * fbm(vWPos * 3.5)) * (0.9 + 0.1 * h13(floor(vWPos * 8.0)));
  }`,
};

const ROUGHNESS: Partial<Record<Kind, string>> = {
  porcelain: "roughnessFactor = mix(mix(0.26, 0.1, gBlack), 0.85, gGrout);",
  porcelain45: "roughnessFactor = mix(mix(0.26, 0.1, gBlack), 0.85, gGrout);",
  tile: "roughnessFactor = mix(0.3, 0.85, gGrout);",
  concrete: "roughnessFactor = mix(0.92, 0.55, gGrout);",
  gravel: "roughnessFactor = mix(0.55, 0.95, gGrout);",
};

function patch(material: THREE.Material, kind: Kind) {
  const m = material as THREE.MeshStandardMaterial;
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vWPos;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvWPos = (modelMatrix * vec4(position, 1.0)).xyz;");
    let frag = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${HEADER}`)
      .replace("#include <color_fragment>", `#include <color_fragment>\n${COLOR[kind]}`);
    const rough = ROUGHNESS[kind];
    if (rough) frag = frag.replace("#include <roughnessmap_fragment>", `#include <roughnessmap_fragment>\n${rough}`);
    shader.fragmentShader = frag;
  };
  // Programs are cached by this key; the closure above differs per kind but its source does not.
  m.customProgramCacheKey = () => `mallstyle-${kind}`;
  m.needsUpdate = true;
}

function unpatch(material: THREE.Material) {
  const m = material as THREE.MeshStandardMaterial;
  m.onBeforeCompile = () => {};
  m.customProgramCacheKey = () => "plain";
  m.needsUpdate = true;
}

/**
 * Adds (or removes, for the low preset) the procedural surface detail on the blockout's materials.
 * Safe to call again when the quality changes.
 */
export function styleBlockout(root: THREE.Object3D, detail: boolean) {
  const seen = new Set<THREE.Material>();
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const mat = o.material as THREE.Material;
    const kind = KINDS[mat.name] ?? KINDS[o.name];
    if (!kind || seen.has(mat)) return;
    seen.add(mat);
    if (detail) patch(mat, kind);
    else unpatch(mat);
  });
}
