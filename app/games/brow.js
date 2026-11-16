// "წარბებით ფრენა": the club poster in motion. A network of layers scrolls
// past, each with neurons missing; you are the missing neuron, and every
// raise of your eyebrows is one hop.
import { FaceView, haptic, store } from '../core.js';
import { RaiseDetector, median } from './brow-detector.js';
import { P, createWorld, step, flap } from './brow-world.js';

const TEXT = {
  look: 'უყურე კამერას',
  raise: 'აწიე წარბები',
  mouth: 'ან გააღე პირი',
  lost: 'სახე არ ჩანს',
  layer: 'შრე',
  best: 'რეკორდი',
  reset: 'თავიდან',
  you: 'შენ',
};

const BROW = 'browInnerUp', JAW = 'jawOpen';   // the model's own names for the two signals
const CALIB_MS = 1000;      // of resting face before the first raise
const LOST_MS = 300;        // no face for this long stops a run
const NEW_FACE_MS = 2500;   // no face for this long between runs: the next face is a new visitor
const ABANDON_MS = 5000;    // ... and in the middle of a run
const HINT_MS = 5000;       // no raise on the start screen: offer the mouth
const LOCK_MS = 900;        // after a crash, so the raise that crashed does not restart
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
          <div class="bg-sigs">
            <div class="bg-sig" data-sig="brow"><span>${BROW}</span><span class="num"></span><div class="bg-bar"><i></i><b></b></div></div>
            <div class="bg-sig" data-sig="jaw" hidden><span>${JAW}</span><span class="num"></span><div class="bg-bar"><i></i><b></b></div></div>
          </div>
          <div class="bg-score">
            <p class="bg-now"><span>${TEXT.layer}</span> <b class="num">0</b></p>
            <p class="bg-top">${TEXT.best} <span class="num">0</span></p>
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
          <p class="bg-or" hidden>${TEXT.mouth}</p>
        </div>
      </div>
    </div>`;

  const $ = (sel) => root.querySelector(sel);
  const el = {
    root: $('.bg-root'), stage: $('.bg-stage'), canvas: $('.bg-canvas'), reset: $('.bg-reset'),
    now: $('.bg-now b'), top: $('.bg-top span'),
    result: $('.bg-result'), resultN: $('.bg-result b'), best: $('.bg-best'), bestN: $('.bg-best span'),
    ask: $('.bg-ask'), or: $('.bg-or'),
  };
  const meters = {};
  for (const m of root.querySelectorAll('.bg-sig')) {
    meters[m.dataset.sig] = { box: m, num: m.children[1], fill: m.querySelector('i'), tick: m.querySelector('b') };
  }

  const css = getComputedStyle(document.documentElement);
  const C = {};
  for (const k of ['bg', 'line', 'text', 'soft', 'gold', 'salmon']) C[k] = css.getPropertyValue(`--${k}`).trim();
  const FONT = css.getPropertyValue('--font').trim();
  const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const meshRest = rgba(C.text, 0.8);
  const view = new FaceView($('.bg-cam canvas'), face, {
    colors: { mesh: rgba(C.text, 0.16), oval: rgba(C.text, 0.5), lips: meshRest, eyes: meshRest, brows: meshRest },
  });
  const ctx = el.canvas.getContext('2d');

  const brow = new RaiseDetector();
  const jaw = new RaiseDetector({ range0: 0.35, minRise: 0.10, maxRise: 0.20, minFall: 0.08, maxFall: 0.20 });

  // 'calib' -> 'ready' -> 'play' <-> 'frozen', 'play' -> 'over' -> 'play'
  let state = 'calib';
  let world = createWorld();
  let best = store.get('brow.best', 0);
  let jawOn = false;          // this visitor may also open the mouth
  let calib = null;           // resting samples being collected
  let lostAt = 0;             // when the face went away (0: it is here)
  let runFace = false;        // a face has been seen in this run (keyboard runs need none)
  let readyAt = 0, overAt = 0, record = false, asked = false;
  let flash = null;           // { layer, at }
  let size = { w: 0, h: 0 }, dpr = 1;
  let prev = 0, acc = 0, raf = 0;
  let lastCam = null;
  let fake = null;            // tests: a signal in place of the camera's
  let shown = { score: -1, best: -1 };

  // Where the player sits on screen, in heights: further in on a wide screen.
  const aspect = () => (size.h ? size.w / size.h : 1);
  const playerX = () => clamp(0.22 * aspect(), 0.10, 0.40);
  const faceHere = () => !lostAt;

  // ---------- states ----------

  function setState(s) {
    state = s;
    el.root.dataset.state = s;
    message();
  }

  function message() {
    const over = state === 'over';
    el.result.hidden = el.best.hidden = !over;
    if (over) {
      el.resultN.textContent = world.score;
      el.bestN.textContent = best;
      el.best.classList.toggle('bg-new', record);
    }
    const ask =
      state === 'calib' ? TEXT.look
      : state === 'ready' ? TEXT.raise
      : state === 'frozen' ? (faceHere() ? TEXT.raise : TEXT.lost)
      : over ? TEXT.raise
      : '';
    el.ask.textContent = ask;
    const waiting = over && !asked;                // keeps its place, so nothing jumps
    el.ask.style.visibility = el.or.style.visibility = waiting ? 'hidden' : '';
    el.or.hidden = !(jawOn && ask === TEXT.raise);
    meters.jaw.box.hidden = !jawOn;
  }

  function recalibrate() {
    saveBest();
    brow.reset();
    jaw.reset();
    jawOn = false;
    calib = null;
    flash = null;
    world = createWorld();
    setState('calib');
  }

  function saveBest() {
    record = world.score > best;
    if (record) {
      best = world.score;
      store.set('brow.best', best);
    }
  }

  function start(viaFace) {
    if (state === 'over') world = createWorld();
    flash = null;
    acc = 0;
    runFace = viaFace;
    flap(world);
    setState('play');
  }

  function freeze() {
    if (state === 'play') setState('frozen');
  }

  function die(now) {
    saveBest();
    overAt = now;
    asked = false;
    haptic(120);
    setState('over');
  }

  // A raise of the eyebrows (or the mouth, or a key).
  function onRaise(now, viaFace) {
    if (state === 'play') flap(world);
    else if (state === 'ready' || (state === 'calib' && !viaFace)) start(viaFace);
    else if (state === 'frozen') {
      runFace = viaFace;
      flap(world);
      setState('play');
    } else if (state === 'over' && now - overAt >= LOCK_MS) start(viaFace);
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
    const b = res.raw[BROW] || 0, j = res.raw[JAW] || 0;
    const wasLost = lostAt;
    lostAt = 0;
    if (state === 'play') runFace = true;
    if (wasLost && state === 'frozen') message();
    meter(meters.brow, b, brow);
    meter(meters.jaw, j, jaw);

    if (state === 'calib') {
      if (!calib || now - calib.last > LOST_MS) calib = { t0: now, brow: [], jaw: [] };
      calib.brow.push(b);
      calib.jaw.push(j);
      calib.last = now;
      if (now - calib.t0 >= CALIB_MS && calib.brow.length >= 6) {
        brow.calibrate(median(calib.brow), now);
        jaw.calibrate(median(calib.jaw), now);
        readyAt = now;
        setState('ready');
      }
      return;
    }
    if (wasLost && now - wasLost > LOST_MS) {       // back from a break: no comparing across it
      brow.calibrate(b, now);
      jaw.calibrate(j, now);
    }
    const up = brow.update(b, now);
    const open = jaw.update(j, now) && jawOn;
    if (up || open) onRaise(now, true);
  }

  function meter(m, value, det) {
    m.num.textContent = value.toFixed(2);
    m.fill.style.width = `${clamp(value, 0, 1) * 100}%`;
    m.tick.style.left = `${clamp(det.fireLevel, 0, 1) * 100}%`;
    m.tick.hidden = !det.ready;
    m.box.classList.toggle('bg-on', det.raised);
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
    const left = world.x - playerX();
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
      ctx.globalAlpha = 0.8;
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
      ctx.font = `600 ${clamp(0.05 * H, 15, 34)}px ${FONT}`;
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
      : { found: true, raw: { [BROW]: fake.brow || 0, [JAW]: fake.jaw || 0 } };
    if (res) onResult(res, now);

    const gone = lostAt ? now - lostAt : 0;
    if (state === 'ready') {
      if (gone > NEW_FACE_MS) recalibrate();
      else if (!jawOn && !gone && now - readyAt > HINT_MS) {
        jawOn = true;
        message();
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
      else if (!asked && now - overAt >= LOCK_MS) {
        asked = true;
        message();
      }
    }

    if (world.score !== shown.score) el.now.textContent = shown.score = world.score;
    if (best !== shown.best) el.top.textContent = shown.best = best;
    view.colors.brows = brow.raised ? C.gold : meshRest;
    view.draw(lastCam);
    draw(now);
  }

  // ---------- controls ----------
  // A tap on the screen is deliberately not a flap: this is played with the face.

  function onKey(e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.code === 'Space' || e.code === 'ArrowUp') {
      e.preventDefault();
      if (!e.repeat) onRaise(performance.now(), false);
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
  el.reset.addEventListener('click', onReset);
  document.addEventListener('visibilitychange', onVisibility);
  document.fonts.load(`600 20px ${FONT}`, TEXT.you).catch(() => {});   // the canvas does not ask for it by itself
  message();
  prev = performance.now();
  raf = requestAnimationFrame(frame);

  // For tests. feed({ brow: 0.6, jaw: 0 }) replaces the camera's signal,
  // feed({ found: false }) hides the face, feed(null) gives the camera back.
  window.__brow = {
    get state() { return state; },
    get score() { return world.score; },
    get best() { return best; },
    get world() { return world; },
    get jawOn() { return jawOn; },
    get view() { return { aspect: aspect(), playerX: playerX() }; },
    brow,
    feed(v) { fake = v; },
  };

  return function unmount() {
    cancelAnimationFrame(raf);
    ro.disconnect();
    removeEventListener('keydown', onKey);
    el.reset.removeEventListener('click', onReset);
    document.removeEventListener('visibilitychange', onVisibility);
    view.destroy();
    saveBest();
    delete window.__brow;
  };
}
