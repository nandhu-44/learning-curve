import { type Car, step, VMAX } from './car';
import { castRay, type Track } from './track';

/**
 * The driver: a tiny fully connected network, 8 inputs -> 10 tanh units -> 2 tanh outputs.
 * Inputs are seven distance sensors fanned across the nose plus the car's speed.
 * Outputs are steering and throttle. All 112 weights live in one flat genome.
 */
export const RAY_ANGLES = [-1.45, -0.8, -0.35, 0, 0.35, 0.8, 1.45];
export const RAY_MAX = 80;
export const N_IN = RAY_ANGLES.length + 1;
export const N_HID = 10;
export const N_OUT = 2;
export const GENOME_SIZE = (N_IN + 1) * N_HID + (N_HID + 1) * N_OUT;
/** Index of the throttle unit's bias, nudged positive at birth so newborn nets tend to move. */
export const THROTTLE_BIAS = (N_IN + 1) * N_HID + (N_HID + 1) + N_HID;

export interface Scratch {
  inp: Float32Array;
  hid: Float32Array;
  out: Float32Array;
}

export const scratch = (): Scratch => ({ inp: new Float32Array(N_IN), hid: new Float32Array(N_HID), out: new Float32Array(N_OUT) });

export function sense(t: Track, c: Car, inp: Float32Array): void {
  for (let i = 0; i < RAY_ANGLES.length; i++) {
    const a = c.h + RAY_ANGLES[i];
    inp[i] = castRay(t, c.x, c.y, Math.cos(a), Math.sin(a), RAY_MAX) / RAY_MAX;
  }
  inp[RAY_ANGLES.length] = c.v / VMAX;
}

export function think(g: Float32Array, s: Scratch): void {
  let k = 0;
  for (let j = 0; j < N_HID; j++) {
    let a = 0;
    for (let i = 0; i < N_IN; i++) a += g[k++] * s.inp[i];
    s.hid[j] = Math.tanh(a + g[k++]);
  }
  for (let o = 0; o < N_OUT; o++) {
    let a = 0;
    for (let j = 0; j < N_HID; j++) a += g[k++] * s.hid[j];
    s.out[o] = Math.tanh(a + g[k++]);
  }
}

/** One step of a learner: look, think, act. */
export function drive(t: Track, c: Car, g: Float32Array, s: Scratch): void {
  if (!c.alive || c.finished) return;
  sense(t, c, s.inp);
  think(g, s);
  step(c, t, s.out[0], s.out[1], false);
}
