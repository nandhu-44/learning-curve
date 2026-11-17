import { describe, expect, it } from 'vitest';
import { autopilot } from '../src/sim/autopilot';
import { spawn, step } from '../src/sim/car';
import { evaluate, Trainer } from '../src/sim/evolve';
import { makeTrack } from '../src/sim/track';

describe('evolution', () => {
  it.each([1, 2])('learns track %i: finishes a lap, then out-drives the careful reference', (seed) => {
    const track = makeTrack(seed), trainer = new Trainer(track);
    const ref = spawn(track);
    while (ref.alive && !ref.finished) {
      const a = autopilot(track, ref);
      step(ref, track, a.steer, a.throttle, false);
    }
    let firstFinish = -1, last = -Infinity, bestLap = Infinity;
    for (let g = 0; g < 40; g++) {
      const best = trainer.next().results[0];
      expect(best.fitness).toBeGreaterThanOrEqual(last); // elites survive, so the champion never gets worse
      last = best.fitness;
      if (best.lapTime !== null) {
        if (firstFinish < 0) firstFinish = g;
        bestLap = Math.min(bestLap, best.lapTime);
      }
    }
    expect(firstFinish).toBeGreaterThan(0); // generation 0 is random and must not already know how to drive
    expect(firstFinish).toBeLessThan(25);
    expect(bestLap).toBeLessThan(ref.lapTime);
  });

  it('is reproducible, and a ranked genome re-scores the same', () => {
    const run = () => {
      const tr = new Trainer(makeTrack(4));
      let g = tr.next();
      for (let i = 0; i < 5; i++) g = tr.next();
      return g;
    };
    const a = run(), b = run();
    expect(Array.from(a.ranked[0])).toEqual(Array.from(b.ranked[0]));
    expect(evaluate(makeTrack(4), a.ranked[0]).fitness).toBe(a.results[0].fitness);
  });
});
