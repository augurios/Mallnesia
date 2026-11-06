import { mkdirSync, writeFileSync } from "node:fs";
import { crc32, deflateSync } from "node:zlib";
import { CELL, NX, NY, SOLIDC, EMPTY } from "./config.mts";
import { floors, outsideMask } from "./grid.mts";

// Baked ambient occlusion for floors and ceilings. The shell's floors are a few huge quads, so per-vertex AO
// would need the whole mall subdivided; a small map in plan space gives the same result at no geometry cost.
// One pixel per grid cell, the three floors stacked (floor 1 at the bottom), 255 = fully open. The shader
// (src/engine/materials.ts) samples it by world position and dims only the ambient light with it.
// Solid cells, and the enclosed gaps between rooms (walled in like solids), darken the cells around them with
// a falloff; holes and the outside do not, since they are open (the outside is glass).
export const AO_PATH = "public/models/ao.png";
const RADIUS = 5; // cells: 2.5 m
const STRENGTH = 0.8; // how dark a floor cell hard against a wall gets, at most

/** Occlusion per cell, 0 (open) to 1: the falloff-weighted share of solid cells within RADIUS. */
function occlusion(solid: Uint8Array): Float32Array {
  const out = new Float32Array(NX * NY);
  const taps: [number, number, number][] = [];
  let total = 0;
  for (let dj = -RADIUS; dj <= RADIUS; dj++)
    for (let di = -RADIUS; di <= RADIUS; di++) {
      const d = Math.hypot(di, dj);
      if (d > RADIUS) continue;
      const w = (1 - d / RADIUS) ** 2;
      taps.push([di, dj, w]);
      total += w;
    }
  for (let j = 0; j < NY; j++)
    for (let i = 0; i < NX; i++) {
      let sum = 0;
      for (const [di, dj, w] of taps) {
        const a = i + di;
        const b = j + dj;
        if (a >= 0 && b >= 0 && a < NX && b < NY && solid[b * NX + a]) sum += w;
      }
      out[j * NX + i] = sum / total;
    }
  return out;
}

function png(width: number, height: number, gray: Uint8Array): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0);
    head.write(type, 4, "ascii");
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
    return Buffer.concat([head, data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // grayscale
  const raw = Buffer.alloc((width + 1) * height); // each row starts with filter type 0
  for (let y = 0; y < height; y++) Buffer.from(gray.buffer, y * width, width).copy(raw, y * (width + 1) + 1);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

/** Writes the map. Image row f * NY + j is floor f, plan row j (the texture is loaded with flipY off, so row 0 is v = 0). */
export function bakeAO() {
  const height = floors.length * NY;
  const gray = new Uint8Array(NX * height).fill(255);
  let darkest = 255;
  floors.forEach((f, fi) => {
    const solid = new Uint8Array(NX * NY);
    const outside = outsideMask(f);
    for (let c = 0; c < solid.length; c++) solid[c] = f.cls[c] === SOLIDC || (f.cls[c] === EMPTY && !outside[c]) ? 1 : 0;
    const occ = occlusion(solid);
    for (let j = 0; j < NY; j++)
      for (let i = 0; i < NX; i++) {
        const v = Math.round(255 * (1 - STRENGTH * Math.min(1, occ[j * NX + i] * 2)));
        gray[(fi * NY + j) * NX + i] = v;
        if (v < darkest) darkest = v;
      }
  });
  mkdirSync("public/models", { recursive: true });
  const file = png(NX, height, gray);
  writeFileSync(AO_PATH, file);
  console.log(`ao: ${NX}x${height} px, ${(file.length / 1024).toFixed(0)} KB, darkest ${darkest}/255 (cell ${CELL} m)`);
}
