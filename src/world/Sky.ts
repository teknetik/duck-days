import * as THREE from 'three';
import { SUN_DIRECTION } from './PondLayout';

/** Layer that only the main camera and the environment bake can see (the sky dome). */
export const SKY_LAYER = 1;

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_Position.z = gl_Position.w; // pin to the far plane
}
`;

const SKY_FRAG = /* glsl */ `
precision highp float;
uniform vec3 sunDir;
varying vec3 vDir;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++) {
    s += a * noise(p);
    p = p * 2.03 + 11.7;
    a *= 0.5;
  }
  return s;
}

void main() {
  vec3 dir = normalize(vDir);
  float h = clamp(dir.y, -1.0, 1.0);
  float sunAmount = max(dot(dir, sunDir), 0.0);
  // How much this direction faces the sun's side of the sky, ignoring height.
  float sunSide = max(dot(normalize(dir.xz + 1.0e-5), normalize(sunDir.xz)), 0.0);

  // Late afternoon: warm, hazy horizon under a soft blue dome.
  vec3 zenith = vec3(0.16, 0.33, 0.66);
  vec3 mid = vec3(0.42, 0.58, 0.82);
  vec3 horizonCool = vec3(0.78, 0.8, 0.78);
  vec3 horizonWarm = vec3(1.25, 0.86, 0.5);
  vec3 horizon = mix(horizonCool, horizonWarm, pow(sunSide, 2.0));
  float t = pow(clamp(h, 0.0, 1.0), 0.42);
  vec3 col = mix(horizon, mid, smoothstep(0.0, 0.45, t));
  col = mix(col, zenith, smoothstep(0.4, 1.0, t));

  // Sun glow and disc.
  col += vec3(1.0, 0.62, 0.3) * pow(sunAmount, 6.0) * 0.55;
  col += vec3(1.0, 0.8, 0.55) * pow(sunAmount, 48.0) * 1.2;
  col += vec3(9.0, 7.2, 5.0) * smoothstep(0.99962, 0.99982, sunAmount);

  // High, combed-out cloud catching the low light.
  vec2 cuv = dir.xz / (max(h, 0.0) + 0.22);
  float cloud = fbm(cuv * vec2(0.9, 1.7) + vec2(3.1, 0.4));
  cloud = smoothstep(0.52, 0.86, cloud) * smoothstep(0.02, 0.28, h);
  vec3 cloudLit = mix(vec3(0.95, 0.9, 0.86), vec3(1.5, 1.05, 0.72), pow(sunSide, 1.5));
  col = mix(col, cloudLit, cloud * 0.6);

  // Ragged, hazy line of distant woodland right on the horizon.
  float az = atan(dir.z, dir.x);
  float ridge = 0.075 + 0.06 * noise(vec2(az * 7.0, 1.3)) + 0.025 * noise(vec2(az * 37.0, 7.7));
  float trees = 1.0 - smoothstep(ridge - 0.006, ridge + 0.006, h);
  vec3 treeCol = mix(vec3(0.07, 0.12, 0.05), vec3(0.24, 0.22, 0.1), pow(sunSide, 2.0) * 0.6);
  treeCol = mix(treeCol, horizon * 0.35, 0.3) * (0.75 + 0.5 * noise(vec2(az * 23.0, h * 60.0)));
  col = mix(col, treeCol, trees);

  // Below the horizon: ground bounce, so nothing ever reads as a void.
  col = mix(col, vec3(0.1, 0.12, 0.06), smoothstep(0.0, -0.08, h));

  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export interface FogSetting {
  color: THREE.Color;
  density: number;
}

/** Sky dome, sun, fill light and the two fog moods (air and underwater). */
export class Atmosphere {
  readonly group = new THREE.Group();
  readonly sun: THREE.DirectionalLight;
  readonly hemisphere: THREE.HemisphereLight;
  readonly skyDome: THREE.Mesh;
  readonly airFog: FogSetting = { color: new THREE.Color(0.66, 0.58, 0.4), density: 0.0085 };
  readonly waterFog: FogSetting = { color: new THREE.Color(0.075, 0.25, 0.22), density: 0.125 };
  readonly fog = new THREE.FogExp2(0xffffff, 0.0075);

  private cubeTarget: THREE.WebGLCubeRenderTarget | null = null;

  constructor() {
    this.skyDome = new THREE.Mesh(
      new THREE.SphereGeometry(200, 48, 24),
      new THREE.ShaderMaterial({
        vertexShader: SKY_VERT,
        fragmentShader: SKY_FRAG,
        uniforms: { sunDir: { value: SUN_DIRECTION.clone() } },
        side: THREE.BackSide,
        depthWrite: false,
        depthTest: true,
        fog: false,
      })
    );
    this.skyDome.layers.set(SKY_LAYER);
    this.skyDome.frustumCulled = false;
    this.skyDome.renderOrder = -10;
    this.skyDome.name = 'skyDome';

    this.sun = new THREE.DirectionalLight(new THREE.Color(1.0, 0.76, 0.48), 4.6);
    this.sun.position.copy(SUN_DIRECTION).multiplyScalar(90);
    this.sun.target.position.set(0, 0, 0);
    const cam = this.sun.shadow.camera;
    cam.left = -27;
    cam.right = 27;
    cam.top = 27;
    cam.bottom = -27;
    cam.near = 5;
    cam.far = 190;
    this.sun.shadow.bias = -0.0012;
    this.sun.shadow.normalBias = 0.06;
    this.sun.shadow.radius = 2.5;

    this.hemisphere = new THREE.HemisphereLight(
      new THREE.Color(0.5, 0.62, 0.9),
      new THREE.Color(0.34, 0.28, 0.14),
      1.15
    );

    this.group.add(this.skyDome, this.sun, this.sun.target, this.hemisphere);
    this.fog.color.copy(this.airFog.color);
  }

  setShadowQuality(mapSize: number) {
    const enabled = mapSize > 0;
    this.sun.castShadow = enabled;
    if (enabled && this.sun.shadow.mapSize.x !== mapSize) {
      this.sun.shadow.mapSize.set(mapSize, mapSize);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
  }

  /** Blends the scene fog between air (0) and water (1). */
  setFogBlend(submersion: number) {
    this.fog.color.copy(this.airFog.color).lerp(this.waterFog.color, submersion);
    this.fog.density = THREE.MathUtils.lerp(this.airFog.density, this.waterFog.density, submersion);
  }

  /** Keeps the dome centred on the viewer so it never clips. */
  follow(position: THREE.Vector3) {
    this.skyDome.position.copy(position);
  }

  /**
   * Captures sky, tree line and banks into a cube map from just above the
   * middle of the pond. The water samples this for reflections that fall
   * outside the planar pass, and for Snell's window from below.
   */
  bakeEnvironment(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    hidden: THREE.Object3D[]
  ): THREE.CubeTexture {
    if (!this.cubeTarget) {
      this.cubeTarget = new THREE.WebGLCubeRenderTarget(512, {
        type: THREE.HalfFloatType,
        generateMipmaps: false,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
      });
    }
    const cubeCamera = new THREE.CubeCamera(0.2, 400, this.cubeTarget);
    cubeCamera.position.set(0.5, 0.6, 1.5);
    cubeCamera.layers.enable(SKY_LAYER);
    for (const child of cubeCamera.children) child.layers.enable(SKY_LAYER);

    const visibility = hidden.map((o) => o.visible);
    hidden.forEach((o) => (o.visible = false));
    const savedPos = this.skyDome.position.clone();
    this.skyDome.position.copy(cubeCamera.position);
    this.setFogBlend(0);
    cubeCamera.update(renderer, scene);
    this.skyDome.position.copy(savedPos);
    hidden.forEach((o, i) => (o.visible = visibility[i]));
    return this.cubeTarget.texture;
  }
}
