// Synthesizes ClipCat's sound effects into apps/desktop/resources/sfx as
// 48 kHz stereo WAVs. Every sound is built here from oscillators, noise and
// filters, with a fixed random seed, so the library is ClipCat's own work
// and comes out the same on every run. What each one means to the AI editor
// lives in apps/desktop/src/sound/library.ts.
//
//   node scripts/make-sfx.mjs

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const RATE = 48000;
const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "apps", "desktop", "resources", "sfx");
const TAU = Math.PI * 2;

/** A small seeded generator (mulberry32), so the noise is the same every run. */
function random(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const white = (seed) => {
  const r = random(seed);
  return () => r() * 2 - 1;
};

/** Pink noise (Paul Kellet's filter). */
function pink(seed) {
  const w = white(seed);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  return () => {
    const x = w();
    b0 = 0.99886 * b0 + x * 0.0555179;
    b1 = 0.99332 * b1 + x * 0.0750759;
    b2 = 0.969 * b2 + x * 0.153852;
    b3 = 0.8665 * b3 + x * 0.3104856;
    b4 = 0.55 * b4 + x * 0.5329522;
    b5 = -0.7616 * b5 - x * 0.016898;
    const y = b0 + b1 + b2 + b3 + b4 + b5 + b6 + x * 0.5362;
    b6 = x * 0.115926;
    return y * 0.11;
  };
}

/** A state-variable filter (topology-preserving) whose cutoff can move every sample. */
function svf() {
  let ic1 = 0, ic2 = 0;
  return (x, cutoff, q) => {
    const g = Math.tan((Math.PI * Math.min(cutoff, RATE * 0.45)) / RATE);
    const k = 1 / q;
    const a1 = 1 / (1 + g * (g + k));
    const v3 = x - ic2;
    const v1 = a1 * ic1 + g * a1 * v3;
    const v2 = ic2 + g * v1;
    ic1 = 2 * v1 - ic1;
    ic2 = 2 * v2 - ic2;
    return { low: v2, band: v1, high: x - k * v1 - v2 };
  };
}

/** A one-pole low-pass. */
function onePole(cutoff) {
  const a = Math.exp((-TAU * cutoff) / RATE);
  let y = 0;
  return (x) => (y = (1 - a) * x + a * y);
}

/** `seconds` of stereo, from `fn(t, i)` returning [left, right] or one value for both. */
function render(seconds, fn) {
  const n = Math.round(seconds * RATE);
  const left = new Float32Array(n);
  const right = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const v = fn(i / RATE, i);
    left[i] = Array.isArray(v) ? v[0] : v;
    right[i] = Array.isArray(v) ? v[1] : v;
  }
  return [left, right];
}

const decay = (t, tau) => Math.exp(-t / tau);
const attack = (t, seconds) => Math.min(1, t / seconds);
const sine = (phase) => Math.sin(TAU * phase);

/** A struck bell or bar: inharmonic partials, each fading at its own rate. */
function bell(t, f, partials) {
  let v = 0;
  for (const [ratio, amp, tau] of partials) v += amp * sine(f * ratio * t) * decay(t, tau);
  return v * attack(t, 0.002);
}

const SOUNDS = {
  whoosh() {
    const n = pink(11);
    const rumble = pink(12);
    const f = svf();
    const lp = onePole(180);
    const T = 0.75;
    return render(T, (t) => {
      const p = Math.pow(t / T, 0.85);
      const swell = Math.pow(Math.sin(Math.PI * p), 2);
      const cutoff = 300 + 2600 * Math.pow(Math.sin(Math.PI * p), 1.5);
      const v = f(n(), cutoff, 1.4).band * 2.2 * swell + lp(rumble()) * 1.5 * swell;
      const pan = (t / T) * (Math.PI / 2);
      return [v * Math.cos(pan) * 1.2, v * Math.sin(pan) * 1.2];
    });
  },
  swish() {
    const n = white(21);
    const f = svf();
    const T = 0.35;
    return render(T, (t) => {
      const cutoff = 1200 * Math.pow(5, t / T);
      return f(n(), cutoff, 1.8).band * attack(t, 0.03) * decay(t, 0.09);
    });
  },
  pop() {
    let phase = 0;
    const n = white(31);
    return render(0.14, (t) => {
      phase += (180 + 900 * decay(t, 0.012)) / RATE;
      return sine(phase) * attack(t, 0.0015) * decay(t, 0.03) + n() * 0.15 * decay(t, 0.002);
    });
  },
  click() {
    const n = white(41);
    const f = svf();
    return render(0.06, (t) => f(n(), 4000, 0.9).high * decay(t, 0.0025) * 0.9 + sine(2400 * t) * decay(t, 0.012) * 0.5);
  },
  tick() {
    return render(0.09, (t) => (sine(1750 * t) * 0.8 + sine(3620 * t) * 0.35) * attack(t, 0.0008) * decay(t, 0.014));
  },
  ding() {
    return render(1.6, (t) => bell(t, 1318.5, [
      [1, 1, 0.55],
      [2.76, 0.45, 0.22],
      [5.4, 0.22, 0.1],
      [8.93, 0.1, 0.05],
    ]));
  },
  chime() {
    const bar = (t, f) => (t < 0 ? 0 : bell(t, f, [[1, 1, 0.35], [3.99, 0.25, 0.08], [10.7, 0.08, 0.02]]));
    return render(1.1, (t) => {
      const v = bar(t, 1046.5) * 0.8 + bar(t - 0.13, 1568) * 0.9;
      return [v * 1.05, v * 0.95];
    });
  },
  riser() {
    const n = white(51);
    const f = svf();
    let phase = 0;
    const T = 1.6;
    return render(T, (t) => {
      const p = t / T;
      phase += (180 * Math.pow(7, p)) / RATE;
      const swell = Math.pow(p, 2.2);
      const v = f(n(), 400 * Math.pow(16, p), 2.5).band * 1.8 + (sine(phase) + 0.3 * sine(phase * 2.01)) * 0.25;
      return v * swell * Math.min(1, (T - t) / 0.012);
    });
  },
  boom() {
    const n = white(61);
    const lp = onePole(400);
    let phase = 0;
    return render(1.3, (t) => {
      phase += (42 + 90 * decay(t, 0.05)) / RATE;
      const body = sine(phase) * decay(t, 0.38) * attack(t, 0.002);
      const thump = lp(n()) * 3 * decay(t, 0.04);
      return Math.tanh((body + thump) * 1.6) * 0.9;
    });
  },
  blip() {
    const note = (t, f, len) => (t < 0 || t > len + 0.2 ? 0 : (sine(f * t) + 0.18 * sine(3 * f * t)) * attack(t, 0.004) * decay(t, len / 2.5));
    return render(0.4, (t) => note(t, 880, 0.07) * 0.8 + note(t - 0.1, 1318.5, 0.1));
  },
  buzz() {
    const lp = onePole(1400);
    return render(0.5, (t) => {
      const on = (t < 0.17 ? 1 : t > 0.23 && t < 0.45 ? 1 : 0) * Math.min(1, (t % 0.23) / 0.005);
      const saw = ((t * 150) % 1) * 2 - 1;
      return lp(saw * on) * 0.9;
    });
  },
  shutter() {
    const n = white(71);
    const f = svf();
    const lp = onePole(250);
    const thump = white(72);
    const clack = (t) => (t < 0 ? 0 : decay(t, 0.006));
    return render(0.28, (t) => {
      const e = clack(t) + clack(t - 0.085) * 0.8;
      return f(n(), 2600, 1.2).band * e * 3 + lp(thump()) * e * 2;
    });
  },
  scratch() {
    const n = white(81);
    const f = svf();
    const T = 0.45;
    return render(T, (t) => {
      const cutoff = 500 + 2800 * Math.abs(Math.sin(TAU * 2.1 * t));
      return f(n(), cutoff, 3).band * 2.4 * attack(t, 0.01) * Math.min(1, (T - t) / 0.06);
    });
  },
};

/** Peaks at -3 dBFS, fades the last 5 ms, and writes 16-bit PCM. */
function wav([left, right]) {
  let peak = 0;
  for (let i = 0; i < left.length; i++) peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
  const gain = peak > 0 ? 0.708 / peak : 1;
  const fade = Math.round(0.005 * RATE);
  const n = left.length;
  const data = Buffer.alloc(n * 4);
  for (let i = 0; i < n; i++) {
    const tail = Math.min(1, (n - 1 - i) / fade);
    data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, left[i] * gain * tail)) * 32767), i * 4);
    data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, right[i] * gain * tail)) * 32767), i * 4 + 2);
  }
  const head = Buffer.alloc(44);
  head.write("RIFF", 0);
  head.writeUInt32LE(36 + data.length, 4);
  head.write("WAVE", 8);
  head.write("fmt ", 12);
  head.writeUInt32LE(16, 16);
  head.writeUInt16LE(1, 20);
  head.writeUInt16LE(2, 22);
  head.writeUInt32LE(RATE, 24);
  head.writeUInt32LE(RATE * 4, 28);
  head.writeUInt16LE(4, 32);
  head.writeUInt16LE(16, 34);
  head.write("data", 36);
  head.writeUInt32LE(data.length, 40);
  return Buffer.concat([head, data]);
}

mkdirSync(OUT, { recursive: true });
for (const [id, make] of Object.entries(SOUNDS)) {
  const sound = make();
  writeFileSync(join(OUT, `${id}.wav`), wav(sound));
  console.log(`${id}.wav ${(sound[0].length / RATE).toFixed(2)}s`);
}
