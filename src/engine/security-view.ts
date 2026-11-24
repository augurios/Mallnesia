import * as THREE from "three";
import { CONSOLE } from "./security";
import { FLOOR_HEIGHT } from "./walk";

// The security console in the guard's office (floor 3): a metal office desk against the wall, three small CRTs on it
// facing the way the player stands (the outer two angled in), and a plastic chair pulled out to one side. The models
// are CC0 from Poly Haven (public/models/security/, imported by scripts/security/import.mts); until they arrive a few
// primitives stand in, so the console always works. The CRT has no screen material of its own, so a plane over each
// screen carries the glow: a dull green that flickers, more as sanity falls (the player sees the feeds by using the
// console, see security.ts). `collider()` is a plain box (the desk) to merge into the walk collision; the chair has none.

export interface SecurityView {
  object: THREE.Object3D;
  /** World-space collision box (positions only) for the walk BVH. */
  collider(): THREE.BufferGeometry;
  /** Fetches the models and swaps them in for the stand-in. `prepare` warms the new model up before it shows. */
  load(prepare?: (model: THREE.Object3D) => Promise<void> | void): Promise<void>;
  update(seconds: number, glitch: number): void;
  /** Near or far versions of the models, by the camera's distance (the props' LOD rule). */
  lod(camera: THREE.Camera, distance: number): void;
  dispose(): void;
}

/** A loaded glTF, as GLTFLoader returns it (only what is used here). */
export interface SecurityGltf {
  scene: THREE.Object3D;
}

const MODEL_URL = (name: string) => `./models/security/${name}.glb`;
const FAR_SUFFIX = "_far";

/** The desk top's height (m): the Poly Haven desk is 0.79 m tall. */
const DESK_TOP = 0.7875;
/**
 * The three CRTs in the console's frame (+x = the way the screens face, z along the desk): set back from the front
 * edge, the middle one straight and the outer two turned in toward the player's spot.
 */
const CRTS: { x: number; z: number; turn: number }[] = [
  { x: -0.12, z: -0.62, turn: -0.35 },
  { x: -0.14, z: 0, turn: 0 },
  { x: -0.12, z: 0.62, turn: 0.35 },
];
/** The chair: on the player's side, pulled out and turned a little, clear of the spot in front (1.4 m out). */
const CHAIR = { x: 1.0, z: 0.85, turn: 0.5 };
/** The glow plane over a CRT's screen, in the model's own frame (front = +z). */
const SCREEN = { x: -0.012, y: 0.258, z: 0.124, w: 0.3, h: 0.225 };

export function createSecurityView(fetchModel?: (url: string) => Promise<SecurityGltf>): SecurityView {
  const root = new THREE.Group();
  root.name = "security-console";
  root.position.set(CONSOLE.x, CONSOLE.floor * FLOOR_HEIGHT, -CONSOLE.y);
  // local +x is the way the screens face; the console is built facing +x then turned to CONSOLE.facing
  root.rotation.y = CONSOLE.facing;
  const geos: THREE.BufferGeometry[] = [];
  const mats: THREE.Material[] = [];
  const std = (color: number, rough = 0.8, metal = 0) => {
    const m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
    mats.push(m);
    return m;
  };
  const box = (parent: THREE.Object3D, w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number) => {
    const geo = new THREE.BoxGeometry(w, h, d);
    geos.push(geo);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    parent.add(mesh);
    return mesh;
  };

  // the screens' glow, shared by the stand-in and the models
  const screens: THREE.MeshBasicMaterial[] = CRTS.map(() => {
    const m = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.1, 0.5, 0.28) });
    mats.push(m);
    return m;
  });
  const screenGeo = new THREE.PlaneGeometry(SCREEN.w, SCREEN.h);
  geos.push(screenGeo);

  // the stand-in: a desk, three boxy monitors, a chair (shown until the models arrive, or if they never do)
  const standIn = new THREE.Group();
  const desk = std(0x2b2f36, 0.7, 0.2);
  const top = std(0x1b1d22, 0.5, 0.1);
  box(standIn, CONSOLE.hy * 2, 0.05, CONSOLE.hx * 2, top, 0, DESK_TOP - 0.025, 0);
  box(standIn, CONSOLE.hy * 2 - 0.1, DESK_TOP - 0.05, 0.06, desk, 0, (DESK_TOP - 0.05) / 2, -CONSOLE.hx + 0.1);
  box(standIn, CONSOLE.hy * 2 - 0.1, DESK_TOP - 0.05, 0.06, desk, 0, (DESK_TOP - 0.05) / 2, CONSOLE.hx - 0.1);
  box(standIn, 0.06, DESK_TOP - 0.1, CONSOLE.hx * 1.8, desk, -CONSOLE.hy + 0.05, (DESK_TOP - 0.1) / 2 + 0.05, 0);
  const bezel = std(0x0d0e10, 0.6, 0.3);
  CRTS.forEach((c, k) => {
    const g = new THREE.Group();
    g.position.set(c.x, DESK_TOP, c.z);
    g.rotation.y = c.turn;
    box(g, 0.35, 0.41, 0.4, bezel, -0.05, 0.205, 0);
    const face = new THREE.Mesh(screenGeo, screens[k]);
    face.rotation.y = Math.PI / 2;
    face.position.set(0.126, SCREEN.y, -SCREEN.x);
    g.add(face);
    standIn.add(g);
  });
  const chairMat = std(0xb8b8b0, 0.6);
  const chairStandIn = new THREE.Group();
  chairStandIn.position.set(CHAIR.x, 0, CHAIR.z);
  chairStandIn.rotation.y = CHAIR.turn;
  box(chairStandIn, 0.5, 0.05, 0.5, chairMat, 0, 0.45, 0);
  box(chairStandIn, 0.05, 0.4, 0.5, chairMat, 0.25, 0.7, 0);
  standIn.add(chairStandIn);
  root.add(standIn);

  // the models, once loaded: [near, far] meshes to switch between
  let model: THREE.Group | null = null;
  const nearFar: [THREE.Object3D[], THREE.Object3D[]] = [[], []];
  let showingFar = false;
  /** A copy of a loaded model placed in the console's frame; its front (+z) turned to face local `turn` from +x. */
  const place = (source: THREE.Object3D, x: number, y: number, z: number, turn: number) => {
    const o = source.clone(true);
    o.position.set(x, y, z);
    o.rotation.y = Math.PI / 2 + turn; // +z (the model's front) to +x, then the turn
    o.traverse((m) => {
      if (!(m instanceof THREE.Mesh)) return;
      const far = m.name.endsWith(FAR_SUFFIX);
      nearFar[far ? 1 : 0].push(m);
      m.visible = !far;
    });
    return o;
  };

  return {
    object: root,
    collider() {
      // the desk's footprint turned to the console's heading, as a box of height 1.4 (positions only, world space)
      const g = new THREE.BoxGeometry(CONSOLE.hy * 2, 1.4, CONSOLE.hx * 2);
      g.rotateY(CONSOLE.facing);
      g.translate(CONSOLE.x, CONSOLE.floor * FLOOR_HEIGHT + 0.7, -CONSOLE.y);
      const plain = new THREE.BufferGeometry();
      plain.setAttribute("position", g.attributes.position.clone());
      plain.setIndex(g.index!.clone());
      g.dispose();
      return plain;
    },
    async load(prepare) {
      if (!fetchModel || model) return;
      let parts: THREE.Object3D[];
      try {
        parts = await Promise.all(["desk", "crt", "chair"].map(async (n) => (await fetchModel(MODEL_URL(n))).scene));
      } catch (err) {
        console.error("Could not load the security office furniture; the stand-in stays", err);
        return;
      }
      const [deskModel, crtModel, chairModel] = parts;
      const g = new THREE.Group();
      g.name = "security-console-models";
      g.add(place(deskModel, 0, 0, 0, 0));
      CRTS.forEach((c, k) => {
        const crt = place(crtModel, c.x, DESK_TOP, c.z, c.turn);
        const face = new THREE.Mesh(screenGeo, screens[k]);
        face.position.set(SCREEN.x, SCREEN.y, SCREEN.z); // in the CRT's own frame: just in front of the glass
        crt.add(face);
        g.add(crt);
      });
      // the chair faces the desk: its front (+z) toward local -x
      g.add(place(chairModel, CHAIR.x, 0, CHAIR.z, Math.PI + CHAIR.turn));
      g.traverse((o) => {
        if (!(o instanceof THREE.Mesh)) return;
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) if (!mats.includes(m)) mats.push(m);
        if (!geos.includes(o.geometry)) geos.push(o.geometry);
      });
      // warmed up detached and visible (the compile skips hidden objects; the far meshes share the near materials)
      await prepare?.(g);
      root.add(g);
      standIn.removeFromParent();
      model = g;
    },
    update(seconds, glitch) {
      screens.forEach((s, k) => {
        const flicker = 0.85 + 0.15 * Math.sin(seconds * (9 + k * 3.1)) * (1 + glitch * 2);
        s.color.setRGB(0.08 * flicker, 0.5 * flicker, 0.28 * flicker);
      });
    },
    lod(camera, distance) {
      if (!model) return;
      const far = camera.position.distanceTo(root.getWorldPosition(scratch)) > distance;
      if (far === showingFar) return;
      showingFar = far;
      nearFar[0].forEach((o) => (o.visible = !far));
      nearFar[1].forEach((o) => (o.visible = far));
    },
    dispose() {
      geos.forEach((geo) => geo.dispose());
      mats.forEach((m) => {
        for (const value of Object.values(m)) if (value instanceof THREE.Texture) value.dispose();
        m.dispose();
      });
      root.removeFromParent();
    },
  };
}

const scratch = new THREE.Vector3();
