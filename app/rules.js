// A face -> an emoji. Pure functions: no DOM, runs in Node for tests.
//
// Every threshold here was read off real photos run through the same model
// (dev/emoji/fixtures.json, checked by dev/test_rules.mjs). What that showed:
// - tongueOut, cheekPuff, noseSneer and mouthFrown stay at zero: unusable.
// - eyeBlink is 0.2 to 0.8 on shut eyes and up to 0.5 on open eyes in a big
//   smile, so the eyes are measured from the landmarks instead (geometry()).
// - mouthPucker rests as high as 0.86 and browDown as high as 0.8 on plain
//   serious faces; both only count together with a second sign.
// - mouthSmile rises to 0.5 and more on yawns and shouts.
// - eyes rolled up read only 0.15 to 0.30 (eyeLookUp), below many resting faces:
//   no eye-roll emoji.

const clamp = (x) => Math.max(0, Math.min(1, x));
const H = (x, a, b) => clamp((x - a) / (b - a)); // rises from 0 at a to 1 at b
const L = (x, a, b) => 1 - H(x, a, b);            // falls from 1 at a to 0 at b
const A = Math.min, O = Math.max;
const avg = (a, b) => (a + b) / 2;
const DEG = 180 / Math.PI;

// Measurements taken straight from the 478 landmarks. Distances are in 3D (z
// has the scale of x), so a turned or tilted head changes them little.
// aspect = picture width / height.
const EYE_R = { w: [33, 133], lids: [[160, 144], [159, 145], [158, 153]] };
const EYE_L = { w: [263, 362], lids: [[387, 373], [386, 374], [385, 380]] };
const LIPS = [[82, 87], [13, 14], [312, 317]];

export function geometry(pts, aspect = 1) {
  const d = (i, j) => Math.hypot((pts[i].x - pts[j].x) * aspect, pts[i].y - pts[j].y, (pts[i].z - pts[j].z) * aspect);
  const mean = (pairs) => pairs.reduce((s, [i, j]) => s + d(i, j), 0) / pairs.length;
  const eye = (e) => mean(e.lids) / d(e.w[0], e.w[1]);
  const r4 = (x) => Math.round(x * 1e4) / 1e4;
  return {
    eyeL: r4(eye(EYE_L)), eyeR: r4(eye(EYE_R)),   // lid gap / eye width: about 0.3 open, under 0.14 shut
    lips: r4(mean(LIPS) / d(61, 291)),            // inner lip gap / mouth width: 0 = lips together
    mouth: r4(d(61, 291) / d(33, 263)),           // mouth width / eye span: about 0.55, less when puckered
  };
}

// One detection result -> the few numbers the rules read.
// res: { raw, roll, matrix } plus landmarks (live) or geo (fixtures);
// aspect and h (picture height in pixels) let it measure the landmarks and the
// size of the face.
export function features(res) {
  const raw = res.raw || {};
  const g = (k) => raw[k] || 0;
  const both = (k) => avg(g(k + 'Left'), g(k + 'Right'));
  const blinkL = g('eyeBlinkLeft'), blinkR = g('eyeBlinkRight');
  // Without landmarks (hand-made test input) the eyes follow the blink score.
  const geo = res.geo || (res.landmarks ? geometry(res.landmarks, res.aspect || 1)
    : { eyeL: 0.3 * (1 - blinkL), eyeR: 0.3 * (1 - blinkR), lips: 0.6 * g('jawOpen') + 0.25 * both('mouthUpperUp'), mouth: 0.55 - 0.15 * g('mouthPucker') });

  // Head pose from the 4x4 matrix (column-major): where the face points.
  const m = res.matrix;
  const yaw = m ? Math.atan2(m[8], m[10]) * DEG : res.yaw || 0;          // + = toward the picture's right edge
  const pitch = m ? -Math.atan2(m[9], m[10]) * DEG : res.pitch || 0;     // + = nodding down
  const facePx = res.box && res.h ? (res.box.y1 - res.box.y0) * res.h : 999;

  const eyeLo = Math.min(geo.eyeL, geo.eyeR), eyeHi = Math.max(geo.eyeL, geo.eyeR);
  // A wink: one lid lower than the other, by the landmarks and by the model, on the same side.
  const dGeo = geo.eyeR - geo.eyeL, dBlink = blinkL - blinkR;
  const uneven = dGeo * dBlink > 0
    ? Math.abs(dGeo) / 0.10 + Math.abs(dBlink) / 0.30
    : Math.max(Math.abs(dGeo) / 0.10, Math.abs(dBlink) / 0.30) / 2;
  const outerL = g('browOuterUpLeft'), outerR = g('browOuterUpRight');
  const smile = both('mouthSmile');

  return {
    smile,
    jaw: g('jawOpen'),
    teeth: both('mouthUpperUp'),                 // upper lip lifted off the teeth
    bare: A(both('mouthUpperUp'), both('mouthLowerDown')),   // both lips pulled back
    lips: geo.lips,
    shut: L(eyeHi, 0.15, 0.19),                  // both eyes closed
    narrow: L(eyeLo, 0.2, 0.25),
    wink: A(H(uneven, 1.4, 1.8), H(eyeHi, 0.17, 0.21), L(Math.abs(yaw), 25, 32)),
    brows: avg(g('browInnerUp'), avg(outerL, outerR)),
    browAsym: Math.abs(outerL - outerR),
    browDown: both('browDown'),
    pucker: g('mouthPucker'),
    kiss: g('mouthPucker') + 2 * (0.52 - geo.mouth),   // puckered and narrower than a resting mouth
    pout: g('mouthShrugLower'),                  // lower lip pushed up, corners down
    side: O(g('mouthLeft'), g('mouthRight')),
    lookSide: O(avg(g('eyeLookOutLeft'), g('eyeLookInRight')), avg(g('eyeLookInLeft'), g('eyeLookOutRight'))),
    tilt: Math.abs(res.roll || 0),
    yaw, pitch,
    // Turned far away or very small: the model's numbers stop meaning much.
    away: Math.abs(yaw) > 30 || Math.abs(pitch) > 30 || facePx < 45,
  };
}

const upright = (f) => L(f.tilt, 12, 20);
const tilted = (f) => H(f.tilt, 14, 22);
const frontal = (f) => L(Math.abs(f.yaw), 12, 20);
const awake = (f) => A(1 - f.shut, 1 - f.wink);            // not shut, not winking
const parted = (f) => O(H(f.teeth, 0.3, 0.5), H(f.lips, 0.06, 0.11));   // teeth showing
const gape = (f) => O(parted(f), H(f.jaw, 0.25, 0.4));                  // mouth open or teeth showing
const mouthShut = (f) => 1 - gape(f);
const laughing = (f) => A(H(f.smile, 0.4, 0.55), gape(f));
const sideways = (f) => H(f.lookSide, 0.68, 0.85);
const kissing = (f) => H(f.kiss, 0.85, 1);
const calm = (f) => L(f.smile, 0.2, 0.35);

// e: the emoji. hint: how to make it (the only instruction in the game).
// level: 1 easy .. 3 hard, the order of a round. slow: needs a longer look
// before it shows, so a blink is not read as closed eyes.
// s: 0..1. A face that contains a simpler one gets a small bonus (w) to win.
export const EMOJIS = [
  { e: '😐', s: () => 0.3 },

  // smiles
  { e: '🙂', level: 1, hint: 'ოდნავ გაიღიმე', s: (f) => A(H(f.smile, 0.2, 0.35), L(f.smile, 0.62, 0.75), mouthShut(f), upright(f), awake(f), L(f.brows, 0.35, 0.5)) },
  { e: '😊', level: 1, hint: 'ფართოდ გაიღიმე', s: (f) => A(H(f.smile, 0.62, 0.75), mouthShut(f), upright(f), awake(f), L(f.brows, 0.35, 0.5)) },
  { e: '😁', level: 1, hint: 'გაიღიმე, კბილები გამოაჩინე', s: (f) => A(H(f.smile, 0.3, 0.45), parted(f), L(f.jaw, 0.25, 0.4), upright(f), awake(f), L(f.brows, 0.35, 0.5)) },
  { e: '😃', level: 1, hint: 'გაიცინე', s: (f) => A(H(f.smile, 0.4, 0.6), H(f.jaw, 0.25, 0.4), upright(f), awake(f), L(f.brows, 0.35, 0.5)) },
  { e: '😆', w: 1.1, slow: true, level: 2, hint: 'გაიცინე, თვალები დახუჭე', s: (f) => A(laughing(f), f.shut, upright(f)) },
  { e: '🤣', w: 1.2, slow: true, level: 3, hint: 'თვალდახუჭული გაიცინე, თავი გადახარე', s: (f) => A(tilted(f), laughing(f), f.shut) },
  { e: '🤩', w: 1.1, level: 2, hint: 'გაიღიმე, წარბები აწიე', s: (f) => A(H(f.brows, 0.35, 0.5), H(f.smile, 0.4, 0.55), upright(f), awake(f)) },
  { e: '🥰', w: 1.1, level: 2, hint: 'გაიღიმე, თავი გადახარე', s: (f) => A(tilted(f), H(f.smile, 0.25, 0.4), L(f.jaw, 0.25, 0.4), awake(f)) },
  { e: '🤪', w: 1.15, level: 2, hint: 'გაიცინე, თავი გადახარე', s: (f) => A(tilted(f), H(f.smile, 0.25, 0.4), H(f.jaw, 0.25, 0.4), awake(f)) },
  { e: '😏', w: 1.05, level: 3, hint: 'გაიღიმე, გვერდზე გაიხედე', s: (f) => A(sideways(f), frontal(f), H(f.smile, 0.3, 0.45), mouthShut(f), awake(f)) },

  // eyes
  { e: '😉', w: 1.15, level: 1, hint: 'ჩაკარი თვალი', s: (f) => A(f.wink, 1 - kissing(f)) },
  { e: '😘', w: 1.2, level: 2, hint: 'ჩაკარი თვალი და აკოცე', s: (f) => A(f.wink, kissing(f)) },
  { e: '😌', w: 1.05, slow: true, level: 2, hint: 'თვალები დახუჭე, გაიღიმე', s: (f) => A(f.shut, H(f.smile, 0.15, 0.3), 1 - laughing(f), upright(f)) },
  { e: '😑', slow: true, level: 1, hint: 'დახუჭე თვალები', s: (f) => A(f.shut, L(f.smile, 0.15, 0.3), L(f.jaw, 0.25, 0.4), L(f.teeth, 0.3, 0.5), L(f.kiss, 0.7, 0.85), upright(f), L(f.browDown, 0.35, 0.55)) },
  { e: '😖', w: 1.05, slow: true, level: 3, hint: 'მაგრად დახუჭე თვალები', s: (f) => A(f.shut, H(f.browDown, 0.35, 0.55), L(f.smile, 0.15, 0.3), L(f.jaw, 0.25, 0.4)) },
  { e: '😴', w: 1.1, slow: true, level: 2, hint: 'თვალები დახუჭე, თავი გადახარე', s: (f) => A(tilted(f), f.shut, 1 - laughing(f), L(f.jaw, 0.25, 0.4)) },
  { e: '🥱', w: 1.1, slow: true, level: 2, hint: 'დაამთქნარე', s: (f) => A(f.shut, H(f.jaw, 0.25, 0.4), L(f.smile, 0.6, 0.75), L(f.teeth, 0.3, 0.5), L(f.browDown, 0.35, 0.55)) },
  { e: '👀', level: 2, hint: 'თვალებით გვერდზე გაიხედე', s: (f) => A(sideways(f), frontal(f), calm(f), L(f.jaw, 0.25, 0.4), awake(f)) },

  // mouth
  { e: '😗', w: 1.05, level: 1, hint: 'ტუჩები წინ გამოწიე', s: (f) => A(kissing(f), L(f.lips, 0.12, 0.2), L(f.jaw, 0.25, 0.4), awake(f), L(f.pout, 0.5, 0.7)) },
  { e: '😚', w: 1.15, slow: true, level: 2, hint: 'ტუჩები გამოწიე, თვალები დახუჭე', s: (f) => A(H(f.kiss, 0.7, 0.85), f.shut, L(f.jaw, 0.25, 0.4)) },
  { e: '😯', w: 1.05, level: 2, hint: 'თქვი „უუუ“', s: (f) => A(H(f.pucker, 0.6, 0.8), H(f.lips, 0.12, 0.2), L(f.jaw, 0.3, 0.45), awake(f)) },
  { e: '😮', level: 1, hint: 'გააღე პირი', s: (f) => A(H(f.jaw, 0.25, 0.4), L(f.smile, 0.4, 0.6), L(f.brows, 0.35, 0.55), 1 - f.shut, L(f.browDown, 0.35, 0.55)) },
  { e: '😱', w: 1.1, level: 1, hint: 'პირი გააღე, წარბები აწიე', s: (f) => A(H(f.jaw, 0.25, 0.4), H(f.brows, 0.35, 0.55), L(f.smile, 0.4, 0.6)) },
  { e: '😬', level: 3, hint: 'დაკრიჭე კბილები', s: (f) => A(H(f.bare, 0.3, 0.5), H(f.lips, 0.12, 0.2), L(f.smile, 0.4, 0.55), L(f.jaw, 0.25, 0.4), awake(f)) },
  { e: '🫤', level: 3, hint: 'ტუჩები გვერდზე გასწიე', s: (f) => A(H(f.side, 0.3, 0.5), L(f.smile, 0.3, 0.5), L(f.jaw, 0.25, 0.4), awake(f)) },
  { e: '🙁', level: 2, hint: 'ტუჩის კუთხეები ჩამოწიე', s: (f) => A(H(f.pout, 0.33, 0.5), calm(f), L(f.jaw, 0.25, 0.4), awake(f), L(f.side, 0.3, 0.5)) },

  // brows
  { e: '😳', level: 1, hint: 'აწიე წარბები', s: (f) => A(H(f.brows, 0.4, 0.55), L(f.jaw, 0.25, 0.4), L(f.smile, 0.25, 0.4), L(f.browAsym, 0.3, 0.45), awake(f), 1 - kissing(f)) },
  { e: '🤨', w: 1.1, level: 3, hint: 'ცალი წარბი აწიე', s: (f) => A(H(f.browAsym, 0.3, 0.45), frontal(f), L(f.smile, 0.7, 0.85), L(f.jaw, 0.25, 0.4), awake(f)) },
  { e: '😠', w: 1.05, level: 2, hint: 'დაიბღვირე', s: (f) => A(H(f.browDown, 0.5, 0.7), O(H(f.pout, 0.3, 0.5), f.narrow, H(f.teeth, 0.3, 0.5)), L(f.smile, 0.25, 0.4), L(f.jaw, 0.25, 0.4), 1 - f.shut) },
  { e: '🤬', w: 1.1, level: 3, hint: 'წარბები შეკარი და იყვირე', s: (f) => A(H(f.browDown, 0.35, 0.55), H(f.jaw, 0.25, 0.4), L(f.smile, 0.45, 0.65)) },

  // head
  { e: '😕', level: 1, hint: 'თავი გადახარე', s: (f) => A(tilted(f), calm(f), L(f.jaw, 0.25, 0.4), awake(f), 1 - kissing(f)) },
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

// The emoji for one detection result, or null when the face is turned too far
// or too small to say.
export function read(res) {
  const f = features(res);
  return f.away ? null : best(scoreAll(f)).e;
}

const SLOW = new Set(EMOJIS.filter((r) => r.slow).map((r) => r.e));

// Keeps the shown emoji steady: a new one must lead for a short time (longer
// for closed-eye faces, so a blink does not count). Times are milliseconds,
// not frames. `favour` (the emoji being asked for) wins near-ties.
export class Stabilizer {
  constructor(hold = 140, slow = 320, margin = 0.1) {
    this.hold = hold;
    this.slow = slow;
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
    if (now - this.since >= (SLOW.has(top.e) ? this.slow : this.hold)) { this.current = top.e; this.cand = null; }
    return this.current;
  }
}
