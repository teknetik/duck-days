# Duck Days

https://github.com/user-attachments/assets/09a6fd61-4a1c-4f3c-9a48-cf5b8d1dda78

A small nature documentary you can play. You are a mallard on a woodland pond in
late-afternoon light: paddle through the lily cove, drift under the willow, then
hold Space and slip under the surface into a different world of pondweed, fish
and moving sunlight.

There is no score and nothing to fail. Movement and the place are the game.

Built with Three.js, TypeScript and Vite. The water is
[jeantimex/threejs-water](https://github.com/jeantimex/threejs-water) (a Three.js
port of Evan Wallace's WebGL Water), adapted from a tiled pool to a natural pond.

## Run it

```bash
npm install
npm run dev        # development server (http://localhost:5173)
```

```bash
npm run build      # type-check, then production build into dist/
npm run preview    # serve the production build (http://localhost:4173)
```

`npm run typecheck` runs TypeScript on its own. The build uses a relative base
path, so `dist/` can be dropped on any static host or sub-folder.

Needs a browser with WebGL 2 and float render targets (any current Chrome, Edge,
Firefox or Safari).

## Controls

| Input | Action |
| --- | --- |
| `W` `A` `S` `D` or arrow keys | Swim. Direction is relative to where the camera is looking. |
| `Space` (hold) | Dive. Release to float back up. In water too shallow to dive, the duck up-ends and dabbles instead. |
| Drag (mouse or one finger) | Look around |
| Mouse wheel | Move the camera closer or further away |
| `Q` | Quack |
| `M` or the speaker button | Mute |
| Sliders button | Quality: Low / Medium / High |

On touch screens a movement stick and Dive / Quack buttons appear.

The controls hint and the title fade once you start swimming.

## The pond

One pond, three places, each with a landmark you can pick out from duck height:

- **Lily cove** (north-east): floating pads and pink water lilies beside a low
  bank, with dragonflies that hover, dart and land. Pads ride the simulated
  water, so they bob when your wake reaches them, and ease aside as you push
  through.
- **Willow shallows** (north-west): a weeping willow hanging over amber
  shallows, reeds, cattails, ferns and wildflowers, exposed roots, damp rocks
  and a half-submerged mossy log you can dive under.
- **The deep pool** (south): large stones and a sunken branch on a silty bed,
  swaying pondweed, drifting specks, caustic light on the gravel, and small
  fish that scatter when you get close.

You start over open water with a lily bloom straight ahead and the willow off to
the left.

## Quality setting

The sliders button (top right) switches live between three presets. The choice
is remembered.

| | Low | Medium | High |
| --- | --- | --- | --- |
| Wave simulation grid | 256² | 512² | 1024² |
| Caustic map / grid | 512² / 192² | 1024² / 320² | 2048² / 512² |
| Reflection + refraction passes | refraction only, 40% | both, 50% | both, 60% |
| Sun shadow map | off | 2048² | 4096² |
| Instanced foliage drawn | 40% | 70% | 100% |
| Pixel ratio cap | 1 | 1.5 | 2 |

Desktop starts on Medium, touch devices on Low.

## How the water works

The pond is built around the simulation and shaders from
[jeantimex/threejs-water](https://github.com/jeantimex/threejs-water), pinned at
commit `f35a700a16fe386beac997806ed4471018c93ef7` (the upstream demo was run
first, with its own `three@0.184.0`, which this project also uses). The
unmodified upstream files this project derives from are kept in
`third_party/threejs-water/` with their MIT licence; `UPSTREAM.md` there maps
each one to the file in `src/water/` that was derived from it.

**Kept from upstream**

- The GPU heightfield simulation: a ping-pong float texture holding height,
  velocity and the surface normal, advanced by the discrete wave equation
  (`WaterSim.ts`, `WaveSimulation.frag`, `WaterNormal.frag`).
- The drop and moving-sphere displacement passes (`WaterRipple.frag`,
  `SphereDisplacement.frag`) — unchanged.
- Caustics by the differential-area method: a surface-aligned grid is pushed
  along the refracted sun rays and brightness is the ratio of areas
  (`PondCaustics.vert/.frag`).
- The surface shading model: one displaced grid drawn twice (one face visible
  from above, one from below), parallax-refined normal lookup, reflect/refract
  through the air–water interface, Fresnel blend, and total internal reflection
  from underneath (`PondWaterAbove.frag`, `PondWaterBelow.frag`).
- The reflection / refraction pre-passes with a camera mirrored in the water
  plane (`PlanarPasses.ts`).

**Changed for a pond**

- *No pool box.* Upstream intersects reflected and refracted rays with an
  analytic tiled box. Here the reflected ray reads a cube map baked from the
  middle of the pond (sky, tree line, far banks) overlaid with a planar
  reflection pass for nearby things (the duck, lilies, reeds, the near bank).
  The refracted ray is followed down to the real pond bed, using a bed-height
  texture, and reads a refraction pass rendered from the scene.
- *Depth colour.* Light is absorbed along the refracted path: clear amber in the
  shallows, blue-green where it is deep.
- *One pair of passes for both views.* A clip plane at the waterline splits the
  scene, so "reflection" is always the camera's own side mirrored and
  "refraction" the far side. The same two targets serve above and below.
- *Shore instead of walls.* The simulation still runs on a bounded square
  (32 m), but the banks cover its edges, the surface is not drawn where the bed
  is above the water, and the bed texture turns the shallows into an absorbing
  beach so ripples die out rather than bounce off hidden walls.
- *Metres and a fixed step.* Positions are in metres; the simulation steps at a
  fixed 120 Hz and ripple speed is the same at every grid resolution
  (0.68 m/s — slower than a paddling duck, which is what draws a V-shaped wake).
- *Caustics on everything.* Instead of a pool-wall shader, every underwater
  material (bed, rocks, weed, fish, the duck) samples the caustic map through a
  small `onBeforeCompile` patch (`pondShading.ts`), which also adds the depth
  tint, the wet band at the waterline, wind sway and floating on the surface.
- *A light breeze.* A tiling slope map adds gust patches to the surface and to
  the caustics, so the bed shimmers even when the duck sits still.

**How the duck touches the water** (`src/duck/DuckWake.ts`)

- Two sphere proxies (breast and rump) are dragged through upstream's
  sphere-displacement pass: bow wave and wake.
- Timed drops add the idle ripple, a pulse from each foot stroke, the dent and
  rebound of a dive, and the widening rings of resurfacing.

## Project layout

```
src/
  main.ts              bootstrap
  core/                Game (frame order), Input, Quality presets, maths helpers
  water/               upstream-derived simulation, caustics, surface, passes  <- tune independently
    shaders/           GLSL (each file notes the upstream file it came from)
    pondShading.ts     patch that ties scene materials into the pond
  duck/                DuckModel (mesh + rig), DuckController (movement),
                       DuckAnimator (procedural poses), DuckWake (water interaction)
  camera/              FollowCamera (third-person orbit, waterline handling)
  world/               terrain, sky + light, trees + willow, planting, lilies,
                       rocks + log, fish + dragonflies, particles, textures
  audio/               AudioSystem (mixing, buses, synthesised fallback),
                       SampleBank (loads the recorded clips)
  ui/                  Hud (title, hint, captions, mute, quality, touch controls)
third_party/threejs-water/   pinned, unmodified upstream sources + MIT licence
public/licenses/             licence texts shipped with the build
public/audio/                generated sound clips + manifest.json
tools/audio/                 clip prompts, generator and measuring scripts
tools/trailer/               storyboard + capture scripts for the trailer
trailer/                     the recorded trailer
```

Each area keeps its tunables in one exported object, so they can be adjusted on
their own: `WATER_TUNING` (`water/PondWater.ts`), `WAKE_TUNING`
(`duck/DuckWake.ts`), `DUCK_TUNING` (`duck/DuckController.ts`), `CAMERA_TUNING`
(`camera/FollowCamera.ts`) and `QUALITY` (`core/Quality.ts`).

## Play-test hooks

In development, or in any build opened with `?debug`, `window.__DUCK_DAYS__` is
the running game:

```js
__DUCK_DAYS__.snapshot()                    // fps, renderer counts, duck / camera / world state
__DUCK_DAYS__.debug.tuning                  // live references to the tuning objects above
__DUCK_DAYS__.debug.teleport(x, z, heading)
__DUCK_DAYS__.debug.setIntents({ moveZ: 1, dive: true })   // drive the duck; null to release
__DUCK_DAYS__.debug.look(yaw, pitch, distance)
__DUCK_DAYS__.debug.view([x, y, z], [tx, ty, tz])           // fixed camera; null to release
__DUCK_DAYS__.debug.setTimeScale(0.2)                       // slow motion
__DUCK_DAYS__.debug.advance(seconds)                        // step synchronously and draw
```

## Trailer

`trailer/duck-days-trailer.mp4` is a 30 second trailer (1080p60) recorded from
the game itself; `duck-days-trailer-720p.mp4` is a smaller copy for sharing.
`tools/trailer/` holds the storyboard script and how to re-record it.

## Assets and credits

Everything is served from the game's own folder; nothing comes from a
third-party server at runtime. The mallard, terrain, plants, rocks, fish,
dragonflies and every texture are generated in code at start-up. The sound is
eleven short clips in `public/audio/` (1.4 MB) generated with ElevenLabs, with
a fully synthesised fallback for any clip that fails to load. See
[CREDITS.md](CREDITS.md).

### Regenerating the sound

```bash
node tools/audio/generate.mjs          # needs ELEVENLABS_API_KEY in the environment or .env; spends credits
node tools/audio/build-manifest.mjs    # needs ffmpeg; measures the clips and writes public/audio/manifest.json
```

`.env` is git-ignored and the key is only read by `generate.mjs`; Vite does not
expose it to the browser bundle. Prompts and lengths live in
`tools/audio/clips.json`. The game levels each clip from the measurements in the
manifest, so a regenerated clip plays at the same loudness as the one it
replaces.

## Known limits

- The duck is a stylised model built from shaped meshes with procedural
  animation, not a rigged glTF.
- The sound clips are AI-generated, not field recordings. The birdsong is two
  loops (about 22 s and 16 s) drifting against each other, so the pattern does
  come round again after a few minutes.
- The water surface does not receive tree shadows (the bed under it does).
- Planar reflections are sampled with a fixed lookup distance, so reflections of
  very close objects wobble a little more than they physically should.
- Foliage directly between the lens and the duck is thinned with a dither
  pattern so the duck stays visible in reed beds.
