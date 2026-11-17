import { describe, expect, it } from 'vitest';
import { autopilot } from '../src/sim/autopilot';
import { spawn, step, T_MAX } from '../src/sim/car';
import { centerDist, makeTrack } from '../src/sim/track';

function referenceLap(seed: number) {
  const t = makeTrack(seed), c = spawn(t);
  while (c.alive && !c.finished) {
    const a = autopilot(t, c);
    step(c, t, a.steer, a.throttle, false);
  }
  return c;
}

describe('car', () => {
  it.each([1, 2, 3, 4, 5, 6, 7, 8])('a careful driver completes a clean lap of track %i', (seed) => {
    const c = referenceLap(seed);
    expect(c.finished).toBe(true);
    expect(c.lapTime).toBeGreaterThan(15);
    expect(c.lapTime).toBeLessThan(40);
  });

  it('replays exactly', () => {
    const a = referenceLap(3), b = referenceLap(3);
    expect(a.lapTime).toBe(b.lapTime);
    expect(a.x).toBe(b.x);
  });

  it('retires a learner that hits a wall, stalls or runs out of time', () => {
    const t = makeTrack(1);
    const crasher = spawn(t);
    while (crasher.alive && !crasher.finished) step(crasher, t, -1, 1, false);
    expect(crasher.alive).toBe(false);
    expect(crasher.time).toBeLessThan(10);

    const parked = spawn(t);
    while (parked.alive) step(parked, t, 0, -1, false);
    expect(parked.time).toBeLessThan(T_MAX);
    expect(parked.prog).toBe(0);
  });

  it('lets the human scrape along a wall instead of ending the lap', () => {
    const t = makeTrack(1), c = spawn(t);
    for (let i = 0; i < 600; i++) {
      step(c, t, -1, 1, true);
      expect(centerDist(t, c.x, c.y)).toBeLessThanOrEqual(t.halfWidth);
    }
    expect(c.alive).toBe(true);
  });
});
