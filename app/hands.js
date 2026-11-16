// Hands -> emoji: gestures, and hands on the face. Pure functions: no DOM,
// runs in Node for tests (dev/test_hands.mjs, on dev/emoji/hand_fixtures.json).
//
// Input is what core.js reports: up to two hands, each 21 landmarks in the
// picture's own coordinates (not mirrored) plus the model's gesture name, and
// a few points of the face to tell "a finger on the lips" from "a finger up".

const clamp = (x) => Math.max(0, Math.min(1, x));
const H = (x, a, b) => clamp((x - a) / (b - a)); // rises from 0 at a to 1 at b
const L = (x, a, b) => 1 - H(x, a, b);            // falls from 1 at a to 0 at b
const A = Math.min, O = Math.max;

// Picture coordinates with square units (one unit = the picture's height).
const at = (p, aspect) => ({ x: p.x * aspect, y: p.y });
const gap = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

// The face points the hand rules need, from the 478 face landmarks.
// aspect = picture width / height.
export function anchor(pts, aspect = 1) {
  const P = (i) => at(pts[i], aspect);
  const r4 = (o) => ({ x: Math.round(o.x * 1e4) / 1e4, y: Math.round(o.y * 1e4) / 1e4 });
  return {
    w: Math.round(gap(P(234), P(454)) * 1e4) / 1e4,   // cheek to cheek
    eyes: r4(mid(P(33), P(263))), mouth: r4(mid(P(13), P(14))), chin: r4(P(152)), top: r4(P(10)),
    right: r4(P(234)), left: r4(P(454)),               // the face's own sides (its right is on the picture's left)
  };
}

// One hand -> what its fingers do and where it is.
export function describe(hand, aspect = 1) {
  const p = hand.landmarks;
  const d = (i, j) => Math.hypot((p[i].x - p[j].x) * aspect, p[i].y - p[j].y, ((p[i].z || 0) - (p[j].z || 0)) * aspect);
  // A finger is out when its tip is clearly farther from the wrist than its middle
  // joint, and the finger is straight. (Straightness alone fails on a fist seen
  // end-on, where the curled fingers shrink to short straight lines.)
  const out = (a, b, c, e) => A(H(d(e, 0) / d(b, 0), 1.05, 1.3), H(d(a, e) / (d(a, b) + d(b, c) + d(c, e)), 0.6, 0.85));
  const palm = d(0, 9), width = d(5, 17);
  const P = (i) => at(p[i], aspect);
  const dir = (a, b) => { const u = P(a), v = P(b), n = gap(u, v) || 1; return { x: (v.x - u.x) / n, y: (v.y - u.y) / n }; };
  const centre = [0, 5, 9, 13, 17].reduce((s, i) => ({ x: s.x + P(i).x / 5, y: s.y + P(i).y / 5 }), { x: 0, y: 0 });
  const named = (name) => (hand.gesture === name ? H(hand.score || 0, 0.4, 0.6) : 0);
  return {
    thumb: A(H(d(1, 4) / (d(1, 2) + d(2, 3) + d(3, 4)), 0.75, 0.9), H(d(4, 5) / width, 0.7, 1)),   // straight and away from the palm
    index: out(5, 6, 7, 8), middle: out(9, 10, 11, 12), ring: out(13, 14, 15, 16), pinky: out(17, 18, 19, 20),
    pinch: d(4, 8) / palm,                                         // thumb tip to index tip, in palm lengths
    thumbDir: dir(2, 4), indexDir: dir(5, 8), fingersDir: dir(0, 9),
    centre, tip: P(8), thumbTip: P(4), knuckle: P(5), size: gap(P(0), P(9)),
    named,
  };
}

const up = (v) => H(-v.y, 0.5, 0.8), down = (v) => H(v.y, 0.5, 0.8);
const fist = (h) => A(1 - h.index, 1 - h.middle, 1 - h.ring, 1 - h.pinky);
const one = (h) => A(h.index, 1 - h.middle, 1 - h.ring, 1 - h.pinky);           // the index finger alone
const flat = (h) => A(h.index, h.middle, h.ring, h.pinky);                      // four fingers out
const open = (h) => O(h.named('Open_Palm'), A(flat(h), h.thumb));

// e: the emoji. hint: how to make it. level: 1 easy .. 3 hard.
// s(hs, a): 0..1 from the described hands (one or two) and the face points
// (null when no face has been seen). Hand emojis outrank face emojis (w), and
// a hand on the face outranks the plain gesture it contains.
export const HAND_EMOJIS = [
  // one hand, anywhere
  { e: '👍', w: 1.3, level: 1, hint: 'ცერი ზევით', s: (hs) => any(hs, (h) => O(h.named('Thumb_Up'), A(fist(h), h.thumb, up(h.thumbDir)))) },
  { e: '👎', w: 1.3, level: 1, hint: 'ცერი ქვევით', s: (hs) => any(hs, (h) => O(h.named('Thumb_Down'), A(fist(h), h.thumb, down(h.thumbDir)))) },
  { e: '✌️', w: 1.3, level: 1, hint: 'აჩვენე ორი თითი', s: (hs) => any(hs, (h) => O(h.named('Victory'), A(h.index, h.middle, 1 - h.ring, 1 - h.pinky))) },
  { e: '☝️', w: 1.3, level: 1, hint: 'თითი ზევით ასწიე', s: (hs) => any(hs, (h) => A(O(h.named('Pointing_Up'), one(h)), up(h.indexDir))) },
  { e: '👇', w: 1.3, level: 2, hint: 'თითი ქვევით დაუშვი', s: (hs) => any(hs, (h) => A(one(h), down(h.indexDir))) },
  // The picture on screen is mirrored: pointing to your right shows on the right.
  { e: '👉', w: 1.3, level: 2, hint: 'თითი მარჯვნივ გაიშვირე', s: (hs) => any(hs, (h) => A(one(h), H(-h.indexDir.x, 0.6, 0.85))) },
  { e: '👈', w: 1.3, level: 2, hint: 'თითი მარცხნივ გაიშვირე', s: (hs) => any(hs, (h) => A(one(h), H(h.indexDir.x, 0.6, 0.85))) },
  { e: '✊', w: 1.25, level: 1, hint: 'მუშტი შეკარი', s: (hs) => any(hs, (h) => O(h.named('Closed_Fist'), A(fist(h), 1 - h.thumb))) },
  { e: '🖐️', w: 1.25, level: 1, hint: 'აჩვენე ხელისგული', s: (hs) => any(hs, open) },
  { e: '🤘', w: 1.35, level: 2, hint: 'საჩვენებელი და ნეკი ასწიე', s: (hs) => any(hs, (h) => O(h.named('ILoveYou'), A(h.index, h.pinky, 1 - h.middle, 1 - h.ring))) },
  { e: '🤙', w: 1.35, level: 2, hint: 'ცერი და ნეკი გაშალე', s: (hs) => any(hs, (h) => A(h.thumb, h.pinky, 1 - h.index, 1 - h.middle, 1 - h.ring)) },
  { e: '👌', w: 1.35, level: 2, hint: 'ცერი და საჩვენებელი შეაერთე', s: (hs) => any(hs, (h) => A(L(h.pinch, 0.25, 0.45), h.middle, h.ring, h.pinky)) },

  // a hand on the face
  { e: '🤫', w: 1.6, level: 1, hint: 'თითი ტუჩებზე მიიდე', s: (hs, a) => (a ? any(hs, (h) => A(O(one(h), h.named('Pointing_Up')), near(h.tip, a.mouth, a, 0.3), H(-h.indexDir.y, 0.3, 0.6))) : 0) },
  { e: '🤔', w: 1.5, level: 1, hint: 'ხელი ნიკაპზე მიიდე', s: (hs, a) => (a && hs.length === 1 ? any(hs, (h) => A(O(near(h.thumbTip, a.chin, a, 0.35), near(h.tip, a.chin, a, 0.35), near(h.knuckle, a.chin, a, 0.35)), H((h.centre.y - a.mouth.y) / a.w, 0, 0.15))) : 0) },
  { e: '🤭', w: 1.55, level: 2, hint: 'პირზე ხელი აიფარე', s: (hs, a) => (a && hs.length === 1 ? any(hs, (h) => A(near(h.centre, a.mouth, a, 0.42), 1 - one(h))) : 0) },
  { e: '🤦', w: 1.55, level: 2, hint: 'ხელი შუბლზე მიიდე', s: (hs, a) => (a && hs.length === 1 ? any(hs, (h) => near(h.centre, mid(a.eyes, a.top), a, 0.42)) : 0) },
  { e: '🫡', w: 1.6, level: 3, hint: 'ჯარისკაცივით მიესალმე', s: (hs, a) => (a && hs.length === 1 ? any(hs, (h) => A(flat(h), O(near(h.tip, temple(a, a.right), a, 0.3), near(h.tip, temple(a, a.left), a, 0.3)), H(Math.abs(h.centre.x - a.eyes.x) / a.w, 0.45, 0.65))) : 0) },
  { e: '🙋', w: 1.4, level: 1, hint: 'ხელი მაღლა ასწიე', s: (hs, a) => (a && hs.length === 1 ? any(hs, (h) => A(O(open(h), flat(h)), H((a.top.y - h.centre.y) / a.w, 0, 0.25))) : 0) },

  // two hands
  { e: '🙈', w: 1.7, level: 1, hint: 'თვალებზე ხელები აიფარე', s: (hs, a) => (a ? both(hs, (h) => A(L(Math.abs(h.centre.y - a.eyes.y) / a.w, 0.3, 0.5), L(Math.abs(h.centre.x - a.eyes.x) / a.w, 0.45, 0.65))) : 0) },
  { e: '🙊', w: 1.7, level: 2, hint: 'პირზე ორივე ხელი აიფარე', s: (hs, a) => (a ? both(hs, (h) => near(h.centre, a.mouth, a, 0.5)) : 0) },
  { e: '🙉', w: 1.65, level: 2, hint: 'ყურებზე ხელები აიფარე', s: (hs, a) => (a ? A(both(hs, (h) => A(L(Math.abs(h.centre.y - a.eyes.y) / a.w, 0.4, 0.6), H(Math.abs(h.centre.x - a.eyes.x) / a.w, 0.45, 0.65), L(Math.abs(h.centre.x - a.eyes.x) / a.w, 0.9, 1.2))), apart(hs, a)) : 0) },
  { e: '🙌', w: 1.5, level: 1, hint: 'ორივე ხელი ასწიე', s: (hs, a) => A(both(hs, (h) => A(O(open(h), flat(h)), up(h.fingersDir), a ? H(Math.abs(h.centre.x - a.eyes.x) / a.w, 0.9, 1.2) : 1, a ? H((a.chin.y - h.centre.y) / a.w, -0.2, 0.1) : 1)), a ? apart(hs, a) : 1) },
  { e: '🙏', w: 1.6, level: 2, hint: 'ხელისგულები შეატყუპე', s: (hs) => (hs.length === 2 ? A(L(gap(hs[0].centre, hs[1].centre) / O(hs[0].size, hs[1].size), 0.8, 1.2), up(hs[0].fingersDir), up(hs[1].fingersDir)) : 0) },
  { e: '🫶', w: 1.7, level: 3, hint: 'ხელებით გული გააკეთე', s: (hs) => (hs.length === 2 ? A(L(gap(hs[0].tip, hs[1].tip) / O(hs[0].size, hs[1].size), 0.5, 0.8), L(gap(hs[0].thumbTip, hs[1].thumbTip) / O(hs[0].size, hs[1].size), 0.5, 0.8), H(gap(hs[0].tip, hs[0].thumbTip) / hs[0].size, 0.6, 0.9)) : 0) },
];

const any = (hs, fn) => hs.reduce((m, h) => O(m, fn(h)), 0);
const both = (hs, fn) => (hs.length === 2 ? A(fn(hs[0]), fn(hs[1])) : 0);
// How close a point is to a face point, in face widths: 1 inside r, 0 past 1.4 r.
const near = (p, q, a, r) => L(gap(p, q) / a.w, r, r * 1.4);
const temple = (a, side) => ({ x: side.x, y: a.eyes.y - 0.1 * a.w });
// One hand on each side of the face.
const apart = (hs, a) => (hs.length === 2 && (hs[0].centre.x - a.eyes.x) * (hs[1].centre.x - a.eyes.x) < 0 ? 1 : 0);

// hands: core's res.hands. a: anchor() of the face, or null. Returns a Map emoji -> score.
export function handScores(hands, a, aspect = 1) {
  const m = new Map();
  if (!hands || !hands.length) return m;
  const hs = hands.slice(0, 2).map((h) => describe(h, aspect));
  for (const r of HAND_EMOJIS) {
    const s = r.s(hs, a) * r.w;
    if (s > 0) m.set(r.e, s);
  }
  return m;
}

// The best hand emoji for a result, or null (for tests).
export function readHands(hands, a, aspect = 1) {
  let e = null, s = 0.5;
  for (const [k, v] of handScores(hands, a, aspect)) if (v > s) { s = v; e = k; }
  return e;
}
