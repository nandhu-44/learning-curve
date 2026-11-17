import { N_HID, N_IN, N_OUT, type Scratch } from '../sim/brain';
import { T_MAX } from '../sim/car';
import type { Track } from '../sim/track';

/** The three small drawings on top of the 3D view: the rival's network, the learning chart and the map. */
const INK = '#16181d', MUTED = '#6b7280', BLUE = '31,111,235', RED = '229,56,79', YELLOW = '#e0a100';
const FONT = '"JetBrains Mono", ui-monospace, Menlo, monospace';

/** Match the canvas backing store to its CSS box and return a context that draws in CSS pixels. */
function fit(c: HTMLCanvasElement): { g: CanvasRenderingContext2D; w: number; h: number } {
  const d = Math.min(window.devicePixelRatio || 1, 2), w = c.clientWidth, h = c.clientHeight;
  if (c.width !== Math.round(w * d) || c.height !== Math.round(h * d)) { c.width = Math.round(w * d); c.height = Math.round(h * d); }
  const g = c.getContext('2d')!;
  g.setTransform(d, 0, 0, d, 0, 0);
  g.clearRect(0, 0, w, h);
  return { g, w, h };
}

/** Live view of one brain: blue links push a unit up, red push it down, brightness is how hard. */
export function drawNet(c: HTMLCanvasElement, genome: Float32Array, s: Scratch): void {
  const { g, w, h } = fit(c);
  if (!w) return;
  const xs = [22, w * 0.47, w - 74];
  const yIn = (i: number) => 12 + (i * (h - 24)) / (N_IN - 1);
  const yHid = (j: number) => 9 + (j * (h - 18)) / (N_HID - 1);
  const yOut = (o: number) => h * (0.33 + o * 0.34);
  const link = (x0: number, y0: number, x1: number, y1: number, a: number) => {
    const m = Math.abs(a);
    if (m < 0.06) return;
    g.strokeStyle = `rgba(${a > 0 ? BLUE : RED},${Math.min(0.85, m * 0.5)})`;
    g.lineWidth = 0.6 + Math.min(2.4, m);
    g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
  };
  let k = 0;
  for (let j = 0; j < N_HID; j++) { for (let i = 0; i < N_IN; i++) link(xs[0], yIn(i), xs[1], yHid(j), genome[k++] * s.inp[i]); k++; }
  for (let o = 0; o < N_OUT; o++) { for (let j = 0; j < N_HID; j++) link(xs[1], yHid(j), xs[2], yOut(o), genome[k++] * s.hid[j]); k++; }
  const node = (x: number, y: number, r: number, v: number) => {
    g.fillStyle = '#fff'; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
    g.fillStyle = `rgba(${v >= 0 ? BLUE : RED},${0.12 + 0.88 * Math.min(1, Math.abs(v))})`;
    g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
    g.strokeStyle = 'rgba(22,24,29,.55)'; g.lineWidth = 1; g.stroke();
  };
  for (let i = 0; i < N_IN; i++) node(xs[0], yIn(i), 4.5, s.inp[i]);
  for (let j = 0; j < N_HID; j++) node(xs[1], yHid(j), 4.5, s.hid[j]);
  g.font = `600 10px ${FONT}`; g.textBaseline = 'middle';
  ['steer', 'throttle'].forEach((name, o) => {
    const y = yOut(o), v = s.out[o];
    node(xs[2], y, 6.5, v);
    g.fillStyle = INK; g.textAlign = 'left';
    g.fillText(name, xs[2] + 12, y - 7);
    g.fillStyle = 'rgba(22,24,29,.14)'; g.fillRect(xs[2] + 12, y + 2, 50, 4);
    g.fillStyle = `rgb(${v >= 0 ? BLUE : RED})`;
    g.fillRect(xs[2] + 37 + Math.min(0, v * 25), y + 2, Math.abs(v) * 25, 4);
  });
  g.fillStyle = MUTED; g.textAlign = 'left'; g.font = `500 9px ${FONT}`;
  g.fillText('7 sensors', 2, 3.5);
  g.fillText('speed', xs[0] + 9, yIn(N_IN - 1));
}

export interface ChartPoint { best: number; lap: number | null; mean: number }

const LAP_SLOW = 52, LAP_FAST = 21, SPLIT = 0.3;
/** Chart height of a result, 0..1: the lower part is "how far before crashing", the upper part is lap time. */
function level(fitness: number, lap: number | null): number {
  if (lap === null && fitness >= 1) lap = T_MAX * (2 - fitness);
  if (lap === null) return SPLIT * Math.max(0, fitness);
  return SPLIT + (1 - SPLIT) * Math.min(1, Math.max(0, (LAP_SLOW - lap) / (LAP_SLOW - LAP_FAST)));
}

/** The learning curve: champion (line) and population average (faint) per generation, with your best lap across it. */
export function drawChart(c: HTMLCanvasElement, pts: ChartPoint[], you: number | null, next: number | null): void {
  const { g, w, h } = fit(c);
  if (!w) return;
  const L = 6, R = w - 34, T = 8, B = h - 16, span = Math.max(30, pts.length - 1, (next ?? 0) + 2);
  // Square-root scale: the early generations, where most of the learning happens, get most of the width.
  const X = (gen: number) => L + (R - L) * Math.sqrt(gen / span), Y = (lv: number) => B - (B - T) * lv;
  g.font = `500 9px ${FONT}`; g.textBaseline = 'middle';
  g.strokeStyle = 'rgba(22,24,29,.12)'; g.lineWidth = 1;
  let lastLabel = Infinity;
  for (const lap of [45, 35, 30, 25]) {
    const y = Y(level(2, lap));
    g.beginPath(); g.moveTo(L, y); g.lineTo(R, y); g.stroke();
    if (lastLabel - y < 11) continue; // on a short chart, skip labels that would collide
    lastLabel = y;
    g.fillStyle = MUTED; g.textAlign = 'left'; g.fillText(lap + ' s', R + 4, y);
  }
  const yFin = Y(SPLIT);
  g.strokeStyle = 'rgba(22,24,29,.4)'; g.setLineDash([3, 3]);
  g.beginPath(); g.moveTo(L, yFin); g.lineTo(R, yFin); g.stroke(); g.setLineDash([]);
  g.fillStyle = MUTED; g.textAlign = 'right'; g.fillText('full lap', R - 3, yFin + 7);
  let lastTick = -99;
  for (const tick of [0, 5, 20, 50, 100, 200, 300]) {
    if (tick > span || X(tick) - lastTick < (lastTick === L ? 40 : 26)) continue;
    lastTick = X(tick);
    g.textAlign = tick ? 'center' : 'left';
    g.fillText(tick ? String(tick) : 'gen 0', X(tick), h - 5);
    g.fillRect(X(tick), B, 1, 3);
  }
  if (next !== null) {
    g.strokeStyle = `rgba(${RED},.7)`; g.setLineDash([2, 3]);
    g.beginPath(); g.moveTo(X(next), T); g.lineTo(X(next), B); g.stroke(); g.setLineDash([]);
  }
  const trace = (pick: (p: ChartPoint) => number, style: string, width: number) => {
    g.strokeStyle = style; g.lineWidth = width; g.lineJoin = 'round'; g.beginPath();
    pts.forEach((p, i) => (i ? g.lineTo(X(i), Y(pick(p))) : g.moveTo(X(i), Y(pick(p)))));
    g.stroke();
  };
  if (pts.length > 1) {
    trace((p) => level(p.mean, null), 'rgba(22,24,29,.25)', 1.2);
    trace((p) => level(p.best, p.lap), `rgb(${RED})`, 2.2);
  }
  if (pts.length) {
    const p = pts[pts.length - 1];
    g.fillStyle = `rgb(${RED})`; g.beginPath(); g.arc(X(pts.length - 1), Y(level(p.best, p.lap)), 3.2, 0, 7); g.fill();
  }
  if (you !== null) {
    const y = Y(level(2, you));
    g.strokeStyle = YELLOW; g.lineWidth = 1.6; g.setLineDash([6, 4]);
    g.beginPath(); g.moveTo(L, y); g.lineTo(R, y); g.stroke(); g.setLineDash([]);
    g.fillStyle = YELLOW; g.textAlign = 'right'; g.font = `700 9px ${FONT}`;
    g.fillText('you', R - 3, y - 7);
  }
}

export interface MapDot { x: number; y: number; color: string; r: number }

export function drawMap(c: HTMLCanvasElement, t: Track, dots: MapDot[]): void {
  const { g, w, h } = fit(c);
  if (!w) return;
  const ext = -t.fx0 - 18, k = Math.min(w, h) / (2 * ext), px = (x: number) => w / 2 + x * k, py = (y: number) => h / 2 - y * k;
  g.beginPath();
  for (let i = 0; i <= t.n; i += 6) { const j = i % t.n; if (i) g.lineTo(px(t.x[j]), py(t.y[j])); else g.moveTo(px(t.x[j]), py(t.y[j])); }
  g.closePath();
  g.lineJoin = 'round';
  g.strokeStyle = 'rgba(255,255,255,.9)'; g.lineWidth = 6; g.stroke();
  g.strokeStyle = '#3b3e45'; g.lineWidth = 3.5; g.stroke();
  g.fillStyle = '#fff'; g.fillRect(px(t.start.x) - 1.5, py(t.start.y) - 4, 3, 8);
  for (const d of dots) {
    g.fillStyle = d.color; g.beginPath(); g.arc(px(d.x), py(d.y), d.r, 0, 7); g.fill();
    if (d.r > 3) { g.strokeStyle = '#fff'; g.lineWidth = 1.2; g.stroke(); }
  }
}

export const fmtLap = (t: number) => t.toFixed(2) + ' s';
