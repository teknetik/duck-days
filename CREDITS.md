# Credits

## Water

**threejs-water** by Yong Su (jeantimex) — https://github.com/jeantimex/threejs-water
A Three.js port of **WebGL Water** by Evan Wallace — http://madebyevan.com/webgl-water/

- Licence: MIT
  - Original work Copyright (c) 2011 Evan Wallace
  - Modified work Copyright (c) 2026 Yong Su
- Pinned commit: `f35a700a16fe386beac997806ed4471018c93ef7`
- Full licence text: `third_party/threejs-water/LICENSE` (also shipped with the
  build as `licenses/threejs-water-LICENSE.txt`)
- Unmodified reference copies of the upstream files used:
  `third_party/threejs-water/src/`
- Derived files in this project: everything in `src/water/` whose header names
  an upstream file. `third_party/threejs-water/UPSTREAM.md` lists the mapping,
  and the README's "How the water works" describes what was kept and changed.

Upstream's pool tile texture, sky cube map and Duck.gltf model are **not** used.

## Engine and tools

- **three.js** `0.184.0` — MIT, Copyright (c) 2010-2026 three.js authors
  (`licenses/three-LICENSE.txt` in the build)
- **Vite** and **TypeScript** — build tooling only, not shipped

## Models, textures and animation

All made for this project, generated procedurally at start-up. No third-party
art assets.

- Mallard: lofted meshes, vertex-painted plumage, procedural feather texture and
  procedural animation (`src/duck/`)
- Terrain, trees, willow, reeds, cattails, grasses, ferns, buttercups, purple
  loosestrife, pondweed, lily pads and blooms, rocks, log, sunken branch, fish
  and dragonflies (`src/world/`)
- Canvas-painted textures: bark, leaf clusters, willow strands, fern fronds,
  lily pads, feathers, ground grain, water ripple map, particles
  (`src/world/textures.ts`)
- Sky, sun and woodland horizon: a shader (`src/world/Sky.ts`)

## Sound

The clips in `public/audio/` were generated for this project with **ElevenLabs
Sound Effects** (model `eleven_text_to_sound_v2`, `mp3_44100_128`) on
2026-11-09. They are generated audio, not field recordings. Use and
redistribution are subject to the ElevenLabs terms for the account that
generated them; check that plan's attribution and commercial-use terms before
publishing the game.

| File | Length | Prompt |
| --- | --- | --- |
| `public/audio/ambience/birdsong-a.mp3` | 22.0 s loop | Late afternoon birdsong in an English broadleaf woodland beside a still pond: a blackbird singing fluting phrases, a robin, a chiffchaff, a distant wood pigeon cooing. Calm, sparse and natural with gaps between calls, light open air, mid-distance. No wind noise, no water, no insects, no people, no music. Seamless loop. |
| `public/audio/ambience/birdsong-b.mp3` | 16.0 s loop | Quiet woodland edge ambience with distant songbirds: a wren trilling far away, a great tit's two-note call, occasional soft chirps. Very sparse and gentle, far perspective, light air. No wind noise, no water, no people, no music. Seamless loop. |
| `public/audio/ambience/reeds.mp3` | 10.0 s loop | Dry reeds and tall grasses rustling softly in a light breeze at the edge of a pond, close perspective, continuous gentle swishing. No birds, no water splashes, no music. Seamless loop. |
| `public/audio/ambience/lapping.mp3` | 10.0 s loop | Very gentle pond water lapping against a muddy bank and reed stems, small soft ripples, quiet and close. No birds, no wind, no splashing, no music. Seamless loop. |
| `public/audio/ambience/underwater.mp3` | 12.0 s loop | Underwater ambience in a still freshwater pond: muffled low rumble and soft pressure hum, occasional tiny bubbles rising, calm and dark. No music, no voices. Seamless loop. |
| `public/audio/sfx/quack-a.mp3` | 2.2 s one-shot | A single male mallard duck quacking three times, close microphone on a quiet pond, clear natural quacks getting quieter. No other birds, no water, no music. |
| `public/audio/sfx/quack-b.mp3` | 1.5 s one-shot | A mallard duck gives two short quacks, close and clear, natural field recording. No other sounds, no music. |
| `public/audio/sfx/paddle.mp3` | 5.0 s one-shot | A duck's webbed feet paddling gently in calm water: a slow series of separate soft water strokes with clear pauses between them, close and quiet. No birds, no splashing, no music. |
| `public/audio/sfx/splash-dive.mp3` | 1.8 s one-shot | A small duck diving under calm pond water: one quick soft plunge with a short gulp and a few bubbles, close perspective, natural. No birds, no music. |
| `public/audio/sfx/splash-surface.mp3` | 2.0 s one-shot | A duck popping back up through the surface of a calm pond: a light splash, water running off feathers and a few drips, close perspective, natural. No birds, no music. |
| `public/audio/sfx/bubbles.mp3` | 2.5 s one-shot | A stream of small air bubbles rising underwater in a pond, soft muffled burbling, close. No music. |

`tools/audio/clips.json` is the source for that table, `tools/audio/generate.mjs`
regenerates the clips, and `tools/audio/build-manifest.mjs` measures them into
`public/audio/manifest.json`.

Everything can also be synthesised live with the Web Audio API
(`src/audio/AudioSystem.ts`), and is whenever a clip fails to load. The breeze
bed, the hiss of water around the swimming duck and the faint distant bubbles
are always synthesised.

## Type

System fonts only (a serif stack for titles, the platform UI font for
everything else). No font files are bundled.
