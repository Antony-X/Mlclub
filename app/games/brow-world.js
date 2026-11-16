// The game world, with no drawing and no browser: physics, the layers of
// neurons, collisions. Everything is in units of the screen height (y: 0 top,
// 1 floor), so the game is the same on a phone and on a laptop; only how far
// ahead you can see changes with the screen's width.

export const P = {
  N: 7,                 // neuron slots in a layer, evenly spaced
  NODE_R: 0.030,        // drawn radius of a neuron, and of the player
  HIT: 0.052,           // centres closer than this collide (drawn circles touch at 0.060)
  FLOOR: 0.024,         // the player dies this close to the floor
  GRAVITY: 1.25,        // per s²
  FLAP: 0.50,           // upward speed after a raise: one hop is 0.10 high and 0.8 s long
  MAX_FALL: 0.85,
  SPACING: 0.62,        // between layers
  RUN_IN: 1.0,          // before the first one
  SPEED: [0.27, 0.36],  // per s, first layer .. layer RAMP
  RAMP: 40,
  TWO: [4, 12],         // gaps of two neurons come in between these layers,
  ONE: [16, 40, 0.5],   // gaps of one between these, up to this share
  REACH: 1.5,           // how far the next gap may be from the last one, up or down, in slots
  STEP: 1 / 120,        // s, fixed physics step
  AHEAD: 4.5,           // layers exist this far ahead of the player
  BEHIND: 2.5,
};

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const slotY = (i) => (i + 0.5) / P.N;
// Where the player sits on a screen `aspect` heights wide: further in on a wide one.
export const playerX = (aspect) => clamp(0.22 * aspect, 0.10, 0.40);
export const gapCentre = (layer) => (layer.a + layer.k / 2) / P.N;

function makeLayer(i, x, a, k) {
  const ys = [];
  for (let s = 0; s < P.N; s++) if (s < a || s >= a + k) ys.push(slotY(s));
  return { i, x, a, k, ys, passed: i <= 0, yPass: null };
}

// How many neurons are missing in layer i: three at first, then two, later
// sometimes only one.
function gapSize(i, rand) {
  const two = clamp((i - P.TWO[0]) / (P.TWO[1] - P.TWO[0]), 0, 1);
  const one = P.ONE[2] * clamp((i - P.ONE[0]) / (P.ONE[1] - P.ONE[0]), 0, 1);
  const r = rand();
  if (r < one) return 1;
  return r < one + (1 - one) * two ? 2 : 3;
}

function nextLayer(w) {
  const prev = w.layers[w.layers.length - 1];
  const i = prev.i + 1;
  const k = gapSize(i, w.rand);
  const from = gapCentre(prev) * P.N;
  // A neuron stays above and below every gap, and the gap is within reach of the last one.
  const options = [];
  for (let a = 1; a <= P.N - k - 1; a++) {
    if (Math.abs(a + k / 2 - from) <= P.REACH) options.push(a);
  }
  const a = options.length
    ? options[Math.floor(w.rand() * options.length)]
    : clamp(Math.round(from - k / 2), 1, P.N - k - 1);
  return makeLayer(i, prev.x + (i === 1 ? P.RUN_IN : P.SPACING), a, k);
}

// A fresh run. The player waits as the one missing neuron of layer 0, in the
// middle of a network that continues behind it.
export function createWorld(rand = Math.random) {
  const mid = (P.N - 1) / 2;
  const w = { rand, t: 0, x: 0, y: slotY(mid), vy: 0, score: 0, dead: false, hit: null, layers: [] };
  for (let i = -4; i < 0; i++) w.layers.push(makeLayer(i, i * P.SPACING, 0, 0));
  w.layers.push(makeLayer(0, 0, mid, 1));
  extend(w);
  return w;
}

function extend(w) {
  while (w.layers[w.layers.length - 1].x < w.x + P.AHEAD) w.layers.push(nextLayer(w));
  while (w.layers[1].x < w.x - P.BEHIND) w.layers.shift();
}

export const speed = (w) => P.SPEED[0] + (P.SPEED[1] - P.SPEED[0]) * clamp(w.score / P.RAMP, 0, 1);

export function flap(w) {
  w.vy = -P.FLAP;
}

// One physics step. Returns the layer that was just passed, or null.
export function step(w) {
  if (w.dead) return null;
  const dt = P.STEP;
  w.t += dt;
  w.vy = Math.min(w.vy + P.GRAVITY * dt, P.MAX_FALL);
  w.y += w.vy * dt;
  w.x += speed(w) * dt;
  if (w.y < P.NODE_R) {             // the ceiling only stops you
    w.y = P.NODE_R;
    if (w.vy < 0) w.vy = 0;
  }
  if (w.y > 1 - P.FLOOR) {
    w.dead = true;
    return null;
  }
  let passed = null;
  for (const l of w.layers) {
    if (l.i <= 0) continue;
    const dx = w.x - l.x;
    if (dx < -P.HIT) break;
    if (dx <= P.HIT) {
      for (const y of l.ys) {
        const dy = w.y - y;
        if (dx * dx + dy * dy < P.HIT * P.HIT) {
          w.dead = true;
          w.hit = { layer: l, y };
          return null;
        }
      }
      if (dx >= 0 && l.yPass === null) l.yPass = w.y;
    } else if (!l.passed) {         // fully clear of the layer: it counts
      l.passed = true;
      if (l.yPass === null) l.yPass = w.y;
      w.score++;
      passed = l;
    }
  }
  extend(w);
  return passed;
}
