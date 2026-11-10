import * as THREE from 'three';

interface Capsule {
  a: THREE.Vector3;
  b: THREE.Vector3;
  r: number;
}

const closest = new THREE.Vector3();
const delta = new THREE.Vector3();
const ab = new THREE.Vector3();
const probe = new THREE.Vector3();

/**
 * Solid obstacles as spheres and capsules. Deliberately much simpler than the
 * meshes they stand in for: rocks, the log, tree trunks, big roots.
 */
export class Colliders {
  private readonly capsules: Capsule[] = [];

  addSphere(x: number, y: number, z: number, r: number) {
    const p = new THREE.Vector3(x, y, z);
    this.capsules.push({ a: p, b: p.clone(), r });
  }

  addCapsule(a: THREE.Vector3, b: THREE.Vector3, r: number) {
    this.capsules.push({ a: a.clone(), b: b.clone(), r });
  }

  get count() {
    return this.capsules.length;
  }

  private static closestPoint(c: Capsule, p: THREE.Vector3, out: THREE.Vector3) {
    ab.subVectors(c.b, c.a);
    const len2 = ab.lengthSq();
    const t = len2 > 1e-8 ? THREE.MathUtils.clamp(delta.subVectors(p, c.a).dot(ab) / len2, 0, 1) : 0;
    return out.copy(c.a).addScaledVector(ab, t);
  }

  /**
   * Pushes `p` (a sphere of `radius`) out of every obstacle. With
   * `horizontalOnly` the correction slides along the water surface instead of
   * popping the swimmer up or down. Returns true if anything was touched.
   */
  resolve(p: THREE.Vector3, radius: number, horizontalOnly: boolean): boolean {
    let hit = false;
    for (const c of this.capsules) {
      Colliders.closestPoint(c, p, closest);
      delta.subVectors(p, closest);
      const reach = c.r + radius;
      const d2 = delta.lengthSq();
      if (d2 >= reach * reach) continue;
      hit = true;
      if (horizontalOnly) {
        const dy = delta.y;
        const need = Math.sqrt(Math.max(0, reach * reach - dy * dy));
        const h = Math.hypot(delta.x, delta.z);
        if (h < 1e-5) {
          p.x += need;
        } else {
          const push = (need - h) / h;
          p.x += delta.x * push;
          p.z += delta.z * push;
        }
      } else {
        const d = Math.sqrt(d2);
        if (d < 1e-5) {
          p.y += reach;
        } else {
          p.addScaledVector(delta, (reach - d) / d);
        }
      }
    }
    return hit;
  }

  /** True if a sphere of `radius` at `p` overlaps an obstacle. */
  overlaps(p: THREE.Vector3, radius: number): boolean {
    for (const c of this.capsules) {
      Colliders.closestPoint(c, p, closest);
      const reach = c.r + radius;
      if (closest.distanceToSquared(p) < reach * reach) return true;
    }
    return false;
  }

  /**
   * Walks from `from` toward `to` and returns how far (0..1) a sphere of
   * `radius` can travel before touching something. Used to keep the camera
   * out of rocks, trunks and the log.
   */
  clearFraction(from: THREE.Vector3, to: THREE.Vector3, radius: number, steps = 12): number {
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      probe.lerpVectors(from, to, t);
      if (this.overlaps(probe, radius)) return (i - 1) / steps;
    }
    return 1;
  }
}
