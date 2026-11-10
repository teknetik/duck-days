import * as THREE from 'three';

/**
 * Uniforms shared (by reference) between the water passes and every scene
 * material that needs to know about the pond: caustics, depth tint, the wet
 * band at the waterline, wind, and the simulated surface height.
 */
export interface PondUniforms {
  pondCaustics: { value: THREE.Texture | null };
  pondWaterTex: { value: THREE.Texture | null };
  /** Unit vector along the sun ray after it has refracted into the water (points down). */
  pondRefractedLight: { value: THREE.Vector3 };
  pondWaterLevel: { value: number };
  pondHalf: { value: number };
  pondTime: { value: number };
  pondCausticStrength: { value: number };
  pondShallowTint: { value: THREE.Color };
  pondDeepTint: { value: THREE.Color };
  /** x, z wind direction and overall strength in z. */
  pondWind: { value: THREE.Vector3 };
  /** The duck's position; floating leaves ease out of its way. */
  pondDuck: { value: THREE.Vector3 };
  /** 1 in the main view: foliage between the lens and the duck is thinned so the duck stays visible. */
  pondSightline: { value: number };
}

export function createPondUniforms(domainHalf: number, sunDirection: THREE.Vector3): PondUniforms {
  // refract(-light, up, 1 / 1.333)
  const eta = 1 / 1.333;
  const incident = sunDirection.clone().negate();
  const cosI = sunDirection.y;
  const k = 1 - eta * eta * (1 - cosI * cosI);
  const refracted = incident
    .multiplyScalar(eta)
    .add(new THREE.Vector3(0, 1, 0).multiplyScalar(eta * cosI - Math.sqrt(k)))
    .normalize();
  return {
    pondCaustics: { value: null },
    pondWaterTex: { value: null },
    pondRefractedLight: { value: refracted },
    pondWaterLevel: { value: 0 },
    pondHalf: { value: domainHalf },
    pondTime: { value: 0 },
    pondCausticStrength: { value: 1 },
    pondShallowTint: { value: new THREE.Color(1.0, 0.86, 0.6) },
    pondDeepTint: { value: new THREE.Color(0.5, 0.84, 0.8) },
    pondWind: { value: new THREE.Vector3(0.94, -0.34, 1) },
    pondDuck: { value: new THREE.Vector3(0, -10, 0) },
    pondSightline: { value: 0 },
  };
}

export interface PondMaterialOptions {
  /** Caustics + depth tint below the surface. Default true. */
  underwater?: boolean;
  /** Darken and gloss the surface in a band just above the waterline (mud, rocks, bark). */
  wetBand?: boolean;
  /**
   * Wind sway. `amplitude` is metres of travel at `height` metres above the
   * object's origin; `speed` scales the gust frequency; `underwater` selects a
   * slow current-like motion for pondweed.
   */
  wind?: { amplitude: number; height: number; speed?: number; underwater?: boolean };
  /** Ride the simulated water surface (lily pads, blooms): bob and tilt with passing ripples. */
  floatOnWater?: { gain: number };
  /** Dither the surface away right in front of the lens, so reeds and leaves never wall off the view. */
  nearFade?: boolean;
  /** World-space triplanar grain multiplied into the base colour (rocks). */
  detail?: { texture: THREE.Texture; scale: number };
  /** Distinguishes otherwise identical option sets in the shader cache. */
  key?: string;
}

const VERTEX_PARS = /* glsl */ `
varying vec3 vPondWorld;
uniform float pondTime;
uniform vec3 pondWind;
uniform float pondHalf;
uniform sampler2D pondWaterTex;
uniform vec3 pondDuck;
`;

const FRAGMENT_PARS = /* glsl */ `
varying vec3 vPondWorld;
uniform sampler2D pondCaustics;
uniform vec3 pondRefractedLight;
uniform float pondWaterLevel;
uniform float pondHalf;
uniform float pondCausticStrength;
uniform vec3 pondShallowTint;
uniform vec3 pondDeepTint;
uniform vec3 pondDuck;
uniform float pondSightline;
`;

function windChunk(o: NonNullable<PondMaterialOptions['wind']>): string {
  const speed = (o.speed ?? 1).toFixed(3);
  const amp = o.amplitude.toFixed(4);
  const invHeight = (1 / o.height).toFixed(4);
  if (o.underwater) {
    return /* glsl */ `
    {
      vec3 pondOrigin = (modelMatrix * pondInstance * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
      float bendT = clamp(abs(transformed.y) * ${invHeight}, 0.0, 1.6);
      float bend = bendT * bendT;
      float ph = dot(pondOrigin.xz, vec2(1.7, 2.3));
      float t = pondTime * ${speed};
      transformed.x += (sin(t * 0.9 + ph + transformed.y * 2.2) + 0.5 * sin(t * 1.7 + ph * 1.3)) * ${amp} * bend;
      transformed.z += (cos(t * 0.7 + ph * 0.8 + transformed.y * 1.8)) * ${amp} * 0.7 * bend;
    }`;
  }
  return /* glsl */ `
    {
      vec3 pondOrigin = (modelMatrix * pondInstance * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
      float bendT = clamp(abs(transformed.y) * ${invHeight}, 0.0, 1.8);
      float bend = bendT * bendT;
      float ph = dot(pondOrigin.xz, vec2(0.37, 0.29));
      float t = pondTime * ${speed};
      // A travelling gust plus a faster flutter, expressed in the object's own frame.
      float gust = sin(t * 0.8 - ph) * 0.6 + sin(t * 1.9 - ph * 1.6) * 0.3 + 0.35;
      float flutter = sin(t * 5.3 + ph * 7.0 + transformed.y * 6.0) * 0.12;
      vec3 windWorld = vec3(pondWind.x, 0.0, pondWind.y) * pondWind.z;
      vec3 windLocal = (inverse(mat3(modelMatrix * pondInstance)) * windWorld);
      float lenL = max(length(windLocal), 1.0e-5);
      windLocal = windLocal / lenL * min(lenL, 4.0);
      transformed += windLocal * (gust + flutter) * ${amp} * bend;
    }`;
}

function floatChunk(o: NonNullable<PondMaterialOptions['floatOnWater']>): string {
  return /* glsl */ `
    {
      vec3 pondOrigin = (modelMatrix * pondInstance * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
      vec4 pondInfo = texture2D(pondWaterTex, pondOrigin.xz / (2.0 * pondHalf) + 0.5);
      vec3 rel = mat3(modelMatrix * pondInstance) * transformed;
      float scaleY = length((modelMatrix * pondInstance)[1].xyz);
      // Height of the tangent plane of the water at this vertex.
      float lift = (pondInfo.r - dot(pondInfo.ba, rel.xz)) * ${o.gain.toFixed(3)};
      // The duck's breast shoulders floating leaves aside and dips their near edge.
      vec2 pondAway = pondOrigin.xz - pondDuck.xz;
      float pondGap = length(pondAway);
      float pondPush = (1.0 - smoothstep(0.16, 0.5, pondGap)) * step(-0.25, pondDuck.y);
      vec3 pondShove = vec3(pondAway.x, 0.0, pondAway.y) / max(pondGap, 1.0e-3) * pondPush * 0.2;
      pondShove.y = -pondPush * 0.012;
      transformed += inverse(mat3(modelMatrix * pondInstance)) * pondShove;
      transformed.y += lift / max(scaleY, 1.0e-4);
    }`;
}

/**
 * Patches a built-in Three.js material so it takes part in the pond: caustics
 * and depth tint when submerged, a wet band at the waterline, optional wind
 * sway and optional floating on the simulated surface.
 */
export function applyPondShading<T extends THREE.Material>(
  material: T,
  uniforms: PondUniforms,
  options: PondMaterialOptions = {}
): T {
  const underwater = options.underwater ?? true;
  const key = [
    'pond',
    underwater ? 'u' : '',
    options.wetBand ? 'w' : '',
    options.wind
      ? `wind${options.wind.amplitude}_${options.wind.height}_${options.wind.speed ?? 1}_${options.wind.underwater ? 1 : 0}`
      : '',
    options.floatOnWater ? `float${options.floatOnWater.gain}` : '',
    options.nearFade ? 'near' : '',
    options.detail ? `detail${options.detail.scale}` : '',
    options.key ?? '',
  ].join('|');

  material.onBeforeCompile = (shader) => {
    for (const name of Object.keys(uniforms) as (keyof PondUniforms)[]) {
      shader.uniforms[name] = uniforms[name];
    }
    if (options.detail) shader.uniforms.pondDetail = { value: options.detail.texture };

    let vertexBody = '';
    if (options.wind) vertexBody += windChunk(options.wind);
    if (options.floatOnWater) vertexBody += floatChunk(options.floatOnWater);

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERTEX_PARS}`)
      .replace(
        '#include <begin_vertex>',
        /* glsl */ `#include <begin_vertex>
    #ifdef USE_INSTANCING
      mat4 pondInstance = instanceMatrix;
    #else
      mat4 pondInstance = mat4(1.0);
    #endif
    ${vertexBody}
    vPondWorld = (modelMatrix * pondInstance * vec4(transformed, 1.0)).xyz;`
      );

    let fragmentColor = '';
    if (options.detail) {
      fragmentColor += /* glsl */ `
    {
      vec3 pondFace = normalize(cross(dFdx(vPondWorld), dFdy(vPondWorld)));
      vec3 pondW = pow(abs(pondFace), vec3(4.0));
      pondW /= pondW.x + pondW.y + pondW.z;
      float pondS = ${options.detail.scale.toFixed(3)};
      vec3 pondGrain =
        texture2D(pondDetail, vPondWorld.zy * pondS).rgb * pondW.x +
        texture2D(pondDetail, vPondWorld.xz * pondS).rgb * pondW.y +
        texture2D(pondDetail, vPondWorld.xy * pondS).rgb * pondW.z;
      diffuseColor.rgb *= pondGrain * 1.2;
    }`;
    }
    if (options.wetBand) {
      fragmentColor += /* glsl */ `
    {
      float pondWet = 1.0 - smoothstep(0.0, 0.11, vPondWorld.y - pondWaterLevel);
      diffuseColor.rgb *= mix(1.0, 0.55, pondWet);
    }`;
    }

    let fragmentLight = '';
    if (underwater) {
      fragmentLight += /* glsl */ `
    {
      float pondDepth = pondWaterLevel - vPondWorld.y;
      if (pondDepth > 0.0) {
        // Same lookup as upstream's pool walls: follow the straight sun ray back
        // up to the surface and read the caustic map there.
        vec2 pondEntry = vPondWorld.xz + pondDepth * pondRefractedLight.xz / pondRefractedLight.y;
        float pondCaustic = texture2D(pondCaustics, pondEntry / (2.0 * pondHalf) + 0.5, 1.6).r * 5.0;
        // Focus builds up with depth: none at the waterline, full by ~35 cm.
        float pondFocus = smoothstep(0.0, 0.35, pondDepth) * pondCausticStrength;
        float pondGain = mix(1.0, pondCaustic, pondFocus);
        reflectedLight.directDiffuse *= pondGain;
        reflectedLight.directSpecular *= pondGain;
        // Clear amber in the shallows, cooler and dimmer blue-green with depth.
        float pondT = smoothstep(0.15, 2.2, pondDepth);
        vec3 pondTint = mix(pondShallowTint, pondDeepTint, pondT) * mix(1.0, 0.9, pondT);
        reflectedLight.directDiffuse *= pondTint;
        reflectedLight.directSpecular *= pondTint;
        reflectedLight.indirectDiffuse *= pondTint;
        reflectedLight.indirectSpecular *= pondTint;
      }
    }`;
    }

    let fragment = shader.fragmentShader.replace(
      '#include <common>',
      `#include <common>\n${FRAGMENT_PARS}${options.detail ? 'uniform sampler2D pondDetail;\n' : ''}`
    );
    if (options.nearFade) {
      fragment = fragment.replace(
        '#include <clipping_planes_fragment>',
        /* glsl */ `#include <clipping_planes_fragment>
    {
      float pondDither = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
      float pondNear = length(vViewPosition);
      if (pondNear < 1.45 && pondDither > smoothstep(0.85, 1.45, pondNear)) discard;
      // Keep a clear line of sight to the duck through reed beds and hanging leaves.
      if (pondSightline > 0.5) {
        vec3 pondAim = pondDuck + vec3(0.0, 0.1, 0.0) - cameraPosition;
        float pondReach = length(pondAim);
        vec3 pondRay = pondAim / max(pondReach, 1.0e-4);
        vec3 pondRel = vPondWorld - cameraPosition;
        float pondAlong = dot(pondRel, pondRay);
        if (pondAlong > 0.0 && pondAlong < pondReach - 0.1) {
          float pondOff = length(pondRel - pondRay * pondAlong);
          float pondKeep = smoothstep(0.22, 0.62, pondOff);
          if (pondDither > pondKeep) discard;
        }
      }
    }`
      );
    }
    if (fragmentColor) {
      fragment = fragment.replace(
        '#include <color_fragment>',
        `#include <color_fragment>\n${fragmentColor}`
      );
    }
    if (options.wetBand) {
      fragment = fragment.replace(
        '#include <roughnessmap_fragment>',
        /* glsl */ `#include <roughnessmap_fragment>
    roughnessFactor *= mix(1.0, 0.42, 1.0 - smoothstep(0.0, 0.11, vPondWorld.y - pondWaterLevel));`
      );
    }
    if (fragmentLight) {
      fragment = fragment.replace(
        '#include <lights_fragment_end>',
        `#include <lights_fragment_end>\n${fragmentLight}`
      );
    }
    shader.fragmentShader = fragment;
  };
  material.customProgramCacheKey = () => key;
  return material;
}
