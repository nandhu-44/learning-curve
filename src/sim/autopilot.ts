import { type Car, VMAX } from './car';
import { type Track, wrapAngle } from './track';

const TAU = Math.PI * 2;
const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/**
 * A hand-written driver: steer at a point on the centreline ahead, brake for the tightest bend
 * within stopping distance. It stands in for a tidy human lap when testing and tuning.
 */
export function autopilot(t: Track, c: Car): { steer: number; throttle: number } {
  const n = t.n;
  let th = Math.atan2(c.y, c.x);
  if (th < 0) th += TAU;
  const i = Math.floor((th / TAU) * n) % n;

  let j = i;
  for (let ahead = 0, look = 8 + c.v * 0.45; ahead < look; ) {
    const k = (j + 1) % n;
    ahead += Math.hypot(t.x[k] - t.x[j], t.y[k] - t.y[j]);
    j = k;
  }
  const steer = clamp(wrapAngle(Math.atan2(t.y[j] - c.y, t.x[j] - c.x) - c.h) * 2.5, -1, 1);

  let target = VMAX;
  for (let k = i, dist = 0, horizon = 35 + (c.v * c.v) / 48; dist < horizon; ) {
    const m = (k + 3) % n;
    const ds = Math.hypot(t.x[m] - t.x[k], t.y[m] - t.y[k]);
    const bend = Math.abs(wrapAngle(Math.atan2(t.ty[m], t.tx[m]) - Math.atan2(t.ty[k], t.tx[k])));
    const corner = Math.sqrt(19 * (ds / Math.max(bend, 1e-4))); // speed the bend can be taken at
    target = Math.min(target, Math.sqrt(corner * corner + 2 * 24 * dist)); // and what that allows here
    dist += ds;
    k = m;
  }
  return { steer, throttle: clamp((target - c.v) * 0.6, -1, 1) };
}
