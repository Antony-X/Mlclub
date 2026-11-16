// node dev/test_rules.mjs            exit code 1 on any failure
// node dev/test_rules.mjs --report   also lists, per emoji, the photos that trigger it
//
// Checks app/rules.js against real faces: dev/emoji/fixtures.json holds what
// the model returned for freely licensed photos (numbers only; see
// dev/emoji/extract.mjs). Each fixture names the emojis that are right for
// that photo ("expect", best first; "-" = may be held back as turned away,
// "*" = an expression this model cannot see, anything goes). A fixture marked
// "miss" is a known limit, listed but not counted as a failure.
import { readFileSync } from 'node:fs';
import { EMOJIS, NEUTRAL, features, scoreAll, best, read, Stabilizer } from '../app/rules.js';

const fixtures = JSON.parse(readFileSync(new URL('./emoji/fixtures.json', import.meta.url), 'utf8'));
const report = process.argv.includes('--report');
let failed = 0;
const fail = (msg) => { failed++; console.log('FAIL', msg); };

// ---------- real photos ----------
const hits = new Map(EMOJIS.map((r) => [r.e, []]));     // emoji -> the photos it is right for and wins on
const misses = [];
let checked = 0;
for (const fx of fixtures) {
  const got = read(fx) || '-';
  const ok = fx.expect.includes('*') || fx.expect.includes(got);
  if (fx.expect.includes('*')) continue;
  checked++;
  if (ok && hits.has(got)) hits.get(got).push(fx.id);
  if (ok) continue;
  const f = features(fx);
  const top = [...scoreAll(f)].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([e, s]) => `${e}${s.toFixed(2)}`).join(' ');
  const line = `${fx.label} ${fx.id}: wanted ${fx.expect.join('')} got ${got}  (${top})`;
  if (fx.miss) misses.push(`${line}  [${fx.miss}]`);
  else fail(line);
}

// Every emoji must be the right answer on at least two real photos.
for (const r of EMOJIS) {
  const n = hits.get(r.e).length;
  if (n < 2) fail(`${r.e} is triggered by ${n} real photo(s)`);
}

// ---------- the rules as a set ----------
for (const r of EMOJIS) {
  if (r.e === NEUTRAL) continue;
  if (!r.hint || r.hint.trim().split(/\s+/).length > 4) fail(`${r.e} needs a hint of at most four words`);
  if (![1, 2, 3].includes(r.level)) fail(`${r.e} needs a level`);
}
if (new Set(EMOJIS.map((r) => r.e)).size !== EMOJIS.length) fail('an emoji is listed twice');
if (EMOJIS.filter((r) => r.level === 1).length < 6) fail('a round needs at least six easy emojis');

// A resting face with nothing measured stays neutral.
if (read({ raw: {}, roll: 0 }) !== NEUTRAL) fail('an empty face is not neutral');
// Turned far away or tiny: no answer.
if (read({ raw: {}, roll: 0, yaw: 45 }) !== null) fail('a face turned 45 degrees still gets an emoji');
if (read({ raw: {}, roll: 0, box: { y0: 0.4, y1: 0.45 }, h: 480 }) !== null) fail('a 24 px face still gets an emoji');

// ---------- steadiness: times, not frames ----------
// A blink (eyes shut for 150 ms) must not show a closed-eye emoji, at 15 or 60 detections a second.
const shut = { raw: { eyeBlinkLeft: 1, eyeBlinkRight: 1 }, roll: 0 }, rest = { raw: {}, roll: 0 };
const smile = { raw: { mouthSmileLeft: 0.9, mouthSmileRight: 0.9 }, roll: 0 };
for (const fps of [15, 30, 60]) {
  const run = (face, onMs, totalMs) => {
    const st = new Stabilizer();
    const seen = new Map();
    for (let t = 0; t <= totalMs; t += 1000 / fps) {
      const e = st.update(scoreAll(features(t >= 200 && t < 200 + onMs ? face : rest)), t);
      if (!seen.has(e)) seen.set(e, t);
    }
    return seen;
  };
  const blink = run(shut, 150, 1000);
  if (blink.size > 1) fail(`a 150 ms blink shows ${[...blink.keys()].join('')} at ${fps} per second`);
  const closed = run(shut, 800, 1200);
  if (!closed.has('😑')) fail(`eyes shut for 0.8 s never show 😑 at ${fps} per second`);
  const grin = run(smile, 800, 1200);
  const delay = grin.has('😊') ? grin.get('😊') - 200 : Infinity;
  if (delay > 300) fail(`a smile takes ${Math.round(delay)} ms to show at ${fps} per second`);
}

// ---------- report ----------
if (report) {
  console.log('\nPer emoji, the real photos it is right for and wins on:');
  for (const r of EMOJIS) console.log(`${r.e} ${String(hits.get(r.e).length).padStart(3)}  ${r.hint || '(resting face)'}\n      ${hits.get(r.e).join(', ')}`);
}
if (misses.length) {
  console.log(`\nKnown limits (${misses.length} photos the rules do not get; not failures):`);
  for (const m of misses) console.log('  ' + m);
}
const blind = fixtures.filter((f) => f.expect.includes('*'));
console.log(`\n${checked} real photos checked, ${misses.length} known limits, ${blind.length} recorded only (tongue, puffed cheeks: the model gives no signal).`);
console.log(failed ? `${failed} FAILED` : `all ok: ${EMOJIS.length} emojis`);
process.exit(failed ? 1 : 0);
