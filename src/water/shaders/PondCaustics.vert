// Derived from threejs-water (MIT) src/shaders/Caustics.vert @ f35a700.
// Original WebGL Water (c) 2011 Evan Wallace, Three.js port (c) 2026 Yong Su.
//
// Upstream idea, unchanged: draw a grid that matches the water surface, but
// place every vertex where its sun ray lands after refracting through the
// surface. Comparing the flat-water landing spot (oldPos) with the wavy one
// (newPos) tells the fragment shader how much the light was focused.
//
// Pond changes: the unit pool box is gone. Rays are projected onto a reference
// plane `causticDepth` below the surface (the pond bed has no single depth),
// positions are in metres across the whole simulation square, and the breeze
// detail is added to the simulated normal so the bed shimmers even when the
// duck is sitting still.
const float IOR_AIR = 1.0;
const float IOR_WATER = 1.333;

uniform vec3 light;         // unit vector toward the sun
uniform sampler2D water;    // R: height, BA: normal.xz
uniform float domainHalf;   // half-size of the simulated square (m)
uniform float causticDepth; // depth of the plane the pattern is focused on (m)
uniform float causticGain;  // artistic boost of the breeze contribution

varying vec3 oldPos;
varying vec3 newPos;
varying vec3 ray;

#include_breeze

void main() {
  vec4 info = texture2D(water, position.xy * 0.5 + 0.5);
  vec2 world = position.xy * domainHalf;

  // Upstream halves the stored normal for smoother caustics.
  vec2 slope = info.ba * 0.5 + breezeSlopeLod(world, 1.5) * causticGain;
  slope = clamp(slope, vec2(-0.999), vec2(0.999));
  float slopeLengthSq = min(dot(slope, slope), 0.999);
  vec3 normal = normalize(vec3(slope.x, sqrt(max(0.001, 1.0 - slopeLengthSq)), slope.y));

  vec3 refractedLight = refract(-light, vec3(0.0, 1.0, 0.0), IOR_AIR / IOR_WATER);
  ray = refract(-light, normal, IOR_AIR / IOR_WATER);

  // position.xzy swizzle: the grid is authored in XY and laid flat in XZ.
  vec3 surface = vec3(world.x, 0.0, world.y);
  oldPos = surface + refractedLight * (causticDepth / -refractedLight.y);
  newPos = surface + vec3(0.0, info.r, 0.0) + ray * ((causticDepth + info.r) / max(-ray.y, 0.05));

  // The texture is indexed by where the straight (flat-water) ray through a
  // point crosses the surface, exactly like upstream's 0.75-scaled lookup.
  vec2 entry = newPos.xz - newPos.y * refractedLight.xz / refractedLight.y;
  gl_Position = vec4(entry / domainHalf, 0.0, 1.0);
}
