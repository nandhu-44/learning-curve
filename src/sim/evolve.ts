import { drive, GENOME_SIZE, type Scratch, scratch, THROTTLE_BIAS } from './brain';
import { spawn, T_MAX, VMAX } from './car';
import { gaussian, mulberry32, type Rng } from './rng';
import type { Track } from './track';

export const POP = 60;
const ELITES = 4;
/**
 * Curriculum. Learners start with a low speed limit, and it rises a little after every generation
 * whose champion completes the lap. Each rise is a new problem: a line that worked at the old speed
 * runs wide at the new one, so the network has to keep learning (eventually, to brake) all the way up.
 */
export const LIMIT_START = 18;
export const LIMIT_STEP = 1;
const TAU = Math.PI * 2;

export interface Result {
  /** Below 1: fraction of the lap covered before crashing. Above 1: finished, higher is faster. */
  fitness: number;
  progress: number;
  lapTime: number | null;
}

/** The brain you race: the fastest lap any generation has produced so far, with the limit it was set under. */
export interface Rival {
  genome: Float32Array;
  result: Result;
  limit: number;
  /** The generation it was bred in. */
  gen: number;
}

export interface Generation {
  gen: number;
  /** The speed limit this generation drove under, m/s. */
  limit: number;
  /** Genomes and their results, best first. */
  ranked: Float32Array[];
  results: Result[];
  mean: number;
  /**
   * Best brain up to and including this generation. Usually this generation's champion; when a
   * raised limit has the whole population crashing for a while, it is the earlier record holder,
   * so the opponent never gets worse.
   */
  rival: Rival;
}

/** A lap time expressed on the fitness scale, so a human lap can be drawn on the same chart. */
export const lapFitness = (lapTime: number) => 1 + (T_MAX - lapTime) / T_MAX;

/** Let one brain drive one lap from a standing start. */
export function evaluate(t: Track, g: Float32Array, s: Scratch = scratch(), limit: number = VMAX): Result {
  const c = spawn(t, limit);
  while (c.alive && !c.finished) drive(t, c, g, s);
  const progress = Math.max(0, Math.min(1, c.prog / TAU));
  return c.finished ? { fitness: lapFitness(c.lapTime), progress: 1, lapTime: c.lapTime } : { fitness: progress, progress, lapTime: null };
}

/**
 * Neuroevolution: no gradients, no training data. Sixty random brains each drive a lap; the ones
 * that got furthest (or finished fastest) are copied, crossed and mutated into the next sixty.
 * The four best are carried over unchanged, so a good driver is never lost to a bad mutation.
 */
export class Trainer {
  gen = 0;
  limit = LIMIT_START;
  private record?: Rival;
  private pop: Float32Array[] = [];
  private readonly rnd: Rng;
  private readonly s = scratch();

  constructor(readonly track: Track, seed: number = track.seed, private readonly size: number = POP, private readonly elites: number = ELITES) {
    this.rnd = mulberry32((seed ^ 0x9e3779b9) >>> 0);
    for (let i = 0; i < size; i++) {
      const g = new Float32Array(GENOME_SIZE);
      for (let k = 0; k < GENOME_SIZE; k++) g[k] = gaussian(this.rnd) * 0.7;
      g[THROTTLE_BIAS] += 1;
      this.pop.push(g);
    }
  }

  /** Score the current generation, return it ranked, and breed the next. */
  next(): Generation {
    const scored = this.pop.map((g) => ({ g, r: evaluate(this.track, g, this.s, this.limit) }));
    scored.sort((a, b) => b.r.fitness - a.r.fitness);
    const ranked = scored.map((x) => x.g), results = scored.map((x) => x.r);
    const mean = results.reduce((sum, r) => sum + r.fitness, 0) / this.size;
    const top = results[0];
    if (top.lapTime !== null && (!this.record || top.lapTime < (this.record.result.lapTime as number))) this.record = { genome: ranked[0], result: top, limit: this.limit, gen: this.gen };
    const rival = this.record ?? { genome: ranked[0], result: top, limit: this.limit, gen: this.gen };
    const out: Generation = { gen: this.gen, limit: this.limit, ranked, results, mean, rival };
    if (results[0].lapTime !== null) this.limit = Math.min(VMAX, this.limit + LIMIT_STEP);

    const rnd = this.rnd, parents = this.size >> 1;
    const pick = () => {
      // Tournament of three over the better half; ranks are sorted, so the lowest index wins.
      let b = (rnd() * parents) | 0;
      for (let i = 0; i < 2; i++) b = Math.min(b, (rnd() * parents) | 0);
      return ranked[b];
    };
    const next: Float32Array[] = ranked.slice(0, this.elites).map((g) => g.slice());
    while (next.length < this.size) {
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
