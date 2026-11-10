// Derived from threejs-water (MIT) src/shaders/WaveSimulation.frag @ f35a700.
// Original WebGL Water (c) 2011 Evan Wallace, Three.js port (c) 2026 Yong Su.
//
// The 2D wave-equation update is upstream's: a 4-neighbour discrete Laplacian
// drives a velocity (G) which is damped and integrated into height (R).
//
// Pond changes:
//  - upstream's fixed `0.5 * stabilityScale / pool^2` coupling is replaced by an
//    explicit `waveK` so ripple speed is the same in metres/second at every
//    simulation resolution (and stays inside the CFL limit of 0.5);
//  - `damping` is a uniform instead of the constant 0.995;
//  - the pond-bed texture turns the hidden parts of the square domain into an
//    absorbing beach, so ripples die out in the muddy shallows instead of
//    bouncing off invisible pool walls.
precision highp float;

uniform sampler2D tInput; // R: height, G: velocity, BA: normal.xz
uniform sampler2D tBed;   // R: pond-bed height in metres (water rests at 0)
uniform vec2 delta;       // 1 / simulation resolution
uniform vec2 waveK;       // (c * dt / cellSize)^2 per axis
uniform float damping;    // velocity kept per step in open water

varying vec2 coord;

void main() {
  vec4 info = texture2D(tInput, coord);

  vec2 dx = vec2(delta.x, 0.0);
  vec2 dy = vec2(0.0, delta.y);

  // Discrete Laplacian, split per axis as upstream does for non-square pools.
  float d2h_dx2 = texture2D(tInput, coord + dx).r + texture2D(tInput, coord - dx).r - 2.0 * info.r;
  float d2h_dz2 = texture2D(tInput, coord + dy).r + texture2D(tInput, coord - dy).r - 2.0 * info.r;

  // Velocity update (semi-implicit Euler): acceleration = c^2 * laplacian.
  info.g += waveK.x * d2h_dx2 + waveK.y * d2h_dz2;

  // Damping. Open water keeps upstream's gentle decay; the last few
  // centimetres of depth soak the wave up like a beach.
  float depth = -texture2D(tBed, coord).r;
  float open = smoothstep(0.0, 0.4, depth);
  info.g *= mix(0.9, damping, open);

  // Height update.
  info.r += info.g;

  // Nothing should survive under the banks, and a very slow pull toward rest
  // stops the mean level creeping up after many splashes.
  info.r *= mix(0.9, 0.9996, smoothstep(-0.3, 0.02, depth));

  gl_FragColor = info;
}
