

export const PLANS = "docs/floorplans";
export const OUT = "public/models/mall_blockout.glb";

export const CELL = 0.5;
export const NX = 300; // 150 m
export const NY = 420; // 210 m
export const FLOOR_H = 5;
export const CEIL_H = 3.5;
export const ROOF_Y = 20;
export const RAIL_H = 1.1;
// Meshes the player collides with (walls, glass, rails, stairs and their steel and columns). Keep in sync with src/engine/runtime.ts.
export const COLLIDERS = ["walls", "glass", "rails", "stairs", "elev", "column", "steel", "planter", "barrier"];

export type Box = { id: string; kind: string; x0: number; x1: number; y0: number; y1: number };
export type Poly = { id: string; kind: string; points: [number, number][] };
export type Plan = { boxes: Box[]; polygons: Poly[] };

export const WALKABLE = new Set(["hall", "foodcourt", "balcony", "bath", "secret", "garage", "cinema_lobby", "restaurant_open"]);
export const SOLID = new Set([
  "shop", "restaurant", "cinema", "kiosk", "elevator", "escalator", "intermittent", "machines", "stairs",
]);

// Cell classes
export const EMPTY = 0;
export const WALK = 1;
export const SOLIDC = 2;
export const HOLE = 3;
