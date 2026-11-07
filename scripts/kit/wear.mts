// Baked wear for kit pieces, the stand-in for the texture sets the reference props carry (a base color, normal
// and occlusion/roughness map per prop: grime in every recess, paint rubbed through on every edge). Our pieces are
// generated with no UVs, so instead each vertex gets three numbers, written to the GLB as the _WEAR attribute:
//   x = ambient occlusion (1 open, 0 buried): rays against the whole piece, the floor and, for wall pieces, the wall
//   y = convex edge (0 flat, 1 a tight rounded or sharp outside edge): where paint and plastic wear through
//   z = concave crease (0 flat, 1 a tight inside corner): where dirt collects
// src/engine/materials.ts turns these into chipped edges, rubbed corners and grime, on top of its own surface
// detail. So the bake has something to hold on to, long edges are split first (refine), which only adds points
// on flat faces: the shape does not change.
import * as THREE from "three";
import { MeshBVH } from "three-mesh-bvh";
import { Geo } from "../blockout/geo.mts";

/** Splits every edge longer than `max` (meters) at its middle until none is left. Neighbours agree on which edges
 *  to split (the rule depends only on the edge), so no cracks open between them. */
export function refine(g: Geo, max: number): Geo {
  const pos = g.pos.slice();
  const nrm = g.nrm.slice();
  const uv = g.uv ? g.uv.slice() : undefined;
  if (uv) while (uv.length < (pos.length / 3) * 2) uv.push(0);
  let tris = g.idx.slice();
  const len2 = (a: number, b: number) => (pos[a * 3] - pos[b * 3]) ** 2 + (pos[a * 3 + 1] - pos[b * 3 + 1]) ** 2 + (pos[a * 3 + 2] - pos[b * 3 + 2]) ** 2;
  const mids = new Map<number, number>();
  const mid = (a: number, b: number) => {
    const key = Math.min(a, b) * 4194304 + Math.max(a, b);
    let m = mids.get(key);
    if (m !== undefined) return m;
    m = pos.length / 3;
    for (let k = 0; k < 3; k++) pos.push((pos[a * 3 + k] + pos[b * 3 + k]) / 2);
    const n = [0, 1, 2].map((k) => nrm[a * 3 + k] + nrm[b * 3 + k]);
    const l = Math.hypot(...n) || 1;
    nrm.push(n[0] / l, n[1] / l, n[2] / l);
    if (uv) uv.push((uv[a * 2] + uv[b * 2]) / 2, (uv[a * 2 + 1] + uv[b * 2 + 1]) / 2);
    mids.set(key, m);
    return m;
  };
  const max2 = max * max;
  for (let pass = 0; pass < 8; pass++) {
    const out: number[] = [];
    let split = false;
    for (let t = 0; t < tris.length; t += 3) {
      let [a, b, c] = [tris[t], tris[t + 1], tris[t + 2]];
      let long = [len2(a, b) > max2, len2(b, c) > max2, len2(c, a) > max2];
      const count = long.filter(Boolean).length;
      if (count === 0) {
        out.push(a, b, c);
        continue;
      }
      split = true;
      // rotate so the split edges come first: a-b always split; for two, b-c too
      while (!(long[0] && (count < 2 || long[1]) && (count < 3 || long[2]) && (count !== 1 || !long[1]))) {
        [a, b, c] = [b, c, a];
        long = [long[1], long[2], long[0]];
      }
      const ab = mid(a, b);
      if (count === 1) out.push(a, ab, c, ab, b, c);
      else if (count === 2) {
        const bc = mid(b, c);
        out.push(a, ab, bc, ab, b, bc, a, bc, c);
      } else {
        const bc = mid(b, c);
        const ca = mid(c, a);
        out.push(a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca);
      }
    }
    tris = out;
    if (!split) break;
  }
  const r = new Geo();
  r.pos = pos;
  r.nrm = nrm;
  r.idx = tris;
  if (uv) r.uv = uv;
  return r;
}

/** Points on a hemisphere around +z, denser toward the pole (cosine weighted), the same for every vertex. */
const RAYS = (() => {
  const out: THREE.Vector3[] = [];
  const n = 40;
  for (let i = 0; i < n; i++) {
    const r = Math.sqrt((i + 0.5) / n);
    const a = i * 2.39996;
    out.push(new THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r, Math.sqrt(1 - r * r)));
  }
  return out;
})();
const REACH = 0.22; // occluders farther than this do not count (meters)
const EDGE_RADIUS = 50; // curvature (1/m) that reads as "half worn": 2 cm round-over
const SHARP = 1 / 0.004; // a hard edge counts as a 4 mm round-over

const key = (p: number[], i: number) => `${Math.round(p[i * 3] * 1e4)},${Math.round(p[i * 3 + 1] * 1e4)},${Math.round(p[i * 3 + 2] * 1e4)}`;

/**
 * Wear for every part of a piece (same order as the parts), three numbers per vertex.
 * `wallX`: a wall piece's back plane (local x), which shades the back like a real wall would.
 */
export function bakeWear(parts: Geo[], wallX?: number): number[][] {
  // occluders: every part, plus the floor and the wall
  const all: number[] = [];
  const allIdx: number[] = [];
  for (const g of parts) {
    const base = all.length / 3;
    all.push(...g.pos);
    for (const k of g.idx) allIdx.push(base + k);
  }
  const quad = (a: number[], b: number[], c: number[], d: number[]) => {
    const base = all.length / 3;
    all.push(...a, ...b, ...c, ...d);
    allIdx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  quad([-4, -0.0005, -4], [4, -0.0005, -4], [4, -0.0005, 4], [-4, -0.0005, 4]);
  if (wallX !== undefined) quad([wallX - 0.002, 0, -4], [wallX - 0.002, 4, -4], [wallX - 0.002, 4, 4], [wallX - 0.002, 0, 4]);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(all, 3));
  geometry.setIndex(allIdx);
  const bvh = new MeshBVH(geometry);
  const ray = new THREE.Ray();
  const n = new THREE.Vector3();
  const t1 = new THREE.Vector3();
  const t2 = new THREE.Vector3();
  const dir = new THREE.Vector3();

  return parts.map((g) => {
    const count = g.pos.length / 3;
    // AO, once per distinct point and normal
    const aoCache = new Map<string, number>();
    const ao = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const k = `${key(g.pos, i)}|${key(g.nrm, i)}`;
      let v = aoCache.get(k);
      if (v === undefined) {
        n.fromArray(g.nrm, i * 3).normalize();
        t1.set(Math.abs(n.x) < 0.9 ? 1 : 0, Math.abs(n.x) < 0.9 ? 0 : 1, 0).cross(n).normalize();
        t2.crossVectors(n, t1);
        let hidden = 0;
        for (const d of RAYS) {
          dir.set(0, 0, 0).addScaledVector(t1, d.x).addScaledVector(t2, d.y).addScaledVector(n, d.z);
          ray.origin.fromArray(g.pos, i * 3).addScaledVector(n, 0.0015);
          ray.direction.copy(dir);
          const hit = bvh.raycastFirst(ray, THREE.DoubleSide, 0, REACH);
          if (hit) hidden += 1 - hit.distance / REACH;
        }
        v = 1 - Math.min(1, (hidden / RAYS.length) * 1.6);
        aoCache.set(k, v);
      }
      ao[i] = v;
    }

    // Curvature per point (all the vertices at one place, whatever their normal): along every triangle edge,
    // how fast the normal turns, signed (+ convex). Where one point carries two normals (a hard edge), the
    // angle between them over a 4 mm round-over, signed by which way the faces meet.
    const group = new Map<string, number>();
    const gid = new Int32Array(count);
    for (let i = 0; i < count; i++) {
      const k = key(g.pos, i);
      let id = group.get(k);
      if (id === undefined) group.set(k, (id = group.size));
      gid[i] = id;
    }
    const sum = new Float64Array(group.size);
    const num = new Float64Array(group.size);
    const sharpCvx = new Float64Array(group.size);
    const sharpCcv = new Float64Array(group.size);
    const P = (i: number) => [g.pos[i * 3], g.pos[i * 3 + 1], g.pos[i * 3 + 2]];
    const N = (i: number) => [g.nrm[i * 3], g.nrm[i * 3 + 1], g.nrm[i * 3 + 2]];
    const members: number[][] = Array.from({ length: group.size }, () => []);
    const centroid: number[][] = new Array(count);
    for (let t = 0; t < g.idx.length; t += 3) {
      const tri = [g.idx[t], g.idx[t + 1], g.idx[t + 2]];
      const c = [0, 1, 2].map((k) => (g.pos[tri[0] * 3 + k] + g.pos[tri[1] * 3 + k] + g.pos[tri[2] * 3 + k]) / 3);
      for (let e = 0; e < 3; e++) {
        const i = tri[e];
        const j = tri[(e + 1) % 3];
        centroid[i] ??= c;
        const pi = P(i), pj = P(j), ni = N(i), nj = N(j);
        const d = [pj[0] - pi[0], pj[1] - pi[1], pj[2] - pi[2]];
        const l2 = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
        if (l2 < 1e-10) continue;
        const k = ((nj[0] - ni[0]) * d[0] + (nj[1] - ni[1]) * d[1] + (nj[2] - ni[2]) * d[2]) / l2;
        for (const v of [i, j]) {
          sum[gid[v]] += k;
          num[gid[v]] += 1;
        }
      }
    }
    for (let i = 0; i < count; i++) members[gid[i]].push(i);
    members.forEach((list, id) => {
      for (const i of list)
        for (const j of list) {
          if (i >= j) continue;
          const ni = N(i), nj = N(j);
          const cos = ni[0] * nj[0] + ni[1] * nj[1] + ni[2] * nj[2];
          if (cos > 0.9 || !centroid[i]) continue; // the same surface (or near it)
          const angle = Math.acos(Math.max(-1, Math.min(1, cos)));
          const p = P(i);
          const c = centroid[i];
          // convex if the other face's normal points away from this face's inside
          const convex = nj[0] * (c[0] - p[0]) + nj[1] * (c[1] - p[1]) + nj[2] * (c[2] - p[2]) < 0;
          const k = (angle / (Math.PI / 2)) * SHARP;
          if (convex) sharpCvx[id] = Math.max(sharpCvx[id], k);
          else sharpCcv[id] = Math.max(sharpCcv[id], k);
        }
    });
    const squash = (k: number) => Math.min(1, Math.log2(1 + Math.max(0, k) / EDGE_RADIUS) / Math.log2(3));
    const out: number[] = [];
    for (let i = 0; i < count; i++) {
      const id = gid[i];
      const k = num[id] ? sum[id] / num[id] : 0;
      out.push(ao[i], squash(Math.max(k, sharpCvx[id])), squash(Math.max(-k, sharpCcv[id])));
    }
    return out;
  });
}
