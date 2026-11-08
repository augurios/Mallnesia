import * as THREE from "three";

// Kit pieces placed through the mall (see scripts/kit/pieces.mts and scripts/build-props.mts). Each piece is a
// small GLB with one mesh per material, optionally a far version of each ("<material>_far" nodes, simplified
// at build time), plus a "collider" mesh (material "barrier"). Every piece is drawn with two InstancedMeshes per
// floor and material, near and far, so a few hundred tables cost a handful of draw calls. Each frame, update()
// sends every instance to near or far by its distance from the camera, or skips it when it is outside the view
// or past the draw distance (in the fog). Every instance contributes its collider to the player's collision,
// drawn or not. No DOM in here, so the walk test (scripts/test-walk.mts) builds props the same way the game does.

export interface PropsManifest {
  pieces: Record<string, string>;
  /** Per piece: flat groups of [x, y, z, yaw]. */
  instances: Record<string, number[]>;
}

export interface Props {
  group: THREE.Group;
  /** The colliders of every instance, in world space, positions only. */
  colliders: THREE.BufferGeometry[];
  /** Where every piece stands: per piece, flat groups of [x, height, -y, yaw] (the manifest's own numbers). */
  instances: Record<string, number[]>;
  /** Picks near, far or not drawn for every instance, for this camera (its matrices up to date). Meters. */
  update(camera: THREE.Camera, lodDistance: number, drawDistance: number): void;
}

const STRIDE = 4;
const LOD_HYSTERESIS = 1; // meters: a piece that went near stays near this much past the LOD distance, so it never flickers
const FAR_SUFFIX = "_far";

/** One version of a piece on one floor: its meshes share one matrix buffer, filled with the instances drawn. */
interface Level {
  meshes: THREE.InstancedMesh[];
  matrix: THREE.InstancedBufferAttribute;
  /** Which instance sits in each slot of the buffer, as of the last update. */
  slots: Int32Array;
  count: number;
}

/** One piece on one floor. */
interface Bucket {
  matrices: THREE.Matrix4[];
  /** World bounding sphere centres, one per instance; all share `radius`. */
  centers: THREE.Vector3[];
  radius: number;
  near: Level;
  far: Level | null;
  /** Last level per instance: 0 near, 1 far (for the hysteresis). */
  wasFar: Uint8Array;
}

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

export async function buildProps(manifest: PropsManifest, loadPiece: (url: string) => Promise<THREE.Object3D>, onProgress?: (done: number, total: number) => void): Promise<Props> {
  const group = new THREE.Group();
  group.name = "props";
  const colliders: THREE.BufferGeometry[] = [];
  const up = new THREE.Vector3(0, 1, 0);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const p = new THREE.Vector3();
  const one = new THREE.Vector3(1, 1, 1);

  const buckets: Bucket[] = [];
  // Until the first update every instance is drawn near (the walk test never calls update), and none far.
  const level = (meshes: THREE.Mesh[], name: string, y: number, matrices: THREE.Matrix4[], filled: boolean): Level => {
    const array = new Float32Array(matrices.length * 16);
    if (filled) matrices.forEach((mx, k) => mx.toArray(array, k * 16));
    const matrix = new THREE.InstancedBufferAttribute(array, 16);
    const out: Level = { meshes: [], matrix, slots: Int32Array.from(matrices, (_, k) => (filled ? k : -1)), count: filled ? matrices.length : 0 };
    for (const mesh of meshes) {
      const inst = new THREE.InstancedMesh(mesh.geometry, mesh.material, matrices.length);
      inst.count = out.count;
      inst.name = `${name}:${mesh.name}@${y}`;
      inst.instanceMatrix = matrix; // shared by every material of this version
      inst.frustumCulled = false; // update() culls per instance
      group.add(inst);
      out.meshes.push(inst);
    }
    return out;
  };

  const used = Object.keys(manifest.pieces).filter((name) => manifest.instances[name]?.length).length;
  let loaded = 0;
  for (const [name, url] of Object.entries(manifest.pieces)) {
    const flat = manifest.instances[name];
    if (!flat?.length) continue;
    const root = await loadPiece(url);
    onProgress?.(++loaded, used);
    const near: THREE.Mesh[] = [];
    const far: THREE.Mesh[] = [];
    const solid: THREE.Mesh[] = [];
    root.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      if ((o.material as THREE.Material).name === COLLIDER_MATERIAL) solid.push(o);
      else (o.name.endsWith(FAR_SUFFIX) ? far : near).push(o);
    });
    // the piece's bounding sphere, around its own origin
    const box = new THREE.Box3();
    for (const mesh of near) {
      mesh.geometry.computeBoundingBox();
      box.union(mesh.geometry.boundingBox!);
    }
    const sphere = box.getBoundingSphere(new THREE.Sphere());

    // One bucket per floor (instances of a piece at the same height).
    const byFloor = new Map<number, THREE.Matrix4[]>();
    for (let i = 0; i < flat.length; i += STRIDE) {
      q.setFromAxisAngle(up, flat[i + 3]);
      m.compose(p.set(flat[i], flat[i + 1], flat[i + 2]), q, one);
      (byFloor.get(flat[i + 1]) ?? byFloor.set(flat[i + 1], []).get(flat[i + 1])!).push(m.clone());
    }
    for (const [y, matrices] of byFloor) {
      buckets.push({
        matrices,
        centers: matrices.map((mx) => sphere.center.clone().applyMatrix4(mx)),
        radius: sphere.radius,
        near: level(near, name, y, matrices, true),
        far: far.length ? level(far, name, y, matrices, false) : null,
        wasFar: new Uint8Array(matrices.length),
      });
      for (const mesh of solid)
        for (const mx of matrices) colliders.push(worldCollider(mesh.geometry, mx));
    }
  }

  const frustum = new THREE.Frustum();
  const projView = new THREE.Matrix4();
  const eye = new THREE.Vector3();
  const bound = new THREE.Sphere();
  // The buffer is uploaded only when a slot changes hands, so a still camera costs no uploads.
  const put = (lvl: Level, k: number, mx: THREE.Matrix4) => {
    if (lvl.slots[lvl.count] !== k) {
      lvl.slots[lvl.count] = k;
      mx.toArray(lvl.matrix.array as Float32Array, lvl.count * 16);
      lvl.matrix.needsUpdate = true;
    }
    lvl.count++;
  };
  const finish = (lvl: Level) => {
    for (const inst of lvl.meshes) {
      inst.count = lvl.count;
      inst.visible = lvl.count > 0;
    }
  };

  const update = (camera: THREE.Camera, lodDistance: number, drawDistance: number) => {
    frustum.setFromProjectionMatrix(projView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    eye.setFromMatrixPosition(camera.matrixWorld);
    for (const b of buckets) {
      b.near.count = 0;
      if (b.far) b.far.count = 0;
      for (let k = 0; k < b.matrices.length; k++) {
        const d = eye.distanceTo(b.centers[k]);
        if (d - b.radius > drawDistance || !frustum.intersectsSphere(bound.set(b.centers[k], b.radius))) continue;
        const isFar = b.far !== null && d > lodDistance + (b.wasFar[k] ? 0 : LOD_HYSTERESIS);
        b.wasFar[k] = isFar ? 1 : 0;
        put(isFar ? b.far! : b.near, k, b.matrices[k]);
      }
      finish(b.near);
      if (b.far) finish(b.far);
    }
  };
  return { group, colliders, instances: manifest.instances, update };
}

/** Fetches the manifest and builds the props, or returns null if there is no props file (a mall without props is fine). */
export async function loadProps(manifestUrl: string, loadPiece: (url: string) => Promise<THREE.Object3D>, onProgress?: (done: number, total: number) => void): Promise<Props | null> {
  const res = await fetch(manifestUrl);
  if (!res.ok) return null;
  return buildProps((await res.json()) as PropsManifest, loadPiece, onProgress);
}
