import { Document, NodeIO } from "@gltf-transform/core";
import { EXTMeshoptCompression } from "@gltf-transform/extensions";
import { MeshoptEncoder } from "meshoptimizer";
import { writeFileSync, mkdirSync } from "node:fs";
import { OUT, FLOOR_H } from "./config.mts";
import { Geo, geos, boxGeo } from "./geo.mts";
import { stats } from "./shell.mts";
import { DOOR_T, doorData, buildDoors } from "./doors.mts";
import { MATERIALS } from "./palette.mts";

// Each material's geometry is cut into chunks (storey x square of CHUNK_SIZE meters) so the renderer can
// skip the ones outside the view. A triangle goes to the chunk that holds its centroid. Every chunk keeps
// the material's name as its node name: the runtime picks meshes (colliders, ground) by that name.
export const CHUNK_SIZE = Number(process.env.CHUNK_SIZE ?? 48);
export function chunks(g: Geo): Geo[] {
  const parts = new Map<string, { geo: Geo; remap: Map<number, number> }>();
  for (let t = 0; t < g.idx.length; t += 3) {
    const tri = [g.idx[t], g.idx[t + 1], g.idx[t + 2]];
    const c = [0, 1, 2].map((k) => (g.pos[tri[0] * 3 + k] + g.pos[tri[1] * 3 + k] + g.pos[tri[2] * 3 + k]) / 3);
    const key = `${Math.floor(c[1] / FLOOR_H)}:${Math.floor(c[0] / CHUNK_SIZE)}:${Math.floor(c[2] / CHUNK_SIZE)}`;
    let part = parts.get(key);
    if (!part) parts.set(key, (part = { geo: new Geo(), remap: new Map() }));
    for (const v of tri) {
      let n = part.remap.get(v);
      if (n === undefined) {
        n = part.geo.pos.length / 3;
        part.remap.set(v, n);
        part.geo.pos.push(g.pos[v * 3], g.pos[v * 3 + 1], g.pos[v * 3 + 2]);
        part.geo.nrm.push(g.nrm[v * 3], g.nrm[v * 3 + 1], g.nrm[v * 3 + 2]);
      }
      part.geo.idx.push(n);
    }
  }
  return [...parts.values()].map((p) => p.geo);
}


export async function writeGlb(doorNodes: ReturnType<typeof buildDoors>) {
const doc = new Document();
const buffer = doc.createBuffer();
const scene = doc.createScene("mall_blockout");
let triangles = 0;
let nodes = 0;
for (const [name, whole] of Object.entries(geos)) {
  const m = MATERIALS[name];
  const mat = doc
    .createMaterial(name)
    .setBaseColorFactor(m.color)
    .setRoughnessFactor(m.rough)
    .setMetallicFactor(0)
    .setDoubleSided(!!m.blend || !!m.double)
    .setAlphaMode(m.blend ? "BLEND" : "OPAQUE");
  for (const g of chunks(whole)) {
    const prim = doc
      .createPrimitive()
      .setMaterial(mat)
      .setAttribute("POSITION", doc.createAccessor().setType("VEC3").setArray(new Float32Array(g.pos)).setBuffer(buffer))
      .setAttribute("NORMAL", doc.createAccessor().setType("VEC3").setArray(new Float32Array(g.nrm)).setBuffer(buffer))
      .setIndices(doc.createAccessor().setType("SCALAR").setArray(new Uint32Array(g.idx)).setBuffer(buffer));
    const mesh = doc.createMesh(name).addPrimitive(prim);
    scene.addChild(doc.createNode(name).setMesh(mesh));
    triangles += g.idx.length / 3;
    nodes++;
  }
}

// Secret doors: same material as the walls, so a closed door disappears into them.
const doorMat = doc.createMaterial("doors").setBaseColorFactor(MATERIALS.walls.color).setRoughnessFactor(MATERIALS.walls.rough).setMetallicFactor(0);
for (const { d, y0, half, sx, sz } of doorNodes) {
  const root = doc
    .createNode(`door_${d.id}`)
    .setTranslation([d.x, y0, -d.y])
    .setExtras({ door: d.id, floor: d.floor - 1, axis: d.axis, width: d.width, ...(d.leadsTo ? { leadsTo: d.leadsTo } : {}) });
  // Leaf a hinges at the low end of the door line, leaf b at the high end; each reaches the centre.
  const leaves = d.axis === "x"
    ? [{ tag: "a", pivot: [-half, 0, 0], dir: [1, 0] }, { tag: "b", pivot: [half, 0, 0], dir: [-1, 0] }]
    : [{ tag: "a", pivot: [0, 0, half], dir: [0, -1] }, { tag: "b", pivot: [0, 0, -half], dir: [0, 1] }];
  for (const leaf of leaves) {
    // At +90 degrees about y a leaf pointing along (dx, dz) ends up pointing along (dz, -dx).
    const sign = leaf.dir[1] * sx - leaf.dir[0] * sz > 0 ? 1 : -1;
    const len = half; // leaves meet exactly at the centre: no slit
    const [ax0, ax1] = [Math.min(0, leaf.dir[0] * len), Math.max(0, leaf.dir[0] * len)];
    const [az0, az1] = [Math.min(0, leaf.dir[1] * len), Math.max(0, leaf.dir[1] * len)];
    const box = d.axis === "x"
      ? boxGeo(ax0, ax1, 0, doorData.height, -DOOR_T / 2, DOOR_T / 2)
      : boxGeo(-DOOR_T / 2, DOOR_T / 2, 0, doorData.height, az0, az1);
    const prim = doc
      .createPrimitive()
      .setMaterial(doorMat)
      .setAttribute("POSITION", doc.createAccessor().setType("VEC3").setArray(new Float32Array(box.pos)).setBuffer(buffer))
      .setAttribute("NORMAL", doc.createAccessor().setType("VEC3").setArray(new Float32Array(box.nrm)).setBuffer(buffer))
      .setIndices(doc.createAccessor().setType("SCALAR").setArray(new Uint32Array(box.idx)).setBuffer(buffer));
    const pivot = doc
      .createNode(`door_${d.id}_${leaf.tag}`)
      .setTranslation(leaf.pivot as [number, number, number])
      .setMesh(doc.createMesh(`door_${d.id}_${leaf.tag}`).addPrimitive(prim))
      .setExtras({ leaf: true, sign });
    root.addChild(pivot);
    triangles += box.idx.length / 3;
  }
  scene.addChild(root);
}

mkdirSync("public/models", { recursive: true });
// Meshopt compression of the vertex data only (no quantization): the runtime builds its collision BVH from
// these positions, so they have to stay plain floats. The runtime needs the meshopt decoder to read it.
await MeshoptEncoder.ready;
doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.FILTER });
const bytes = await new NodeIO().registerExtensions([EXTMeshoptCompression]).registerDependencies({ "meshopt.encoder": MeshoptEncoder }).writeBinary(doc);
writeFileSync(OUT, bytes);
console.log(`wrote ${OUT}: ${(bytes.byteLength / 1024).toFixed(0)} KB, ${triangles} triangles, ${nodes} chunks`);
console.log("walkable cells per floor:", stats.walkable.join(", "));

}
