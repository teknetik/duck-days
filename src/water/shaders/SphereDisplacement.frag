// From threejs-water (MIT) src/shaders/Sphere.frag @ f35a700 (comments condensed).
// Original WebGL Water (c) 2011 Evan Wallace, Three.js port (c) 2026 Yong Su.
//
// Displaces the heightfield when a sphere moves: water refills where the
// sphere was and is pushed away from where it now is. Duck Days drags two of
// these lightweight proxies (breast and rump) along with the mallard to draw
// its bow wave and wake.
precision highp float;

uniform sampler2D tInput;
uniform vec3 oldCenter;
uniform vec3 newCenter;
uniform float radius;
uniform float displacementScale;
uniform float poolWidth;
uniform float poolLength;
varying vec2 coord;

float volumeInSphere(vec3 center) {
  // Texture coords -> physical XZ on the rest surface (Y = 0).
  vec3 pointPhys = vec3(
    (coord.x * 2.0 - 1.0) * poolWidth,
    0.0,
    (coord.y * 2.0 - 1.0) * poolLength
  );

  vec3 toCenter = pointPhys - center;
  float t = length(toCenter) / radius;

  // Super-Gaussian falloff: flat near the centre, smooth at the rim.
  float dy = exp(-pow(t * 1.5, 6.0));

  float ymin = min(0.0, center.y - dy);
  float ymax = min(max(0.0, center.y + dy), ymin + 2.0 * dy);

  return (ymax - ymin) * 0.1 * displacementScale;
}

void main() {
  vec4 info = texture2D(tInput, coord);

  info.r += volumeInSphere(oldCenter);
  info.r -= volumeInSphere(newCenter);

  gl_FragColor = info;
}
