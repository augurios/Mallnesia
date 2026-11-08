// Picks the graphics preset by itself (card "Automatic quality preset"): a first guess from the device, then one
// level down whenever the game runs too slowly. No DOM and no Three.js, so scripts/test-quality.mts runs the exact
// code the game runs. The player's own choice in the pause menu always wins and turns this off.
import type { QualityLevel } from "./quality";

export interface DeviceInfo {
  /** Phone or tablet (a touch screen and a mobile browser). */
  mobile: boolean;
  /** navigator.hardwareConcurrency, 0 if unknown. */
  cores: number;
  /** navigator.deviceMemory in GB (Chrome only), 0 if unknown. */
  memoryGB: number;
  /** The GPU's name from WEBGL_debug_renderer_info, "" if hidden. */
  gpu: string;
}

const SOFTWARE_GPU = /swiftshader|llvmpipe|softpipe|software|basic render|microsoft basic/i;

/** The first guess. Integrated graphics look like any other laptop here, so the frame-time check (below) does the rest. */
export function pickInitialQuality(d: DeviceInfo): QualityLevel {
  if (SOFTWARE_GPU.test(d.gpu)) return "low"; // no graphics card at all: everything is painfully slow
  const weak = (d.cores > 0 && d.cores <= 2) || (d.memoryGB > 0 && d.memoryGB <= 2);
  if (weak) return "low";
  if (d.mobile) return d.cores >= 8 && (d.memoryGB === 0 || d.memoryGB >= 6) ? "medium" : "low"; // phones run hot: never "high"
  if ((d.cores > 0 && d.cores <= 4) || (d.memoryGB > 0 && d.memoryGB <= 4)) return "medium";
  return "high";
}

export const GOVERNOR = {
  /** Seconds of play to ignore at the start and after every drop (shaders compile, caches fill, the eye adjusts). */
  GRACE: 6,
  /** Seconds of frames looked at before judging. */
  WINDOW: 3,
  /** Below this many frames per second on average over the window, the preset drops one level. */
  MIN_FPS: 28,
  /** A single frame longer than this (seconds) is a hitch or a hidden tab, not slowness: it is not counted. */
  HITCH: 0.5,
  /** Fewer frames than this in a window is too little to judge. */
  MIN_FRAMES: 20,
};

/** Watches frame times while the player plays and says "drop" when the game is slow. It never says to go up. */
export class FrameGovernor {
  private grace = GOVERNOR.GRACE;
  private time = 0;
  private frames = 0;

  /** Call every frame with the real time since the last one (seconds) and whether the player is actually playing (not paused). */
  update(frameSeconds: number, playing: boolean): "drop" | null {
    if (!playing || frameSeconds <= 0 || frameSeconds > GOVERNOR.HITCH) return null;
    if (this.grace > 0) {
      this.grace -= frameSeconds;
      return null;
    }
    this.time += frameSeconds;
    this.frames++;
    if (this.time < GOVERNOR.WINDOW) return null;
    const fps = this.frames / this.time;
    const enough = this.frames >= GOVERNOR.MIN_FRAMES;
    this.time = 0;
    this.frames = 0;
    if (enough && fps < GOVERNOR.MIN_FPS) {
      this.grace = GOVERNOR.GRACE; // judge the new level fairly
      return "drop";
    }
    return null;
  }
}
