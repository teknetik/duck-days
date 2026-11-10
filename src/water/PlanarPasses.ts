/**
 * Derived from threejs-water (MIT) src/rendering/ObjectTexturePass.ts @ f35a700
 * https://github.com/jeantimex/threejs-water
 * Original WebGL Water (c) 2011 Evan Wallace, Three.js port (c) 2026 Yong Su.
 *
 * Upstream pre-renders its floating object into a reflection texture (camera
 * mirrored in the water plane) and a refraction texture (main camera), and the
 * water shaders project into them. The pond does the same thing for the whole
 * woodland scene, split by a clipping plane at the waterline:
 *
 *   reflection = the camera's own side of the surface, mirrored
 *   refraction = the far side of the surface, seen straight through
 *
 * so one pair of targets serves both the above-water and underwater views.
 */
import * as THREE from 'three';

export type PlanarPassKind = 'reflection' | 'refraction';

const NO_CLIP = new THREE.Plane(new THREE.Vector3(0, 1, 0), 1e5);

export class PlanarPasses {
  readonly reflectionTarget: THREE.WebGLRenderTarget;
  readonly refractionTarget: THREE.WebGLRenderTarget;
  readonly reflectionViewProjectionMatrix = new THREE.Matrix4();
  readonly viewProjectionMatrix = new THREE.Matrix4();

  private readonly reflectionCamera = new THREE.PerspectiveCamera();
  private readonly clipPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly clipPlanes: THREE.Plane[];
  private readonly previousClearColor = new THREE.Color();
  private readonly position = new THREE.Vector3();
  private readonly direction = new THREE.Vector3();
  private readonly target = new THREE.Vector3();
  private scale = 0.5;
  /** When false the reflection target is left empty and the water falls back to the cube map. */
  reflectionEnabled = true;

  constructor(private readonly renderer: THREE.WebGLRenderer) {
    const options: THREE.RenderTargetOptions = {
      type: THREE.HalfFloatType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      depthBuffer: true,
      stencilBuffer: false,
      generateMipmaps: false,
    };
    this.reflectionTarget = new THREE.WebGLRenderTarget(512, 512, options);
    this.refractionTarget = new THREE.WebGLRenderTarget(512, 512, options);

    // One plane is always installed (a no-op one for the main view) so every
    // material compiles a single program variant instead of two.
    this.clipPlanes = [this.clipPlane];
    this.clipPlane.copy(NO_CLIP);
    renderer.clippingPlanes = this.clipPlanes;
  }

  setSize(width: number, height: number, scale: number) {
    this.scale = scale;
    const w = Math.max(2, Math.floor(width * scale));
    const h = Math.max(2, Math.floor(height * scale));
    this.reflectionTarget.setSize(w, h);
    this.refractionTarget.setSize(w, h);
  }

  get resolutionScale() {
    return this.scale;
  }

  /**
   * Renders both passes. `cameraUnder` says which side of the surface the main
   * camera is on. `beforePass` lets the caller swap fog etc. per pass.
   */
  render(
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    waterLevel: number,
    cameraUnder: boolean,
    beforePass: (kind: PlanarPassKind) => void
  ) {
    const renderer = this.renderer;
    camera.updateMatrixWorld();
    this.viewProjectionMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);

    const previousTarget = renderer.getRenderTarget();
    renderer.getClearColor(this.previousClearColor);
    const previousClearAlpha = renderer.getClearAlpha();
    renderer.setClearColor(0x000000, 0);

    // Reflection: mirror the camera in the water plane (upstream's construction)
    // and keep only geometry on the camera's side of the surface.
    camera.getWorldPosition(this.position);
    camera.getWorldDirection(this.direction);
    this.target.copy(this.position).add(this.direction);

    const mirror = this.reflectionCamera;
    mirror.copy(camera, false);
    mirror.layers.mask = camera.layers.mask & 1; // scene layer only: no sky dome
    mirror.position.set(this.position.x, 2 * waterLevel - this.position.y, this.position.z);
    mirror.up.set(camera.up.x, -camera.up.y, camera.up.z);
    mirror.lookAt(this.target.x, 2 * waterLevel - this.target.y, this.target.z);
    mirror.updateMatrixWorld();
    this.reflectionViewProjectionMatrix.multiplyMatrices(
      mirror.projectionMatrix,
      mirror.matrixWorldInverse
    );

    const sideSign = cameraUnder ? -1 : 1;
    this.clipPlane.normal.set(0, sideSign, 0);
    this.clipPlane.constant = -sideSign * waterLevel + 0.01;
    renderer.setRenderTarget(this.reflectionTarget);
    renderer.clear();
    if (this.reflectionEnabled) {
      beforePass('reflection');
      renderer.render(scene, mirror);
    }

    // Refraction: main camera, far side of the surface. A little overlap past
    // the waterline keeps wave crests from opening gaps.
    const savedMask = camera.layers.mask;
    camera.layers.mask = savedMask & 1;
    this.clipPlane.normal.set(0, -sideSign, 0);
    this.clipPlane.constant = sideSign * waterLevel + 0.06;
    beforePass('refraction');
    renderer.setRenderTarget(this.refractionTarget);
    renderer.clear();
    renderer.render(scene, camera);
    camera.layers.mask = savedMask;

    this.clipPlane.copy(NO_CLIP);
    renderer.setRenderTarget(previousTarget);
    renderer.setClearColor(this.previousClearColor, previousClearAlpha);
  }

  /**
   * The surface is opaque, so from fully above nothing below it can be seen
   * directly (and vice versa). Clipping the hidden side out of the main render
   * saves shading it only to paint water over the top. While the lens is
   * crossing the waterline both sides are visible, so nothing is clipped.
   */
  setMainClip(waterLevel: number, submersion: number) {
    const margin = 0.16;
    if (submersion <= 0) {
      this.clipPlane.normal.set(0, 1, 0);
      this.clipPlane.constant = -waterLevel + margin;
    } else if (submersion >= 1) {
      this.clipPlane.normal.set(0, -1, 0);
      this.clipPlane.constant = waterLevel + margin;
    } else {
      this.clipPlane.copy(NO_CLIP);
    }
  }

  dispose() {
    this.reflectionTarget.dispose();
    this.refractionTarget.dispose();
  }
}
