import { GENOME_SIZE } from '../sim/brain';
import { type Rival, Trainer } from '../sim/evolve';
import type { Track } from '../sim/track';
import type { GenMessage } from '../worker/trainer';
import TrainerWorker from '../worker/trainer?worker&inline';

export interface StoredGen {
  gen: number;
  /** Speed limit this generation trained under, m/s. */
  limit: number;
  mean: number;
  /** The brain you race in this generation's round. */
  rival: Rival;
  /** Its contemporaries, shown as ghosts. */
  swarm: Float32Array[];
}

/**
 * Keeps the network training in the background and remembers every generation it has produced.
 * Training is seeded by the track, so a given track always yields the same sequence of rivals.
 */
export class Coach {
  readonly gens: StoredGen[] = [];
  onGen?: (g: StoredGen) => void;
  private fallback?: Trainer;
  private worker?: Worker;
  private quiet = true;
  private stopped = false;

  constructor(private readonly track: Track, private readonly swarm: number, private readonly lastGen: number) {
    try {
      const w = (this.worker = new TrainerWorker());
      w.onmessage = (e: MessageEvent<GenMessage>) => {
        const { gen, limit, mean, rival, flat } = e.data, genomes: Float32Array[] = [];
        for (let i = 0; i < swarm; i++) genomes.push(flat.subarray(i * GENOME_SIZE, (i + 1) * GENOME_SIZE));
        this.store({ gen, limit, mean, rival, swarm: genomes });
      };
      w.onerror = () => { w.terminate(); this.worker = undefined; this.trainHere(); };
      w.postMessage({ seed: track.seed, swarm, lastGen });
    } catch {
      this.trainHere();
    }
  }

  /** Without a worker, training shares the main thread; tell it when nobody is driving so it can run. */
  setQuiet(quiet: boolean): void {
    this.quiet = quiet;
  }

  stop(): void {
    this.stopped = true;
    this.onGen = undefined;
    this.worker?.terminate();
  }

  get latest(): StoredGen | undefined {
    return this.gens[this.gens.length - 1];
  }

  private store(g: StoredGen): void {
    if (this.stopped || this.gens[g.gen]) return;
    this.gens[g.gen] = g;
    this.onGen?.(g);
  }

  private trainHere(): void {
    if (this.fallback || this.stopped) return;
    const t = (this.fallback = new Trainer(this.track));
    const tick = () => {
      if (t.gen > this.lastGen || this.stopped) return;
      if (this.quiet || this.gens.length < 3) {
        const g = t.next();
        this.store({ gen: g.gen, limit: g.limit, mean: g.mean, rival: g.rival, swarm: g.ranked.slice(1, this.swarm + 1) });
      }
      setTimeout(tick, 40);
    };
    tick();
  }
}
