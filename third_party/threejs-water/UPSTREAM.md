# threejs-water (vendored reference copy)

- Upstream: https://github.com/jeantimex/threejs-water
- Pinned commit: `f35a700a16fe386beac997806ed4471018c93ef7` (2026-09-06, "improve knot's waveform")
- Licence: MIT, see `LICENSE` in this folder
  - Original work Copyright (c) 2011 Evan Wallace (WebGL Water, http://madebyevan.com/webgl-water/)
  - Modified work Copyright (c) 2026 Yong Su (jeantimex)
- Three.js version used upstream at this commit: `three@0.184.0`

The files in `src/` here are **unmodified** copies of the upstream sources that
Duck Days builds on. They are kept for attribution and so the pond adaptations in
`/src/water` can be diffed against the originals. Nothing in this folder is
imported by the game.

| Upstream file | Duck Days file derived from it |
| --- | --- |
| `src/Water.ts` | `src/water/WaterSim.ts` |
| `src/shaders/WaveSimulation.vert` / `.frag` | `src/water/shaders/WaveSimulation.vert` / `.frag` |
| `src/shaders/WaterNormal.frag` | `src/water/shaders/WaterNormal.frag` |
| `src/shaders/WaterRipple.frag` | `src/water/shaders/WaterRipple.frag` |
| `src/shaders/Sphere.frag` | `src/water/shaders/SphereDisplacement.frag` |
| `src/shaders/Caustics.vert` / `.frag`, `src/rendering/CausticsPass.ts` | `src/water/shaders/PondCaustics.vert` / `.frag`, `src/water/CausticsPass.ts` |
| `src/shaders/WaterAbove.vert` / `.frag`, `WaterBelow.vert` / `.frag`, `src/rendering/WaterSurfacePass.ts` | `src/water/shaders/PondWater.vert`, `PondWaterAbove.frag`, `PondWaterBelow.frag`, `src/water/WaterSurface.ts` |
| `src/rendering/ObjectTexturePass.ts` | `src/water/PlanarPasses.ts` |

See the project `README.md` ("How the water works") for what was kept and what
was changed.
