import * as THREE from 'three';
import { Rng, TAU, clamp, damp, dampAngle, lerp, smoothstep } from '../core/math';
import { applyPondShading } from '../water/pondShading';
import { merge, paint, place } from './instancing';
import { LANDMARKS } from './PondLayout';
import { makeWingTexture } from './textures';
import type { WorldContext } from './WorldContext';

const tmp = new THREE.Color();
const v1 = new THREE.Vector3();
const v2 = new THREE.Vector3();
const m4 = new THREE.Matrix4();
const quat = new THREE.Quaternion();
const euler = new THREE.Euler();
const scl = new THREE.Vector3();

// --------------------------------------------------------------------------------------
// Fish
// --------------------------------------------------------------------------------------

/** A small roach-like fish, 1 unit long, nose toward +z. */
function fishGeometry(): THREE.BufferGeometry {
  const body = new THREE.SphereGeometry(0.5, 12, 8);
  const pos = body.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const z = pos.getZ(i);
    // Fuller toward the head, pinched into the tail wrist.
    const girth = z > 0 ? 1 - 0.35 * z * z * 4 * 0.25 : Math.max(0.16, 1 - Math.pow(-z * 2, 1.6) * 0.84);
    pos.setXYZ(i, pos.getX(i) * 0.26 * girth, pos.getY(i) * 0.4 * girth, z * 0.86 + 0.05);
  }
  body.computeVertexNormals();
  paint(body, (_x, y) => {
    const t = clamp(y / 0.2 * 0.5 + 0.5, 0, 1);
    return tmp.setRGB(0.86, 0.88, 0.8).lerp(new THREE.Color(0.24, 0.3, 0.14), smoothstep(0.5, 0.92, t));
  });
  const fin = (points: number[], color: THREE.Color) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
    const count = points.length / 3;
    g.setAttribute('uv', new THREE.Float32BufferAttribute(new Array(count * 2).fill(0), 2));
    g.setIndex(Array.from({ length: count }, (_, i) => i));
    g.computeVertexNormals();
    return paint(g, color);
  };
  const red = new THREE.Color(0.62, 0.26, 0.12);
  const tail = fin(
    [0, 0, -0.38, 0, 0.2, -0.64, 0, 0.0, -0.54, 0, 0, -0.38, 0, 0.0, -0.54, 0, -0.2, -0.64],
    red
  );
  const dorsal = fin([0, 0.17, 0.1, 0, 0.3, -0.06, 0, 0.14, -0.16], new THREE.Color(0.24, 0.26, 0.14));
  const pelvic = fin([0, -0.15, 0.08, 0, -0.27, -0.04, 0, -0.13, -0.1], red);
  return merge([body, tail, dorsal, pelvic]);
}

interface Fish {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  target: THREE.Vector3;
  retarget: number;
  home: THREE.Vector3;
  homeRadius: number;
  size: number;
  cruise: number;
  panic: number;
  phase: number;
  yaw: number;
  pitch: number;
}

/**
 * Small fish that loaf around three home ranges and scatter when the duck
 * gets close. Cheap boids: wander, loose cohesion, separation, flee.
 */
export class FishSchools {
  readonly mesh: THREE.InstancedMesh;
  private readonly fish: Fish[] = [];
  private readonly swim: THREE.InstancedBufferAttribute;
  private readonly rng = new Rng(31337);
  /** Set to the number of fish that bolted this frame (for audio / bubbles). */
  startled = 0;

  constructor(private readonly ctx: WorldContext) {
    const field = ctx.field;
    const deep = LANDMARKS.deepCentre;
    const log = LANDMARKS.log;
    const lily = LANDMARKS.lilyField;
    const homes: Array<{ c: THREE.Vector3; r: number; n: number }> = [
      { c: new THREE.Vector3(deep.x, -1.5, deep.z), r: 2.3, n: 20 },
      { c: new THREE.Vector3(deep.x - 2.6, -0.8, deep.z - 3.4), r: 1.9, n: 9 },
      { c: new THREE.Vector3(log.x + 0.5, -0.3, log.z + 1.0), r: 1.0, n: 5 },
      { c: new THREE.Vector3(lily.x - 1.2, -0.42, lily.z + 0.8), r: 1.5, n: 7 },
    ];
    for (const h of homes) {
      for (let i = 0; i < h.n; i++) {
        const p = new THREE.Vector3(
          h.c.x + this.rng.range(-1, 1) * h.r * 0.6,
          h.c.y + this.rng.range(-0.3, 0.3),
          h.c.z + this.rng.range(-1, 1) * h.r * 0.6
        );
        p.y = clamp(p.y, field.height(p.x, p.z) + 0.15, -0.16);
        this.fish.push({
          pos: p,
          vel: new THREE.Vector3(this.rng.range(-0.1, 0.1), 0, this.rng.range(-0.1, 0.1)),
          target: p.clone(),
          retarget: this.rng.range(0, 3),
          home: h.c,
          homeRadius: h.r,
          size: this.rng.range(0.11, 0.19),
          cruise: this.rng.range(0.16, 0.3),
          panic: 0,
          phase: this.rng.range(0, TAU),
          yaw: this.rng.range(0, TAU),
          pitch: 0,
        });
      }
    }

    const geo = fishGeometry();
    this.swim = new THREE.InstancedBufferAttribute(new Float32Array(this.fish.length * 2), 2);
    this.swim.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aSwim', this.swim);
    const mat = applyPondShading(
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.38, metalness: 0.25, side: THREE.DoubleSide }),
      ctx.pond,
      { key: 'fish' }
    );
    const pondPatch = mat.onBeforeCompile;
    mat.onBeforeCompile = (shader, renderer) => {
      pondPatch.call(mat, shader, renderer);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec2 aSwim;')
        .replace(
          '#include <begin_vertex>',
          /* glsl */ `#include <begin_vertex>
        {
          // Body wave travelling tail-ward; the head barely moves.
          float w = smoothstep(0.35, -0.6, transformed.z);
          transformed.x += sin(aSwim.x + transformed.z * 7.0) * aSwim.y * w;
        }`
        );
    };
    this.mesh = new THREE.InstancedMesh(geo, mat, this.fish.length);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    this.mesh.name = 'fish';
    this.update(0, new THREE.Vector3(0, 10, 0), false);
  }

  get count() {
    return this.fish.length;
  }

  /** Distance from `p` to the nearest fish, for tests and diagnostics. */
  nearest(p: THREE.Vector3): number {
    let best = Infinity;
    for (const f of this.fish) best = Math.min(best, f.pos.distanceTo(p));
    return best;
  }

  update(dt: number, duck: THREE.Vector3, duckUnder: boolean) {
    const field = this.ctx.field;
    const fleeRadius = duckUnder ? 1.7 : 1.25;
    this.startled = 0;
    for (let i = 0; i < this.fish.length; i++) {
      const f = this.fish[i];

      f.retarget -= dt;
      if (f.retarget <= 0) {
        f.retarget = this.rng.range(1.8, 5);
        const a = this.rng.range(0, TAU);
        const d = Math.sqrt(this.rng.f()) * f.homeRadius;
        f.target.set(f.home.x + Math.cos(a) * d, f.home.y + this.rng.range(-0.35, 0.35), f.home.z + Math.sin(a) * d);
      }

      // Steering: wander target, plus a nudge away from the nearest neighbour.
      v1.subVectors(f.target, f.pos);
      const dist = v1.length();
      const calm = f.panic <= 0;
      const speed = calm ? f.cruise * smoothstep(0.05, 0.6, dist) : 1.5 + f.panic * 0.9;
      if (calm && dist > 1e-3) {
        v1.multiplyScalar(speed / dist);
      } else if (!calm) {
        v1.copy(f.vel).setLength(speed);
      }
      for (let j = 0; j < this.fish.length; j++) {
        if (j === i) continue;
        const o = this.fish[j];
        const dx = f.pos.x - o.pos.x;
        const dy = f.pos.y - o.pos.y;
        const dz = f.pos.z - o.pos.z;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < 0.05 && d2 > 1e-6) {
          const k = (0.05 - d2) * 6;
          v1.x += dx * k;
          v1.y += dy * k;
          v1.z += dz * k;
        }
      }

      // The duck: bolt directly away, each fish with its own sideways kick.
      v2.subVectors(f.pos, duck);
      const dd = v2.length();
      if (dd < fleeRadius) {
        if (f.panic <= 0.2) {
          this.startled++;
          const kick = this.rng.range(-1.3, 1.3);
          v2.set(v2.x + -v2.z * kick, v2.y * 0.4 - 0.25, v2.z + v2.x * kick);
          f.vel.copy(v2).setLength(2.4 + this.rng.range(0, 1.2));
          f.retarget = 0.9 + this.rng.range(0, 0.8);
          // Regroup somewhere on the far side of home from the duck.
          f.target.copy(f.home).addScaledVector(v1.subVectors(f.home, duck).setY(0).normalize(), f.homeRadius * 0.8);
        }
        f.panic = 1;
        v1.copy(f.vel);
      }
      f.panic = Math.max(0, f.panic - dt * 0.85);

      const turn = calm ? 2.2 : 7;
      f.vel.x = damp(f.vel.x, v1.x, turn, dt);
      f.vel.y = damp(f.vel.y, v1.y, turn, dt);
      f.vel.z = damp(f.vel.z, v1.z, turn, dt);

      f.pos.addScaledVector(f.vel, dt);

      // Stay in water deep enough to swim, between the bed and the surface.
      const bed = field.height(f.pos.x, f.pos.z);
      if (bed > -0.4) {
        v2.subVectors(f.home, f.pos).setY(0).setLength(0.9);
        f.vel.x = damp(f.vel.x, v2.x, 8, dt);
        f.vel.z = damp(f.vel.z, v2.z, 8, dt);
      }
      const lo = bed + 0.12;
      const hi = -0.14;
      if (f.pos.y < lo) {
        f.pos.y = Math.min(lo, hi);
        f.vel.y = Math.max(f.vel.y, 0);
      } else if (f.pos.y > hi) {
        f.pos.y = hi;
        f.vel.y = Math.min(f.vel.y, 0);
      }
      this.ctx.colliders.resolve(f.pos, 0.07, false);

      const hSpeed = Math.hypot(f.vel.x, f.vel.z);
      const total = f.vel.length();
      if (hSpeed > 0.02) f.yaw = dampAngle(f.yaw, Math.atan2(f.vel.x, f.vel.z), 10, dt);
      f.pitch = damp(f.pitch, total > 0.03 ? -Math.asin(clamp(f.vel.y / total, -0.8, 0.8)) : 0, 6, dt);
      f.phase += dt * (5 + total * 22);

      euler.set(f.pitch, f.yaw, 0, 'YXZ');
      quat.setFromEuler(euler);
      scl.setScalar(f.size);
      this.mesh.setMatrixAt(i, m4.compose(f.pos, quat, scl));
      this.swim.setXY(i, f.phase, lerp(0.05, 0.13, clamp(total / 1.5, 0, 1)));
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.swim.needsUpdate = true;
  }
}

// --------------------------------------------------------------------------------------
// Dragonflies
// --------------------------------------------------------------------------------------

type FlyState = 'hover' | 'dart' | 'approach' | 'perched';

interface Dragonfly {
  root: THREE.Group;
  wings: THREE.Object3D[];
  state: FlyState;
  timer: number;
  from: THREE.Vector3;
  to: THREE.Vector3;
  duration: number;
  yaw: number;
  home: THREE.Vector3;
  range: THREE.Vector3;
  seed: number;
  perch: THREE.Vector3 | null;
}

function dragonflyBody(color: THREE.Color): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const dark = color.clone().multiplyScalar(0.25);
  parts.push(place(paint(new THREE.SphereGeometry(1, 8, 6), color), [0, 0, 0.004], [0, 0, 0], [0.0052, 0.0056, 0.0105]));
  // Segmented abdomen, banded light and dark.
  for (let s = 0; s < 7; s++) {
    const seg = paint(new THREE.CylinderGeometry(0.0024 - s * 0.00015, 0.0026 - s * 0.00015, 0.0075, 6, 1), s % 2 === 0 ? color : dark);
    parts.push(place(seg, [0, 0.0004, -0.008 - s * 0.0074], [Math.PI / 2, 0, 0]));
  }
  parts.push(place(paint(new THREE.SphereGeometry(1, 8, 6), dark), [0, 0.0005, 0.0155], [0, 0, 0], [0.0044, 0.004, 0.0036]));
  const eye = new THREE.Color(0.12, 0.3, 0.26);
  parts.push(place(paint(new THREE.SphereGeometry(0.0027, 6, 5), eye), [0.0026, 0.0016, 0.0165]));
  parts.push(place(paint(new THREE.SphereGeometry(0.0027, 6, 5), eye), [-0.0026, 0.0016, 0.0165]));
  return merge(parts);
}

/** Dragonflies that hold station over the lilies, dart about, and now and then land. */
export class Dragonflies {
  readonly group = new THREE.Group();
  private readonly flies: Dragonfly[] = [];
  private readonly rng = new Rng(999);
  private time = 0;

  constructor(private readonly ctx: WorldContext) {
    this.group.name = 'dragonflies';
    const lily = LANDMARKS.lilyField;
    const hero = LANDMARKS.heroBloom;
    const log = LANDMARKS.log;
    const wingMat = new THREE.MeshStandardMaterial({
      map: makeWingTexture(),
      transparent: true,
      opacity: 0.9,
      side: THREE.DoubleSide,
      depthWrite: false,
      roughness: 0.2,
      metalness: 0.1,
    });
    const wingGeo = new THREE.PlaneGeometry(0.036, 0.0095);
    wingGeo.translate(0.018, 0, 0);
    wingGeo.rotateX(-Math.PI / 2);

    const specs: Array<{ color: number; home: THREE.Vector3; range: THREE.Vector3 }> = [
      { color: 0x2a6fe0, home: new THREE.Vector3(lily.x, 0.5, lily.z), range: new THREE.Vector3(3.2, 0.35, 2.8) },
      { color: 0xd8301a, home: new THREE.Vector3(lily.x - 1.5, 0.45, lily.z + 1.4), range: new THREE.Vector3(2.6, 0.3, 2.2) },
      { color: 0x3fae5a, home: new THREE.Vector3(lily.x + 1.2, 0.6, lily.z - 0.6), range: new THREE.Vector3(2.4, 0.4, 2.4) },
      { color: 0x35b8c8, home: new THREE.Vector3(hero.x + 0.3, 0.45, hero.z - 0.4), range: new THREE.Vector3(2.4, 0.3, 2.2) },
      { color: 0xe07a1c, home: new THREE.Vector3(log.x, 0.5, log.z + 0.3), range: new THREE.Vector3(2.2, 0.3, 1.8) },
    ];
    specs.forEach((spec, i) => {
      const color = new THREE.Color(spec.color);
      const root = new THREE.Group();
      const body = new THREE.Mesh(
        dragonflyBody(color),
        new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.28, metalness: 0.55 })
      );
      body.castShadow = true;
      root.add(body);
      const wings: THREE.Object3D[] = [];
      for (const side of [1, -1]) {
        for (const fore of [1, 0]) {
          const pivot = new THREE.Group();
          pivot.position.set(side * 0.003, 0.0045, fore ? 0.0075 : 0.0015);
          const wing = new THREE.Mesh(wingGeo, wingMat);
          wing.scale.set(side * (fore ? 1 : 0.94), 1, fore ? 1 : 1.25);
          wing.rotation.y = side * (fore ? -0.12 : 0.16);
          pivot.add(wing);
          pivot.userData.side = side;
          root.add(pivot);
          wings.push(pivot);
        }
      }
      // Real dragonflies are ~7 cm; these are a little larger so they read from duck height.
      root.scale.setScalar(1.9);
      const start = spec.home.clone();
      root.position.copy(start);
      this.group.add(root);
      this.flies.push({
        root,
        wings,
        state: 'hover',
        timer: this.rng.range(0.3, 2),
        from: start.clone(),
        to: start.clone(),
        duration: 1,
        yaw: this.rng.range(0, TAU),
        home: spec.home,
        range: spec.range,
        seed: i * 13.7,
        perch: null,
      });
    });
  }

  get count() {
    return this.flies.length;
  }

  /** How many are currently settled on a pad, bloom or the log. */
  get perchedCount() {
    return this.flies.filter((f) => f.state === 'perched').length;
  }

  private pickHoverPoint(f: Dragonfly, out: THREE.Vector3) {
    for (let tries = 0; tries < 6; tries++) {
      out.set(
        f.home.x + this.rng.range(-1, 1) * f.range.x,
        f.home.y + this.rng.range(-1, 1) * f.range.y,
        f.home.z + this.rng.range(-1, 1) * f.range.z
      );
      const ground = Math.max(0, this.ctx.field.height(out.x, out.z));
      out.y = Math.max(out.y, ground + 0.22);
      // Prefer to stay out over the water.
      if (this.ctx.field.shoreDistance(out.x, out.z) < 0.6) return;
    }
  }

  private pickPerch(f: Dragonfly): THREE.Vector3 | null {
    let best: THREE.Vector3 | null = null;
    let bestScore = Infinity;
    for (const p of this.ctx.perches) {
      const d = Math.hypot(p.x - f.home.x, p.z - f.home.z);
      if (d > Math.max(f.range.x, f.range.z) * 1.2) continue;
      if (this.flies.some((o) => o !== f && o.perch === p)) continue;
      const score = d + this.rng.range(0, 3);
      if (score < bestScore) {
        bestScore = score;
        best = p;
      }
    }
    return best;
  }

  update(dt: number, duck: THREE.Vector3) {
    this.time += dt;
    for (const f of this.flies) {
      f.timer -= dt;
      const pos = f.root.position;

      if (f.state === 'hover') {
        // Hold station with a fine tremble.
        pos.x = f.to.x + Math.sin(this.time * 7.3 + f.seed) * 0.012;
        pos.y = f.to.y + Math.sin(this.time * 9.1 + f.seed * 2) * 0.01;
        pos.z = f.to.z + Math.cos(this.time * 6.7 + f.seed) * 0.012;
        f.yaw += Math.sin(this.time * 0.8 + f.seed) * 0.6 * dt;
        if (f.timer <= 0) {
          const wantsPerch = this.rng.f() < 0.26;
          const perch = wantsPerch ? this.pickPerch(f) : null;
          f.from.copy(pos);
          if (perch && perch.distanceTo(duck) > 1.4) {
            f.state = 'approach';
            f.perch = perch;
            f.to.copy(perch).add(v1.set(0, 0.012, 0));
            f.duration = clamp(f.from.distanceTo(f.to) / 1.6, 0.7, 1.8);
          } else {
            f.state = 'dart';
            this.pickHoverPoint(f, f.to);
            f.duration = clamp(f.from.distanceTo(f.to) / 4.5, 0.22, 0.8);
          }
          f.timer = f.duration;
        }
      } else if (f.state === 'dart' || f.state === 'approach') {
        const t = 1 - clamp(f.timer / f.duration, 0, 1);
        // Darts snap; landings ease in.
        const e = f.state === 'dart' ? t * t * (3 - 2 * t) : 1 - Math.pow(1 - t, 3);
        pos.lerpVectors(f.from, f.to, e);
        if (f.state === 'approach') pos.y += Math.sin(t * Math.PI) * 0.12;
        const dx = f.to.x - f.from.x;
        const dz = f.to.z - f.from.z;
        if (dx * dx + dz * dz > 1e-4) f.yaw = dampAngle(f.yaw, Math.atan2(dx, dz), 14, dt);
        if (f.timer <= 0) {
          if (f.state === 'approach') {
            f.state = 'perched';
            f.timer = this.rng.range(3.5, 8);
          } else {
            f.state = 'hover';
            f.timer = this.rng.range(0.8, 3.2);
          }
        }
      } else if (f.state === 'perched' && f.perch) {
        pos.copy(f.perch);
        pos.y += 0.012;
        // The duck paddling up, or simply time, sends it off again.
        if (f.timer <= 0 || f.perch.distanceTo(duck) < 0.75) {
          f.state = 'dart';
          f.from.copy(pos);
          this.pickHoverPoint(f, f.to);
          f.duration = 0.5;
          f.timer = f.duration;
          f.perch = null;
        }
      }

      f.root.rotation.set(f.state === 'perched' ? 0.12 : 0, f.yaw, 0);
      const flying = f.state !== 'perched';
      for (let w = 0; w < f.wings.length; w++) {
        const pivot = f.wings[w];
        const side = pivot.userData.side as number;
        const beat = flying
          ? Math.sin(this.time * 95 + f.seed + (w % 2) * 1.6) * 0.55 + 0.12
          : -0.08 + Math.sin(this.time * 1.3 + f.seed) * 0.03;
        pivot.rotation.z = side * beat;
      }
    }
  }
}
