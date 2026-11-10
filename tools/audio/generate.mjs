#!/usr/bin/env node
/**
 * Generates Duck Days' sound clips with the ElevenLabs sound-effects API.
 *
 *   node tools/audio/generate.mjs            # generate clips that are missing
 *   node tools/audio/generate.mjs quackA     # (re)generate named clips
 *   node tools/audio/generate.mjs --force    # regenerate everything
 *
 * Reads ELEVENLABS_API_KEY from the environment or the project's .env (which is
 * git-ignored). The key is only ever sent to api.elevenlabs.io; it is never
 * printed and never bundled into the game. Each call spends account credits.
 */
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const outRoot = join(root, 'public/audio');

async function apiKey() {
  if (process.env.ELEVENLABS_API_KEY) return process.env.ELEVENLABS_API_KEY.trim();
  const envPath = join(root, '.env');
  if (existsSync(envPath)) {
    const line = (await readFile(envPath, 'utf8'))
      .split(/\r?\n/)
      .find((l) => /^\s*ELEVENLABS_API_KEY\s*=/.test(l));
    if (line) return line.slice(line.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '');
  }
  throw new Error('ELEVENLABS_API_KEY is not set (environment or .env).');
}

const args = process.argv.slice(2);
const force = args.includes('--force');
const wanted = args.filter((a) => !a.startsWith('--'));
const spec = JSON.parse(await readFile(join(root, 'tools/audio/clips.json'), 'utf8'));
const key = await apiKey();

let failures = 0;
for (const clip of spec.clips) {
  if (wanted.length && !wanted.includes(clip.id)) continue;
  const out = join(outRoot, clip.file);
  if (!force && !wanted.length && existsSync(out)) {
    console.log(`skip   ${clip.id} (exists)`);
    continue;
  }
  const res = await fetch(
    `https://api.elevenlabs.io/v1/sound-generation?output_format=${spec.outputFormat}`,
    {
      method: 'POST',
      headers: { 'xi-api-key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: clip.prompt,
        model_id: spec.model,
        duration_seconds: clip.seconds,
        prompt_influence: clip.influence,
        loop: clip.loop,
      }),
    }
  );
  if (!res.ok) {
    failures++;
    // The body explains quota / permission problems; it does not contain the key.
    console.error(`FAILED ${clip.id}: ${res.status} ${(await res.text()).slice(0, 300)}`);
    continue;
  }
  const bytes = Buffer.from(await res.arrayBuffer());
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, bytes);
  console.log(`wrote  ${clip.id} -> public/audio/${clip.file} (${(bytes.length / 1024).toFixed(0)} kB)`);
}
process.exit(failures ? 1 : 0);
