// Placeholder sound: everything is synthesized with Web Audio, no files. Positional, so a slam
// down a hall sounds like it comes from that hall. Swap for recorded samples later.

/** The shadow's voice: a low rumble and a breathy hiss that follow it. Silent until `update` gives it a level above 0. */
export interface ShadowSound {
  /** World position in meters, how present it is (0 to 1), and whether it is hunting (louder, higher, faster). */
  update(x: number, y: number, z: number, level: number, hunting: boolean): void;
  dispose(): void;
}

export interface Audio {
  /** Call from a user gesture (the click that locks the pointer); browsers keep audio suspended until then. */
  resume(): void;
  /** Listener position in world meters and facing direction (yaw, radians). */
  setListener(x: number, y: number, z: number, yaw: number): void;
  creak(x: number, y: number, z: number): void;
  slam(x: number, y: number, z: number): void;
  /** A locked door being tried. */
  rattle(x: number, y: number, z: number): void;
  /** A payphone ringing, far off: two short bursts of a bell tone. */
  ring(x: number, y: number, z: number): void;
  /** Something hard hitting the floor (a chair, a bin): `strength` 0 to 1 is how hard. */
  clatter(x: number, y: number, z: number, strength: number): void;
  /** Something dragged across the floor for `seconds`. */
  scrape(x: number, y: number, z: number, seconds: number): void;
  /** Starts the shadow's continuous voice (call once; the returned handle is moved every frame). */
  shadow(): ShadowSound;
  /** A low hit, in the head, for the moment the shadow notices the player. */
  sting(): void;
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
    ring(x, y, z) {
      const c = ready();
      if (!c) return;
      const t = c.currentTime;
      const out = panner(c, x, y, z);
      out.refDistance = 6;
      out.rolloffFactor = 1.0; // it carries down the whole garage: it is the way to go
      for (const at of [0, 0.5]) {
        for (const f of [1330, 1670]) {
          const osc = c.createOscillator();
          osc.type = "square";
          osc.frequency.value = f;
          const g = c.createGain();
          const lfo = c.createOscillator(); // the bell's warble
          lfo.frequency.value = 22;
          const depth = c.createGain();
          depth.gain.value = 0.05;
          lfo.connect(depth).connect(g.gain);
          g.gain.setValueAtTime(0.0001, t + at);
          g.gain.linearRampToValueAtTime(0.07, t + at + 0.02);
          g.gain.setValueAtTime(0.07, t + at + 0.38);
          g.gain.linearRampToValueAtTime(0.0001, t + at + 0.42);
          osc.connect(g).connect(out);
          osc.start(t + at);
          lfo.start(t + at);
          osc.stop(t + at + 0.45);
          lfo.stop(t + at + 0.45);
        }
      }
    },
    clatter(x, y, z, strength) {
      const c = ready();
      if (!c) return;
      const t = c.currentTime;
      const out = panner(c, x, y, z);
      const k = Math.max(0.15, Math.min(1, strength));
      // A short bright crack of noise, then a hollow plastic/metal ring that dies away.
      const crack = c.createBufferSource();
      crack.buffer = noiseBuffer(c);
      const band = c.createBiquadFilter();
      band.type = "bandpass";
      band.frequency.value = 1500;
      band.Q.value = 0.7;
      const crackGain = c.createGain();
      crackGain.gain.setValueAtTime(1.1 * k, t);
      crackGain.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
      crack.connect(band).connect(crackGain).connect(out);
      crack.start(t);
      crack.stop(t + 0.2);
      for (const [f, len] of [[310, 0.5], [740, 0.3], [1260, 0.18]] as const) {
        const ring = c.createOscillator();
        ring.type = "triangle";
        ring.frequency.setValueAtTime(f * (1 + 0.04 * Math.random()), t);
        const g = c.createGain();
        g.gain.setValueAtTime(0.3 * k, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + len * (0.6 + k * 0.6));
        ring.connect(g).connect(out);
        ring.start(t);
        ring.stop(t + len * 1.3);
      }
    },
    scrape(x, y, z, seconds) {
      const c = ready();
      if (!c) return;
      const t = c.currentTime;
      const out = panner(c, x, y, z);
      // Noise through a narrow band that slides down as it slows, shuddering like plastic feet on tile.
      const src = c.createBufferSource();
      src.buffer = noiseBuffer(c);
      src.loop = true;
      const band = c.createBiquadFilter();
      band.type = "bandpass";
      band.Q.value = 3;
      band.frequency.setValueAtTime(1300, t);
      band.frequency.exponentialRampToValueAtTime(420, t + seconds);
      const shudder = c.createOscillator();
      shudder.frequency.value = 34;
      const depth = c.createGain();
      depth.gain.value = 0.25;
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.5, t + 0.06);
      g.gain.linearRampToValueAtTime(0.0001, t + seconds);
      shudder.connect(depth).connect(g.gain);
      src.connect(band).connect(g).connect(out);
      src.start(t);
      shudder.start(t);
      src.stop(t + seconds + 0.05);
      shudder.stop(t + seconds + 0.05);
    },
    shadow() {
      let nodes: { out: PannerNode; rumbleGain: GainNode; hissGain: GainNode; rumbleFilter: BiquadFilterNode; sources: AudioScheduledSourceNode[] } | null = null;
      const build = (c: AudioContext) => {
        const out = panner(c, 0, 0, 0);
        out.refDistance = 5; // carries farther than a door: it is a presence, not a noise
        const loop = (filter: BiquadFilterNode) => {
          const src = c.createBufferSource();
          src.buffer = noiseBuffer(c);
          src.loop = true;
          src.connect(filter);
          src.start();
          return src;
        };
        const rumbleFilter = c.createBiquadFilter();
        rumbleFilter.type = "lowpass";
        rumbleFilter.frequency.value = 130;
        const rumbleGain = c.createGain();
        rumbleGain.gain.value = 0;
        rumbleFilter.connect(rumbleGain).connect(out);
        const hissFilter = c.createBiquadFilter();
        hissFilter.type = "bandpass";
        hissFilter.frequency.value = 1100;
        hissFilter.Q.value = 5;
        const hissGain = c.createGain();
        hissGain.gain.value = 0;
        const breath = c.createGain(); // the breath swells and falls on a slow wave
        breath.gain.value = 0;
        const lfo = c.createOscillator();
        lfo.frequency.value = 0.23;
        const lfoDepth = c.createGain();
        lfoDepth.gain.value = 0.5;
        lfo.connect(lfoDepth).connect(breath.gain);
        const bias = c.createConstantSource();
        bias.offset.value = 0.5;
        bias.connect(breath.gain);
        hissFilter.connect(breath).connect(hissGain).connect(out);
        lfo.start();
        bias.start();
        return { out, rumbleGain, hissGain, rumbleFilter, sources: [loop(rumbleFilter), loop(hissFilter), lfo, bias] };
      };
      return {
        update(x, y, z, level, hunting) {
          const c = ready();
          if (!c) return;
          nodes ??= build(c);
          const t = c.currentTime;
          nodes.out.positionX.setTargetAtTime(x, t, 0.05);
          nodes.out.positionY.setTargetAtTime(y, t, 0.05);
          nodes.out.positionZ.setTargetAtTime(z, t, 0.05);
          nodes.rumbleGain.gain.setTargetAtTime(level * (hunting ? 1.6 : 1.0), t, 0.4);
          nodes.hissGain.gain.setTargetAtTime(level * (hunting ? 0.5 : 0.22), t, 0.4);
          nodes.rumbleFilter.frequency.setTargetAtTime(hunting ? 240 : 130, t, 0.6);
        },
        dispose() {
          nodes?.sources.forEach((s) => {
            try {
              s.stop();
            } catch {
              // already stopped
            }
          });
          nodes?.out.disconnect();
          nodes = null;
        },
      };
    },
    sting() {
      const c = ready();
      if (!c) return;
      const t = c.currentTime;
      // A deep sine falling away under a swell of low noise: felt more than heard.
      const tone = c.createOscillator();
      tone.frequency.setValueAtTime(70, t);
      tone.frequency.exponentialRampToValueAtTime(32, t + 1.3);
      const toneGain = c.createGain();
      toneGain.gain.setValueAtTime(0.0001, t);
      toneGain.gain.exponentialRampToValueAtTime(0.9, t + 0.06);
      toneGain.gain.exponentialRampToValueAtTime(0.001, t + 1.5);
      tone.connect(toneGain).connect(c.destination);
      tone.start(t);
      tone.stop(t + 1.6);
      const hiss = c.createBufferSource();
      hiss.buffer = noiseBuffer(c);
      const band = c.createBiquadFilter();
      band.type = "bandpass";
      band.frequency.value = 500;
      band.Q.value = 0.8;
      const hissGain = c.createGain();
      hissGain.gain.setValueAtTime(0.0001, t);
      hissGain.gain.exponentialRampToValueAtTime(0.35, t + 0.25);
      hissGain.gain.exponentialRampToValueAtTime(0.001, t + 1.2);
      hiss.connect(band).connect(hissGain).connect(c.destination);
      hiss.start(t);
      hiss.stop(t + 1.3);
    },
    dispose() {
      void ctx?.close();
    },
  };
}
