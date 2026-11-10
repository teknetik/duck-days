/**
 * Duck Days - soundscape (Web Audio API only, no libraries).
 *
 * Every sound can be synthesised here from oscillators and noise. Where a recorded clip has
 * loaded (SampleBank: birdsong, reeds, lapping, the underwater bed, paddle strokes, splashes,
 * bubbles, quacks) it takes that sound's place on the same bus; where it has not, the
 * synthesised version plays. The two never double up.
 *
 * Signal flow
 * -----------
 *   bird voices --+---------------------------+
 *                 +--> reverbIn -> convolver -+
 *   rustle, breeze, laps, wake hiss,          |
 *   paddle, splash, quack --------------------+-> above -> lowpass(submersion) -> aboveLevel -+
 *   rumble, drone, bubble blips ----------------> under (gain = submersion) ------------------+
 *   underwater quack (own lowpass) -------------> direct -------------------------------------+
 *                                                                                             |
 *                                                          master (mute) -> limiter -> destination
 *
 * CPU notes: two noise AudioBuffers are generated once and shared by every noise voice; the
 * continuous beds are seven looping sources through a handful of biquads; every one-shot is a
 * short-lived sub-graph that is counted, capped, and disconnected when its source ends. All
 * movement is AudioParam automation - no ScriptProcessor / AudioWorklet, no timers.
 */

import { SampleBank, dbToGain, type Clip } from './SampleBank';

export interface AudioFrameState {
  /** 0 = camera fully above water, 1 = camera fully below. Smoothly varying. */
  submersion: number;
  /** Duck horizontal speed in m/s (0..~2). */
  speed: number;
  /** True while the duck's body is under the surface. */
  duckUnder: boolean;
  /** 0..1 current breeze/gust strength. */
  breeze: number;
  /** 0..1 how close the listener is to reed beds (drives rustle loudness). */
  nearReeds: number;
}

export interface QuackTiming {
  /** Syllable windows in seconds relative to "now", for beak animation sync. */
  syllables: Array<{ start: number; duration: number }>;
  /** Total length in seconds. */
  duration: number;
}

/* ------------------------------------------------------------------------------------------ */
/* Mix (linear gains), calibrated on offline renders of the whole graph, limiter included:    */
/* bird phrases peak around -17 to -23 dBFS over beds near -40 dBFS RMS; the quack and a      */
/* full-strength dive peak near -8 dBFS. Each constant scales one layer and nothing else.     */
/* ------------------------------------------------------------------------------------------ */

const MASTER_LEVEL = 0.9;
const BIRD_LEVEL = 1.4;
const REVERB_RETURN = 1.25;
const RUSTLE_LEVEL = 0.2;
const BREEZE_LEVEL = 0.07;
const WAKE_LEVEL = 0.075;
const LAP_LEVEL = 0.14;
const PADDLE_LEVEL = 0.11;
const SPLASH_LEVEL = 0.42;
const QUACK_LEVEL = 0.6;
const BUBBLE_LEVEL = 0.05;
const RUMBLE_LEVEL = 0.09;
const DRONE_LEVEL = 0.012;

/** Above-water bus lowpass: open cutoff, fully-submerged cutoff, and submerged level. */
/*
 * Recorded clips are levelled from their measured peak or RMS (manifest.json) to these
 * targets in dBFS at the bus, so a regenerated clip lands where the old one did. They mirror
 * what the synthesised layers measure.
 */
const BIRDSONG_PEAK_DB = -15;
const BIRDSONG_FAR_PEAK_DB = -18;
const REEDS_RMS_DB = -33; // beside the reeds in a full breeze
const LAPPING_RMS_DB = -47;
const UNDERWATER_RMS_DB = -30;
const PADDLE_PEAK_DB = -24;
const SPLASH_DIVE_PEAK_DB = -8;
const SPLASH_SURFACE_PEAK_DB = -13;
const BUBBLES_PEAK_DB = -22;
const QUACK_PEAK_DB = -8;
/** How much of the synthesised rumble stays under the recorded underwater bed. */
const RUMBLE_UNDER_SAMPLE = 0.35;

const FILTER_OPEN_HZ = 18000;
const FILTER_SUBMERGED_HZ = 450;
const SUBMERGED_LEVEL = 0.35;

/** Mute fade: four time constants of 20 ms is an ~80 ms click-free fade. */
const MUTE_TIME_CONSTANT = 0.02;
/** Ambience is scheduled this far ahead of ctx.currentTime from update(). */
const LOOKAHEAD = 0.2;
/** Smoothed parameters are pushed to the graph at ~25 Hz rather than every frame. */
const PARAM_INTERVAL = 0.04;
/**
 * One-shots start this far in the future so their attack ramps are still ahead of the audio
 * thread even with a large hardware buffer (a ramp scheduled in the past becomes a click).
 */
const START_OFFSET = 0.02;
/** Voice caps: ambience/incidental sounds, and the higher cap quack and splash may use. */
const MAX_VOICES = 20;
const MAX_VOICES_PRIORITY = 28;

/* ------------------------------------------------------------------------------------------ */
/* Sound tables                                                                               */
/* ------------------------------------------------------------------------------------------ */

type Species = 'blackbird' | 'wren' | 'chiffchaff' | 'greatTit' | 'woodPigeon';

const SPECIES: ReadonlyArray<{ id: Species; weight: number }> = [
  { id: 'blackbird', weight: 3 },
  { id: 'wren', weight: 2 },
  { id: 'chiffchaff', weight: 2 },
  { id: 'greatTit', weight: 2 },
  { id: 'woodPigeon', weight: 1 },
];

/** Melodic steps a blackbird phrase wanders by (roughly thirds, fourths and fifths). */
const BLACKBIRD_STEPS: readonly number[] = [0.75, 0.8, 0.84, 0.89, 1.12, 1.19, 1.26, 1.335, 1.5];

/** Wood pigeon "coo COOO coo, coo-coo": note lengths, the gap after each, and stress. */
const COO_DUR: readonly number[] = [0.27, 0.52, 0.36, 0.24, 0.3];
const COO_GAP: readonly number[] = [0.07, 0.09, 0.24, 0.07, 0];
const COO_AMP: readonly number[] = [0.6, 1.0, 0.8, 0.6, 0.72];

/** Quack syllables: first is longest and loudest, each one after is shorter and quieter. */
const QUACK_DUR: readonly number[] = [0.22, 0.16, 0.135, 0.115];
const QUACK_AMP: readonly number[] = [1.0, 0.74, 0.56, 0.42];
/** Parallel band-pass "formants" [Hz, Q, gain] that turn a buzz into a nasal quack. */
const QUACK_FORMANTS: ReadonlyArray<readonly [number, number, number]> = [
  [950, 5, 1.0],
  [1750, 6, 1.0],
  [2900, 6.5, 0.6],
];

/** A short rising sine glide: start range, end range, length range (s), max pan. */
interface BlipSpec {
  from: readonly [number, number];
  to: readonly [number, number];
  dur: readonly [number, number];
  pan: number;
}

const BUBBLE: BlipSpec = { from: [500, 900], to: [1400, 2200], dur: [0.04, 0.09], pan: 0.45 };
const BUBBLE_FAR: BlipSpec = { from: [420, 800], to: [1200, 1900], dur: [0.05, 0.09], pan: 0.9 };
const DRIP: BlipSpec = { from: [1700, 3000], to: [2400, 4400], dur: [0.03, 0.06], pan: 0.55 };

/* ------------------------------------------------------------------------------------------ */
/* Small helpers                                                                              */
/* ------------------------------------------------------------------------------------------ */

const noop = (): void => {};
const rand = (min: number, max: number): number => min + Math.random() * (max - min);
const randInt = (min: number, max: number): number => Math.floor(rand(min, max + 1));
const pick = (list: readonly number[]): number => list[Math.floor(Math.random() * list.length)];
const clamp = (v: number, min: number, max: number): number => (v < min ? min : v > max ? max : v);
/** Clamp to 0..1, mapping NaN/Infinity to 0 so nothing non-finite ever reaches an AudioParam. */
const clamp01 = (v: number): number => (Number.isFinite(v) ? clamp(v, 0, 1) : 0);

function mkGain(ctx: BaseAudioContext, value: number): GainNode {
  const node = ctx.createGain();
  node.gain.value = value;
  return node;
}

function mkFilter(
  ctx: BaseAudioContext,
  type: BiquadFilterType,
  frequency: number,
  q: number,
): BiquadFilterNode {
  const node = ctx.createBiquadFilter();
  node.type = type;
  node.frequency.value = frequency;
  node.Q.value = q;
  return node;
}

/** Sustained note: linear attack, hold, linear release. Starts and ends at exactly 0. */
function swell(
  p: AudioParam,
  t: number,
  peak: number,
  attack: number,
  dur: number,
  release: number,
): void {
  const a = Math.min(attack, dur * 0.45);
  const r = Math.min(release, dur * 0.45);
  p.setValueAtTime(0, t);
  p.linearRampToValueAtTime(peak, t + a);
  p.setValueAtTime(peak, t + dur - r);
  p.linearRampToValueAtTime(0, t + dur);
}

/** Percussive note: quick linear attack, exponential decay. Starts and ends at exactly 0. */
function pluck(p: AudioParam, t: number, peak: number, attack: number, dur: number): void {
  const a = Math.min(attack, dur * 0.4);
  const tail = Math.min(0.004, dur * 0.2);
  const top = Math.max(peak, 1e-5);
  p.setValueAtTime(0, t);
  p.linearRampToValueAtTime(top, t + a);
  p.exponentialRampToValueAtTime(top * 0.02, t + dur - tail);
  p.linearRampToValueAtTime(0, t + dur);
}

function makeWhiteNoise(ctx: BaseAudioContext, seconds: number): AudioBuffer {
  const length = Math.floor(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

/**
 * Brown-ish noise (leaky integrator, -6 dB/oct above ~150 Hz). The end is cross-faded into the
 * start so the loop point is continuous - low-passed loops would otherwise thump once per pass.
 */
function makeBrownNoise(ctx: BaseAudioContext, seconds: number): AudioBuffer {
  const sampleRate = ctx.sampleRate;
  const length = Math.floor(sampleRate * seconds);
  const fade = Math.floor(sampleRate * 0.25);
  const raw = new Float32Array(length + fade);
  let last = 0;
  for (let i = 0; i < raw.length; i++) {
    last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
    raw[i] = last;
  }
  const buffer = ctx.createBuffer(1, length, sampleRate);
  const data = buffer.getChannelData(0);
  let peak = 1e-6;
  for (let i = 0; i < length; i++) {
    let v = raw[i];
    if (i < fade) {
      const x = i / fade;
      v = v * Math.sqrt(x) + raw[length + i] * Math.sqrt(1 - x);
    }
    data[i] = v;
    peak = Math.max(peak, Math.abs(v));
  }
  const scale = 0.9 / peak;
  for (let i = 0; i < length; i++) data[i] *= scale;
  return buffer;
}

/**
 * Woodland reverb impulse: decorrelated stereo noise with an exponential decay, a short
 * pre-delay, and a lowpass that closes over time (foliage soaks up highs first).
 */
function makeImpulse(ctx: BaseAudioContext, seconds: number): AudioBuffer {
  const sampleRate = ctx.sampleRate;
  const length = Math.floor(sampleRate * seconds);
  const buffer = ctx.createBuffer(2, length, sampleRate);
  const preDelay = Math.floor(sampleRate * 0.014);
  const fadeIn = Math.floor(sampleRate * 0.02);
  const fadeOut = Math.floor(sampleRate * 0.05);
  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    let lp = 0;
    for (let i = preDelay; i < length; i++) {
      const x = (i - preDelay) / (length - preDelay);
      lp += (0.7 - 0.5 * x) * (Math.random() * 2 - 1 - lp);
      let v = lp * Math.exp(-6.5 * x);
      if (i - preDelay < fadeIn) v *= (i - preDelay) / fadeIn;
      if (i > length - fadeOut) v *= (length - i) / fadeOut;
      data[i] = v;
    }
  }
  return buffer;
}

/* ------------------------------------------------------------------------------------------ */
/* Graph                                                                                      */
/* ------------------------------------------------------------------------------------------ */

interface Graph {
  ctx: AudioContext;
  master: GainNode;
  limiter: DynamicsCompressorNode;
  /** Above-water bus input. */
  above: GainNode;
  aboveFilter: BiquadFilterNode;
  aboveLevel: GainNode;
  /** Underwater bus input; its gain follows submersion. */
  under: GainNode;
  /** Straight to master, for sounds that carry their own underwater filtering. */
  direct: GainNode;
  reverbIn: GainNode;
  white: AudioBuffer;
  brown: AudioBuffer;
  /** Sine with a touch of 2nd/3rd harmonic - a rounder, more flute-like bird tone. */
  flute: PeriodicWave;
  rustleGain: GainNode;
  rustleTone: BiquadFilterNode;
  breezeGain: GainNode;
  wakeGain: GainNode;
  wakeBand: BiquadFilterNode;
  rumbleGain: GainNode;
  droneGain: GainNode;
  /** Level of the recorded reed loop, once it has loaded. */
  reedsGain: GainNode | null;
  /** Always-on sources, stopped on dispose. */
  loops: AudioScheduledSourceNode[];
}

interface Perch {
  pan: number;
  /** 0 = close, 1 = far across the pond. */
  dist: number;
}

interface BirdVoice {
  osc: OscillatorNode;
  freq: AudioParam;
  amp: AudioParam;
  /** Envelope gain node; extra sources (e.g. breath noise) can be summed into it. */
  ampNode: GainNode;
  sources: AudioScheduledSourceNode[];
  nodes: AudioNode[];
}

export class AudioSystem {
  /**
   * Settles once the recorded clips have loaded (or failed to). Until then, and for anything
   * that failed, the synthesised sounds play. Resolved from the start if audio never unlocks.
   */
  ready: Promise<void> = Promise.resolve();
  private readonly samples = new SampleBank();
  /** Which continuous layers the recordings have taken over from the synthesiser. */
  private recorded = { birds: false, reeds: false, lapping: false };
  private lastStroke = -1;
  private lastQuack = -1;
  private g: Graph | null = null;
  private failed = false;
  private disposed = false;
  private isMuted = false;

  private duckUnder = false;
  private submersion = 0;

  /** Active one-shot voices and their sources (so dispose can stop them). */
  private voices = 0;
  private readonly live = new Set<AudioScheduledSourceNode>();
  /** Last target pushed per AudioParam, so unchanged values schedule nothing. */
  private readonly targets = new Map<AudioParam, number>();

  private paramClock = PARAM_INTERVAL;
  private gust = 0.4;
  private gustTarget = 0.4;
  private gustTimer = 0;

  private nextBird = 0;
  private nextTsip = 0;
  private nextLap = 0;
  private nextDeepBubble = 0;
  private lastSpecies: Species | null = null;
  /** Each species sings from a spot it keeps for a few phrases before moving. */
  private readonly perches: Record<Species, Perch> = {
    blackbird: { pan: rand(-0.8, 0.8), dist: rand(0.15, 0.7) },
    wren: { pan: rand(-0.8, 0.8), dist: rand(0.2, 0.8) },
    chiffchaff: { pan: rand(-0.8, 0.8), dist: rand(0.3, 0.9) },
    greatTit: { pan: rand(-0.8, 0.8), dist: rand(0.2, 0.8) },
    woodPigeon: { pan: rand(-0.8, 0.8), dist: rand(0.4, 0.9) },
  };

  /** True once an AudioContext exists and is running. */
  get unlocked(): boolean {
    return this.g !== null && this.g.ctx.state === 'running';
  }

  get muted(): boolean {
    return this.isMuted;
  }

  /** Safe to call repeatedly; call from a user gesture. Creates/resumes the context. */
  unlock(): void {
    if (this.disposed || this.failed) return;
    try {
      let g = this.g;
      if (!g) {
        // The webkit-prefixed fallback is the one place `any` is needed.
        const Ctor: typeof AudioContext | undefined =
          window.AudioContext || (window as any).webkitAudioContext;
        if (!Ctor) {
          this.failed = true;
          return;
        }
        // Any failure from here on (no device, unsupported node) disables audio for good
        // rather than retrying on every later gesture.
        this.failed = true;
        const ctx = new Ctor();
        try {
          g = this.buildGraph(ctx);
        } catch {
          try {
            void ctx.close().catch(noop);
          } catch {
            /* nothing more to clean up */
          }
          return;
        }
        this.failed = false;
        this.g = g;
        const now = ctx.currentTime;
        // Ease the whole soundscape in rather than switching it on.
        if (!this.isMuted) g.master.gain.setTargetAtTime(MASTER_LEVEL, now, 0.35);
        this.nextBird = now + rand(0.5, 1.4);
        this.nextTsip = now + rand(3, 6);
        this.nextLap = now + rand(1.5, 3.5);
        this.nextDeepBubble = now + rand(0.5, 2);
        document.addEventListener('visibilitychange', this.onVisibility);
        const built = g;
        this.ready = this.samples
          .load(ctx, import.meta.env.BASE_URL)
          .then(() => this.startRecordedBeds(built))
          .catch(noop);
      }
      if (g.ctx.state !== 'running') void g.ctx.resume().catch(noop);
    } catch {
      /* audio is optional: stay silent */
    }
  }

  setMuted(muted: boolean): void {
    this.isMuted = muted;
    const g = this.g;
    if (!g) return;
    try {
      // setTargetAtTime needs no knowledge of the current value, so it can never click.
      g.master.gain.setTargetAtTime(muted ? 0 : MASTER_LEVEL, g.ctx.currentTime, MUTE_TIME_CONSTANT);
    } catch {
      /* ignore */
    }
  }

  /** Per-frame parameter smoothing + ambience scheduling. A cheap no-op before unlock(). */
  update(dt: number, state: AudioFrameState): void {
    this.duckUnder = state.duckUnder;
    const g = this.g;
    if (!g || g.ctx.state !== 'running') return;
    try {
      const now = g.ctx.currentTime;
      const step = dt > 0 && dt < 0.25 ? dt : 0.016;
      this.submersion = clamp01(state.submersion);
      this.wanderGust(step);
      this.paramClock += step;
      if (this.paramClock >= PARAM_INTERVAL) {
        this.paramClock = 0;
        this.pushParams(g, now, state);
      }
      if (!this.isMuted) this.scheduleAmbience(g, now);
    } catch {
      /* never let audio break the game loop */
    }
  }

  /** Mallard quack. Always returns timing so the beak animation plays even when silent. */
  quack(): QuackTiming {
    const recorded = this.recordedQuack();
    if (recorded) return recorded;
    const count = Math.random() < 0.5 ? 3 : 4;
    const syllables: QuackTiming['syllables'] = [];
    let t = 0;
    for (let i = 0; i < count; i++) {
      const duration = QUACK_DUR[i] * rand(0.94, 1.06);
      syllables.push({ start: t, duration });
      t += duration + rand(0.06, 0.08);
    }
    const last = syllables[count - 1];
    const timing: QuackTiming = { syllables, duration: last.start + last.duration };

    const g = this.active();
    if (g) {
      try {
        this.voiceQuack(g, timing, g.ctx.currentTime + START_OFFSET);
      } catch {
        /* timing is still valid */
      }
    }
    return timing;
  }

  /** One webbed-foot stroke: a soft watery "plip-swish". */
  paddle(side: -1 | 1, strength: number): void {
    const g = this.active();
    if (!g) return;
    try {
      const s = clamp01(strength);
      if (s <= 0.01 || !this.canVoice()) return;
      const ctx = g.ctx;
      const t = ctx.currentTime + START_OFFSET;
      if (this.recordedStroke(g, t, side, s)) return;
      const dur = rand(0.12, 0.18);
      const level = PADDLE_LEVEL * (0.35 + 0.65 * s) * rand(0.8, 1.1);

      // Swish: noise through a band-pass that falls as the foot pushes water back.
      const noise = this.noiseSource(g, g.white);
      const band = mkFilter(ctx, 'bandpass', 2200, rand(0.9, 1.5));
      band.frequency.setValueAtTime(rand(1900, 2700), t);
      band.frequency.exponentialRampToValueAtTime(rand(600, 900), t + dur);
      const swish = mkGain(ctx, 0);
      swish.gain.setValueAtTime(0, t);
      swish.gain.linearRampToValueAtTime(level, t + 0.012);
      swish.gain.exponentialRampToValueAtTime(level * 0.12, t + dur - 0.03);
      swish.gain.linearRampToValueAtTime(0, t + dur);

      // Plip: a tiny rising sine, the little air pocket closing behind the foot.
      const osc = ctx.createOscillator();
      const f0 = rand(340, 460);
      osc.frequency.setValueAtTime(f0, t);
      osc.frequency.exponentialRampToValueAtTime(f0 * rand(1.6, 2.1), t + 0.045);
      const plip = mkGain(ctx, 0);
      pluck(plip.gain, t, level * rand(0.15, 0.35), 0.004, rand(0.045, 0.06));

      const pan = this.panner(g, side * 0.28 + rand(-0.1, 0.1));
      noise.connect(band);
      band.connect(swish);
      swish.connect(pan);
      osc.connect(plip);
      plip.connect(pan);
      pan.connect(g.above);

      noise.start(t, Math.random() * g.white.duration);
      osc.start(t);
      this.release([noise, osc], [band, swish, plip, pan], t + dur + 0.02);
    } catch {
      /* ignore */
    }
  }

  /** 'dive' = plunge with a low thump and bubbling tail; 'surface' = light splash + drips. */
  splash(kind: 'dive' | 'surface', intensity: number): void {
    const g = this.active();
    if (!g) return;
    try {
      // Even the gentlest dive should read as a splash.
      const amount = 0.3 + 0.7 * clamp01(intensity);
      const t = g.ctx.currentTime + START_OFFSET;
      const clip = this.samples.get(kind === 'dive' ? 'splashDive' : 'splashSurface');
      if (clip) {
        const peak = kind === 'dive' ? SPLASH_DIVE_PEAK_DB : SPLASH_SURFACE_PEAK_DB;
        this.playClip(g, clip, g.above, t, {
          gain: dbToGain(peak - clip.info.peakDb) * amount,
          rate: rand(0.95, 1.06),
          pan: rand(-0.12, 0.12),
          priority: true,
        });
      } else if (kind === 'dive') this.diveSplash(g, t, amount);
      else this.surfaceSplash(g, t, amount);
    } catch {
      /* ignore */
    }
  }

  /** A few soft underwater bubble blips. */
  bubbles(amount: number): void {
    const g = this.active();
    if (!g) return;
    try {
      const a = clamp01(amount);
      if (a <= 0) return;
      const count = 2 + Math.round(a * 5);
      const t = g.ctx.currentTime + START_OFFSET;
      const clip = this.samples.get('bubbles');
      if (clip) {
        // A short excerpt from somewhere in the recording, so no two bursts match.
        const [from, to] = clip.info.trim ?? [0, clip.info.seconds];
        const length = Math.min(to - from, 0.3 + 0.45 * a);
        this.playClip(g, clip, g.under, t, {
          gain: dbToGain(BUBBLES_PEAK_DB - clip.info.peakDb) * (0.5 + 0.5 * a),
          rate: rand(0.9, 1.25),
          pan: rand(-0.4, 0.4),
          offset: from + Math.random() * Math.max(0, to - from - length),
          duration: length,
          fade: 0.06,
        });
        return;
      }
      const span = 0.2 + 0.35 * a;
      const level = BUBBLE_LEVEL * (0.5 + 0.5 * a);
      // Two interleaved strands so neighbouring blips can sit at different pan positions.
      this.blipStrand(g, g.under, t, Math.ceil(count / 2), span, level, BUBBLE);
      this.blipStrand(g, g.under, t + rand(0.02, 0.07), Math.floor(count / 2), span, level, BUBBLE);
    } catch {
      /* ignore */
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const g = this.g;
    this.g = null;
    try {
      document.removeEventListener('visibilitychange', this.onVisibility);
    } catch {
      /* no document */
    }
    if (!g) return;
    for (const source of [...this.live, ...g.loops]) {
      try {
        source.onended = null;
        source.stop();
        source.disconnect();
      } catch {
        /* already stopped */
      }
    }
    this.live.clear();
    this.targets.clear();
    this.voices = 0;
    try {
      g.master.disconnect();
      g.limiter.disconnect();
      void g.ctx.close().catch(noop);
    } catch {
      /* already closed */
    }
  }

  /* ---------------------------------------------------------------------------------------- */
  /* Lifecycle internals                                                                      */
  /* ---------------------------------------------------------------------------------------- */

  private readonly onVisibility = (): void => {
    const g = this.g;
    if (!g) return;
    try {
      if (document.hidden) {
        if (g.ctx.state === 'running') void g.ctx.suspend().catch(noop);
      } else if (g.ctx.state !== 'closed') {
        void g.ctx.resume().catch(noop);
      }
    } catch {
      /* ignore */
    }
  };

  /** The graph, only when a one-shot would actually be heard. */
  private active(): Graph | null {
    const g = this.g;
    return g && !this.isMuted && g.ctx.state === 'running' ? g : null;
  }

  private buildGraph(ctx: AudioContext): Graph {
    const white = makeWhiteNoise(ctx, 2);
    const brown = makeBrownNoise(ctx, 5);

    // Safety limiter: transparent at normal levels, catches stacked splash + quack peaks.
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -4;
    limiter.knee.value = 4;
    limiter.ratio.value = 16;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.15;
    limiter.connect(ctx.destination);

    const master = mkGain(ctx, 0);
    master.connect(limiter);

    const aboveLevel = mkGain(ctx, 1);
    aboveLevel.connect(master);
    const aboveFilter = mkFilter(ctx, 'lowpass', Math.min(FILTER_OPEN_HZ, ctx.sampleRate * 0.45), 0.5);
    aboveFilter.connect(aboveLevel);
    const above = mkGain(ctx, 1);
    above.connect(aboveFilter);

    const under = mkGain(ctx, 0);
    under.connect(master);
    const direct = mkGain(ctx, 1);
    direct.connect(master);

    // Reverb: birds only, so they sit back among the trees while water sounds stay close.
    const reverbIn = mkGain(ctx, 1);
    const convolver = ctx.createConvolver();
    convolver.buffer = makeImpulse(ctx, 1.6);
    const reverbOut = mkGain(ctx, REVERB_RETURN);
    reverbIn.connect(convolver);
    convolver.connect(reverbOut);
    reverbOut.connect(above);

    const flute = ctx.createPeriodicWave(
      new Float32Array([0, 0, 0, 0]),
      new Float32Array([0, 1, 0.18, 0.06]),
    );

    // --- Continuous beds: four looping noise sources shared between five layers. ---
    const loops: AudioScheduledSourceNode[] = [];
    const loop = (buffer: AudioBuffer, rate: number): AudioBufferSourceNode => {
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      source.playbackRate.value = rate;
      source.start(0, Math.random() * buffer.duration);
      loops.push(source);
      return source;
    };
    const whiteLoop = loop(white, 1);
    const brownLoop = loop(brown, 1);
    // Brown noise played far below pitch is a free random control signal: 50x slow gives a
    // smooth sway a few Hz wide, 4x slow a grainy flutter of tens of Hz. Used as amplitude
    // modulators they turn steady hiss into something that moves like leaves and water.
    const swayLoop = loop(brown, 0.02);
    const grainLoop = loop(brown, 0.25);

    // Reed/leaf rustle: 2.5-7 kHz noise, swaying slowly and flickering quickly.
    const rustleHigh = mkFilter(ctx, 'highpass', 2500, 0.6);
    const rustleTone = mkFilter(ctx, 'lowpass', 6500, 0.6);
    const flutter = mkGain(ctx, 0.5);
    const swayDepth = mkGain(ctx, 0.35);
    const grainDepth = mkGain(ctx, 0.45);
    const rustleGain = mkGain(ctx, 0);
    whiteLoop.connect(rustleHigh);
    rustleHigh.connect(rustleTone);
    rustleTone.connect(flutter);
    flutter.connect(rustleGain);
    rustleGain.connect(above);
    swayLoop.connect(swayDepth);
    swayDepth.connect(flutter.gain);
    grainLoop.connect(grainDepth);
    grainDepth.connect(flutter.gain);

    // Breeze bed: brown noise under ~460 Hz, with the sub-bass rolled off.
    const breezeLow = mkFilter(ctx, 'highpass', 70, 0.5);
    const breezeTop = mkFilter(ctx, 'lowpass', 460, 0.5);
    const breezeGain = mkGain(ctx, 0);
    brownLoop.connect(breezeLow);
    breezeLow.connect(breezeTop);
    breezeTop.connect(breezeGain);
    breezeGain.connect(above);

    // Wake hiss: mid band whose level and brightness follow swimming speed, with the grainy
    // modulator giving it the uneven trickle of water parting around the duck.
    const wakeBand = mkFilter(ctx, 'bandpass', 1500, 0.8);
    const wakeTrickle = mkGain(ctx, 0.6);
    const trickleDepth = mkGain(ctx, 1.0);
    const wakeGain = mkGain(ctx, 0);
    whiteLoop.connect(wakeBand);
    wakeBand.connect(wakeTrickle);
    wakeTrickle.connect(wakeGain);
    wakeGain.connect(above);
    grainLoop.connect(trickleDepth);
    trickleDepth.connect(wakeTrickle.gain);

    // Underwater pressure: noise under ~170 Hz plus slowly beating low sines.
    const rumbleTop = mkFilter(ctx, 'lowpass', 170, 0.7);
    const rumbleGain = mkGain(ctx, RUMBLE_LEVEL);
    brownLoop.connect(rumbleTop);
    rumbleTop.connect(rumbleGain);
    rumbleGain.connect(under);
    const droneGain = mkGain(ctx, DRONE_LEVEL);
    droneGain.connect(under);
    for (const frequency of [57, 57.4, 78.3]) {
      const osc = ctx.createOscillator();
      osc.frequency.value = frequency;
      osc.connect(droneGain);
      osc.start();
      loops.push(osc);
    }

    return {
      ctx,
      master,
      limiter,
      above,
      aboveFilter,
      aboveLevel,
      under,
      direct,
      reverbIn,
      white,
      brown,
      flute,
      rustleGain,
      rustleTone,
      breezeGain,
      wakeGain,
      wakeBand,
      rumbleGain,
      droneGain,
      reedsGain: null,
      loops,
    };
  }

  /* ---------------------------------------------------------------------------------------- */
  /* Per-frame smoothing                                                                      */
  /* ---------------------------------------------------------------------------------------- */

  /** Slow random walk (0..1) that makes rustle and breeze swell and fall like real gusts. */
  private wanderGust(dt: number): void {
    this.gustTimer -= dt;
    if (this.gustTimer <= 0) {
      this.gustTarget = Math.pow(Math.random(), 1.5);
      this.gustTimer = rand(1.2, 4.5);
    }
    this.gust += (this.gustTarget - this.gust) * Math.min(1, dt * 0.9);
  }

  private pushParams(g: Graph, now: number, state: AudioFrameState): void {
    const sub = this.submersion;
    const breeze = clamp01(state.breeze);
    const reeds = clamp01(state.nearReeds);
    const speed = clamp01(state.speed / 2);
    const gust = this.gust;

    // Above-water bus: exponential cutoff glide reads as an even "going under" sweep.
    const open = Math.min(FILTER_OPEN_HZ, g.ctx.sampleRate * 0.45);
    const cutoff = open * Math.pow(FILTER_SUBMERGED_HZ / open, sub);
    this.glide(g.aboveFilter.frequency, cutoff, 0.06, now);
    this.glide(g.aboveLevel.gain, 1 - (1 - SUBMERGED_LEVEL) * sub, 0.06, now);
    this.glide(g.under.gain, sub, 0.06, now);

    // Rustle: loud beside reeds in a breeze, a faint leaf rustle everywhere else.
    const sway = (0.4 + 0.6 * reeds) * (0.35 + 0.65 * breeze) * (0.4 + 0.6 * gust);
    if (g.reedsGain) {
      const clip = this.samples.get('reeds');
      const full = clip ? dbToGain(REEDS_RMS_DB - clip.info.rmsDb) : 0;
      this.glide(g.reedsGain.gain, full * sway, 0.25, now);
      this.glide(g.rustleGain.gain, 0, 0.25, now);
    } else {
      this.glide(g.rustleGain.gain, RUSTLE_LEVEL * sway, 0.25, now);
    }
    this.glide(g.rustleTone.frequency, 5200 + 1800 * gust, 0.4, now);

    this.glide(g.breezeGain.gain, BREEZE_LEVEL * (0.4 + 0.6 * breeze) * (0.8 + 0.2 * gust), 0.5, now);

    // No surface wake to hear while the duck itself is under.
    const wake = Math.pow(speed, 1.1) * (state.duckUnder ? 0.25 : 1);
    this.glide(g.wakeGain.gain, WAKE_LEVEL * wake, 0.15, now);
    this.glide(g.wakeBand.frequency, 1300 + 900 * speed, 0.2, now);
  }

  /** setTargetAtTime, skipped when the target has not meaningfully changed. */
  private glide(param: AudioParam, target: number, timeConstant: number, now: number): void {
    const last = this.targets.get(param);
    if (last !== undefined && Math.abs(last - target) <= 1e-5 + Math.abs(target) * 2e-3) return;
    this.targets.set(param, target);
    param.setTargetAtTime(target, now, timeConstant);
  }

  /* ---------------------------------------------------------------------------------------- */
  /* Voice plumbing                                                                           */
  /* ---------------------------------------------------------------------------------------- */

  private canVoice(priority = false): boolean {
    return this.voices < (priority ? MAX_VOICES_PRIORITY : MAX_VOICES);
  }

  /**
   * Registers a one-shot voice whose sources have already been started: stops them all at
   * `tEnd` and tears the sub-graph down when the first one ends.
   */
  private release(sources: AudioScheduledSourceNode[], nodes: AudioNode[], tEnd: number): void {
    this.voices++;
    for (const source of sources) {
      source.stop(tEnd);
      this.live.add(source);
    }
    const anchor = sources[0];
    anchor.onended = (): void => {
      anchor.onended = null;
      this.voices = Math.max(0, this.voices - 1);
      for (const source of sources) {
        this.live.delete(source);
        source.disconnect();
      }
      for (const node of nodes) node.disconnect();
    };
  }

  /** Looping noise source; start it at a random offset so no two bursts are alike. */
  private noiseSource(g: Graph, buffer: AudioBuffer): AudioBufferSourceNode {
    const source = g.ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    return source;
  }

  private panner(g: Graph, pan: number): AudioNode {
    if (typeof g.ctx.createStereoPanner === 'function') {
      const node = g.ctx.createStereoPanner();
      node.pan.value = clamp(pan, -1, 1);
      return node;
    }
    return g.ctx.createGain(); // very old WebKit: keep it centred
  }

  /**
   * A run of short rising sine glides (bubbles / drips) played by ONE oscillator, so a whole
   * cluster costs a single voice. Blips in a strand never overlap.
   */
  private blipStrand(
    g: Graph,
    dest: AudioNode,
    t0: number,
    count: number,
    span: number,
    level: number,
    spec: BlipSpec,
    priority = false,
  ): void {
    if (count <= 0 || level <= 0 || !this.canVoice(priority)) return;
    const ctx = g.ctx;
    const osc = ctx.createOscillator();
    const amp = mkGain(ctx, 0);
    const pan = this.panner(g, rand(-spec.pan, spec.pan));
    osc.connect(amp);
    amp.connect(pan);
    pan.connect(dest);

    const step = span / count;
    let t = t0 + rand(0, step * 0.5);
    for (let i = 0; i < count; i++) {
      const dur = rand(spec.dur[0], spec.dur[1]);
      const f0 = rand(spec.from[0], spec.from[1]);
      const f1 = Math.max(f0 * 1.1, rand(spec.to[0], spec.to[1]));
      osc.frequency.setValueAtTime(f0, t);
      osc.frequency.exponentialRampToValueAtTime(f1, t + dur);
      pluck(amp.gain, t, level * rand(0.55, 1), 0.004, dur);
      t += Math.max(dur + 0.012, step * rand(0.6, 1.4));
    }
    osc.start(t0);
    this.release([osc], [amp, pan], t + 0.02);
  }

  /* ---------------------------------------------------------------------------------------- */
  /* Recorded clips                                                                           */
  /* ---------------------------------------------------------------------------------------- */

  /** Starts whichever recorded loops loaded and hands those layers over from the synthesiser. */
  private startRecordedBeds(g: Graph): void {
    if (this.disposed || this.g !== g) return;
    const ctx = g.ctx;
    const now = ctx.currentTime;
    const bed = (clip: Clip, dest: AudioNode, gain: number, rate = 1): GainNode => {
      const source = ctx.createBufferSource();
      source.buffer = clip.buffer;
      source.loop = true;
      source.playbackRate.value = rate;
      const level = mkGain(ctx, 0);
      level.gain.setTargetAtTime(gain, now, 0.6);
      source.connect(level);
      level.connect(dest);
      source.start(now, Math.random() * clip.buffer.duration);
      g.loops.push(source);
      return level;
    };

    // Two birdsong recordings of different lengths drift against each other, so the
    // combined pattern takes minutes to come round again.
    const near = this.samples.get('birdsongA');
    const far = this.samples.get('birdsongB');
    if (near) bed(near, g.above, dbToGain(BIRDSONG_PEAK_DB - near.info.peakDb));
    if (far) bed(far, g.above, dbToGain(BIRDSONG_FAR_PEAK_DB - far.info.peakDb), 0.97);
    this.recorded.birds = Boolean(near || far);

    const reeds = this.samples.get('reeds');
    if (reeds) {
      g.reedsGain = bed(reeds, g.above, 0);
      g.reedsGain.gain.cancelScheduledValues(now);
      this.recorded.reeds = true;
    }

    const lapping = this.samples.get('lapping');
    if (lapping) {
      bed(lapping, g.above, dbToGain(LAPPING_RMS_DB - lapping.info.rmsDb));
      this.recorded.lapping = true;
    }

    const underwater = this.samples.get('underwater');
    if (underwater) {
      bed(underwater, g.under, dbToGain(UNDERWATER_RMS_DB - underwater.info.rmsDb));
      g.rumbleGain.gain.setTargetAtTime(RUMBLE_LEVEL * RUMBLE_UNDER_SAMPLE, now, 0.6);
      g.droneGain.gain.setTargetAtTime(DRONE_LEVEL * RUMBLE_UNDER_SAMPLE, now, 0.6);
    }
  }

  /** Plays a recorded one-shot (or an excerpt of one) into a bus. False if the voice cap is hit. */
  private playClip(
    g: Graph,
    clip: Clip,
    dest: AudioNode,
    t: number,
    options: {
      gain: number;
      rate?: number;
      pan?: number;
      offset?: number;
      duration?: number;
      fade?: number;
      priority?: boolean;
      /** Extra node between the clip and the bus (e.g. the underwater lowpass). */
      through?: AudioNode;
    }
  ): boolean {
    if (!this.canVoice(options.priority)) return false;
    const ctx = g.ctx;
    const [from, to] = clip.info.trim ?? [0, clip.info.seconds];
    const offset = options.offset ?? from;
    const rate = options.rate ?? 1;
    const length = Math.max(0.02, options.duration ?? to - offset);
    const played = length / rate;
    const source = ctx.createBufferSource();
    source.buffer = clip.buffer;
    source.playbackRate.value = rate;
    const level = mkGain(ctx, options.gain);
    const fade = Math.min(options.fade ?? 0.008, played / 2);
    level.gain.setValueAtTime(0, t);
    level.gain.linearRampToValueAtTime(options.gain, t + fade);
    level.gain.setValueAtTime(options.gain, t + played - fade);
    level.gain.linearRampToValueAtTime(0, t + played);
    const pan = this.panner(g, options.pan ?? 0);
    source.connect(level);
    level.connect(pan);
    const nodes: AudioNode[] = [level, pan];
    if (options.through) {
      pan.connect(options.through);
      options.through.connect(dest);
      nodes.push(options.through);
    } else {
      pan.connect(dest);
    }
    source.start(t, offset, length);
    this.release([source], nodes, t + played + 0.02);
    return true;
  }

  /** One of the strokes cut from the paddling recording. False if there is no recording. */
  private recordedStroke(g: Graph, t: number, side: -1 | 1, strength: number): boolean {
    const clip = this.samples.get('paddle');
    const slices = clip?.info.slices;
    if (!clip || !slices || slices.length === 0) return false;
    let index = randInt(0, slices.length - 1);
    if (slices.length > 1 && index === this.lastStroke) index = (index + 1) % slices.length;
    this.lastStroke = index;
    const slice = slices[index];
    this.playClip(g, clip, g.above, t, {
      gain: dbToGain(PADDLE_PEAK_DB - slice.peakDb) * (0.35 + 0.65 * strength) * rand(0.8, 1.1),
      rate: rand(0.92, 1.12),
      pan: side * 0.28 + rand(-0.1, 0.1),
      offset: slice.start,
      duration: slice.duration,
      fade: 0.012,
    });
    return true;
  }

  /**
   * A recorded quack, alternating between the takes. Returns its syllable timing for the
   * bill even when nothing can be heard (muted, not yet unlocked); null if no take loaded.
   */
  private recordedQuack(): QuackTiming | null {
    const takes = ['quackA', 'quackB']
      .map((id) => this.samples.get(id))
      .filter((clip): clip is Clip => clip !== null && (clip.info.syllables?.length ?? 0) > 0);
    if (takes.length === 0) return null;
    this.lastQuack = (this.lastQuack + 1) % takes.length;
    const clip = takes[this.lastQuack];
    const [from] = clip.info.trim ?? [0, clip.info.seconds];
    const syllables = (clip.info.syllables ?? []).map((s) => ({
      start: Math.max(0, s.start - from),
      duration: s.duration,
    }));
    const last = syllables[syllables.length - 1];
    const timing: QuackTiming = { syllables, duration: last.start + last.duration };

    const g = this.active();
    if (g) {
      try {
        const t = g.ctx.currentTime + START_OFFSET;
        const gain = dbToGain(QUACK_PEAK_DB - clip.info.peakDb);
        if (this.duckUnder) {
          // Under water: muffled, with bubbles, like the synthesised call. A recorded quack
          // has little below 1 kHz, so the filter sits higher and the level is made up.
          this.playClip(g, clip, g.direct, t, {
            gain: gain * 2.2,
            priority: true,
            through: mkFilter(g.ctx, 'lowpass', 1000, 0.7),
          });
          this.blipStrand(g, g.direct, t + 0.04, randInt(2, 3), timing.duration, BUBBLE_LEVEL, BUBBLE, true);
        } else {
          this.playClip(g, clip, g.above, t, { gain, rate: rand(0.97, 1.04), priority: true });
        }
      } catch {
        /* timing is still valid */
      }
    }
    return timing;
  }

  /** Recorded clips in use, for diagnostics. */
  get recordedClips(): string[] {
    return this.samples.loaded;
  }

  /* ---------------------------------------------------------------------------------------- */
  /* Ambience scheduling                                                                      */
  /* ---------------------------------------------------------------------------------------- */

  private scheduleAmbience(g: Graph, now: number): void {
    const horizon = now + LOOKAHEAD;

    if (!this.recorded.birds && horizon >= this.nextBird) {
      const t0 = Math.max(this.nextBird, now + 0.03);
      const species = this.pickSpecies();
      const length = this.sing(g, species, t0);
      this.lastSpecies = species;
      // Gaps are start-to-start, so a long phrase is sometimes overlapped by the next singer.
      let gap = rand(1.5, 4);
      if (Math.random() < 0.12) gap += rand(2.5, 5); // the wood falls quiet for a moment
      this.nextBird = t0 + Math.max(gap, length * 0.6);
    }

    if (!this.recorded.birds && horizon >= this.nextTsip) {
      const t0 = Math.max(this.nextTsip, now + 0.03);
      this.tsip(g, t0);
      this.nextTsip = t0 + rand(4, 11);
    }

    if (!this.recorded.lapping && horizon >= this.nextLap) {
      const t0 = Math.max(this.nextLap, now + 0.03);
      if (this.submersion < 0.8) {
        this.lap(g, t0, 1);
        if (Math.random() < 0.4) this.lap(g, t0 + rand(0.2, 0.34), 0.6);
      }
      this.nextLap = t0 + rand(2.5, 6.5);
    }

    if (horizon >= this.nextDeepBubble) {
      const t0 = Math.max(this.nextDeepBubble, now + 0.03);
      if (this.submersion > 0.2) {
        const level = BUBBLE_LEVEL * rand(0.2, 0.45);
        this.blipStrand(g, g.under, t0, randInt(1, 3), rand(0.15, 0.5), level, BUBBLE_FAR);
      }
      this.nextDeepBubble = t0 + rand(1.4, 4.5);
    }
  }

  private pickSpecies(): Species {
    const weightOf = (s: { id: Species; weight: number }): number =>
      s.id === this.lastSpecies ? s.weight * 0.3 : s.weight;
    let total = 0;
    for (const s of SPECIES) total += weightOf(s);
    let r = Math.random() * total;
    for (const s of SPECIES) {
      r -= weightOf(s);
      if (r <= 0) return s.id;
    }
    return 'blackbird';
  }

  private sing(g: Graph, species: Species, t0: number): number {
    switch (species) {
      case 'blackbird':
        return this.singBlackbird(g, t0);
      case 'wren':
        return this.singWren(g, t0);
      case 'chiffchaff':
        return this.singChiffchaff(g, t0);
      case 'greatTit':
        return this.singGreatTit(g, t0);
      case 'woodPigeon':
        return this.singWoodPigeon(g, t0);
    }
  }

  /* ---------------------------------------------------------------------------------------- */
  /* Birds - one oscillator per phrase; notes are frequency + gain automation on it.          */
  /* ---------------------------------------------------------------------------------------- */

  /** The species' current perch, occasionally hopping somewhere new. */
  private perch(species: Species): Perch {
    const p = this.perches[species];
    if (Math.random() < 0.22) {
      p.pan = rand(-0.85, 0.85);
      p.dist = rand(0.15, 0.9);
    }
    return p;
  }

  /**
   * osc -> envelope -> air lowpass (distance) -> pan -> dry + reverb send.
   * Distance lowers the level, dulls the top and raises the proportion of reverb.
   */
  private birdVoice(
    g: Graph,
    wave: 'sine' | 'triangle' | 'flute',
    perch: Perch,
    level: number,
  ): BirdVoice | null {
    if (!this.canVoice()) return null;
    const ctx = g.ctx;
    const osc = ctx.createOscillator();
    if (wave === 'flute') osc.setPeriodicWave(g.flute);
    else osc.type = wave;
    const amp = mkGain(ctx, 0);
    const air = mkFilter(ctx, 'lowpass', 15000 - 9000 * perch.dist, 0.5);
    const pan = this.panner(g, perch.pan);
    const dry = mkGain(ctx, BIRD_LEVEL * level * (1 - 0.72 * perch.dist));
    const wet = mkGain(ctx, BIRD_LEVEL * level * (0.22 + 0.45 * perch.dist));
    osc.connect(amp);
    amp.connect(air);
    air.connect(pan);
    pan.connect(dry);
    pan.connect(wet);
    dry.connect(g.above);
    wet.connect(g.reverbIn);
    return {
      osc,
      freq: osc.frequency,
      amp: amp.gain,
      ampNode: amp,
      sources: [osc],
      nodes: [amp, air, pan, dry, wet],
    };
  }

  private finishBird(v: BirdVoice, t0: number, tEnd: number): number {
    this.release(v.sources, v.nodes, tEnd + 0.05);
    return tEnd - t0;
  }

  /** Blackbird: unhurried fluting notes that glide into each other, with light vibrato. */
  private singBlackbird(g: Graph, t0: number): number {
    const v = this.birdVoice(g, 'flute', this.perch('blackbird'), 0.085);
    if (!v) return 0;
    const ctx = g.ctx;
    const vibrato = ctx.createOscillator();
    vibrato.frequency.value = rand(5.5, 7.5);
    const depth = mkGain(ctx, rand(10, 24));
    vibrato.connect(depth);
    depth.connect(v.freq);
    v.sources.push(vibrato);
    v.nodes.push(depth);

    let t = t0;
    let f = rand(1800, 2500);
    const notes = randInt(4, 7);
    for (let i = 0; i < notes; i++) {
      const dur = rand(0.16, 0.36);
      const next = clamp(f * pick(BLACKBIRD_STEPS) * rand(0.985, 1.015), 1450, 3300);
      v.freq.setValueAtTime(f, t);
      v.freq.exponentialRampToValueAtTime(next, t + dur * rand(0.4, 0.8));
      swell(v.amp, t, rand(0.65, 1), 0.035, dur, 0.07);
      f = next;
      t += dur + rand(0.015, 0.11);
    }
    // Blackbirds often finish on a thin, squeaky little flourish.
    if (Math.random() < 0.4) {
      for (let i = randInt(2, 4); i > 0; i--) {
        const dur = rand(0.05, 0.08);
        const hi = rand(3600, 5200);
        v.freq.setValueAtTime(hi, t);
        v.freq.exponentialRampToValueAtTime(hi * rand(0.8, 1.25), t + dur);
        pluck(v.amp, t, 0.3, 0.008, dur);
        t += dur + rand(0.02, 0.05);
      }
    }
    v.osc.start(t0);
    vibrato.start(t0);
    return this.finishBird(v, t0, t);
  }

  /** Wren/robin: a few bright intro notes, then a very fast down-chirping trill. */
  private singWren(g: Graph, t0: number): number {
    const v = this.birdVoice(g, 'sine', this.perch('wren'), 0.055);
    if (!v) return 0;
    const base = rand(4300, 5600);
    let t = t0;
    for (let i = randInt(2, 4); i > 0; i--) {
      const dur = rand(0.07, 0.11);
      const f = base * rand(0.82, 1.2);
      v.freq.setValueAtTime(f * 1.1, t);
      v.freq.exponentialRampToValueAtTime(f * 0.92, t + dur);
      pluck(v.amp, t, rand(0.6, 0.9), 0.008, dur);
      t += dur + rand(0.03, 0.06);
    }
    const period = 1 / rand(15, 22);
    const count = randInt(10, 20);
    const trill = base * rand(0.95, 1.18);
    for (let i = 0; i < count; i++) {
      const arc = Math.sin((Math.PI * (i + 0.5)) / count); // trill swells then fades
      v.freq.setValueAtTime(trill * 1.16, t);
      v.freq.exponentialRampToValueAtTime(trill * 0.86, t + period * 0.7);
      pluck(v.amp, t, 0.45 + 0.55 * arc, 0.005, period * 0.82);
      t += period;
    }
    let tail = trill;
    for (let i = randInt(1, 3); i > 0; i--) {
      const dur = rand(0.08, 0.12);
      tail *= rand(0.8, 0.92);
      v.freq.setValueAtTime(tail * 1.08, t);
      v.freq.exponentialRampToValueAtTime(tail * 0.9, t + dur);
      pluck(v.amp, t, 0.7, 0.008, dur);
      t += dur + rand(0.03, 0.05);
    }
    v.osc.start(t0);
    return this.finishBird(v, t0, t);
  }

  /** Chiffchaff: steady, slightly irregular alternation of two sharp down-slurred notes. */
  private singChiffchaff(g: Graph, t0: number): number {
    const v = this.birdVoice(g, 'sine', this.perch('chiffchaff'), 0.06);
    if (!v) return 0;
    const tune = rand(0.94, 1.06);
    const chiff = 4700 * tune;
    const chaff = 3850 * tune;
    const period = rand(0.25, 0.3);
    let high = Math.random() < 0.7;
    let t = t0;
    let end = t0;
    for (let i = randInt(5, 11); i > 0; i--) {
      const f = high ? chiff : chaff;
      const dur = rand(0.085, 0.11);
      v.freq.setValueAtTime(f * 1.28, t);
      v.freq.exponentialRampToValueAtTime(f, t + dur * 0.55);
      v.freq.exponentialRampToValueAtTime(f * 0.96, t + dur);
      pluck(v.amp, t, rand(0.75, 1), 0.006, dur);
      if (Math.random() < 0.82) high = !high; // mostly alternates, with the odd stutter
      end = t + dur;
      t += period * rand(0.92, 1.08);
    }
    v.osc.start(t0);
    return this.finishBird(v, t0, end);
  }

  /** Great tit: ringing see-saw "tea-cher, tea-cher" on two steady pitches. */
  private singGreatTit(g: Graph, t0: number): number {
    const v = this.birdVoice(g, 'triangle', this.perch('greatTit'), 0.05);
    if (!v) return 0;
    const tune = rand(0.93, 1.07);
    const tea = 4350 * tune;
    const cher = 3350 * tune;
    const period = rand(0.36, 0.44);
    let t = t0;
    let end = t0;
    for (let i = randInt(3, 5); i > 0; i--) {
      v.freq.setValueAtTime(tea * 0.97, t);
      v.freq.exponentialRampToValueAtTime(tea, t + 0.03);
      swell(v.amp, t, 0.9, 0.008, 0.12, 0.04);
      const t2 = t + 0.15;
      v.freq.setValueAtTime(cher, t2);
      v.freq.exponentialRampToValueAtTime(cher * 0.97, t2 + 0.15);
      swell(v.amp, t2, 1, 0.008, 0.15, 0.06);
      end = t2 + 0.15;
      t += period;
    }
    v.osc.start(t0);
    return this.finishBird(v, t0, end);
  }

  /** Wood pigeon: five soft, breathy low coos (sine + a narrow band of noise at the pitch). */
  private singWoodPigeon(g: Graph, t0: number): number {
    const v = this.birdVoice(g, 'sine', this.perch('woodPigeon'), 0.075);
    if (!v) return 0;
    const ctx = g.ctx;
    const base = rand(415, 470);
    const breath = this.noiseSource(g, g.white);
    const band = mkFilter(ctx, 'bandpass', base * 1.02, 2.5);
    const breathGain = mkGain(ctx, 2.2);
    breath.connect(band);
    band.connect(breathGain);
    breathGain.connect(v.ampNode);
    v.sources.push(breath);
    v.nodes.push(band, breathGain);

    let t = t0;
    let end = t0;
    const phrases = Math.random() < 0.45 ? 2 : 1;
    for (let p = 0; p < phrases; p++) {
      for (let k = 0; k < COO_DUR.length; k++) {
        const dur = COO_DUR[k] * rand(0.93, 1.07);
        // Each coo swells up in pitch and sags away again; the second is the stressed one.
        v.freq.setValueAtTime(base * 0.94, t);
        v.freq.linearRampToValueAtTime(base * (k === 1 ? 1.07 : 1.02), t + dur * 0.4);
        v.freq.linearRampToValueAtTime(base * 0.9, t + dur);
        swell(v.amp, t, COO_AMP[k], 0.07, dur, 0.11);
        end = t + dur;
        t = end + COO_GAP[k];
      }
      t += rand(0.5, 0.8);
    }
    v.osc.start(t0);
    breath.start(t0, Math.random() * g.white.duration);
    return this.finishBird(v, t0, end);
  }

  /** Distant single (sometimes double) high "tsip" contact call from somewhere far off. */
  private tsip(g: Graph, t0: number): void {
    const v = this.birdVoice(g, 'sine', { pan: rand(-0.9, 0.9), dist: rand(0.55, 1) }, 0.07);
    if (!v) return;
    let t = t0;
    let end = t0;
    for (let i = Math.random() < 0.3 ? 2 : 1; i > 0; i--) {
      const f = rand(6200, 8200);
      const dur = rand(0.04, 0.06);
      v.freq.setValueAtTime(f, t);
      v.freq.exponentialRampToValueAtTime(f * rand(0.72, 0.85), t + dur);
      pluck(v.amp, t, 1, 0.005, dur);
      end = t + dur;
      t = end + rand(0.09, 0.16);
    }
    v.osc.start(t0);
    this.finishBird(v, t0, end);
  }

  /* ---------------------------------------------------------------------------------------- */
  /* Water                                                                                    */
  /* ---------------------------------------------------------------------------------------- */

  /** A small wave folding onto the bank: low-mid noise, band rising as it breaks. */
  private lap(g: Graph, t0: number, scale: number): void {
    if (!this.canVoice()) return;
    const ctx = g.ctx;
    const dur = rand(0.28, 0.42);
    const level = LAP_LEVEL * scale * rand(0.6, 1);
    const noise = this.noiseSource(g, g.brown);
    const f0 = rand(280, 480);
    const band = mkFilter(ctx, 'bandpass', f0, 1.3);
    band.frequency.setValueAtTime(f0, t0);
    band.frequency.exponentialRampToValueAtTime(f0 * rand(1.4, 1.9), t0 + dur * 0.7);
    const amp = mkGain(ctx, 0);
    pluck(amp.gain, t0, level, 0.06, dur);
    const pan = this.panner(g, rand(-0.8, 0.8));
    noise.connect(band);
    band.connect(amp);
    amp.connect(pan);
    pan.connect(g.above);
    noise.start(t0, Math.random() * g.brown.duration);
    this.release([noise], [band, amp, pan], t0 + dur + 0.02);
  }

  /** Dive: noise burst sweeping down, a low plunge thump, then bubbles under the surface. */
  private diveSplash(g: Graph, t: number, amount: number): void {
    if (!this.canVoice(true)) return;
    const ctx = g.ctx;
    const level = SPLASH_LEVEL * amount;
    const out = this.panner(g, rand(-0.08, 0.08));
    out.connect(g.above);

    // Body of the splash: fast attack, band-pass falling from spray down to slosh.
    const noise = this.noiseSource(g, g.white);
    const band = mkFilter(ctx, 'bandpass', 3400, 0.7);
    band.frequency.setValueAtTime(3400 * rand(0.9, 1.1), t);
    band.frequency.exponentialRampToValueAtTime(420, t + 0.4);
    const body = mkGain(ctx, 0);
    body.gain.setValueAtTime(0, t);
    body.gain.linearRampToValueAtTime(level, t + 0.006);
    body.gain.exponentialRampToValueAtTime(level * 0.25, t + 0.14);
    body.gain.exponentialRampToValueAtTime(level * 0.004, t + 0.62);
    body.gain.linearRampToValueAtTime(0, t + 0.66);
    noise.connect(band);
    band.connect(body);
    body.connect(out);

    // Spray: a short high fizz on top of the attack.
    const high = mkFilter(ctx, 'highpass', 4500, 0.5);
    const spray = mkGain(ctx, 0);
    pluck(spray.gain, t, level * 0.5, 0.004, 0.17);
    noise.connect(high);
    high.connect(spray);
    spray.connect(out);

    // Plunge: the air cavity closing behind the duck, ~90 -> 50 Hz.
    const osc = ctx.createOscillator();
    osc.frequency.setValueAtTime(92, t);
    osc.frequency.exponentialRampToValueAtTime(50, t + 0.26);
    const thump = mkGain(ctx, 0);
    pluck(thump.gain, t, level * 0.5, 0.012, 0.38);
    osc.connect(thump);
    thump.connect(out);

    noise.start(t, Math.random() * g.white.duration);
    osc.start(t);
    this.release([noise, osc], [band, body, high, spray, thump, out], t + 0.7);

    // Bubbling tail on the underwater bus (heard as the camera follows the duck down).
    const count = randInt(6, 10);
    const blipLevel = BUBBLE_LEVEL * 1.3 * amount;
    this.blipStrand(g, g.under, t + 0.1, Math.ceil(count / 2), 0.75, blipLevel, BUBBLE, true);
    this.blipStrand(g, g.under, t + 0.16, Math.floor(count / 2), 0.75, blipLevel, BUBBLE, true);
  }

  /** Surfacing: a brighter, shorter splash, then drips running off the feathers. */
  private surfaceSplash(g: Graph, t: number, amount: number): void {
    if (!this.canVoice(true)) return;
    const ctx = g.ctx;
    const level = SPLASH_LEVEL * 0.6 * amount;
    const out = this.panner(g, rand(-0.08, 0.08));
    out.connect(g.above);

    const noise = this.noiseSource(g, g.white);
    const band = mkFilter(ctx, 'bandpass', 4600, 0.8);
    band.frequency.setValueAtTime(4600 * rand(0.9, 1.1), t);
    band.frequency.exponentialRampToValueAtTime(1600, t + 0.2);
    const body = mkGain(ctx, 0);
    pluck(body.gain, t, level, 0.004, 0.28);
    const high = mkFilter(ctx, 'highpass', 5000, 0.5);
    const spray = mkGain(ctx, 0);
    pluck(spray.gain, t, level * 0.3, 0.003, 0.11);
    noise.connect(band);
    band.connect(body);
    body.connect(out);
    noise.connect(high);
    high.connect(spray);
    spray.connect(out);
    noise.start(t, Math.random() * g.white.duration);
    this.release([noise], [band, body, high, spray, out], t + 0.32);

    // 3-6 high plinks over ~0.6 s, split across two strands for a little stereo scatter.
    const drips = randInt(3, 6);
    const dripLevel = level * 0.2;
    this.blipStrand(g, g.above, t + 0.1, Math.ceil(drips / 2), 0.6, dripLevel, DRIP, true);
    this.blipStrand(g, g.above, t + 0.17, Math.floor(drips / 2), 0.55, dripLevel, DRIP, true);
  }

  /* ---------------------------------------------------------------------------------------- */
  /* Quack                                                                                    */
  /* ---------------------------------------------------------------------------------------- */

  /**
   * Source: sawtooth + a slightly detuned sub-octave square (hoarse, period-doubled rasp) + a
   * little noise. Filter: three parallel band-pass formants that scoop upward as the beak
   * opens and relax as it closes - that movement is what says "quack" instead of "buzz".
   * One oscillator set and one envelope serve the whole call; syllables are automation.
   */
  private voiceQuack(g: Graph, timing: QuackTiming, t0: number): void {
    if (!this.canVoice(true)) return;
    const ctx = g.ctx;
    const under = this.duckUnder;

    const saw = ctx.createOscillator();
    saw.type = 'sawtooth';
    const sub = ctx.createOscillator();
    sub.type = 'square';
    const subGain = mkGain(ctx, 0.28);
    const breath = this.noiseSource(g, g.white);
    const breathGain = mkGain(ctx, 0.14);
    const env = mkGain(ctx, 0);
    saw.connect(env);
    sub.connect(subGain);
    subGain.connect(env);
    breath.connect(breathGain);
    breathGain.connect(env);

    const out = mkGain(ctx, QUACK_LEVEL * (under ? 0.62 : 1));
    const nodes: AudioNode[] = [subGain, breathGain, env, out];
    const tilt = rand(0.95, 1.06); // every quack comes from a slightly different "mouth"
    const formants: BiquadFilterNode[] = [];
    for (const [frequency, q, gain] of QUACK_FORMANTS) {
      const band = mkFilter(ctx, 'bandpass', frequency * tilt, q);
      const bandGain = mkGain(ctx, gain);
      env.connect(band);
      band.connect(bandGain);
      bandGain.connect(out);
      formants.push(band);
      nodes.push(band, bandGain);
    }

    const detune = rand(1.008, 1.02);
    timing.syllables.forEach((syllable, i) => {
      const ts = t0 + syllable.start;
      const d = syllable.duration;
      const te = ts + d;
      // Pitch falls 25-35% through each syllable; later syllables start a touch lower.
      const f0 = rand(430, 480) * (1 - 0.02 * i);
      const f1 = f0 * rand(0.65, 0.75);
      saw.frequency.setValueAtTime(f0, ts);
      saw.frequency.exponentialRampToValueAtTime(f1, te);
      sub.frequency.setValueAtTime(f0 * 0.5 * detune, ts);
      sub.frequency.exponentialRampToValueAtTime(f1 * 0.5 * detune, te);
      formants.forEach((band, k) => {
        const f = QUACK_FORMANTS[k][0] * tilt;
        band.frequency.setValueAtTime(f * 0.74, ts);
        band.frequency.exponentialRampToValueAtTime(f, ts + 0.035);
        band.frequency.exponentialRampToValueAtTime(f * 0.86, te);
      });
      // ~12 ms attack, quick decay, short release to exactly zero.
      const peak = QUACK_AMP[i] ?? 0.4;
      env.gain.setValueAtTime(0, ts);
      env.gain.linearRampToValueAtTime(peak, ts + 0.012);
      env.gain.exponentialRampToValueAtTime(peak * 0.5, ts + d * 0.55);
      env.gain.exponentialRampToValueAtTime(peak * 0.05, te - 0.008);
      env.gain.linearRampToValueAtTime(0, te);
    });

    if (under) {
      // Underwater: heavy lowpass. The formants alone would vanish beneath it, so a little
      // of the raw fundamental is mixed back in to leave a muffled "mwop".
      const muffle = mkFilter(ctx, 'lowpass', 480, 0.7);
      const body = mkGain(ctx, 0.35);
      env.connect(body);
      body.connect(out);
      out.connect(muffle);
      muffle.connect(g.direct);
      nodes.push(muffle, body);
      this.blipStrand(g, g.direct, t0 + 0.04, randInt(2, 3), timing.duration, BUBBLE_LEVEL, BUBBLE, true);
    } else {
      out.connect(g.above);
    }

    saw.start(t0);
    sub.start(t0);
    breath.start(t0, Math.random() * g.white.duration);
    this.release([saw, sub, breath], nodes, t0 + timing.duration + 0.05);
  }
}
