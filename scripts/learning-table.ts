/**
 * Prints how the rival improves, round by round, next to a tidy reference lap.
 *   npm run curve -- 1 2 3        (track seeds; default 1)
 *   ALL=1 npm run curve -- 1      (every generation, not only the ones you race)
 */
import { ROUND_GENS } from '../src/game/schedule';
import { autopilot } from '../src/sim/autopilot';
import { spawn, step } from '../src/sim/car';
import { type Result, Trainer } from '../src/sim/evolve';
import { makeTrack } from '../src/sim/track';

const seeds = process.argv.slice(2).map(Number).filter((n) => Number.isFinite(n));
const all = !!process.env.ALL;
const last = ROUND_GENS[ROUND_GENS.length - 1];
const show = (r: Result) => (r.lapTime !== null ? r.lapTime.toFixed(2) + ' s' : `crashes at ${(r.progress * 100).toFixed(0)}%`);

for (const seed of seeds.length ? seeds : [1]) {
  const track = makeTrack(seed);
  const ref = spawn(track);
  while (ref.alive && !ref.finished) {
    const a = autopilot(track, ref);
    step(ref, track, a.steer, a.throttle, false);
  }
  console.log(`\ntrack ${seed}: ${track.length.toFixed(0)} m, tightest bend ${track.minRadius.toFixed(1)} m`);
  console.log(`reference driver: ${ref.finished ? ref.lapTime.toFixed(2) + ' s' : 'crashed'}\n`);
  console.log('round  generation  limit      champion               finishers  rival (best so far)');
  const trainer = new Trainer(track);
  const t0 = performance.now();
  for (let g = 0; g <= last; g++) {
    const gen = trainer.next(), round = ROUND_GENS.indexOf(g);
    if (round < 0 && !all) continue;
    const finishers = gen.results.filter((r) => r.lapTime !== null).length;
    console.log(
      `${(round < 0 ? '' : String(round + 1)).padStart(5)}  ${String(g).padStart(10)}  ${(gen.limit * 3.6).toFixed(0).padStart(3)} km/h  ${show(gen.results[0]).padEnd(21)}  ${String(finishers).padStart(2)} of 60   ${show(gen.rival.result)}`,
    );
  }
  console.log(`\n${((performance.now() - t0) / (last + 1)).toFixed(0)} ms per generation`);
}
