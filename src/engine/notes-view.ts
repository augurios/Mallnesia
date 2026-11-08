import * as THREE from "three";
import type { Note } from "./notes";
import { FLOOR_HEIGHT } from "./walk";

// A note is a sheet of paper lying on the floor: cream, a few ruled lines, a faint glow of its own so it can be found in
// the dark at close range. Placeholder look. Read ones are dimmer, so the player can see what they have already read.

const paperTexture = (): THREE.CanvasTexture => {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 90;
  const g = c.getContext("2d")!;
  g.fillStyle = "#cdbf94";
  g.fillRect(0, 0, 128, 90);
  g.strokeStyle = "rgba(60,45,20,0.8)"; // a dark edge, so the paper reads on pale tile
  g.lineWidth = 4;
  g.strokeRect(1, 1, 126, 88);
  g.strokeStyle = "rgba(70,60,40,0.55)";
  g.lineWidth = 2;
  for (let y = 16; y < 80; y += 10) {
    g.beginPath();
    g.moveTo(12, y);
    g.lineTo(12 + 90 + (Math.sin(y) * 10 - 5), y + Math.sin(y * 3));
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
};

export interface NotesView {
  object: THREE.Object3D;
  /** Dims the notes in `read`. */
  setRead(read: string[]): void;
  dispose(): void;
}

export function createNotesView(notes: Note[]): NotesView {
  const root = new THREE.Group();
  root.name = "notes";
  const tex = paperTexture();
  const geo = new THREE.PlaneGeometry(0.38, 0.27);
  geo.rotateX(-Math.PI / 2);
  const shadowGeo = new THREE.PlaneGeometry(0.46, 0.35);
  shadowGeo.rotateX(-Math.PI / 2);
  const shadowMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.45, depthWrite: false });
  const mats = new Map<string, THREE.MeshStandardMaterial>();
  for (const n of notes) {
    const m = new THREE.MeshStandardMaterial({ map: tex, emissive: 0xcdbf94, emissiveMap: tex, emissiveIntensity: 0.22, roughness: 0.95 });
    mats.set(n.id, m);
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(n.x, n.floor * FLOOR_HEIGHT + 0.012, -n.y);
    mesh.rotation.y = n.yaw;
    root.add(mesh);
    const under = new THREE.Mesh(shadowGeo, shadowMat); // a soft dark patch under it, so it shows on pale tile
    under.position.set(n.x, n.floor * FLOOR_HEIGHT + 0.006, -n.y);
    under.rotation.y = n.yaw;
    root.add(under);
  }
  return {
    object: root,
    setRead(read) {
      for (const [id, m] of mats) m.emissiveIntensity = read.includes(id) ? 0.06 : 0.22;
    },
    dispose() {
      geo.dispose();
      shadowGeo.dispose();
      shadowMat.dispose();
      tex.dispose();
      mats.forEach((m) => m.dispose());
      root.removeFromParent();
    },
  };
}
