// Short game sounds, made in the browser: there are no audio files.
//
//   import { sfx } from '../sfx.js';
//   sfx.play('pass', streak);
//
// A browser plays nothing before the first tap or key press, so until then
// play() does nothing. `level` (0, 1, 2, ...) raises the pitch along a scale,
// so a streak climbs. M mutes (the shell listens for the key).
import { store } from './core.js';

const SCALE = [0, 2, 4, 7, 9];          // major pentatonic: any run of notes sounds right
const note = (i, base = 523.25) => base * 2 ** ((12 * Math.floor(i / 5) + SCALE[i % 5]) / 12);
const MAX_LEVEL = 12;

let ctx = null, out = null, hiss = null;
let muted = !!store.get('muted', false);

function unlock() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  if (!ctx) {
    try {
      ctx = new AC();
      const squash = ctx.createDynamicsCompressor();   // several sounds at once never clip
      out = ctx.createGain();
      out.gain.value = 0.8;
      out.connect(squash).connect(ctx.destination);
      hiss = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
      const d = hiss.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    } catch (e) { ctx = null; return; }
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
}
for (const type of ['pointerdown', 'touchend', 'click', 'keydown']) {
  addEventListener(type, unlock, { capture: true, passive: true });
}

// One note: a quick attack, then it dies away. `to` slides the pitch.
function tone(freq, at, dur, { type = 'sine', gain = 0.2, to = 0 } = {}) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, at);
  if (to) o.frequency.exponentialRampToValueAtTime(to, at + dur);
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(gain, at + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  o.connect(g).connect(out);
  o.start(at);
  o.stop(at + dur + 0.02);
}

function burst(at, dur, gain, cutoff) {
  const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
  s.buffer = hiss;
  f.type = 'lowpass';
  f.frequency.setValueAtTime(cutoff, at);
  f.frequency.exponentialRampToValueAtTime(120, at + dur);
  g.gain.setValueAtTime(gain, at);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  s.connect(f).connect(g).connect(out);
  s.start(at);
  s.stop(at + dur + 0.02);
}

const SOUNDS = {
  // a hop: a soft blip upward
  hop(t) { tone(420, t, 0.09, { type: 'triangle', gain: 0.10, to: 640 }); },
  // through a layer: one bright note, higher with every layer of the streak
  pass(t, n) {
    const f = note(n);
    tone(f, t, 0.22, { gain: 0.20 });
    tone(f * 2, t, 0.12, { gain: 0.06 });
  },
  // the face matched: two quick notes, like a coin
  match(t, n) {
    const f = note(n, 659.25);
    tone(f, t, 0.09, { type: 'triangle', gain: 0.18 });
    tone(f * 1.5, t + 0.07, 0.26, { type: 'triangle', gain: 0.20 });
    tone(f * 3, t + 0.07, 0.12, { gain: 0.05 });
  },
  crash(t) {
    burst(t, 0.28, 0.35, 2400);
    tone(180, t, 0.32, { type: 'sawtooth', gain: 0.16, to: 48 });
  },
  // a new best: a run up the scale
  best(t) {
    for (let i = 0; i < 5; i++) tone(note(i + 2), t + i * 0.075, i === 4 ? 0.5 : 0.16, { type: 'triangle', gain: 0.18 });
    tone(note(6) * 2, t + 0.3, 0.5, { gain: 0.05 });
  },
  start(t) {
    tone(note(0), t, 0.10, { type: 'triangle', gain: 0.16 });
    tone(note(3), t + 0.09, 0.20, { type: 'triangle', gain: 0.18 });
  },
  end(t) {
    tone(note(4), t, 0.14, { type: 'triangle', gain: 0.16 });
    tone(note(2), t + 0.12, 0.14, { type: 'triangle', gain: 0.16 });
    tone(note(0), t + 0.24, 0.36, { type: 'triangle', gain: 0.18 });
  },
  // the clock running out
  tick(t) { tone(880, t, 0.045, { type: 'square', gain: 0.05 }); },
};

export const sfx = {
  play(name, level = 0) {
    if (muted || !ctx || ctx.state !== 'running' || !SOUNDS[name]) return;
    try {
      SOUNDS[name](ctx.currentTime + 0.005, Math.max(0, Math.min(MAX_LEVEL, Math.floor(level) || 0)));
    } catch (e) { /* a sound is never worth an error */ }
  },
  get muted() { return muted; },
  set muted(v) {
    muted = !!v;
    store.set('muted', muted);
  },
};
