import * as THREE from 'three';
import { Rng } from '../core/math';
import { makeBubbleTexture, makeDotTexture } from './textures';

const POINT_VERT = /* glsl */ `
attribute float aSize;
attribute float aAlpha;
uniform float uScale;
varying float vAlpha;
#include <clipping_planes_pars_vertex>
void main() {
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  float dist = max(-mvPosition.z, 0.05);
  // Never let a particle that drifts up to the lens balloon across the screen.
  gl_PointSize = clamp(aSize * uScale / dist, 1.0, uScale * 0.06);
  vAlpha = aAlpha * smoothstep(0.12, 0.5, dist);
  #include <clipping_planes_vertex>
}
`;

const POINT_FRAG = /* glsl */ `
uniform sampler2D map;
uniform vec3 color;
varying float vAlpha;
#include <clipping_planes_pars_fragment>
void main() {
  #include <clipping_planes_fragment>
  vec4 tex = texture2D(map, gl_PointCoord);
  gl_FragColor = vec4(color * tex.rgb, tex.a * vAlpha);
  if (gl_FragColor.a < 0.01) discard;
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/** World-size-to-pixels factor shared by every point cloud; set once per render pass. */
export const particleScale = { value: 600 };

interface Particle {
  alive: boolean;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  size: number;
  age: number;
  life: number;
  seed: number;
}

class PointPool {
  readonly points: THREE.Points;
  protected readonly items: Particle[] = [];
  protected readonly positions: Float32Array;
  protected readonly sizes: Float32Array;
  protected readonly alphas: Float32Array;
  private cursor = 0;

  constructor(count: number, map: THREE.Texture, color: THREE.Color, additive: boolean) {
    this.positions = new Float32Array(count * 3);
    this.sizes = new Float32Array(count);
    this.alphas = new Float32Array(count);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.sizes, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alphas, 1).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.ShaderMaterial({
      vertexShader: POINT_VERT,
      fragmentShader: POINT_FRAG,
      uniforms: { map: { value: map }, color: { value: color }, uScale: particleScale },
      transparent: true,
      depthWrite: false,
      clipping: true,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    for (let i = 0; i < count; i++) {
      this.items.push({
        alive: false,
        pos: new THREE.Vector3(0, -100, 0),
        vel: new THREE.Vector3(),
        size: 0,
        age: 0,
        life: 1,
        seed: i * 1.37,
      });
    }
  }

  protected take(): Particle {
    const p = this.items[this.cursor];
    this.cursor = (this.cursor + 1) % this.items.length;
    p.alive = true;
    p.age = 0;
    return p;
  }

  get aliveCount() {
    let n = 0;
    for (const p of this.items) if (p.alive) n++;
    return n;
  }

  protected write() {
    for (let i = 0; i < this.items.length; i++) {
      const p = this.items[i];
      this.positions[i * 3] = p.pos.x;
      this.positions[i * 3 + 1] = p.alive ? p.pos.y : -100;
      this.positions[i * 3 + 2] = p.pos.z;
      this.sizes[i] = p.alive ? p.size : 0;
    }
    const geo = this.points.geometry;
    geo.getAttribute('position').needsUpdate = true;
    geo.getAttribute('aSize').needsUpdate = true;
    geo.getAttribute('aAlpha').needsUpdate = true;
  }
}

/** Air bubbles trailing from the duck's feathers and feet while it is under. */
export class Bubbles extends PointPool {
  private readonly rng = new Rng(77);
  /** Called when a bubble reaches the surface, with its x/z. */
  onSurface: ((x: number, z: number, size: number) => void) | null = null;

  constructor() {
    super(110, makeBubbleTexture(), new THREE.Color(0.85, 1.0, 1.0), false);
    this.points.name = 'bubbles';
  }

  emit(origin: THREE.Vector3, count: number, spread: number, push?: THREE.Vector3) {
    for (let i = 0; i < count; i++) {
      const p = this.take();
      p.pos.set(
        origin.x + this.rng.range(-spread, spread),
        origin.y + this.rng.range(-spread, spread) * 0.6,
        origin.z + this.rng.range(-spread, spread)
      );
      p.vel.set(this.rng.range(-0.06, 0.06), this.rng.range(0.22, 0.5), this.rng.range(-0.06, 0.06));
      if (push) p.vel.addScaledVector(push, this.rng.range(0.1, 0.45));
      p.size = this.rng.range(0.012, 0.034);
      p.life = 5;
    }
  }

  update(dt: number, waterLevel: number) {
    for (let i = 0; i < this.items.length; i++) {
      const p = this.items[i];
      if (!p.alive) continue;
      p.age += dt;
      // Sideways motion dies quickly; buoyancy takes over and the bubble wobbles upward.
      p.vel.x *= 1 - Math.min(1, dt * 2.5);
      p.vel.z *= 1 - Math.min(1, dt * 2.5);
      p.vel.y = Math.min(p.vel.y + dt * 0.9, 0.55 + p.size * 6);
      p.pos.x += (p.vel.x + Math.sin(p.age * 9 + p.seed) * 0.05) * dt;
      p.pos.z += (p.vel.z + Math.cos(p.age * 8 + p.seed) * 0.05) * dt;
      p.pos.y += p.vel.y * dt;
      this.alphas[i] = Math.min(1, p.age * 10) * 0.85;
      if (p.pos.y >= waterLevel - 0.012) {
        p.alive = false;
        this.onSurface?.(p.pos.x, p.pos.z, p.size);
      } else if (p.age > p.life) {
        p.alive = false;
      }
    }
    this.write();
  }
}

/** Droplets thrown up when the duck slips under or pops back out. */
export class Droplets extends PointPool {
  private readonly rng = new Rng(78);
  onLand: ((x: number, z: number) => void) | null = null;

  constructor() {
    super(140, makeDotTexture(), new THREE.Color(1.5, 1.45, 1.3), false);
    this.points.name = 'droplets';
  }

  /** `power` ~ launch speed in m/s; `ring` is the radius the droplets start on. */
  burst(origin: THREE.Vector3, count: number, power: number, ring: number, forward?: THREE.Vector3) {
    for (let i = 0; i < count; i++) {
      const p = this.take();
      const a = this.rng.range(0, Math.PI * 2);
      const out = this.rng.range(0.25, 1);
      p.pos.set(origin.x + Math.cos(a) * ring, origin.y + 0.01, origin.z + Math.sin(a) * ring);
      p.vel.set(Math.cos(a) * out * power * 0.55, this.rng.range(0.5, 1) * power, Math.sin(a) * out * power * 0.55);
      if (forward) p.vel.addScaledVector(forward, power * 0.35);
      p.size = this.rng.range(0.016, 0.042);
      p.life = 2;
    }
  }

  update(dt: number, waterLevel: number) {
    for (let i = 0; i < this.items.length; i++) {
      const p = this.items[i];
      if (!p.alive) continue;
      p.age += dt;
      p.vel.y -= 9.8 * dt;
      p.pos.addScaledVector(p.vel, dt);
      this.alphas[i] = 0.9;
      if (p.pos.y < waterLevel && p.vel.y < 0) {
        p.alive = false;
        this.onLand?.(p.pos.x, p.pos.z);
      } else if (p.age > p.life) {
        p.alive = false;
      }
    }
    this.write();
  }
}

const SPECK_VERT = /* glsl */ `
attribute float aSeed;
uniform vec3 uCentre;
uniform vec3 uBox;
uniform float uTime;
uniform float uScale;
uniform float uWaterLevel;
varying float vAlpha;
#include <clipping_planes_pars_vertex>
void main() {
  // Each speck drifts slowly, and the whole cloud wraps around the viewer so
  // it never runs out however far the duck swims.
  vec3 drift = vec3(sin(uTime * 0.11 + aSeed * 6.0), sin(uTime * 0.07 + aSeed * 11.0) * 0.4, cos(uTime * 0.09 + aSeed * 4.0)) * 0.35;
  vec3 p = position + drift + vec3(uTime * 0.012, -uTime * 0.004, uTime * 0.008);
  p = mod(p - uCentre + uBox * 0.5, uBox) - uBox * 0.5 + uCentre;
  vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  float dist = -mvPosition.z;
  float twinkle = 0.55 + 0.45 * sin(uTime * 1.7 + aSeed * 40.0);
  vAlpha = twinkle * smoothstep(0.15, 0.6, dist) * (1.0 - smoothstep(4.0, 7.0, dist));
  // Nothing floats above the surface.
  vAlpha *= step(p.y, uWaterLevel - 0.03);
  gl_PointSize = max(1.0, (0.006 + 0.01 * fract(aSeed * 7.3)) * uScale / max(dist, 0.05));
  #include <clipping_planes_vertex>
}
`;

const SPECK_FRAG = /* glsl */ `
uniform sampler2D map;
varying float vAlpha;
#include <clipping_planes_pars_fragment>
void main() {
  #include <clipping_planes_fragment>
  float a = texture2D(map, gl_PointCoord).a * vAlpha;
  if (a < 0.01) discard;
  gl_FragColor = vec4(vec3(0.9, 1.0, 0.85) * 1.2, a * 0.6);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/** Suspended silt and plankton: gives underwater space its depth. */
export class Specks {
  readonly points: THREE.Points;
  private readonly uniforms: {
    uCentre: { value: THREE.Vector3 };
    uBox: { value: THREE.Vector3 };
    uTime: { value: number };
    uScale: { value: number };
    uWaterLevel: { value: number };
    map: { value: THREE.Texture };
  };

  constructor(count: number, waterLevel: number) {
    const rng = new Rng(4711);
    const box = new THREE.Vector3(12, 3.4, 12);
    const positions = new Float32Array(count * 3);
    const seeds = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = rng.range(0, box.x);
      positions[i * 3 + 1] = rng.range(0, box.y);
      positions[i * 3 + 2] = rng.range(0, box.z);
      seeds[i] = rng.f();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
    this.uniforms = {
      uCentre: { value: new THREE.Vector3() },
      uBox: { value: box },
      uTime: { value: 0 },
      uScale: particleScale,
      uWaterLevel: { value: waterLevel },
      map: { value: makeDotTexture() },
    };
    const mat = new THREE.ShaderMaterial({
      vertexShader: SPECK_VERT,
      fragmentShader: SPECK_FRAG,
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      clipping: true,
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.name = 'specks';
  }

  update(time: number, centre: THREE.Vector3) {
    this.uniforms.uTime.value = time;
    // Keep the cloud's vertical span under the surface.
    this.uniforms.uCentre.value.set(centre.x, Math.min(centre.y, -1.75), centre.z);
  }
}
