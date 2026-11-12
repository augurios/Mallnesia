import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { rampHole, type Box, type GarageLayout, type Sign } from "./garage-gen";

// Draws a garage layout (garage-gen.ts): concrete floor, ceiling, walls and columns, painted lines, parked cars and the
// minivan, fluorescent tubes that flicker or are dead, hanging signs, the attendant's booth and its payphone. Everything
// static is merged into a few meshes (a handful of draw calls), the tubes and their pools of light are instanced.
// Placeholder shapes and colors, to be judged by playing. Plan (x, y) becomes three.js (x, -y) with y up.

const CAR_COLORS = [0x6c8a7c, 0x8c2b2b, 0x2b3f5c, 0x9a9a98, 0x1e1e20, 0xb5ad8f, 0x5a4a3a]; // 0 is the van's faded green

function concrete(repeatX: number, repeatY: number, base: number): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d")!;
  const rgb = `rgb(${base},${base},${base + 3})`;
  g.fillStyle = rgb;
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 2600; i++) {
    const v = base + (Math.random() - 0.5) * 34;
    g.fillStyle = `rgba(${v},${v},${v + 3},0.35)`;
    g.fillRect(Math.random() * 256, Math.random() * 256, 1 + Math.random() * 3, 1 + Math.random() * 3);
  }
  for (let i = 0; i < 7; i++) {
    // oil and damp stains
    const x = Math.random() * 256;
    const y = Math.random() * 256;
    const r = 12 + Math.random() * 30;
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, "rgba(20,20,24,0.28)");
    grad.addColorStop(1, "rgba(20,20,24,0)");
    g.fillStyle = grad;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  g.strokeStyle = "rgba(0,0,0,0.25)"; // the control joints of a slab
  g.lineWidth = 2;
  g.strokeRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeatX, repeatY);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function poolTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.45, "rgba(255,255,255,0.35)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

function signTexture(sign: Sign): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 208;
  const g = c.getContext("2d")!;
  const level = sign.kind === "level";
  g.fillStyle = level ? "#1c4d8c" : "#1d6b3a";
  g.fillRect(0, 0, 512, 208);
  g.strokeStyle = "#e8e8e0";
  g.lineWidth = 8;
  g.strokeRect(8, 8, 496, 192);
  g.fillStyle = "#f1f0e8";
  g.textAlign = "center";
  g.textBaseline = "middle";
  if (level) {
    g.font = "bold 150px sans-serif";
    g.fillText(sign.text, 256, 112);
  } else {
    g.font = "bold 70px sans-serif";
    g.fillText(sign.kind === "exit" ? "SALIDA" : sign.text.toUpperCase(), sign.kind === "exit" ? 190 : 256, 104);
    if (sign.kind === "exit" && sign.arrow !== undefined) {
      // the arrow: its angle on the sign is its plan heading relative to the viewer's right (viewer looks along heading facing + PI)
      const rel = sign.arrow - (sign.facing + Math.PI / 2);
      g.save();
      g.translate(420, 104);
      g.rotate(-rel); // canvas y points down
      g.beginPath();
      g.moveTo(-50, -14);
      g.lineTo(10, -14);
      g.lineTo(10, -40);
      g.lineTo(56, 0);
      g.lineTo(10, 40);
      g.lineTo(10, 14);
      g.lineTo(-50, 14);
      g.closePath();
      g.fill();
      g.restore();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const at = (g: THREE.BufferGeometry, x: number, y: number, z: number, ry = 0) => {
  if (ry) g.rotateY(ry);
  g.translate(x, y, z);
  return g;
};

const boxGeo = (b: Box) => {
  const g = new THREE.BoxGeometry(b.x1 - b.x0, b.top, b.y1 - b.y0);
  return at(g, (b.x0 + b.x1) / 2, b.top / 2, -(b.y0 + b.y1) / 2);
};

/** A triangular prism that rises from the floor at one end of the box to the ceiling at the other. `rise` is the plan heading it climbs toward. */
function wedge(b: Box, rise: number): THREE.BufferGeometry {
  const w = Math.abs(Math.cos(rise)) > 0.5 ? b.x1 - b.x0 : b.y1 - b.y0; // length along the rise
  const d = Math.abs(Math.cos(rise)) > 0.5 ? b.y1 - b.y0 : b.x1 - b.x0; // width across
  const h = b.top;
  const pos = [
    // along local +x from 0 (low) to w (high), centred in z
    0, 0, -d / 2, w, 0, -d / 2, w, h, -d / 2, // side z-
    0, 0, d / 2, w, h, d / 2, w, 0, d / 2, // side z+
    0, 0, -d / 2, w, h, -d / 2, w, h, d / 2, 0, 0, -d / 2, w, h, d / 2, 0, 0, d / 2, // the slope
    w, 0, -d / 2, w, 0, d / 2, w, h, d / 2, w, 0, -d / 2, w, h, d / 2, w, h, -d / 2, // the high end
  ];
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  // rise heading to scene rotation: local +x goes to (cos, 0, -sin)
  g.translate(-w / 2, 0, 0);
  g.rotateY(rise);
  g.translate((b.x0 + b.x1) / 2, 0, -(b.y0 + b.y1) / 2);
  return g;
}

/** A car or the van: [body, glass, tires], each merged, built with the nose along +x. */
function carParts(van: boolean, w: number, l: number, color: number, heading: number, x: number, y: number) {
  const body: THREE.BufferGeometry[] = [];
  const glass: THREE.BufferGeometry[] = [];
  const tires: THREE.BufferGeometry[] = [];
  const paint = new THREE.Color(color);
  const tint = (g: THREE.BufferGeometry, c: THREE.Color) => {
    const n = g.attributes.position.count;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) c.toArray(arr, i * 3);
    g.setAttribute("color", new THREE.BufferAttribute(arr, 3));
    return g;
  };
  const frustum = (len: number, wid: number, h: number, shrink: number) => {
    const g = new THREE.CylinderGeometry(0.7071 * shrink, 0.7071, h, 4, 1);
    g.rotateY(Math.PI / 4);
    g.scale(len, 1, wid);
    return g;
  };
  const lowY = van ? 0.28 : 0.24;
  const bodyH = van ? 1.25 : 0.62;
  const lower = new THREE.BoxGeometry(l, bodyH, w);
  lower.translate(0, lowY + bodyH / 2, 0);
  body.push(tint(lower, paint));
  const cabH = van ? 0.62 : 0.5;
  const cabLen = van ? l * 0.86 : l * 0.52;
  const cabin = frustum(cabLen, w * 0.9, cabH, van ? 0.9 : 0.78);
  cabin.translate(van ? -l * 0.04 : -l * 0.06, lowY + bodyH + cabH / 2, 0);
  glass.push(cabin);
  const roof = new THREE.BoxGeometry(cabLen * (van ? 0.9 : 0.78), 0.04, w * 0.9 * (van ? 0.9 : 0.78));
  roof.translate(van ? -l * 0.04 : -l * 0.06, lowY + bodyH + cabH + 0.02, 0);
  body.push(tint(roof, paint));
  if (van) {
    // a cream band along the side, a roof rack, and a front that slopes: what makes it that van
    const band = new THREE.BoxGeometry(l * 0.98, 0.1, w * 1.01);
    band.translate(0, lowY + 0.62, 0);
    body.push(tint(band, new THREE.Color(0xd8cfae)));
    for (const rx of [-1.0, 0.7]) {
      const rack = new THREE.BoxGeometry(0.06, 0.05, w * 0.85);
      rack.translate(rx, lowY + bodyH + cabH + 0.08, 0);
      body.push(tint(rack, new THREE.Color(0x2a2a2a)));
    }
  } else {
    const hood = new THREE.BoxGeometry(l * 0.3, 0.06, w * 0.94);
    hood.translate(l * 0.33, lowY + bodyH + 0.03, 0);
    body.push(tint(hood, paint.clone().multiplyScalar(0.9)));
  }
  for (const wx of [-l * 0.31, l * 0.31])
    for (const wz of [-w / 2 + 0.02, w / 2 - 0.02]) {
      const t = new THREE.CylinderGeometry(0.33, 0.33, 0.22, 12);
      t.rotateX(Math.PI / 2);
      t.translate(wx, 0.33, wz);
      tires.push(t);
    }
  // everything: nose to heading, into place
  const place = (g: THREE.BufferGeometry) => at(g, x, 0, -y, heading);
  return { body: body.map(place), glass: glass.map(place), tires: tires.map(place) };
}

export interface GarageView {
  group: THREE.Group;
  /** Flicker of the tubes; `seconds` is any steadily increasing clock. */
  update(seconds: number): void;
  /** Walls up (or opens) the k-th of `opts.gapWalls`: the doorways the mall closes and opens while nobody looks. */
  setGapWall(k: number, closed: boolean): void;
  /** Shows (or hides) the pit of an arrival garage's landing: the ramp from below and its shaft. Hidden while the ramp it continues is on screen. */
  setPit(visible: boolean): void;
  dispose(): void;
}

/**
 * `partial`: a piece of the garage dressed into the mall (the strip): no booth, no phone. `gapWalls`: walls that fill
 * doorways, each shown or hidden on its own (`setGapWall`); hidden at first.
 */
export function createGarageView(layout: GarageLayout, opts: { partial?: boolean; gapWalls?: Box[] } = {}): GarageView {
  const group = new THREE.Group();
  group.name = "garage";
  const disposables: { dispose(): void }[] = [];
  const own = <T extends { dispose(): void }>(d: T): T => {
    disposables.push(d);
    return d;
  };
  const addMerged = (geos: THREE.BufferGeometry[], material: THREE.Material) => {
    if (!geos.length) return;
    const merged = mergeGeometries(geos, false);
    geos.forEach((g) => g.dispose());
    if (!merged) return;
    group.add(new THREE.Mesh(own(merged), own(material)));
  };

  // floor and ceiling
  const floorMat = own(new THREE.MeshStandardMaterial({ map: own(concrete(layout.width / 4, layout.depth / 4, 96)), roughness: 0.82, color: 0xb0b2b6 }));
  let floor: THREE.Mesh;
  if (layout.landing) {
    // an arrival garage: a hole where the ramp comes up from below
    const l = layout.landing.box;
    const shape = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(layout.width, 0), new THREE.Vector2(layout.width, layout.depth), new THREE.Vector2(0, layout.depth)]);
    shape.holes.push(new THREE.Path([new THREE.Vector2(l.x0, l.y0), new THREE.Vector2(l.x1, l.y0), new THREE.Vector2(l.x1, l.y1), new THREE.Vector2(l.x0, l.y1)]));
    const geo = new THREE.ShapeGeometry(shape);
    const uv = geo.getAttribute("uv");
    for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) / layout.width, uv.getY(k) / layout.depth);
    geo.rotateX(-Math.PI / 2); // flat, facing up (plan y becomes -z)
    floor = new THREE.Mesh(own(geo), floorMat);
  } else {
    floor = new THREE.Mesh(own(new THREE.PlaneGeometry(layout.width, layout.depth)), floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(layout.width / 2, 0, -layout.depth / 2);
  }
  // the ceiling, with a hole where each ramp goes up through it
  const ceilingShape = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(layout.width, 0), new THREE.Vector2(layout.width, -layout.depth), new THREE.Vector2(0, -layout.depth)]);
  for (const r of layout.ramps) {
    const h = rampHole(r);
    ceilingShape.holes.push(new THREE.Path([new THREE.Vector2(h.x0, -h.y0), new THREE.Vector2(h.x1, -h.y0), new THREE.Vector2(h.x1, -h.y1), new THREE.Vector2(h.x0, -h.y1)]));
  }
  const ceilingGeo = new THREE.ShapeGeometry(ceilingShape);
  const uv = ceilingGeo.getAttribute("uv");
  for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) / layout.width, 1 + uv.getY(k) / layout.depth); // the texture's repeat is per whole ceiling
  ceilingGeo.rotateX(Math.PI / 2); // flat, facing down
  const ceiling = new THREE.Mesh(own(ceilingGeo), own(new THREE.MeshStandardMaterial({ map: own(concrete(layout.width / 5, layout.depth / 5, 70)), roughness: 0.95, color: 0x8a8c90 })));
  ceiling.position.set(0, layout.height, 0);
  group.add(floor, ceiling);

  // walls, columns (with a yellow band), the stairwell door, the booth, the phone
  const wallTex = own(concrete(1, 1, 120));
  const wallMat = own(new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.9, color: 0xa9abae }));
  addMerged(layout.boxes.filter((b) => b.kind === "wall").map(boxGeo), wallMat);
  const gapWalls = (opts.gapWalls ?? []).map((b) => {
    const m = new THREE.Mesh(own(boxGeo(b)), wallMat);
    m.visible = false;
    group.add(m);
    return m;
  });
  const cols = layout.boxes.filter((b) => b.kind === "column");
  addMerged(cols.map(boxGeo), new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.9, color: 0x9a9ca0 }));
  addMerged(
    cols.map((b) => {
      const g = new THREE.BoxGeometry(b.x1 - b.x0 + 0.02, 0.45, b.y1 - b.y0 + 0.02);
      return at(g, (b.x0 + b.x1) / 2, 0.9, -(b.y0 + b.y1) / 2);
    }),
    new THREE.MeshStandardMaterial({ color: 0xc9a227, roughness: 0.7 }),
  );
  addMerged(layout.boxes.filter((b) => b.kind === "door").map(boxGeo), new THREE.MeshStandardMaterial({ color: 0x5c6670, roughness: 0.5, metalness: 0.5 }));
  addMerged(layout.boxes.filter((b) => b.kind === "booth").map(boxGeo), new THREE.MeshStandardMaterial({ color: 0x6f7a72, roughness: 0.8 }));
  addMerged(layout.boxes.filter((b) => b.kind === "phone").map(boxGeo), new THREE.MeshStandardMaterial({ color: 0x1f3d5a, roughness: 0.4, metalness: 0.4 }));
  addMerged(layout.ramps.map((r) => wedge(r.box, r.rise)), new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.95, color: 0x9c9ea2, side: THREE.DoubleSide }));

  // the pit of an arrival garage: the ramp from below (the wedge sunk by its rise) and the shaft walls along its sides and foot
  const pit = new THREE.Group();
  pit.visible = false;
  if (layout.landing) {
    const { box: l, rise } = layout.landing;
    const w = wedge(l, rise);
    w.translate(0, -l.top, 0);
    pit.add(new THREE.Mesh(own(w), new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.95, color: 0x9c9ea2, side: THREE.DoubleSide })));
    const shaft: THREE.BufferGeometry[] = [];
    const wall = (x0: number, x1: number, y0: number, y1: number) => shaft.push(at(new THREE.BoxGeometry(x1 - x0, l.top, y1 - y0), (x0 + x1) / 2, -l.top / 2, -(y0 + y1) / 2));
    const T = 0.1;
    if (Math.abs(Math.cos(rise)) > 0.5) {
      wall(l.x0, l.x1, l.y0 - T, l.y0);
      wall(l.x0, l.x1, l.y1, l.y1 + T);
      if (Math.cos(rise) > 0) wall(l.x0 - T, l.x0, l.y0 - T, l.y1 + T);
      else wall(l.x1, l.x1 + T, l.y0 - T, l.y1 + T);
    } else {
      wall(l.x0 - T, l.x0, l.y0, l.y1);
      wall(l.x1, l.x1 + T, l.y0, l.y1);
      if (Math.sin(rise) > 0) wall(l.x0 - T, l.x1 + T, l.y0 - T, l.y0);
      else wall(l.x0 - T, l.x1 + T, l.y1, l.y1 + T);
    }
    const merged = mergeGeometries(shaft, false);
    shaft.forEach((g) => g.dispose());
    if (merged) pit.add(new THREE.Mesh(own(merged), wallMat));
  }
  group.add(pit);

  // the booth's lit window (west face) and the payphone's lit panel
  const lit = own(new THREE.MeshBasicMaterial({ color: new THREE.Color(1.8, 1.45, 0.9) }));
  const booth = layout.booth;
  if (!opts.partial && !layout.arrival) {
  const win = new THREE.Mesh(own(new THREE.PlaneGeometry(2.2, 1.0)), lit);
  win.rotation.y = -Math.PI / 2;
  win.position.set(booth.x0 - 0.01, 1.45, -(booth.y0 + booth.y1) / 2);
  const panel = new THREE.Mesh(own(new THREE.PlaneGeometry(0.22, 0.3)), own(new THREE.MeshBasicMaterial({ color: new THREE.Color(0.5, 1.4, 0.9) })));
  panel.rotation.y = -Math.PI / 2;
  panel.position.set(booth.x0 - 0.41, 1.35, -layout.goal.y);
  group.add(win, panel);
  }

  // painted lines
  const flat = (x0: number, y0: number, x1: number, y1: number, width: number) => {
    const len = Math.hypot(x1 - x0, y1 - y0);
    const g = new THREE.PlaneGeometry(len, width);
    g.rotateX(-Math.PI / 2);
    g.rotateY(Math.atan2(y1 - y0, x1 - x0));
    g.translate((x0 + x1) / 2, 0.006, -(y0 + y1) / 2);
    return g;
  };
  for (const color of ["white", "yellow"] as const) {
    const geos = layout.lines.filter((l) => l.color === color).map((l) => flat(l.x0, l.y0, l.x1, l.y1, 0.1));
    addMerged(geos, new THREE.MeshStandardMaterial({ color: color === "white" ? 0xc8c8c0 : 0xc9a227, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  }

  // cars and the van
  const bodies: THREE.BufferGeometry[] = [];
  const glasses: THREE.BufferGeometry[] = [];
  const tires: THREE.BufferGeometry[] = [];
  for (const c of layout.cars) {
    const p = carParts(c.van, c.w, c.l, CAR_COLORS[c.van ? 0 : c.color % CAR_COLORS.length], c.heading, c.x, c.y);
    bodies.push(...p.body);
    glasses.push(...p.glass);
    tires.push(...p.tires);
  }
  addMerged(bodies, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.35 }));
  addMerged(glasses, new THREE.MeshStandardMaterial({ color: 0x0b1014, roughness: 0.2, metalness: 0.6 }));
  addMerged(tires, new THREE.MeshStandardMaterial({ color: 0x0c0c0d, roughness: 0.9 }));

  // fluorescent tubes and the pools of light under them: three groups so the flicker is not in step
  const poolTex = own(poolTexture());
  const tubeGeo = own(new THREE.BoxGeometry(1.25, 0.05, 0.16));
  const poolGeo = own(new THREE.PlaneGeometry(6.5, 6.5));
  poolGeo.rotateX(-Math.PI / 2);
  const steady = layout.lights.filter((l) => l.state === "on");
  const dead = layout.lights.filter((l) => l.state === "dead");
  const flick = layout.lights.filter((l) => l.state === "flicker");
  const m4 = new THREE.Matrix4();
  const instanced = (list: { x: number; y: number }[], geo: THREE.BufferGeometry, material: THREE.Material, height: number, order = 0) => {
    const mesh = new THREE.InstancedMesh(geo, material, Math.max(1, list.length));
    list.forEach((l, k) => mesh.setMatrixAt(k, m4.makeTranslation(l.x, height, -l.y)));
    mesh.count = list.length;
    mesh.frustumCulled = false;
    mesh.renderOrder = order;
    group.add(mesh);
    return mesh;
  };
  const tubeMat = own(new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 2.5, 2.8) }));
  const deadMat = own(new THREE.MeshBasicMaterial({ color: 0x25282c }));
  const poolMat = (opacity: number) => own(new THREE.MeshBasicMaterial({ map: poolTex, color: 0xdfe8ff, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
  const steadyPool = poolMat(0.34);
  instanced(steady, tubeGeo, tubeMat, layout.height - 0.05);
  instanced(dead, tubeGeo, deadMat, layout.height - 0.05);
  instanced(steady, poolGeo, steadyPool, 0.012, 1);
  const flickerGroups = [0, 1, 2].map((k) => {
    const list = flick.filter((_, i) => i % 3 === k);
    const tube = own(new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 2.5, 2.8) }));
    const pool = poolMat(0.34);
    instanced(list, tubeGeo, tube, layout.height - 0.05);
    instanced(list, poolGeo, pool, 0.012, 1);
    return { tube, pool, phase: k * 2.7 };
  });

  // hanging signs
  for (const s of layout.signs) {
    const w = s.kind === "level" ? 1.0 : 1.5;
    const h = w * (208 / 512);
    const tex = own(signTexture(s));
    const mesh = new THREE.Mesh(own(new THREE.PlaneGeometry(w, h)), own(new THREE.MeshStandardMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.18, roughness: 0.6, side: THREE.DoubleSide })));
    mesh.rotation.y = s.facing + Math.PI / 2;
    mesh.position.set(s.x, s.kind === "stairs" ? 2.3 : 2.15, -s.y);
    group.add(mesh);
    if (s.kind !== "stairs") {
      // two thin hangers to the ceiling
      for (const o of [-w * 0.4, w * 0.4]) {
        const hanger = new THREE.Mesh(own(new THREE.CylinderGeometry(0.008, 0.008, layout.height - 2.15 - h / 2, 4)), own(new THREE.MeshBasicMaterial({ color: 0x222222 })));
        hanger.position.set(s.x - Math.sin(s.facing) * o, 2.15 + h / 2 + (layout.height - 2.15 - h / 2) / 2, -(s.y + Math.cos(s.facing) * o));
        group.add(hanger);
      }
    }
  }

  const flickerLevel = (t: number, phase: number) => {
    // mostly on, with short stutters and a few darker blinks
    const a = Math.sin(t * 23 + phase) * Math.sin(t * 7.3 + phase * 1.7);
    const blink = Math.sin(t * 0.9 + phase) > 0.93 ? 0.05 : 1;
    return a > 0.55 ? 0.15 : blink;
  };

  return {
    group,
    update(seconds) {
      for (const f of flickerGroups) {
        const k = flickerLevel(seconds, f.phase);
        f.tube.color.setRGB(2.4 * k, 2.5 * k, 2.8 * k);
        f.pool.opacity = 0.34 * k;
      }
    },
    setGapWall(k, closed) {
      if (gapWalls[k]) gapWalls[k].visible = closed;
    },
    setPit(visible) {
      pit.visible = visible;
    },
    dispose() {
      disposables.forEach((d) => d.dispose());
      group.removeFromParent();
    },
  };
}
