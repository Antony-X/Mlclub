// node dev/brow/test_detector.mjs : the blink detector against synthetic eyes.
// Each scenario is a clean "eye blink" signal over time. It is sampled at 15,
// 30 and 60 results a second with uneven timing and +-0.03 of noise, many
// times over, and must give exactly the expected number of blinks every time.
import { BlinkDetector } from '../../app/games/brow-detector.js';

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
// One closing of the eyes, 0..1: shut in `up` ms, held for `hold`, open in `down`.
const pulse = (t, at, up, hold, down) =>
  t < at + up + hold ? ease((t - at) / up) : 1 - ease((t - at - up - hold) / down);
const train = (t, starts, up, hold, down) => Math.max(0, ...starts.map((at) => pulse(t, at, up, hold, down)));
const every = (first, step, n) => Array.from({ length: n }, (_, i) => first + i * step);
// A blink whose lid is more than half shut for `width` ms: shut in 50 ms, open again in 90.
const blinks = (t, starts, width) => train(t, starts, 50, width - 70, 90);

// A signal drawn point to point: [[ms, value], ...], straight lines between.
const path = (t, points) => {
  if (t <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) {
    const [t0, v0] = points[i - 1], [t1, v1] = points[i];
    if (t <= t1) return v0 + (v1 - v0) * (t - t0) / (t1 - t0);
  }
  return points[points.length - 1][1];
};
// the same shape repeated at each start
const each = (t, starts, shape) => {
  let at = starts[0];
  for (const s of starts) if (t >= s) at = s;
  return shape(t - at);
};

// natural blinks, 3 to 5 s apart, 100 to 160 ms each
const natural = (() => {
  const r = rng(99), list = [];
  for (let t = 2500; t < 40000; t += 3000 + 2000 * r()) list.push([t, 100 + 60 * r(), 0.45 + 0.15 * r()]);
  return list;
})();

// [name, signal(t in ms), length in ms, blinks expected, { onsets to time, limit, hole }]
const scenarios = [
  ['eyes open, 30 s', () => 0.18, 30000, 0],
  ['one blink of 100 ms', (t) => 0.18 + 0.55 * blinks(t, [2000], 100), 4000, 1, { onsets: [2000], limit: 30 }],
  ['one blink of 150 ms', (t) => 0.18 + 0.55 * blinks(t, [2000], 150), 4000, 1, { onsets: [2000], limit: 30 }],
  ['one blink of 250 ms', (t) => 0.18 + 0.55 * blinks(t, [2000], 250), 4000, 1, { onsets: [2000], limit: 30 }],
  ['eyes shut slowly (0.5 s) and kept shut for 3 s', (t) => 0.18 + 0.55 * pulse(t, 2000, 500, 3000, 400), 8000, 1],
  ['eight blinks, three a second', (t) => 0.18 + 0.5 * blinks(t, every(2000, 330, 8), 130), 6000, 8],
  ['looking down, resting level 0.45: five blinks', (t) => 0.45 + 0.35 * blinks(t, every(2000, 800, 5), 150), 7000, 5],
  ['small blinks (0.25 over a resting 0.12), six', (t) => 0.12 + 0.25 * blinks(t, every(2000, 800, 6), 150), 8000, 6],
  [`natural blinks 3 to 5 s apart, 40 s (${natural.length})`,
    (t) => 0.18 + Math.max(0, ...natural.map(([at, w, a]) => a * pulse(t, at, 50, w - 70, 90))), 40000, natural.length],
  ['a smile lifts the resting level by 0.15', (t) => 0.18 + 0.15 * pulse(t, 2000, 600, 3000, 600), 8000, 0],
  ['the gaze drops: +0.10 in 0.2 s, and back', (t) => 0.18 + 0.10 * pulse(t, 2000, 200, 1500, 200), 6000, 0],
  ['blinks while smiling and looking down', (t) =>
    0.18 + 0.15 * pulse(t, 1500, 600, 5000, 600) + 0.10 * pulse(t, 3000, 200, 1500, 200) + 0.45 * blinks(t, every(2500, 900, 5), 140), 9000, 5],
  // deliberate blinks are slow and hard, and the signal is not clean while the eyes are shut
  ['a squeezed blink of 300 ms that wobbles while shut', (t) =>
    path(t, [[2000, 0.18], [2070, 0.85], [2130, 0.72], [2190, 0.88], [2250, 0.74], [2300, 0.86], [2370, 0.80], [2500, 0.18]]), 5000, 1],
  ['a squeezed blink of 500 ms that flickers while shut', (t) =>
    path(t, [[2000, 0.18], [2080, 0.85], [2140, 0.55], [2200, 0.88], [2260, 0.52], [2320, 0.86], [2380, 0.56], [2440, 0.84], [2500, 0.80], [2640, 0.18]]), 5000, 1],
  ['a blink that shuts in two steps', (t) =>
    path(t, [[2000, 0.18], [2060, 0.55], [2120, 0.44], [2200, 0.90], [2400, 0.88], [2520, 0.18]]), 5000, 1],
  ['a blink that bounces while opening', (t) =>
    path(t, [[2000, 0.18], [2070, 0.86], [2300, 0.84], [2370, 0.42], [2430, 0.60], [2520, 0.18]]), 5000, 1],
  ['a hard blink, then a flutter of the lids', (t) =>
    path(t, [[2000, 0.18], [2070, 0.88], [2350, 0.86], [2460, 0.14], [2560, 0.16], [2610, 0.34], [2680, 0.16]]), 5000, 1],
  ['five squeezed blinks, 0.9 s apart, each flickering', (t) => each(t, every(2000, 900, 5), (u) =>
    path(u, [[0, 0.18], [80, 0.85], [140, 0.58], [200, 0.88], [260, 0.60], [330, 0.84], [450, 0.18]])), 8000, 5],
  ['face away for 1.5 s, back with eyes resting higher', (t) => (t < 3000 ? 0.15 : 0.42), 8000, 0, { hole: [3000, 4500] }],
  ['eyes kept shut for 4 s, flickering: nothing repeats', (t) =>
    0.18 + 0.62 * pulse(t, 2000, 80, 4000, 150) + 0.03 * pulse(t, 2000, 80, 4000, 150) * Math.sin(t / 25), 9000, 1],
];

let failed = 0;
for (const [name, signal, length, expected, opt = {}] of scenarios) {
  const bad = [];
  const delays = [];
  for (const hz of RATES) {
    for (let seed = 1; seed <= SEEDS; seed++) {
      const rand = rng(seed * 7919 + hz);
      const det = new BlinkDetector();
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
      const worst = Math.max(...d), limit = opt.limit + 2 * 1000 / hz;   // part of the closing itself, plus two samples
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
