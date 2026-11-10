// Derived from threejs-water (MIT) src/shaders/Caustics.frag @ f35a700.
// Original WebGL Water (c) 2011 Evan Wallace, Three.js port (c) 2026 Yong Su.
//
// Differential-area caustics, as upstream: brightness = area the light covered
// under flat water / area it covers now. The pool-rim shadow and the analytic
// sphere/cube shadows are removed; the pond's shadows come from the regular
// Three.js shadow map instead.
precision highp float;

varying vec3 oldPos;
varying vec3 newPos;
varying vec3 ray;

void main() {
  float oldArea = length(dFdx(oldPos)) * length(dFdy(oldPos));
  float newArea = length(dFdx(newPos)) * length(dFdy(newPos));

  // 0.2 == unfocused light, the same scale upstream stores.
  float intensity = clamp(oldArea / max(newArea, 1.0e-7), 0.0, 6.0) * 0.2;
  gl_FragColor = vec4(intensity, 1.0, 0.0, 1.0);
}
