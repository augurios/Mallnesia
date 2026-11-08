// Save data and where it lives. No DOM and no Three.js: the storage is passed in, so scripts/test-save.mts runs
// the exact code the game runs. Two slots: "checkpoint" (written automatically when the player enters
// the main atrium; the place the player returns to after being caught) and "manual" (the pause menu).
//
// What a save keeps (CLAUDE.md, "Save, load, and checkpoints"): where the player is and which area, which notes
// were read, and guard and exit progress. Sanity and flashlight charge are not saved: they reset on load.
// Small and versioned: a save from an older version is migrated, a newer or broken one is ignored, never a crash.

export const SAVE_VERSION = 1;

export type SaveSlot = "checkpoint" | "manual";
export type SaveArea = "mall" | "garage";

export interface SaveData {
  version: number;
  area: SaveArea;
  /** Position in floor-plan meters (x east, y north) and height (meters, floor 1 is 0). */
  x: number;
  y: number;
  height: number;
  /** Facing, radians. */
  yaw: number;
  /** Ids of the notes the player has read. */
  notesRead: string[];
  /** How far the guard storyline has gone (0 = not met). Set by the guard system when it exists. */
  guard: number;
  /** Ids of the exits the player has seen or opened. Set by the exit system when it exists. */
  exits: string[];
  /** Milliseconds since 1970, for the "saved at" line in the menu. */
  savedAt: number;
}

/** The part of a save the game keeps up to date besides the player's position. */
export interface Progress {
  notesRead: string[];
  guard: number;
  exits: string[];
}

export const emptyProgress = (): Progress => ({ notesRead: [], guard: 0, exits: [] });

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((s): s is string => typeof s === "string").slice(0, 500) : []);

/** Turns whatever was stored into a current-version save, or null if it cannot be trusted. */
export function parseSave(raw: unknown): SaveData | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (!isNum(r.version) || r.version < 1 || r.version > SAVE_VERSION) return null; // newer than this build: leave it alone
  // Migrations go here, one step per version (e.g. if (r.version === 1) { ...; r.version = 2 }).
  if (!isNum(r.x) || !isNum(r.y) || !isNum(r.height)) return null;
  return {
    version: SAVE_VERSION,
    area: r.area === "garage" ? "garage" : "mall",
    x: r.x,
    y: r.y,
    height: r.height,
    yaw: isNum(r.yaw) ? r.yaw : 0,
    notesRead: strings(r.notesRead),
    guard: isNum(r.guard) ? Math.max(0, r.guard) : 0,
    exits: strings(r.exits),
    savedAt: isNum(r.savedAt) ? r.savedAt : 0,
  };
}

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export interface SaveStore {
  read(slot: SaveSlot): SaveData | null;
  /** Returns false if the browser would not keep it past this visit (storage blocked or full): it still loads this session. */
  write(slot: SaveSlot, data: Omit<SaveData, "version" | "savedAt">): boolean;
  clear(slot: SaveSlot): void;
}

const key = (slot: SaveSlot) => `elmallvivo.save.${slot}`;

/**
 * `storage` is `window.localStorage` in the game, or null when it cannot even be reached. When it is blocked,
 * saves are kept in memory for the session, so checkpoints and the pause menu keep working.
 */
export function createSaveStore(storage: StorageLike | null, now: () => number = Date.now): SaveStore {
  const memory = new Map<SaveSlot, string>();
  return {
    read(slot) {
      let text: string | null = memory.get(slot) ?? null;
      if (text === null) {
        try {
          text = storage?.getItem(key(slot)) ?? null;
        } catch {
          text = null;
        }
      }
      if (text === null) return null;
      try {
        return parseSave(JSON.parse(text));
      } catch {
        return null; // corrupt: treated as no save
      }
    },
    write(slot, data) {
      const text = JSON.stringify({ ...data, version: SAVE_VERSION, savedAt: now() } satisfies SaveData);
      memory.set(slot, text);
      try {
        if (!storage) return false;
        storage.setItem(key(slot), text);
        return true;
      } catch {
        return false;
      }
    },
    clear(slot) {
      memory.delete(slot);
      try {
        storage?.removeItem(key(slot));
      } catch {
        // nothing to do
      }
    },
  };
}
