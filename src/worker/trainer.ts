import { GENOME_SIZE } from '../sim/brain';
import { type Rival, Trainer } from '../sim/evolve';
import { makeTrack } from '../sim/track';

/** What the worker posts for every generation: the brain to race and a swarm of its contemporaries. */
export interface GenMessage {
  gen: number;
  limit: number;
  mean: number;
  rival: Rival;
  /** `swarm` genomes packed end to end: ranks 2 onward of this generation. */
  flat: Float32Array;
}

const ctx = self as unknown as { postMessage(m: unknown, transfer?: Transferable[]): void; onmessage: ((e: MessageEvent) => void) | null };

/** Trains off the main thread and posts each generation as soon as it is scored. */
ctx.onmessage = (e: MessageEvent<{ seed: number; swarm: number; lastGen: number }>) => {
  const { seed, swarm, lastGen } = e.data;
  const trainer = new Trainer(makeTrack(seed));
  const tick = () => {
    const g = trainer.next();
    const flat = new Float32Array(swarm * GENOME_SIZE);
    for (let i = 0; i < swarm; i++) flat.set(g.ranked[i + 1], i * GENOME_SIZE);
    const msg: GenMessage = { gen: g.gen, limit: g.limit, mean: g.mean, rival: g.rival, flat };
    ctx.postMessage(msg, [flat.buffer]);
    if (g.gen < lastGen) setTimeout(tick, 0);
  };
  tick();
};
