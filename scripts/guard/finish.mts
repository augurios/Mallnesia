// Last step of the guard build (see scripts/guard/build.sh): tidies the glTF that Blender wrote and compresses it.
//   node scripts/guard/finish.mts <in.glb> <out.glb>
// Hair, eyebrows and eyelashes become alpha-tested (cut-out) instead of blended, so they sort correctly in the dark
// scene; everything else is opaque. Geometry and animation are meshopt-compressed (the game's loader decodes it).
import { NodeIO } from "@gltf-transform/core";
import { EXTMeshoptCompression, KHRMaterialsSpecular, KHRMaterialsIOR } from "@gltf-transform/extensions";
import { dedup, prune, resample, weld } from "@gltf-transform/functions";
import { MeshoptEncoder } from "meshoptimizer";

const [input, output] = process.argv.slice(2);
if (!input || !output) throw new Error("usage: finish.mts <in.glb> <out.glb>");
await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions([EXTMeshoptCompression, KHRMaterialsSpecular, KHRMaterialsIOR]).registerDependencies({ "meshopt.encoder": MeshoptEncoder });
const doc = await io.read(input);
const root = doc.getRoot();

for (const m of root.listMaterials()) {
  const name = m.getName();
  // the girl in white's tulle veil is see-through: blended, both sides
  if (/veil$/i.test(name)) {
    m.setAlphaMode("BLEND").setDoubleSided(true);
    continue;
  }
  const cutout = /short|hair|braid|eyebrow|eyelash|lace|collar|cuff|rags/i.test(name);
  m.setAlphaMode(cutout ? "MASK" : "OPAQUE");
  if (cutout) m.setAlphaCutoff(0.45).setDoubleSided(true);
  if (/skirt|sash/i.test(name)) m.setDoubleSided(true); // seen from below and inside
}
for (const ext of root.listExtensionsUsed()) if (ext instanceof KHRMaterialsSpecular || ext instanceof KHRMaterialsIOR) ext.dispose();

await doc.transform(dedup(), weld(), resample(), prune());
if (!process.env.NO_MESHOPT) doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.FILTER });
await io.write(output, doc);

const tris = root.listMeshes().reduce((n, mesh) => n + mesh.listPrimitives().reduce((k, p) => k + (p.getIndices()?.getCount() ?? 0) / 3, 0), 0);
console.log(`${output}: ${root.listAnimations().map((a) => a.getName()).join(", ")}; ${Math.round(tris)} triangles`);
