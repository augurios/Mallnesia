import * as THREE from "three";
import { CONSOLE } from "./security";
import { FLOOR_HEIGHT } from "./walk";

// The security console: a desk with three small monitors facing the way the player stands, and a chair behind. A
// few primitives, placeholder look. The screens glow a dull green and flicker a little (the player sees the feeds by
// using the console, see security.ts). `collider()` is a plain box to merge into the walk collision.

export interface SecurityView {
  object: THREE.Object3D;
  /** World-space collision box (positions only) for the walk BVH. */
  collider(): THREE.BufferGeometry;
  update(seconds: number, glitch: number): void;
  dispose(): void;
}

export function createSecurityView(): SecurityView {
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
  const box = (w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number) => {
    const geo = new THREE.BoxGeometry(w, h, d);
    geos.push(geo);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    root.add(mesh);
    return mesh;
  };
  const desk = std(0x2b2f36, 0.7, 0.2);
  const top = std(0x1b1d22, 0.5, 0.1);
  // the desk: a top on two panels, along local z (hx is the half length)
  box(0.9, 0.05, CONSOLE.hx * 2, top, 0, 0.78, 0);
  box(0.8, 0.76, 0.06, desk, 0, 0.38, -CONSOLE.hx + 0.1);
  box(0.8, 0.76, 0.06, desk, 0, 0.38, CONSOLE.hx - 0.1);
  box(0.06, 0.7, CONSOLE.hx * 1.8, desk, -0.4, 0.4, 0);
  // three monitors on the desk, the middle one a little larger, each angled in
  const bezel = std(0x0d0e10, 0.6, 0.3);
  const screens: THREE.MeshBasicMaterial[] = [];
  [-0.62, 0, 0.62].forEach((z, k) => {
    const g = new THREE.Group();
    g.position.set(0.05, 0.98, z);
    g.rotation.y = k === 1 ? 0 : k === 0 ? -0.35 : 0.35;
    const w = k === 1 ? 0.5 : 0.42;
    const h = k === 1 ? 0.36 : 0.3;
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.05, h + 0.04, w + 0.04), bezel);
    geos.push(body.geometry);
    const screen = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.1, 0.5, 0.28) });
    screens.push(screen);
    mats.push(screen);
    const face = new THREE.Mesh(new THREE.PlaneGeometry(w, h), screen);
    geos.push(face.geometry);
    face.rotation.y = Math.PI / 2;
    face.position.x = 0.028;
    const stand = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.2, 0.06), bezel);
    geos.push(stand.geometry);
    stand.position.y = -h / 2 - 0.08;
    g.add(body, face, stand);
    root.add(g);
  });
  // a chair behind the desk
  const chair = std(0x15171a, 0.9);
  box(0.5, 0.06, 0.5, chair, -0.95, 0.5, 0.15);
  box(0.06, 0.5, 0.5, chair, -1.2, 0.78, 0.15);
  box(0.06, 0.5, 0.06, chair, -0.95, 0.25, 0.15);

  return {
    object: root,
    collider() {
      // the desk's footprint turned to the console's heading, as a box of height 1.4 (positions only, world space)
      const g = new THREE.BoxGeometry(CONSOLE.hy * 2 + 0.25, 1.4, CONSOLE.hx * 2);
      g.rotateY(CONSOLE.facing);
      g.translate(CONSOLE.x, CONSOLE.floor * FLOOR_HEIGHT + 0.7, -CONSOLE.y);
      const plain = new THREE.BufferGeometry();
      plain.setAttribute("position", g.attributes.position.clone());
      plain.setIndex(g.index!.clone());
      g.dispose();
      return plain;
    },
    update(seconds, glitch) {
      screens.forEach((s, k) => {
        const flicker = 0.85 + 0.15 * Math.sin(seconds * (9 + k * 3.1)) * (1 + glitch * 2);
        s.color.setRGB(0.08 * flicker, 0.5 * flicker, 0.28 * flicker);
      });
    },
    dispose() {
      geos.forEach((geo) => geo.dispose());
      mats.forEach((m) => m.dispose());
      root.removeFromParent();
    },
  };
}
