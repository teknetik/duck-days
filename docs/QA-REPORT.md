# Duck Days — build and QA report

Date: 2026-11-09. Machine: Apple M4 Max, Chromium (ANGLE Metal), device pixel ratio 2.

## QA result: pass, with the gaps listed under "Not verified"

| | |
| --- | --- |
| Commands | `npm install`, `npx tsc --noEmit`, `npm run build`, `npm run preview -- --port 4273` |
| URL tested | `http://localhost:4273/` (production build; `?debug` added for the scripted checks) |
| Build | `tsc` clean; Vite: `index.html` 4.1 kB, CSS 6.3 kB, JS 707 kB (194 kB gzip); `dist/` 712 kB total, no runtime downloads |
| Console / page errors | none in the production preview, including after quality switches |
| Canvas pixel check | 1225×1261 drawing buffer, 15,925 samples: mean RGB (47, 68, 39), luma standard deviation 27, 917 distinct quantised colours, `gl.getError()` 0 |
| Desktop viewport | 800×824 CSS px at DPR 2 (the in-app browser pane) |
| Mobile viewport | 375×812 emulated touch device: stick 124 px, Dive 84 px, Quack 68 px, tool buttons 44 px, all inside the safe-area padding |

### First-time-player path, production build

Driven with real `keydown` / `keyup` events through the game's input layer.

| Step | Result |
| --- | --- |
| Start | Duck at the spawn point over open water; lily bloom ahead, willow on the left; title and controls hint visible |
| Swim through the lily cove (`W`) | 8.7 m travelled at 1.9 m/s, area caption "Lily Cove" shown, controls hint faded |
| Wake behind the duck | Simulation height range went from 0.5 mm (calm) to 20.9 mm; the height field shows a V at about 17–21° |
| Dive in the deep pool (hold `Space`) | Head-dip / tail-lift anticipation (0.34 s), then `under` at −1.64 m in 2.4 m of water; camera below the surface, 12 bubbles alive |
| Fish and caustics | Fish within 2.2 m of the duck; caustic light on the bed and stones in the underwater frames |
| Surface (release `Space`) | Back at the surface 1.25 s later, 20 droplets in the air, 16 mm splash in the simulation, four widening rings queued |
| Quack (`Q` / touch button) | Bill opens in time with the syllables (bill-open 0.86 at the first syllable) |

### Shoreline and log dive sweep

Scripted: 19 start points (14 around the shoreline where the water is 0.2–0.75 m
deep, 3 around the half-submerged log, 2 in the deep pool). At each: swim at the
bank, hold dive, turn, release, back away. 5,909 frames checked.

| Check | Result |
| --- | --- |
| Camera inside the ground | 0 frames |
| Camera inside a rock, the log or a trunk | 0 frames (17 before the fix that slides the eased camera out of obstacles) |
| Duck beached, in the bed or inside an obstacle | 0 frames |
| Above / below switches | 38 = exactly two per dive, so no waterline flicker |
| Longest stay inside the ±5 cm waterline band | 4 frames |
| Exposed simulation edge | Lowest ground anywhere on the simulation square's border is 0.28 m above the water |
| Largest single-frame camera move | 0.33 m (the push out from under the log) |

### Touch controls (emulated)

Synthetic pointer events on the on-screen controls: stick moved the duck 2.8 m;
Dive took it under and release brought it back; Quack opened the bill.

## Renderer and performance

Measured on the dev server while the tab was visible, 800×824 CSS px. Treat the
frame rates as indicative: they are a smoothed reading taken a few seconds after
each switch.

| Preset | Pixel ratio | Draw calls / frame | Triangles / frame (all passes) | Frame rate |
| --- | --- | --- | --- | --- |
| Low | 1 | 225 | 2.95 M | 91 fps |
| Medium | 1.5 | 162–273 | 3.7–4.4 M | 76–120 fps |
| High | 2 | 269 | 5.3 M | 91 fps |

The Low row was taken before Low stopped rendering the planar reflection pass,
so it now draws fewer triangles than shown; it was not re-measured.

Geometries 64, textures 28, shader programs 86–89. Scene content is about 1.4 M
triangles; the rest is the reflection, refraction and shadow passes.

One optimisation pass was measured: Medium went from 43 fps to 76–81 fps in the
same view after clipping the hidden side of the water out of the main pass,
switching foliage to Lambert shading, refreshing the shadow map every other
frame and reducing the inner terrain grid.

## Trailer

`trailer/duck-days-trailer.mp4` — 30.0 s, 1920×1080, 60 fps, H.264 + AAC, 55 MB
(plus a 1280×720 copy, 23 MB, re-encoded from it). Recorded from the production
build: 1,800 frames stepped at a fixed 1/60 s on the High preset, rendered at
3840×2160 and downsampled. The soundtrack is rendered offline from the game's
own audio engine, recorded clips included, using the 55 sound events logged
during the capture (41 paddle strokes, 11 bubble bursts, the dive and surface
splashes, one quack).

It was captured a second time after the recorded sound went in, so that the
bill follows the syllables of the recorded quack: the quack's onsets in the
finished file fall at 24.12, 24.58, 25.00, 25.40 and 25.78 s against the take's
24.17, 24.57, 25.00, 25.43 and 25.83 s.

Checked: contact sheets from the encoded file; stream properties with
`ffprobe`; audio levels per section (opening ambience RMS −30.6 dB, dive splash
peak −8.4 dB at 14.5 s, underwater RMS −28.7 dB, surface splash peak −11.3 dB at
22.8 s, quack peak −6.5 dB from 24.15 s, fade to silence at the end). The film
was not watched in motion or listened to.

## Not verified

- **How it sounds.** The clips were checked by measurement (length, level,
  spectrum, where the sound sits in each file) and the mix by offline
  rendering. Nobody has listened to them in this pass, so whether the birdsong
  reads as an English wood or the quack as a mallard is unconfirmed.
- **Frame rate on anything but an M4 Max.** The per-frame triangle count is high
  for integrated graphics; Low is there for that, but it was not measured on
  weaker hardware.
- **Safari and Firefox.** Only Chromium was run.
- **A real phone.** Touch was exercised through emulation and synthetic events.
- **A long real-time play session.** After the pane this was tested in became
  hidden, checks were made by stepping the game synchronously; the real-time
  loop was exercised earlier in the session (about 100 fps on Medium).

## Sound

Eleven clips, 85 s of audio, 1.4 MB, generated with ElevenLabs
(`eleven_text_to_sound_v2`). Audio matrix:

| Role | Clip(s) | Runtime behaviour |
| --- | --- | --- |
| Birdsong | `birdsong-a` (22 s), `birdsong-b` (16 s) | Two loops of different lengths on the above-water bus; replaces the synthesised birds |
| Reeds | `reeds` (10 s) | Loop whose level follows breeze, gusts and distance to reed beds; replaces the synthesised rustle |
| Lapping | `lapping` (10 s) | Quiet loop; replaces the synthesised laps |
| Underwater | `underwater` (12 s) | Loop on the underwater bus, over 35% of the synthesised rumble |
| Paddling | `paddle` | Four strokes cut from one recording, picked at random per foot stroke, panned to that side |
| Dive / surface | `splash-dive`, `splash-surface` | One-shots scaled by how hard the duck hits the water |
| Bubbles | `bubbles` | A random 0.3–0.75 s excerpt per burst, underwater bus |
| Quack | `quack-a` (5 syllables), `quack-b` (4) | Alternating takes; the bill opens on the measured syllables; muffled with bubbles when under water |

Still synthesised: breeze bed, wake hiss, faint distant bubbles, and everything
above whenever its clip is missing.

Measured (offline render of the game's audio graph, 48 kHz, limiter included):

| Section | Recorded: peak / RMS | Synth only: peak / RMS |
| --- | --- | --- |
| Ambience above water | −16.2 / −33.0 dB | −16.6 / −32.7 dB |
| Quack | −9.9 / −27.0 dB | −7.5 / −29.4 dB |
| Dive splash | −10.4 / −29.7 dB | −9.1 / −27.8 dB |
| Underwater bed | −18.4 / −30.9 dB | −13.4 / −31.0 dB |
| Underwater quack | −10.7 / −26.8 dB | −13.4 / −28.5 dB |
| Surface splash | −13.7 / −30.5 dB | −23.2 / −36.1 dB |

Checks: all 11 clips load in the running game and in the production build
(`200`, no console messages); with the `audio/` requests blocked the game falls
back to synthesis with no errors; mute gives digital silence; the five loops
have no step at the loop point larger than the audio's own sample-to-sample
movement; the API key appears in no file other than `.env`.

Clip measurements that say what is in each file: birdsong energy sits in
1.5–9 kHz, reeds in 4 kHz and above, lapping around 0.5–1.5 kHz, the underwater
bed below 500 Hz, the quacks in 1.5–4 kHz.

## Skill-loading ledger (threejs-game-director)

- Director: invoked.
- Gameplay systems: loaded (`~/.claude/skills/threejs-gameplay-systems/SKILL.md`). Its packaged scaffold was inspected and not used: the brief asks for upstream's Three.js / Vite versions and the scaffold is an arcade pickup template.
- AAA graphics: loaded.
- UI: loaded.
- Debug/profile: loaded.
- QA/release: loaded.
- 3D generator: partly loaded (purpose, key handling and reference gates); not used, see below.
- Image generator: partly loaded (purpose, when to use, key handling); not used.
- Audio generator: loaded in full, with its audio-workflows reference. Its request shape was reused in `tools/audio/generate.mjs` rather than calling the skill's script, so the project can regenerate its own clips.

## Reference ledger

- Gameplay workflows: yes. Physics engine selection: not needed (custom collision against a height field and capsules). New-game definition of done: yes.
- Visual scorecard, implementation blueprint, model recipes, render recipes: yes. Graphics checklists (quality gate, scorecard, procedural model, material/lighting, performance-safe detail): yes.
- UI patterns and UI checklists (quality, HUD readability, responsive fit, mobile input): yes.
- Debug/profile checklists: first section, plus the scene-debugging and performance-profile checklists.
- QA/release checklists (QA matrix, visual verification, playtest, release): yes.
- 3D generator API notes / integration / image workflows: not loaded — generation was blocked before those phases started. Audio workflows: yes.

## External asset sourcing

- Credential probe output (literal): `TRIPO_API_KEY=`, `GEMINI_API_KEY=`, `ELEVENLABS_API_KEY=` — each blank, which is how this probe prints an unset key. In the ledger's terms: TRIPO_API_KEY=MISSING, GEMINI_API_KEY=MISSING, ELEVENLABS_API_KEY=MISSING.
- Hero/player: procedural. The brief allows a rigged glTF "if a suitable licensed asset is available" and otherwise asks for an articulated stylised duck; no generator key was available and the dive / tuck / quack poses needed a custom rig either way.
- Enemies/vehicles/weapons: none in this game.
- Signature props/pickups: procedural (lilies, log, willow, stones, sunken branch).
- World/sky/background: procedural (terrain function, sky shader, instanced planting).
- Materials/textures/decals: procedural canvas textures.
- Logos/icons/GUI art: inline SVG icons, system type.
- Audio/SFX/voice: eleven clips generated with the ElevenLabs sound-effects API once asked for (key from the project's git-ignored `.env`; the session's two ElevenLabs connectors rejected their own key with 401). Synthesis remains as the fallback.
- Chosen sources per surface: procedural throughout.
- 3D generator loaded: partly. Image generator loaded: partly. Audio generator loaded: yes.
- External assets generated: no 3D or image assets — keys missing. Audio assets generated: yes, `public/audio/ambience/*.mp3` (5 loops) and `public/audio/sfx/*.mp3` (6 one-shots), listed with their prompts in `CREDITS.md`.

## Phase ledger

- Gameplay systems: done — movement, dive state machine, collisions, camera, wildlife; evidence above.
- External asset sourcing: done — blocked by missing keys, procedural fallback as the brief allows.
- AAA graphics: done — see scorecard.
- UI: done — title, hint, captions, mute, quality, touch controls; desktop and mobile screenshots taken.
- Debug/profile: done — shadow-map sampler warning on quality change found and fixed; performance table above.
- QA/release: done — production build, preview, console, canvas pixels, input paths, sweep.

## Visual scorecard (self-assessed, 0–3)

- Art direction: 3 — one mood (late-afternoon documentary) carried through light, palette, type and captions.
- Hero/player: 2 — authored mallard silhouette and plumage with dive, tuck, surfacing and quack states; stylised, not a sculpted asset.
- Obstacles/enemies: 2 — no enemies by design; the solid world (log, rocks, roots, banks, reed beds) has distinct forms and collision proxies.
- Rewards/interactables: 2 — nothing to collect by design; lily pads bob and part, fish scatter, dragonflies take off.
- World/environment: 3 — three landmark areas with foreground, mid-ground and tree-line layers, above and below water.
- Materials/textures: 2 — procedural bark, leaves, feathers, pads, wet band at the waterline, depth tint.
- Lighting/render: 3 — ACES, low warm sun with shadows, planar + cube reflections, refraction, caustics, underwater fog.
- VFX/motion: 3 — simulated wake, splash droplets, rings, bubbles, drifting specks, wind sway, all driven by state.
- UI/HUD: 2 — minimal, responsive, touch-capable; little to show because the game needs little.
- Performance evidence: 2 — renderer counts per preset, frame rates, one measured before/after.

Average: 2.4. Automatic failures remaining: none of the listed ones; the gaps are the unverified items above.

## Issues found and fixed during QA

1. Camera could pass through the log while swinging round after the duck swam under it — the eased position is now pushed out of obstacles.
2. Reed beds could wall the duck off from the camera — foliage near the lens and along the sight line to the duck is dithered away in the player's view only.
3. A hard seam appeared in the refraction near the bottom of the frame — bent and straight lookups are now blended at the screen edge.
4. Triangular faceting in the caustics — the caustic map is mip-mapped and sampled one level down.
5. WebGL "texture format / sampler type" warnings after changing quality — the shadow map is now refreshed in the same frame as the change.
6. Bubbles drifting up to the lens filled the screen — point size is capped and faded near the camera.
7. The water at the log was too shallow to dive in — a scour pool was added under it.
