// node dev/brow/test_detector.mjs : the blink / eyebrow / mouth detector against synthetic faces.
// Each scenario is a clean signal over time. It is sampled at 15, 30 and 60
// results a second with uneven timing and +-0.03 of noise, many times over,
// and must give exactly the expected number of events every time.
import { RaiseDetector, BLINK, BROW, JAW } from '../../app/games/brow-detector.js';

const NOISE = 0.03, SEEDS = 40, RATES = [15, 30, 60];

function rng(seed) {                      // mulberry32
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ease = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
// One movement, 0..1: up in `up` ms, held for `hold`, down in `down`.
const pulse = (t, at, up, hold, down) =>
  t < at + up + hold ? ease((t - at) / up) : 1 - ease((t - at - up - hold) / down);
const train = (t, starts, up, hold, down) => Math.max(0, ...starts.map((at) => pulse(t, at, up, hold, down)));
const every = (first, step, n) => Array.from({ length: n }, (_, i) => first + i * step);
// A blink whose lid is more than half shut for `width` ms: shut in 50 ms, open again in 90.
const blinks = (t, starts, width) => train(t, starts, 50, width - 70, 90);

// natural blinks, 3 to 5 s apart, 100 to 160 ms each
const natural = (() => {
  const r = rng(99), list = [];
  for (let t = 2500; t < 40000; t += 3000 + 2000 * r()) list.push([t, 100 + 60 * r(), 0.45 + 0.15 * r()]);
  return list;
})();

// [name, detector settings, signal(t in ms), length in ms, events expected, { onsets to time, limit, hole }]
const scenarios = [
  // ---- blinks ----
  ['eyes open, 30 s', BLINK, () => 0.18, 30000, 0],
  ['one blink of 100 ms', BLINK, (t) => 0.18 + 0.55 * blinks(t, [2000], 100), 4000, 1, { onsets: [2000], limit: 30 }],
  ['one blink of 150 ms', BLINK, (t) => 0.18 + 0.55 * blinks(t, [2000], 150), 4000, 1, { onsets: [2000], limit: 30 }],
  ['one blink of 250 ms', BLINK, (t) => 0.18 + 0.55 * blinks(t, [2000], 250), 4000, 1, { onsets: [2000], limit: 30 }],
  ['eyes shut slowly (0.5 s) and kept shut for 3 s', BLINK, (t) => 0.18 + 0.55 * pulse(t, 2000, 500, 3000, 400), 8000, 1],
  ['eight blinks, three a second', BLINK, (t) => 0.18 + 0.5 * blinks(t, every(2000, 330, 8), 130), 6000, 8],
  ['looking down, resting level 0.45: five blinks', BLINK, (t) => 0.45 + 0.35 * blinks(t, every(2000, 800, 5), 150), 7000, 5],
  ['small blinks (0.25 over a resting 0.12), six', BLINK, (t) => 0.12 + 0.25 * blinks(t, every(2000, 800, 6), 150), 8000, 6],
  [`natural blinks 3 to 5 s apart, 40 s (${natural.length})`, BLINK,
    (t) => 0.18 + Math.max(0, ...natural.map(([at, w, a]) => a * pulse(t, at, 50, w - 70, 90))), 40000, natural.length],
  ['a smile lifts the resting level by 0.15', BLINK, (t) => 0.18 + 0.15 * pulse(t, 2000, 600, 3000, 600), 8000, 0],
  ['the gaze drops: +0.10 in 0.2 s, and back', BLINK, (t) => 0.18 + 0.10 * pulse(t, 2000, 200, 1500, 200), 6000, 0],
  ['blinks while smiling and looking down', BLINK, (t) =>
    0.18 + 0.15 * pulse(t, 1500, 600, 5000, 600) + 0.10 * pulse(t, 3000, 200, 1500, 200) + 0.45 * blinks(t, every(2500, 900, 5), 140), 9000, 5],
  // ---- eyebrows ----
  ['resting brows, 30 s', BROW, () => 0.04, 30000, 0],
  ['one quick raise', BROW, (t) => 0.04 + 0.5 * pulse(t, 2000, 120, 300, 180), 5000, 1, { onsets: [2000], limit: 90 }],
  ['one slow raise (0.8 s up)', BROW, (t) => 0.04 + 0.5 * pulse(t, 2000, 800, 400, 600), 6000, 1],
  ['raise held for 6 s', BROW, (t) => 0.04 + 0.5 * pulse(t, 2000, 150, 6000, 200), 10000, 1, { onsets: [2000], limit: 90 }],
  ['two fast raises, half relaxed between', BROW, (t) =>
    0.04 + 0.5 * Math.max(train(t, [2000, 2450], 120, 150, 250), 0.5 * pulse(t, 2100, 100, 500, 200)), 5000, 2],
  ['ten raises 0.7 s apart, never fully relaxed', BROW, (t) =>
    0.04 + 0.5 * Math.max(train(t, every(2000, 700, 10), 130, 170, 200), 0.35 * pulse(t, 1900, 100, 7000, 300)), 11000, 10],
  ['resting level drifts up 0.2 in 10 s', BROW, (t) => 0.04 + 0.2 * Math.min(1, t / 10000), 14000, 0],
  ['raises on a drifting resting level', BROW, (t) =>
    0.04 + 0.2 * Math.min(1, t / 10000) + 0.45 * train(t, every(2000, 1500, 6), 130, 250, 200), 12000, 6],
  ['small range: 0.02 at rest, 0.27 raised', BROW, (t) => 0.02 + 0.25 * train(t, every(2000, 1000, 5), 130, 250, 200), 8000, 5],
  ['high resting value: 0.35 at rest, 0.9 raised', BROW, (t) => 0.35 + 0.55 * train(t, every(2000, 900, 5), 130, 250, 200), 8000, 5],
  ['a big first raise, then small ones', BROW, (t) =>
    0.04 + Math.max(0.7 * pulse(t, 2000, 150, 400, 250), 0.30 * train(t, every(4000, 900, 5), 130, 250, 200)), 10000, 6],
  ['a dark, noisy picture: bursts of 0.08, no raise', BROW, (t) => 0.04 + 0.08 * Math.max(0, Math.sin(t / 130) * Math.sin(t / 47)), 20000, 0],
  ['face away for 1.5 s, back with another resting value', BROW, (t) => (t < 3000 ? 0.04 : 0.3), 8000, 0, { hole: [3000, 4500] }],
  // ---- mouth ----
  ['talking: the jaw moves 0.15, 20 s', JAW, (t) => 0.05 + 0.075 * (1 + Math.sin(t / 90)), 20000, 0],
  ['mouth opened four times', JAW, (t) => 0.05 + 0.5 * train(t, every(2000, 1000, 4), 150, 250, 200), 7000, 4],
];

let failed = 0;
for (const [name, options, signal, length, expected, opt = {}] of scenarios) {
  const bad = [];
  const delays = [];
  for (const hz of RATES) {
    for (let seed = 1; seed <= SEEDS; seed++) {
      const rand = rng(seed * 7919 + hz);
      const det = new RaiseDetector(options);
      const fires = [];
      const calib = [];
      let t = 0;
      while (t < length) {
        t += (1000 / hz) * (0.7 + 0.6 * rand());          // cameras do not tick evenly
        if (opt.hole && t > opt.hole[0] && t < opt.hole[1]) continue;
        const v = signal(t) + NOISE * (2 * rand() - 1);
        if (!det.ready) {                                 // the game's first second
          calib.push(v);
          if (t >= 1000) det.calibrate(calib.sort((a, b) => a - b)[calib.length >> 1], t);
          continue;
        }
        if (det.update(v, t)) fires.push(t);
      }
      if (fires.length !== expected) bad.push(`${hz} Hz seed ${seed}: ${fires.length}`);
      if (opt.onsets && fires.length === expected) opt.onsets.forEach((at, i) => delays.push([hz, fires[i] - at]));
    }
  }
  let note = '';
  if (opt.onsets) {
    for (const hz of RATES) {
      const d = delays.filter((x) => x[0] === hz).map((x) => x[1]);
      if (!d.length) continue;
      const worst = Math.max(...d), limit = opt.limit + 2 * 1000 / hz;   // part of the movement itself, plus two samples
      note += `  ${hz} Hz: ${Math.round(d.reduce((a, b) => a + b, 0) / d.length)} ms (worst ${Math.round(worst)})`;
      if (worst > limit) bad.push(`${hz} Hz: fired ${Math.round(worst)} ms after it began (limit ${Math.round(limit)})`);
    }
  }
  const ok = bad.length === 0;
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}: ${expected}${note ? '\n     heard after' + note : ''}`);
  if (!ok) console.log('     ' + bad.slice(0, 6).join('; ') + (bad.length > 6 ? ` ... (${bad.length} runs)` : ''));
}
console.log(failed ? `\n${failed} scenario(s) failed` : `\nall ${scenarios.length} scenarios pass at ${RATES.join(', ')} Hz x ${SEEDS} seeds`);
process.exit(failed ? 1 : 0);
