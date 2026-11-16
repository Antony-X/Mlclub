// Hears blinks in the model's "eye blink" number (0 eyes open .. 1 shut):
// one event per blink, as the lids close, for any person.
//
// People differ in how open their eyes rest and how far the number moves, so
// there is no fixed level to cross. The detector looks at the lowest value of
// the last moments (the valley) and fires when the signal climbs a step above
// it. The step is a fraction of this person's own blink, learned from the
// blinks already seen.
//
// One blink is one event, however hard or long it is squeezed: while the eyes
// are shut the signal flickers and bounces, so the next blink only counts
// once the eyes have opened again.
//
// Everything is measured in time (ms), never in samples: the camera gives
// anything from 15 to 60 results a second.
//
// The numbers come from real faces run through the model: open eyes sit at
// 0.13 to 0.25 (0.3 with a smile, 0.5 and more when looking far down); a
// blink jumps 0.3 or more within one or two camera frames and is over in 130
// to 170 ms, a deliberate one in 200 to 500.

const DEFAULTS = {
  range0: 0.45,       // assumed size of a blink before the first one is seen
  riseFrac: 0.45,     // fire this fraction of the range above the valley,
  minRise: 0.12,      // but never below this: the jitter of open eyes must not fire,
  maxRise: 0.25,      // nor above this: a light blink after a hard one still counts
  window: 300,        // ms, the climb has to happen within this: a moving gaze or a growing smile is slower
  back: 0.65,         // the eyes have opened again when this much of the blink is undone
  minBack: 0.10,
  settle: 100,        // ms of open eyes before the next blink can fire
  hold: 1000,         // ms at a steady high level (the gaze dropped and stayed): that level is the new rest
  refractory: 150,    // ms, shortest time between two blinks
  gap: 500,           // ms without samples: start again from the current value
  learn: [0.3, 0.1],  // how fast the range follows a bigger blink, and a smaller one
  minRange: 0.20,
  maxRange: 0.90,
};

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export class BlinkDetector {
  constructor(options) {
    this.o = { ...DEFAULTS, ...options };
    this.reset();
  }

  // Forget the person.
  reset() {
    this.ready = false;
    this.valley = 0;       // lowest value within the window
    this.peak = 0;
    this.shut = false;     // between a blink and the eyes opening again
    this.range = this.o.range0;
    this.blinks = 0;
    this._low = [];        // [time, value] candidates for the valley, rising in both
    this._from = 0;        // valley the current blink started from
    this._t = 0;
    this._firedAt = this._peakAt = this._openAt = -Infinity;
  }

  // Start (or restart after a break) from a resting or current value.
  calibrate(value, now) {
    this.ready = true;
    this.valley = this.peak = value;
    this.shut = false;
    this._low = [[now, value]];
    this._t = now;
  }

  // No blink was heard for a while: assume this person's are small until one is.
  soften() {
    if (!this.blinks) this.range = this.o.minRange;
  }

  get rise() { return clamp(this.o.riseFrac * this.range, this.o.minRise, this.o.maxRise); }
  // The value the signal has to reach for the next blink.
  get fireLevel() { return (this.shut ? this._from : this.valley) + this.rise; }

  // Feed one sample. Returns true exactly once per blink.
  update(v, now) {
    if (!this.ready) return false;
    const dt = now - this._t;
    if (dt <= 0) return false;
    if (dt > this.o.gap) {            // the face was away: do not compare across the hole
      this.calibrate(v, now);
      return false;
    }
    this._t = now;

    if (!this.shut) {
      // the valley: the lowest value of the last `window` ms
      const low = this._low;
      while (low.length > 1 && low[0][0] < now - this.o.window) low.shift();
      this.valley = Math.min(low[0][1], v);
      if (v - this.valley >= this.rise && now - this._firedAt >= this.o.refractory && now - this._openAt >= this.o.settle) {
        this.shut = true;
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
      const size = this.peak - this._from;
      const open = this.peak - v >= Math.max(this.o.minBack, this.o.back * size);
      if (open || now - this._peakAt >= this.o.hold) {
        const rate = this.o.learn[size > this.range ? 0 : 1];
        const next = this.blinks ? this.range + (size - this.range) * rate : size;
        this.range = clamp(next, this.o.minRange, this.o.maxRange);
        this.blinks++;
        this.shut = false;
        this.valley = v;
        this._low = [[now, v]];
        this._openAt = now;
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
