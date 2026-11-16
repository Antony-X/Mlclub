// The page shell: menu, routing between the two games, model loading and
// camera permission. A game is a module with
//
//   export function mount(root, { face }) { ...; return function unmount() {} }
//
// It is mounted only once the model is loaded and the camera is running, and
// both games share the one camera, so a phone asks for permission once.
import { FaceTracker, setEmoji } from './core.js';
import { Recorder } from './record.js';

const CLUB = 'მანქანური სწავლების კლუბი';
const GAMES = {
  emoji: { title: 'სახე → ემოჯი', load: () => import('./games/emoji.js') },
  brow: { title: 'თვალებით ფრენა', load: () => import('./games/brow.js') },
};

const PRIVACY = 'ვიდეო არ იწერება და არსად იგზავნება.';
const RECORDING = 'იწერება. ფაილი რჩება ამ მოწყობილობაზე.';
const REC_LABEL = { start: 'ვიდეოს ჩაწერა', stop: 'ჩაწერის შეჩერება' };

const MESSAGES = {
  loading: 'იტვირთება…',
  camera: 'დაუშვი კამერაზე წვდომა',
  load: 'ვერ ჩაიტვირთა. შეამოწმე ინტერნეტი.',
  denied: 'კამერაზე წვდომა აკრძალულია. დაუშვი ბრაუზერის პარამეტრებში.',
  nocam: 'კამერა ვერ მოიძებნა. გახსენი Chrome-ში ან Safari-ში.',
  busy: 'კამერა ვერ ჩაირთო. დახურე სხვა პროგრამა, რომელიც კამერას იყენებს.',
  insecure: 'კამერა მუშაობს მხოლოდ https ან localhost მისამართზე.',
};

const $ = (id) => document.getElementById(id);
const view = $('view'), gate = $('gate'), gateMsg = $('gate-msg'), gateMeter = $('gate-meter'), gateRetry = $('gate-retry');

const face = new FaceTracker($('cam'));
let unmount = null;
let token = 0;          // cancels a navigation that was overtaken by a newer one
let wake = null;

// Recording: only from its button, always shown while it runs, saved on this device.
const rec = new Recorder(face);
const recBtn = $('rec'), recTime = $('rec-time'), privacy = $('privacy');
let recTick = 0;

function showRec() {
  const on = rec.active;
  document.body.toggleAttribute('data-rec', on);
  recBtn.setAttribute('aria-pressed', String(on));
  recBtn.setAttribute('aria-label', on ? REC_LABEL.stop : REC_LABEL.start);
  privacy.textContent = on ? RECORDING : PRIVACY;
  const s = rec.seconds;
  recTime.textContent = on ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : '';
}
rec.onchange = () => {
  clearInterval(recTick);
  if (rec.active) recTick = setInterval(showRec, 500);
  showRec();
};
recBtn.addEventListener('click', () => {
  recBtn.blur();                                  // so Space stays the game's key
  if (rec.active) rec.stop(); else rec.start();
});

function route() {
  const id = location.hash.replace(/^#\/?/, '');
  return GAMES[id] ? id : '';
}

function showGate(kind, retry) {
  gate.hidden = false;
  gateMsg.textContent = MESSAGES[kind] || MESSAGES.busy;
  gateMeter.hidden = kind !== 'loading';
  gateRetry.hidden = !retry;
  gateRetry.onclick = retry || null;
}

face.onprogress = (p) => {
  const fill = `scaleX(${p.toFixed(3)})`;
  gateMeter.firstElementChild.style.transform = fill;
  const bar = document.querySelector('.menu-load');
  if (bar) {
    bar.firstElementChild.style.transform = fill;
    bar.classList.toggle('done', p >= 1);
  }
};

// The menu pictures use the games' own visuals: the face mesh colours, and
// the poster's network with one neuron missing.
const ART_FACE = `
  <svg viewBox="0 0 96 96" fill="none" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M48 8c19 0 30 14 30 36 0 24-13 44-30 44S18 68 18 44C18 22 29 8 48 8z" stroke="#ece8df" stroke-opacity=".7" stroke-width="1.5"/>
    <path d="M48 8v80M18 44h60M24 24l48 46M72 24L24 70M30 14l36 0M22 60l52 0" stroke="#ece8df" stroke-opacity=".18"/>
    <path d="M27 33c5-4 11-4 16-1M53 32c5-3 11-3 16 1" stroke="#e7c46b" stroke-width="2.5"/>
    <path d="M29 42c4-3 9-3 13 0-4 3-9 3-13 0zM54 42c4-3 9-3 13 0-4 3-9 3-13 0z" stroke="#6fb6ce" stroke-width="2"/>
    <path d="M34 66c9 7 19 7 28 0-9-3-19-3-28 0z" stroke="#d9776b" stroke-width="2"/>
  </svg>`;

function artNetwork() {
  const cols = [14, 48, 82], rows = [16, 48, 80];
  let wires = '', nodes = '';
  for (let c = 0; c < 2; c++) for (const y1 of rows) for (const y2 of rows) {
    const gold = (c === 0 && y2 === 48) || (c === 1 && y1 === 48);
    wires += `<path d="M${cols[c]} ${y1}L${cols[c + 1]} ${y2}" stroke="${gold ? '#e7c46b' : '#ece8df'}" stroke-opacity="${gold ? 0.9 : 0.25}"/>`;
  }
  for (const x of cols) for (const y of rows) {
    const you = x === 48 && y === 48;
    nodes += `<circle cx="${x}" cy="${y}" r="7" fill="${you ? '#e7c46b' : '#1a1d21'}" stroke="${you ? '#e7c46b' : '#ece8df'}" stroke-width="2"/>`;
  }
  return `<svg viewBox="0 0 96 96" fill="none" aria-hidden="true">${wires}${nodes}</svg>`;
}

let entered = false;      // the menu's entrance plays once a visit, not on every return

function showMenu() {
  view.innerHTML = `
    <nav class="menu${entered ? '' : ' enter'}">
      <a class="card" href="#/emoji">
        <span class="card-art">${ART_FACE}<span class="card-emoji"></span></span>
        <b>სახე → ემოჯი</b>
        <span>დაიმანჭე და ქსელი ემოჯის შეგირჩევს.</span>
      </a>
      <a class="card" href="#/brow">
        <span class="card-art">${artNetwork()}</span>
        <b>თვალებით ფრენა</b>
        <span>დაახამხამე და იფრინე.</span>
      </a>
      <p class="menu-note">ვიდეო არ იწერება და არსად იგზავნება.</p>
      <div class="meter menu-load${face.progress >= 1 ? ' done' : ''}"><i style="transform:scaleX(${face.progress.toFixed(3)})"></i></div>
    </nav>`;
  setEmoji(view.querySelector('.card-emoji'), '😉');
  entered = true;
}

async function go() {
  const id = route();
  const my = ++token;
  if (unmount) {
    try { unmount(); } catch (e) { console.error(e); }
    unmount = null;
  }
  rec.stop();                                     // a recording never runs on past its game
  recBtn.hidden = true;
  face.recOverlay = null;
  view.replaceChildren();
  gate.hidden = true;
  document.body.dataset.route = id || 'menu';
  $('title').textContent = id ? GAMES[id].title : CLUB;
  document.title = id ? `${GAMES[id].title} · ${CLUB}` : CLUB;
  if (!id) { showMenu(); releaseWake(); return; }

  const retry = () => { if (my === token) go(); };
  showGate('loading');
  let mod;
  try {
    [mod] = await Promise.all([GAMES[id].load(), face.load()]);
  } catch (e) {
    console.error(e);
    if (my === token) showGate('load', retry);
    return;
  }
  if (my !== token) return;
  showGate('camera');
  try {
    await face.startCamera();
  } catch (e) {
    console.error(e);
    if (my === token) showGate(e.code || 'busy', retry);
    return;
  }
  if (my !== token) return;
  gate.hidden = true;
  unmount = mod.mount(view, { face }) || null;
  recBtn.hidden = !Recorder.supported;
  keepAwake();
}

// Keep the screen on while a game is open: nobody touches it for minutes.
async function keepAwake() {
  if (wake || !navigator.wakeLock || document.visibilityState !== 'visible') return;
  try {
    wake = await navigator.wakeLock.request('screen');
    wake.addEventListener('release', () => { wake = null; });
  } catch (e) { /* low battery or not allowed */ }
}

function releaseWake() {
  if (wake) wake.release().catch(() => {});
  wake = null;
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') { rec.stop(); return; }   // save what there is before the camera goes
  if (!route() || !unmount) return;
  keepAwake();
  // Phones pause or close the camera in the background: bring it back.
  face.startCamera().catch(() => go());
});

face.onended = () => { if (route() && unmount) go(); };

addEventListener('hashchange', go);
addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement) return;
  if (e.code === 'Escape' && route()) location.hash = '#/';
  else if (e.code === 'KeyF' && !e.ctrlKey && !e.metaKey) {
    if (document.fullscreenElement) document.exitFullscreen();
    else if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => {});
  }
});

face.load().catch(() => {});   // start the download while the visitor reads the menu
go();

window.__app = { face, go, rec };   // for tests
