// სახე → ემოჯი. The camera picture with the mesh, the emoji the face matches
// (lit among all of them), and a 45-second round of "make this face".
import { FaceView, emojiEl, setEmoji, preloadEmoji, haptic, store } from '../core.js';
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

const SET = EMOJIS.filter((r) => r.e !== NEUTRAL);          // what a round can ask for
const HINT = new Map(SET.map((r) => [r.e, r.hint]));
const EASY = SET.filter((r) => r.level === 1).length;
const SMALL = matchMedia('(max-width: 899px), (max-height: 520px)');   // same test as emoji.css
const CALM = matchMedia('(prefers-reduced-motion: reduce)');
const EASE = 'cubic-bezier(.2, .8, .2, 1)';                             // --ease in base.css

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
    <span class="eg-now"></span>
    <span class="eg-target">
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <circle class="eg-ring-bg" cx="50" cy="50" r="46"/>
        <circle class="eg-ring-fg" cx="50" cy="50" r="46" pathLength="100"/>
      </svg>
      <span class="eg-target-e"></span>
    </span>
    <p class="eg-hint"></p>
    <div class="eg-bars">${'<div class="eg-bar"><span></span><b></b><i><i></i></i></div>'.repeat(BAR_ROWS)}</div>
  </div>
  <div class="eg-coll"></div>
  <div class="eg-acts">
    <button class="btn" data-a="again" hidden>თავიდან <kbd>R</kbd></button>
    <button class="btn primary" data-a="play">თამაში <kbd>Space</kbd></button>
    <button class="btn" data-a="skip" hidden>შემდეგი <kbd>Space</kbd></button>
  </div>
</div>`;

export function mount(root, { face }) {
  root.innerHTML = TEMPLATE;
  const el = root.firstElementChild;
  const q = (s) => el.querySelector(s);
  const nowEl = q('.eg-now'), targetEl = q('.eg-target'), targetEmoji = q('.eg-target-e');
  const ring = q('.eg-ring-fg'), hintEl = q('.eg-hint');
  const hud = q('.eg-hud'), clock = q('.eg-clock'), clockFill = q('.eg-clock i');
  const scoreEl = q('[data-r=score]'), timeEl = q('[data-r=time]');
  const result = q('.eg-result'), msg = q('.eg-msg');
  const playBtn = q('[data-a=play]'), skipBtn = q('[data-a=skip]'), againBtn = q('[data-a=again]');
  const coll = q('.eg-coll');
  // Every emoji is on show from the start; the one the face makes is lit.
  const cells = new Map(EMOJIS.map((r) => {
    const c = document.createElement('button');
    c.className = 'eg-cell';
    c.dataset.e = r.e;
    if (r.hint) c.setAttribute('aria-label', r.hint); else c.tabIndex = -1;
    c.append(emojiEl(r.e));
    coll.append(c);
    return [r.e, c];
  }));
  const bars = [...el.querySelectorAll('.eg-bar')].map((row) => ({
    name: row.children[0], num: row.children[1], fill: row.children[2].firstElementChild, key: '',
  }));
  preloadEmoji(EMOJIS.map((r) => r.e));

  const view = new FollowView(q('canvas'), face);
  const stab = new Stabilizer();
  const ac = new AbortController();

  let raf = 0, prev = 0;
  let last = null;            // the latest detection result
  let fake = null;            // tests: a function standing in for face.detect
  let shown = null;           // the emoji on screen
  let lostMs = 0, lost = false;
  let round = null;           // { left, score, target, age, confirm, recent }
  let pick = null, pickMs = 0, hover = null;   // a hint asked for in free play
  let aimed = null;           // the emoji in the ring right now
  let aimMs = 0;              // how long the face has matched it
  let barsAt = 0, rankAt = 0;
  let ringAt = -1, clockAt = -1, secAt = -1;

  const text = (node, s) => { if (node.textContent !== s) node.textContent = s; };
  const pop = (node, scale) => {
    if (!CALM.matches && node.animate) node.animate([{ transform: `scale(${scale})` }, { transform: 'none' }], { duration: 200, easing: EASE });
  };

  function setShown(e) {
    if (e === shown) return;
    if (shown) cells.get(shown).classList.remove('eg-live');
    shown = e;
    cells.get(e).classList.add('eg-live');
    setEmoji(nowEl, e);
  }

  // The ring shows the round's target, or the emoji whose hint was asked for.
  function syncAim() {
    const a = round ? round.target : hover || pick;
    if (a === aimed) return;
    if (aimed) cells.get(aimed).classList.remove('eg-sel');
    aimed = a;
    aimMs = 0;
    el.classList.toggle('eg-aim', !!a);
    if (!a) return;
    cells.get(a).classList.add('eg-sel');
    setEmoji(targetEmoji, a);
    hintEl.textContent = HINT.get(a);
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

  // R: a round starts over; outside a round the last result goes away.
  function again() {
    if (round) { start(); return; }
    pick = hover = null;
    result.hidden = true;
    stab.reset();
    face.resetBaseline();
    syncMode();
  }

  function syncMode() {
    const on = !!round;
    hud.hidden = clock.hidden = skipBtn.hidden = againBtn.hidden = !on;
    playBtn.hidden = on;
    if (on) result.hidden = true;
    clockAt = secAt = -1;
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
      res.aspect = face.width / face.height;             // the rules measure the landmarks themselves
      res.h = face.height;
      const f = features(res);
      // Turned far away or very small: the last emoji stays rather than a guess.
      if (!f.away) setShown(stab.update(scoreAll(f), now, aimed));
      showBars(res.raw, now);
    }

    const live = last.found && !document.hidden;
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
          else { pop(targetEl, 1.12); haptic(15); pickMs = Math.max(pickMs, PICK_MS - 900); }   // made it: the hint can go
        } else if (aimMs > 0) pickMs = 0;
      } else if (!round && shown !== aimed) aimMs = 0;
      const pct = Math.round(100 * aimMs / HOLD_MS);
      if (pct !== ringAt) { ringAt = pct; ring.style.strokeDasharray = `${pct} 100`; }
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
    else if (a === 'again') again();
    else if (!result.hidden && e.target.closest('.eg-cam')) result.hidden = true;
    else if (!round) setPick(b && HINT.has(b.dataset.e) && b.dataset.e !== pick ? b.dataset.e : null);
  }, { signal: ac.signal });

  const hinted = (node) => {
    const cell = node.closest('.eg-cell');
    return cell && HINT.has(cell.dataset.e) ? cell.dataset.e : null;
  };
  coll.addEventListener('pointerover', (e) => {
    if (e.pointerType === 'mouse' && !round) hover = hinted(e.target);
  }, { signal: ac.signal });
  coll.addEventListener('pointerleave', () => { hover = null; }, { signal: ac.signal });
  // The keyboard gets the same hint as the mouse.
  coll.addEventListener('focusin', (e) => {
    if (!round && e.target.matches('.eg-cell:focus-visible')) hover = hinted(e.target);
  }, { signal: ac.signal });
  coll.addEventListener('focusout', () => { hover = null; }, { signal: ac.signal });

  addEventListener('keydown', (e) => {
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.code === 'KeyR') again();
    else if (e.code === 'Space' && !(e.target instanceof Element && e.target.closest('button, a'))) {
      e.preventDefault();
      if (round) skip(); else start();
    }
  }, { signal: ac.signal });

  // A recording made from the top bar gets the current emoji in its corner.
  face.recOverlay = (ctx, w, h) => {
    const img = nowEl.firstElementChild;
    if (!img || img.tagName !== 'IMG' || !img.complete || !img.naturalWidth) return;
    const size = h / 5;
    ctx.drawImage(img, w - size - 16, h - size - 16, size, size);
  };
  if (face.enableHands) face.enableHands();        // hand emojis join once the model is in

  setShown(NEUTRAL);
  syncMode();
  raf = requestAnimationFrame(frame);

  const hook = {                                   // for tests
    get state() {
      return {
        shown, lost, aimed, aim: aimMs / HOLD_MS, total: SET.length,
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
    face.recOverlay = null;
    if (window.__emoji === hook) delete window.__emoji;
  };
}
