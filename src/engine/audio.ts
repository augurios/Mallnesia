// Placeholder sound: everything is synthesized with Web Audio, no files. Positional, so a slam
// down a hall sounds like it comes from that hall. Swap for recorded samples later.

export interface Audio {
  /** Call from a user gesture (the click that locks the pointer); browsers keep audio suspended until then. */
  resume(): void;
  /** Listener position in world meters and facing direction (yaw, radians). */
  setListener(x: number, y: number, z: number, yaw: number): void;
  creak(x: number, y: number, z: number): void;
  slam(x: number, y: number, z: number): void;
  /** A locked door being tried. */
  rattle(x: number, y: number, z: number): void;
  dispose(): void;
}

export function createAudio(): Audio {
  let ctx: AudioContext | null = null;
  let noise: AudioBuffer | null = null;
  try {
    ctx = new AudioContext();
  } catch {
    // No Web Audio: the game stays silent.
  }

  const ready = () => (ctx && ctx.state === "running" ? ctx : null);

  function noiseBuffer(c: AudioContext) {
    if (!noise) {
      noise = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
      const data = noise.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    }
    return noise;
  }

  function panner(c: AudioContext, x: number, y: number, z: number) {
    const p = c.createPanner();
    p.panningModel = "HRTF";
    p.distanceModel = "inverse";
    p.refDistance = 3;
    p.maxDistance = 80;
    p.rolloffFactor = 1.3;
    p.positionX.value = x;
    p.positionY.value = y;
    p.positionZ.value = z;
    p.connect(c.destination);
    return p;
  }

  return {
    resume() {
      void ctx?.resume();
    },
    setListener(x, y, z, yaw) {
      const c = ready();
      if (!c) return;
      const l = c.listener;
      l.positionX.value = x;
      l.positionY.value = y;
      l.positionZ.value = z;
      l.forwardX.value = -Math.sin(yaw);
      l.forwardY.value = 0;
      l.forwardZ.value = -Math.cos(yaw);
      l.upX.value = 0;
      l.upY.value = 1;
      l.upZ.value = 0;
    },
    creak(x, y, z) {
      const c = ready();
      if (!c) return;
      const t = c.currentTime;
      const out = panner(c, x, y, z);
      // A saw whose pitch wobbles and wanders, through a narrow band: reads as a dry hinge.
      const osc = c.createOscillator();
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(150, t);
      osc.frequency.linearRampToValueAtTime(240, t + 0.7);
      osc.frequency.linearRampToValueAtTime(170, t + 1.6);
      const vibrato = c.createOscillator();
      vibrato.frequency.value = 9;
      const vibratoDepth = c.createGain();
      vibratoDepth.gain.value = 18;
      vibrato.connect(vibratoDepth).connect(osc.frequency);
      const band = c.createBiquadFilter();
      band.type = "bandpass";
      band.frequency.value = 700;
      band.Q.value = 6;
      const gain = c.createGain();
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.35, t + 0.25);
      gain.gain.linearRampToValueAtTime(0.2, t + 1.1);
      gain.gain.linearRampToValueAtTime(0, t + 1.7);
      osc.connect(band).connect(gain).connect(out);
      osc.start(t);
      vibrato.start(t);
      osc.stop(t + 1.8);
      vibrato.stop(t + 1.8);
    },
    slam(x, y, z) {
      const c = ready();
      if (!c) return;
      const t = c.currentTime;
      const out = panner(c, x, y, z);
      // Thump (falling sine) plus a short noise crack.
      const thump = c.createOscillator();
      thump.frequency.setValueAtTime(110, t);
      thump.frequency.exponentialRampToValueAtTime(35, t + 0.3);
      const thumpGain = c.createGain();
      thumpGain.gain.setValueAtTime(1.2, t);
      thumpGain.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
      thump.connect(thumpGain).connect(out);
      thump.start(t);
      thump.stop(t + 0.6);
      const crack = c.createBufferSource();
      crack.buffer = noiseBuffer(c);
      const low = c.createBiquadFilter();
      low.type = "lowpass";
      low.frequency.value = 2200;
      const crackGain = c.createGain();
      crackGain.gain.setValueAtTime(0.9, t);
      crackGain.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
      crack.connect(low).connect(crackGain).connect(out);
      crack.start(t);
      crack.stop(t + 0.4);
    },
    rattle(x, y, z) {
      const c = ready();
      if (!c) return;
      const t = c.currentTime;
      const out = panner(c, x, y, z);
      // Three short, dull knocks of filtered noise.
      for (const at of [0, 0.11, 0.2]) {
        const src = c.createBufferSource();
        src.buffer = noiseBuffer(c);
        const band = c.createBiquadFilter();
        band.type = "bandpass";
        band.frequency.value = 400;
        band.Q.value = 1.5;
        const g = c.createGain();
        g.gain.setValueAtTime(0.5, t + at);
        g.gain.exponentialRampToValueAtTime(0.001, t + at + 0.07);
        src.connect(band).connect(g).connect(out);
        src.start(t + at);
        src.stop(t + at + 0.08);
      }
    },
    dispose() {
      void ctx?.close();
    },
  };
}
