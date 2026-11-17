import { describe, expect, it } from 'vitest';
import { GENOME_SIZE, N_IN, scratch, sense, think } from '../src/sim/brain';
import { spawn } from '../src/sim/car';
import { gaussian, mulberry32 } from '../src/sim/rng';
import { makeTrack } from '../src/sim/track';

describe('brain', () => {
  it('has 112 weights', () => expect(GENOME_SIZE).toBe(112));

  it('keeps outputs in range and is silent with no weights', () => {
    const s = scratch(), rnd = mulberry32(5);
    s.inp.fill(1);
    think(new Float32Array(GENOME_SIZE), s);
    expect(Array.from(s.out)).toEqual([0, 0]);
    const g = Float32Array.from({ length: GENOME_SIZE }, () => gaussian(rnd) * 5);
    think(g, s);
    for (const o of s.out) expect(Math.abs(o)).toBeLessThanOrEqual(1);
  });

  it('senses normalised distances and speed', () => {
    const t = makeTrack(2), c = spawn(t), s = scratch();
    sense(t, c, s.inp);
    for (let i = 0; i < N_IN - 1; i++) {
      expect(s.inp[i]).toBeGreaterThan(0);
      expect(s.inp[i]).toBeLessThanOrEqual(1);
    }
    expect(s.inp[N_IN - 1]).toBe(0);
  });
});
