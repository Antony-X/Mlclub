// "თვალებით ფრენა": the club poster in motion. A network of layers scrolls
// past, each with neurons missing; you are the missing neuron, and every
// blink is one hop.
import { FaceView, haptic, store, palette, theme } from '../core.js';
import { BlinkDetector, median } from './brow-detector.js';
import { P, createWorld, step, flap, playerX } from './brow-world.js';

const TEXT = {
  look: 'უყურე კამერას',
  blink: 'დაახამხამე',
  lost: 'სახე არ ჩანს',
  layer: 'შრე',
  best: 'რეკორდი',
  reset: 'თავიდან',
  you: 'შენ',
};

const METER = 'eyeBlink';   // the model's name for what the meter shows: the mean of its left and right
const blinkOf = (raw) => ((raw.eyeBlinkLeft || 0) + (raw.eyeBlinkRight || 0)) / 2;

const CALIB_MS = 1000;      // of resting face before the first hop
const LOST_MS = 300;        // no face for this long stops a run
const NEW_FACE_MS = 2500;   // no face for this long between runs: the next face is a new visitor
const ABANDON_MS = 5000;    // ... and in the middle of a run
const SOFTEN_MS = 5000;     // no blink heard on the start screen: listen for weaker ones
const LOCK_MS = 1500;       // the result stays up this long before a blink can start again,
const RETRY_MS = 800;       // or this long when the run was over at once: straight back in
const SHORT_RUN = 3;        // layers
const QUIET_MS = 350;       // after a hop nothing hops: one blink, however it is made, is one hop
const LIT_MS = 250;         // a blink is short: keep it visible this long
const FLASH_MS = 240;
const MAX_FRAME = 0.1;      // s, a longer hitch is not played back

const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

function rgba(hex, a) {
  const n = parseInt(hex.replace('#', ''), 16);
  return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`;
}

export function mount(root, { face }) {
  root.innerHTML = `
    <div class="bg-root" data-state="calib">
      <aside class="bg-hud">
        <div class="bg-cam"><canvas></canvas></div>
        <div class="bg-mid">
          <div class="bg-sig"><span>${METER}</span><span class="num"></span><div class="bg-bar"><i></i><b></b></div></div>
          <div class="bg-score">
            <p class="bg-now"><span>${TEXT.layer}</span> <b class="num">0</b></p>
            <p class="bg-top" hidden>${TEXT.best} <span class="num"></span></p>
          </div>
        </div>
        <button class="btn bg-reset" type="button" aria-label="${TEXT.reset}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square" aria-hidden="true"><path d="M5 12a7 7 0 1 0 2.2-5.1M5 4v4h4"/></svg>
          <span>${TEXT.reset}</span><kbd>R</kbd>
        </button>
      </aside>
      <div class="bg-stage">
        <canvas class="bg-canvas"></canvas>
        <div class="bg-msg">
          <p class="bg-result" hidden><span>${TEXT.layer}</span> <b class="num"></b></p>
          <p class="bg-best" hidden>${TEXT.best} <span class="num"></span></p>
          <p class="bg-ask"></p>
        </div>
      </div>
    </div>`;

  const $ = (sel) => root.querySelector(sel);
  const el = {
    root: $('.bg-root'), stage: $('.bg-stage'), canvas: $('.bg-canvas'), reset: $('.bg-reset'),
    sig: $('.bg-sig'), sigN: $('.bg-sig .num'), fill: $('.bg-bar i'), tick: $('.bg-bar b'),
    now: $('.bg-now b'), top: $('.bg-top'), topN: $('.bg-top span'),
    result: $('.bg-result'), resultN: $('.bg-result b'), best: $('.bg-best'), bestN: $('.bg-best span'),
    ask: $('.bg-ask'),
  };

  const FONT = getComputedStyle(document.documentElement).getPropertyValue('--font').trim();
  const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const ctx = el.canvas.getContext('2d');

  // The picture is small: a faint mesh, the outline, and the eyes, which are the control.
  const view = new FaceView($('.bg-cam canvas'), face, { colors: {} });
  let C, eyes;                // the theme's colours; the eyes' colour at rest
  function colours() {
    C = palette();
    const ink = theme() === 'light' ? C.bg : C.text;      // light lines: they lie on a photo
    eyes = rgba(ink, 0.7);
    Object.assign(view.colors, { mesh: rgba(ink, 0.2), oval: rgba(ink, 0.5), brows: rgba(ink, 0), lips: rgba(ink, 0), eyes });
  }
  colours();

  const det = new BlinkDetector();

  // 'calib' -> 'ready' -> 'play' <-> 'frozen', 'play' -> 'over' -> 'play'
  let state = 'calib';
  let world = createWorld();
  let best = store.get('brow.best', 0);
  let result = null;          // { score, best, record } of the last run that counted
  let calib = null;           // resting samples being collected
  let lostAt = 0;             // when the face went away (0: it is here)
  let runFace = false;        // a face has been seen in this run (keyboard runs need none)
  let hops = 0, from = 'ready';   // of this run: how many hops, and where it began
  let value = 0, blinkAt = -Infinity;
  let quietUntil = 0;         // no blink hops before this
  let readyAt = 0, overAt = 0, asked = false, softened = false;
  let flash = null;           // { layer, at }
  let size = { w: 0, h: 0 }, dpr = 1;
  let prev = 0, acc = 0, raf = 0;
  let lastCam = null;
  let fake = null;            // tests: a signal in place of the camera's
  const shown = { score: -1, best: -1 };

  const aspect = () => (size.h ? size.w / size.h : 1);
  const lockout = () => (result && result.score >= SHORT_RUN ? LOCK_MS : RETRY_MS);

  // ---------- states ----------

  function setState(s) {
    state = s;
    el.root.dataset.state = s;
    message();
  }

  function message() {
    const over = state === 'over';
    el.result.hidden = !over;
    el.best.hidden = !over || !result.best;
    if (over) {
      el.resultN.textContent = result.score;
      el.bestN.textContent = result.best;
      el.best.classList.toggle('bg-new', result.record);
    }
    el.ask.textContent =
      state === 'calib' ? TEXT.look
      : state === 'frozen' && lostAt ? TEXT.lost
      : state === 'play' ? ''
      : TEXT.blink;
    el.ask.style.visibility = over && !asked ? 'hidden' : '';    // keeps its place, so nothing jumps
  }

  function recalibrate() {
    saveBest();
    det.reset();
    softened = false;
    calib = null;
    flash = null;
    result = null;
    world = createWorld();
    setState('calib');
  }

  function saveBest() {
    const record = world.score > best;
    if (record) {
      best = world.score;
      store.set('brow.best', best);
    }
    return record;
  }

  function start(viaFace) {
    from = state === 'over' ? 'over' : 'ready';
    if (state === 'over') world = createWorld();
    flash = null;
    acc = 0;
    hops = 0;
    runFace = viaFace;
    setState('play');
  }

  function freeze() {
    if (state === 'play') setState('frozen');
  }

  function die(now) {
    // One hop and nothing after it is not a run: most likely a natural blink.
    // It must not wipe the result on screen, so things go back to where they were.
    const stray = hops < 2 && world.score === 0;
    if (stray && from === 'ready') {
      world = createWorld();
      setState(det.ready ? 'ready' : 'calib');
      return;
    }
    if (!stray) {
      const record = saveBest();
      result = { score: world.score, best, record };
      haptic(120);
    }
    overAt = now;
    asked = false;
    setState('over');
  }

  // A blink, or a key.
  function hop(now, viaFace) {
    if (state === 'over' && now - overAt < lockout()) return;
    if (state === 'calib' && viaFace) return;
    if (state !== 'play' && state !== 'frozen') start(viaFace);
    else if (state === 'frozen') {
      runFace = viaFace;
      setState('play');
    }
    hops++;
    flap(world);
  }

  // ---------- the face ----------

  function onResult(res, now) {
    if (!res.found) {
      if (!lostAt) {
        lostAt = now;
        if (state === 'frozen') message();
      }
      return;
    }
    const away = lostAt ? now - lostAt : 0;
    lostAt = 0;
    if (state === 'play') runFace = true;
    if (away && state === 'frozen') message();
    value = blinkOf(res.raw);
    el.sigN.textContent = value.toFixed(2);
    el.fill.style.transform = `scaleX(${clamp(value, 0, 1)})`;

    if (state === 'calib') {
      if (!calib || now - calib.last > LOST_MS) calib = { t0: now, values: [] };
      calib.values.push(value);
      calib.last = now;
      if (now - calib.t0 >= CALIB_MS && calib.values.length >= 6) {
        det.calibrate(median(calib.values), now);
        readyAt = now;
        setState('ready');
      }
      return;
    }
    // Back from a break (or a run begun on the keyboard): no comparing across it.
    if (!det.ready || away > LOST_MS) det.calibrate(value, now);

    const blinked = det.update(value, now);
    el.tick.style.transform = `translateX(${clamp(det.fireLevel, 0, 1) * 100}%)`;
    if (!blinked || now < quietUntil) return;
    quietUntil = now + QUIET_MS;
    blinkAt = now;
    hop(now, true);
  }

  // ---------- drawing ----------

  function resize() {
    const r = el.stage.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    size = { w: r.width, h: r.height };
    el.canvas.width = Math.max(1, Math.round(r.width * dpr));
    el.canvas.height = Math.max(1, Math.round(r.height * dpr));
  }

  function ring(x, y, r, lw, stroke) {
    ctx.beginPath();
    ctx.arc(x, y, r - lw / 2, 0, TAU);
    ctx.fillStyle = C.bg;
    ctx.fill();
    ctx.lineWidth = lw;
    ctx.strokeStyle = stroke;
    ctx.stroke();
  }

  function draw(now) {
    const W = size.w, H = size.h;
    if (!W || !H) return;
    const L = world.layers;
    const left = world.x - playerX(aspect());
    const sx = (x) => (x - left) * H;
    const r = P.NODE_R * H, lw = Math.max(1.5, 0.0085 * H);
    const px = sx(world.x), py = world.y * H;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, W, H);

    // weights: every neuron of a layer to every neuron of the next
    ctx.beginPath();
    for (let i = 0; i + 1 < L.length; i++) {
      const ax = sx(L[i].x), bx = sx(L[i + 1].x);
      if (bx < 0 || ax > W) continue;
      for (const ya of L[i].ys) for (const yb of L[i + 1].ys) {
        ctx.moveTo(ax, ya * H);
        ctx.lineTo(bx, yb * H);
      }
    }
    ctx.lineWidth = 1;
    ctx.strokeStyle = C.line;
    ctx.stroke();

    // the layer just passed: for a moment you were its missing neuron
    if (flash) {
      const age = (now - flash.at) / FLASH_MS, i = L.indexOf(flash.layer);
      if (age >= 1 || i < 0) flash = null;
      else {
        const x = sx(flash.layer.x), y = flash.layer.yPass * H;
        ctx.beginPath();
        for (const n of [L[i - 1], L[i + 1]]) {
          if (!n) continue;
          for (const yn of n.ys) {
            ctx.moveTo(x, y);
            ctx.lineTo(sx(n.x), yn * H);
          }
        }
        ctx.globalAlpha = calm ? 1 : 1 - age;
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = C.gold;
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }

    for (const l of L) {
      const x = sx(l.x);
      if (x < -r || x > W + r) continue;
      for (const y of l.ys) ring(x, y * H, r, lw, C.text);
    }

    ctx.fillStyle = C.line;                         // the floor
    ctx.fillRect(0, H - 1, W, 1);

    if (state === 'over' || state === 'frozen') {   // step back behind the message
      ctx.globalAlpha = 0.86;
      ctx.fillStyle = C.bg;
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1;
      if (world.hit) ring(sx(world.hit.layer.x), world.hit.y * H, r, lw, C.salmon);
    }

    ctx.beginPath();
    ctx.arc(px, py, r, 0, TAU);
    ctx.fillStyle = C.gold;
    ctx.fill();

    if (state === 'calib' || state === 'ready') {   // as on the poster: the empty place is yours
      ctx.font = `600 ${clamp(0.05 * H, 16, 32)}px ${FONT}`;
      ctx.textBaseline = 'middle';
      ctx.fillStyle = C.gold;
      ctx.fillText(TEXT.you, px + r * 1.6, py);
    }
  }

  // ---------- the loop ----------

  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(MAX_FRAME, (now - prev) / 1000);
    prev = now;

    const cam = face.detect(now);
    if (cam) lastCam = cam;
    const res = !fake ? cam
      : fake.found === false ? { found: false }
      : { found: true, raw: { eyeBlinkLeft: fake.blink || 0, eyeBlinkRight: fake.blink || 0 } };
    if (res) onResult(res, now);

    const gone = lostAt ? now - lostAt : 0;
    if (state === 'ready') {
      if (gone > NEW_FACE_MS) recalibrate();
      else if (!softened && !gone && now - readyAt > SOFTEN_MS) {
        softened = true;
        det.soften();
      }
    } else if (state === 'play') {
      if (runFace && gone > LOST_MS) freeze();
      else {
        acc += dt;
        while (acc >= P.STEP && !world.dead) {
          acc -= P.STEP;
          const passed = step(world);
          if (passed) {
            flash = { layer: passed, at: now };
            haptic(20);
          }
        }
        if (world.dead) die(now);
      }
    } else if (state === 'frozen') {
      if (gone > ABANDON_MS) recalibrate();
    } else if (state === 'over') {
      if (gone > NEW_FACE_MS) recalibrate();
      else if (!asked && now - overAt >= lockout()) {
        asked = true;
        message();
      }
    }

    if (world.score !== shown.score) el.now.textContent = shown.score = world.score;
    if (best !== shown.best) {
      el.topN.textContent = shown.best = best;
      el.top.hidden = !best;
    }
    const lit = det.shut || now - blinkAt < LIT_MS;
    view.colors.eyes = lit ? C.gold : eyes;
    el.sig.classList.toggle('bg-on', lit);
    el.tick.hidden = !det.ready;
    view.draw(lastCam);
    draw(now);
  }

  // ---------- controls ----------
  // A tap on the screen is deliberately not a hop: this is played with the eyes.

  function onKey(e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.code === 'Space' || e.code === 'ArrowUp') {
      e.preventDefault();
      if (!e.repeat) hop(performance.now(), false);
    } else if (e.code === 'KeyR') recalibrate();
  }
  function onReset() {
    el.reset.blur();
    recalibrate();
  }
  function onVisibility() {
    if (document.visibilityState !== 'visible') freeze();
  }

  const ro = new ResizeObserver(resize);
  ro.observe(el.stage);
  resize();
  addEventListener('keydown', onKey);
  addEventListener('themechange', colours);
  el.reset.addEventListener('click', onReset);
  document.addEventListener('visibilitychange', onVisibility);
  document.fonts.load(`600 20px ${FONT}`, TEXT.you).catch(() => {});   // the canvas does not ask for it by itself
  message();
  prev = performance.now();
  raf = requestAnimationFrame(frame);

  // The shell can record the camera picture: the layer count goes on it too.
  face.recOverlay = (c, w, h) => {
    if (state === 'calib' || state === 'ready') return;
    const text = `${TEXT.layer} ${state === 'over' ? result.score : world.score}`;
    const px = Math.round(h * 0.06), pad = Math.round(px * 0.4), edge = Math.round(h * 0.03);
    c.font = `700 ${px}px ${FONT}`;
    c.textAlign = 'left';
    c.textBaseline = 'middle';
    c.fillStyle = C.bg;
    c.fillRect(edge, h - edge - px - 2 * pad, c.measureText(text).width + 2 * pad, px + 2 * pad);
    c.fillStyle = C.text;
    c.fillText(text, edge + pad, h - edge - pad - px / 2);
  };

  // For tests. feed({ blink: 0.7 }) replaces the camera's signal,
  // feed({ found: false }) hides the face, feed(null) gives the camera back.
  window.__brow = {
    get state() { return state; },
    get score() { return world.score; },
    get best() { return best; },
    get world() { return world; },
    get hops() { return hops; },
    get aspect() { return aspect(); },
    detector: det,
    feed(v) { fake = v; },
  };

  return function unmount() {
    cancelAnimationFrame(raf);
    ro.disconnect();
    removeEventListener('keydown', onKey);
    removeEventListener('themechange', colours);
    el.reset.removeEventListener('click', onReset);
    document.removeEventListener('visibilitychange', onVisibility);
    view.destroy();
    face.recOverlay = null;
    saveBest();
    delete window.__brow;
  };
}
