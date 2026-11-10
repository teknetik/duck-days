/**
 * Recorded-sound layer for the soundscape.
 *
 * The clips in public/audio were generated with ElevenLabs (see CREDITS.md) and
 * are described by manifest.json, which tools/audio/build-manifest.mjs writes
 * from measurements of the files. Everything here is optional: whatever fails
 * to load simply is not in the bank, and AudioSystem keeps synthesising that
 * sound instead.
 */

export interface ClipSlice {
  start: number;
  duration: number;
  rmsDb: number;
  peakDb: number;
}

export interface ClipInfo {
  file: string;
  seconds: number;
  loop: boolean;
  rmsDb: number;
  peakDb: number;
  /** Where the sound actually starts and ends, in seconds. */
  trim?: [number, number];
  /** Quack clips: one window per syllable, for the bill animation. */
  syllables?: Array<{ start: number; duration: number }>;
  /** Clips that hold several separate sounds (paddle strokes). */
  slices?: ClipSlice[];
}

interface Manifest {
  clips: Record<string, ClipInfo>;
}

export interface Clip {
  info: ClipInfo;
  buffer: AudioBuffer;
}

export const dbToGain = (db: number): number => Math.pow(10, db / 20);

/**
 * Turns a recording into a buffer that repeats without a seam: encoder padding
 * is trimmed, then the tail is cross-faded into the head (equal power). This
 * works whether or not the decoder honoured the file's gapless metadata.
 */
function seamless(ctx: BaseAudioContext, source: AudioBuffer, fadeSeconds: number): AudioBuffer {
  const rate = source.sampleRate;
  const channels = source.numberOfChannels;
  // Padding is digital silence; real room tone never is.
  let first = source.length;
  let last = 0;
  for (let c = 0; c < channels; c++) {
    const data = source.getChannelData(c);
    let a = 0;
    while (a < data.length && Math.abs(data[a]) < 1e-4) a++;
    let b = data.length - 1;
    while (b > a && Math.abs(data[b]) < 1e-4) b--;
    first = Math.min(first, a);
    last = Math.max(last, b);
  }
  const usable = last - first + 1;
  const fade = Math.min(Math.round(fadeSeconds * rate), Math.floor(usable / 4));
  if (usable < rate / 2 || fade < 8) return source;
  const length = usable - fade;
  const out = ctx.createBuffer(channels, length, rate);
  for (let c = 0; c < channels; c++) {
    const input = source.getChannelData(c);
    const data = out.getChannelData(c);
    for (let i = 0; i < length; i++) data[i] = input[first + i];
    for (let i = 0; i < fade; i++) {
      const t = ((i + 0.5) / fade) * (Math.PI / 2);
      data[i] = input[first + i] * Math.sin(t) + input[first + length + i] * Math.cos(t);
    }
  }
  return out;
}

export class SampleBank {
  private readonly clips = new Map<string, Clip>();

  /** Fetches and decodes every clip in the manifest. Resolves either way; never rejects. */
  async load(ctx: BaseAudioContext, baseUrl: string): Promise<void> {
    try {
      const root = `${baseUrl}audio/`;
      const response = await fetch(`${root}manifest.json`);
      if (!response.ok) return;
      const manifest = (await response.json()) as Manifest;
      await Promise.all(
        Object.entries(manifest.clips ?? {}).map(async ([id, info]) => {
          try {
            const file = await fetch(root + info.file);
            if (!file.ok) return;
            const decoded = await ctx.decodeAudioData(await file.arrayBuffer());
            this.clips.set(id, { info, buffer: info.loop ? seamless(ctx, decoded, 0.4) : decoded });
          } catch {
            // This sound stays synthesised.
          }
        })
      );
    } catch {
      // No manifest, offline, or audio decoding unavailable: synthesis covers everything.
    }
  }

  get(id: string): Clip | null {
    return this.clips.get(id) ?? null;
  }

  get size(): number {
    return this.clips.size;
  }

  /** Ids that loaded, for diagnostics. */
  get loaded(): string[] {
    return [...this.clips.keys()].sort();
  }
}
