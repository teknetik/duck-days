// Shared by PondWaterAbove.frag and PondWaterBelow.frag.
// Derived from threejs-water (MIT) src/shaders/WaterAbove.frag / WaterBelow.frag @ f35a700.
// Original WebGL Water (c) 2011 Evan Wallace, Three.js port (c) 2026 Yong Su.
precision highp float;

const float IOR_AIR = 1.0;
const float IOR_WATER = 1.333;

uniform sampler2D water;         // simulation: R height, G velocity, BA normal.xz
uniform sampler2D bedTex;        // R: pond-bed height (m) over the simulated square
uniform sampler2D reflectionTex; // scene mirrored in the water plane (alpha = coverage)
uniform sampler2D refractionTex; // scene on the far side of the surface (alpha = coverage)
uniform samplerCube sky;         // baked sky + tree line + far banks
uniform mat4 viewProjectionMatrix;
uniform mat4 reflectionViewProjectionMatrix;
uniform vec3 eye;
uniform vec3 light;              // unit vector toward the sun
uniform float domainHalf;
uniform float reflectionDistance;
uniform vec3 deepColor;          // light scattered back out of deep water
uniform vec3 absorption;         // per-metre absorption (tea-stained: blue goes first)
uniform float scatterDensity;
uniform vec3 fogColor;           // underwater fog
uniform float fogDensity;

varying vec3 vPosition;

#include_breeze

// Upstream: samples a pre-rendered pass by projecting a world point through
// that pass's camera. Returns alpha 0 when the point lands off-screen.
vec4 sampleProjectedTexture(sampler2D tex, mat4 matrix, vec3 point) {
  vec4 clip = matrix * vec4(point, 1.0);
  vec3 ndc = clip.xyz / max(clip.w, 1.0e-6);
  vec2 uv = ndc.xy * 0.5 + 0.5;
  float inBounds =
    step(0.0, uv.x) * step(0.0, uv.y) * step(uv.x, 1.0) * step(uv.y, 1.0) * step(0.0, clip.w);
  return texture2D(tex, clamp(uv, 0.0, 1.0)) * inBounds;
}

// As above, but a lookup that only just leaves the screen keeps the edge texel
// and fades out, so ripples near the frame edge do not flip abruptly between
// the planar pass and the cube map.
vec4 sampleProjectedSoft(sampler2D tex, mat4 matrix, vec3 point) {
  vec4 clip = matrix * vec4(point, 1.0);
  vec3 ndc = clip.xyz / max(clip.w, 1.0e-6);
  vec2 uv = ndc.xy * 0.5 + 0.5;
  vec2 over = max(max(-uv, uv - 1.0), 0.0);
  float fade = (1.0 - smoothstep(0.0, 0.2, max(over.x, over.y))) * step(0.0, clip.w);
  return texture2D(tex, clamp(uv, 0.001, 0.999)) * fade;
}

// Sky lookup plus upstream's sun-spot highlight.
vec3 skyColor(vec3 ray, float sunVisibility) {
  vec3 color = textureCube(sky, ray).rgb;
  color += vec3(pow(max(0.0, dot(light, ray)), 5000.0)) * vec3(10.0, 8.0, 6.0) * sunVisibility;
  return color;
}

// Upstream steps 1-3: locate this fragment in the simulation, refine the lookup
// along the stored gradient, and rebuild the unit normal. The breeze detail is
// added here and faded with distance so far water stays mirror-smooth.
vec3 surfaceNormal(out vec4 info, out vec2 coord, float dist) {
  coord = vPosition.xz / (2.0 * domainHalf) + 0.5;
  info = texture2D(water, coord);

  for (int i = 0; i < 5; i++) {
    coord = clamp(coord + info.ba * 0.005 / domainHalf, 0.0, 1.0);
    info = texture2D(water, coord);
  }

  float lod = clamp(log2(max(dist, 1.0)) - 1.0, 0.0, 6.0);
  vec2 detail = breezeSlopeLod(vPosition.xz, lod);
  // Finer sparkle close to the camera only.
  vec2 fine = textureLod(rippleTex, vPosition.xz * 1.37 + vec2(time * 0.05, -time * 0.041), lod).rg * 2.0 - 1.0;
  detail += fine * rippleStrength * 0.35 * (1.0 - smoothstep(2.0, 9.0, dist));
  detail *= 1.0 - smoothstep(18.0, 45.0, dist) * 0.6;

  vec2 slope = clamp(info.ba + detail, vec2(-0.999), vec2(0.999));
  float slopeLengthSq = min(dot(slope, slope), 0.999);
  return normalize(vec3(slope.x, sqrt(max(0.001, 1.0 - slopeLengthSq)), slope.y));
}
