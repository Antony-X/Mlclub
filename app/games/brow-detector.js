// Turns one noisy 0..1 face signal (a blendshape score) into "raise" events:
// one event per raise, on the way up, for any person.
//
// People differ in their resting value and in how far they can move, and in
// fast play nobody relaxes fully, so there is no fixed level to cross. The
// detector follows the last valley of the signal and fires when the signal
// climbs a step above it; it re-arms when the signal drops a step below the
// peak that followed. The step is a fraction of this person's own raise,
// learned from the raises already seen.
//
// Everything is measured in time (ms), never in samples: the camera gives
// anything from 15 to 60 results a second.
//
// The numbers come from real faces run through the model (the mean of its
// three "brow up" outputs): at rest 0.00 to 0.05 with a jitter under 0.01; a
// raise peaks anywhere from 0.23 (one person) to 0.93 (another), and at 0.10
// to 0.17 for a one-sided or half-hearted one. So the step is 0.07 at the
// least, clear of the jitter, and 0.14 at the most, well inside a big raise.

const DEFAULTS = {
  range0: 0.30,       // assumed size of a raise before the first one is seen
  riseFrac: 0.30,     // fire this fraction of the range above the valley
  fallFrac: 0.30,     // re-arm this fraction of the range below the peak
  minRise: 0.07,      // never below: jitter of a resting face must not fire
  maxRise: 0.14,      // never above: a small raise after a big one still counts
  minFall: 0.06,
  maxFall: 0.14,
  smooth: 40,         // ms, low-pass on the raw signal
  creep: 1500,        // ms, how fast the valley follows a drifting resting level
  refractory: 150,    // ms, shortest time between two raises
  gap: 500,           // ms without samples: start again from the current value
  learn: 0.3,         // how fast the range follows new raises
  minRange: 0.12,
  maxRange: 0.80,
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
    this.valley = 0;
    this.peak = 0;
    this.raised = false;   // between a raise and its release
    this.range = this.o.range0;
    this.raises = 0;
    this._from = 0;        // valley the current raise started from
    this._t = 0;
    this._firedAt = -Infinity;
  }

  // Start (or restart after a break) from a resting or current value.
  calibrate(value, now) {
    this.ready = true;
    this.level = this.valley = this.peak = value;
    this.raised = false;
    this._t = now;
  }

  // Nothing fired for a while: assume a small raise until one is seen.
  soften() {
    if (!this.raises) this.range = this.o.minRange;
  }

  get rise() { return clamp(this.o.riseFrac * this.range, this.o.minRise, this.o.maxRise); }
  get fall() { return clamp(this.o.fallFrac * this.range, this.o.minFall, this.o.maxFall); }
  // The level the signal has to reach for the next raise.
  get fireLevel() { return (this.raised ? this._from : this.valley) + this.rise; }

  // Feed one sample. Returns true exactly once per raise.
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
      if (v < this.valley) this.valley = v;
      else this.valley += (v - this.valley) * (1 - Math.exp(-dt / this.o.creep));
      if (v - this.valley >= this.rise && now - this._firedAt >= this.o.refractory) {
        this.raised = true;
        this._from = this.valley;
        this.peak = v;
        this._firedAt = now;
        return true;
      }
    } else {
      if (v > this.peak) this.peak = v;
      if (this.peak - v >= this.fall) {
        const size = this.peak - this._from;
        const next = this.raises ? this.range + (size - this.range) * this.o.learn : size;
        this.range = clamp(next, this.o.minRange, this.o.maxRange);
        this.raises++;
        this.raised = false;
        this.valley = v;
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
