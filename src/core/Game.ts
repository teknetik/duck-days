import * as THREE from 'three';
import { AudioSystem } from '../audio/AudioSystem';
import { FollowCamera, CAMERA_TUNING } from '../camera/FollowCamera';
import { DuckAnimator } from '../duck/DuckAnimator';
import { DuckController, DUCK_TUNING } from '../duck/DuckController';
import { buildDuck, DUCK_SCALE, type DuckRig } from '../duck/DuckModel';
import { DuckWake, WAKE_TUNING } from '../duck/DuckWake';
import { Hud } from '../ui/Hud';
import { PondWater, WATER_TUNING } from '../water/PondWater';
import { applyPondShading } from '../water/pondShading';
import { Colliders } from '../world/Colliders';
import { DensityRegistry } from '../world/instancing';
import { buildLilies } from '../world/LilyCove';
import { Bubbles, Droplets, Specks, particleScale } from '../world/Particles';
import { AREAS, POND_HALF, SUN_DIRECTION, WATER_LEVEL, type AreaId } from '../world/PondLayout';
import { buildLog, buildRocks, buildSunkenBranch } from '../world/Props';
import { Atmosphere, SKY_LAYER } from '../world/Sky';
import { Terrain } from '../world/Terrain';
import { makeGroundDetailTexture, makeRippleTexture } from '../world/textures';
import { buildWillow, buildWoodland } from '../world/Trees';
import { buildVegetation } from '../world/Vegetation';
import { Dragonflies, FishSchools } from '../world/Wildlife';
import type { WorldContext } from '../world/WorldContext';
import { Input, type Intents } from './Input';
import { clamp, damp } from './math';
import { QUALITY, loadQualityLevel, saveQualityLevel, type QualityLevel, type QualitySettings } from './Quality';

const MUTE_KEY = 'duck-days.muted';

function loadMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}

function saveMuted(muted: boolean) {
  try {
    localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
  } catch {
    // Not fatal.
  }
}

/**
 * Wires the systems together and owns the frame. Update order is explicit:
 * input -> duck -> animation -> water pokes -> wildlife -> particles ->
 * camera -> water simulation -> audio -> HUD -> render passes -> main render.
 */
export class Game {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly atmosphere: Atmosphere;
  readonly terrain: Terrain;
  readonly water: PondWater;
  readonly duck: DuckController;
  readonly rig: DuckRig;
  readonly animator: DuckAnimator;
  readonly wake: DuckWake;
  readonly follow: FollowCamera;
  readonly fish: FishSchools;
  readonly dragonflies: Dragonflies;
  readonly bubbles: Bubbles;
  readonly droplets: Droplets;
  readonly specks: Specks;
  readonly audio: AudioSystem;
  readonly hud: Hud;
  readonly input: Input;
  readonly colliders = new Colliders();

  private readonly density = new DensityRegistry();
  private readonly ctx: WorldContext;
  private quality: QualitySettings;
  private muted: boolean;
  private time = 0;
  private lastFrame = 0;
  private frameMs = 16.7;
  private running = false;
  private bubbleDebt = 0;
  private breathTimer = 0;
  private area: AreaId | null = null;
  private readonly areaShownAt = new Map<AreaId, number>();
  private readonly forward = new THREE.Vector3();
  private readonly scratch = new THREE.Vector3();
  private rippleBudget = 0;
  /** Lets automated checks drive the duck without a keyboard. */
  private intentOverride: Partial<Intents> | null = null;
  /** Fixed viewpoint for overview screenshots; null in normal play. */
  private debugView: { position: THREE.Vector3; target: THREE.Vector3 } | null = null;
  private firstFrameDone = false;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.quality = QUALITY[loadQualityLevel()];
    this.muted = loadMuted();

    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
      alpha: false,
    });
    if (!renderer.capabilities.isWebGL2) {
      throw new Error('Duck Days needs WebGL 2.');
    }
    if (!renderer.extensions.has('EXT_color_buffer_float') && !renderer.extensions.has('EXT_color_buffer_half_float')) {
      throw new Error('This device cannot render to floating-point textures, which the water simulation needs.');
    }
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    // One shadow pass per frame, not one per reflection / refraction / main render.
    renderer.shadowMap.autoUpdate = false;
    renderer.info.autoReset = false;
    renderer.setClearColor(0x18231a, 1);
    this.renderer = renderer;

    // --- World ---------------------------------------------------------------------------
    this.atmosphere = new Atmosphere();
    this.scene.add(this.atmosphere.group);
    this.scene.fog = this.atmosphere.fog;

    const maxAnisotropy = renderer.capabilities.getMaxAnisotropy();
    const groundDetail = makeGroundDetailTexture();
    groundDetail.anisotropy = Math.min(8, maxAnisotropy);
    const floatLinear = renderer.extensions.has('OES_texture_float_linear');
    this.terrain = new Terrain(groundDetail, floatLinear);
    this.scene.add(this.terrain.group);

    this.water = new PondWater(renderer, {
      domainHalf: POND_HALF,
      waterLevel: WATER_LEVEL,
      bedTexture: this.terrain.bedTexture,
      rippleTexture: makeRippleTexture(),
      sunDirection: SUN_DIRECTION,
      quality: this.quality,
    });
    this.scene.add(this.water.object);
    this.water.setUnderwaterFog(this.atmosphere.waterFog.color, this.atmosphere.waterFog.density);
    applyPondShading(this.terrain.material, this.water.uniforms, { wetBand: true, key: 'terrain' });

    this.ctx = {
      field: this.terrain.field,
      pond: this.water.uniforms,
      colliders: this.colliders,
      density: this.density,
      maxAnisotropy,
      perches: [],
      reedBeds: [],
    };
    this.scene.add(buildWoodland(this.ctx));
    this.scene.add(buildWillow(this.ctx));
    this.scene.add(buildRocks(this.ctx, groundDetail));
    this.scene.add(buildLog(this.ctx));
    this.scene.add(buildSunkenBranch(this.ctx));
    this.scene.add(buildLilies(this.ctx).group);
    this.scene.add(buildVegetation(this.ctx));

    this.fish = new FishSchools(this.ctx);
    this.scene.add(this.fish.mesh);
    this.dragonflies = new Dragonflies(this.ctx);
    this.scene.add(this.dragonflies.group);

    this.bubbles = new Bubbles();
    this.droplets = new Droplets();
    this.specks = new Specks(700, WATER_LEVEL);
    this.scene.add(this.bubbles.points, this.droplets.points, this.specks.points);

    // --- Duck -------------------------------------------------------------------------------
    this.duck = new DuckController(this.terrain.field, this.colliders);
    this.rig = buildDuck(this.water.uniforms);
    this.scene.add(this.rig.root);
    this.animator = new DuckAnimator(this.rig, this.duck);
    this.wake = new DuckWake(this.water, this.duck);
    this.bubbles.onSurface = (x, z, size) => {
      if (this.rippleBudget-- > 0) this.wake.ripple(x, z, 0.07, size * 0.09);
    };
    this.droplets.onLand = (x, z) => {
      if (this.rippleBudget-- > 0) this.wake.ripple(x, z, 0.08, -0.0035);
    };

    // --- Camera, sound, interface --------------------------------------------------------------
    this.follow = new FollowCamera(this.duck, this.terrain.field, this.colliders);
    this.follow.camera.layers.enable(SKY_LAYER);
    this.scene.add(this.follow.camera);

    this.audio = new AudioSystem();
    this.audio.setMuted(this.muted);
    this.input = new Input(canvas);
    this.input.onFirstGesture = () => this.audio.unlock();
    this.hud = new Hud(
      {
        onMute: (muted) => this.setMuted(muted),
        onQuality: (level) => this.setQuality(level),
        onTouchMove: (x, z) => this.input.setTouchMove(x, z),
        onTouchDive: (active) => this.input.setTouchDive(active),
        onTouchQuack: () => this.input.pressQuack(),
      },
      { muted: this.muted, quality: this.quality.level }
    );

    this.applyQuality();
    window.addEventListener('resize', this.resize);
    this.resize();

    // Pose everything once, then capture the surroundings for the water to reflect.
    this.animator.update(0);
    this.follow.update(0, this.input.poll());
    renderer.shadowMap.needsUpdate = true;
    const sky = this.atmosphere.bakeEnvironment(renderer, this.scene, [
      this.water.object,
      this.rig.root,
      this.fish.mesh,
      this.dragonflies.group,
      this.bubbles.points,
      this.droplets.points,
      this.specks.points,
    ]);
    this.water.setSky(sky);
  }

  // ------------------------------------------------------------------------------------------
  // Settings
  // ------------------------------------------------------------------------------------------

  setMuted(muted: boolean) {
    this.muted = muted;
    this.audio.setMuted(muted);
    this.hud.setMuted(muted);
    saveMuted(muted);
  }

  setQuality(level: QualityLevel) {
    if (level === this.quality.level) return;
    this.quality = QUALITY[level];
    saveQualityLevel(level);
    this.water.setQuality(this.quality);
    this.applyQuality();
    this.resize();
    this.hud.setQuality(level);
  }

  private applyQuality() {
    this.shadowDirty = true;
    this.atmosphere.setShadowQuality(this.quality.shadowMapSize);
    this.density.apply(this.quality.foliageDensity);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.quality.maxPixelRatio));
  }

  private resize = () => {
    const width = Math.max(1, this.canvas.clientWidth || window.innerWidth);
    const height = Math.max(1, this.canvas.clientHeight || window.innerHeight);
    this.renderer.setSize(width, height, false);
    this.follow.setAspect(width / height);
    const buffer = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.water.setSize(buffer.x, buffer.y);
  };

  // ------------------------------------------------------------------------------------------
  // Frame
  // ------------------------------------------------------------------------------------------

  start() {
    if (this.running) return;
    this.running = true;
    this.lastFrame = performance.now();
    requestAnimationFrame(this.frame);
  }

  private frame = (now: number) => {
    if (!this.running) return;
    const elapsed = now - this.lastFrame;
    this.lastFrame = now;
    // Long gaps (tab in the background) are simply dropped, never simulated.
    const dt = clamp(elapsed / 1000, 0, 1 / 20);
    this.frameMs = damp(this.frameMs, elapsed, 4, Math.max(dt, 0.001));
    this.update(dt * this.timeScale);
    this.render();
    if (!this.firstFrameDone) {
      this.firstFrameDone = true;
      this.hud.ready();
    }
    requestAnimationFrame(this.frame);
  };

  private pollIntents(): Intents {
    const intents = this.input.poll();
    if (this.intentOverride) Object.assign(intents, this.intentOverride);
    return intents;
  }

  private update(dt: number) {
    this.time += dt;
    this.rippleBudget = 3;
    const intents = this.pollIntents();
    if (intents.toggleMute) this.setMuted(!this.muted);

    // Duck: move, pose, then mark the water.
    const duck = this.duck;
    duck.update(dt, intents, this.follow.yaw);
    this.animator.update(dt);
    this.forward.set(Math.sin(duck.heading), 0, Math.cos(duck.heading));

    if (intents.quack) {
      const timing = this.audio.quack();
      this.animator.quack(timing.syllables);
      if (duck.state !== 'under') {
        this.wake.ripple(duck.position.x + this.forward.x * 0.25, duck.position.z + this.forward.z * 0.25, 0.16, 0.003);
      } else {
        this.emitBubbles(8, 0.05);
      }
    }

    for (const e of duck.events) {
      if (e.type === 'dive') {
        this.audio.splash('dive', clamp(0.55 + duck.speed * 0.25, 0, 1));
        this.scratch.copy(duck.position).addScaledVector(this.forward, 0.12);
        this.scratch.y = WATER_LEVEL;
        this.droplets.burst(this.scratch, 26, 1.7, 0.13, this.forward);
        this.emitBubbles(22, 0.13);
      } else if (e.type === 'surface') {
        this.audio.splash('surface', clamp(0.45 + e.speed * 0.4, 0, 1));
        this.scratch.copy(duck.position);
        this.scratch.y = WATER_LEVEL;
        this.droplets.burst(this.scratch, 20, 1.45, 0.15);
      } else if (e.type === 'dabble') {
        this.audio.splash('surface', 0.15);
      } else if (e.type === 'stroke') {
        if (duck.state === 'under') {
          this.emitBubbles(2, 0.06);
        } else if (e.strength > 0.25) {
          this.audio.paddle(e.side, e.strength);
        }
      }
    }
    this.wake.update(dt, duck.events);

    // Air escaping from the plumage while submerged.
    if (duck.state === 'under') {
      this.bubbleDebt += dt * (5 + duck.speed * 9);
      while (this.bubbleDebt >= 1) {
        this.bubbleDebt -= 1;
        this.emitBubbles(1, 0.07);
      }
      this.breathTimer -= dt;
      if (this.breathTimer <= 0) {
        this.breathTimer = 0.5 + Math.random() * 0.7;
        this.audio.bubbles(clamp(0.25 + duck.speed * 0.3, 0, 1));
      }
    }

    // Wildlife and loose particles.
    this.fish.update(dt, duck.position, duck.state === 'under');
    this.dragonflies.update(dt, duck.position);
    this.bubbles.update(dt, WATER_LEVEL);
    this.droplets.update(dt, WATER_LEVEL);

    // Camera, then everything that depends on where the lens is.
    this.follow.update(dt, intents);
    if (this.debugView) this.follow.override(this.debugView.position, this.debugView.target);
    const eye = this.follow.camera.position;
    this.atmosphere.follow(eye);
    this.specks.update(this.time, eye);

    this.water.uniforms.pondDuck.value.copy(duck.position);
    this.water.update(dt);

    // Sound.
    let nearReeds = 0;
    for (const bed of this.ctx.reedBeds) {
      nearReeds = Math.max(nearReeds, 1 - Math.hypot(bed.x - eye.x, bed.z - eye.z) / 7);
    }
    const breeze = clamp(0.5 + 0.3 * Math.sin(this.time * 0.11) + 0.2 * Math.sin(this.time * 0.37 + 1.3), 0, 1);
    this.audio.update(dt, {
      submersion: this.follow.submersion,
      speed: Math.abs(duck.speed),
      duckUnder: duck.state === 'under',
      breeze,
      nearReeds: clamp(nearReeds, 0, 1),
    });

    // Interface.
    this.updateArea();
    this.hud.update(dt, { moving: duck.hasMoved && duck.speed > 0.3, submersion: this.follow.submersion });
  }

  private emitBubbles(count: number, spread: number) {
    const duck = this.duck;
    this.scratch.copy(duck.position).addScaledVector(this.forward, -0.08 * DUCK_SCALE);
    this.scratch.y = Math.min(this.scratch.y, WATER_LEVEL - 0.03);
    this.bubbles.emit(this.scratch, count, spread, duck.velocity);
  }

  private updateArea() {
    const p = this.duck.position;
    let current: AreaId | null = null;
    for (const area of AREAS) {
      if (Math.hypot(p.x - area.x, p.z - area.z) < area.radius) {
        current = area.id;
        break;
      }
    }
    if (current === this.area) return;
    this.area = current;
    if (!current || this.hud.introVisible) return;
    const last = this.areaShownAt.get(current) ?? -Infinity;
    if (this.time - last < 45) return;
    this.areaShownAt.set(current, this.time);
    const area = AREAS.find((a) => a.id === current)!;
    this.hud.showCaption(area.title, area.subtitle);
  }

  private render() {
    const renderer = this.renderer;
    const camera = this.follow.camera;
    renderer.info.reset();
    // The scene is almost static, so the shadow map is refreshed every other
    // frame -- and at once after a quality change, because the old map has
    // just been thrown away and materials must never sample a missing one.
    if (this.frameCount++ % 2 === 0 || this.shadowDirty) {
      renderer.shadowMap.needsUpdate = true;
      this.shadowDirty = false;
    }

    const fullHeight = renderer.getDrawingBufferSize(this.sizeScratch).y;
    const focal = 0.5 / Math.tan(THREE.MathUtils.degToRad(camera.fov) * 0.5);
    this.water.renderPasses(this.scene, camera, this.follow.under, this.follow.submersion, (kind) => {
      if (kind === 'refraction') {
        // The far side of the surface: the water shader applies its own depth
        // tint when looking down, and air haze is all that is needed looking up.
        this.atmosphere.setFogBlend(0);
      } else {
        this.atmosphere.setFogBlend(this.follow.submersion);
      }
      const scale = kind === 'main' ? 1 : this.water.planar.resolutionScale;
      particleScale.value = fullHeight * scale * focal;
      // Only the player's own view opens a gap in the reeds; reflections stay whole.
      this.water.uniforms.pondSightline.value = kind === 'main' && !this.debugView ? 1 : 0;
    });
    renderer.render(this.scene, camera);
  }

  private readonly sizeScratch = new THREE.Vector2();
  private frameCount = 0;
  private shadowDirty = true;
  /** Slow motion for inspecting splashes; 1 in normal play. */
  private timeScale = 1;

  // ------------------------------------------------------------------------------------------
  // Diagnostics (read-only snapshot plus a few hooks for automated play-testing)
  // ------------------------------------------------------------------------------------------

  snapshot() {
    const info = this.renderer.info;
    const duck = this.duck;
    return {
      fps: Math.round(1000 / Math.max(this.frameMs, 0.001)),
      frameMs: Math.round(this.frameMs * 10) / 10,
      quality: this.quality.level,
      pixelRatio: this.renderer.getPixelRatio(),
      render: {
        calls: info.render.calls,
        triangles: info.render.triangles,
        points: info.render.points,
        geometries: info.memory.geometries,
        textures: info.memory.textures,
        programs: info.programs?.length ?? 0,
      },
      duck: {
        x: Math.round(duck.position.x * 100) / 100,
        y: Math.round(duck.position.y * 100) / 100,
        z: Math.round(duck.position.z * 100) / 100,
        heading: Math.round(duck.heading * 100) / 100,
        speed: Math.round(duck.speed * 100) / 100,
        state: duck.state,
        dabbling: duck.dabbling,
        depthHere: Math.round(duck.depthHere * 100) / 100,
        billOpen: Math.round(this.animator.billOpen * 100) / 100,
      },
      camera: {
        x: Math.round(this.follow.camera.position.x * 100) / 100,
        y: Math.round(this.follow.camera.position.y * 100) / 100,
        z: Math.round(this.follow.camera.position.z * 100) / 100,
        under: this.follow.under,
        submersion: Math.round(this.follow.submersion * 100) / 100,
      },
      world: {
        area: this.area,
        colliders: this.colliders.count,
        fish: this.fish.count,
        nearestFish: Math.round(this.fish.nearest(duck.position) * 100) / 100,
        dragonflies: this.dragonflies.count,
        dragonfliesPerched: this.dragonflies.perchedCount,
        bubbles: this.bubbles.aliveCount,
        droplets: this.droplets.aliveCount,
        waterDrops: this.wake.drops,
      },
      audio: { unlocked: this.audio.unlocked, muted: this.audio.muted, recorded: this.audio.recordedClips },
    };
  }

  /** Hooks used by the play-test scripts; harmless in normal play. */
  readonly debug = {
    setIntents: (intents: Partial<Intents> | null) => {
      this.intentOverride = intents;
    },
    teleport: (x: number, z: number, heading?: number) => this.duck.teleport(x, z, heading),
    look: (yaw: number, pitch: number, distance?: number) => {
      this.follow.yaw = yaw;
      this.follow.pitch = pitch;
      if (distance !== undefined) this.follow.distance = distance;
    },
    /**
     * Runs the game forward synchronously and draws the result. Lets a script
     * step the simulation deterministically (frame-by-frame capture, or a tab
     * that is not being painted) instead of waiting on requestAnimationFrame.
     */
    advance: (seconds: number, step = 1 / 60) => {
      const steps = Math.max(1, Math.round(seconds / step));
      for (let i = 0; i < steps; i++) this.update(step * this.timeScale);
      this.render();
      if (!this.firstFrameDone) {
        this.firstFrameDone = true;
        this.hud.ready();
      }
    },
    /** Stops or restarts the real-time loop (frame-by-frame capture drives the game itself). */
    setRunning: (running: boolean) => {
      if (running) this.start();
      else this.running = false;
    },
    setTimeScale: (scale: number) => {
      this.timeScale = clamp(scale, 0, 4);
    },
    /** Pins the camera to a fixed viewpoint (pass null to hand it back to the follow camera). */
    view: (position: [number, number, number] | null, target?: [number, number, number]) => {
      this.debugView = position
        ? { position: new THREE.Vector3(...position), target: new THREE.Vector3(...(target ?? [0, 0, 0])) }
        : null;
    },
    tuning: { duck: DUCK_TUNING, camera: CAMERA_TUNING, wake: WAKE_TUNING, water: WATER_TUNING },
  };
}
