/** Engine note, wall scrape and a few beeps, all synthesised. Nothing plays until the first click. */
export class Sound {
  muted = false;
  private ac?: AudioContext;
  private out?: GainNode;
  private engine?: { a: OscillatorNode; b: OscillatorNode; gain: GainNode; tone: BiquadFilterNode; scrape: GainNode };

  /** Must be called from a user gesture. */
  start(): void {
    if (this.ac) { void this.ac.resume(); return; }
    try {
      const ac = (this.ac = new AudioContext());
      const out = (this.out = ac.createGain());
      out.gain.value = this.muted ? 0 : 0.9;
      out.connect(ac.destination);
      const a = ac.createOscillator(), b = ac.createOscillator(), gain = ac.createGain(), tone = ac.createBiquadFilter();
      a.type = 'sawtooth'; b.type = 'square';
      tone.type = 'lowpass'; tone.frequency.value = 400;
      gain.gain.value = 0;
      a.connect(tone); b.connect(tone); tone.connect(gain); gain.connect(out);
      a.start(); b.start();
      const noise = ac.createBuffer(1, ac.sampleRate, ac.sampleRate), data = noise.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      const src = ac.createBufferSource(), band = ac.createBiquadFilter(), scrape = ac.createGain();
      src.buffer = noise; src.loop = true;
      band.type = 'bandpass'; band.frequency.value = 1800; band.Q.value = 0.7;
      scrape.gain.value = 0;
      src.connect(band); band.connect(scrape); scrape.connect(out);
      src.start();
      this.engine = { a, b, gain, tone, scrape };
    } catch {
      this.ac = undefined; // no audio on this device: the game is fine without it
    }
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.ac && this.out) this.out.gain.setTargetAtTime(m ? 0 : 0.9, this.ac.currentTime, 0.03);
  }

  /** speed is 0..1 of top speed; `on` is false whenever nobody is driving. */
  drive(speed: number, on: boolean, scrape: number): void {
    if (!this.ac || !this.engine) return;
    const t = this.ac.currentTime, e = this.engine, f = 52 + speed * 190;
    e.a.frequency.setTargetAtTime(f, t, 0.05);
    e.b.frequency.setTargetAtTime(f * 0.5, t, 0.05);
    e.tone.frequency.setTargetAtTime(380 + speed * 1500, t, 0.05);
    e.gain.gain.setTargetAtTime(on ? 0.035 + speed * 0.03 : 0, t, 0.08);
    e.scrape.gain.setTargetAtTime(on ? scrape * speed * 0.2 : 0, t, 0.04);
  }

  beep(freq: number, length = 0.14, volume = 0.16, delay = 0): void {
    if (!this.ac || !this.out) return;
    const t = this.ac.currentTime + delay, o = this.ac.createOscillator(), g = this.ac.createGain();
    o.type = 'triangle';
    o.frequency.value = freq;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(volume, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + length);
    o.connect(g); g.connect(this.out);
    o.start(t); o.stop(t + length + 0.05);
  }

  /** A short run of notes: rising for a round won, falling for a loss. */
  jingle(notes: number[]): void {
    notes.forEach((n, i) => this.beep(n, 0.3, 0.14, i * 0.11));
  }

  pause(hidden: boolean): void {
    if (this.ac) void (hidden ? this.ac.suspend() : this.ac.resume());
  }
}
