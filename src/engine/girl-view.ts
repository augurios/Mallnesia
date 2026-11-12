import * as THREE from "three";
import { FLOOR_HEIGHT } from "./walk";

// How the girl in white looks: a child-sized figure (about 1.3 m) in a long pale dress, head a little bowed under
// long dark hair, arms hanging. A few primitives, unlit and cold, so she is a pale shape in the dark that fades in
// and out (opacity). Placeholder shape for Augusto to judge by playing. Feet at y = 0, facing local +x.

export interface GirlView {
  object: THREE.Object3D;
  /** Places her and sets how much of her is there (0 hides her). `facing` is the plan heading. */
  update(x: number, y: number, floor: number, facing: number, opacity: number, seconds: number): void;
  dispose(): void;
}

export function createGirlView(): GirlView {
  const mats: THREE.MeshBasicMaterial[] = [];
  const mat = (color: number, base: number) => {
    const m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, depthWrite: false });
    m.userData.base = base;
    mats.push(m);
    return m;
  };
  const dress = mat(0xc4cad6, 0.85);
  const skin = mat(0xaeb4bf, 0.85);
  const hair = mat(0x07080b, 0.95);
  const geos: THREE.BufferGeometry[] = [];
  const g = <T extends THREE.BufferGeometry>(geo: T) => {
    geos.push(geo);
    return geo;
  };
  const root = new THREE.Group();
  root.visible = false;
  const body = new THREE.Group();
  root.add(body);

  const profile = [
    [0.01, 0.02],
    [0.26, 0.03],
    [0.27, 0.12],
    [0.2, 0.5],
    [0.1, 0.78],
    [0.11, 0.98],
    [0.12, 1.05],
    [0.05, 1.12],
    [0.0, 1.13],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const gown = new THREE.Mesh(g(new THREE.LatheGeometry(profile, 14)), dress);
  gown.scale.set(0.8, 1, 1);
  body.add(gown);
  // the head hangs forward a little; the hair falls from the crown down the back to the waist
  const head = new THREE.Mesh(g(new THREE.SphereGeometry(0.1, 12, 10)), skin);
  head.scale.set(0.92, 1.1, 0.92);
  head.position.set(0.05, 1.22, 0);
  body.add(head);
  const hairBack = new THREE.Mesh(g(new THREE.ConeGeometry(0.13, 0.62, 10, 1, true)), hair);
  hairBack.position.set(-0.03, 1.0, 0);
  hairBack.scale.set(0.9, 1, 1);
  hairBack.material.side = THREE.DoubleSide;
  body.add(hairBack);
  const fringe = new THREE.Mesh(g(new THREE.SphereGeometry(0.108, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55)), hair);
  fringe.scale.set(0.95, 1.12, 0.95);
  fringe.position.set(0.045, 1.235, 0);
  body.add(fringe);
  const armGeo = g(new THREE.CylinderGeometry(0.025, 0.02, 0.5, 6));
  for (const side of [-1, 1]) {
    const arm = new THREE.Mesh(armGeo, skin);
    arm.position.set(0.01, 0.82, side * 0.13);
    body.add(arm);
  }

  return {
    object: root,
    update(x, y, floor, facing, opacity, seconds) {
      root.visible = opacity > 0.003;
      if (!root.visible) return;
      root.position.set(x, floor * FLOOR_HEIGHT, -y);
      root.rotation.y = facing;
      body.rotation.z = 0.04 * Math.sin(seconds * 0.7); // never quite still
      for (const m of mats) m.opacity = opacity * (m.userData.base as number);
    },
    dispose() {
      geos.forEach((geo) => geo.dispose());
      mats.forEach((m) => m.dispose());
    },
  };
}
