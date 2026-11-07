// The far version of a kit piece: the same parts, simplified by meshoptimizer to a fixed error in meters, so a
// table seen from across the food court costs a fraction of its triangles. Parts smaller than the error (bolts,
// rivets, glides) are pruned away, since they are under a pixel at that distance. The baked wear and the leaf
// coordinates ride along as vertex attributes, so the far version wears the same way.
import { MeshoptSimplifier } from "meshoptimizer";
import { Geo } from "../blockout/geo.mts";

// How much a change in an attribute counts against the position error (meters per unit of attribute).
const NORMAL_WEIGHT = 0.004;
const WEAR_WEIGHT = 0.1;
const UV_WEIGHT = 0.002;

const r = (v: number, s: number) => Math.round(v * s);

/** Vertices that agree on everything merged, so the simplifier sees surfaces instead of separate quads (the
 *  generators emit four vertices per quad). Corners where the normal turns stay split: those are real edges. */
function welded(g: Geo, wear: number[]): { g: Geo; wear: number[] } {
  const count = g.pos.length / 3;
  const out = new Geo();
  const outWear: number[] = [];
  if (g.uv) out.uv = [];
  const seen = new Map<string, number>();
  const map = new Int32Array(count);
  for (let i = 0; i < count; i++) {
    const p = [0, 1, 2].map((k) => g.pos[i * 3 + k]);
    const n = [0, 1, 2].map((k) => g.nrm[i * 3 + k]);
    const w = [0, 1, 2].map((k) => wear[i * 3 + k]);
    const t = g.uv ? [g.uv[i * 2] ?? 0, g.uv[i * 2 + 1] ?? 0] : [];
    const key = [...p.map((v) => r(v, 1e5)), ...n.map((v) => r(v, 1e3)), ...w.map((v) => r(v, 1e3)), ...t.map((v) => r(v, 1e4))].join(",");
    let j = seen.get(key);
    if (j === undefined) {
      seen.set(key, (j = seen.size));
      out.pos.push(...p);
      out.nrm.push(...n);
      outWear.push(...w);
      if (out.uv) out.uv.push(...t);
    }
    map[i] = j;
  }
  for (let t = 0; t < g.idx.length; t += 3) {
    const [a, b, c] = [map[g.idx[t]], map[g.idx[t + 1]], map[g.idx[t + 2]]];
    if (a !== b && b !== c && c !== a) out.idx.push(a, b, c);
  }
  return { g: out, wear: outWear };
}

/** `g` simplified to within `error` meters, with its wear (three numbers per vertex). Null if nothing is left. */
export async function simplified(g: Geo, wear: number[], error: number): Promise<{ g: Geo; wear: number[] } | null> {
  await MeshoptSimplifier.ready;
  ({ g, wear } = welded(g, wear));
  const count = g.pos.length / 3;
  const uv = g.uv;
  const stride = 6 + (uv ? 2 : 0);
  const attrs = new Float32Array(count * stride);
  for (let i = 0; i < count; i++) {
    for (let k = 0; k < 3; k++) {
      attrs[i * stride + k] = g.nrm[i * 3 + k];
      attrs[i * stride + 3 + k] = wear[i * 3 + k];
    }
    if (uv) for (let k = 0; k < 2; k++) attrs[i * stride + 6 + k] = uv[i * 2 + k];
  }
  const weights = [...Array(3).fill(NORMAL_WEIGHT), ...Array(3).fill(WEAR_WEIGHT), ...(uv ? [UV_WEIGHT, UV_WEIGHT] : [])];
  const [idx] = MeshoptSimplifier.simplifyWithAttributes(new Uint32Array(g.idx), new Float32Array(g.pos), 3, attrs, stride, weights, null, 0, error, ["ErrorAbsolute", "Prune"]);
  if (!idx.length) return null;

  // keep only the vertices still in use
  const remap = new Map<number, number>();
  const out = new Geo();
  const outWear: number[] = [];
  if (uv) out.uv = [];
  for (const i of idx) {
    let j = remap.get(i);
    if (j === undefined) {
      remap.set(i, (j = remap.size));
      out.pos.push(g.pos[i * 3], g.pos[i * 3 + 1], g.pos[i * 3 + 2]);
      out.nrm.push(g.nrm[i * 3], g.nrm[i * 3 + 1], g.nrm[i * 3 + 2]);
      outWear.push(wear[i * 3], wear[i * 3 + 1], wear[i * 3 + 2]);
      if (uv) out.uv!.push(uv[i * 2], uv[i * 2 + 1]);
    }
    out.idx.push(j);
  }
  return { g: out, wear: outWear };
}
