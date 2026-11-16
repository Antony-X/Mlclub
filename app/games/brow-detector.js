// Turns one noisy 0..1 face signal (a blendshape score) into events: one per
// blink, raise of the eyebrows or opening of the mouth, on the way up, for
// any person.
//
// People differ in their resting value and in how far they can move, and in
// fast play nobody relaxes fully, so there is no fixed level to cross. The
// detector looks at the lowest value of the last moments (the valley) and
// fires when the signal climbs a step above it; it re-arms when the signal
// drops a step below the peak that followed, or has stayed up there for a
// while (brows held high, eyes kept shut: nothing repeats, and a further
// climb counts again). The step is a fraction of this person's own movement,
// learned from the ones already seen.
//
// Everything is measured in time (ms), never in samples: the camera gives
// anything from 15 to 60 results a second.

const DEFAULTS = {
  range0: 0.30,       // assumed size of a movement before the first one is seen
  riseFrac: 0.30,     // fire this fraction of the range above the valley
  fallFrac: 0.30,     // re-arm this fraction of the range below the peak
  minRise: 0.07,      // never below: jitter of a resting face must not fire
  maxRise: 0.14,      // never above: a small movement after a big one still counts
  minFall: 0.06,
  maxFall: 0.14,
  smooth: 40,         // ms, low-pass on the raw signal
  window: 1500,       // ms, the climb has to happen within this; slower is drift
  hold: 500,          // ms at a steady high level: that level is the new rest
  back: 0,            // if set: re-arm only when this fraction of the movement is undone
  settle: 0,          // ms of rest after re-arming before the next event can fire
  refractory: 150,    // ms, shortest time between two events
  gap: 500,           // ms without samples: start again from the current value
  learn: [0.3, 0.1],  // how fast the range follows a bigger movement, and a smaller one
  minRange: 0.12,
  maxRange: 0.80,
};

// The three movements the game listens to. The numbers come from real faces
// run through the model (clips of people blinking and pulling faces).
//
// A blink is the game's control; brows and mouth also hop, so they only
// answer to a clear, deliberate movement.
//
// Eyebrows, the mean of the three "brow up" outputs: 0.00 to 0.05 at rest with
// a jitter under 0.01 on a clean picture, bursts of 0.1 on a dark, noisy one;
// a raise peaks anywhere from 0.23 (one person) to 0.93 (another).
export const BROW = {
  range0: 0.50, minRise: 0.12, maxRise: 0.20, minFall: 0.08, maxFall: 0.20, minRange: 0.30,
};
// A blink, the mean of the two "eye blink" outputs: open eyes sit at 0.13 to
// 0.25 (0.3 with a smile, 0.5 and more when looking far down), a blink jumps
// 0.3 or more within one or two camera frames and is over in 130 to 170 ms.
// So: no smoothing, and only a climb within 0.3 s counts, which a moving gaze
// or a growing smile is too slow for.
// One blink is one event, however hard or long it is squeezed: while the
// eyes are shut the signal flickers and bounces, so the next blink only counts
// once the eyes have opened again (most of the way back to where it started).
// A second of a steady high level (the gaze dropped and stayed) is a new rest.
export const BLINK = {
  range0: 0.45, riseFrac: 0.45, minRise: 0.12, maxRise: 0.25, minFall: 0.10,
  smooth: 0, window: 300, hold: 1000, back: 0.65, settle: 100, minRange: 0.20, maxRange: 0.90,
};
// The mouth: talking moves the jaw by 0.1 to 0.3, so it takes a clear opening.
export const JAW = {
  range0: 0.80, minRise: 0.25, maxRise: 0.30, minFall: 0.12, maxFall: 0.30,
  smooth: 60, minRange: 0.50,
};

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export class RaiseDetector {
  constructor(options) {
    this.o = { ...DEFAULTS, ...options };
    this.reset();
  }

  // Forget the person.
  reset() {
    this.ready = false;
    this.level = 0;        // smoothed signal
    this.valley = 0;       // lowest level within the window
    this.peak = 0;
    this.raised = false;   // between an event and its release
    this.range = this.o.range0;
    this.raises = 0;
    this._low = [];        // [time, level] candidates for the valley, rising in both
    this._from = 0;        // valley the current movement started from
    this._t = 0;
    this._firedAt = this._peakAt = this._armedAt = -Infinity;
  }

  // Start (or restart after a break) from a resting or current value.
  calibrate(value, now) {
    this.ready = true;
    this.level = this.valley = this.peak = value;
    this.raised = false;
    this._low = [[now, value]];
    this._t = now;
  }

  // Nothing fired for a while: assume a small movement until one is seen.
  soften() {
    if (!this.raises) this.range = this.o.minRange;
  }

  get rise() { return clamp(this.o.riseFrac * this.range, this.o.minRise, this.o.maxRise); }
  get fall() { return clamp(this.o.fallFrac * this.range, this.o.minFall, this.o.maxFall); }
  // The level the signal has to reach for the next event.
  get fireLevel() { return (this.raised ? this._from : this.valley) + this.rise; }

  // Feed one sample. Returns true exactly once per movement.
  update(value, now) {
    if (!this.ready) return false;
    const dt = now - this._t;
    if (dt <= 0) return false;
    if (dt > this.o.gap) {            // the face was away: do not compare across the hole
      this.calibrate(value, now);
      return false;
    }
    this._t = now;
    this.level += (value - this.level) * (1 - Math.exp(-dt / this.o.smooth));
    const v = this.level;

    if (!this.raised) {
      // the valley: the lowest level of the last `window` ms
      const low = this._low;
      while (low.length > 1 && low[0][0] < now - this.o.window) low.shift();
      this.valley = Math.min(low[0][1], v);
      if (v - this.valley >= this.rise && now - this._firedAt >= this.o.refractory && now - this._armedAt >= this.o.settle) {
        this.raised = true;
        this._from = this.valley;
        this.peak = v;
        this._firedAt = this._peakAt = now;
        return true;
      }
      while (low.length && low[low.length - 1][1] >= v) low.pop();
      low.push([now, v]);
    } else {
      if (v > this.peak) {
        this.peak = v;
        this._peakAt = now;
      }
      // A small movement is over once most of it is undone: it must not hide a big one that follows.
      const size = this.peak - this._from;
      const drop = this.o.back ? this.o.back * size : Math.min(this.fall, 0.6 * size);
      const undone = this.peak - v >= Math.max(this.o.minFall, drop);
      if (undone || now - this._peakAt >= this.o.hold) {
        const rate = this.o.learn[size > this.range ? 0 : 1];
        const next = this.raises ? this.range + (size - this.range) * rate : size;
        this.range = clamp(next, this.o.minRange, this.o.maxRange);
        this.raises++;
        this.raised = false;
        this.valley = v;
        this._low = [[now, v]];
        this._armedAt = now;
      }
    }
    return false;
  }
}

export const median = (values) => {
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : 0;
};
