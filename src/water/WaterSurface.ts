/**
 * Derived from threejs-water (MIT) src/rendering/WaterSurfacePass.ts @ f35a700
 * https://github.com/jeantimex/threejs-water
 * Original WebGL Water (c) 2011 Evan Wallace, Three.js port (c) 2026 Yong Su.
 *
 * Two meshes share one displaced grid, exactly as upstream: one culled so it
 * only shows from above the surface, one so it only shows from below. Both
 * are always in the scene, so a ripple passing across the camera never leaves
 * a hole -- the correct face is simply the one that rasterises.
 */
import * as THREE from 'three';
import waterVert from './shaders/PondWater.vert?raw';
import commonChunk from './shaders/PondCommon.glsl?raw';
import breezeChunk from './shaders/Breeze.glsl?raw';
import aboveFrag from './shaders/PondWaterAbove.frag?raw';
import belowFrag from './shaders/PondWaterBelow.frag?raw';
import type { WaterSim } from './WaterSim';
import type { PlanarPasses } from './PlanarPasses';

export interface WaterSurfaceOptions {
  domainHalf: number;
  gridSegments: number;
  bedTexture: THREE.Texture;
  rippleTexture: THREE.Texture;
  lightDirection: THREE.Vector3;
  planar: PlanarPasses;
}

function buildFragment(body: string): string {
  return `${commonChunk.replace('#include_breeze', breezeChunk)}\n${body}`;
}

export class WaterSurface {
  readonly aboveMesh: THREE.Mesh;
  readonly belowMesh: THREE.Mesh;
  /** Uniforms shared by both faces of the surface. */
  readonly uniforms: Record<string, THREE.IUniform>;

  private readonly aboveMaterial: THREE.ShaderMaterial;
  private readonly belowMaterial: THREE.ShaderMaterial;
  private readonly eye = new THREE.Vector3();

  constructor(private readonly options: WaterSurfaceOptions) {
    this.uniforms = {
      water: { value: null },
      bedTex: { value: options.bedTexture },
      rippleTex: { value: options.rippleTexture },
      reflectionTex: { value: options.planar.reflectionTarget.texture },
      refractionTex: { value: options.planar.refractionTarget.texture },
      sky: { value: null },
      viewProjectionMatrix: { value: options.planar.viewProjectionMatrix },
      reflectionViewProjectionMatrix: { value: options.planar.reflectionViewProjectionMatrix },
      eye: { value: this.eye },
      light: { value: options.lightDirection.clone() },
      time: { value: 0 },
      domainHalf: { value: options.domainHalf },
      rippleStrength: { value: 0.05 },
      reflectionDistance: { value: 5 },
      deepColor: { value: new THREE.Color(0.035, 0.115, 0.1) },
      absorption: { value: new THREE.Vector3(0.2, 0.26, 0.62) },
      scatterDensity: { value: 0.42 },
      fogColor: { value: new THREE.Color(0.05, 0.19, 0.17) },
      fogDensity: { value: 0.16 },
      fresnelBase: { value: 0.045 },
      fresnelPower: { value: 4.0 },
      underwaterColor: { value: new THREE.Color(0.55, 0.92, 0.95) },
    };

    this.aboveMaterial = new THREE.ShaderMaterial({
      vertexShader: waterVert,
      fragmentShader: buildFragment(aboveFrag),
      uniforms: this.uniforms,
      side: THREE.BackSide,
      depthTest: true,
      depthWrite: true,
    });
    this.belowMaterial = new THREE.ShaderMaterial({
      vertexShader: waterVert,
      fragmentShader: buildFragment(belowFrag),
      uniforms: this.uniforms,
      side: THREE.FrontSide,
      depthTest: true,
      depthWrite: true,
    });

    const n = options.gridSegments;
    const geometry = new THREE.PlaneGeometry(2, 2, n, n);
    this.aboveMesh = new THREE.Mesh(geometry, this.aboveMaterial);
    this.belowMesh = new THREE.Mesh(geometry, this.belowMaterial);
    for (const mesh of [this.aboveMesh, this.belowMesh]) {
      mesh.frustumCulled = false;
      mesh.matrixAutoUpdate = false;
      // Drawn after the opaque scene so the banks reject most of the hidden square early.
      mesh.renderOrder = 5;
    }
    this.aboveMesh.name = 'waterAbove';
    this.belowMesh.name = 'waterBelow';
  }

  setVisible(visible: boolean) {
    this.aboveMesh.visible = visible;
    this.belowMesh.visible = visible;
  }

  setSky(texture: THREE.Texture) {
    this.uniforms.sky.value = texture;
  }

  prepare(sim: WaterSim, camera: THREE.Camera, time: number) {
    camera.getWorldPosition(this.eye);
    this.uniforms.water.value = sim.texture;
    this.uniforms.time.value = time;
  }

  dispose() {
    this.aboveMesh.geometry.dispose();
    this.aboveMaterial.dispose();
    this.belowMaterial.dispose();
  }

  get domainHalf() {
    return this.options.domainHalf;
  }
}
