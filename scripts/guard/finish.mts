// Last step of the guard build (see scripts/guard/build.sh), and of the girl's: tidies the glTF that Blender wrote and
// compresses it.
//   node scripts/guard/finish.mts <in.glb> <out.glb>
// Hair, eyebrows and eyelashes become alpha-tested (cut-out) instead of blended, so they sort correctly in the dark
// scene; everything else is opaque. The vertex data is quantized (KHR_mesh_quantization: 14-bit positions, 10-bit
// normals, 12-bit UVs, 8-bit weights, over one volume for the whole model so all its meshes keep sharing one skin), then
// geometry and animation are meshopt-compressed (the game's loader decodes both). It also reads files that are already
// compressed, so a committed model can be finished again without Blender (only once: quantizing twice loses precision).
import { NodeIO } from "@gltf-transform/core";
import { EXTMeshoptCompression, KHRMaterialsSpecular, KHRMaterialsIOR, KHRMeshQuantization } from "@gltf-transform/extensions";
import { dedup, meshopt, prune, resample, weld } from "@gltf-transform/functions";
import { MeshoptDecoder, MeshoptEncoder } from "meshoptimizer";

const [input, output] = process.argv.slice(2);
if (!input || !output) throw new Error("usage: finish.mts <in.glb> <out.glb>");
await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready]);
const io = new NodeIO()
  .registerExtensions([EXTMeshoptCompression, KHRMeshQuantization, KHRMaterialsSpecular, KHRMaterialsIOR])
  .registerDependencies({ "meshopt.encoder": MeshoptEncoder, "meshopt.decoder": MeshoptDecoder });
const doc = await io.read(input);
const root = doc.getRoot();
if (root.listExtensionsUsed().some((ext) => ext instanceof KHRMeshQuantization)) throw new Error(`${input} is quantized already: finish the model Blender wrote instead`);

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
if (!process.env.NO_MESHOPT) await doc.transform(meshopt({ encoder: MeshoptEncoder, level: "medium", quantizationVolume: "scene" }));
await io.write(output, doc);

const tris = root.listMeshes().reduce((n, mesh) => n + mesh.listPrimitives().reduce((k, p) => k + (p.getIndices()?.getCount() ?? 0) / 3, 0), 0);
console.log(`${output}: ${root.listAnimations().map((a) => a.getName()).join(", ")}; ${Math.round(tris)} triangles`);
