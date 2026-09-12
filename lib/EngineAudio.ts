// Procedural Web Audio engine sound synthesizer
export class EngineAudio {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private osc1: OscillatorNode | null = null;
  private osc2: OscillatorNode | null = null;
  private subOsc: OscillatorNode | null = null;
  private filter: BiquadFilterNode | null = null;
  private isRunning: boolean = false;
  private isMuted: boolean = true;

  constructor() {
    // AudioContext will be initialized on first user interaction
  }

  private init() {
    if (this.ctx) return;
    try {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AudioCtx();

      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.setValueAtTime(this.isMuted ? 0 : 0.15, this.ctx.currentTime);

      this.filter = this.ctx.createBiquadFilter();
      this.filter.type = 'lowpass';
      this.filter.frequency.setValueAtTime(800, this.ctx.currentTime);
      this.filter.Q.setValueAtTime(3, this.ctx.currentTime);

      // Primary engine tone (sawtooth for rich combustion harmonics)
      this.osc1 = this.ctx.createOscillator();
      this.osc1.type = 'sawtooth';
      this.osc1.frequency.setValueAtTime(50, this.ctx.currentTime);

      // Secondary tone (triangle for mechanical resonance)
      this.osc2 = this.ctx.createOscillator();
      this.osc2.type = 'triangle';
      this.osc2.frequency.setValueAtTime(100, this.ctx.currentTime);

      // Sub-bass rumble
      this.subOsc = this.ctx.createOscillator();
      this.subOsc.type = 'sine';
      this.subOsc.frequency.setValueAtTime(25, this.ctx.currentTime);

      const gain1 = this.ctx.createGain();
      gain1.gain.value = 0.4;
      const gain2 = this.ctx.createGain();
      gain2.gain.value = 0.35;
      const gainSub = this.ctx.createGain();
      gainSub.gain.value = 0.25;

      this.osc1.connect(gain1).connect(this.filter);
      this.osc2.connect(gain2).connect(this.filter);
      this.subOsc.connect(gainSub).connect(this.filter);

      this.filter.connect(this.masterGain);
      this.masterGain.connect(this.ctx.destination);

      this.osc1.start();
      this.osc2.start();
      this.subOsc.start();
      this.isRunning = true;
    } catch {
      // Ignore if audio is not allowed in iframe
    }
  }

  public update(rpm: number, isAccelerating: boolean) {
    if (!this.ctx || !this.isRunning || this.isMuted) return;

    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }

    const t = this.ctx.currentTime;
    // Map RPM (800 - 8000) to engine frequencies
    const baseFreq = Math.max(30, (rpm / 8000) * 190 + 35);

    this.osc1?.frequency.setTargetAtTime(baseFreq, t, 0.05);
    this.osc2?.frequency.setTargetAtTime(baseFreq * 1.5, t, 0.05);
    this.subOsc?.frequency.setTargetAtTime(baseFreq * 0.5, t, 0.05);

    // Filter opens up as RPM rises and when throttle is pressed
    const cutoff = (rpm / 8000) * 2800 + (isAccelerating ? 900 : 350);
    this.filter?.frequency.setTargetAtTime(Math.min(cutoff, 4500), t, 0.06);

    const targetGain = isAccelerating ? 0.22 : 0.12;
    this.masterGain?.gain.setTargetAtTime(targetGain, t, 0.08);
  }

  public toggleMute(): boolean {
    if (!this.ctx) {
      this.init();
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    this.isMuted = !this.isMuted;
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(this.isMuted ? 0 : 0.18, this.ctx.currentTime, 0.05);
    }
    return !this.isMuted;
  }

  public getIsMuted(): boolean {
    return this.isMuted;
  }
}
