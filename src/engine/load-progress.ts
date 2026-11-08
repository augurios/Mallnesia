// How far loading is, as one number for the loading screen. No DOM and no Three.js, so scripts/test-load.mts runs the
// exact code the game runs. The game downloads a few things (the mall, the kit pieces, the baked occlusion, the
// navigation map) and then warms up the shaders; each is a "task" with a weight (roughly its share of the wait), and
// reports how much of it is done. The total never goes backwards, never passes 1 until every task has finished, and
// a task that fails or is optional can be marked finished so it does not hold the screen.

export interface LoadTask {
  name: string;
  /** Roughly this task's share of the waiting time. */
  weight: number;
}

export class LoadProgress {
  private tasks: { name: string; weight: number; fraction: number; done: boolean }[];
  private shown = 0;

  constructor(tasks: LoadTask[]) {
    this.tasks = tasks.map((t) => ({ name: t.name, weight: t.weight, fraction: 0, done: false }));
  }

  private find(name: string) {
    return this.tasks.find((t) => t.name === name);
  }

  /** A task made progress: `loaded` of `total` (bytes or items). A total of 0 or unknown leaves the fraction where it was. */
  report(name: string, loaded: number, total: number) {
    const t = this.find(name);
    if (!t || t.done || !(total > 0)) return;
    t.fraction = Math.max(t.fraction, Math.min(0.99, loaded / total)); // 1 only when finished
  }

  /** A task is over (it worked, or failed, or turned out not to be needed). */
  finish(name: string) {
    const t = this.find(name);
    if (t) {
      t.done = true;
      t.fraction = 1;
    }
  }

  /** 0 to 1; reaches exactly 1 only when every task has finished. Never decreases. */
  get value(): number {
    const total = this.tasks.reduce((s, t) => s + t.weight, 0);
    const done = this.tasks.reduce((s, t) => s + t.weight * t.fraction, 0);
    const v = this.complete ? 1 : Math.min(0.99, done / total);
    this.shown = Math.max(this.shown, v);
    return this.shown;
  }

  get complete(): boolean {
    return this.tasks.every((t) => t.done);
  }
}
