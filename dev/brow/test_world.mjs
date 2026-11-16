// node dev/brow/test_world.mjs : is the level fair?
// The generator's promises are checked on many layers, and a bot with a
// person's limits (see bot.mjs) flies many runs at every screen shape: narrow
// screens see less far ahead, so they are the hard case.
import { P, createWorld, step, flap, gapCentre, speed } from '../../app/games/brow-world.js';
import { createBot } from './bot.mjs';

const ASPECTS = [0.45, 0.57, 0.8, 1.0, 1.57, 2.05, 2.4];   // tall phone .. phone on its side
const RUNS = 300, GOAL = 30, LIMIT = 80;

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let failed = 0;
const check = (ok, text) => {
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${text}`);
};

// ---- the generator ----
{
  const w = createWorld(rng(1));
  const seen = [];
  let worstUp = 0, worstDown = 0, bad = 0;
  const sizes = {};
  for (let n = 0; n < 200000 && seen.length < 20000; n++) {
    w.x += 0.01;                      // walk along; step() would need a player
    step(w); w.y = 0.5; w.vy = 0; w.dead = false;
    for (const l of w.layers) {
      if (l.i < 1 || seen[l.i]) continue;
      seen[l.i] = l;
      const prev = seen[l.i - 1];
      if (l.a < 1 || l.a + l.k > P.N - 1) bad++;
      if (l.i <= 40) sizes[l.i <= 4 ? 'first 4' : l.i <= 16 ? '5-16' : '17-40'] = { ...(sizes[l.i <= 4 ? 'first 4' : l.i <= 16 ? '5-16' : '17-40'] || {}), [l.k]: ((sizes[l.i <= 4 ? 'first 4' : l.i <= 16 ? '5-16' : '17-40'] || {})[l.k] || 0) + 1 };
      if (!prev) continue;
      const d = (gapCentre(l) - gapCentre(prev)) * P.N;
      worstUp = Math.max(worstUp, -d);
      worstDown = Math.max(worstDown, d);
    }
  }
  const count = seen.filter(Boolean).length;
  check(bad === 0, `${count} layers: a neuron above and below every gap`);
  check(worstUp <= P.MAX_UP && worstDown <= P.MAX_DOWN,
    `next gap at most ${worstUp} slots up and ${worstDown} down (limits ${P.MAX_UP}, ${P.MAX_DOWN})`);
}

// ---- the physics ----
{
  const hop = P.FLAP * P.FLAP / (2 * P.GRAVITY), period = 2 * P.FLAP / P.GRAVITY;
  console.log(`     one hop: ${hop.toFixed(3)} high, ${period.toFixed(2)} s; gaps of 3, 2, 1 neurons leave ` +
    [3, 2, 1].map((k) => ((k + 1) / P.N - 2 * P.HIT).toFixed(3)).join(', ') + ' of free height');
  const w = createWorld(rng(2));
  flap(w);
  let t = 0;
  while (!w.dead && t < 20) { step(w); t += P.STEP; }
  check(w.dead && w.score === 0 && t < 2.5, `no more raises after the first: on the floor after ${t.toFixed(2)} s`);
}

// ---- the bot ----
function run(seed, aspect, bot) {
  const w = createWorld(rng(seed));
  const due = [];                      // raises on their way
  flap(w);
  while (!w.dead && w.score < LIMIT) {
    if (bot.wants(w, aspect)) due.push(w.t + bot.react);
    if (due.length && w.t >= due[0]) { due.shift(); flap(w); }
    step(w);
  }
  return w;
}

for (const aspect of ASPECTS) {
  const scores = [], times = [];
  for (let seed = 1; seed <= RUNS; seed++) {
    const react = 0.12;
    const w = run(seed, aspect, { wants: createBot({ react }), react });
    scores.push(w.score);
    if (w.score >= GOAL) times.push(w.t);
  }
  scores.sort((a, b) => a - b);
  const reached = scores.filter((s) => s >= GOAL).length;
  check(reached >= RUNS * 0.95,
    `aspect ${aspect.toFixed(2)}: ${reached}/${RUNS} runs pass ${GOAL} layers ` +
    `(median ${scores[RUNS >> 1]}, worst ${scores[0]}, ${LIMIT}+ in ${scores.filter((s) => s >= LIMIT).length})`);
}
{
  const w = createWorld(rng(3));
  flap(w);
  let t30 = 0;
  // how long 30 layers take at the game's speeds
  let x = 0, s = 0, t = 0;
  const fake = { score: 0 };
  while (s < 30) { t += P.STEP; x += speed(fake) * P.STEP; const n = Math.max(0, Math.floor((x - P.RUN_IN - P.HIT) / P.SPACING) + 1); if (x > P.RUN_IN + P.HIT) fake.score = s = n; }
  t30 = t;
  console.log(`     30 layers take ${t30.toFixed(0)} s`);
}
console.log(failed ? `\n${failed} check(s) failed` : '\nall checks pass');
process.exit(failed ? 1 : 0);
