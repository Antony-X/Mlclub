// Camera + MediaPipe Face Landmarker, shared by both games.
// Everything is loaded from the local vendor/ folder: no network at run time.
import { FaceLandmarker, FilesetResolver } from '../vendor/mediapipe/vision_bundle.mjs';

export { FaceLandmarker };

const WASM_DIR = new URL('../vendor/mediapipe/wasm', import.meta.url).href;
const MODEL = new URL('../vendor/mediapipe/face_landmarker.task', import.meta.url).href;

// Signals that carry the expression itself; never baseline-corrected.
const NO_BASELINE = /^(mouthSmile|jawOpen|eyeBlink|mouthPucker|mouthFunnel|_)/;
const CALIB_FRAMES = 30;
const BASE_CAP = 0.35;

export class FaceTracker {
  constructor(video) {
    this.video = video;
    this.lm = null;
    this.still = null; // test mode: a still image instead of the camera
    this.lastT = -1;
    this.resetBaseline();
    this.fps = 0;
    this._lastDetect = 0;
  }

  resetBaseline() {
    this.base = null;
    this._calib = null;
    this._calibN = 0;
  }

  async init() {
    const q = new URLSearchParams(location.search);
    const fileset = await FilesetResolver.forVisionTasks(WASM_DIR);
    this.lm = await FaceLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL, delegate: q.get('gpu') === '1' ? 'GPU' : 'CPU' },
      runningMode: 'VIDEO',
      numFaces: 3,
      outputFaceBlendshapes: true,
    });
  }

  // Throws an Error with .code = 'nocam' | 'denied' | 'busy'.
  async startCamera() {
    const src = new URLSearchParams(location.search).get('src');
    if (src) {
      const img = new Image();
      img.src = src;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      c.getContext('2d').drawImage(img, 0, 0);
      this.still = c;
      return;
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw Object.assign(new Error('no camera api'), { code: 'nocam' });
    }
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 960 }, height: { ideal: 540 }, facingMode: 'user' },
        audio: false,
      });
    } catch (e) {
      const code =
        e.name === 'NotAllowedError' || e.name === 'SecurityError' ? 'denied'
        : e.name === 'NotFoundError' || e.name === 'OverconstrainedError' ? 'nocam'
        : 'busy';
      throw Object.assign(new Error(e.message), { code });
    }
    this.video.srcObject = stream;
    await this.video.play();
  }

  get source() { return this.still || this.video; }
  get width() { return this.still ? this.still.width : this.video.videoWidth; }
  get height() { return this.still ? this.still.height : this.video.videoHeight; }

  // Returns null when there is no new frame, otherwise
  // { found, landmarks, raw, bs, roll, calibrating }.
  detect(now) {
    if (!this.still) {
      if (this.video.readyState < 2 || this.video.currentTime === this.lastT) return null;
      this.lastT = this.video.currentTime;
    }
    const r = this.lm.detectForVideo(this.source, now);
    if (this._lastDetect) {
      const inst = 1000 / Math.max(1, now - this._lastDetect);
      this.fps = this.fps ? this.fps * 0.9 + inst * 0.1 : inst;
    }
    this._lastDetect = now;

    const faces = r.faceLandmarks || [];
    if (!faces.length || !r.faceBlendshapes || !r.faceBlendshapes.length) return { found: false };

    // Largest face wins.
    let best = 0, bestArea = -1;
    faces.forEach((pts, i) => {
      let x0 = 1, x1 = 0, y0 = 1, y1 = 0;
      for (const p of pts) {
        if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x;
        if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y;
      }
      const a = (x1 - x0) * (y1 - y0);
      if (a > bestArea) { bestArea = a; best = i; }
    });
    const landmarks = faces[best];
    const raw = {};
    for (const c of r.faceBlendshapes[best].categories) raw[c.categoryName] = c.score;

    // Per-person baseline: the minimum of each signal over the first second.
    if (!this.base) {
      if (!this._calib) this._calib = { ...raw };
      else for (const k in raw) this._calib[k] = Math.min(this._calib[k], raw[k]);
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

    // Head roll from the outer eye corners, in degrees.
    const a = landmarks[33], b = landmarks[263];
    const roll = Math.atan2((b.y - a.y) * this.height, (b.x - a.x) * this.width) * 180 / Math.PI;

    return { found: true, landmarks, raw, bs, roll, calibrating: !this.base };
  }
}

// Draws the mirrored camera frame and the landmark mesh.
export function drawFace(ctx, tracker, res, colors) {
  const w = ctx.canvas.width, h = ctx.canvas.height;
  ctx.save();
  ctx.translate(w, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(tracker.source, 0, 0, w, h);
  if (res && res.found && res.landmarks) {
    const pts = res.landmarks;
    const lines = (conns, style, width) => {
      ctx.strokeStyle = style;
      ctx.lineWidth = width;
      ctx.beginPath();
      for (const c of conns) {
        ctx.moveTo(pts[c.start].x * w, pts[c.start].y * h);
        ctx.lineTo(pts[c.end].x * w, pts[c.end].y * h);
      }
      ctx.stroke();
    };
    const s = Math.max(1, w / 640);
    lines(FaceLandmarker.FACE_LANDMARKS_TESSELATION, colors.mesh, 0.5 * s);
    lines(FaceLandmarker.FACE_LANDMARKS_FACE_OVAL, colors.oval, 1.2 * s);
    lines(FaceLandmarker.FACE_LANDMARKS_LIPS, colors.lips, 1.5 * s);
    lines(FaceLandmarker.FACE_LANDMARKS_LEFT_EYE, colors.eyes, 1.5 * s);
    lines(FaceLandmarker.FACE_LANDMARKS_RIGHT_EYE, colors.eyes, 1.5 * s);
    lines(FaceLandmarker.FACE_LANDMARKS_LEFT_EYEBROW, colors.brows, 1.8 * s);
    lines(FaceLandmarker.FACE_LANDMARKS_RIGHT_EYEBROW, colors.brows, 1.8 * s);
  }
  ctx.restore();
}

export const MESH_COLORS = {
  mesh: 'rgba(236,232,223,0.22)',
  oval: 'rgba(236,232,223,0.7)',
  lips: '#d9776b',
  eyes: '#6fb6ce',
  brows: '#e7c46b',
};

export const CAMERA_ERRORS = {
  nocam: 'კამერა ვერ მოიძებნა',
  denied: 'კამერაზე წვდომა აკრძალულია. დაუშვი ბრაუზერში და გადატვირთე გვერდი.',
  busy: 'კამერა ვერ ჩაირთო. დახურე სხვა პროგრამა, რომელიც კამერას იყენებს.',
  load: 'მოდელი ვერ ჩაიტვირთა',
};
