import * as THREE from 'three';
import { angleDelta, approach, clamp, damp, lerp, wrapAngle } from '../core/math';
import type { Intents } from '../core/Input';
import type { Colliders } from '../world/Colliders';
import { POND_HALF, SPAWN, WATER_LEVEL } from '../world/PondLayout';
import type { Heightfield } from '../world/Terrain';

/** Movement feel. All speeds in m/s, rates in rad/s. */
export const DUCK_TUNING = {
  maxSpeed: 1.9,
  /** Speeding up is gentle; coasting down is gentler still, so the duck glides. */
  accel: 2.2,
  coast: 0.95,
  brake: 2.6,
  turnRate: 3.1,
  turnResponse: 9,
  underSpeed: 1.5,
  diveSpeed: 1.15,
  riseSpeed: 1.45,
  verticalAccel: 4.5,
  /** Shallowest water the duck will float in. */
  minFloatDepth: 0.11,
  /** Shallowest water it can dive in; anything less and it dabbles instead. */
  minDiveDepth: 0.62,
  /** While submerged it stays out of water shallower than this. */
  minUnderDepth: 0.46,
  bodyRadius: 0.15,
  bedClearance: 0.17,
  /** Head-down, tail-up anticipation before slipping under. */
  tipTime: 0.34,
  bobStiffness: 70,
  bobDamping: 7.5,
};

export type DuckState = 'surface' | 'tipping' | 'under';

export type DuckEvent =
  | { type: 'dive' }
  | { type: 'surface'; speed: number }
  | { type: 'dabble' }
  | { type: 'stroke'; side: 1 | -1; strength: number };

const grad = new THREE.Vector2();
const step = new THREE.Vector2();

/**
 * Owns where the duck is and how it moves. No rendering, no water, no audio:
 * it reports what happened each frame through `events` and other systems react.
 */
export class DuckController {
  readonly position = new THREE.Vector3(SPAWN.x, WATER_LEVEL, SPAWN.z);
  readonly velocity = new THREE.Vector3();
  heading: number = SPAWN.heading;
  /** Forward speed along `heading`. */
  speed = 0;
  /** Smoothed yaw rate, used for leaning into turns. */
  turnVelocity = 0;
  verticalSpeed = 0;
  state: DuckState = 'surface';
  /** Seconds in the current state. */
  stateTime = 0;
  /** Up-ending in water too shallow to dive in. */
  dabbling = false;
  /** 0..1 how hard the duck is paddling. */
  effort = 0;
  /** Leg cycle; each PI is one foot stroke. */
  strokePhase = 0;
  /** Seconds since the duck last broke the surface (large if never). */
  sinceSurfaced = 99;
  /** True once the player has actually swum somewhere. */
  hasMoved = false;
  readonly events: DuckEvent[] = [];

  private strokeCount = 0;
  private needRelease = false;

  constructor(
    private readonly field: Heightfield,
    private readonly colliders: Colliders
  ) {}

  get submerged(): boolean {
    return this.state === 'under';
  }

  /** Water depth under the duck. */
  get depthHere(): number {
    return -this.field.height(this.position.x, this.position.z);
  }

  update(dt: number, intents: Intents, cameraYaw: number) {
    this.events.length = 0;
    this.stateTime += dt;
    this.sinceSurfaced += dt;
    const T = DUCK_TUNING;

    // --- Steering: input is relative to where the camera looks -------------------------
    const inputLen = Math.hypot(intents.moveX, intents.moveZ);
    const under = this.state === 'under';
    let wantSpeed = 0;
    if (inputLen > 0.05) {
      const fx = -Math.sin(cameraYaw);
      const fz = -Math.cos(cameraYaw);
      const rx = Math.cos(cameraYaw);
      const rz = -Math.sin(cameraYaw);
      const dx = fx * intents.moveZ + rx * intents.moveX;
      const dz = fz * intents.moveZ + rz * intents.moveX;
      const target = Math.atan2(dx, dz);
      const delta = angleDelta(this.heading, target);
      const wantTurn = clamp(delta * 5.5, -T.turnRate, T.turnRate);
      this.turnVelocity = damp(this.turnVelocity, wantTurn, T.turnResponse, dt);
      // Ease off while swinging round, so the duck turns on the spot rather than skating wide.
      const align = Math.max(0.2, Math.cos(clamp(delta, -Math.PI / 2, Math.PI / 2)));
      wantSpeed = (under ? T.underSpeed : T.maxSpeed) * Math.min(1, inputLen) * align;
      if (inputLen > 0.3) this.hasMoved = true;
    } else {
      this.turnVelocity = damp(this.turnVelocity, 0, T.turnResponse, dt);
    }
    if (this.state === 'tipping') wantSpeed *= this.dabbling ? 0.15 : 0.7;
    this.heading = wrapAngle(this.heading + this.turnVelocity * dt);

    const rate = wantSpeed > this.speed ? T.accel : inputLen > 0.05 ? T.brake : T.coast;
    this.speed = approach(this.speed, wantSpeed, rate * dt);
    this.effort = damp(this.effort, clamp(wantSpeed / T.maxSpeed, 0, 1), 6, dt);

    // --- Horizontal move with shoreline and obstacle constraints -----------------------
    const prevX = this.position.x;
    const prevZ = this.position.z;
    const sin = Math.sin(this.heading);
    const cos = Math.cos(this.heading);
    this.position.x += sin * this.speed * dt;
    this.position.z += cos * this.speed * dt;
    const blocked = this.keepInWater(prevX, prevZ, under ? T.minUnderDepth : T.minFloatDepth);
    const y = this.position.y;
    if (under) {
      if (this.colliders.resolve(this.position, T.bodyRadius, false)) {
        // Obstacles may nudge the duck vertically; never above the surface.
        this.position.y = Math.min(this.position.y, WATER_LEVEL - 0.12);
      }
    } else {
      this.position.y = WATER_LEVEL - 0.03;
      this.colliders.resolve(this.position, T.bodyRadius, true);
      this.position.y = y;
    }
    // An obstacle may have pushed the duck toward the bank; make sure it still floats.
    this.keepInWater(prevX, prevZ, under ? T.minUnderDepth : T.minFloatDepth);
    if (blocked) this.speed = Math.min(this.speed, T.maxSpeed * 0.45);
    const limit = POND_HALF - 0.6;
    this.position.x = clamp(this.position.x, -limit, limit);
    this.position.z = clamp(this.position.z, -limit, limit);

    // --- Vertical: float, tip, dive, rise ------------------------------------------------
    const depth = this.depthHere;
    if (this.state === 'surface') {
      // A damped spring holds the duck at the waterline, so it bobs when it pops up.
      const a = -T.bobStiffness * (this.position.y - WATER_LEVEL) - T.bobDamping * this.verticalSpeed;
      this.verticalSpeed += a * dt;
      this.position.y += this.verticalSpeed * dt;
      if (!intents.dive) this.needRelease = false;
      if (intents.dive && !this.needRelease && this.sinceSurfaced > 0.3) {
        this.state = 'tipping';
        this.stateTime = 0;
        this.dabbling = depth < T.minDiveDepth;
        if (this.dabbling) this.events.push({ type: 'dabble' });
      }
    } else if (this.state === 'tipping') {
      const a = -T.bobStiffness * (this.position.y - WATER_LEVEL) - T.bobDamping * this.verticalSpeed;
      this.verticalSpeed += a * dt;
      this.position.y += this.verticalSpeed * dt;
      if (this.dabbling) {
        if (!intents.dive || this.stateTime > 2.6) {
          // After a long dabble the duck comes up for air until Space is released.
          this.needRelease = intents.dive;
          this.state = 'surface';
          this.stateTime = 0;
          this.dabbling = false;
        }
      } else if (this.stateTime >= T.tipTime) {
        this.state = 'under';
        this.stateTime = 0;
        this.verticalSpeed = -0.8;
        this.position.y = Math.min(this.position.y, WATER_LEVEL - 0.04);
        this.events.push({ type: 'dive' });
      }
    } else {
      const floor = -depth + T.bedClearance;
      const want = intents.dive ? -T.diveSpeed : T.riseSpeed;
      this.verticalSpeed = approach(this.verticalSpeed, want, T.verticalAccel * dt);
      this.position.y += this.verticalSpeed * dt;
      if (this.position.y < floor) {
        this.position.y = floor;
        this.verticalSpeed = Math.max(this.verticalSpeed, 0);
      }
      if (this.position.y >= WATER_LEVEL - 0.1 && this.verticalSpeed >= 0) {
        // Break the surface with whatever upward speed is left: the bob spring does the rest.
        this.state = 'surface';
        this.stateTime = 0;
        this.sinceSurfaced = 0;
        this.events.push({ type: 'surface', speed: this.verticalSpeed });
        this.verticalSpeed = Math.max(this.verticalSpeed, 0.85);
      }
    }

    // --- Legs -----------------------------------------------------------------------------
    const rising = under && this.verticalSpeed > 0.3;
    const strokeRate = under ? (rising ? 15 : 9.5) : lerp(2.6, 11.5, this.effort);
    this.strokePhase += strokeRate * dt;
    const count = Math.floor(this.strokePhase / Math.PI);
    if (count !== this.strokeCount) {
      this.strokeCount = count;
      const strength = under ? (rising ? 1 : 0.7) : this.effort;
      if (strength > 0.12) {
        this.events.push({ type: 'stroke', side: count % 2 === 0 ? 1 : -1, strength });
      }
    }

    this.velocity.set(
      (this.position.x - prevX) / Math.max(dt, 1e-4),
      this.verticalSpeed,
      (this.position.z - prevZ) / Math.max(dt, 1e-4)
    );
  }

  /**
   * Stops the duck beaching itself. Slides the attempted move along the bank
   * when it can, otherwise backs off downhill. Returns true if it had to act.
   */
  private keepInWater(prevX: number, prevZ: number, minDepth: number): boolean {
    const field = this.field;
    const p = this.position;
    if (-field.height(p.x, p.z) >= minDepth) return false;
    field.gradient(prevX, prevZ, grad);
    if (grad.lengthSq() > 1e-6) {
      grad.normalize();
      step.set(p.x - prevX, p.z - prevZ);
      const uphill = step.dot(grad);
      if (uphill > 0) {
        p.x = prevX + step.x - grad.x * uphill;
        p.z = prevZ + step.y - grad.y * uphill;
      }
    }
    for (let i = 0; i < 8 && -field.height(p.x, p.z) < minDepth; i++) {
      field.gradient(p.x, p.z, grad);
      if (grad.lengthSq() < 1e-8) break;
      grad.normalize();
      p.x -= grad.x * 0.03;
      p.z -= grad.y * 0.03;
    }
    if (-field.height(p.x, p.z) < minDepth) {
      p.x = prevX;
      p.z = prevZ;
    }
    return true;
  }

  /** Puts the duck back at the start (used by the debug hook and tests). */
  teleport(x: number, z: number, heading?: number) {
    this.position.set(x, WATER_LEVEL, z);
    if (heading !== undefined) this.heading = heading;
    this.speed = 0;
    this.verticalSpeed = 0;
    this.state = 'surface';
    this.stateTime = 0;
    this.dabbling = false;
  }
}
