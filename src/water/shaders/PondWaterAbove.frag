// Derived from threejs-water (MIT) src/shaders/WaterAbove.frag @ f35a700.
// Original WebGL Water (c) 2011 Evan Wallace, Three.js port (c) 2026 Yong Su.
//
// Kept from upstream: parallax-refined heightfield lookup, normal
// reconstruction, reflect/refract rays through the air-water interface, and a
// Fresnel blend of the two traced colours.
//
// Replaced for the pond: upstream intersects both rays with an analytic tiled
// pool box. A pond has no box, so
//  - the reflected ray reads a baked sky/tree-line cube map, overlaid with a
//    planar reflection pass for nearby banks, reeds, lilies and the duck;
//  - the refracted ray is followed down to the real pond bed (depth from the
//    bed texture) and reads a refraction pass rendered from the scene, then is
//    tinted with depth: clear amber in the shallows, blue-green in deep water.
uniform float fresnelBase;
uniform float fresnelPower;

void main() {
  float dist = length(vPosition - eye);
  vec4 info;
  vec2 coord;
  vec3 normal = surfaceNormal(info, coord, dist);

  // Water column under this fragment; the hidden part of the square that lies
  // under the banks is never drawn.
  float depth = info.r - texture2D(bedTex, coord).r;
  if (depth < -0.015) discard;

  vec3 incomingRay = normalize(vPosition - eye);
  vec3 reflectedRay = reflect(incomingRay, normal);
  reflectedRay.y = abs(reflectedRay.y);
  vec3 refractedRay = refract(incomingRay, normal, IOR_AIR / IOR_WATER);

  // Schlick-style Fresnel (upstream uses the same form with artistic constants).
  float fresnel = mix(fresnelBase, 1.0, pow(1.0 - max(dot(normal, -incomingRay), 0.0), fresnelPower));

  // Reflection: sky and distant woodland, then anything close enough to matter.
  vec4 planar = sampleProjectedSoft(
    reflectionTex,
    reflectionViewProjectionMatrix,
    vPosition + reflectedRay * reflectionDistance
  );
  vec3 reflectedColor = mix(skyColor(reflectedRay, 1.0 - planar.a), planar.rgb, planar.a);

  // Refraction: follow the bent ray to the bed. Where the bent lookup would
  // leave the screen (or finds nothing), ease over to looking straight
  // through, so there is never a hard seam near the frame edge.
  float path = clamp(depth / max(-refractedRay.y, 0.2), 0.0, 5.0);
  vec4 bentClip = viewProjectionMatrix * vec4(vPosition + refractedRay * max(path, 0.02), 1.0);
  vec2 bentUv = bentClip.xy / max(bentClip.w, 1.0e-6) * 0.5 + 0.5;
  vec4 straightClip = viewProjectionMatrix * vec4(vPosition + incomingRay * 0.02, 1.0);
  vec2 straightUv = clamp(straightClip.xy / max(straightClip.w, 1.0e-6) * 0.5 + 0.5, 0.0, 1.0);
  vec2 margin = min(bentUv, 1.0 - bentUv);
  float inside = smoothstep(0.0, 0.07, min(margin.x, margin.y)) * step(0.0, bentClip.w);
  vec4 bent = texture2D(refractionTex, clamp(bentUv, 0.0, 1.0));
  vec4 straight = texture2D(refractionTex, straightUv);
  vec4 refracted = mix(straight, bent, inside * step(0.5, bent.a));
  vec3 bedColor = mix(deepColor, refracted.rgb, refracted.a);
  vec3 transmittance = exp(-absorption * path);
  float scatter = 1.0 - exp(-path * scatterDensity);
  vec3 refractedColor = mix(bedColor * transmittance, deepColor, scatter);

  // Let the film of water at the very edge go clear so the shoreline is soft.
  float shore = smoothstep(0.0, 0.07, depth);

  gl_FragColor = vec4(mix(refractedColor, reflectedColor, fresnel * shore), 1.0);

  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
