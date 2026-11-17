import { describe, expect, it } from 'vitest';
import { castRay, centerDist, HALF_WIDTH, makeTrack, wrapAngle } from '../src/sim/track';

const seeds = Array.from({ length: 16 }, (_, i) => i + 1);

describe('track', () => {
  it('is the same track for the same seed and a different one otherwise', () => {
    const a = makeTrack(7), b = makeTrack(7), c = makeTrack(8);
    expect(Array.from(a.x)).toEqual(Array.from(b.x));
    expect(Array.from(a.x)).not.toEqual(Array.from(c.x));
  });

  it.each(seeds)('seed %i is drivable: wide bends, sensible length', (seed) => {
    const t = makeTrack(seed);
    expect(t.minRadius).toBeGreaterThanOrEqual(16);
    expect(t.length).toBeGreaterThan(600);
    expect(t.length).toBeLessThan(1100);
  });

  it.each(seeds)('seed %i: the distance field matches the geometry', (seed) => {
    const t = makeTrack(seed);
    for (let i = 0; i < t.n; i += 9) {
      const nx = -t.ty[i], ny = t.tx[i];
      expect(centerDist(t, t.x[i], t.y[i])).toBeLessThan(0.8);
      for (const side of [-1, 1]) {
        const d = centerDist(t, t.x[i] + nx * HALF_WIDTH * side, t.y[i] + ny * HALF_WIDTH * side);
        expect(Math.abs(d - HALF_WIDTH)).toBeLessThan(0.4);
      }
    }
  });

  it('casts rays to the edge of the road', () => {
    const t = makeTrack(1), { x, y, h } = t.start;
    expect(castRay(t, x, y, Math.cos(h + Math.PI / 2), Math.sin(h + Math.PI / 2), 80)).toBeCloseTo(HALF_WIDTH, 0);
    expect(castRay(t, x, y, Math.cos(h), Math.sin(h), 80)).toBeGreaterThan(HALF_WIDTH);
    expect(castRay(t, x, y, Math.cos(h), Math.sin(h), 5)).toBe(5);
  });

  it('wraps angles to the short way round', () => {
    expect(wrapAngle(Math.PI * 1.5)).toBeCloseTo(-Math.PI / 2);
    expect(wrapAngle(-Math.PI * 1.5)).toBeCloseTo(Math.PI / 2);
  });
});
