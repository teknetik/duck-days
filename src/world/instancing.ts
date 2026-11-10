import * as THREE from 'three';
import type { Rng } from '../core/math';

const m = new THREE.Matrix4();
const q = new THREE.Quaternion();
const s = new THREE.Vector3();
const p = new THREE.Vector3();
const e = new THREE.Euler();

export interface Placement {
  x: number;
  y: number;
  z: number;
  yaw: number;
  scale: number;
  /** Optional non-uniform height multiplier. */
  scaleY?: number;
  tiltX?: number;
  tiltZ?: number;
  color?: THREE.Color;
}

/**
 * Foliage meshes whose instance count follows the quality setting. Instances
 * are shuffled once, so drawing only the first N thins every patch evenly
 * instead of deleting whole areas.
 */
export class DensityRegistry {
  private readonly entries: Array<{ mesh: THREE.InstancedMesh; total: number }> = [];

  register(mesh: THREE.InstancedMesh) {
    this.entries.push({ mesh, total: mesh.count });
  }

  apply(density: number) {
    for (const entry of this.entries) {
      entry.mesh.count = Math.max(1, Math.round(entry.total * density));
    }
  }
}

export function shuffle<T>(items: T[], rng: Rng): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(rng.f() * (i + 1));
    const tmp = items[i];
    items[i] = items[j];
    items[j] = tmp;
  }
  return items;
}

export function placementMatrix(pl: Placement, out: THREE.Matrix4): THREE.Matrix4 {
  e.set(pl.tiltX ?? 0, pl.yaw, pl.tiltZ ?? 0, 'YXZ');
  q.setFromEuler(e);
  s.set(pl.scale, pl.scale * (pl.scaleY ?? 1), pl.scale);
  p.set(pl.x, pl.y, pl.z);
  return out.compose(p, q, s);
}

export function buildInstanced(
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  placements: readonly Placement[],
  options: { castShadow?: boolean; receiveShadow?: boolean; name?: string } = {}
): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(geometry, material, Math.max(1, placements.length));
  mesh.count = placements.length;
  let hasColor = false;
  placements.forEach((pl, i) => {
    mesh.setMatrixAt(i, placementMatrix(pl, m));
    if (pl.color) {
      mesh.setColorAt(i, pl.color);
      hasColor = true;
    }
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (hasColor && mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.castShadow = options.castShadow ?? false;
  mesh.receiveShadow = options.receiveShadow ?? false;
  mesh.name = options.name ?? '';
  // Instances are spread across the whole pond; per-mesh culling would only
  // ever see one giant box, so skip the test.
  mesh.frustumCulled = false;
  return mesh;
}

/** Bakes a transform and a vertex colour into a geometry (for merging prototypes). */
export function paint(
  geometry: THREE.BufferGeometry,
  color: THREE.Color | ((x: number, y: number, z: number, i: number) => THREE.Color)
): THREE.BufferGeometry {
  const pos = geometry.getAttribute('position');
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const c = typeof color === 'function' ? color(pos.getX(i), pos.getY(i), pos.getZ(i), i) : color;
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}

/** Merges geometries that share the same attribute set (position, normal, uv, color). */
export function merge(geometries: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const names = ['position', 'normal', 'uv', 'color'].filter((n) =>
    geometries.every((g) => g.getAttribute(n))
  );
  let vertexCount = 0;
  let indexCount = 0;
  for (const g of geometries) {
    vertexCount += g.getAttribute('position').count;
    indexCount += g.index ? g.index.count : g.getAttribute('position').count;
  }
  const out = new THREE.BufferGeometry();
  const arrays: Record<string, Float32Array> = {};
  for (const n of names) {
    arrays[n] = new Float32Array(vertexCount * geometries[0].getAttribute(n).itemSize);
  }
  const index = new Uint32Array(indexCount);
  let vOff = 0;
  let iOff = 0;
  for (const g of geometries) {
    const count = g.getAttribute('position').count;
    for (const n of names) {
      const attr = g.getAttribute(n);
      arrays[n].set(attr.array as ArrayLike<number>, vOff * attr.itemSize);
    }
    if (g.index) {
      for (let i = 0; i < g.index.count; i++) index[iOff++] = g.index.getX(i) + vOff;
    } else {
      for (let i = 0; i < count; i++) index[iOff++] = i + vOff;
    }
    vOff += count;
  }
  for (const n of names) {
    out.setAttribute(n, new THREE.BufferAttribute(arrays[n], geometries[0].getAttribute(n).itemSize));
  }
  out.setIndex(new THREE.BufferAttribute(index, 1));
  return out;
}

/** Applies a transform to a geometry and returns it (convenience for chaining). */
export function place(
  geometry: THREE.BufferGeometry,
  position: [number, number, number],
  rotation: [number, number, number] = [0, 0, 0],
  scale: [number, number, number] | number = 1
): THREE.BufferGeometry {
  e.set(rotation[0], rotation[1], rotation[2], 'YXZ');
  q.setFromEuler(e);
  if (typeof scale === 'number') s.set(scale, scale, scale);
  else s.set(scale[0], scale[1], scale[2]);
  p.set(position[0], position[1], position[2]);
  geometry.applyMatrix4(m.compose(p, q, s));
  return geometry;
}
