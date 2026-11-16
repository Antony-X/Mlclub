// A player for tests that can only do what a person can: it knows a layer
// once it is on screen, reacts late, and cannot raise its brows more than
// about three times a second. Used by test_world.mjs and by the browser tests.
import { P, gapCentre, playerX } from '../../app/games/brow-world.js';

export function createBot({ react = 0.12, every = 0.32 } = {}) {
  let last = -Infinity, hold = 0.5;
  // True when the bot decides to raise its brows now; the flap itself
  // should happen `react` seconds later.
  return function wantsRaise(w, aspect) {
    const right = w.x - playerX(aspect) + aspect;          // world x of the screen's right edge
    const next = w.layers.find((l) => !l.passed);
    if (next && next.x - P.NODE_R < right) hold = gapCentre(next);
    // where it will be when a raise decided now takes effect
    const y = w.y + w.vy * react + 0.5 * P.GRAVITY * react * react;
    if (y > hold + 0.05 && w.t - last >= every) {
      last = w.t;
      return true;
    }
    return false;
  };
}
