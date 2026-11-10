import * as THREE from 'three';
import { clamp, damp, dampAngle, smoothstep, wrapAngle } from '../core/math';
import type { Intents } from '../core/Input';
import type { DuckController } from '../duck/DuckController';
import { DUCK_SCALE } from '../duck/DuckModel';
import type { Colliders } from '../world/Colliders';
import { SPAWN, WATER_LEVEL } from '../world/PondLayout';
import type { Heightfield } from '../world/Terrain';

export const CAMERA_TUNING = {
  fov: 52,
  distance: 2.15,
  minDistance: 1.1,
  maxDistance: 5.5,
  /** Default elevation: the lens sits just above the waterline. */
  pitch: 0.085,
  /** Closest the lens may come to the surface from either side. */
  airClearance: 0.11,
  waterClearance: 0.15,
  /** Half-height of the band over which colour and sound cross-fade. */
  transitionBand: 0.07,
  groundClearance: 0.2,
  bedClearance: 0.14,
  lensRadius: 0.13,
  dragSensitivity: 0.0052,
  followRate: 1.25,
};

const SAMPLES = 10;

/**
 * Third-person orbit camera. Drag to look; left alone, it settles in behind
 * the duck. It lives on one side of the water surface at a time and crosses
 * quickly, so waves never slice the view while it hovers at the waterline.
 */
export class FollowCamera {
  readonly camera: THREE.PerspectiveCamera;
  yaw: number;
  pitch = CAMERA_TUNING.pitch;
  distance = CAMERA_TUNING.distance;
  /** 0 = lens in air, 1 = lens under water; smooth across the transition band. */
  submersion = 0;
  /** Which side of the surface this frame's reflection / refraction passes should assume. */
  under = false;

  private readonly target = new THREE.Vector3();
  private readonly desired = new THREE.Vector3();
  private readonly probe = new THREE.Vector3();
  private readonly lookAt = new THREE.Vector3();
  private currentDistance = CAMERA_TUNING.distance;
  private sinceDrag = 10;
  private initialised = false;

  constructor(
    private readonly duck: DuckController,
    private readonly field: Heightfield,
    private readonly colliders: Colliders
  ) {
    this.camera = new THREE.PerspectiveCamera(CAMERA_TUNING.fov, 1, 0.035, 420);
    this.yaw = wrapAngle(SPAWN.heading + Math.PI);
  }

  setAspect(aspect: number) {
    this.camera.aspect = aspect;
    // Hold the horizontal field of view on tall, narrow screens.
    const base = CAMERA_TUNING.fov;
    this.camera.fov = aspect < 1 ? clamp(base / Math.pow(aspect, 0.55), base, 78) : base;
    this.camera.updateProjectionMatrix();
  }

  update(dt: number, intents: Intents) {
    const T = CAMERA_TUNING;
    const duck = this.duck;

    // --- Look input ---------------------------------------------------------------------
    if (intents.dragging || intents.lookX !== 0 || intents.lookY !== 0) this.sinceDrag = 0;
    else this.sinceDrag += dt;
    this.yaw = wrapAngle(this.yaw - intents.lookX * T.dragSensitivity);
    this.pitch += intents.lookY * T.dragSensitivity * 0.8;
    this.distance = clamp(this.distance * (1 + intents.zoom * 0.12), T.minDistance, T.maxDistance);

    const duckUnder = duck.state === 'under';
    this.pitch = duckUnder ? clamp(this.pitch, -0.95, 1.05) : clamp(this.pitch, -0.02, 1.15);

    // --- Settle behind the duck when the player is not steering the view ------------------
    if (this.sinceDrag > 1.4 && duck.speed > 0.2) {
      const behind = wrapAngle(duck.heading + Math.PI);
      // Only chase the heading while the duck swims away from the lens. Swimming
      // toward the camera must not spin it, or "back" would never mean back.
      const away = Math.cos(wrapAngle(behind - this.yaw));
      const rate = T.followRate * Math.max(0, away) * smoothstep(0.2, 1.2, duck.speed);
      this.yaw = dampAngle(this.yaw, behind, rate, dt);
    }
    // Ease the elevation back to the waterline view after a dive or a look-around.
    if (this.sinceDrag > 3 && !duckUnder) this.pitch = damp(this.pitch, T.pitch, 0.6, dt);
    if (this.sinceDrag > 3 && duckUnder) this.pitch = damp(this.pitch, 0.16, 0.6, dt);

    // --- Target: a point just above the duck's back, led slightly by its motion -------------
    const lead = 0.16;
    this.probe.set(
      duck.position.x + duck.velocity.x * lead,
      duck.position.y + 0.15 * DUCK_SCALE,
      duck.position.z + duck.velocity.z * lead
    );
    if (!this.initialised) this.target.copy(this.probe);
    this.target.x = damp(this.target.x, this.probe.x, 9, dt);
    this.target.z = damp(this.target.z, this.probe.z, 9, dt);
    this.target.y = damp(this.target.y, this.probe.y, 7, dt);

    // --- Where the lens wants to be -----------------------------------------------------------
    const cp = Math.cos(this.pitch);
    const dirX = Math.sin(this.yaw) * cp;
    const dirY = Math.sin(this.pitch);
    const dirZ = Math.cos(this.yaw) * cp;

    // March outward from the duck and stop before the first thing in the way:
    // a bank, the pond bed, a rock, the log, a trunk.
    let reach = this.distance;
    const ceiling = WATER_LEVEL - T.waterClearance;
    for (let i = 1; i <= SAMPLES; i++) {
      const d = (this.distance * i) / SAMPLES;
      const x = this.target.x + dirX * d;
      const z = this.target.z + dirZ * d;
      let y = this.target.y + dirY * d;
      const ground = this.field.height(x, z);
      if (duckUnder) {
        // Underwater the lens has to fit between the bed and the surface.
        const floor = ground + T.bedClearance;
        if (floor > ceiling) {
          reach = Math.min(reach, (this.distance * (i - 1)) / SAMPLES);
          break;
        }
        y = clamp(y, floor, ceiling);
      } else if (y < ground + T.groundClearance * 0.5) {
        // Above water the ray may graze a bank; the lift below handles gentle
        // slopes, this handles running into a steep one.
        if (ground - y > 0.55) {
          reach = Math.min(reach, (this.distance * (i - 1)) / SAMPLES);
          break;
        }
      }
      this.probe.set(x, y, z);
      if (this.colliders.overlaps(this.probe, T.lensRadius)) {
        reach = Math.min(reach, (this.distance * (i - 1)) / SAMPLES);
        break;
      }
    }
    reach = Math.max(reach, 0.45);
    // Pull in at once when blocked, drift back out slowly when clear.
    this.currentDistance = damp(this.currentDistance, reach, reach < this.currentDistance ? 22 : 2.8, dt);
    const dist = Math.min(this.currentDistance, reach + 0.25);

    this.desired.set(this.target.x + dirX * dist, this.target.y + dirY * dist, this.target.z + dirZ * dist);
    const ground = this.field.height(this.desired.x, this.desired.z);
    if (duckUnder) {
      const floor = Math.min(ground + T.bedClearance, ceiling);
      this.desired.y = clamp(this.desired.y, floor, ceiling);
    } else {
      this.desired.y = Math.max(this.desired.y, WATER_LEVEL + T.airClearance, ground + T.groundClearance);
    }

    const cam = this.camera.position;
    if (!this.initialised) {
      cam.copy(this.desired);
      this.initialised = true;
    } else {
      cam.x = damp(cam.x, this.desired.x, 14, dt);
      cam.z = damp(cam.z, this.desired.z, 14, dt);
      // Cross the waterline briskly so the lens is only in the band for a few frames.
      const crossing = (cam.y - WATER_LEVEL) * (this.desired.y - WATER_LEVEL) < 0;
      cam.y = damp(cam.y, this.desired.y, crossing ? 16 : 11, dt);
      // The eased position can cut a corner through the log or a rock while
      // the lens swings round to the duck's side; slide it back out. Under
      // water the push is sideways only, so it never pops the lens through
      // the surface.
      if (this.colliders.resolve(cam, T.lensRadius, duckUnder)) {
        const groundHere = this.field.height(cam.x, cam.z);
        if (duckUnder) cam.y = clamp(cam.y, Math.min(groundHere + T.bedClearance, ceiling), ceiling);
        else cam.y = Math.max(cam.y, WATER_LEVEL + T.airClearance, groundHere + T.groundClearance);
      }
    }

    this.lookAt.copy(this.target);
    this.lookAt.y += duckUnder ? 0.0 : 0.04;
    this.camera.lookAt(this.lookAt);
    this.camera.updateMatrixWorld();
    this.classifyMedium();
  }

  /** Debug / photo mode: place the lens somewhere fixed for this frame. */
  override(position: THREE.Vector3, target: THREE.Vector3) {
    this.camera.position.copy(position);
    this.camera.lookAt(target);
    this.camera.updateMatrixWorld();
    this.classifyMedium();
  }

  private classifyMedium() {
    const T = CAMERA_TUNING;
    const cam = this.camera.position;
    // --- Which medium is the lens in? -----------------------------------------------------------
    const h = cam.y - WATER_LEVEL;
    this.submersion = 1 - smoothstep(-T.transitionBand, T.transitionBand, h);
    // Hysteresis: the reflection / refraction passes only swap sides once the
    // lens is clearly through, never on a ripple.
    if (this.under && h > 0.02) this.under = false;
    else if (!this.under && h < -0.02) this.under = true;
  }
}
