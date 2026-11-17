import { describe, expect, it } from 'vitest';
import { autopilot } from '../src/sim/autopilot';
import { spawn, step, VMAX } from '../src/sim/car';
import { evaluate, Trainer } from '../src/sim/evolve';
import { makeTrack } from '../src/sim/track';

describe('evolution', () => {
  it.each([1, 2])('learns track %i: slow first laps, a rising speed limit, then faster than the careful reference', (seed) => {
    const track = makeTrack(seed), trainer = new Trainer(track);
    const ref = spawn(track);
    while (ref.alive && !ref.finished) {
      const a = autopilot(track, ref);
      step(ref, track, a.steer, a.throttle, false);
    }
    let firstFinish = -1, firstLap = 0, fullSpeed = -1, lap = Infinity, rival = Infinity;
    for (let g = 0; g < 45; g++) {
      const gen = trainer.next(), best = gen.results[0];
      if (gen.rival.result.lapTime !== null) {
        expect(gen.rival.result.lapTime).toBeLessThanOrEqual(rival); // the opponent never gets worse
        rival = gen.rival.result.lapTime;
      }
      if (best.lapTime === null) continue;
      if (firstFinish < 0) { firstFinish = g; firstLap = best.lapTime; }
      if (gen.limit >= VMAX && fullSpeed < 0) fullSpeed = g;
      lap = best.lapTime;
    }
    expect(firstFinish).toBeGreaterThanOrEqual(0);
    expect(firstFinish).toBeLessThan(15);
    expect(firstLap).toBeGreaterThan(ref.lapTime + 8); // its first laps are slow: the speed limit starts low
    expect(fullSpeed).toBeGreaterThan(20); // every rise in the limit had to be earned with a clean lap
    expect(fullSpeed).toBeLessThan(45);
    expect(Math.min(lap, rival)).toBeLessThan(ref.lapTime); // and at full speed it out-drives the careful reference
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
    expect(evaluate(makeTrack(4), a.ranked[0], undefined, a.limit).fitness).toBe(a.results[0].fitness);
  });
});
