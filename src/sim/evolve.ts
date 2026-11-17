import { drive, GENOME_SIZE, type Scratch, scratch, THROTTLE_BIAS } from './brain';
import { spawn, T_MAX } from './car';
import { gaussian, mulberry32, type Rng } from './rng';
import type { Track } from './track';

export const POP = 60;
const ELITES = 4;
const TAU = Math.PI * 2;

export interface Result {
  /** Below 1: fraction of the lap covered before crashing. Above 1: finished, higher is faster. */
  fitness: number;
  progress: number;
  lapTime: number | null;
}

export interface Generation {
  gen: number;
  /** Genomes and their results, best first. */
  ranked: Float32Array[];
  results: Result[];
  mean: number;
}

/** A lap time expressed on the fitness scale, so a human lap can be drawn on the same chart. */
export const lapFitness = (lapTime: number) => 1 + (T_MAX - lapTime) / T_MAX;

/** Let one brain drive one lap from a standing start. */
export function evaluate(t: Track, g: Float32Array, s: Scratch = scratch()): Result {
  const c = spawn(t);
  while (c.alive && !c.finished) drive(t, c, g, s);
  const progress = Math.max(0, Math.min(1, c.prog / TAU));
  return c.finished ? { fitness: lapFitness(c.lapTime), progress: 1, lapTime: c.lapTime } : { fitness: progress, progress, lapTime: null };
}

/**
 * Neuroevolution: no gradients, no training data. Sixty random brains each drive a lap; the ones
 * that got furthest (or finished fastest) are copied, crossed and mutated into the next sixty.
 */
export class Trainer {
  gen = 0;
  private pop: Float32Array[] = [];
  private readonly rnd: Rng;
  private readonly s = scratch();

  constructor(readonly track: Track, seed: number = track.seed) {
    this.rnd = mulberry32((seed ^ 0x9e3779b9) >>> 0);
    for (let i = 0; i < POP; i++) {
      const g = new Float32Array(GENOME_SIZE);
      for (let k = 0; k < GENOME_SIZE; k++) g[k] = gaussian(this.rnd) * 0.7;
      g[THROTTLE_BIAS] += 1;
      this.pop.push(g);
    }
  }

  /** Score the current generation, return it ranked, and breed the next. */
  next(): Generation {
    const scored = this.pop.map((g) => ({ g, r: evaluate(this.track, g, this.s) }));
    scored.sort((a, b) => b.r.fitness - a.r.fitness);
    const ranked = scored.map((x) => x.g), results = scored.map((x) => x.r);
    const mean = results.reduce((sum, r) => sum + r.fitness, 0) / POP;
    const out: Generation = { gen: this.gen, ranked, results, mean };

    const rnd = this.rnd, parents = POP >> 1;
    const pick = () => {
      // Tournament of three over the better half; ranks are sorted, so the lowest index wins.
      let b = (rnd() * parents) | 0;
      for (let i = 0; i < 2; i++) b = Math.min(b, (rnd() * parents) | 0);
      return ranked[b];
    };
    const next: Float32Array[] = ranked.slice(0, ELITES).map((g) => g.slice());
    while (next.length < POP) {
      const child = pick().slice();
      if (rnd() < 0.7) {
        const other = pick();
        for (let k = 0; k < GENOME_SIZE; k++) if (rnd() < 0.5) child[k] = other[k];
      }
      const wild = rnd() < 0.1; // now and then a much bigger shake, to escape a rut
      const rate = wild ? 0.25 : 0.1, sigma = wild ? 0.9 : 0.3;
      for (let k = 0; k < GENOME_SIZE; k++) if (rnd() < rate) child[k] += gaussian(rnd) * sigma;
      next.push(child);
    }
    this.pop = next;
    this.gen++;
    return out;
  }
}
