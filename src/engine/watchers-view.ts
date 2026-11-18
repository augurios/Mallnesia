import * as THREE from "three";
import type { Watcher, WatcherLook } from "./watchers";
import { FLOOR_HEIGHT } from "./walk";

// How the watchers look: ordinary people, nothing about them is monstrous. Each is a few primitives (legs, a jacket or
// shirt, a head, arms hanging), in the kind of clothes anyone in a mall wears; one of the four looks is the dark uniform
// and cap of a guard, without his flashlight, which is what lets a watcher pass for him on a camera feed. They are lit
// like any object, so in the dark they are only what the flashlight shows. They stand very still: the only motion is a
// slow sway, and the head always faces the player. Placeholder shapes for Augusto to judge by playing.

const SKINS = [0xb98a69, 0xd2a582, 0x8c6246, 0xc49a78];

interface Look {
  top: number;
  legs: number;
  cap: boolean;
  hood: boolean;
}
const LOOKS: Record<WatcherLook, Look> = {
  shopper: { top: 0x7a6a8c, legs: 0x2d3340, cap: false, hood: false },
  jacket: { top: 0x3f5a46, legs: 0x1d2024, cap: false, hood: false },
  hoodie: { top: 0x8a3b33, legs: 0x262a31, cap: false, hood: true },
  guardlike: { top: 0x1d2430, legs: 0x1d2430, cap: true, hood: false }, // like the guard's uniform (guard-view.ts)
};

const POOL = 5;

export interface WatchersView {
  object: THREE.Object3D;
  update(list: Watcher[], seconds: number): void;
  dispose(): void;
}

export function createWatchersView(): WatchersView {
  const root = new THREE.Group();
  root.name = "watchers";
  const geos: THREE.BufferGeometry[] = [];
  const mats: THREE.Material[] = [];
  const mat = (color: number) => {
    const m = new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0 });
    mats.push(m);
    return m;
  };
  const g = <T extends THREE.BufferGeometry>(geo: T) => {
    geos.push(geo);
    return geo;
  };
  const legGeo = g(new THREE.CylinderGeometry(0.075, 0.062, 0.86, 8));
  const torsoGeo = g(new THREE.CylinderGeometry(0.2, 0.17, 0.62, 10));
  const headGeo = g(new THREE.SphereGeometry(0.105, 12, 10));
  const armGeo = g(new THREE.CylinderGeometry(0.04, 0.034, 0.6, 7));
  const capGeo = g(new THREE.CylinderGeometry(0.108, 0.115, 0.07, 12));
  const brimGeo = g(new THREE.BoxGeometry(0.12, 0.012, 0.17));
  const hoodGeo = g(new THREE.SphereGeometry(0.125, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.62));
  const shoeGeo = g(new THREE.BoxGeometry(0.26, 0.07, 0.11));
  const shoeMat = mat(0x0c0e12);

  const people = Array.from({ length: POOL }, () => {
    const body = new THREE.Group();
    const person = new THREE.Group();
    person.visible = false;
    person.add(body);
    const parts = { top: mat(0xffffff), legs: mat(0xffffff), skin: mat(0xffffff), cap: mat(0x1d2430) };
    for (const side of [-1, 1]) {
      const leg = new THREE.Mesh(legGeo, parts.legs);
      leg.position.set(0, 0.47, side * 0.1);
      const shoe = new THREE.Mesh(shoeGeo, shoeMat);
      shoe.position.set(0.06, 0.035, side * 0.1);
      body.add(leg, shoe);
    }
    const torso = new THREE.Mesh(torsoGeo, parts.top);
    torso.scale.set(0.7, 1, 1.15);
    torso.position.y = 1.23;
    body.add(torso);
    for (const side of [-1, 1]) {
      const arm = new THREE.Mesh(armGeo, parts.top);
      arm.position.set(0, 1.2, side * 0.23);
      body.add(arm);
    }
    const head = new THREE.Mesh(headGeo, parts.skin);
    head.scale.set(0.95, 1.15, 0.95);
    head.position.set(0.01, 1.66, 0);
    body.add(head);
    const cap = new THREE.Group();
    const crown = new THREE.Mesh(capGeo, parts.cap);
    crown.position.set(0.01, 1.74, 0);
    const brim = new THREE.Mesh(brimGeo, parts.cap);
    brim.position.set(0.1, 1.715, 0);
    cap.add(crown, brim);
    const hood = new THREE.Mesh(hoodGeo, parts.top);
    hood.position.set(0.0, 1.66, 0);
    body.add(cap, hood);
    root.add(person);
    return { person, body, parts, cap, hood };
  });

  const bound = new Map<number, number>(); // watcher id -> pool slot, so a watcher keeps its person (and its look) while it lives

  return {
    object: root,
    update(list, seconds) {
      const used = new Set<number>();
      for (const w of list) {
        let slot = bound.get(w.id);
        if (slot === undefined) {
          slot = people.findIndex((_, k) => !used.has(k) && ![...bound.values()].includes(k));
          if (slot < 0) continue; // more watchers than people: the extras are simply not drawn
          bound.set(w.id, slot);
          const look = LOOKS[w.look];
          const p = people[slot];
          p.parts.top.color.set(look.top);
          p.parts.legs.color.set(look.legs);
          p.parts.skin.color.set(SKINS[w.id % SKINS.length]);
          p.cap.visible = look.cap;
          p.hood.visible = look.hood;
          p.body.scale.setScalar(w.height);
        }
        used.add(slot);
        const p = people[slot];
        p.person.visible = true;
        p.person.position.set(w.x, w.floor * FLOOR_HEIGHT, -w.y);
        p.person.rotation.y = w.facing;
        // a very slow sway; frozen ones stand perfectly still
        p.body.rotation.z = w.frozen ? 0 : 0.012 * Math.sin(seconds * 0.8 + w.id);
      }
      for (const [id, slot] of [...bound]) {
        if (!used.has(slot) || !list.some((w) => w.id === id)) {
          bound.delete(id);
          people[slot].person.visible = false;
        }
      }
    },
    dispose() {
      geos.forEach((geo) => geo.dispose());
      mats.forEach((m) => m.dispose());
      root.removeFromParent();
    },
  };
}
