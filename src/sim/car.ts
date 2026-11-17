import { centerDist, type Track, wrapAngle } from './track';

/** Fixed simulation step. Training and the race you watch use the same one, so a brain replays exactly. */
export const DT = 1 / 60;
export const VMAX = 46; // m/s
export const T_MAX = 60; // seconds allowed for one lap
const TAU = Math.PI * 2;
const ACCEL = 16;
const BRAKE = 32;
const DRAG = 0.1;
const GRIP = 24; // lateral acceleration the tyres can hold, m/s²
const YAW_MAX = 2.4; // rad/s at parking speed
const STEER_SPEED = 7; // how fast the wheel can move, full lock per 1/7 s
const SCRUB = 0.22; // speed lost to cornering
const MARGIN = 1.1; // the car's half width: this close to the edge is contact
const STALL = 2.5; // seconds without progress before a learner is retired

export interface Car {
  x: number;
  y: number;
  /** Heading in radians, counter-clockwise from +x. */
  h: number;
  v: number;
  /** Top speed this car is allowed; learners earn theirs gradually (see evolve.ts). */
  vmax: number;
  steer: number;
  /** Angle covered round the lap; 2π is the finish line. */
  prog: number;
  time: number;
  alive: boolean;
  finished: boolean;
  lapTime: number;
  best: number;
  idle: number;
  /** 1 while scraping a wall (forgiving cars only), for sound and effects. */
  scrape: number;
}

export function spawn(t: Track, vmax: number = VMAX): Car {
  return { x: t.start.x, y: t.start.y, h: t.start.h, v: 0, vmax, steer: 0, prog: 0, time: 0, alive: true, finished: false, lapTime: 0, best: 0, idle: 0, scrape: 0 };
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/**
 * Advance one car by DT. `steer` is +1 for full left, `throttle` is +1 flat out and -1 full brake.
 * A learner that touches a wall is out; a `forgiving` car (the human) scrapes along it and loses speed.
 */
export function step(c: Car, t: Track, steer: number, throttle: number, forgiving: boolean): void {
  if (!c.alive || c.finished) return;
  steer = clamp(steer, -1, 1);
  throttle = clamp(throttle, -1, 1);
  c.steer += clamp(steer - c.steer, -STEER_SPEED * DT, STEER_SPEED * DT);
  const push = throttle > 0 ? ACCEL * throttle * (1 - (c.v / c.vmax) ** 2) : BRAKE * throttle;
  c.v = Math.max(0, c.v + (push - DRAG * c.v - SCRUB * Math.abs(c.steer) * c.v) * DT);
  // Grip sets the tightest line: the faster the car, the wider it has to turn.
  c.h += c.steer * Math.min(YAW_MAX, GRIP / Math.max(c.v, 1)) * DT;
  const before = Math.atan2(c.y, c.x);
  c.x += Math.cos(c.h) * c.v * DT;
  c.y += Math.sin(c.h) * c.v * DT;
  const moved = wrapAngle(Math.atan2(c.y, c.x) - before);
  c.prog += moved;
  c.time += DT;
  c.scrape = 0;

  const d = centerDist(t, c.x, c.y), limit = t.halfWidth - MARGIN;
  if (d > limit) {
    if (!forgiving) { c.alive = false; return; }
    const e = 0.6;
    let gx = centerDist(t, c.x + e, c.y) - centerDist(t, c.x - e, c.y);
    let gy = centerDist(t, c.x, c.y + e) - centerDist(t, c.x, c.y - e);
    const gl = Math.hypot(gx, gy) || 1;
    gx /= gl; gy /= gl;
    c.x -= gx * (d - limit);
    c.y -= gy * (d - limit);
    const hx = Math.cos(c.h), hy = Math.sin(c.h), into = hx * gx + hy * gy;
    if (into > 0) c.h += clamp(wrapAngle(Math.atan2(hy - into * gy, hx - into * gx) - c.h), -3 * DT, 3 * DT);
    c.v *= 1 - 1.8 * DT;
    c.scrape = 1;
  }

  if (c.prog >= TAU) {
    c.finished = true;
    c.lapTime = c.time - (moved > 0 ? ((c.prog - TAU) / moved) * DT : 0);
    return;
  }
  if (c.prog > c.best + 0.002) { c.best = c.prog; c.idle = 0; } else c.idle += DT;
  if (!forgiving && (c.idle > STALL || c.time > T_MAX)) c.alive = false;
}
