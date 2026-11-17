import { mulberry32 } from './rng';

/**
 * A track is a closed loop described in polar form, r(θ): a circle bent by a few seeded harmonics.
 * That keeps it star-shaped around the origin, so it can never cross itself and "how far round the
 * lap is this car" is simply the angle of its position.
 */
export const HALF_WIDTH = 7; // metres from the centreline to either edge
const N = 720; // centreline samples, one every half degree
const R0 = 115; // mean radius, metres
const CELL = 1.5; // distance-field resolution, metres
const BAND = 24; // the field is exact this far from the centreline
const FAR = 1e3;
const TAU = Math.PI * 2;

export interface Track {
  seed: number;
  n: number;
  halfWidth: number;
  /** Centreline samples at uniform angle: position and unit tangent (counter-clockwise). */
  x: Float32Array;
  y: Float32Array;
  tx: Float32Array;
  ty: Float32Array;
  /** Arc length up to each sample, and the whole lap. */
  s: Float32Array;
  length: number;
  /** Tightest radius of curvature on the centreline. */
  minRadius: number;
  /** Distance to the centreline on a grid; the hot path for sensors and collisions. */
  field: Float32Array;
  fx0: number;
  fy0: number;
  fw: number;
  fh: number;
  cell: number;
  start: { x: number; y: number; h: number };
}

interface Shape {
  x: Float64Array;
  y: Float64Array;
  tx: Float64Array;
  ty: Float64Array;
  s: Float64Array;
  length: number;
  minRadius: number;
  minR: number;
}

function shape(seed: number, attempt: number): Shape {
  const rnd = mulberry32((Math.imul(seed, 2654435761) + attempt * 40503) >>> 0);
  const scale = 0.34 * Math.pow(0.93, attempt); // each failed attempt asks for a gentler track
  const amp: number[] = [];
  const phase: number[] = [];
  for (let k = 2; k <= 7; k++) {
    amp.push((scale * (0.35 + 0.65 * rnd())) / Math.pow(k, 0.85));
    phase.push(rnd() * TAU);
  }
  const x = new Float64Array(N), y = new Float64Array(N), tx = new Float64Array(N), ty = new Float64Array(N);
  const s = new Float64Array(N);
  let minRadius = Infinity, minR = Infinity;
  for (let i = 0; i < N; i++) {
    const th = (i / N) * TAU;
    let r = 1, d1 = 0, d2 = 0;
    for (let j = 0; j < amp.length; j++) {
      const k = j + 2, a = k * th + phase[j];
      r += amp[j] * Math.cos(a);
      d1 -= amp[j] * k * Math.sin(a);
      d2 -= amp[j] * k * k * Math.cos(a);
    }
    r *= R0; d1 *= R0; d2 *= R0;
    const c = Math.cos(th), sn = Math.sin(th);
    x[i] = r * c; y[i] = r * sn;
    const dx = d1 * c - r * sn, dy = d1 * sn + r * c, dl = Math.hypot(dx, dy);
    tx[i] = dx / dl; ty[i] = dy / dl;
    const curv = Math.abs(r * r + 2 * d1 * d1 - r * d2) / Math.pow(r * r + d1 * d1, 1.5);
    minRadius = Math.min(minRadius, 1 / Math.max(curv, 1e-9));
    minR = Math.min(minR, r);
  }
  let length = 0;
  for (let i = 0; i < N; i++) {
    s[i] = length;
    const j = (i + 1) % N;
    length += Math.hypot(x[j] - x[i], y[j] - y[i]);
  }
  return { x, y, tx, ty, s, length, minRadius, minR };
}

/** Two stretches of road that are far apart along the lap must not run close enough to share a wall. */
function crowded(sh: Shape): boolean {
  const gap = 2 * HALF_WIDTH + 8;
  for (let i = 0; i < N; i += 2) {
    for (let j = i + 2; j < N; j += 2) {
      const along = sh.s[j] - sh.s[i];
      if (Math.min(along, sh.length - along) < 60) continue;
      if (Math.hypot(sh.x[i] - sh.x[j], sh.y[i] - sh.y[j]) < gap) return true;
    }
  }
  return false;
}

export function makeTrack(seed: number): Track {
  let sh = shape(seed, 0);
  for (let attempt = 1; attempt < 60 && (sh.minRadius < 16 || sh.minR < 45 || crowded(sh)); attempt++) sh = shape(seed, attempt);

  let ext = 0;
  for (let i = 0; i < N; i++) ext = Math.max(ext, Math.abs(sh.x[i]), Math.abs(sh.y[i]));
  ext += BAND + 2 * CELL;
  const fw = Math.ceil((2 * ext) / CELL) + 1;
  const field = new Float32Array(fw * fw).fill(FAR);
  const reach = Math.ceil(BAND / CELL) + 1;
  for (let i = 0; i < N; i++) {
    const j = (i + 1) % N;
    const ax = sh.x[i], ay = sh.y[i], bx = sh.x[j] - ax, by = sh.y[j] - ay, bl = bx * bx + by * by;
    const ci = Math.round((ax + ext) / CELL), cj = Math.round((ay + ext) / CELL);
    for (let v = Math.max(0, cj - reach); v <= Math.min(fw - 1, cj + reach); v++) {
      for (let u = Math.max(0, ci - reach); u <= Math.min(fw - 1, ci + reach); u++) {
        const px = u * CELL - ext - ax, py = v * CELL - ext - ay;
        const t = Math.min(1, Math.max(0, (px * bx + py * by) / bl));
        const d = Math.hypot(px - bx * t, py - by * t);
        if (d < field[v * fw + u]) field[v * fw + u] = d;
      }
    }
  }
  return {
    seed, n: N, halfWidth: HALF_WIDTH,
    x: Float32Array.from(sh.x), y: Float32Array.from(sh.y), tx: Float32Array.from(sh.tx), ty: Float32Array.from(sh.ty),
    s: Float32Array.from(sh.s), length: sh.length, minRadius: sh.minRadius,
    field, fx0: -ext, fy0: -ext, fw, fh: fw, cell: CELL,
    start: { x: sh.x[0], y: sh.y[0], h: Math.atan2(sh.ty[0], sh.tx[0]) },
  };
}

/** Distance from (x, y) to the centreline, bilinear on the grid. Large outside the mapped band. */
export function centerDist(t: Track, x: number, y: number): number {
  const u = (x - t.fx0) / t.cell, v = (y - t.fy0) / t.cell;
  if (u < 0 || v < 0 || u >= t.fw - 1 || v >= t.fh - 1) return FAR;
  const iu = u | 0, iv = v | 0, fu = u - iu, fv = v - iv, k = iv * t.fw + iu, f = t.field;
  const a = f[k] + (f[k + 1] - f[k]) * fu, b = f[k + t.fw] + (f[k + t.fw + 1] - f[k + t.fw]) * fu;
  return a + (b - a) * fv;
}

/**
 * How far a ray travels before it leaves the road. Sphere tracing: the distance to the nearest
 * edge is a safe step, so a clear straight costs a handful of lookups.
 */
export function castRay(t: Track, x: number, y: number, dx: number, dy: number, max: number): number {
  let d = 0;
  for (let i = 0; i < 40; i++) {
    const free = t.halfWidth - centerDist(t, x + dx * d, y + dy * d);
    if (free < 0.02) break;
    d += Math.max(free, 0.2);
    if (d >= max) return max;
  }
  return d;
}

/** Shortest signed difference between two angles. */
export function wrapAngle(a: number): number {
  a %= TAU;
  return a > Math.PI ? a - TAU : a < -Math.PI ? a + TAU : a;
}
