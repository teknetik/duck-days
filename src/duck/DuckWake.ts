import * as THREE from 'three';
import { clamp } from '../core/math';
import type { PondWater } from '../water/PondWater';
import type { DuckController, DuckEvent } from './DuckController';
import { DUCK_SCALE } from './DuckModel';

/** How the duck marks the water. Heights in metres; tune here, not in the shaders. */
export const WAKE_TUNING = {
  /** Displacement proxies dragged through the simulation: [offset along body, radius]. */
  proxies: [
    [0.15, 0.2],
    [-0.12, 0.17],
  ] as Array<[number, number]>,
  proxyScale: 0.1,
  idleInterval: 1.5,
  idleStrength: 0.0042,
  strokeStrength: 0.0045,
  diveDent: -0.055,
  surfaceBulge: 0.05,
};

interface TimedDrop {
  at: number;
  x: number;
  z: number;
  radius: number;
  strength: number;
}

/**
 * Turns the duck's motion into disturbances in the wave simulation:
 *  - two sphere proxies (breast and rump) pushed through upstream's
 *    sphere-displacement pass give the bow wave and the V of the wake;
 *  - timed drops add the idle ripple, each paddle stroke, the dent and
 *    rebound of a dive, and the widening rings of resurfacing.
 */
export class DuckWake {
  private readonly previous: THREE.Vector3[] = [];
  private readonly current = new THREE.Vector3();
  private readonly queue: TimedDrop[] = [];
  private clock = 0;
  private idleTimer = 0.6;
  private idleSign = 1;
  private primed = false;
  /** Drops injected since start, for diagnostics. */
  drops = 0;

  constructor(
    private readonly water: PondWater,
    private readonly duck: DuckController
  ) {
    for (let i = 0; i < WAKE_TUNING.proxies.length; i++) this.previous.push(new THREE.Vector3());
  }

  private drop(x: number, z: number, radius: number, strength: number, delay = 0) {
    this.queue.push({ at: this.clock + delay, x, z, radius, strength });
  }

  /** Small rings from elsewhere (bubbles popping, droplets landing). */
  ripple(x: number, z: number, radius: number, strength: number) {
    this.drop(x, z, radius, strength);
  }

  update(dt: number, events: readonly DuckEvent[]) {
    this.clock += dt;
    const duck = this.duck;
    const p = duck.position;
    const fx = Math.sin(duck.heading);
    const fz = Math.cos(duck.heading);

    // Moving proxies. The upstream shader already fades their effect once the
    // sphere is fully under, so a deep dive leaves the surface alone.
    WAKE_TUNING.proxies.forEach(([offset, radius], i) => {
      const o = offset * DUCK_SCALE;
      this.current.set(p.x + fx * o, p.y - 0.035, p.z + fz * o);
      const prev = this.previous[i];
      if (this.primed && p.y > -0.6) {
        const moved = prev.distanceToSquared(this.current);
        // Skip the pass when nothing moved, and never smear a teleport across the pond.
        if (moved > 1e-8 && moved < 0.25) {
          this.water.moveSphere(prev, this.current, radius * DUCK_SCALE, WAKE_TUNING.proxyScale);
        }
      }
      prev.copy(this.current);
    });
    this.primed = true;

    // Idle: a gentle ring every so often while the duck just sits and bobs.
    if (duck.state === 'surface' && duck.speed < 0.25) {
      this.idleTimer -= dt;
      if (this.idleTimer <= 0) {
        this.idleTimer = WAKE_TUNING.idleInterval * (0.8 + Math.random() * 0.5);
        this.idleSign = -this.idleSign;
        this.drop(p.x, p.z, 0.24, WAKE_TUNING.idleStrength * this.idleSign);
      }
    } else {
      this.idleTimer = Math.min(this.idleTimer, 0.5);
    }

    for (const e of events) {
      if (e.type === 'stroke' && duck.state !== 'under') {
        // Each webbed foot kicks a small pulse out behind and to its own side.
        const back = -0.2 * DUCK_SCALE;
        const sideways = 0.075 * DUCK_SCALE * e.side;
        this.drop(
          p.x + fx * back + fz * sideways,
          p.z + fz * back - fx * sideways,
          0.13,
          -WAKE_TUNING.strokeStrength * e.strength
        );
      } else if (e.type === 'dabble') {
        this.drop(p.x + fx * 0.15, p.z + fz * 0.15, 0.2, -0.012);
        this.drop(p.x + fx * 0.15, p.z + fz * 0.15, 0.16, 0.008, 0.16);
      } else if (e.type === 'dive') {
        // The body punches a hole, the hole rebounds as a crown, then rings spread.
        const x = p.x + fx * 0.1;
        const z = p.z + fz * 0.1;
        this.drop(x, z, 0.3, WAKE_TUNING.diveDent);
        this.drop(x, z, 0.2, -WAKE_TUNING.diveDent * 0.75, 0.13);
        this.drop(x, z, 0.36, WAKE_TUNING.diveDent * 0.3, 0.3);
      } else if (e.type === 'surface') {
        const k = clamp(0.7 + e.speed * 0.3, 0.7, 1.3);
        this.drop(p.x, p.z, 0.28, WAKE_TUNING.surfaceBulge * k);
        this.drop(p.x, p.z, 0.4, -WAKE_TUNING.surfaceBulge * 0.6 * k, 0.16);
        this.drop(p.x, p.z, 0.5, WAKE_TUNING.surfaceBulge * 0.35 * k, 0.36);
        this.drop(p.x, p.z, 0.55, -WAKE_TUNING.surfaceBulge * 0.15 * k, 0.6);
      }
    }

    // Release whatever is due. A hard cap keeps a burst of droplets from
    // turning into dozens of full-texture passes in one frame.
    let budget = 6;
    for (let i = 0; i < this.queue.length && budget > 0; ) {
      const d = this.queue[i];
      if (d.at <= this.clock) {
        this.water.addDrop(d.x, d.z, d.radius, d.strength);
        this.drops++;
        budget--;
        this.queue.splice(i, 1);
      } else {
        i++;
      }
    }
    if (this.queue.length > 40) this.queue.splice(0, this.queue.length - 40);
  }
}
