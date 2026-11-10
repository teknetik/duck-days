/**
 * Derived from threejs-water (MIT) src/Water.ts @ f35a700
 * https://github.com/jeantimex/threejs-water
 * Original WebGL Water (c) 2011 Evan Wallace, Three.js port (c) 2026 Yong Su.
 *
 * Same ping-pong heightfield simulation as upstream:
 *   R: water height, G: vertical velocity, B/A: surface normal x/z.
 * Pond changes: configurable resolution, positions and sizes passed in metres,
 * a fixed 120 Hz step with resolution-independent ripple speed, linear
 * filtering (the camera sits centimetres above the surface, so texel edges
 * would show), and a pond-bed texture that turns the banks into an absorbing
 * shore. The cube / compound-sphere / mesh displacement paths are not needed.
 */
import * as THREE from 'three';
import fullscreenVert from './shaders/Fullscreen.vert?raw';
import waterRippleFrag from './shaders/WaterRipple.frag?raw';
import waveSimulationFrag from './shaders/WaveSimulation.frag?raw';
import waterNormalFrag from './shaders/WaterNormal.frag?raw';
import sphereDisplacementFrag from './shaders/SphereDisplacement.frag?raw';

/** Simulation steps per second. Ripple speed is defined against this. */
const STEP_RATE = 120;
const MAX_STEPS_PER_FRAME = 4;

export interface WaterSimOptions {
  /** Grid resolution (texels per side). */
  size: number;
  /** Half-size of the simulated square in metres. */
  domainHalf: number;
  /** Pond-bed height texture (R channel, metres). */
  bedTexture: THREE.Texture;
  /** Ripple propagation speed in m/s. */
  waveSpeed: number;
  /** Fraction of velocity kept per step in open water (upstream: 0.995). */
  damping: number;
}

export class WaterSim {
  textureA: THREE.WebGLRenderTarget;
  textureB: THREE.WebGLRenderTarget;
  readonly size: number;
  readonly domainHalf: number;

  private readonly renderer: THREE.WebGLRenderer;
  private readonly plane: THREE.Mesh;
  private readonly camera: THREE.OrthographicCamera;
  private readonly scene: THREE.Scene;

  private readonly dropMaterial: THREE.ShaderMaterial;
  private readonly updateMaterial: THREE.ShaderMaterial;
  private readonly normalMaterial: THREE.ShaderMaterial;
  private readonly sphereMaterial: THREE.ShaderMaterial;
  private accumulator = 0;

  constructor(renderer: THREE.WebGLRenderer, options: WaterSimOptions) {
    this.renderer = renderer;
    this.size = options.size;
    this.domainHalf = options.domainHalf;

    const floatLinear = renderer.extensions.has('OES_texture_float_linear');
    const filter = floatLinear || this.getSimulationTextureType() === THREE.HalfFloatType
      ? THREE.LinearFilter
      : THREE.NearestFilter;
    const targetOptions: THREE.RenderTargetOptions = {
      type: this.getSimulationTextureType(),
      minFilter: filter,
      magFilter: filter,
      format: THREE.RGBAFormat,
      stencilBuffer: false,
      depthBuffer: false,
      generateMipmaps: false,
    };

    this.textureA = new THREE.WebGLRenderTarget(this.size, this.size, targetOptions);
    this.textureB = new THREE.WebGLRenderTarget(this.size, this.size, targetOptions);

    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.scene = new THREE.Scene();

    const geometry = new THREE.PlaneGeometry(2, 2);
    const half = this.domainHalf;
    const delta = new THREE.Vector2(1 / this.size, 1 / this.size);

    this.dropMaterial = new THREE.ShaderMaterial({
      vertexShader: fullscreenVert,
      fragmentShader: waterRippleFrag,
      uniforms: {
        tInput: { value: null },
        center: { value: new THREE.Vector2() },
        radius: { value: 0 },
        strength: { value: 0 },
        poolWidth: { value: half },
        poolLength: { value: half },
      },
    });

    // (c * dt / cell)^2 -- the Courant number squared. Must stay below 0.5.
    const cell = (2 * half) / this.size;
    const k = Math.min(0.45, (options.waveSpeed / STEP_RATE / cell) ** 2);
    this.updateMaterial = new THREE.ShaderMaterial({
      vertexShader: fullscreenVert,
      fragmentShader: waveSimulationFrag,
      uniforms: {
        tInput: { value: null },
        tBed: { value: options.bedTexture },
        delta: { value: delta },
        waveK: { value: new THREE.Vector2(k, k) },
        damping: { value: options.damping },
      },
    });

    this.normalMaterial = new THREE.ShaderMaterial({
      vertexShader: fullscreenVert,
      fragmentShader: waterNormalFrag,
      uniforms: {
        tInput: { value: null },
        delta: { value: delta },
        poolWidth: { value: half },
        poolLength: { value: half },
      },
    });

    this.sphereMaterial = new THREE.ShaderMaterial({
      vertexShader: fullscreenVert,
      fragmentShader: sphereDisplacementFrag,
      uniforms: {
        tInput: { value: null },
        oldCenter: { value: new THREE.Vector3() },
        newCenter: { value: new THREE.Vector3() },
        radius: { value: 0 },
        displacementScale: { value: 1.0 },
        poolWidth: { value: half },
        poolLength: { value: half },
      },
    });

    for (const material of [
      this.dropMaterial,
      this.updateMaterial,
      this.normalMaterial,
      this.sphereMaterial,
    ]) {
      material.depthTest = false;
      material.depthWrite = false;
      material.toneMapped = false;
    }

    this.plane = new THREE.Mesh(geometry, this.dropMaterial);
    this.plane.frustumCulled = false;
    this.scene.add(this.plane);
    this.clearTextures();
  }

  /** Current state (height / velocity / normal) for rendering. */
  get texture(): THREE.Texture {
    return this.textureA.texture;
  }

  /** Smallest feature the grid can carry cleanly, in metres. */
  get cellSize(): number {
    return (2 * this.domainHalf) / this.size;
  }

  private getSimulationTextureType() {
    const supportsFloatRenderTarget =
      this.renderer.capabilities.isWebGL2 &&
      this.renderer.extensions.has('EXT_color_buffer_float') &&
      this.renderer.extensions.has('OES_texture_float_linear');

    return supportsFloatRenderTarget ? THREE.FloatType : THREE.HalfFloatType;
  }

  private clearTextures() {
    const previousTarget = this.renderer.getRenderTarget();
    const previousClearColor = new THREE.Color();
    this.renderer.getClearColor(previousClearColor);
    const previousClearAlpha = this.renderer.getClearAlpha();

    this.renderer.setClearColor(0x000000, 0);
    this.renderer.setRenderTarget(this.textureA);
    this.renderer.clear();
    this.renderer.setRenderTarget(this.textureB);
    this.renderer.clear();
    this.renderer.setRenderTarget(previousTarget);
    this.renderer.setClearColor(previousClearColor, previousClearAlpha);
  }

  private swapTextures() {
    const temp = this.textureA;
    this.textureA = this.textureB;
    this.textureB = temp;
  }

  private pass(material: THREE.ShaderMaterial) {
    this.plane.material = material;
    material.uniforms.tInput.value = this.textureA.texture;
    this.renderer.setRenderTarget(this.textureB);
    this.renderer.render(this.scene, this.camera);
    this.renderer.setRenderTarget(null);
    this.swapTextures();
  }

  /**
   * Adds a circular ripple. Position and radius are in metres; `strength` is
   * the height added at the centre (negative digs a dent).
   */
  addDrop(x: number, z: number, radius: number, strength: number) {
    const half = this.domainHalf;
    if (Math.abs(x) > half || Math.abs(z) > half) return;
    // Never inject a feature the grid cannot resolve.
    const r = Math.max(radius, this.cellSize * 2.2);
    this.dropMaterial.uniforms.center.value.set(x / half, z / half);
    this.dropMaterial.uniforms.radius.value = r / (2 * half);
    this.dropMaterial.uniforms.strength.value = strength * Math.min(1, (radius / r) ** 2 * 1.4);
    this.pass(this.dropMaterial);
  }

  /** Displaces water as a sphere moves from `oldCenter` to `newCenter` (metres). */
  moveSphere(
    oldCenter: THREE.Vector3,
    newCenter: THREE.Vector3,
    radius: number,
    displacementScale: number
  ) {
    const r = Math.max(radius, this.cellSize * 3);
    this.sphereMaterial.uniforms.oldCenter.value.copy(oldCenter);
    this.sphereMaterial.uniforms.newCenter.value.copy(newCenter);
    this.sphereMaterial.uniforms.radius.value = r;
    this.sphereMaterial.uniforms.displacementScale.value = displacementScale * (radius / r);
    this.pass(this.sphereMaterial);
  }

  /** Advances the wave equation with a fixed timestep, then refreshes normals. */
  update(dt: number) {
    this.accumulator += Math.min(dt, 0.1);
    let steps = Math.floor(this.accumulator * STEP_RATE);
    this.accumulator -= steps / STEP_RATE;
    steps = Math.min(steps, MAX_STEPS_PER_FRAME);
    for (let i = 0; i < steps; i++) this.pass(this.updateMaterial);
    this.pass(this.normalMaterial);
  }

  dispose() {
    this.textureA.dispose();
    this.textureB.dispose();
    this.plane.geometry.dispose();
    this.dropMaterial.dispose();
    this.updateMaterial.dispose();
    this.normalMaterial.dispose();
    this.sphereMaterial.dispose();
  }
}
