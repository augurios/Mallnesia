import * as THREE from "three";

// Surface detail for the blockout, added to the GLB's plain materials at run time. Everything is a function
// of world position (no UVs, no texture files; kit pieces add their baked wear, see WEAR), keyed by the material names set in
// scripts/blockout/palette.mts. The point is to break up flat color: tile grids and inserts on the floors,
// plaster grain, skirting and corner darkening on the walls, panel joints on the ceilings, stains on the
// concrete. Roughness varies with the pattern so the flashlight picks out grout, inserts and polish.

type Kind = "porcelain" | "porcelain45" | "tile" | "concrete" | "panels" | "plaster" | "stair" | "gravel" | "planter" | "foliage" | "rock" | "vinyl" | "molded" | "painted" | "laminate";

const KINDS: Record<string, Kind> = {
  floors: "porcelain",
  floor_atrium: "porcelain45",
  floor_bath: "tile",
  floor_garage: "concrete",
  ceilings: "panels",
  walls: "plaster",
  slab: "plaster",
  doors: "plaster", // the same pattern as the walls: a closed secret door has to vanish into them
  stairs: "stair",
  column: "stair",
  gravel: "gravel",
  planter: "planter",
  garden: "foliage",
  garden_dark: "foliage",
  stone: "rock",
  // kit pieces (scripts/kit): padded vinyl, molded chair plastic, painted metal, table laminate
  vinyl: "vinyl",
  plastic: "molded",
  steel: "painted",
  chair_leg: "painted",
  laminate: "laminate",
};

// Baked ambient occlusion (scripts/blockout/ao.mts): one pixel per 0.5 m plan cell, the floors stacked, 255 = open.
// Floors and ceilings sample it by world position and dim only the ambient light, never the flashlight. Until
// the map has loaded it is one white pixel, so nothing changes.
const AO_CELL = 0.5;
const AO_SIZE = { x: 300, y: 420, floors: 3 }; // keep in sync with scripts/blockout/config.mts
const AO_STRENGTH: Partial<Record<Kind, number>> = { porcelain: 1, porcelain45: 1, tile: 1, concrete: 1, panels: 0.6 };
const white = new THREE.DataTexture(new Uint8Array([255]), 1, 1, THREE.RedFormat);
white.needsUpdate = true;
const bakedAO = { value: white as THREE.Texture };

/** Gives the floors and ceilings their baked occlusion map (or back the white one for null). */
export function setBakedAO(texture: THREE.Texture | null) {
  if (texture) {
    texture.colorSpace = THREE.NoColorSpace;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    texture.flipY = false; // image row f * 420 + j is floor f, plan row j
    texture.needsUpdate = true;
  }
  bakedAO.value = texture ?? white;
}

const AO_FRAGMENT = (strength: number) => /* glsl */ `
uniform sampler2D bakedAO;
float aoAt() {
  float f = clamp(floor(vWPos.y / 5.0 + 0.001), 0.0, ${(AO_SIZE.floors - 1).toFixed(1)});
  vec2 c = vec2(vWPos.x, -vWPos.z) / ${AO_CELL.toFixed(2)};
  vec2 uv = vec2(c.x / ${AO_SIZE.x.toFixed(1)}, (f * ${AO_SIZE.y.toFixed(1)} + clamp(c.y, 0.5, ${(AO_SIZE.y - 0.5).toFixed(1)})) / ${(AO_SIZE.y * AO_SIZE.floors).toFixed(1)});
  return mix(1.0, texture2D(bakedAO, uv).r, ${strength.toFixed(2)});
}
`;

const HEADER = /* glsl */ `
varying vec3 vWPos;
float gGrout = 0.0;
float gBlack = 0.0;
float gEdge = 0.0;  // kit wear: worn-through edge (0..1)
float gGrime = 0.0; // kit wear: dirt in recesses (0..1)
float h12(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
float h13(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
float vnoise(vec3 p) {
  vec3 i = floor(p); vec3 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(h13(i), h13(i + vec3(1,0,0)), f.x), mix(h13(i + vec3(0,1,0)), h13(i + vec3(1,1,0)), f.x), f.y),
    mix(mix(h13(i + vec3(0,0,1)), h13(i + vec3(1,0,1)), f.x), mix(h13(i + vec3(0,1,1)), h13(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm(vec3 p) { return 0.55 * vnoise(p) + 0.3 * vnoise(p * 2.1) + 0.15 * vnoise(p * 4.3); }
// Perturbs the surface normal by a height field h (meters), from its screen-space derivatives: the surface wear
// of the kit pieces (leather grain, orange peel, scratches) with no texture files.
vec3 bumpN(vec3 n, float h) {
  vec3 sx = dFdx(-vViewPosition);
  vec3 sy = dFdy(-vViewPosition);
  vec3 r1 = cross(sy, n);
  vec3 r2 = cross(n, sx);
  float det = dot(sx, r1);
  vec3 grad = sign(det) * (dFdx(h) * r1 + dFdy(h) * r2);
  vec3 b = abs(det) * n - grad;
  // tiny or edge-on triangles (bolt heads far off) can give a zero vector: a NaN there spreads through the bloom
  return dot(b, b) > 1e-24 ? normalize(b) : n;
}
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
  vinyl: /* glsl */ `
  {
    float wear = smoothstep(0.58, 0.9, fbm(vWPos * 9.0 + 3.0));
    diffuseColor.rgb *= (0.84 + 0.28 * vnoise(vWPos * 45.0)) * (1.0 - 0.3 * wear);
    gGrout = wear;
  }`,
  molded: /* glsl */ `
  {
    float scuff = smoothstep(0.7, 0.9, vnoise(vec3(vWPos.x * 34.0, vWPos.y * 4.0, vWPos.z * 34.0)) * 0.6 + vnoise(vWPos * 55.0) * 0.4);
    diffuseColor.rgb = mix(diffuseColor.rgb * (0.9 + 0.2 * vnoise(vWPos * 22.0)), diffuseColor.rgb * 1.4 + 0.06, scuff * 0.7);
    gGrout = scuff;
  }`,
  painted: /* glsl */ `
  {
    float scratch = smoothstep(0.84, 0.96, vnoise(vec3(vWPos.x * 90.0, vWPos.y * 9.0, vWPos.z * 90.0)) * 0.7 + vnoise(vWPos * 60.0) * 0.3);
    diffuseColor.rgb = mix(diffuseColor.rgb * (0.85 + 0.3 * vnoise(vWPos * 28.0)), vec3(0.42, 0.43, 0.45), scratch * 0.3);
    gGrout = scratch;
  }`,
  laminate: /* glsl */ `
  {
    diffuseColor.rgb *= 0.93 + 0.12 * h13(floor(vWPos * 260.0)) + 0.04 * vnoise(vWPos * 12.0);
    gGrout = smoothstep(0.7, 0.95, vnoise(vWPos * 40.0)) * 0.5;
  }`,
};

// Wear on kit pieces, from the per-vertex bake in scripts/kit/wear.mts (vWear: occlusion, convex edge, concave
// crease). This is our version of the reference props' texture sets: their base color has paint rubbed through
// on every edge and grime in every recess, their normal map has dents and chips. Runs after the kind's own color.
const WEAR_COMMON = /* glsl */ `
  {
    float hgt = mod(vWPos.y + 0.001, 5.0); // height above the floor
    float breakup = fbm(vWPos * 31.0) + 0.15 * vnoise(vWPos * 150.0);
    // chips and rubbed patches only on tight edges, and even there only in scattered islands (thin tubes are
    // "edge" all round, so the noise has to carry most of the decision)
    gEdge = smoothstep(0.9, 0.97, vWear.y * 0.5 + breakup * 0.7);
    // grime: hidden places, inside corners, and a band of floor dirt kicked up by shoes and mops
    float floorBand = (1.0 - smoothstep(0.0, 0.14, hgt)) * (0.4 + 0.6 * vnoise(vWPos * 18.0));
    gGrime = clamp((1.0 - vWear.x) * 1.25 + vWear.z * 0.7 + floorBand * 0.6, 0.0, 1.0) * (0.55 + 0.6 * fbm(vWPos * 7.0 + 11.0));
    gGrime = clamp(gGrime, 0.0, 1.0);
    vec3 dirt = vec3(0.12, 0.1, 0.08) * (0.8 + 0.4 * vnoise(vWPos * 40.0));
    diffuseColor.rgb = mix(diffuseColor.rgb, dirt, gGrime * 0.6) * mix(0.6, 1.0, vWear.x);
  }
`;
const WEAR: Partial<Record<Kind, string>> = {
  // powder-coated steel: chips down to bare grey metal on edges, a little rust where the dirt sits low
  painted: /* glsl */ `
  {
    vec3 bare = vec3(0.52, 0.52, 0.54) * (0.75 + 0.5 * vnoise(vWPos * 220.0));
    diffuseColor.rgb = mix(diffuseColor.rgb, bare, gEdge);
    float rust = gGrime * smoothstep(0.55, 0.8, fbm(vWPos * 23.0 + 5.0)) * (1.0 - smoothstep(0.0, 0.3, mod(vWPos.y + 0.001, 5.0)));
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.11, 0.06, 0.035), rust * 0.5);
  }`,
  // molded plastic: rubbed edges go pale and chalky (stress whitening)
  molded: /* glsl */ `
  {
    diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 1.35 + vec3(0.1, 0.08, 0.08), gEdge * 0.75);
  }`,
  // vinyl: rubbed lighter and glossy along the edges, with a fine crazing of cracks there
  vinyl: /* glsl */ `
  {
    vec2 p = vWPos.xz * 55.0 + vWPos.y * 37.0; vec2 i = floor(p); float m1 = 8.0; float m2 = 8.0;
    for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
      vec2 g = i + vec2(float(x), float(y));
      vec2 d = g + vec2(h12(g), h12(g + 7.7)) - p; float dd = dot(d, d);
      if (dd < m1) { m2 = m1; m1 = dd; } else if (dd < m2) m2 = dd;
    }
    float crack = (1.0 - smoothstep(0.0, 0.12, sqrt(m2) - sqrt(m1))) * smoothstep(0.35, 0.8, vWear.y + vnoise(vWPos * 9.0) * 0.4);
    diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 1.3 + vec3(0.05, 0.03, 0.03), gEdge * 0.7);
    diffuseColor.rgb *= 1.0 - 0.6 * crack;
    gGrout = max(gGrout, crack);
  }`,
  // laminate: cup rings and wipe marks on the top
  laminate: /* glsl */ `
  {
    vec2 cell = floor(vWPos.xz / 0.3);
    vec2 c = (cell + 0.25 + 0.5 * vec2(h12(cell + 3.1), h12(cell + 8.4))) * 0.3;
    float r = length(vWPos.xz - c);
    float r0 = 0.03 + 0.015 * h12(cell + 1.9);
    float ring = (1.0 - smoothstep(0.0, 0.003, abs(r - r0))) * step(0.72, h12(cell + 4.4)) * (0.5 + 0.5 * vnoise(vWPos * 90.0));
    float wipe = smoothstep(0.6, 0.85, vnoise(vec3(vWPos.x * 6.0 + vWPos.z * 2.0, 0.0, vWPos.z * 30.0)));
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.42, 0.33, 0.22), ring * 0.45);
    diffuseColor.rgb *= 1.0 - 0.06 * wipe;
  }`,
  // cast concrete: chipped arrises showing paler aggregate, rain-like streaks running down from the lip
  planter: /* glsl */ `
  {
    vec3 aggregate = vec3(0.78, 0.76, 0.7) * (0.7 + 0.6 * h13(floor(vWPos * 400.0)));
    diffuseColor.rgb = mix(diffuseColor.rgb, aggregate, gEdge * 0.8);
    float streak = smoothstep(0.55, 0.9, vnoise(vec3(vWPos.x * 45.0, vWPos.y * 2.0, vWPos.z * 45.0))) * smoothstep(0.05, 0.45, mod(vWPos.y + 0.001, 5.0));
    diffuseColor.rgb *= 1.0 - 0.3 * streak;
  }`,
};
// Leaf detail from the leaf's own coordinates (vLeaf: along 0 at the stalk to 1 at the tip, across 0..1, with the
// midrib at 0.5): a pale midrib, side veins sweeping toward the tip, yellowing and dry brown tips and margins.
const LEAF = /* glsl */ `
  {
    float along = vLeaf.x; float across = abs(vLeaf.y - 0.5) * 2.0;
    float rib = 1.0 - smoothstep(0.03, 0.07, across);
    float veins = (1.0 - smoothstep(0.0, 0.09, abs(fract((along - across * 0.35) * 7.0) - 0.5))) * (1.0 - rib) * (1.0 - smoothstep(0.75, 1.0, across));
    float n = vnoise(vWPos * 25.0);
    // dry tips and margins on about one leaf in four
    float dry = clamp(smoothstep(0.88, 0.99, along + n * 0.1) + smoothstep(0.9, 1.0, across + n * 0.15) * 0.7, 0.0, 1.0) * step(0.75, h13(floor(vWPos * 5.0)));
    // pale cream variegation along the middle, like the planters' broad-leaf plants in the photos
    float vari = smoothstep(0.7, 0.85, (1.0 - across) * 0.75 + vnoise(vec3(along * 11.0, across * 5.0, h13(floor(vWPos * 5.0)) * 50.0)) * 0.4) * smoothstep(0.08, 0.3, along) * (1.0 - smoothstep(0.7, 0.9, along));
    vec3 c = diffuseColor.rgb * mix(1.15, 0.8, along) * (0.85 + 0.3 * n);
    c = mix(c, diffuseColor.rgb * vec3(1.9, 1.75, 1.0), vari * 0.55);
    c = mix(c, c * vec3(1.35, 1.3, 0.75), rib * 0.6);
    c = mix(c, c * 0.72, veins * 0.6);
    c = mix(c, vec3(0.36, 0.26, 0.11), dry * 0.85);
    diffuseColor.rgb = c;
    gGrout = veins + rib;
  }
`;

// Normal perturbation, run after the normal map chunk (kit pieces only).
const NORMAL: Partial<Record<Kind, string>> = {
  vinyl: "normal = bumpN(normal, (vnoise(vWPos * 260.0) * 0.5 + vnoise(vWPos * 90.0) * 0.5) * 0.0007 + 0.0014 * fbm(vWPos * 18.0));",
  molded: "normal = bumpN(normal, vnoise(vWPos * 160.0) * 0.0003 + 0.0006 * vnoise(vWPos * 60.0));",
  painted: "normal = bumpN(normal, vnoise(vWPos * 300.0) * 0.0004 - gGrout * 0.0008);",
  laminate: "normal = bumpN(normal, vnoise(vWPos * 500.0) * 0.00025);",
};

// With the bake: dents, and chips that sit a hair below the surface around them.
const WEAR_NORMAL = "normal = bumpN(normal, -gEdge * 0.0005 - 0.0012 * smoothstep(0.7, 0.95, vnoise(vWPos * 11.0)));";
const LEAF_NORMAL = "normal = bumpN(normal, gGrout * 0.0004);";
const WEAR_ROUGH: Partial<Record<Kind, string>> = {
  painted: "roughnessFactor = mix(mix(roughnessFactor, 0.35, gEdge), 0.95, gGrime * 0.7);",
  molded: "roughnessFactor = mix(mix(roughnessFactor, 0.7, gEdge), 0.9, gGrime * 0.6);",
  vinyl: "roughnessFactor = mix(mix(roughnessFactor, 0.22, gEdge), 0.85, gGrime * 0.6);",
  laminate: "roughnessFactor = mix(roughnessFactor, 0.9, gGrime * 0.6);",
  planter: "roughnessFactor = mix(roughnessFactor, 1.0, gGrime * 0.5);",
};
const WEAR_METAL: Partial<Record<Kind, string>> = {
  painted: "metalnessFactor = mix(metalnessFactor, 0.85, gEdge);",
};

const SLAB = "vec3(0.3, 0.29, 0.27)"; // the underside of a floor
const BACK: Partial<Record<Kind, string>> = {
  porcelain: SLAB,
  porcelain45: SLAB,
  tile: SLAB,
  concrete: SLAB,
  panels: "vec3(0.12, 0.12, 0.13)", // the top of a ceiling, seen from the floor above
};

const ROUGHNESS: Partial<Record<Kind, string>> = {
  porcelain: "roughnessFactor = mix(mix(0.26, 0.1, gBlack), 0.85, gGrout);",
  porcelain45: "roughnessFactor = mix(mix(0.26, 0.1, gBlack), 0.85, gGrout);",
  tile: "roughnessFactor = mix(0.3, 0.85, gGrout);",
  concrete: "roughnessFactor = mix(0.92, 0.55, gGrout);",
  gravel: "roughnessFactor = mix(0.55, 0.95, gGrout);",
  vinyl: "roughnessFactor = mix(0.34, 0.62, gGrout);",
  molded: "roughnessFactor = mix(0.26, 0.6, gGrout);",
  painted: "roughnessFactor = mix(0.55, 0.3, gGrout);",
  laminate: "roughnessFactor = mix(0.3, 0.5, gGrout);",
};

/** `wear`: the geometry carries the kit bake (_wear). `leaf`: it also carries leaf coordinates (uv). */
function patch(material: THREE.Material, kind: Kind, wear: boolean, leaf: boolean) {
  const m = material as THREE.MeshStandardMaterial;
  const varyings = `varying vec3 vWPos;${wear ? "\nvarying vec3 vWear;" : ""}${leaf ? "\nvarying vec2 vLeaf;" : ""}`;
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\n${varyings}${wear ? "\nattribute vec3 _wear;" : ""}`)
      .replace("#include <uv_vertex>", `#include <uv_vertex>${wear ? "\nvWear = _wear;" : ""}${leaf ? "\nvLeaf = uv;" : ""}`)
      // instanced pieces (the kit) are placed by their instance matrix, so it counts toward the world position
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvec4 wp = vec4(position, 1.0);\n#ifdef USE_INSTANCING\nwp = instanceMatrix * wp;\n#endif\nvWPos = (modelMatrix * wp).xyz;");
    // Floors and ceilings are double-sided: their back is a slab seen from the other floor.
    const back = BACK[kind];
    let color = back ? `if (!gl_FrontFacing) { diffuseColor.rgb = ${back}; } else ${COLOR[kind]}` : COLOR[kind];
    if (leaf) color += LEAF;
    if (wear) color += WEAR_COMMON + (WEAR[kind] ?? "");
    const ao = AO_STRENGTH[kind];
    let frag = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${HEADER.replace("varying vec3 vWPos;", varyings)}${ao ? AO_FRAGMENT(ao) : ""}`)
      .replace("#include <color_fragment>", `#include <color_fragment>\n${color}`);
    if (ao) {
      shader.uniforms.bakedAO = bakedAO;
      frag = frag
        .replace("#include <aomap_fragment>", `#include <aomap_fragment>\nif (gl_FrontFacing) { float ao = aoAt(); reflectedLight.indirectDiffuse *= ao; reflectedLight.indirectSpecular *= ao; }`);
    }
    if (wear)
      // the baked occlusion dims the ambient light too, like the occlusion map of a textured prop
      frag = frag.replace("#include <aomap_fragment>", "#include <aomap_fragment>\nreflectedLight.indirectDiffuse *= mix(0.25, 1.0, vWear.x); reflectedLight.indirectSpecular *= vWear.x;");
    const normalMap = [NORMAL[kind], wear && !leaf ? WEAR_NORMAL : "", leaf ? LEAF_NORMAL : ""].join("\n");
    frag = frag.replace("#include <normal_fragment_maps>", `#include <normal_fragment_maps>\n${normalMap}`);
    const rough = [ROUGHNESS[kind] ?? "", wear ? (WEAR_ROUGH[kind] ?? "") : ""].join("\n");
    frag = frag.replace("#include <roughnessmap_fragment>", `#include <roughnessmap_fragment>\n${rough}`);
    if (wear && WEAR_METAL[kind]) frag = frag.replace("#include <metalnessmap_fragment>", `#include <metalnessmap_fragment>\n${WEAR_METAL[kind]}`);
    shader.fragmentShader = frag;
  };
  // Programs are cached by this key; the closure above differs per kind but its source does not.
  m.customProgramCacheKey = () => `mallstyle-${kind}${wear ? "-wear" : ""}${leaf ? "-leaf" : ""}`;
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
    const wear = !!o.geometry.attributes._wear;
    if (detail) patch(mat, kind, wear, wear && !!o.geometry.attributes.uv);
    else unpatch(mat);
  });
}
