import '../style.css';
import { autopilot } from '../sim/autopilot';
import { drive, type Scratch, scratch } from '../sim/brain';
import { type Car, DT, spawn, step, T_MAX, VMAX } from '../sim/car';
import { makeTrack, type Track, wrapAngle } from '../sim/track';
import { Coach, type StoredGen } from './coach';
import { type ChartPoint, drawChart, drawMap, drawNet, fmtLap, type MapDot } from './hud';
import { Input } from './input';
import { genForRound, LAST_GEN, ROUNDS } from './schedule';
import { Sound } from './sound';
import { type CarView, World } from './world';

/** How many ghosts from each generation join the rival on the track. */
const SWARM = 23;
const TAU = Math.PI * 2;
const query = new URLSearchParams(location.search);
/** `?autopilot` hands your car to the hand-written reference driver: a demo, and a way to record laps. */
const DEMO = query.has('autopilot');
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const ui = {
  view: $<HTMLCanvasElement>('view'), title: $('title'), result: $('result'), count: $('count'), hint: $('hint'),
  round: $('round'), gen: $('gen'), time: $('time'), gap: $('gap'), live: $('live'), trackName: $('trackName'), watchText: $('watchText'), netTitle: $('netTitle'),
  map: $<HTMLCanvasElement>('map'), net: $<HTMLCanvasElement>('net'), chart: $<HTMLCanvasElement>('chart'),
  titleChart: $<HTMLCanvasElement>('titleChart'), resChart: $<HTMLCanvasElement>('resChart'),
  race: $<HTMLButtonElement>('race'), next: $<HTMLButtonElement>('next'), again: $<HTMLButtonElement>('again'), mute: $<HTMLButtonElement>('mute'),
  resEyebrow: $('resEyebrow'), resHead: $('resHead'), resBody: $('resBody'), resYou: $('resYou'), resRival: $('resRival'), resRivalLabel: $('resRivalLabel'), resBest: $('resBest'),
};

interface Runner { car: Car; view: CarView; px: number; py: number; ph: number }
interface Learner extends Runner { genome: Float32Array; s: Scratch; fade: number; marked: boolean }

/** Everything tied to one track: its 3D world, its background training and the cars on it. */
class Session {
  readonly track: Track;
  readonly world: World;
  readonly coach: Coach;
  readonly points: ChartPoint[] = [];
  readonly learners: Learner[] = [];
  readonly player: Runner;
  private readonly rivalView: CarView;
  private readonly ghostViews: CarView[] = [];

  constructor(readonly seed: number) {
    this.track = makeTrack(seed);
    this.world = new World(ui.view, this.track);
    this.rivalView = this.world.car('rival');
    for (let i = 0; i < SWARM; i++) this.ghostViews.push(this.world.car('ghost'));
    this.player = { car: spawn(this.track), view: this.world.car('player'), px: 0, py: 0, ph: 0 };
    this.player.view.group.visible = false;
    this.coach = new Coach(this.track, SWARM, LAST_GEN);
    this.coach.onGen = (g) => {
      this.points[g.gen] = { best: g.rival.result.fitness, lap: g.rival.result.lapTime, mean: g.mean };
      onGeneration(g);
    };
  }

  /** Put one generation on the grid, optionally with the human alongside. */
  grid(g: StoredGen, withPlayer: boolean): void {
    const t = this.track, { x, y, h } = t.start;
    this.learners.length = 0;
    this.world.clearMarks();
    const add = (genome: Float32Array, limit: number, view: CarView) => this.learners.push({ car: spawn(t, limit), genome, s: scratch(), view, px: x, py: y, ph: h, fade: 1, marked: false });
    add(g.rival.genome, g.rival.limit, this.rivalView);
    g.swarm.forEach((genome, i) => add(genome, g.limit, this.ghostViews[i]));
    const p = this.player;
    p.car = spawn(t);
    p.car.x += t.ty[0] * 3.2; // the human lines up beside the pack, on the right
    p.car.y -= t.tx[0] * 3.2;
    p.px = p.car.x; p.py = p.car.y; p.ph = h;
    p.view.group.visible = withPlayer;
    this.world.sign('GENERATION ' + g.gen);
    this.world.cut();
  }

  dispose(): void {
    this.coach.stop();
    this.world.dispose();
  }
}

type Mode = 'attract' | 'countdown' | 'race' | 'done';
const input = new Input(ui.view, $('stick'), $('knob'));
const sound = new Sound();
let S: Session;
let mode: Mode = 'attract';
let round = 1, wins = 0, runGen = 0, acc = 0, hold = 0, countT = 0, shown = 0, leader = 0, frame = 0, slow = 0, degraded = false;
let bestLap: number | null = null;

const store = {
  get(key: string): string | null { try { return localStorage.getItem('learning-curve:' + key); } catch { return null; } },
  set(key: string, value: string): void { try { localStorage.setItem('learning-curve:' + key, value); } catch { /* private mode: nothing to keep */ } },
};
const setScreen = (m: 'title' | 'watch' | 'race' | 'result') => {
  document.body.dataset.mode = m;
  ui.title.hidden = m !== 'title';
  ui.result.hidden = m !== 'result';
};
const pct = (c: Car) => Math.round(Math.max(0, Math.min(1, c.prog / TAU)) * 100) + '%';
const kmh = (ms: number) => Math.round(ms * 3.6) + ' km/h';
const limited = (g: StoredGen) => (g.rival.limit >= VMAX ? 'at full speed' : `limited to ${kmh(g.rival.limit)}`);
const describe = (g: StoredGen) => (g.rival.result.lapTime !== null ? `laps in ${fmtLap(g.rival.result.lapTime)}, ${limited(g)}` : `crashes ${Math.round(g.rival.result.progress * 100)}% of the way round`);

function onGeneration(g: StoredGen): void {
  ui.race.disabled = false;
  ui.live.textContent = `Training right now. Generation ${g.gen} ${describe(g)}.` + (g.gen >= LAST_GEN ? ' Training is complete.' : '');
  ui.watchText.textContent = `Watching generation ${runGen} · trained to ${g.gen}`;
  if (mode === 'done' && !ui.next.hidden) readyNext();
  if (!ui.title.hidden) drawChart(ui.titleChart, S.points, bestLap, null);
  if (!ui.result.hidden) drawChart(ui.resChart, S.points, bestLap, ui.next.hidden ? null : genForRound(round + 1));
}

/** Idle state: the newest generation drives by itself, over and over, behind the title card or in watch mode. */
function attract(screen: 'title' | 'watch'): void {
  mode = 'attract';
  hold = 9; // start a run on the next frame that has a generation to show
  acc = 0;
  S.player.view.group.visible = false;
  for (const l of S.learners) { l.car.alive = false; l.marked = true; l.fade = 0; } // clear the last race off the road
  S.coach.setQuiet(true);
  ui.count.hidden = true;
  ui.netTitle.textContent = "Champion's network, live";
  setScreen(screen);
  sound.drive(0, false, 0);
  if (screen === 'title') {
    const record = store.get('best:' + S.seed);
    ui.trackName.textContent = `Track ${S.seed}` + (record ? ` · your record: ${record} round${record === '1' ? '' : 's'}` : '');
    drawChart(ui.titleChart, S.points, bestLap, null);
  }
}

function startRound(n: number): void {
  const g = S.coach.gens[genForRound(n)];
  if (!g) return;
  round = n;
  runGen = g.gen;
  S.grid(g, true);
  S.coach.setQuiet(false);
  mode = 'countdown';
  countT = 0; shown = 4; acc = 0;
  ui.round.textContent = String(n);
  ui.gen.textContent = String(g.gen);
  ui.time.textContent = '0.00';
  ui.gap.textContent = '';
  ui.gap.className = '';
  ui.netTitle.textContent = `Generation ${g.gen} · ${limited(g)}`;
  ui.hint.style.opacity = '1';
  setScreen('race');
}

function readyNext(): void {
  const need = genForRound(round + 1), ready = !!S.coach.gens[need];
  ui.next.disabled = !ready;
  ui.next.textContent = ready ? `Race generation ${need}` : `Training generation ${need}…`;
}

function finish(won: boolean, timedOut: boolean): void {
  const p = S.player.car, r = S.learners[0].car, last = round >= ROUNDS;
  mode = 'done';
  S.coach.setQuiet(true);
  sound.drive(0, false, 0);
  if (p.finished) bestLap = bestLap === null ? p.lapTime : Math.min(bestLap, p.lapTime);
  if (won) wins++;
  const over = !won || last;
  if (over && wins > Number(store.get('best:' + S.seed) ?? 0)) store.set('best:' + S.seed, String(wins));
  const still = S.coach.gens.length > LAST_GEN ? '' : ' It is still training.';
  const held = `You held the network off for ${wins} round${wins === 1 ? '' : 's'}.`;
  ui.resEyebrow.textContent = over ? `Track ${S.seed} · round ${round} · game over` : `Track ${S.seed} · round ${round} of ${ROUNDS}`;
  ui.resHead.textContent = won ? (last ? 'You out-drove it.' : `Round ${round} is yours.`) : timedOut ? 'Out of time.' : `Generation ${runGen} beat you.`;
  ui.resBody.textContent = won
    ? last
      ? `Generation ${runGen} is as good as this network gets on this track, and you still crossed the line first.`
      : r.alive
        ? `Generation ${runGen} was ${pct(r)} of the way round when you crossed the line.${still}`
        : `Generation ${runGen} went off ${pct(r)} of the way round.${still}`
    : timedOut
      ? `A lap has to be finished inside ${T_MAX} seconds. ${held}`
      : `It crossed the line while you were ${pct(p)} of the way round. ${held}`;
  ui.resYou.textContent = p.finished ? fmtLap(p.lapTime) : pct(p) + ' done';
  ui.resRivalLabel.textContent = `Generation ${runGen}`;
  ui.resRival.textContent = r.finished ? fmtLap(r.lapTime) : r.alive ? 'at ' + pct(r) : 'off at ' + pct(r);
  ui.resBest.textContent = bestLap === null ? '—' : fmtLap(bestLap);
  ui.next.hidden = over;
  ui.again.hidden = !over;
  if (!over) readyNext();
  setScreen('result');
  drawChart(ui.resChart, S.points, bestLap, over ? null : genForRound(round + 1));
  sound.jingle(won ? [523, 659, 784, 1047] : [392, 330, 262, 196]);
}

function simStep(): void {
  const t = S.track;
  if (mode === 'race') {
    const p = S.player, c = DEMO ? autopilot(t, p.car) : input.read();
    p.px = p.car.x; p.py = p.car.y; p.ph = p.car.h;
    step(p.car, t, c.steer, c.throttle, true);
  }
  for (let i = 0; i < S.learners.length; i++) {
    const l = S.learners[i], c = l.car;
    l.px = c.x; l.py = c.y; l.ph = c.h;
    if (!c.alive || c.finished) continue;
    drive(t, c, l.genome, l.s);
    if (!c.alive && !l.marked) {
      l.marked = true;
      S.world.mark(c.x, c.y);
      if (i === 0 && mode === 'race') sound.beep(150, 0.3, 0.12);
    }
  }
  if (mode !== 'race') return;
  const p = S.player.car, r = S.learners[0].car;
  if (p.finished) finish(!r.finished || p.lapTime <= r.lapTime, false);
  else if (r.finished) finish(false, false);
  else if (p.time >= T_MAX) finish(false, true);
}

const place = (r: Runner, a: number, fade: number) => {
  const c = r.car;
  r.view.place(r.px + (c.x - r.px) * a, r.py + (c.y - r.py) * a, r.ph + wrapAngle(c.h - r.ph) * a, c.steer, c.v, fade);
};

/** One displayed frame: advance the simulation in fixed steps, then draw. */
function advance(dt: number, draw = true): void {
  frame++;
  if (mode === 'countdown') {
    countT += dt;
    const n = 3 - Math.floor(countT / 0.75);
    if (n !== shown) {
      shown = n;
      ui.count.hidden = false;
      ui.count.textContent = n > 0 ? String(n) : 'GO';
      sound.beep(n > 0 ? 440 : 880, n > 0 ? 0.12 : 0.4);
      sound.drive(0, true, 0);
      if (n <= 0) { mode = 'race'; acc = 0; }
    }
  } else if (mode === 'race' && S.player.car.time > 0.7) ui.count.hidden = true;

  if (mode === 'race' || mode === 'attract') {
    acc += dt;
    for (let n = 0; acc >= DT && n < 6 && (mode === 'race' || mode === 'attract'); n++) { simStep(); acc -= DT; }
    if (acc > DT) acc = 0; // too far behind to catch up: drop the backlog instead of spiralling
  }
  if (mode === 'attract') {
    const running = S.learners.some((l) => l.car.alive && !l.car.finished);
    hold = running ? 0 : hold + dt;
    const g = S.coach.latest;
    if (g && hold > 1.3) {
      runGen = g.gen;
      S.grid(g, false);
      leader = 0;
      hold = 0;
      ui.watchText.textContent = `Watching generation ${g.gen} · trained to ${g.gen}`;
      ui.netTitle.textContent = `Generation ${g.gen} · ${limited(g)}`;
    }
  }

  const a = mode === 'race' || mode === 'attract' ? acc / DT : 1;
  const eye = S.world.camera.position;
  S.learners.forEach((l, i) => {
    l.fade = l.car.alive && !l.car.finished ? 1 : Math.max(0, l.fade - dt * (l.car.finished ? 1.4 : 3));
    // Ghosts thin out as they near the lens, so a pack sitting on your bumper does not hide the road.
    const near = i ? Math.min(1, Math.max(0, (Math.hypot(l.car.x - eye.x, -l.car.y - eye.z) - 6) / 10)) : 1;
    place(l, a, l.fade * near);
  });
  if (mode === 'attract') {
    // Follow whoever is furthest round, without flicking between cars that are level.
    let best = leader;
    S.learners.forEach((l, i) => {
      const cur = S.learners[best];
      if (l.car.alive && !l.car.finished && (!cur || !cur.car.alive || cur.car.finished || l.car.prog > cur.car.prog + 0.02)) best = i;
    });
    leader = best;
    const l = S.learners[leader];
    if (l) S.world.follow(l.px + (l.car.x - l.px) * a, l.py + (l.car.y - l.py) * a, l.car.h, l.car.v, dt, 'heli');
    else S.world.follow(S.track.start.x, S.track.start.y, S.track.start.h, 0, dt, 'heli');
  } else {
    const p = S.player, c = p.car;
    place(p, a, 1);
    S.world.follow(p.px + (c.x - p.px) * a, p.py + (c.y - p.py) * a, p.ph + wrapAngle(c.h - p.ph) * a, c.v, dt, 'chase');
    if (mode === 'race') {
      const r = S.learners[0].car;
      sound.drive(c.v / VMAX, true, c.scrape);
      ui.time.textContent = c.time.toFixed(2);
      if (!r.alive) { ui.gap.textContent = `gen ${runGen} off at ${pct(r)}`; ui.gap.className = ''; }
      else {
        const m = Math.round(((c.prog - r.prog) / TAU) * S.track.length);
        ui.gap.textContent = `${m >= 0 ? '+' : '−'}${Math.abs(m)} m`;
        ui.gap.className = m >= 0 ? 'ahead' : 'behind';
      }
      if (c.time > 6) ui.hint.style.opacity = '0';
    }
  }

  if (frame % 4 === 0 && (mode === 'race' || mode === 'countdown' || document.body.dataset.mode === 'watch')) {
    const dots: MapDot[] = [];
    S.learners.forEach((l, i) => { if (i && l.fade > 0.5) dots.push({ x: l.car.x, y: l.car.y, color: 'rgba(120,180,240,.9)', r: 2 }); });
    const champ = S.learners[0];
    if (champ) {
      if (champ.fade > 0.5) dots.push({ x: champ.car.x, y: champ.car.y, color: '#e5384f', r: 4 });
      drawNet(ui.net, champ.genome, champ.s);
    }
    if (S.player.view.group.visible) dots.push({ x: S.player.car.x, y: S.player.car.y, color: '#ffc21a', r: 4.5 });
    drawMap(ui.map, S.track, dots);
    if (frame % 24 === 0) drawChart(ui.chart, S.points, bestLap, mode === 'attract' ? null : runGen);
  }
  if (draw) S.world.render();
}

let last = performance.now();
function loop(now: number): void {
  const dt = Math.min(0.1, Math.max(0.001, (now - last) / 1000));
  last = now;
  advance(dt);
  // A device that cannot hold 30 fps while racing gets the cheaper look.
  if (!degraded && mode === 'race') {
    slow = dt > 0.036 ? slow + 1 : Math.max(0, slow - 1);
    if (slow > 90) { degraded = true; S.world.degrade(); }
  }
  requestAnimationFrame(loop);
}

function openTrack(seed: number): void {
  S?.dispose();
  S = new Session(seed);
  bestLap = null;
  wins = 0;
  ui.race.disabled = true;
  ui.live.textContent = 'Starting the first generation…';
  try { history.replaceState(null, '', '?track=' + seed); } catch { /* embedded: the address stays as it is */ }
  attract('title');
}

const newTrack = () => openTrack(1 + Math.floor(Math.random() * 99999));
const begin = () => { sound.start(); wins = 0; startRound(1); };
ui.race.addEventListener('click', begin);
$('watchRace').addEventListener('click', begin);
ui.again.addEventListener('click', begin);
ui.next.addEventListener('click', () => startRound(round + 1));
$('justWatch').addEventListener('click', () => { sound.start(); attract('watch'); });
$('resWatch').addEventListener('click', () => attract('watch'));
$('newTrack').addEventListener('click', newTrack);
$('resNew').addEventListener('click', newTrack);
ui.mute.addEventListener('click', () => {
  sound.setMuted(!sound.muted);
  ui.mute.textContent = sound.muted ? 'Sound off' : 'Sound on';
  ui.mute.setAttribute('aria-pressed', String(!sound.muted));
  store.set('muted', sound.muted ? '1' : '');
});
if (store.get('muted')) ui.mute.click();
addEventListener('keydown', (e) => {
  // Enter moves on from a card. (Space is the brake, so it must not press buttons.)
  if (e.key !== 'Enter' || e.repeat) return;
  const b = !ui.title.hidden ? ui.race : !ui.result.hidden ? (ui.next.hidden ? ui.again : ui.next) : null;
  if (b && !b.disabled) { e.preventDefault(); b.click(); }
});
addEventListener('resize', () => S.world.resize());
document.addEventListener('visibilitychange', () => { sound.pause(document.hidden); last = performance.now(); });

const asked = Number(query.get('track') ?? location.hash.replace(/^#t/, ''));
const today = new Date();
// With no track in the address, everyone gets the same one each day.
openTrack(Number.isInteger(asked) && asked > 0 ? asked : today.getUTCFullYear() * 10000 + (today.getUTCMonth() + 1) * 100 + today.getUTCDate());

if (query.has('capture')) {
  // Frame-exact stepping for recording: `__lc.frames(n)` advances n frames of 1/60 s and draws the last one;
  // `__lc.show(gen)` puts a chosen generation on the grid in watch mode.
  (window as unknown as { __lc: unknown }).__lc = {
    frames: (n: number) => { for (let i = 0; i < n; i++) advance(DT, i === n - 1); },
    show: (gen: number) => { const g = S.coach.gens[gen]; if (g) { runGen = g.gen; S.grid(g, false); leader = 0; hold = 0; ui.netTitle.textContent = `Generation ${g.gen} · ${limited(g)}`; ui.watchText.textContent = `Watching generation ${g.gen}`; } },
    mode: () => mode,
    gens: () => S.coach.gens.length,
  };
} else requestAnimationFrame(loop);
