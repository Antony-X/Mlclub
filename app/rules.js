// Blendshape scores -> emoji. Pure functions: no DOM, runs in Node for tests.

const clamp = (x) => Math.max(0, Math.min(1, x));
const H = (x, a, b) => clamp((x - a) / (b - a)); // rises from 0 at a to 1 at b
const L = (x, a, b) => 1 - H(x, a, b);            // falls from 1 at a to 0 at b
const A = Math.min;
const avg = (a, b) => (a + b) / 2;

// Measurements taken straight from the 478 landmarks, for what the blendshapes
// report poorly: how far each eye is open, whether the lips are parted, how high
// each brow sits. Distances are in 3D (z has the scale of x), so a turned or
// tilted head changes them little. aspect = picture width / height.
const EYE_R = { w: [33, 133], lids: [[160, 144], [159, 145], [158, 153]], brow: 105 };
const EYE_L = { w: [263, 362], lids: [[387, 373], [386, 374], [385, 380]], brow: 334 };
const LIPS = [[82, 87], [13, 14], [312, 317]];

export function geometry(pts, aspect = 1) {
  const d = (i, j) => Math.hypot((pts[i].x - pts[j].x) * aspect, pts[i].y - pts[j].y, (pts[i].z - pts[j].z) * aspect);
  const mean = (pairs) => pairs.reduce((s, [i, j]) => s + d(i, j), 0) / pairs.length;
  const eyes = d(33, 263);                        // outer corner to outer corner
  const eye = (e) => mean(e.lids) / d(e.w[0], e.w[1]);
  const mid = (e) => ({
    x: (pts[e.w[0]].x + pts[e.w[1]].x) / 2, y: (pts[e.w[0]].y + pts[e.w[1]].y) / 2, z: (pts[e.w[0]].z + pts[e.w[1]].z) / 2,
  });
  const brow = (e) => {
    const m = mid(e), b = pts[e.brow];
    return Math.hypot((b.x - m.x) * aspect, b.y - m.y, (b.z - m.z) * aspect) / eyes;
  };
  const r4 = (x) => Math.round(x * 1e4) / 1e4;
  return {
    eyeL: r4(eye(EYE_L)), eyeR: r4(eye(EYE_R)),   // lid gap / eye width: about 0.3 open, under 0.12 shut
    lips: r4(mean(LIPS) / d(61, 291)),            // inner lip gap / mouth width: 0 = lips together
    browL: r4(brow(EYE_L)), browR: r4(brow(EYE_R)),
    mouth: r4(d(61, 291) / eyes),                 // mouth width against the eyes
  };
}

// Compact features from one detection result ({ bs, roll }).
export function features(res) {
  const bs = res.bs || res.raw || {};
  const g = (k) => bs[k] || 0;
  const blinkL = g('eyeBlinkLeft'), blinkR = g('eyeBlinkRight');
  const outerL = g('browOuterUpLeft'), outerR = g('browOuterUpRight');
  const smileL = g('mouthSmileLeft'), smileR = g('mouthSmileRight');
  const hiBlink = Math.max(blinkL, blinkR), loBlink = Math.min(blinkL, blinkR);
  return {
    smile: avg(smileL, smileR),
    smileAsym: Math.abs(smileL - smileR),
    jaw: g('jawOpen'),
    closed: loBlink,
    wink: A(H(hiBlink, 0.45, 0.65), L(loBlink, 0.2, 0.4)),
    browUp: avg(g('browInnerUp'), avg(outerL, outerR)),
    browInner: g('browInnerUp'),
    browAsym: Math.abs(outerL - outerR),
    browDown: avg(g('browDownLeft'), g('browDownRight')),
    pucker: g('mouthPucker'),
    frown: avg(g('mouthFrownLeft'), g('mouthFrownRight')),
    squint: avg(g('eyeSquintLeft'), g('eyeSquintRight')),
    lookUp: avg(g('eyeLookUpLeft'), g('eyeLookUpRight')),
    lookSide: Math.max(
      avg(g('eyeLookOutLeft'), g('eyeLookInRight')),
      avg(g('eyeLookInLeft'), g('eyeLookOutRight'))),
    lipRoll: avg(g('mouthRollLower'), g('mouthRollUpper')),
    stretch: avg(g('mouthStretchLeft'), g('mouthStretchRight')),
    mouthSide: Math.max(g('mouthLeft'), g('mouthRight')),
    sneer: avg(g('noseSneerLeft'), g('noseSneerRight')),
    teeth: avg(
      avg(g('mouthUpperUpLeft'), g('mouthUpperUpRight')),
      avg(g('mouthLowerDownLeft'), g('mouthLowerDownRight'))),
    tilt: Math.abs(res.roll || 0),
  };
}

const upright = (f) => L(f.tilt, 12, 22);
const tilted = (f) => H(f.tilt, 12, 22);
const eyesOpen = (f) => A(L(f.closed, 0.4, 0.6), 1 - f.wink);

// e: the emoji. hint: how to make it. level: 1 easy .. 3 hard (game order).
// s: 0..1. Combined faces get a small bonus (w) so they beat the simpler face
// they contain.
export const EMOJIS = [
  { e: '😐', s: () => 0.3 },
  { e: '🙂', level: 2, hint: 'ოდნავ გაიღიმე', s: (f) => A(H(f.smile, 0.25, 0.45), L(f.smile, 0.6, 0.8), L(f.jaw, 0.15, 0.3), upright(f), eyesOpen(f), L(f.smileAsym, 0.25, 0.4)) },
  { e: '😊', level: 1, hint: 'ფართოდ გაიღიმე', s: (f) => A(H(f.smile, 0.6, 0.8), L(f.jaw, 0.12, 0.25), L(f.teeth, 0.25, 0.45), upright(f), eyesOpen(f), L(f.browUp, 0.4, 0.6)) },
  { e: '😁', level: 2, hint: 'გაიღიმე, კბილები გამოაჩინე', s: (f) => A(H(f.smile, 0.55, 0.75), H(f.teeth, 0.3, 0.5), L(f.jaw, 0.15, 0.3), upright(f), eyesOpen(f)) },
  { e: '😃', level: 1, hint: 'გაიცინე', s: (f) => A(H(f.smile, 0.45, 0.65), H(f.jaw, 0.2, 0.4), L(f.closed, 0.5, 0.7), upright(f)) },
  { e: '😆', w: 1.1, level: 2, hint: 'გაიცინე, თვალები დახუჭე', s: (f) => A(H(f.smile, 0.45, 0.65), H(f.jaw, 0.2, 0.4), H(f.closed, 0.5, 0.7)) },
  { e: '🤩', w: 1.1, level: 2, hint: 'გაიღიმე, წარბები აწიე', s: (f) => A(H(f.browUp, 0.4, 0.6), H(f.smile, 0.5, 0.7), upright(f)) },
  { e: '🥰', w: 1.1, level: 1, hint: 'გაიღიმე, თავი გადახარე', s: (f) => A(tilted(f), H(f.smile, 0.45, 0.65), L(f.jaw, 0.15, 0.3)) },
  { e: '🤪', w: 1.15, level: 2, hint: 'გაიცინე, თავი გადახარე', s: (f) => A(tilted(f), H(f.smile, 0.4, 0.6), H(f.jaw, 0.2, 0.4)) },
  { e: '😏', level: 3, hint: 'ცალყბად გაიღიმე', s: (f) => A(H(f.smileAsym, 0.25, 0.4), L(f.jaw, 0.15, 0.3), 1 - f.wink) },
  { e: '😉', w: 1.1, level: 1, hint: 'ჩაკარი თვალი', s: (f) => A(f.wink, L(f.pucker, 0.35, 0.55)) },
  { e: '😘', w: 1.15, level: 2, hint: 'ჩაკარი თვალი და აკოცე', s: (f) => A(f.wink, H(f.pucker, 0.4, 0.6)) },
  { e: '😗', level: 1, hint: 'ტუჩები წინ გამოწიე', s: (f) => A(H(f.pucker, 0.5, 0.7), eyesOpen(f), L(f.jaw, 0.25, 0.4)) },
  { e: '😚', w: 1.1, level: 2, hint: 'ტუჩები გამოწიე, თვალები დახუჭე', s: (f) => A(H(f.pucker, 0.45, 0.65), H(f.closed, 0.55, 0.75)) },
  { e: '😌', w: 1.05, level: 2, hint: 'თვალები დახუჭე და გაიღიმე', s: (f) => A(H(f.closed, 0.55, 0.75), H(f.smile, 0.3, 0.5), L(f.jaw, 0.15, 0.3)) },
  { e: '😑', level: 1, hint: 'დახუჭე თვალები', s: (f) => A(H(f.closed, 0.55, 0.75), L(f.smile, 0.2, 0.35), L(f.jaw, 0.15, 0.3), L(f.pucker, 0.35, 0.55)) },
  { e: '🥱', w: 1.1, level: 2, hint: 'დაამთქნარე', s: (f) => A(H(f.closed, 0.5, 0.7), H(f.jaw, 0.45, 0.65), L(f.smile, 0.3, 0.5)) },
  { e: '😮', level: 1, hint: 'გააღე პირი', s: (f) => A(H(f.jaw, 0.3, 0.5), L(f.smile, 0.25, 0.4), L(f.browUp, 0.35, 0.55), L(f.browDown, 0.3, 0.5), L(f.closed, 0.45, 0.65)) },
  { e: '😱', w: 1.1, level: 2, hint: 'პირი გააღე, წარბები აწიე', s: (f) => A(H(f.jaw, 0.4, 0.6), H(f.browUp, 0.4, 0.6), L(f.smile, 0.3, 0.5)) },
  { e: '😳', level: 1, hint: 'აწიე წარბები', s: (f) => A(H(f.browUp, 0.45, 0.65), L(f.jaw, 0.12, 0.25), L(f.smile, 0.25, 0.4), L(f.browAsym, 0.2, 0.4), L(f.frown, 0.25, 0.45)) },
  { e: '🤨', w: 1.05, level: 2, hint: 'ცალი წარბი აწიე', s: (f) => A(H(f.browAsym, 0.25, 0.45), L(f.smile, 0.4, 0.6), 1 - f.wink) },
  { e: '😢', w: 1.1, level: 3, hint: 'მოიწყინე, წარბები აწიე', s: (f) => A(H(f.frown, 0.3, 0.5), H(f.browInner, 0.35, 0.55)) },
  { e: '🙁', level: 3, hint: 'მოიწყინე', s: (f) => A(H(f.frown, 0.3, 0.5), L(f.browInner, 0.3, 0.5), L(f.browDown, 0.35, 0.55)) },
  { e: '😠', level: 2, hint: 'შეკარი წარბები', s: (f) => A(H(f.browDown, 0.4, 0.6), L(f.jaw, 0.15, 0.3), L(f.smile, 0.25, 0.4), L(f.sneer, 0.35, 0.55)) },
  { e: '🤬', w: 1.1, level: 3, hint: 'წარბები შეკარი და იყვირე', s: (f) => A(H(f.browDown, 0.35, 0.55), H(f.jaw, 0.3, 0.5), L(f.smile, 0.3, 0.5)) },
  { e: '😖', w: 1.1, level: 3, hint: 'დამანჭე სახე', s: (f) => A(H(f.sneer, 0.4, 0.6), H(f.squint, 0.35, 0.55), L(f.smile, 0.3, 0.5)) },
  { e: '🙄', level: 2, hint: 'თვალებით ზევით აიხედე', s: (f) => A(H(f.lookUp, 0.45, 0.65), L(f.smile, 0.4, 0.6), L(f.closed, 0.45, 0.65), L(f.browUp, 0.45, 0.65)) },
  { e: '👀', level: 2, hint: 'თვალებით გვერდზე გაიხედე', s: (f) => A(H(f.lookSide, 0.55, 0.75), L(f.smile, 0.3, 0.5), L(f.jaw, 0.2, 0.35), eyesOpen(f)) },
  { e: '😬', level: 3, hint: 'დაკრიჭე კბილები', s: (f) => A(H(f.stretch, 0.35, 0.55), H(f.teeth, 0.25, 0.45), L(f.smile, 0.4, 0.6)) },
  { e: '🤐', level: 3, hint: 'მოკუმე ტუჩები', s: (f) => A(H(f.lipRoll, 0.4, 0.6), L(f.jaw, 0.15, 0.3), L(f.smile, 0.3, 0.5)) },
  { e: '🥴', level: 3, hint: 'ტუჩები გვერდზე გასწიე', s: (f) => A(H(f.mouthSide, 0.4, 0.6), L(f.jaw, 0.3, 0.5), L(f.smileAsym, 0.3, 0.5)) },
  { e: '🤔', level: 1, hint: 'თავი გადახარე', s: (f) => A(tilted(f), L(f.smile, 0.3, 0.5), L(f.jaw, 0.2, 0.35), eyesOpen(f)) },
];

export const NEUTRAL = EMOJIS[0].e;

// Scores for every emoji, as a Map emoji -> score.
export function scoreAll(f) {
  const m = new Map();
  for (const r of EMOJIS) m.set(r.e, r.s(f) * (r.w || 1));
  return m;
}

export function best(scores) {
  let e = NEUTRAL, s = -1;
  for (const [k, v] of scores) if (v > s) { s = v; e = k; }
  return { e, s };
}

// Keeps the shown emoji steady: a new one must lead for `hold` ms. `favour`
// (the emoji being asked for) wins ties, so a near miss does not flicker.
export class Stabilizer {
  constructor(hold = 160, margin = 0.1) {
    this.hold = hold;
    this.margin = margin;
    this.reset();
  }
  reset() { this.current = NEUTRAL; this.cand = null; this.since = 0; }
  update(scores, now, favour) {
    let top = best(scores);
    const fav = favour ? scores.get(favour) || 0 : 0;
    if (fav > 0.5 && fav >= top.s - this.margin) top = { e: favour, s: Math.max(fav, top.s) };
    const cur = scores.get(this.current) || 0;
    if (top.e === this.current || (top.e !== favour && top.s < cur + this.margin)) {
      this.cand = null;
      return this.current;
    }
    if (this.cand !== top.e) { this.cand = top.e; this.since = now; }
    if (now - this.since >= this.hold) { this.current = top.e; this.cand = null; }
    return this.current;
  }
}
