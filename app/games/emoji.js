// სახე → ემოჯი. The camera picture with the mesh, the emoji the face matches,
// a collection to fill, and a 45-second round of "make this face".
import { FaceView, haptic, store } from '../core.js';
import { EMOJIS, NEUTRAL, features, scoreAll, Stabilizer } from '../rules.js';

const ROUND_MS = 45000;
const TARGET_MS = 8000;    // a target nobody manages is swapped after this long
const HOLD_MS = 450;       // a face counts once it has been held this long
const CONFIRM_MS = 380;    // a hit stays on screen this long before the next target
const LOST_MS = 400;       // no face for this long: say so and pause the round
const PICK_MS = 10000;     // a tapped hint goes away by itself
const BARS_EVERY = 90;     // ms between bar updates: readable, not jittery
const RANK_EVERY = 600;    // ms between changes of which signals are listed
const BAR_ROWS = 5;

const SET = EMOJIS.filter((r) => r.e !== NEUTRAL);
const EASY = SET.filter((r) => r.level === 1).length;
const SMALL = matchMedia('(max-width: 899px), (max-height: 520px)');   // same test as emoji.css
const CALM = matchMedia('(prefers-reduced-motion: reduce)');

// A camera view that keeps the face inside the part of the picture the box
// shows. core.js has no option for this, so the layout step is extended here.
class FollowView extends FaceView {
  constructor(canvas, face) {
    super(canvas, face, { fit: 'cover' });
    this.cx = 0.5;
    this.cy = 0.5;
  }

  // box: the face in 0..1 of the picture, or null to drift back to the middle.
  follow(box, dt) {
    const k = dt ? 1 - Math.exp(-dt / 220) : 1;
    this.cx += ((box ? (box.x0 + box.x1) / 2 : 0.5) - this.cx) * k;
    this.cy += ((box ? (box.y0 + box.y1) / 2 : 0.5) - this.cy) * k;
  }

  _layout() {
    const f = super._layout();
    if (!f || !(f.s > 0)) return f;
    const spareX = f.sw * f.s - this.w, spareY = f.sh * f.s - this.h;
    const pan = (want, spare) => -Math.max(0, Math.min(spare, want));
    if (spareX > 0) f.ox = pan((1 - this.cx) * f.sw * f.s - this.w / 2, spareX);   // the picture is mirrored
    if (spareY > 0) f.oy = pan(this.cy * f.sh * f.s - this.h / 2, spareY);
    return f;
  }
}

const TEMPLATE = `
<div class="eg">
  <div class="eg-cam">
    <canvas></canvas>
    <div class="eg-clock" hidden><i></i></div>
    <div class="eg-hud" hidden>
      <span class="eg-stat"><small>ქულა</small><b class="num" data-r="score">0</b></span>
      <span class="eg-stat"><small>დრო</small><b class="num" data-r="time"></b></span>
    </div>
    <div class="eg-result" hidden>
      <small>ქულა</small>
      <b class="num" data-r="final"></b>
      <span>რეკორდი <b class="num" data-r="best"></b></span>
    </div>
    <p class="eg-msg" hidden>სახე არ ჩანს</p>
  </div>
  <div class="eg-strip">
    <span class="eg-now emoji">${NEUTRAL}</span>
    <span class="eg-target">
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <circle class="eg-ring-bg" cx="50" cy="50" r="46"/>
        <circle class="eg-ring-fg" cx="50" cy="50" r="46" pathLength="100"/>
      </svg>
      <span class="emoji"></span>
    </span>
    <p class="eg-hint"></p>
    <div class="eg-bars">${'<div class="eg-bar"><span></span><b></b><i><i></i></i></div>'.repeat(BAR_ROWS)}</div>
  </div>
  <div class="eg-coll">${SET.map((r) => `<button class="eg-cell" data-e="${r.e}" aria-label="${r.hint}"><span class="emoji">${r.e}</span></button>`).join('')}</div>
  <div class="eg-acts">
    <button class="btn" data-a="reset">თავიდან <kbd>R</kbd></button>
    <span class="eg-count num"></span>
    <button class="btn primary" data-a="play">თამაში <kbd>Space</kbd></button>
    <button class="btn" data-a="skip" hidden>შემდეგი <kbd>Space</kbd></button>
  </div>
</div>`;

export function mount(root, { face }) {
  root.innerHTML = TEMPLATE;
  const el = root.firstElementChild;
  const q = (s) => el.querySelector(s);
  const nowEl = q('.eg-now'), targetEl = q('.eg-target'), targetEmoji = q('.eg-target .emoji');
  const ring = q('.eg-ring-fg'), hintEl = q('.eg-hint'), countEl = q('.eg-count');
  const hud = q('.eg-hud'), clock = q('.eg-clock'), clockFill = q('.eg-clock i');
  const scoreEl = q('[data-r=score]'), timeEl = q('[data-r=time]');
  const result = q('.eg-result'), msg = q('.eg-msg');
  const playBtn = q('[data-a=play]'), skipBtn = q('[data-a=skip]');
  const cells = new Map([...el.querySelectorAll('.eg-cell')].map((c) => [c.dataset.e, c]));
  const bars = [...el.querySelectorAll('.eg-bar')].map((row) => ({
    name: row.children[0], num: row.children[1], fill: row.children[2].firstElementChild, key: '',
  }));
  // The grid shares its height between its rows; CSS needs the row counts.
  el.style.setProperty('--r8', Math.ceil(SET.length / 8));
  el.style.setProperty('--r10', Math.ceil(SET.length / 10));

  const view = new FollowView(q('canvas'), face);
  const stab = new Stabilizer();
  const unlocked = new Set();
  const ac = new AbortController();

  let raf = 0, prev = 0;
  let last = null;            // the latest detection result
  let fake = null;            // tests: a function standing in for face.detect
  let shown = NEUTRAL;        // the emoji on screen
  let heldMs = 0;             // how long it has been on screen
  let lostMs = 0, lost = false, calib = false;
  let round = null;           // { left, score, target, age, confirm, recent }
  let pick = null, pickMs = 0, hover = null;   // a hint asked for in free play
  let aimed = null;           // the emoji in the ring right now
  let aimMs = 0;              // how long the face has matched it
  let barsAt = 0, rankAt = 0;
  let ringAt = -1, clockAt = -1, secAt = -1;

  const text = (node, s) => { if (node.textContent !== s) node.textContent = s; };
  const pop = (node, scale) => {
    if (!CALM.matches && node.animate) node.animate([{ transform: `scale(${scale})` }, { transform: 'none' }], { duration: 220, easing: 'ease-out' });
  };

  function setShown(e) {
    if (e === shown) return;
    shown = e;
    heldMs = 0;
    nowEl.textContent = e;
  }

  function unlock(e) {
    if (unlocked.has(e) || !cells.has(e)) return;
    unlocked.add(e);
    cells.get(e).classList.add('eg-on');
    pop(cells.get(e), 1.4);
    showCount();
    if (!round) haptic(15);
    if (e === pick) pickMs = PICK_MS - 900;      // got it: the hint can go
  }

  function showCount() { text(countEl, `${unlocked.size} / ${SET.length}`); }

  // The ring shows the round's target, or the emoji whose hint was asked for.
  function syncAim() {
    const a = round ? round.target : hover || pick;
    if (a === aimed) return;
    if (aimed && cells.has(aimed)) cells.get(aimed).classList.remove('eg-sel');
    aimed = a;
    aimMs = 0;
    el.classList.toggle('eg-aim', !!a);
    if (!a) return;
    cells.get(a).classList.add('eg-sel');
    targetEmoji.textContent = a;
    hintEl.textContent = EMOJIS.find((r) => r.e === a).hint;
  }

  function setPick(e) {
    pick = e;
    pickMs = 0;
  }

  // ---------- the round ----------

  function nextTarget() {
    const level = round.score < 3 ? 1 : round.score < 7 ? 2 : 3;     // easy first
    let pool = SET.filter((r) => r.level <= level && !round.recent.includes(r.e));
    if (!pool.length) pool = SET.filter((r) => r.e !== round.target);
    round.target = pool[Math.floor(Math.random() * pool.length)].e;
    round.recent.push(round.target);
    if (round.recent.length > Math.max(1, Math.min(6, EASY - 2))) round.recent.shift();
    round.age = 0;
    round.confirm = 0;
  }

  function start() {
    round = { left: ROUND_MS, score: 0, target: null, age: 0, confirm: 0, recent: [] };
    pick = hover = null;
    nextTarget();
    syncMode();
  }

  function skip() {
    if (round && round.confirm <= 0) nextTarget();
  }

  function hit() {
    round.score++;
    round.confirm = CONFIRM_MS;
    unlock(round.target);
    haptic(30);
    pop(targetEl, 1.12);
  }

  function finish() {
    const score = round.score;
    const best = Math.max(score, store.get('emoji.best', 0));
    store.set('emoji.best', best);
    round = null;
    q('[data-r=final]').textContent = score;
    q('[data-r=best]').textContent = best;
    result.hidden = false;
    haptic([30, 60, 30]);
    syncMode();
  }

  function reset() {
    round = null;
    pick = hover = null;
    result.hidden = true;
    unlocked.clear();
    for (const c of cells.values()) c.classList.remove('eg-on');
    stab.reset();
    face.resetBaseline();
    setShown(NEUTRAL);
    syncMode();
  }

  function syncMode() {
    const on = !!round;
    hud.hidden = clock.hidden = skipBtn.hidden = !on;
    playBtn.hidden = on;
    if (on) result.hidden = true;
    clockAt = secAt = -1;
    showCount();
    syncAim();
  }

  // ---------- the model's numbers ----------

  function showBars(raw, now) {
    if (now - barsAt < BARS_EVERY) return;
    barsAt = now;
    if (now - rankAt >= RANK_EVERY || !bars[0].key) {
      rankAt = now;
      const rows = SMALL.matches ? 3 : BAR_ROWS;
      const top = Object.keys(raw).filter((k) => k[0] !== '_').sort((a, b) => raw[b] - raw[a]).slice(0, rows);
      // A signal keeps its row while it stays in the top set, so names do not jump.
      const fresh = top.filter((k) => !bars.some((b, i) => i < rows && b.key === k));
      bars.forEach((b, i) => {
        if (i < rows && !top.includes(b.key)) { b.key = fresh.shift() || ''; text(b.name, b.key); }
      });
    }
    for (const b of bars) {
      if (!b.key) continue;
      const v = raw[b.key] || 0;
      b.fill.style.transform = `scaleX(${v.toFixed(3)})`;
      text(b.num, v.toFixed(2));
    }
  }

  // ---------- every frame ----------

  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = prev ? Math.min(100, now - prev) : 0;     // a hidden tab or a stall does not eat the clock
    prev = now;
    const res = fake ? fake(now) : face.detect(now);
    if (res) last = res;
    if (!last) { view.draw(null); return; }

    lostMs = last.found ? 0 : lostMs + dt;
    if ((lostMs >= LOST_MS) !== lost) {
      lost = !lost;
      el.classList.toggle('eg-lost', lost);
      msg.hidden = !lost;
      if (lost) { stab.reset(); setShown(NEUTRAL); }
    }
    if (last.found) view.follow(last.box, dt);
    else if (lost) view.follow(null, dt);
    view.draw(last);

    if (res && res.found) {
      if (res.calibrating !== calib) { calib = res.calibrating; el.classList.toggle('eg-calib', calib); }
      const scores = scoreAll(features(res));
      setShown(calib ? NEUTRAL : stab.update(scores, now, aimed));
      showBars(res.raw, now);
    }

    const live = last.found && !document.hidden;
    if (live) {
      heldMs += dt;
      if (heldMs >= HOLD_MS && shown !== NEUTRAL) unlock(shown);
    }

    if (round && live) {
      round.left -= dt;
      if (round.confirm > 0) {
        round.confirm -= dt;
        if (round.confirm <= 0) nextTarget();
      } else {
        round.age += dt;
        if (round.age >= TARGET_MS) nextTarget();
      }
      if (round.left <= 0) finish();
    } else if (pick && !hover) {
      pickMs += dt;
      if (pickMs >= PICK_MS) setPick(null);
    }
    syncAim();

    if (aimed) {
      const done = round ? round.confirm > 0 : aimMs >= HOLD_MS;
      if (!done) {
        // A short slip does not empty the ring at once.
        aimMs = live && shown === aimed ? Math.min(HOLD_MS, aimMs + dt) : Math.max(0, aimMs - 2 * dt);
        if (aimMs >= HOLD_MS) {
          if (round) hit();
          else if (pick === aimed) pickMs = Math.max(pickMs, PICK_MS - 900);
        } else if (aimMs > 0) pickMs = 0;
      } else if (!round && shown !== aimed) aimMs = 0;
      const pct = Math.round(100 * aimMs / HOLD_MS);
      if (pct !== ringAt) { ringAt = pct; ring.style.strokeDashoffset = 100 - pct; }
      targetEl.classList.toggle('eg-hit', aimMs >= HOLD_MS);
    }

    if (round) {
      const part = Math.round(1000 * Math.max(0, round.left) / ROUND_MS);
      if (part !== clockAt) { clockAt = part; clockFill.style.transform = `scaleX(${part / 1000})`; }
      const sec = Math.ceil(Math.max(0, round.left) / 1000);
      if (sec !== secAt) { secAt = sec; timeEl.textContent = sec; }
      text(scoreEl, String(round.score));
    }
  }

  // ---------- input ----------

  el.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b) b.blur();                               // so Space stays the game's key
    const a = b && b.dataset.a;
    if (a === 'play') start();
    else if (a === 'skip') skip();
    else if (a === 'reset') reset();
    else if (e.target.closest('.eg-result')) result.hidden = true;
    else if (!round) setPick(b && b.dataset.e && b.dataset.e !== pick ? b.dataset.e : null);
  }, { signal: ac.signal });

  const coll = q('.eg-coll');
  coll.addEventListener('pointerover', (e) => {
    const cell = e.target.closest('.eg-cell');
    if (e.pointerType === 'mouse' && !round) hover = cell ? cell.dataset.e : null;
  }, { signal: ac.signal });
  coll.addEventListener('pointerleave', () => { hover = null; }, { signal: ac.signal });

  addEventListener('keydown', (e) => {
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.code === 'KeyR') reset();
    else if (e.code === 'Space' && !(e.target instanceof Element && e.target.closest('button, a'))) {
      e.preventDefault();
      if (round) skip(); else start();
    }
  }, { signal: ac.signal });

  syncMode();
  raf = requestAnimationFrame(frame);

  const hook = {                                   // for tests
    get state() {
      return {
        shown, lost, calib, aimed, aim: aimMs / HOLD_MS, unlocked: [...unlocked], total: SET.length,
        round: round && { left: round.left, score: round.score, target: round.target },
        result: result.hidden ? null : { score: +q('[data-r=final]').textContent, best: +q('[data-r=best]').textContent },
      };
    },
    fake(fn) { fake = fn; },
  };
  window.__emoji = hook;

  return function unmount() {
    cancelAnimationFrame(raf);
    ac.abort();
    view.destroy();
    if (window.__emoji === hook) delete window.__emoji;
  };
}
