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

const POOL = 6; // up to four around the player and two on the security feeds (FeedWatchers)

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
    // standing legs: hips at 0.9 m
    const stand = new THREE.Group();
    for (const side of [-1, 1]) {
      const leg = new THREE.Mesh(legGeo, parts.legs);
      leg.position.set(0, 0.47, side * 0.1);
      const shoe = new THREE.Mesh(shoeGeo, shoeMat);
      shoe.position.set(0.06, 0.035, side * 0.1);
      stand.add(leg, shoe);
    }
    // sitting legs: the group sits at the hips (the seat's height), thighs forward along the seat, shins down to the
    // floor (their length is set to the seat's height in update)
    const sit = new THREE.Group();
    const shins: THREE.Mesh[] = [];
    const sitShoes: THREE.Mesh[] = [];
    for (const side of [-1, 1]) {
      const thigh = new THREE.Mesh(legGeo, parts.legs);
      thigh.scale.y = 0.5;
      thigh.rotation.z = -Math.PI / 2;
      thigh.position.set(0.2, 0.07, side * 0.1);
      const shin = new THREE.Mesh(legGeo, parts.legs);
      const shoe = new THREE.Mesh(shoeGeo, shoeMat);
      shins.push(shin);
      sitShoes.push(shoe);
      sit.add(thigh, shin, shoe);
    }
    // everything above the hips, built for standing (hips at 0.9 m); lowered as a whole to sit
    const upper = new THREE.Group();
    const torso = new THREE.Mesh(torsoGeo, parts.top);
    torso.scale.set(0.7, 1, 1.15);
    torso.position.y = 1.23;
    upper.add(torso);
    const arms: THREE.Group[] = [];
    for (const side of [-1, 1]) {
      // each arm hangs from a shoulder pivot, so a sitter's can swing forward onto the lap
      const shoulder = new THREE.Group();
      shoulder.position.set(0, 1.5, side * 0.23);
      const arm = new THREE.Mesh(armGeo, parts.top);
      arm.position.y = -0.3;
      shoulder.add(arm);
      upper.add(shoulder);
      arms.push(shoulder);
    }
    // the head turns on the neck (a sitter's toward the player); cap and hood turn with it
    const neck = new THREE.Group();
    neck.position.set(0.01, 1.55, 0);
    const head = new THREE.Mesh(headGeo, parts.skin);
    head.scale.set(0.95, 1.15, 0.95);
    head.position.y = 0.11;
    neck.add(head);
    const cap = new THREE.Group();
    const crown = new THREE.Mesh(capGeo, parts.cap);
    crown.position.set(0, 0.19, 0);
    const brim = new THREE.Mesh(brimGeo, parts.cap);
    brim.position.set(0.09, 0.165, 0);
    cap.add(crown, brim);
    const hood = new THREE.Mesh(hoodGeo, parts.top);
    hood.position.set(-0.01, 0.11, 0);
    neck.add(cap, hood);
    upper.add(neck);
    body.add(stand, sit, upper);
    root.add(person);
    return { person, body, parts, cap, hood, stand, sit, shins, sitShoes, upper, arms, neck };
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
        const seat = w.seat;
        p.stand.visible = !seat;
        p.sit.visible = !!seat;
        if (seat) {
          // hips on the seat (scaled people sit at the same seat height, so undo the scale for it)
          const hips = seat.height / w.height;
          p.sit.position.y = hips;
          for (const shin of p.shins) {
            shin.scale.y = hips / 0.86;
            shin.position.set(0.42, -hips / 2, shin === p.shins[0] ? -0.1 : 0.1);
          }
          p.sitShoes.forEach((shoe, k) => shoe.position.set(0.48, 0.035 - hips, k === 0 ? -0.1 : 0.1));
          p.upper.position.y = hips - 0.9;
          for (const arm of p.arms) arm.rotation.z = 0.6; // hands on the thighs
        } else {
          p.upper.position.y = 0;
          for (const arm of p.arms) arm.rotation.z = 0;
        }
        p.neck.rotation.y = w.headTurn ?? 0;
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
