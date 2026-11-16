// node dev/brow/test_detector.mjs : the eyebrow detector against synthetic faces.
// Each scenario is a clean signal over time; it is sampled at 15, 30 and 60
// results a second with uneven timing and +-0.03 of noise, many times over,
// and must give exactly the expected number of raises every time.
import { RaiseDetector } from '../../app/games/brow-detector.js';

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
// One raise: up in `up` ms, held for `hold`, down in `down`. Value 0..1.
const pulse = (t, at, up, hold, down) =>
  t < at + up + hold ? ease((t - at) / up) : 1 - ease((t - at - up - hold) / down);

// name, signal(t in ms), length in ms, raises expected, onsets to time (optional), options
const scenarios = [
  ['resting face, 30 s', () => 0.12, 30000, 0],
  ['one quick raise', (t) => 0.1 + 0.5 * pulse(t, 2000, 120, 300, 180), 5000, 1, [2000]],
  ['one slow raise (0.8 s up)', (t) => 0.1 + 0.5 * pulse(t, 2000, 800, 400, 600), 6000, 1],
  ['raise held for 6 s', (t) => 0.1 + 0.5 * pulse(t, 2000, 150, 6000, 200), 10000, 1, [2000]],
  ['two fast raises, half relaxed between', (t) =>
    0.1 + 0.5 * Math.max(pulse(t, 2000, 120, 150, 150) , 0.5 * (t > 2300 && t < 2700 ? 1 : 0), pulse(t, 2500, 120, 200, 200)), 5000, 2],
  ['ten raises 0.7 s apart, never fully relaxed', (t) => {
    let v = 0.35 * ease((t - 1900) / 100) * (t < 9000 ? 1 : 1 - ease((t - 9000) / 300));
    for (let i = 0; i < 10; i++) v = Math.max(v, pulse(t, 2000 + i * 700, 130, 170, 200));
    return 0.1 + 0.5 * v;
  }, 11000, 10],
  ['resting level drifts up 0.2 in 10 s', (t) => 0.1 + 0.2 * Math.min(1, t / 10000), 14000, 0],
  ['raises on a drifting resting level', (t) => {
    let v = 0;
    for (let i = 0; i < 6; i++) v = Math.max(v, pulse(t, 2000 + i * 1500, 130, 250, 200));
    return 0.1 + 0.2 * Math.min(1, t / 10000) + 0.45 * v;
  }, 12000, 6],
  ['small range: 0.05 at rest, 0.22 raised', (t) => {
    let v = 0;
    for (let i = 0; i < 5; i++) v = Math.max(v, pulse(t, 2000 + i * 1000, 130, 250, 200));
    return 0.05 + 0.17 * v;
  }, 8000, 5],
  ['high resting value: 0.35 at rest, 0.9 raised', (t) => {
    let v = 0;
    for (let i = 0; i < 5; i++) v = Math.max(v, pulse(t, 2000 + i * 900, 130, 250, 200));
    return 0.35 + 0.55 * v;
  }, 8000, 5],
  ['a big first raise, then small ones', (t) => {
    let v = 0.7 * pulse(t, 2000, 150, 400, 250);
    for (let i = 0; i < 5; i++) v = Math.max(v, 0.22 * pulse(t, 4000 + i * 900, 130, 250, 200));
    return 0.1 + v;
  }, 10000, 6],
  ['face away for 1.5 s, back with another resting value', (t) => (t < 3000 ? 0.1 : 0.32), 8000, 0,
    null, { hole: [3000, 4500] }],
];

let failed = 0;
for (const [name, signal, length, expected, onsets, opt = {}] of scenarios) {
  const bad = [];
  const delays = [];
  for (const hz of RATES) {
    for (let seed = 1; seed <= SEEDS; seed++) {
      const rand = rng(seed * 7919 + hz);
      const det = new RaiseDetector();
      const fires = [];
      let t = 0, calib = [];
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
      if (onsets && fires.length === expected) onsets.forEach((at, i) => delays.push([hz, fires[i] - at]));
    }
  }
  let note = '';
  if (onsets) {
    for (const hz of RATES) {
      const d = delays.filter((x) => x[0] === hz).map((x) => x[1]);
      const worst = Math.max(...d), limit = 90 + 2 * 1000 / hz;   // most of the raise's own 120-150 ms, plus two samples
      note += `  ${hz} Hz: ${Math.round(d.reduce((a, b) => a + b, 0) / d.length)} ms (worst ${Math.round(worst)})`;
      if (worst > limit) bad.push(`${hz} Hz: fired ${Math.round(worst)} ms after the raise began (limit ${Math.round(limit)})`);
    }
  }
  const ok = bad.length === 0;
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}: ${expected} expected${note ? '\n     delay' + note : ''}`);
  if (!ok) console.log('     ' + bad.slice(0, 6).join('; ') + (bad.length > 6 ? ` ... (${bad.length} runs)` : ''));
}
console.log(failed ? `\n${failed} scenario(s) failed` : `\nall ${scenarios.length} scenarios pass at ${RATES.join(', ')} Hz x ${SEEDS} seeds`);
process.exit(failed ? 1 : 0);
