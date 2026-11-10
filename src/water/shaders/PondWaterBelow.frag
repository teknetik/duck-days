// Derived from threejs-water (MIT) src/shaders/WaterBelow.frag @ f35a700.
// Original WebGL Water (c) 2011 Evan Wallace, Three.js port (c) 2026 Yong Su.
//
// The underside of the surface. As upstream: flip the normal, reflect and
// refract with the inverted index ratio, and let total internal reflection
// fall out of refract() returning a zero vector. Outside Snell's window you
// see the pond bed mirrored; inside it, the sky and trees above.
uniform vec3 underwaterColor;

void main() {
  float dist = length(vPosition - eye);
  vec4 info;
  vec2 coord;
  vec3 normal = -surfaceNormal(info, coord, dist);

  vec3 incomingRay = normalize(vPosition - eye);
  vec3 reflectedRay = reflect(incomingRay, normal);
  vec3 refractedRay = refract(incomingRay, normal, IOR_WATER / IOR_AIR);

  float fresnel = mix(0.5, 1.0, pow(1.0 - max(dot(normal, -incomingRay), 0.0), 3.0));

  // Mirrored underwater scene (pond bed, weed, fish) for the reflected ray.
  vec4 planar = sampleProjectedSoft(
    reflectionTex,
    reflectionViewProjectionMatrix,
    vPosition + reflectedRay * reflectionDistance
  );
  vec3 reflectedColor = mix(fogColor, planar.rgb, planar.a) * underwaterColor;

  // Snell's window: sky cube first, then the above-water pass where it has coverage.
  float window = length(refractedRay);
  vec3 skyRay = normalize(refractedRay + vec3(0.0, 1.0e-3, 0.0));
  vec4 above = sampleProjectedTexture(
    refractionTex,
    viewProjectionMatrix,
    vPosition + skyRay * reflectionDistance
  );
  vec3 refractedColor = mix(skyColor(skyRay, 1.0 - above.a), above.rgb, above.a) * vec3(0.8, 1.0, 1.1);

  vec3 color = mix(reflectedColor, refractedColor, (1.0 - fresnel) * window);

  // Water between the eye and the surface.
  float fog = 1.0 - exp(-fogDensity * fogDensity * dist * dist);
  color = mix(color, fogColor, fog);

  gl_FragColor = vec4(color, 1.0);

  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
