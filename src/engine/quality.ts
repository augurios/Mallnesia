export type QualityLevel = "low" | "medium" | "high";

export interface QualityPreset {
  /** Upper bound for the renderer pixel ratio (also capped by the screen's own ratio). */
  maxPixelRatio: number;
  /** Fog far plane in meters: less far means less to draw. */
  fogFar: number;
  /** Flashlight reach in meters. */
  torchDistance: number;
  /** Kit pieces farther than this (meters) are drawn in their far version (built with 1 cm error, see
   *  scripts/build-props.mts: under a pixel past about 8 m at 720p, 12 m at 1440p). */
  lodDistance: number;
  /** Procedural surface detail (tiles, plaster, concrete grain). The costliest per-pixel work. */
  detail: boolean;
  /** Bloom around bright highlights. */
  bloom: boolean;
  /** Film grain, vignette and color drain. */
  film: boolean;
}

export const QUALITY_LEVELS: QualityLevel[] = ["low", "medium", "high"];

export const QUALITY_PRESETS: Record<QualityLevel, QualityPreset> = {
  low: { maxPixelRatio: 0.75, fogFar: 40, torchDistance: 25, lodDistance: 6, detail: false, bloom: false, film: false },
  medium: { maxPixelRatio: 1, fogFar: 55, torchDistance: 32, lodDistance: 8, detail: true, bloom: false, film: true },
  high: { maxPixelRatio: 2, fogFar: 70, torchDistance: 40, lodDistance: 12, detail: true, bloom: true, film: true },
};

const STORAGE_KEY = "elmallvivo.quality"; // the player's own choice from the pause menu: always wins
const AUTO_KEY = "elmallvivo.quality.auto"; // where the game settled by itself (auto-quality.ts), used on the next visit

export function isQualityLevel(value: unknown): value is QualityLevel {
  return typeof value === "string" && (QUALITY_LEVELS as string[]).includes(value);
}

function read(key: string): QualityLevel | null {
  try {
    const saved = window.localStorage.getItem(key);
    if (isQualityLevel(saved)) return saved;
  } catch {
    // storage blocked: no saved choice
  }
  return null;
}

/** The player's own saved choice, or null if they never picked one. Storage may be blocked, so every access is guarded. */
export function loadQuality(): QualityLevel | null {
  return read(STORAGE_KEY);
}

/** Where the automatic preset settled last time, or null. */
export function loadAutoQuality(): QualityLevel | null {
  return read(AUTO_KEY);
}

export function saveAutoQuality(level: QualityLevel) {
  try {
    window.localStorage.setItem(AUTO_KEY, level);
  } catch {
    // storage blocked: the game just works it out again next visit
  }
}

export function saveQuality(level: QualityLevel) {
  try {
    window.localStorage.setItem(STORAGE_KEY, level);
  } catch {
    // storage blocked: the choice just won't persist
  }
}
