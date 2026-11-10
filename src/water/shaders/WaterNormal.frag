// From threejs-water (MIT) src/shaders/WaterNormal.frag @ f35a700 (comments condensed).
// Original WebGL Water (c) 2011 Evan Wallace, Three.js port (c) 2026 Yong Su.
//
// Computes the surface normal of the heightfield with finite differences in
// physical units and stores normal.xz in the BA channels.
precision highp float;

uniform sampler2D tInput;
uniform float poolWidth;  // half-width of the simulated square in metres
uniform float poolLength; // half-length of the simulated square in metres
uniform vec2 delta;

varying vec2 coord;

void main() {
  vec4 info = texture2D(tInput, coord);

  // Tangent toward the +X neighbour: (dx, dheight, 0)
  vec3 dx = vec3(
    delta.x * 2.0 * poolWidth,
    texture2D(tInput, vec2(coord.x + delta.x, coord.y)).r - info.r,
    0.0
  );

  // Tangent toward the +Z neighbour: (0, dheight, dz)
  vec3 dy = vec3(
    0.0,
    texture2D(tInput, vec2(coord.x, coord.y + delta.y)).r - info.r,
    delta.y * 2.0 * poolLength
  );

  // N = T_z x T_x; only x and z are stored, y is rebuilt where it is needed.
  info.ba = normalize(cross(dy, dx)).xz;

  gl_FragColor = info;
}
