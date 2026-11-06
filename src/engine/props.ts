import * as THREE from "three";

// Kit pieces placed through the mall (see scripts/kit/pieces.mts and scripts/build-props.mts). Each piece is a
// small GLB with one mesh per material plus a "collider" mesh (material "barrier"). Every piece is drawn with
// one InstancedMesh per floor, so a few hundred tables cost a handful of draw calls and culling still works
// per floor, and every instance contributes its collider to the player's collision. No DOM in here, so the walk
// test (scripts/test-walk.mts) builds props the same way the game does.

export interface PropsManifest {
  pieces: Record<string, string>;
  /** Per piece: flat groups of [x, y, z, yaw]. */
  instances: Record<string, number[]>;
}

export interface Props {
  group: THREE.Group;
  /** The colliders of every instance, in world space, positions only. */
  colliders: THREE.BufferGeometry[];
}

const STRIDE = 4;

/**
 * A collider as plain positions and an index in world space. Built from scratch, not cloned: how a file stores
 * its vertex data (interleaved or not) must not matter, because every collider is merged into one BVH.
 */
function worldCollider(src: THREE.BufferGeometry, m: THREE.Matrix4): THREE.BufferGeometry {
  const pos = src.attributes.position;
  const out = new Float32Array(pos.count * 3);
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) v.fromBufferAttribute(pos, i).applyMatrix4(m).toArray(out, i * 3);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(out, 3));
  if (src.index) g.setIndex(new THREE.BufferAttribute(Uint32Array.from(src.index.array), 1));
  return g;
}
const COLLIDER_MATERIAL = "barrier";

export async function buildProps(manifest: PropsManifest, loadPiece: (url: string) => Promise<THREE.Object3D>): Promise<Props> {
  const group = new THREE.Group();
  group.name = "props";
  const colliders: THREE.BufferGeometry[] = [];
  const up = new THREE.Vector3(0, 1, 0);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const p = new THREE.Vector3();
  const one = new THREE.Vector3(1, 1, 1);

  for (const [name, url] of Object.entries(manifest.pieces)) {
    const flat = manifest.instances[name];
    if (!flat?.length) continue;
    const root = await loadPiece(url);
    const visible: THREE.Mesh[] = [];
    const solid: THREE.Mesh[] = [];
    root.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      ((o.material as THREE.Material).name === COLLIDER_MATERIAL ? solid : visible).push(o);
    });

    // One bucket per floor (instances of a piece at the same height).
    const buckets = new Map<number, THREE.Matrix4[]>();
    for (let i = 0; i < flat.length; i += STRIDE) {
      q.setFromAxisAngle(up, flat[i + 3]);
      m.compose(p.set(flat[i], flat[i + 1], flat[i + 2]), q, one);
      (buckets.get(flat[i + 1]) ?? buckets.set(flat[i + 1], []).get(flat[i + 1])!).push(m.clone());
    }
    for (const [y, matrices] of buckets) {
      for (const mesh of visible) {
        const inst = new THREE.InstancedMesh(mesh.geometry, mesh.material, matrices.length);
        inst.name = `${name}:${(mesh.material as THREE.Material).name}@${y}`;
        matrices.forEach((mx, k) => inst.setMatrixAt(k, mx));
        inst.instanceMatrix.needsUpdate = true;
        inst.computeBoundingSphere(); // culling is per floor and piece
        group.add(inst);
      }
      for (const mesh of solid)
        for (const mx of matrices) colliders.push(worldCollider(mesh.geometry, mx));
    }
  }
  return { group, colliders };
}

/** Fetches the manifest and builds the props, or returns null if there is no props file (a mall without props is fine). */
export async function loadProps(manifestUrl: string, loadPiece: (url: string) => Promise<THREE.Object3D>): Promise<Props | null> {
  const res = await fetch(manifestUrl);
  if (!res.ok) return null;
  return buildProps((await res.json()) as PropsManifest, loadPiece);
}
