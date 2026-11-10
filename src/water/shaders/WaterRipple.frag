// From threejs-water (MIT) src/shaders/WaterRipple.frag @ f35a700 (comments condensed).
// Original WebGL Water (c) 2011 Evan Wallace, Three.js port (c) 2026 Yong Su.
//
// Adds one smooth circular drop to the heightfield. Used for the duck's idle
// ripple, paddle strokes, dive splash and resurfacing rings.
precision highp float;

const float PI = 3.141592653589793;

uniform sampler2D tInput;
uniform vec2 center;    // drop centre in NDC [-1, 1]
uniform float radius;   // radius as a fraction of the pool length
uniform float strength; // height added at the centre (metres); negative digs a dent
uniform float poolWidth;
uniform float poolLength;

varying vec2 coord;

void main() {
  vec4 info = texture2D(tInput, coord);

  vec2 physicalDiff = (coord - (center * 0.5 + 0.5)) * 2.0 * vec2(poolWidth, poolLength);
  float physRadius = radius * 2.0 * poolLength;
  float drop = max(0.0, 1.0 - length(physicalDiff) / physRadius);

  // Raised-cosine (Hann) profile: no sharp edges, so no high-frequency noise.
  drop = 0.5 - cos(drop * PI) * 0.5;

  info.r += drop * strength;

  gl_FragColor = info;
}
