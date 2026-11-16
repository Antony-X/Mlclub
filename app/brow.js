// "წარბებით ფრენა": raise your eyebrows to keep a network node in the air
// and steer it through gaps between layers of neurons.
import { FaceTracker, drawFace, MESH_COLORS, CAMERA_ERRORS } from './face.js';

const W = 1280, H = 640;
const GRAVITY = 950, FLAP = -370, SPEED = 190;   // px/s², px/s, px/s
const GAP = 215, SPACING = 360, COL_W = 54, R = 16, X0 = 300;
const CALIB_MS = 1000;
const C = { bg: '#111316', panel: '#1a1d21', line: '#30353b', text: '#ece8df', soft: '#8b9096', gold: '#e7c46b', blue: '#6fb6ce', salmon: '#d9776b', green: '#8cc084' };
const FONT = '"FiraGO","Segoe UI","Noto Sans Georgian","Sylfaen",sans-serif';

const $ = (id) => document.getElementById(id);
const cv = $('game'), ctx = cv.getContext('2d');
const msg = $('msg');
const cam = $('camview'), camCtx = cam.getContext('2d');   // camera preview with mesh
const meter = $('meter'), mctx = meter.getContext('2d');

const tracker = new FaceTracker($('cam'));
let last = null, camReady = false;

// state: 'calib' -> 'ready' -> 'play' -> 'over' -> 'ready'
let state = 'calib';
let calib = [], calibStart = 0;
let base = 0, peak = 0, brow = 0, up = false;
let y, vy, cols, score, best = 0, overAt = 0, trail = [];
let prevT = 0, noFaceSince = 0;

try { best = +sessionStorage.getItem('browBest') || 0; } catch (e) { /* storage unavailable */ }

const onLevel = () => base + Math.max(0.16, 0.45 * (peak - base));
const offLevel = () => base + Math.max(0.09, 0.25 * (peak - base));

function recalibrate() {
  state = 'calib';
  calib = [];
  calibStart = 0;
  peak = 0;
  up = false;
}

function newRun() {
  y = H / 2; vy = 0; score = 0; trail = [];
  cols = [];
  for (let i = 0; i < 5; i++) addCol(W + 80 + i * SPACING);
}

function addCol(x) {
  const m = 70;
  cols.push({ x, gy: m + GAP / 2 + Math.random() * (H - 2 * m - GAP), passed: false });
}

function flap() {
  if (state === 'ready') { newRun(); state = 'play'; vy = FLAP; }
  else if (state === 'play') vy = FLAP;
  else if (state === 'over' && performance.now() - overAt > 1200) { newRun(); state = 'play'; vy = FLAP; }
}

addEventListener('keydown', (e) => {
  if (e.code === 'Space' || e.code === 'ArrowUp') { e.preventDefault(); flap(); }
  else if (e.code === 'KeyR') { recalibrate(); }
  else if (e.code === 'KeyF') {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen().catch(() => {});
  }
});
cv.addEventListener('pointerdown', flap);
$('reset').addEventListener('click', (e) => { e.currentTarget.blur(); recalibrate(); });

// ---- face input ----
function readFace(now) {
  const res = tracker.detect(now);
  if (!res) return;
  last = res;
  if (!res.found) { if (!noFaceSince) noFaceSince = now; return; }
  noFaceSince = 0;
  const r = res.raw;
  brow = 0.5 * r.browInnerUp + 0.25 * (r.browOuterUpLeft + r.browOuterUpRight);

  if (state === 'calib') {
    if (!calibStart) calibStart = now;
    calib.push(brow);
    if (now - calibStart >= CALIB_MS && calib.length >= 8) {
      calib.sort((a, b) => a - b);
      base = calib[Math.floor(calib.length * 0.3)];   // low-ish percentile: resting brows
      peak = base + 0.4;
      state = 'ready';
    }
    return;
  }
  if (brow > peak) peak = brow;
  if (!up && brow > onLevel()) { up = true; flap(); }
  else if (up && brow < offLevel()) up = false;
}

// ---- simulation ----
function step(dt) {
  vy += GRAVITY * dt;
  y += vy * dt;
  for (const c of cols) c.x -= SPEED * dt;
  if (cols[0].x < -COL_W) { cols.shift(); addCol(cols[cols.length - 1].x + SPACING); }
  trail.push(y);
  if (trail.length > 26) trail.shift();

  if (y < R) { y = R; vy = 0; }          // the ceiling only stops you
  let dead = y > H - R;
  for (const c of cols) {
    if (!c.passed && c.x + COL_W / 2 < X0) { c.passed = true; score++; }
    if (X0 + R > c.x - COL_W / 2 && X0 - R < c.x + COL_W / 2 && (y - R < c.gy - GAP / 2 || y + R > c.gy + GAP / 2)) dead = true;
  }
  if (dead) {
    state = 'over';
    overAt = performance.now();
    if (score > best) {
      best = score;
      try { sessionStorage.setItem('browBest', best); } catch (e) { /* storage unavailable */ }
    }
  }
}

// ---- drawing ----
function drawLayer(c) {
  // a column of neurons with a gap, joined by a spine
  const top = c.gy - GAP / 2, bot = c.gy + GAP / 2;
  ctx.fillStyle = C.panel;
  ctx.strokeStyle = C.line;
  ctx.lineWidth = 1.5;
  for (const [y0, y1] of [[-4, top], [bot, H + 4]]) {
    ctx.beginPath();
    ctx.roundRect(c.x - COL_W / 2, y0, COL_W, y1 - y0, 10);
    ctx.fill(); ctx.stroke();
  }
  ctx.fillStyle = C.blue;
  for (let yy = top - 22; yy > 0; yy -= 44) { ctx.beginPath(); ctx.arc(c.x, yy, 9, 0, 6.3); ctx.fill(); }
  for (let yy = bot + 22; yy < H; yy += 44) { ctx.beginPath(); ctx.arc(c.x, yy, 9, 0, 6.3); ctx.fill(); }
  ctx.strokeStyle = C.gold;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(c.x - COL_W / 2, top); ctx.lineTo(c.x + COL_W / 2, top);
  ctx.moveTo(c.x - COL_W / 2, bot); ctx.lineTo(c.x + COL_W / 2, bot);
  ctx.stroke();
}

function drawNode(yy) {
  // signal trail
  ctx.strokeStyle = 'rgba(231,196,107,.35)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  trail.forEach((ty, i) => {
    const tx = X0 - (trail.length - 1 - i) * 5;
    if (i) ctx.lineTo(tx, ty); else ctx.moveTo(tx, ty);
  });
  ctx.stroke();
  ctx.fillStyle = C.gold;
  ctx.beginPath(); ctx.arc(X0, yy, R, 0, 6.3); ctx.fill();
  ctx.fillStyle = C.bg;
  ctx.beginPath(); ctx.arc(X0 + 5, yy - 3, 4, 0, 6.3); ctx.fill();
  // little brow that lifts with yours
  ctx.strokeStyle = C.bg; ctx.lineWidth = 2.5;
  const lift = up ? 5 : 0;
  ctx.beginPath(); ctx.moveTo(X0 - 1, yy - 9 - lift); ctx.lineTo(X0 + 11, yy - 11 - lift); ctx.stroke();
}

function text(s, x, yy, size, color, align = 'center', weight = 600) {
  ctx.font = `${weight} ${size}px ${FONT}`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.fillText(s, x, yy);
}

function drawMeter() {
  // the one number the game reads: how far the brows are raised
  const w = meter.width, h = meter.height, x0 = 12, bw = w - 24, by = 30, bh = 12;
  mctx.fillStyle = C.panel;
  mctx.fillRect(0, 0, w, h);
  mctx.font = '13px Consolas, "DejaVu Sans Mono", monospace';
  mctx.fillStyle = C.soft;
  mctx.textAlign = 'left';
  mctx.fillText(`browUp ${brow.toFixed(2)}`, x0, 20);
  mctx.fillStyle = C.line;
  mctx.fillRect(x0, by, bw, bh);
  const span = Math.max(0.5, peak + 0.1);
  mctx.fillStyle = up ? C.gold : C.blue;
  mctx.fillRect(x0, by, bw * Math.min(1, brow / span), bh);
  if (state !== 'calib') {
    const tx = x0 + bw * Math.min(1, onLevel() / span);
    mctx.strokeStyle = C.text;
    mctx.lineWidth = 2;
    mctx.beginPath(); mctx.moveTo(tx, by - 5); mctx.lineTo(tx, by + bh + 5); mctx.stroke();
  }
}

function draw(now) {
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);
  // faint grid
  ctx.strokeStyle = 'rgba(48,53,59,.5)'; ctx.lineWidth = 1;
  ctx.beginPath();
  for (let gx = 0; gx < W; gx += 80) { ctx.moveTo(gx, 0); ctx.lineTo(gx, H); }
  for (let gy = 0; gy < H; gy += 80) { ctx.moveTo(0, gy); ctx.lineTo(W, gy); }
  ctx.stroke();

  if (state === 'play' || state === 'over') {
    for (const c of cols) drawLayer(c);
    drawNode(y);
    text(String(score), W / 2, 84, 72, C.text, 'center', 700);
  } else {
    const bob = Math.sin(now / 300) * 10;
    trail = [];
    drawNode(H / 2 + bob);
  }
  text(`რეკორდი ${best}`, W - 22, 38, 20, C.soft, 'right');

  const faceLost = noFaceSince && now - noFaceSince > 400;
  if (state === 'calib') {
    text(faceLost || !last ? 'სახე არ ჩანს' : 'უყურე კამერას მშვიდი სახით…', W / 2, H / 2 - 70, 34, C.text);
  } else if (state === 'ready') {
    text('აწიე წარბები!', W / 2, H / 2 - 80, 54, C.gold, 'center', 700);
    text('ყოველი აწევა — ერთი ნახტომი', W / 2, H / 2 - 40, 22, C.soft, 'center', 400);
  } else if (state === 'over') {
    ctx.fillStyle = 'rgba(17,19,22,.72)';
    ctx.fillRect(0, 0, W, H);
    text(`ქულა: ${score}`, W / 2, H / 2 - 30, 64, C.text, 'center', 700);
    text(score >= best && score > 0 ? 'ახალი რეკორდი!' : `რეკორდი ${best}`, W / 2, H / 2 + 14, 24, C.gold);
    if (now - overAt > 1200) text('აწიე წარბები თავიდან დასაწყებად', W / 2, H / 2 + 62, 22, C.soft, 'center', 400);
  } else if (faceLost) {
    text('სახე არ ჩანს', W / 2, 140, 26, C.salmon);
  }
  drawMeter();
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - prevT) / 1000);
  prevT = now;
  if (camReady) {
    readFace(now);
    if (last) {
      const ch = Math.round(cam.width * tracker.height / tracker.width);
      if (ch && cam.height !== ch) cam.height = ch;
      drawFace(camCtx, tracker, last, MESH_COLORS);
    }
  }
  if (state === 'play') step(dt);
  draw(now);
}

// ---- boot ----
newRun();
(async () => {
  try {
    await tracker.init();
  } catch (e) {
    console.error(e);
    msg.textContent = CAMERA_ERRORS.load;
    return;
  }
  try {
    await tracker.startCamera();
  } catch (e) {
    console.error(e);
    msg.textContent = CAMERA_ERRORS[e.code] || CAMERA_ERRORS.busy;
    return;
  }
  camReady = true;
  msg.hidden = true;
  prevT = performance.now();
  requestAnimationFrame(frame);
})();

// test hook
window.__brow = {
  get state() { return state; }, get score() { return score; }, get brow() { return brow; },
  get base() { return base; }, get y() { return y; }, get cols() { return cols; }, flap,
  setBrow(v) { tracker.detect = () => ({ found: true, raw: { browInnerUp: v, browOuterUpLeft: v, browOuterUpRight: v }, landmarks: null }); },
};
