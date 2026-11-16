// node dev/test_rules.mjs : every emoji must win for its own idealised face.
import { EMOJIS, features, scoreAll, best } from '../app/rules.js';
const both = (n, v) => ({ [n + 'Left']: v, [n + 'Right']: v });
const smile = (v) => both('mouthSmile', v), blink = (v) => both('eyeBlink', v);
const brows = (v) => ({ browInnerUp: v, ...both('browOuterUp', v) });
const teeth = (v) => ({ ...both('mouthUpperUp', v), ...both('mouthLowerDown', v) });
const cases = {
  '😐': [{}],
  '🙂': [smile(0.5)],
  '😊': [smile(0.9)],
  '😁': [{ ...smile(0.85), ...teeth(0.6) }],
  '😃': [{ ...smile(0.8), jawOpen: 0.5 }],
  '😆': [{ ...smile(0.8), jawOpen: 0.5, ...blink(0.8) }],
  '🤩': [{ ...smile(0.8), ...brows(0.7) }],
  '🥰': [smile(0.8), 25],
  '🤪': [{ ...smile(0.7), jawOpen: 0.5 }, -25],
  '😏': [{ mouthSmileLeft: 0.6, mouthSmileRight: 0.05 }],
  '😉': [{ eyeBlinkLeft: 0.8, eyeBlinkRight: 0.1, ...smile(0.4) }],
  '😘': [{ eyeBlinkLeft: 0.1, eyeBlinkRight: 0.8, mouthPucker: 0.8 }],
  '😗': [{ mouthPucker: 0.85 }],
  '😚': [{ mouthPucker: 0.8, ...blink(0.85) }],
  '😌': [{ ...blink(0.85), ...smile(0.6) }],
  '😑': [blink(0.85)],
  '🥱': [{ ...blink(0.8), jawOpen: 0.8 }],
  '😮': [{ jawOpen: 0.6 }],
  '😱': [{ jawOpen: 0.75, ...brows(0.7) }],
  '😳': [brows(0.8)],
  '🤨': [{ browOuterUpLeft: 0.7, browOuterUpRight: 0.05, browInnerUp: 0.2 }],
  '😢': [{ ...both('mouthFrown', 0.6), browInnerUp: 0.7 }],
  '🙁': [both('mouthFrown', 0.6)],
  '😠': [both('browDown', 0.7)],
  '🤬': [{ ...both('browDown', 0.7), jawOpen: 0.6 }],
  '😖': [{ ...both('noseSneer', 0.7), ...both('eyeSquint', 0.7), ...both('browDown', 0.5) }],
  '🙄': [both('eyeLookUp', 0.8)],
  '👀': [{ eyeLookOutLeft: 0.85, eyeLookInRight: 0.85 }],
  '😬': [{ ...both('mouthStretch', 0.7), ...teeth(0.5) }],
  '🤐': [{ mouthRollLower: 0.7, mouthRollUpper: 0.7 }],
  '🥴': [{ mouthLeft: 0.7 }],
  '🤔': [{}, 22],
};
let bad = 0;
for (const r of EMOJIS) {
  const c = cases[r.e];
  if (!c) { console.log('NO CASE', r.e); bad++; continue; }
  const sc = scoreAll(features(c[0], c[1] || 0));
  const top = best(sc);
  const second = [...sc].filter(([k]) => k !== top.e).sort((a, b) => b[1] - a[1])[0];
  const ok = top.e === r.e && top.s - second[1] >= 0.1;
  if (!ok) bad++;
  console.log(ok ? 'ok  ' : 'FAIL', r.e, '->', top.e, top.s.toFixed(2), 'next', second[0], second[1].toFixed(2));
}
console.log(bad ? `${bad} FAILED` : `all ${EMOJIS.length} ok`);
process.exit(bad ? 1 : 0);
