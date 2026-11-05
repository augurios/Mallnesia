/** sRGB hex to the linear factors glTF expects. */
export const hex = (h: string, alpha = 1): [number, number, number, number] => {
  const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const n = parseInt(h.slice(1), 16);
  return [lin(((n >> 16) & 255) / 255), lin(((n >> 8) & 255) / 255), lin((n & 255) / 255), alpha];
};

// Base colors are the surfaces' own colors from docs/art_style_reference.md (muted, as photographed), not
// the night: darkness comes from the lighting. Surface detail (tiles, plaster, panels) is added at run time
// by src/engine/materials.ts, keyed by these material names.
export const MATERIALS: Record<string, { color: [number, number, number, number]; rough: number; blend?: boolean; double?: boolean }> = {
  // Floors and ceilings are drawn on both sides (their back is the slab seen from the other floor).
  floors: { color: hex("#b4b1a8"), rough: 0.3, double: true }, // glossy off-white porcelain
  floor_atrium: { color: hex("#aaa79e"), rough: 0.3, double: true },
  floor_bath: { color: hex("#7f8a88"), rough: 0.35, double: true },
  floor_garage: { color: hex("#817c77"), rough: 0.95, double: true }, // patched concrete
  ceilings: { color: hex("#9a9890"), rough: 0.9, double: true },
  slab: { color: hex("#a8a59c"), rough: 0.92 }, // the edge band of a floor structure, plaster like the walls
  roof: { color: hex("#797872"), rough: 0.8 }, // painted steel truss
  walls: { color: hex("#a8a59c"), rough: 0.92 }, // near-white plaster, slightly warm
  glass: { color: [0.5, 0.65, 0.8, 0.22], rough: 0.05, blend: true },
  rails: { color: [0.5, 0.65, 0.8, 0.28], rough: 0.05, blend: true },
  stairs: { color: hex("#aca8a3"), rough: 0.7 },
  steel: { color: hex("#1d1d21"), rough: 0.45 },
  chrome: { color: hex("#a4a7ac"), rough: 0.22 }, // stainless handrails and posts
  barrier: { color: [1, 1, 1, 0], rough: 1, blend: true }, // never drawn: the runtime hides it, but it still collides
  fascia: { color: hex("#5b565a"), rough: 0.7 },
  lamp: { color: hex("#c9c9c2"), rough: 0.6 },
  column: { color: hex("#656363"), rough: 0.6 }, // painted mid-grey
  elev: { color: hex("#1b1a1a"), rough: 0.2 }, // black glass shafts
  garden: { color: hex("#3c5b34"), rough: 0.8, double: true }, // leaves are one-sided ribbons
  garden_dark: { color: hex("#223f27"), rough: 0.8, double: true },
  stone: { color: hex("#555759"), rough: 0.9 }, // boulders
  planter: { color: hex("#8d887e"), rough: 0.85 }, // concrete planters
  gravel: { color: hex("#837d72"), rough: 0.9 }, // river-stone beds (pattern added in materials.ts)
};
