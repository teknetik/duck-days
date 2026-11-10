// Derived from threejs-water (MIT) src/shaders/WaterAbove.vert / WaterBelow.vert @ f35a700.
// Original WebGL Water (c) 2011 Evan Wallace, Three.js port (c) 2026 Yong Su.
//
// Displaces a flat grid by the simulated height. The grid is authored in XY
// and rendered as the horizontal XZ plane; the only pond change is scaling the
// unit square out to the pond's size in metres.
uniform sampler2D water;
uniform float domainHalf;

varying vec3 vPosition;

void main() {
  vec4 info = texture2D(water, position.xy * 0.5 + 0.5);

  vPosition = vec3(position.x * domainHalf, info.r, position.y * domainHalf);

  gl_Position = projectionMatrix * viewMatrix * vec4(vPosition, 1.0);
}
