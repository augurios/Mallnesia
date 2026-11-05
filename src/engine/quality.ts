export type QualityLevel = "low" | "medium" | "high";

export interface QualityPreset {
  /** Upper bound for the renderer pixel ratio (also capped by the screen's own ratio). */
  maxPixelRatio: number;
  /** Fog far plane in meters: less far means less to draw. */
  fogFar: number;
  /** Flashlight reach in meters. */
  torchDistance: number;
  /** Procedural surface detail (tiles, plaster, concrete grain). The costliest per-pixel work. */
  detail: boolean;
  /** Bloom around bright highlights. */
  bloom: boolean;
  /** Film grain, vignette and color drain. */
  film: boolean;
}

export const QUALITY_LEVELS: QualityLevel[] = ["low", "medium", "high"];

export const QUALITY_PRESETS: Record<QualityLevel, QualityPreset> = {
  low: { maxPixelRatio: 0.75, fogFar: 40, torchDistance: 25, detail: false, bloom: false, film: false },
  medium: { maxPixelRatio: 1, fogFar: 55, torchDistance: 32, detail: true, bloom: false, film: true },
  high: { maxPixelRatio: 2, fogFar: 70, torchDistance: 40, detail: true, bloom: true, film: true },
};

const STORAGE_KEY = "elmallvivo.quality";

export function isQualityLevel(value: unknown): value is QualityLevel {
  return typeof value === "string" && (QUALITY_LEVELS as string[]).includes(value);
}

/** Saved choice, or "high". Storage may be blocked, so every access is guarded. */
export function loadQuality(): QualityLevel {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (isQualityLevel(saved)) return saved;
  } catch {
    // storage blocked: fall through to the default
  }
  return "high";
}

export function saveQuality(level: QualityLevel) {
  try {
    window.localStorage.setItem(STORAGE_KEY, level);
  } catch {
    // storage blocked: the choice just won't persist
  }
}
