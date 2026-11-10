/**
 * Derived from threejs-water (MIT) src/rendering/CausticsPass.ts @ f35a700
 * https://github.com/jeantimex/threejs-water
 * Original WebGL Water (c) 2011 Evan Wallace, Three.js port (c) 2026 Yong Su.
 *
 * Renders the caustic light map by pushing a surface-aligned grid along the
 * refracted sun rays (see PondCaustics.vert/.frag). The map is then sampled by
 * every underwater material in the pond instead of by a pool-wall shader.
 */
import * as THREE from 'three';
import causticsVertSource from './shaders/PondCaustics.vert?raw';
import causticsFrag from './shaders/PondCaustics.frag?raw';
import breezeChunk from './shaders/Breeze.glsl?raw';
import type { WaterSim } from './WaterSim';

export interface CausticsOptions {
  /** Render target resolution. */
  resolution: number;
  /** Grid segments per side; this is what limits how fine the pattern can be. */
  gridSegments: number;
  domainHalf: number;
  lightDirection: THREE.Vector3;
  rippleTexture: THREE.Texture;
}

export class CausticsPass {
  readonly texture: THREE.Texture;
  readonly uniforms: {
    light: { value: THREE.Vector3 };
    water: { value: THREE.Texture | null };
    rippleTex: { value: THREE.Texture };
    time: { value: number };
    rippleStrength: { value: number };
    domainHalf: { value: number };
    causticDepth: { value: number };
    causticGain: { value: number };
  };

  private readonly target: THREE.WebGLRenderTarget;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly mesh: THREE.Mesh;
  private readonly material: THREE.ShaderMaterial;

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    options: CausticsOptions
  ) {
    this.target = new THREE.WebGLRenderTarget(options.resolution, options.resolution, {
      type: THREE.HalfFloatType,
      // Mip-mapped: the differential-area value is constant per grid triangle,
      // and sampling one level down hides that faceting.
      minFilter: THREE.LinearMipmapLinearFilter,
      magFilter: THREE.LinearFilter,
      generateMipmaps: true,
      format: THREE.RGBAFormat,
      depthBuffer: false,
      stencilBuffer: false,
    });
    this.texture = this.target.texture;

    this.uniforms = {
      light: { value: options.lightDirection.clone() },
      water: { value: null },
      rippleTex: { value: options.rippleTexture },
      time: { value: 0 },
      rippleStrength: { value: 0.05 },
      domainHalf: { value: options.domainHalf },
      causticDepth: { value: 1.1 },
      causticGain: { value: 7.5 },
    };

    this.material = new THREE.ShaderMaterial({
      vertexShader: causticsVertSource.replace('#include_breeze', breezeChunk),
      fragmentShader: causticsFrag,
      uniforms: this.uniforms,
      blending: THREE.NoBlending,
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });

    const n = options.gridSegments;
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2, n, n), this.material);
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
  }

  update(sim: WaterSim, time: number) {
    this.uniforms.water.value = sim.texture;
    this.uniforms.time.value = time;

    const previousColor = new THREE.Color();
    this.renderer.getClearColor(previousColor);
    const previousAlpha = this.renderer.getClearAlpha();

    this.renderer.setRenderTarget(this.target);
    // 0.2 == plain, unfocused sunlight wherever the grid does not land.
    this.renderer.setClearColor(new THREE.Color(0.2, 1, 0), 1);
    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
    this.renderer.setRenderTarget(null);
    this.renderer.setClearColor(previousColor, previousAlpha);
  }

  dispose() {
    this.target.dispose();
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
