/** Synthetic multirotor noise: detuned rotor tones and filtered wash that follow throttle. Starts from a user gesture. */
export class DroneAudio {
  private context: AudioContext | null = null;
  private rotors: OscillatorNode[] = [];
  private gain: GainNode | null = null;
  private filter: BiquadFilterNode | null = null;
  private wash: GainNode | null = null;

  /** Must be called synchronously inside the click that takes control, or browsers keep the context suspended. */
  start() {
    if (this.context) return;
    const Context = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Context) return;
    const context = new Context();
    this.context = context;
    void context.resume().catch(() => undefined);
    const gain = context.createGain(); gain.gain.value = 0;
    const filter = context.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 900; filter.Q.value = .8;
    filter.connect(gain); gain.connect(context.destination);
    this.rotors = [0, 7, -5, 12].map(detune => {
      const rotor = context.createOscillator();
      rotor.type = 'sawtooth'; rotor.frequency.value = 170; rotor.detune.value = detune * 10;
      const level = context.createGain(); level.gain.value = .16;
      rotor.connect(level); level.connect(filter); rotor.start();
      return rotor;
    });
    const noise = context.createBuffer(1, context.sampleRate * 2, context.sampleRate);
    const samples = noise.getChannelData(0);
    for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
    const source = context.createBufferSource(); source.buffer = noise; source.loop = true;
    const band = context.createBiquadFilter(); band.type = 'bandpass'; band.frequency.value = 700; band.Q.value = .6;
    const wash = context.createGain(); wash.gain.value = .25;
    source.connect(band); band.connect(wash); wash.connect(gain); source.start();
    gain.gain.setTargetAtTime(.22, context.currentTime, .4);
    Object.assign(this, { gain, filter, wash });
  }

  get running() { return this.context?.state === 'running'; }

  /** Throttle 0 (idle hover) to 1 (full climb and translation). */
  update(throttle: number) {
    const context = this.context;
    if (!context || !this.gain || !this.filter || !this.wash || !Number.isFinite(throttle)) return;
    const t = Math.min(1, Math.max(0, throttle)), now = context.currentTime;
    for (const rotor of this.rotors) rotor.frequency.setTargetAtTime(165 + t * 95, now, .15);
    this.filter.frequency.setTargetAtTime(800 + t * 900, now, .2);
    this.wash.gain.setTargetAtTime(.22 + t * .25, now, .2);
    this.gain.gain.setTargetAtTime(.2 + t * .1, now, .2);
  }

  stop() {
    const context = this.context;
    this.context = null;
    if (!context) return;
    this.gain?.gain.setTargetAtTime(0, context.currentTime, .05);
    window.setTimeout(() => void context.close().catch(() => undefined), 200);
  }
}
