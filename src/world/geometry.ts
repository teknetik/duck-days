import * as THREE from 'three';
import { Rng, TAU, lerp, valueNoise } from '../core/math';

const v = new THREE.Vector3();
const n = new THREE.Vector3();

/**
 * A tube along `curve` whose radius varies with `radius(t)`, t in [0, 1].
 * Used for trunks, limbs, roots, the sunken branch and lily stems.
 */
export function taperedTube(
  curve: THREE.Curve<THREE.Vector3>,
  segments: number,
  radial: number,
  radius: (t: number) => number,
  uvRepeat: [number, number] = [1, 1]
): THREE.BufferGeometry {
  const frames = curve.computeFrenetFrames(segments, false);
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const index: number[] = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const centre = curve.getPointAt(t);
    const r = radius(t);
    const N = frames.normals[i];
    const B = frames.binormals[i];
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * TAU;
      n.copy(N).multiplyScalar(Math.cos(a)).addScaledVector(B, Math.sin(a));
      v.copy(centre).addScaledVector(n, r);
      positions.push(v.x, v.y, v.z);
      normals.push(n.x, n.y, n.z);
      uvs.push((j / radial) * uvRepeat[0], t * uvRepeat[1]);
    }
  }
  const ring = radial + 1;
  for (let i = 0; i < segments; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * ring + j;
      const b = a + ring;
      index.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(index);
  return geo;
}

export interface BladeOptions {
  height: number;
  width: number;
  segments?: number;
  /** Forward droop at the tip, in metres. */
  bend?: number;
  /** Keeps this fraction of the width at the tip (0 = pointed). */
  tipWidth?: number;
  /** Folds the blade into a shallow V so it catches light from both sides. */
  crease?: number;
}

/**
 * One grass/reed/weed blade: a tapered ribbon rooted at the origin, growing
 * up +y and drooping toward +z. UV.y runs root to tip.
 */
export function bladeStrip(o: BladeOptions): THREE.BufferGeometry {
  const seg = o.segments ?? 4;
  const bend = o.bend ?? 0;
  const tip = o.tipWidth ?? 0.08;
  const crease = o.crease ?? 0;
  const positions: number[] = [];
  const uvs: number[] = [];
  const index: number[] = [];
  for (let i = 0; i <= seg; i++) {
    const t = i / seg;
    const w = o.width * 0.5 * lerp(1, tip, t * t);
    const y = o.height * t;
    const z = bend * t * t;
    positions.push(-w, y, z + crease * w, 0, y, z, w, y, z + crease * w);
    uvs.push(0, t, 0.5, t, 1, t);
  }
  for (let i = 0; i < seg; i++) {
    const a = i * 3;
    const b = a + 3;
    index.push(a, a + 1, b, a + 1, b + 1, b, a + 1, a + 2, b + 1, a + 2, b + 2, b + 1);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(index);
  geo.computeVertexNormals();
  return geo;
}

/** A lumpy, slightly flattened boulder. Different seeds give different silhouettes. */
export function rockGeometry(seed: number, detail = 2, flatten = 0.72): THREE.BufferGeometry {
  const geo = new THREE.IcosahedronGeometry(1, detail);
  const pos = geo.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const big = valueNoise(v.x * 1.3 + seed, v.y * 1.3 + v.z * 0.7, seed) - 0.5;
    const small = valueNoise(v.x * 3.7 + seed * 2, v.z * 3.7 - v.y * 2.1, seed + 9) - 0.5;
    const r = 1 + big * 0.55 + small * 0.16;
    v.multiplyScalar(r);
    v.y *= flatten;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  // Icosahedron vertices are duplicated per face; merge by recomputing smooth
  // normals from position so the rock is not faceted like a gem.
  const merged = mergeByPosition(geo);
  merged.computeVertexNormals();
  return merged;
}

/** Welds vertices that share a position (drops other attributes except uv). */
export function mergeByPosition(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  const pos = geo.getAttribute('position');
  const uv = geo.getAttribute('uv');
  const map = new Map<string, number>();
  const positions: number[] = [];
  const uvs: number[] = [];
  const index: number[] = [];
  const count = geo.index ? geo.index.count : pos.count;
  for (let i = 0; i < count; i++) {
    const src = geo.index ? geo.index.getX(i) : i;
    const key = `${Math.round(pos.getX(src) * 1e4)}_${Math.round(pos.getY(src) * 1e4)}_${Math.round(pos.getZ(src) * 1e4)}`;
    let dst = map.get(key);
    if (dst === undefined) {
      dst = positions.length / 3;
      positions.push(pos.getX(src), pos.getY(src), pos.getZ(src));
      if (uv) uvs.push(uv.getX(src), uv.getY(src));
      map.set(key, dst);
    }
    index.push(dst);
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  if (uv) out.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  out.setIndex(index);
  return out;
}

/**
 * Leaf-card cloud: textured quads scattered over a set of blobs, with normals
 * that point away from `centre` so the whole mass shades like one soft volume.
 * Each quad is emitted with both windings (same normals), so a single-sided
 * material draws it from either side without flipping the lighting.
 */
export function leafCloud(
  rng: Rng,
  blobs: Array<{ x: number; y: number; z: number; r: number }>,
  centre: THREE.Vector3,
  cardsPerBlob: number,
  cardSize: [number, number]
): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const colors: number[] = [];
  const index: number[] = [];
  const right = new THREE.Vector3();
  const up = new THREE.Vector3();
  const face = new THREE.Vector3();
  const c = new THREE.Vector3();
  let minY = Infinity;
  let maxY = -Infinity;
  for (const b of blobs) {
    minY = Math.min(minY, b.y - b.r);
    maxY = Math.max(maxY, b.y + b.r);
  }
  for (const b of blobs) {
    for (let k = 0; k < cardsPerBlob; k++) {
      // Random direction on the blob, biased away from straight down.
      const theta = rng.range(0, TAU);
      const cosPhi = rng.range(-0.55, 1);
      const sinPhi = Math.sqrt(1 - cosPhi * cosPhi);
      face.set(Math.cos(theta) * sinPhi, cosPhi, Math.sin(theta) * sinPhi);
      c.set(b.x, b.y, b.z).addScaledVector(face, b.r * rng.range(0.55, 1));
      // Card plane faces mostly outward with some scatter.
      face.x += rng.range(-0.5, 0.5);
      face.y += rng.range(-0.5, 0.5);
      face.z += rng.range(-0.5, 0.5);
      face.normalize();
      right.set(face.z, 0, -face.x);
      if (right.lengthSq() < 1e-4) right.set(1, 0, 0);
      right.normalize();
      up.crossVectors(face, right).normalize();
      const roll = rng.range(0, TAU);
      const cr = Math.cos(roll);
      const sr = Math.sin(roll);
      const rx = right.clone().multiplyScalar(cr).addScaledVector(up, sr);
      const ux = up.clone().multiplyScalar(cr).addScaledVector(right, -sr);
      const size = rng.range(cardSize[0], cardSize[1]) * 0.5;
      n.subVectors(c, centre).normalize();
      n.y += 0.35;
      n.normalize();
      const heightT = (c.y - minY) / Math.max(1e-3, maxY - minY);
      const shade = lerp(0.62, 1.08, heightT) * rng.range(0.86, 1.1);
      const base = positions.length / 3;
      const corners: Array<[number, number]> = [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ];
      for (const [cx, cy] of corners) {
        v.copy(c).addScaledVector(rx, cx * size).addScaledVector(ux, cy * size);
        positions.push(v.x, v.y, v.z);
        normals.push(n.x, n.y, n.z);
        uvs.push(cx * 0.5 + 0.5, cy * 0.5 + 0.5);
        colors.push(shade, shade, shade);
      }
      index.push(base, base + 1, base + 2, base, base + 2, base + 3);
      index.push(base, base + 2, base + 1, base, base + 3, base + 2);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex(index);
  return geo;
}
