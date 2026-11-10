import * as THREE from 'three';
import { fbm, lerp, saturate, smin, smoothstep, valueNoise } from '../core/math';
import { LANDMARKS, LOBES, POND_HALF } from './PondLayout';

/** Half-size of the area covered by terrain (and by the cached height grid). */
export const TERRAIN_HALF = 72;
const GRID_CELL = 0.25;
const INNER_HALF = 20;
const INNER_SEGMENTS = 256;
const OUTER_CELL = 2;

const tmpColor = new THREE.Color();

/**
 * Analytic pond/bank shape. Returns [signedShoreDistance, height]:
 * distance is negative over water and positive on land (approximately metres).
 */
function evaluate(x: number, z: number): [number, number] {
  let sd = Infinity;
  let wSum = 0;
  let dSum = 0;
  for (const lobe of LOBES) {
    const q = Math.hypot((x - lobe.x) / lobe.rx, (z - lobe.z) / lobe.rz);
    const d = (q - 1) * Math.min(lobe.rx, lobe.rz);
    sd = sd === Infinity ? d : smin(sd, d, 1.6);
    const w = Math.max(0, 1.15 - q);
    const w3 = w * w * w;
    wSum += w3;
    dSum += w3 * lobe.depth;
  }
  const basinDepth = wSum > 1e-5 ? dSum / wSum : 1.0;

  // Wobble the shoreline so it never reads as a set of ellipses.
  sd += (fbm(x * 0.22, z * 0.22, 4, 7) - 0.5) * 1.9;
  sd += (fbm(x * 0.9, z * 0.9, 2, 11) - 0.5) * 0.4;

  if (sd < 0) {
    const inside = -sd;
    // Muddy shelf first, then the drop-off into each basin.
    const shelf = 0.22 * (1 - Math.exp(-inside / 0.7));
    const fall = Math.max(2.4, basinDepth * 1.5);
    const deep = Math.max(0, basinDepth - 0.22) * smoothstep(0.7, 0.7 + fall, inside);
    let h = -(shelf + deep);
    h += (fbm(x * 0.45, z * 0.45, 3, 23) - 0.5) * 0.18 * smoothstep(0.3, 2.0, inside);
    h += (valueNoise(x * 2.3, z * 2.3, 31) - 0.5) * 0.035 * smoothstep(0.2, 1.0, inside);
    return [sd, h];
  }

  // Lily cove has a low, grassy bank; the willow sits on a slightly raised root bank.
  const lilyBank = Math.exp(-((x - 11.5) ** 2 + (z + 7.5) ** 2) / 40);
  const willowBank = Math.exp(
    -((x - LANDMARKS.willowBase.x) ** 2 + (z - LANDMARKS.willowBase.z) ** 2) / 7
  );
  const bank = (0.3 - 0.16 * lilyBank + 0.22 * willowBank) * (1 - Math.exp(-sd / 0.55));
  const rise = 0.9 * smoothstep(1.2, 10, sd);
  const hills = fbm(x * 0.045, z * 0.045, 4, 41) * 2.8 * smoothstep(4, 24, sd);
  const bumps = (fbm(x * 0.5, z * 0.5, 3, 5) - 0.5) * 0.14 * smoothstep(0.2, 2, sd);
  return [sd, bank + rise + hills + bumps];
}

/**
 * Cached height + shore-distance grid with bilinear lookups. Everything that
 * needs to know about the ground (mesh, water shaders, collisions, planting)
 * reads from here so they always agree.
 */
export class Heightfield {
  readonly n: number;
  private readonly heights: Float32Array;
  private readonly shore: Float32Array;

  constructor() {
    this.n = Math.round((TERRAIN_HALF * 2) / GRID_CELL) + 1;
    this.heights = new Float32Array(this.n * this.n);
    this.shore = new Float32Array(this.n * this.n);
    for (let j = 0; j < this.n; j++) {
      const z = -TERRAIN_HALF + j * GRID_CELL;
      for (let i = 0; i < this.n; i++) {
        const x = -TERRAIN_HALF + i * GRID_CELL;
        const [sd, h] = evaluate(x, z);
        this.heights[j * this.n + i] = h;
        this.shore[j * this.n + i] = sd;
      }
    }
  }

  private sample(data: Float32Array, x: number, z: number): number {
    const max = this.n - 1.001;
    const gx = Math.min(max, Math.max(0, (x + TERRAIN_HALF) / GRID_CELL));
    const gz = Math.min(max, Math.max(0, (z + TERRAIN_HALF) / GRID_CELL));
    const ix = Math.floor(gx);
    const iz = Math.floor(gz);
    const fx = gx - ix;
    const fz = gz - iz;
    const i0 = iz * this.n + ix;
    const i1 = i0 + this.n;
    return lerp(
      lerp(data[i0], data[i0 + 1], fx),
      lerp(data[i1], data[i1 + 1], fx),
      fz
    );
  }

  /** Ground / pond-bed height in metres (water surface is y = 0). */
  height(x: number, z: number): number {
    return this.sample(this.heights, x, z);
  }

  /** Signed distance to the shoreline: negative over water, positive on land. */
  shoreDistance(x: number, z: number): number {
    return this.sample(this.shore, x, z);
  }

  /** Water depth (>= 0) at a point; 0 on land. */
  depth(x: number, z: number): number {
    return Math.max(0, -this.height(x, z));
  }

  /** Uphill gradient of the ground, written into `out` (x, z). */
  gradient(x: number, z: number, out: THREE.Vector2): THREE.Vector2 {
    const e = 0.2;
    out.set(
      (this.height(x + e, z) - this.height(x - e, z)) / (2 * e),
      (this.height(x, z + e) - this.height(x, z - e)) / (2 * e)
    );
    return out;
  }

  normal(x: number, z: number, out: THREE.Vector3): THREE.Vector3 {
    const e = 0.2;
    const dx = (this.height(x + e, z) - this.height(x - e, z)) / (2 * e);
    const dz = (this.height(x, z + e) - this.height(x, z - e)) / (2 * e);
    return out.set(-dx, 1, -dz).normalize();
  }
}

function groundColor(field: Heightfield, x: number, z: number, h: number, out: THREE.Color) {
  const sd = field.shoreDistance(x, z);
  const n1 = fbm(x * 0.35, z * 0.35, 3, 61);
  const n2 = valueNoise(x * 1.9, z * 1.9, 67);
  if (h < 0.02) {
    // Pond bed: warm sandy mud in the shallows, grey-olive silt with gravel patches deeper down.
    const d = -h;
    out.setRGB(0.5, 0.4, 0.26).lerp(tmpColor.setRGB(0.36, 0.34, 0.24), smoothstep(0.25, 1.4, d));
    const gravel = smoothstep(0.55, 0.75, fbm(x * 0.6, z * 0.6, 3, 71)) * smoothstep(0.8, 1.6, d);
    out.lerp(tmpColor.setRGB(0.46, 0.45, 0.4), gravel * 0.7);
    out.multiplyScalar(0.82 + n2 * 0.3);
    return;
  }
  // Bank: dark wet mud at the waterline, grass beyond, leaf litter under the trees.
  const mud = 1 - smoothstep(0.03, 0.2 + n1 * 0.18, h);
  const meadow = tmpColor.setRGB(0.2, 0.31, 0.08).lerp(new THREE.Color(0.34, 0.4, 0.11), n1);
  out.copy(meadow);
  const litter = smoothstep(7, 16, sd + (n1 - 0.5) * 6);
  out.lerp(tmpColor.setRGB(0.2, 0.17, 0.09), litter * 0.75);
  out.lerp(tmpColor.setRGB(0.17, 0.12, 0.07), mud);
  out.multiplyScalar(0.8 + n2 * 0.35);
}

export class Terrain {
  readonly field: Heightfield;
  readonly group = new THREE.Group();
  /** Bed height over the simulation square, sampled by the water and wave shaders. */
  readonly bedTexture: THREE.DataTexture;
  readonly material: THREE.MeshStandardMaterial;

  constructor(detailMap: THREE.Texture, floatLinear: boolean) {
    this.field = new Heightfield();
    this.material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      map: detailMap,
      roughness: 0.95,
      metalness: 0,
    });

    const inner = new THREE.Mesh(this.buildInner(), this.material);
    inner.receiveShadow = true;
    inner.name = 'terrainInner';
    const outer = new THREE.Mesh(this.buildOuter(), this.material);
    outer.receiveShadow = true;
    outer.name = 'terrainOuter';
    this.group.add(inner, outer);

    this.bedTexture = this.buildBedTexture(floatLinear);
  }

  /** Height on the inner mesh border, matched to the coarse outer mesh so the seam is watertight. */
  private borderHeight(x: number, z: number): number {
    const along = Math.abs(x) >= INNER_HALF - 1e-4 ? 'z' : 'x';
    if (along === 'z') {
      const z0 = Math.floor(z / OUTER_CELL) * OUTER_CELL;
      const t = (z - z0) / OUTER_CELL;
      return lerp(this.field.height(x, z0), this.field.height(x, z0 + OUTER_CELL), saturate(t));
    }
    const x0 = Math.floor(x / OUTER_CELL) * OUTER_CELL;
    const t = (x - x0) / OUTER_CELL;
    return lerp(this.field.height(x0, z), this.field.height(x0 + OUTER_CELL, z), saturate(t));
  }

  private buildInner(): THREE.BufferGeometry {
    const seg = INNER_SEGMENTS;
    const count = (seg + 1) * (seg + 1);
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const uvs = new Float32Array(count * 2);
    const color = new THREE.Color();
    let p = 0;
    for (let j = 0; j <= seg; j++) {
      const z = -INNER_HALF + (j / seg) * INNER_HALF * 2;
      for (let i = 0; i <= seg; i++) {
        const x = -INNER_HALF + (i / seg) * INNER_HALF * 2;
        const onBorder = i === 0 || j === 0 || i === seg || j === seg;
        const h = onBorder ? this.borderHeight(x, z) : this.field.height(x, z);
        positions[p * 3] = x;
        positions[p * 3 + 1] = h;
        positions[p * 3 + 2] = z;
        groundColor(this.field, x, z, h, color);
        colors[p * 3] = color.r;
        colors[p * 3 + 1] = color.g;
        colors[p * 3 + 2] = color.b;
        uvs[p * 2] = x * 0.45;
        uvs[p * 2 + 1] = z * 0.45;
        p++;
      }
    }
    const index = new Uint32Array(seg * seg * 6);
    let k = 0;
    for (let j = 0; j < seg; j++) {
      for (let i = 0; i < seg; i++) {
        const a = j * (seg + 1) + i;
        const b = a + 1;
        const c = a + seg + 1;
        const d = c + 1;
        index[k++] = a;
        index[k++] = c;
        index[k++] = b;
        index[k++] = b;
        index[k++] = c;
        index[k++] = d;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geo.setIndex(new THREE.BufferAttribute(index, 1));
    geo.computeVertexNormals();
    return geo;
  }

  private buildOuter(): THREE.BufferGeometry {
    const seg = Math.round((TERRAIN_HALF * 2) / OUTER_CELL);
    const count = (seg + 1) * (seg + 1);
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const uvs = new Float32Array(count * 2);
    const color = new THREE.Color();
    let p = 0;
    for (let j = 0; j <= seg; j++) {
      const z = -TERRAIN_HALF + j * OUTER_CELL;
      for (let i = 0; i <= seg; i++) {
        const x = -TERRAIN_HALF + i * OUTER_CELL;
        const h = this.field.height(x, z);
        positions[p * 3] = x;
        positions[p * 3 + 1] = h;
        positions[p * 3 + 2] = z;
        groundColor(this.field, x, z, Math.max(h, 0.3), color);
        colors[p * 3] = color.r;
        colors[p * 3 + 1] = color.g;
        colors[p * 3 + 2] = color.b;
        uvs[p * 2] = x * 0.45;
        uvs[p * 2 + 1] = z * 0.45;
        p++;
      }
    }
    const index: number[] = [];
    for (let j = 0; j < seg; j++) {
      const z0 = -TERRAIN_HALF + j * OUTER_CELL;
      for (let i = 0; i < seg; i++) {
        const x0 = -TERRAIN_HALF + i * OUTER_CELL;
        const insideInner =
          x0 >= -INNER_HALF - 1e-4 &&
          x0 + OUTER_CELL <= INNER_HALF + 1e-4 &&
          z0 >= -INNER_HALF - 1e-4 &&
          z0 + OUTER_CELL <= INNER_HALF + 1e-4;
        if (insideInner) continue;
        const a = j * (seg + 1) + i;
        const b = a + 1;
        const c = a + seg + 1;
        const d = c + 1;
        index.push(a, c, b, b, c, d);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geo.setIndex(index);
    geo.computeVertexNormals();
    return geo;
  }

  private buildBedTexture(floatLinear: boolean): THREE.DataTexture {
    const size = 512;
    const data = new Float32Array(size * size * 4);
    for (let j = 0; j < size; j++) {
      const z = -POND_HALF + ((j + 0.5) / size) * POND_HALF * 2;
      for (let i = 0; i < size; i++) {
        const x = -POND_HALF + ((i + 0.5) / size) * POND_HALF * 2;
        const o = (j * size + i) * 4;
        data[o] = this.field.height(x, z);
        data[o + 1] = this.field.shoreDistance(x, z);
        data[o + 2] = 0;
        data[o + 3] = 1;
      }
    }
    const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.FloatType);
    tex.minFilter = tex.magFilter = floatLinear ? THREE.LinearFilter : THREE.NearestFilter;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.needsUpdate = true;
    return tex;
  }
}
