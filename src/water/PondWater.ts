import * as THREE from 'three';
import type { QualitySettings } from '../core/Quality';
import { CausticsPass } from './CausticsPass';
import { PlanarPasses, type PlanarPassKind } from './PlanarPasses';
import { createPondUniforms, type PondUniforms } from './pondShading';
import { WaterSim } from './WaterSim';
import { WaterSurface } from './WaterSurface';

export interface PondWaterOptions {
  domainHalf: number;
  waterLevel: number;
  bedTexture: THREE.Texture;
  rippleTexture: THREE.Texture;
  sunDirection: THREE.Vector3;
  quality: QualitySettings;
}

/** Tunables that are safe to change live (exposed for the debug/tuning hook). */
export const WATER_TUNING = {
  /** Ripple speed in m/s. A paddling mallard (~1.5 m/s) outruns it, which is what draws a V wake. */
  waveSpeed: 0.68,
  /** Velocity kept per 1/120 s step in open water. */
  damping: 0.9945,
  /** Breeze detail slope on the visible surface. */
  rippleStrength: 0.022,
};

/**
 * The pond's water: upstream's GPU heightfield simulation, caustics and
 * above/below surface shading, wired to the woodland scene. Nothing in here
 * knows about ducks -- callers poke the surface with drops and moving spheres.
 */
export class PondWater {
  readonly uniforms: PondUniforms;
  readonly planar: PlanarPasses;
  sim: WaterSim;
  caustics: CausticsPass;
  surface: WaterSurface;

  private readonly group = new THREE.Group();
  private time = 0;
  private quality: QualitySettings;

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly options: PondWaterOptions
  ) {
    this.quality = options.quality;
    this.uniforms = createPondUniforms(options.domainHalf, options.sunDirection);
    this.uniforms.pondWaterLevel.value = options.waterLevel;
    this.planar = new PlanarPasses(renderer);
    this.sim = this.createSim();
    this.caustics = this.createCaustics();
    this.surface = this.createSurface();
    this.group.name = 'pondWater';
    this.group.add(this.surface.aboveMesh, this.surface.belowMesh);
    this.uniforms.pondCaustics.value = this.caustics.texture;
    this.uniforms.pondWaterTex.value = this.sim.texture;
  }

  get object(): THREE.Object3D {
    return this.group;
  }

  private createSim() {
    return new WaterSim(this.renderer, {
      size: this.quality.waterSize,
      domainHalf: this.options.domainHalf,
      bedTexture: this.options.bedTexture,
      waveSpeed: WATER_TUNING.waveSpeed,
      damping: WATER_TUNING.damping,
    });
  }

  private createCaustics() {
    return new CausticsPass(this.renderer, {
      resolution: this.quality.causticSize,
      gridSegments: this.quality.causticGrid,
      domainHalf: this.options.domainHalf,
      lightDirection: this.options.sunDirection,
      rippleTexture: this.options.rippleTexture,
    });
  }

  private createSurface() {
    return new WaterSurface({
      domainHalf: this.options.domainHalf,
      gridSegments: this.quality.surfaceGrid,
      bedTexture: this.options.bedTexture,
      rippleTexture: this.options.rippleTexture,
      lightDirection: this.options.sunDirection,
      planar: this.planar,
    });
  }

  /** Rebuilds the resolution-dependent parts. The water goes flat for a moment. */
  setQuality(quality: QualitySettings) {
    const sky = this.surface.uniforms.sky.value as THREE.Texture | null;
    this.quality = quality;
    this.group.remove(this.surface.aboveMesh, this.surface.belowMesh);
    this.sim.dispose();
    this.caustics.dispose();
    this.surface.dispose();
    this.sim = this.createSim();
    this.caustics = this.createCaustics();
    this.surface = this.createSurface();
    if (sky) this.surface.setSky(sky);
    this.group.add(this.surface.aboveMesh, this.surface.belowMesh);
    this.uniforms.pondCaustics.value = this.caustics.texture;
    this.uniforms.pondWaterTex.value = this.sim.texture;
  }

  setSize(width: number, height: number) {
    this.planar.reflectionEnabled = this.quality.planarReflection;
    this.planar.setSize(width, height, this.quality.planarScale);
  }

  setSky(texture: THREE.Texture) {
    this.surface.setSky(texture);
  }

  setUnderwaterFog(color: THREE.Color, density: number) {
    (this.surface.uniforms.fogColor.value as THREE.Color).copy(color);
    this.surface.uniforms.fogDensity.value = density;
  }

  addDrop(x: number, z: number, radius: number, strength: number) {
    this.sim.addDrop(x, z, radius, strength);
  }

  moveSphere(oldCenter: THREE.Vector3, newCenter: THREE.Vector3, radius: number, scale: number) {
    this.sim.moveSphere(oldCenter, newCenter, radius, scale);
  }

  /** Steps the simulation and refreshes the caustic map. Call once per frame after all pokes. */
  update(dt: number) {
    this.time += dt;
    this.sim.update(dt);
    this.caustics.uniforms.rippleStrength.value = WATER_TUNING.rippleStrength;
    this.caustics.update(this.sim, this.time);
    this.surface.uniforms.rippleStrength.value = WATER_TUNING.rippleStrength;
    this.uniforms.pondWaterTex.value = this.sim.texture;
    this.uniforms.pondTime.value = this.time;
  }

  /**
   * Renders the reflection and refraction passes for this frame's camera, with
   * the surface itself hidden, then readies the surface for the main render.
   */
  renderPasses(
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    cameraUnder: boolean,
    submersion: number,
    beforePass: (kind: PlanarPassKind | 'main') => void
  ) {
    this.surface.setVisible(false);
    this.planar.render(scene, camera, this.options.waterLevel, cameraUnder, beforePass);
    this.planar.setMainClip(this.options.waterLevel, submersion);
    this.surface.setVisible(true);
    this.surface.prepare(this.sim, camera, this.time);
    beforePass('main');
  }

  setVisible(visible: boolean) {
    this.surface.setVisible(visible);
  }
}
