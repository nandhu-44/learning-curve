/**
 * Prints how the champion improves, generation by generation, next to a tidy reference lap.
 *   npm run curve -- 1 2 3        (track seeds; default 1)
 */
import { autopilot } from '../src/sim/autopilot';
import { spawn, step } from '../src/sim/car';
import { Trainer } from '../src/sim/evolve';
import { makeTrack } from '../src/sim/track';

const seeds = process.argv.slice(2).map(Number).filter((n) => Number.isFinite(n));
const GENS = Number(process.env.GENS ?? 120);

for (const seed of seeds.length ? seeds : [1]) {
  const t0 = performance.now();
  const track = makeTrack(seed);
  const built = performance.now() - t0;
  const ref = spawn(track);
  while (ref.alive && !ref.finished) {
    const a = autopilot(track, ref);
    step(ref, track, a.steer, a.throttle, false);
  }
  console.log(`\ntrack ${seed}: ${track.length.toFixed(0)} m, tightest bend ${track.minRadius.toFixed(1)} m, built in ${built.toFixed(0)} ms`);
  console.log(`reference lap: ${ref.finished ? ref.lapTime.toFixed(2) + ' s' : 'crashed at ' + ((ref.prog / (2 * Math.PI)) * 100).toFixed(0) + '%'}`);
  const trainer = new Trainer(track);
  const t1 = performance.now();
  let line = '';
  for (let g = 0; g < GENS; g++) {
    const gen = trainer.next(), best = gen.results[0];
    const finishers = gen.results.filter((r) => r.lapTime !== null).length;
    if (g < 12 || g % 5 === 0) line += `  gen ${String(g).padStart(3)}: ${best.lapTime ? best.lapTime.toFixed(2) + ' s' : (best.progress * 100).toFixed(0).padStart(3) + ' %  '}  (${finishers} finish)\n`;
  }
  console.log(line + `  ${((performance.now() - t1) / GENS).toFixed(0)} ms per generation`);
}
