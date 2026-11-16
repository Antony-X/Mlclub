// Records what the camera sees, mirrored as on screen, into a video file that
// is saved on this device when the recording stops. Nothing is uploaded.
// It only ever starts from the record button, and the page shows that it runs.

// MP4 opens everywhere; WebM is the fallback where the browser cannot write MP4.
const TYPES = ['video/mp4;codecs=avc1.42E01E', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
const MAX_WIDTH = 1280;
const LIMIT_MS = 10 * 60 * 1000;      // a recording is kept in memory until it is saved

const pad = (n) => String(n).padStart(2, '0');

export class Recorder {
  constructor(face) {
    this.face = face;
    this.active = false;
    this.startedAt = 0;
    this.onchange = null;       // called when recording starts or stops
    this.onsaved = null;        // called with (blob, name) after a file was handed to the browser
    this._type = Recorder.supported ? TYPES.find((t) => MediaRecorder.isTypeSupported(t)) || '' : '';
  }

  static get supported() {
    return typeof MediaRecorder !== 'undefined' && typeof HTMLCanvasElement.prototype.captureStream === 'function';
  }

  get seconds() { return this.active ? Math.floor((performance.now() - this.startedAt) / 1000) : 0; }

  start() {
    const { face } = this;
    if (this.active || !Recorder.supported || !face.width) return false;
    const scale = Math.min(1, MAX_WIDTH / face.width);
    const w = Math.round(face.width * scale / 2) * 2, h = Math.round(face.height * scale / 2) * 2;   // encoders want even sizes
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.className = 'cam-src';                 // in the page but unseen: some browsers record nothing otherwise
    document.body.append(canvas);
    const ctx = canvas.getContext('2d');
    let rec;
    try {
      rec = new MediaRecorder(canvas.captureStream(30), {
        ...(this._type ? { mimeType: this._type } : {}),
        videoBitsPerSecond: w >= 1000 ? 3000000 : 1500000,
      });
    } catch (e) {
      console.error(e);
      canvas.remove();
      return false;
    }
    const chunks = [];
    rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    rec.onstop = () => {
      canvas.remove();
      if (!chunks.length) return;
      const type = rec.mimeType || this._type || 'video/webm';
      const d = new Date();
      const name = `mlclub-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.${/mp4/.test(type) ? 'mp4' : 'webm'}`;
      const blob = new Blob(chunks, { type: type.split(';')[0] });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 60000);
      if (this.onsaved) this.onsaved(blob, name);
    };

    const draw = () => {
      if (!this.active) return;
      this._raf = requestAnimationFrame(draw);
      ctx.save();
      ctx.translate(w, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(face.source, 0, 0, w, h);
      ctx.restore();
      if (face.recOverlay) {                       // a game may draw on the recording (its emoji, its score)
        try { face.recOverlay(ctx, w, h); } catch (e) { /* the picture matters more */ }
      }
      if (performance.now() - this.startedAt >= LIMIT_MS) this.stop();
    };

    this._rec = rec;
    this.active = true;
    this.startedAt = performance.now();
    draw();
    rec.start(1000);
    if (this.onchange) this.onchange();
    return true;
  }

  stop() {
    if (!this.active) return;
    this.active = false;
    cancelAnimationFrame(this._raf);
    try { this._rec.stop(); } catch (e) { /* never started */ }
    this._rec = null;
    if (this.onchange) this.onchange();
  }
}
