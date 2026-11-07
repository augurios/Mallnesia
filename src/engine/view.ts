// Player view settings: mouse sensitivity and the optional camera motion (head bob, the run FOV kick).
// Saved like the quality preset; storage may be blocked, so every access is guarded.

export interface ViewSettings {
  /** Multiplies the base look speed. */
  sensitivity: number;
  /** Head bob while walking and the slight FOV widening while running. Off for players who get motion sick. */
  motion: boolean;
}

export const SENSITIVITY_MIN = 0.3;
export const SENSITIVITY_MAX = 2;
export const SENSITIVITY_STEP = 0.1;

const STORAGE_KEY = "elmallvivo.view";

const clampSensitivity = (v: number) => Math.min(SENSITIVITY_MAX, Math.max(SENSITIVITY_MIN, v));

/** Camera motion starts off when the system asks for reduced motion. */
function defaults(): ViewSettings {
  let reduce = false;
  try {
    reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    // no matchMedia: keep motion on
  }
  return { sensitivity: 1, motion: !reduce };
}

export function loadView(): ViewSettings {
  const view = defaults();
  try {
    const saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "{}");
    if (typeof saved.sensitivity === "number" && Number.isFinite(saved.sensitivity)) view.sensitivity = clampSensitivity(saved.sensitivity);
    if (typeof saved.motion === "boolean") view.motion = saved.motion;
  } catch {
    // storage blocked or corrupt: defaults
  }
  return view;
}

export function saveView(view: ViewSettings) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(view));
  } catch {
    // storage blocked: the choice just won't persist
  }
}

export function normalizeView(view: ViewSettings): ViewSettings {
  return { sensitivity: clampSensitivity(view.sensitivity), motion: view.motion };
}
