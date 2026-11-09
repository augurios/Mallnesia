import * as THREE from "three";
import { FLOOR_HEIGHT } from "./walk";

// How the guard looks: an ordinary mall security worker, about 1.75 m, in a dark uniform and cap, holding a flashlight
// pointed at whoever he is talking to. Built from a few primitives (nothing to download), lit by the scene like any
// object, plus a small warm light of his own so the player can see him in the dark (his flashlight). Placeholder
// shape, for Augusto to judge by playing. Feet at y = 0, facing local +x.

const mat = (color: number, rough = 0.85) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0 });

export interface GuardView {
  object: THREE.Object3D;
  /** The warm light of his flashlight; the runtime adds it to the scene at the start (a light added later would recompile every shader). */
  light: THREE.PointLight;
  /** Places and animates him. `facing` is the plan heading; `visible` false hides him and darkens his light. */
  update(x: number, y: number, floor: number, facing: number, visible: boolean, walking: boolean, seconds: number): void;
  dispose(): void;
}

export function createGuardView(): GuardView {
  const uniform = mat(0x1d2430);
  const shirt = mat(0x6b7684);
  const skin = mat(0xb98a69, 0.7);
  const dark = mat(0x0c0e12);
  const metal = new THREE.MeshStandardMaterial({ color: 0x2a2d33, roughness: 0.4, metalness: 0.6 });
  const lens = new THREE.MeshBasicMaterial({ color: 0xfff2d0 });
  const geos: THREE.BufferGeometry[] = [];
  const g = <T extends THREE.BufferGeometry>(geo: T) => {
    geos.push(geo);
    return geo;
  };

  const root = new THREE.Group();
  root.visible = false;
  const body = new THREE.Group();
  root.add(body);

  // legs, pivoting at the hip
  const legs = [-1, 1].map((side) => {
    const hip = new THREE.Group();
    hip.position.set(0, 0.92, side * 0.1);
    const leg = new THREE.Mesh(g(new THREE.CylinderGeometry(0.075, 0.062, 0.86, 8)), uniform);
    leg.position.y = -0.45;
    const shoe = new THREE.Mesh(g(new THREE.BoxGeometry(0.26, 0.07, 0.11)), dark);
    shoe.position.set(0.06, -0.9, 0);
    hip.add(leg, shoe);
    body.add(hip);
    return hip;
  });
  // torso: a shirt with a belt, a little round-shouldered
  const torso = new THREE.Mesh(g(new THREE.CylinderGeometry(0.2, 0.17, 0.62, 10)), shirt);
  torso.scale.set(0.7, 1, 1.15);
  torso.position.y = 1.23;
  const belt = new THREE.Mesh(g(new THREE.CylinderGeometry(0.175, 0.175, 0.05, 10)), dark);
  belt.scale.set(0.7, 1, 1.15);
  belt.position.y = 0.95;
  body.add(torso, belt);
  // a radio on the shoulder
  const radio = new THREE.Mesh(g(new THREE.BoxGeometry(0.05, 0.12, 0.05)), dark);
  radio.position.set(0.02, 1.45, -0.2);
  body.add(radio);
  // head and cap
  const head = new THREE.Mesh(g(new THREE.SphereGeometry(0.105, 12, 10)), skin);
  head.scale.set(0.95, 1.15, 0.95);
  head.position.set(0.01, 1.66, 0);
  const cap = new THREE.Mesh(g(new THREE.CylinderGeometry(0.108, 0.115, 0.07, 12)), uniform);
  cap.position.set(0.01, 1.74, 0);
  const brim = new THREE.Mesh(g(new THREE.BoxGeometry(0.12, 0.012, 0.17)), uniform);
  brim.position.set(0.1, 1.715, 0);
  body.add(head, cap, brim);
  // arms: the left hangs, the right holds the flashlight out toward whoever he talks to
  const armGeo = g(new THREE.CylinderGeometry(0.04, 0.034, 0.58, 7));
  const left = new THREE.Group();
  left.position.set(0, 1.5, 0.23);
  const leftArm = new THREE.Mesh(armGeo, shirt);
  leftArm.position.y = -0.29;
  left.add(leftArm);
  const right = new THREE.Group();
  right.position.set(0, 1.5, -0.23);
  const rightArm = new THREE.Mesh(armGeo, shirt);
  rightArm.position.y = -0.29;
  const torchBody = new THREE.Mesh(g(new THREE.CylinderGeometry(0.03, 0.03, 0.22, 8)), metal);
  torchBody.rotation.z = Math.PI / 2;
  torchBody.position.set(0.1, -0.58, 0);
  const torchLens = new THREE.Mesh(g(new THREE.CircleGeometry(0.03, 8)), lens);
  torchLens.rotation.y = Math.PI / 2;
  torchLens.position.set(0.215, -0.58, 0);
  right.add(rightArm, torchBody, torchLens);
  right.rotation.z = -0.5; // the arm comes forward and up a little (rotation about the shoulder)
  body.add(left, right);

  const light = new THREE.PointLight(0xffe2b0, 0, 9, 1.6);
  light.position.set(0.7, 1.15, -0.2);
  root.add(light);

  return {
    object: root,
    light,
    update(x, y, floor, facing, visible, walking, seconds) {
      root.visible = visible;
      light.intensity = visible ? 6 : 0; // never removed: only dimmed to nothing, so the shader count never changes
      if (!visible) return;
      root.position.set(x, floor * FLOOR_HEIGHT, -y);
      root.rotation.y = facing;
      const swing = walking ? Math.sin(seconds * 6.5) * 0.45 : 0;
      legs[0].rotation.z = swing;
      legs[1].rotation.z = -swing;
      left.rotation.z = walking ? -swing * 0.8 : 0.05 * Math.sin(seconds * 0.9);
      body.position.y = walking ? Math.abs(Math.sin(seconds * 6.5)) * 0.015 : Math.sin(seconds * 1.1) * 0.003;
    },
    dispose() {
      geos.forEach((geo) => geo.dispose());
      [uniform, shirt, skin, dark, metal, lens].forEach((m) => m.dispose());
    },
  };
}
