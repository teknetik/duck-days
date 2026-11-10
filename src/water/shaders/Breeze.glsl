// Light-breeze detail layered on top of the simulated heightfield. Two
// scrolling octaves of a tiling slope map, masked by slow-moving gust patches
// ("cat's paws") so parts of the pond stay glassy while others ruffle.
// Returns a normal.xz style offset, matching what the simulation stores in BA.
uniform sampler2D rippleTex;
uniform float time;
uniform float rippleStrength;

float breezeGust(vec2 xz) {
  float g = textureLod(rippleTex, xz * 0.013 + vec2(time * 0.006, -time * 0.004), 0.0).b;
  return 0.3 + 1.3 * smoothstep(0.38, 0.72, g);
}

vec2 breezeSlopeLod(vec2 xz, float lod) {
  vec2 a = textureLod(rippleTex, xz * 0.19 + vec2(time * 0.022, time * 0.013), lod).rg * 2.0 - 1.0;
  vec2 b = textureLod(rippleTex, xz * 0.43 + vec2(-time * 0.019, time * 0.031) + 0.37, lod).rg * 2.0 - 1.0;
  return (a + b * 0.55) * rippleStrength * breezeGust(xz);
}
