// Shared by both games: loads the face model, runs the camera, and draws the
// camera picture with the landmark mesh. Everything comes from vendor/, so the
// page works with no internet once it has loaded.
import { FaceLandmarker, FilesetResolver } from '../vendor/mediapipe/vision_bundle.mjs';

const VENDOR = new URL('../vendor/mediapipe/', import.meta.url);
const BYTES = { simd: 9423986, nosimd: 9294247, model: 3758596 };
const PARAMS = new URLSearchParams(location.search);
const FORCED = { cpu: 'CPU', gpu: 'GPU' }[PARAMS.get('delegate')] || null;

export const IS_TOUCH = matchMedia('(pointer: coarse)').matches;

// Signals that are the expression itself; never baseline-corrected.
const NO_BASELINE = /^(mouthSmile|jawOpen|eyeBlink|mouthPucker|mouthFunnel|_)/;
const CALIB_FRAMES = 30;      // about one second of face
const BASE_CAP = 0.35;        // a baseline never eats more than this
const NEW_FACE_MS = 2500;     // face gone this long = next face is a new person

// Delegate tuning: time the first one, try the other only if it is slow.
const WARMUP = 3, SAMPLES = 20, BUDGET_MS = 450, FAST_ENOUGH_MS = 22, MUCH_BETTER = 0.85;

async function fetchBytes(url, onBytes) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  if (!r.body) {
    const all = new Uint8Array(await r.arrayBuffer());
    onBytes(all.length);
    return all;
  }
  const reader = r.body.getReader();
  const chunks = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    n += value.length;
    onBytes(value.length);
  }
  const all = new Uint8Array(n);
  let o = 0;
  for (const c of chunks) { all.set(c, o); o += c.length; }
  return all;
}

// A real graphics chip is worth trying; a software renderer is always slower
// than the CPU path, so it is skipped.
function hasRealGPU() {
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (!gl) return false;
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    const name = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
    const lose = gl.getExtension('WEBGL_lose_context');
    if (lose) lose.loseContext();                         // this context was only for asking
    return PARAMS.get('gl') === 'any' || !/swiftshader|llvmpipe|software|basic render/i.test(name);   // gl=any: tests
  } catch (e) { return false; }
}

function cameraError(code, cause) {
  return Object.assign(new Error(cause ? cause.message : code), { code });
}

export class FaceTracker {
  constructor(video) {
    this.video = video;
    this.progress = 0;          // model download, 0..1
    this.onprogress = null;
    this.onended = null;        // the camera stopped on its own
    this.delegate = null;       // 'GPU' | 'CPU'
    this.ms = 0;                // smoothed time of one detection
    this.fps = 0;               // smoothed detections per second
    this._lm = null;
    this._alt = null;           // spare landmarker on the other delegate
    this._still = null;
    this._ts = 0;
    this._tune = { phase: FORCED ? 'done' : 'first', n: 0, sum: 0, firstAvg: 0, skip: WARMUP };
    this._proven = false;       // the current delegate has seen a face
    this._blind = 0;            // detections without a face on an unproven GPU
    this._busy = false;
    this._lostAt = 0;
    this.resetBaseline();
  }

  // ---------- model ----------

  load() {
    if (!this._loading) {
      this._loading = this._load().catch((e) => { this._loading = null; throw e; });
    }
    return this._loading;
  }

  async _load() {
    const simd = await FilesetResolver.isSimdSupported();
    const name = simd ? 'vision_wasm_internal' : 'vision_wasm_nosimd_internal';
    const total = (simd ? BYTES.simd : BYTES.nosimd) + BYTES.model;
    let got = 0;
    const tick = (n) => { got += n; this._progress(Math.min(0.96, got / total)); };
    const [wasm, model] = await Promise.all([
      fetchBytes(new URL(`wasm/${name}.wasm`, VENDOR), tick),
      fetchBytes(new URL('face_landmarker.task', VENDOR), tick),
    ]);
    this._fileset = {
      wasmLoaderPath: new URL(`wasm/${name}.js`, VENDOR).href,
      wasmBinaryPath: URL.createObjectURL(new Blob([wasm], { type: 'application/wasm' })),
    };
    this._model = model;
    this._gpuOk = hasRealGPU();
    const first = FORCED || (this._gpuOk ? 'GPU' : 'CPU');
    try {
      this._lm = await this._create(first);
      this.delegate = first;
    } catch (e) {
      if (first !== 'GPU' || FORCED) throw e;
      this._gpuOk = false;
      this._lm = await this._create('CPU');
      this.delegate = 'CPU';
    }
    if (!this._gpuOk && !FORCED) this._tune.phase = 'done';
    this._progress(1);
  }

  _progress(p) {
    this.progress = p;
    if (this.onprogress) this.onprogress(p);
  }

  _create(delegate) {
    return FaceLandmarker.createFromOptions(this._fileset, {
      baseOptions: { modelAssetBuffer: this._model, delegate },
      runningMode: 'VIDEO',
      numFaces: IS_TOUCH ? 2 : 3,
      outputFaceBlendshapes: true,
      outputFacialTransformationMatrixes: true,
    });
  }

  // ---------- camera ----------

  // Safe to call again at any time: resumes or reopens the camera if needed.
  // Rejects with an Error whose .code is 'denied' | 'nocam' | 'busy' | 'insecure'.
  startCamera() {
    if (!this._starting) {
      this._starting = this._startCamera().finally(() => { this._starting = null; });
    }
    return this._starting;
  }

  get cameraLive() {
    if (this._still) return true;
    const v = this.video;
    if (v.paused || v.videoWidth === 0) return false;
    if (!this._stream) return !!v.currentSrc;
    const t = this._stream.getVideoTracks()[0];
    return !!t && t.readyState === 'live';
  }

  async _startCamera() {
    if (this.cameraLive) return;
    const v = this.video;
    const src = PARAMS.get('src');                 // test hook: a picture or a video file
    if (src) {
      if (/\.(webm|mp4|ogv)$/i.test(src)) {
        v.src = src;
        v.loop = true;
        await v.play();
        this._watchFrames();
      } else {
        const img = new Image();
        img.src = src;
        await img.decode();
        const c = document.createElement('canvas');
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        c.getContext('2d').drawImage(img, 0, 0);
        this._still = c;
      }
      return;
    }
    const track = this._stream && this._stream.getVideoTracks()[0];
    if (!track || track.readyState !== 'live') {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw cameraError(window.isSecureContext ? 'nocam' : 'insecure');
      }
      try {
        this._stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: 'user',
            width: { ideal: IS_TOUCH ? 640 : 1280 },
            height: { ideal: IS_TOUCH ? 480 : 720 },
            frameRate: { ideal: 30 },
          },
        });
      } catch (e) {
        const code =
          e.name === 'NotAllowedError' || e.name === 'SecurityError' ? 'denied'
          : e.name === 'NotFoundError' || e.name === 'OverconstrainedError' ? 'nocam'
          : 'busy';
        throw cameraError(code, e);
      }
      this._stream.getVideoTracks()[0].addEventListener('ended', () => {
        if (this.onended) this.onended();           // unplugged, or taken by the system
      });
      v.srcObject = this._stream;
    }
    try {
      await v.play();
    } catch (e) {
      throw cameraError('busy', e);
    }
    if (!v.videoWidth) {
      await new Promise((res) => v.addEventListener('loadeddata', res, { once: true }));
    }
    this._watchFrames();
  }

  // Detect once per camera frame, not once per screen frame.
  _watchFrames() {
    const v = this.video;
    if (this._watching || !v.requestVideoFrameCallback) return;
    this._watching = true;
    const cb = () => { this._fresh = true; v.requestVideoFrameCallback(cb); };
    v.requestVideoFrameCallback(cb);
  }

  get source() { return this._still || this.video; }
  get width() { return this._still ? this._still.width : this.video.videoWidth; }
  get height() { return this._still ? this._still.height : this.video.videoHeight; }

  // ---------- detection ----------

  resetBaseline() {
    this.base = null;
    this._calib = null;
    this._calibN = 0;
  }

  // Call once per animation frame. Returns null when there is nothing new,
  // { found: false } when no face is visible, otherwise
  // { found: true, landmarks, raw, bs, roll, matrix, box, calibrating }.
  detect(now) {
    if (!this._lm || !this.width) return null;
    if (this._still || !this._watching) {
      if (now - (this._lastAt || 0) < 30) return null;
    } else {
      if (!this._fresh || this.video.paused) return null;
      this._fresh = false;
    }
    let r;
    const t0 = performance.now();
    try {
      r = this._lm.detectForVideo(this.source, this._stamp(now));
    } catch (e) {
      this._detectFailed(e);
      return null;
    }
    const took = performance.now() - t0;
    this.ms = this.ms ? this.ms * 0.9 + took * 0.1 : took;
    if (this._lastAt) {
      const inst = 1000 / Math.max(1, now - this._lastAt);
      this.fps = this.fps ? this.fps * 0.9 + inst * 0.1 : inst;
    }
    this._lastAt = now;

    const faces = r.faceLandmarks || [];
    const found = faces.length > 0 && !!r.faceBlendshapes && r.faceBlendshapes.length > 0;
    this._tuneStep(found, took);
    if (!found) {
      if (!this._lostAt) this._lostAt = now;
      return { found: false };
    }
    if (this._lostAt && now - this._lostAt > NEW_FACE_MS) this.resetBaseline();
    this._lostAt = 0;

    // The largest face wins.
    let best = 0, bestArea = -1, box = null;
    for (let i = 0; i < faces.length; i++) {
      let x0 = 1, x1 = 0, y0 = 1, y1 = 0;
      for (const p of faces[i]) {
        if (p.x < x0) x0 = p.x;
        if (p.x > x1) x1 = p.x;
        if (p.y < y0) y0 = p.y;
        if (p.y > y1) y1 = p.y;
      }
      const area = (x1 - x0) * (y1 - y0);
      if (area > bestArea) { bestArea = area; best = i; box = { x0, y0, x1, y1 }; }
    }
    const landmarks = faces[best];
    const raw = {};
    for (const c of r.faceBlendshapes[best].categories) raw[c.categoryName] = c.score;

    // Per-person baseline: the lowest value of each signal in the first second.
    if (!this.base) {
      if (!this._calib) this._calib = { ...raw };
      else for (const k in raw) if (raw[k] < this._calib[k]) this._calib[k] = raw[k];
      if (++this._calibN >= CALIB_FRAMES) {
        this.base = {};
        for (const k in this._calib) {
          this.base[k] = NO_BASELINE.test(k) ? 0 : Math.min(this._calib[k], BASE_CAP);
        }
      }
    }
    const bs = {};
    for (const k in raw) {
      const b = this.base ? this.base[k] || 0 : 0;
      bs[k] = Math.max(0, (raw[k] - b) / (1 - b));
    }

    // Head roll in degrees, from the outer eye corners (in picture pixels).
    const a = landmarks[33], b = landmarks[263];
    const roll = Math.atan2((b.y - a.y) * this.height, (b.x - a.x) * this.width) * 180 / Math.PI;
    const m = r.facialTransformationMatrixes && r.facialTransformationMatrixes[best];

    return { found: true, landmarks, raw, bs, roll, matrix: m ? m.data : null, box, calibrating: !this.base };
  }

  _stamp(now) {
    this._ts = Math.max(now, this._ts + 1);
    return this._ts;
  }

  // ---------- choosing GPU or CPU ----------
  // The GPU is tried first. It is replaced by the CPU if it turns out blind
  // (some phones return nothing), broken, or simply slower.

  _tuneStep(found, took) {
    const t = this._tune;
    if (found) this._proven = true;
    if (t.phase === 'done' || this._busy) return;

    if (!found) {
      if (this.delegate === 'GPU' && !this._proven) {
        this._blind++;
        if (this._blind === 45 || this._blind % 300 === 0) this._secondOpinion();
      }
      return;
    }
    if (t.skip > 0) { t.skip--; return; }
    t.n++;
    t.sum += took;
    if (t.n < SAMPLES && t.sum < BUDGET_MS) return;
    const avg = t.sum / t.n;

    if (t.phase === 'first') {
      const other = this.delegate === 'GPU' ? 'CPU' : 'GPU';
      if (avg <= FAST_ENOUGH_MS || (other === 'GPU' && !this._gpuOk)) return this._settle();
      t.firstAvg = avg;
      this._withAlt(other, () => {
        this._swap();
        t.phase = 'second';
        t.n = 0;
        t.sum = 0;
        t.skip = WARMUP;
      }, () => this._settle());
    } else {
      if (avg > t.firstAvg * MUCH_BETTER) this._swap();   // not clearly better: go back
      this._settle();
    }
  }

  _settle() {
    this._tune.phase = 'done';
    if (this._alt) {
      try { this._alt.lm.close(); } catch (e) { /* already gone */ }
      this._alt = null;
    }
  }

  _swap() {
    const cur = { lm: this._lm, delegate: this.delegate };
    this._lm = this._alt.lm;
    this.delegate = this._alt.delegate;
    this._alt = cur;
    this.ms = 0;
  }

  // Makes sure a landmarker on `delegate` exists as the spare, then calls ok().
  _withAlt(delegate, ok, fail) {
    if (this._alt && this._alt.delegate === delegate) return ok();
    this._busy = true;
    this._create(delegate).then((lm) => {
      this._alt = { lm, delegate };
      this._busy = false;
      ok();
    }, () => {
      this._busy = false;
      if (delegate === 'GPU') this._gpuOk = false;
      fail();
    });
  }

  _secondOpinion() {
    this._withAlt('CPU', () => {
      let r;
      try { r = this._alt.lm.detectForVideo(this.source, this._stamp(performance.now())); } catch (e) { return; }
      if (r.faceLandmarks && r.faceLandmarks.length) {   // the CPU sees a face the GPU missed
        this._swap();
        this._settle();
      }
    }, () => {});
  }

  _detectFailed(e) {
    console.error(e);
    if (this.delegate === 'GPU' && !FORCED && !this._busy) {
      this._gpuOk = false;
      this._withAlt('CPU', () => { this._swap(); this._settle(); }, () => {});
    }
  }
}

// ---------------------------------------------------------------------------
// Draws the mirrored camera picture and the landmark mesh into a canvas.
// The canvas takes its size from CSS (give it width/height 100% of a sized box).

export const MESH_COLORS = {
  mesh: 'rgba(236,232,223,0.20)',
  oval: 'rgba(236,232,223,0.65)',
  lips: '#d9776b',
  eyes: '#6fb6ce',
  brows: '#e7c46b',
};

export class FaceView {
  constructor(canvas, face, opts = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.face = face;
    this.fit = opts.fit || 'cover';        // 'cover' fills the box, 'contain' shows everything
    this.mesh = opts.mesh !== false;
    this.colors = { ...MESH_COLORS, ...opts.colors };
    this.w = 0;
    this.h = 0;
    this._ro = new ResizeObserver(() => this._resize());
    this._ro.observe(canvas);
    this._resize();
  }

  destroy() { this._ro.disconnect(); }

  _resize() {
    const r = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = r.width;
    this.h = r.height;
    const pw = Math.max(1, Math.round(r.width * this.dpr));
    const ph = Math.max(1, Math.round(r.height * this.dpr));
    if (this.canvas.width !== pw) this.canvas.width = pw;
    if (this.canvas.height !== ph) this.canvas.height = ph;
  }

  _layout() {
    const sw = this.face.width, sh = this.face.height;
    if (!sw || !this.w) return null;
    const s = this.fit === 'cover' ? Math.max(this.w / sw, this.h / sh) : Math.min(this.w / sw, this.h / sh);
    return { s, sw, sh, ox: (this.w - sw * s) / 2, oy: (this.h - sh * s) / 2 };
  }

  // A landmark (x, y in 0..1 of the camera picture) -> CSS pixels inside the canvas.
  project(p) {
    const f = this._layout();
    if (!f) return { x: 0, y: 0 };
    return { x: f.ox + (1 - p.x) * f.sw * f.s, y: f.oy + p.y * f.sh * f.s };
  }

  draw(res) {
    const { ctx } = this;
    const f = this._layout();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);
    if (!f) return;
    ctx.save();
    ctx.translate(f.ox + f.sw * f.s, f.oy);
    ctx.scale(-f.s, f.s);
    ctx.drawImage(this.face.source, 0, 0, f.sw, f.sh);
    if (this.mesh && res && res.found && res.landmarks) {
      const pts = res.landmarks, c = this.colors;
      const px = 1 / f.s;                                  // one CSS pixel
      const lines = (conns, style, width) => {
        ctx.strokeStyle = style;
        ctx.lineWidth = width * px;
        ctx.beginPath();
        for (const k of conns) {
          ctx.moveTo(pts[k.start].x * f.sw, pts[k.start].y * f.sh);
          ctx.lineTo(pts[k.end].x * f.sw, pts[k.end].y * f.sh);
        }
        ctx.stroke();
      };
      ctx.lineCap = 'round';
      lines(FaceLandmarker.FACE_LANDMARKS_TESSELATION, c.mesh, 0.6);
      lines(FaceLandmarker.FACE_LANDMARKS_FACE_OVAL, c.oval, 1.2);
      lines(FaceLandmarker.FACE_LANDMARKS_LIPS, c.lips, 1.6);
      lines(FaceLandmarker.FACE_LANDMARKS_LEFT_EYE, c.eyes, 1.6);
      lines(FaceLandmarker.FACE_LANDMARKS_RIGHT_EYE, c.eyes, 1.6);
      lines(FaceLandmarker.FACE_LANDMARKS_LEFT_EYEBROW, c.brows, 2);
      lines(FaceLandmarker.FACE_LANDMARKS_RIGHT_EYEBROW, c.brows, 2);
    }
    ctx.restore();
  }
}

// ---------------------------------------------------------------------------
// Small helpers for the games.

export function haptic(pattern) {
  try { if (navigator.vibrate) navigator.vibrate(pattern); } catch (e) { /* not allowed */ }
}

export const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(`mlclub.${key}`);
      return v == null ? fallback : JSON.parse(v);
    } catch (e) { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(`mlclub.${key}`, JSON.stringify(value)); } catch (e) { /* private mode */ }
  },
};
