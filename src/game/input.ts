const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/**
 * Keyboard and touch. The throttle is always open, so driving is steering and braking.
 * Touch: drag sideways on the left of the screen to steer, hold the right to brake.
 */
export class Input {
  /** Called on any first input, e.g. to hide a hint. */
  onUse?: () => void;
  private readonly keys = new Set<string>();
  private steerId = -1;
  private originX = 0;
  private drag = 0;
  private readonly brakes = new Set<number>();

  constructor(surface: HTMLElement, private readonly stick: HTMLElement, knob: HTMLElement) {
    addEventListener('keydown', (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      this.keys.add(k);
      if (k.startsWith('arrow') || k === ' ') e.preventDefault();
      this.onUse?.();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    addEventListener('blur', () => { this.keys.clear(); this.release(); });
    surface.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      try { surface.setPointerCapture(e.pointerId); } catch { /* not capturable: fine */ }
      if (this.steerId < 0 && e.clientX < innerWidth * 0.58) {
        this.steerId = e.pointerId;
        this.originX = e.clientX;
        this.drag = 0;
        stick.style.left = e.clientX + 'px';
        stick.style.top = e.clientY + 'px';
        knob.style.transform = '';
        stick.hidden = false;
      } else this.brakes.add(e.pointerId);
      this.onUse?.();
    });
    surface.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.steerId) return;
      const dx = clamp(e.clientX - this.originX, -64, 64);
      this.drag = -dx / 64;
      knob.style.transform = `translateX(${dx}px)`;
    });
    const up = (e: PointerEvent) => {
      this.brakes.delete(e.pointerId);
      if (e.pointerId === this.steerId) { this.steerId = -1; this.drag = 0; stick.hidden = true; }
    };
    surface.addEventListener('pointerup', up);
    surface.addEventListener('pointercancel', up);
    surface.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private release(): void {
    this.steerId = -1;
    this.drag = 0;
    this.brakes.clear();
    this.stick.hidden = true;
  }

  /** +1 steers left; throttle is 1 unless braking. */
  read(): { steer: number; throttle: number } {
    const k = this.keys;
    const left = k.has('arrowleft') || k.has('a'), right = k.has('arrowright') || k.has('d');
    const brake = k.has('arrowdown') || k.has('s') || k.has(' ') || this.brakes.size > 0;
    return { steer: clamp((left ? 1 : 0) - (right ? 1 : 0) + this.drag, -1, 1), throttle: brake ? -1 : 1 };
  }
}
