import { clamp, damp, lerp, smoothstep } from '../core/math';
import { DUCK_TUNING, type DuckController } from './DuckController';
import type { DuckRig } from './DuckModel';

export interface QuackWindow {
  start: number;
  duration: number;
}

/**
 * Procedural animation: reads the controller's state every frame and poses
 * the rig. Three blended poses (floating, tipped, tucked underwater) plus
 * layered details: bob, lean, paddling feet, tail wag, quack.
 */
export class DuckAnimator {
  private time = 0;
  private tip = 0;
  private under = 0;
  private pitch = 0;
  private roll = 0;
  private headYaw = 0;
  private quackClock = 0;
  private quackWindows: QuackWindow[] = [];
  private wagTimer = 3;
  private wag = 0;
  /** 0..1 how far the bill is open, exposed for diagnostics. */
  billOpen = 0;

  constructor(
    private readonly rig: DuckRig,
    private readonly duck: DuckController
  ) {}

  /** Opens the bill in time with the quack's syllables. */
  quack(windows: QuackWindow[]) {
    this.quackWindows = windows;
    this.quackClock = 0;
  }

  /** 0 = floating pose, 1 = fully tipped head-down. */
  get tipAmount() {
    return this.tip;
  }

  update(dt: number) {
    const { rig, duck } = this;
    this.time += dt;
    const t = this.time;
    const isUnder = duck.state === 'under';
    const isTipping = duck.state === 'tipping';

    // The tip leads the dive: it ramps over the anticipation window, holds while dabbling.
    const tipTarget = isTipping ? (duck.dabbling ? 1 : smoothstep(0, DUCK_TUNING.tipTime, duck.stateTime)) : 0;
    this.tip = damp(this.tip, tipTarget, isTipping ? 16 : 7, dt);
    this.under = damp(this.under, isUnder ? 1 : 0, isUnder ? 9 : 6, dt);
    const surfaced = Math.exp(-duck.sinceSurfaced * 2.6);

    rig.root.position.copy(duck.position);
    rig.root.rotation.y = duck.heading;

    // --- Whole-body attitude -------------------------------------------------------------
    const hSpeed = Math.hypot(duck.velocity.x, duck.velocity.z);
    const speedT = clamp(duck.speed / DUCK_TUNING.maxSpeed, 0, 1);
    const floatPitch = -0.05 * duck.effort + Math.sin(t * 1.7) * 0.012 + surfaced * -0.22;
    const tipPitch = duck.dabbling ? 1.28 : 0.92;
    const swimPitch = -Math.atan2(duck.verticalSpeed, Math.max(hSpeed, 1.15));
    let pitchTarget = lerp(floatPitch, tipPitch, this.tip);
    pitchTarget = lerp(pitchTarget, swimPitch, this.under);
    this.pitch = damp(this.pitch, pitchTarget, 10, dt);
    // Lean into the turn, more the faster it is going.
    const rollTarget = -duck.turnVelocity * (0.03 + 0.07 * speedT) * (1 + this.under * 0.8) + Math.sin(t * 1.3) * 0.012 * (1 - speedT);
    this.roll = damp(this.roll, rollTarget, 8, dt);
    rig.tilt.rotation.set(this.pitch, 0, this.roll);

    // Relaxed bob at rest; a faint surge with each stroke when paddling.
    const idleBob = Math.sin(t * 1.7 + 0.6) * 0.006 * (1 - speedT * 0.6);
    const strokeBob = Math.sin(duck.strokePhase * 2) * 0.003 * duck.effort;
    // When dabbling the front half goes under: sink the body a touch.
    rig.body.position.y = (idleBob + strokeBob) * (1 - this.under) - this.tip * (duck.dabbling ? 0.03 : 0.012);

    // --- Neck and head --------------------------------------------------------------------
    const restNeck = 0.32 + 0.12 * speedT;
    const tipNeck = restNeck + 0.95;
    const tuckNeck = 1.34;
    let neckX = lerp(restNeck, tipNeck, this.tip);
    neckX = lerp(neckX, tuckNeck, this.under);
    const quackOpen = this.sampleQuack(dt);
    this.billOpen = quackOpen;
    neckX -= quackOpen * 0.12 + surfaced * 0.2;
    rig.neck.rotation.x = neckX;

    const nod = Math.sin(duck.strokePhase) * 0.035 * duck.effort * (1 - this.under);
    const headDown = this.tip * 0.45 - quackOpen * 0.16;
    // Counter-rotate so the bill stays level with the body whatever the neck does.
    rig.head.rotation.x = -neckX * lerp(0.94, 0.86, this.under) + nod + headDown;
    const lookTarget = clamp(duck.turnVelocity * 0.2, -0.55, 0.55) + Math.sin(t * 0.37) * 0.28 * (1 - speedT) * (1 - this.under);
    this.headYaw = damp(this.headYaw, lookTarget, 5, dt);
    // A quick shake as it comes up, shedding water.
    const shake = Math.sin(t * 34) * 0.3 * surfaced * smoothstep(0.05, 0.25, duck.sinceSurfaced);
    rig.head.rotation.y = this.headYaw + shake;
    rig.head.rotation.z = shake * 0.4;
    rig.jaw.rotation.x = quackOpen * 0.52;

    // --- Tail -------------------------------------------------------------------------------
    this.wagTimer -= dt;
    if (this.wagTimer <= 0) {
      this.wagTimer = 5 + Math.random() * 7;
      this.wag = 1;
    }
    this.wag = Math.max(0, this.wag - dt * 1.4);
    const wagAmount = Math.max(this.wag * (1 - speedT), surfaced * 1.2) * (1 - this.under);
    rig.tail.rotation.set(this.tip * 0.5 - this.under * 0.15, Math.sin(t * 16) * 0.3 * wagAmount, 0);

    // --- Wings: tight to the body, with a little flick when surfacing ------------------------
    const flick = surfaced * Math.abs(Math.sin(t * 19)) * 0.2 * smoothstep(0.08, 0.2, duck.sinceSurfaced);
    rig.wings[0].rotation.z = flick;
    rig.wings[1].rotation.z = -flick;

    // --- Legs: alternating webbed feet ---------------------------------------------------------
    const rising = isUnder && duck.verticalSpeed > 0.3;
    const amp = lerp(lerp(0.22, 0.75, duck.effort), rising ? 0.85 : 0.55, this.under);
    const base = lerp(lerp(0.2, 0.55, this.tip), 1.22, this.under);
    for (let i = 0; i < 2; i++) {
      const phase = duck.strokePhase + (i === 0 ? 0 : Math.PI);
      const swing = Math.sin(phase);
      // Power stroke while the leg sweeps back: toes spread, blade square to the water.
      const spread = smoothstep(-0.25, 0.5, Math.cos(phase));
      rig.hips[i].rotation.x = base + swing * amp;
      rig.ankles[i].rotation.x = lerp(1.1, 0.0, spread) - swing * amp * 0.25;
      rig.feet[i].scale.x = lerp(0.45, 1, spread);
      rig.hips[i].rotation.z = (i === 0 ? 1 : -1) * (0.08 + 0.1 * this.under);
    }
  }

  private sampleQuack(dt: number): number {
    if (this.quackWindows.length === 0) return 0;
    this.quackClock += dt;
    let open = 0;
    let finished = true;
    for (const w of this.quackWindows) {
      const local = (this.quackClock - w.start) / w.duration;
      if (local < 1.2) finished = false;
      if (local < 0 || local > 1.2) continue;
      // Snap open, close through the syllable.
      const env = local < 0.15 ? local / 0.15 : Math.max(0, 1 - (local - 0.15) / 1.05);
      open = Math.max(open, env);
    }
    if (finished) this.quackWindows = [];
    return open;
  }
}
