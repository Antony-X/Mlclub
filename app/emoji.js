import { FaceTracker, drawFace, MESH_COLORS, CAMERA_ERRORS } from './face.js';
import { EMOJIS, NEUTRAL, features, scoreAll, Stabilizer } from './rules.js';

const ROUND_S = 45;       // length of one game
const TARGET_S = 7;       // a target is swapped after this long
const HOLD_MS = 400;      // how long a face must be held to count
const N_BARS = 5;

const $ = (id) => document.getElementById(id);
const view = $('view'), ctx = view.getContext('2d');
const msg = $('msg'), nowBox = $('now');

const tracker = new FaceTracker($('cam'));
const stab = new Stabilizer();
const unlocked = new Set();
const collectable = EMOJIS.map((r) => r.e).filter((e) => e !== NEUTRAL);

let last = null;                 // last detection result
let heldEmoji = null, heldSince = 0;
let game = null;                 // { end, score, target, targetSince, hitSince }
let lastTargets = [];

// ---- static UI ----
const cells = new Map();
for (const e of collectable) {
  const s = document.createElement('span');
  s.textContent = e;
  $('grid').appendChild(s);
  cells.set(e, s);
}
const bars = [];
for (let i = 0; i < N_BARS; i++) {
  const row = document.createElement('div');
  row.className = 'bar';
  row.innerHTML = '<span class="name"></span><span class="track"><span class="fill" style="display:block;width:0"></span></span><span class="num"></span>';
  $('bars').appendChild(row);
  bars.push({ name: row.children[0], fill: row.children[1].firstChild, num: row.children[2] });
}

function showMsg(text, html) {
  if (text == null) { msg.hidden = true; return; }
  msg.hidden = false;
  if (html) msg.innerHTML = text; else msg.textContent = text;
}

function renderCollection() {
  for (const [e, el] of cells) el.classList.toggle('on', unlocked.has(e));
  $('count').textContent = `${unlocked.size} / ${collectable.length}`;
}

function flash() {
  nowBox.classList.add('hit');
  setTimeout(() => nowBox.classList.remove('hit'), 250);
}

// ---- game ----
function nextTarget(now) {
  const pool = collectable.filter((e) => !lastTargets.includes(e));
  const t = pool[Math.floor(Math.random() * pool.length)];
  lastTargets.push(t);
  if (lastTargets.length > 8) lastTargets.shift();
  game.target = t;
  game.targetSince = now;
  game.hitSince = 0;
  $('target').textContent = t;
}

function startGame() {
  const now = performance.now();
  game = { end: now + ROUND_S * 1000, score: 0 };
  lastTargets = [];
  document.body.classList.add('playing');
  $('score').textContent = '0';
  showMsg(null);
  nextTarget(now);
}

function endGame() {
  const score = game.score;
  game = null;
  document.body.classList.remove('playing');
  $('time').textContent = '–';
  showMsg(`<div class="result">ქულა: ${score}<small>შეგროვებული: ${unlocked.size} / ${collectable.length}</small></div>`, true);
  resultUntil = performance.now() + 60000;
}
let resultUntil = 0;

function reset() {
  game = null;
  resultUntil = 0;
  document.body.classList.remove('playing');
  unlocked.clear();
  stab.reset();
  tracker.resetBaseline();
  heldEmoji = null;
  $('score').textContent = '0';
  $('time').textContent = '–';
  $('current').textContent = NEUTRAL;
  renderCollection();
  showMsg(null);
}

$('play').addEventListener('click', (e) => { e.currentTarget.blur(); startGame(); });
$('reset').addEventListener('click', (e) => { e.currentTarget.blur(); reset(); });
addEventListener('keydown', (e) => {
  if (e.code === 'Space') { e.preventDefault(); startGame(); }
  else if (e.code === 'KeyR') reset();
  else if (e.code === 'KeyF') {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen().catch(() => {});
  }
});

// ---- per-frame ----
function frame(now) {
  requestAnimationFrame(frame);
  const res = tracker.detect(now);
  if (res) last = res;
  if (!last) return;

  if (view.width !== tracker.width && tracker.width) {
    view.width = tracker.width;
    view.height = tracker.height;
  }
  drawFace(ctx, tracker, last, MESH_COLORS);
  $('fps').textContent = tracker.fps ? `${tracker.fps.toFixed(0)} fps` : '';

  const showingResult = now < resultUntil;
  if (!last.found) {
    if (!showingResult) showMsg('სახე არ ჩანს');
    stab.reset();
    $('current').textContent = NEUTRAL;
  } else {
    if (!showingResult) showMsg(null);
    const scores = scoreAll(features(last.bs, last.roll));
    const shown = last.calibrating ? NEUTRAL : stab.update(scores, now);
    $('current').textContent = shown;

    // unlock anything held long enough
    if (shown !== heldEmoji) { heldEmoji = shown; heldSince = now; }
    else if (shown !== NEUTRAL && !unlocked.has(shown) && now - heldSince >= HOLD_MS) {
      unlocked.add(shown);
      renderCollection();
      if (!game) flash();
    }

    if (game) {
      const ok = shown === game.target || (scores.get(game.target) || 0) > 0.65;
      if (!ok) game.hitSince = 0;
      else if (!game.hitSince) game.hitSince = now;
      else if (now - game.hitSince >= HOLD_MS) {
        game.score++;
        $('score').textContent = game.score;
        if (!unlocked.has(game.target)) { unlocked.add(game.target); renderCollection(); }
        flash();
        nextTarget(now);
      }
    }

    // live bars: strongest raw model outputs
    const top = Object.entries(last.raw).filter(([k]) => k !== '_neutral')
      .sort((a, b) => b[1] - a[1]).slice(0, N_BARS);
    top.forEach(([k, v], i) => {
      bars[i].name.textContent = k;
      bars[i].fill.style.width = `${(v * 100).toFixed(0)}%`;
      bars[i].num.textContent = v.toFixed(2);
    });
  }

  if (game) {
    const left = (game.end - now) / 1000;
    if (left <= 0) endGame();
    else {
      $('time').textContent = Math.ceil(left);
      if (now - game.targetSince > TARGET_S * 1000) nextTarget(now);
    }
  }
}

// ---- boot ----
renderCollection();
(async () => {
  try {
    await tracker.init();
  } catch (e) {
    console.error(e);
    showMsg(CAMERA_ERRORS.load);
    return;
  }
  try {
    await tracker.startCamera();
  } catch (e) {
    console.error(e);
    showMsg(CAMERA_ERRORS[e.code] || CAMERA_ERRORS.busy);
    return;
  }
  showMsg(null);
  requestAnimationFrame(frame);
})();

// test hook
window.__emoji = { tracker, stab, unlocked, get last() { return last; }, get game() { return game; } };
