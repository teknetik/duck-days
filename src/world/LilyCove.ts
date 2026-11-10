import * as THREE from 'three';
import { Rng, TAU, lerp } from '../core/math';
import { applyPondShading } from '../water/pondShading';
import { taperedTube } from './geometry';
import { buildInstanced, merge, paint, place, type Placement } from './instancing';
import { LANDMARKS } from './PondLayout';
import { makeLilyPadTexture } from './textures';
import type { WorldContext } from './WorldContext';

const tmp = new THREE.Color();

/** A notched, slightly cupped disc of radius 1, lying in XZ. */
function padGeometry(seed: number): THREE.BufferGeometry {
  const rng = new Rng(seed);
  const segments = 28;
  const notch = 0.3;
  const positions: number[] = [0, 0, 0];
  const uvs: number[] = [0.5, 0.5];
  const index: number[] = [];
  const rings = [0.55, 1];
  const wobble = Array.from({ length: segments + 1 }, () => rng.range(-0.045, 0.045));
  for (let r = 0; r < rings.length; r++) {
    for (let s = 0; s <= segments; s++) {
      const a = notch / 2 + (s / segments) * (TAU - notch);
      const radius = rings[r] * (1 + (r === 1 ? wobble[s] : 0));
      const x = Math.cos(a) * radius;
      const z = Math.sin(a) * radius;
      const lift = r === 1 ? 0.035 + 0.03 * Math.sin(a * 5 + seed) : 0.006;
      positions.push(x, lift, z);
      uvs.push(x * 0.5 + 0.5, z * 0.5 + 0.5);
    }
  }
  const ring0 = 1;
  const ring1 = 1 + segments + 1;
  for (let s = 0; s < segments; s++) {
    index.push(0, ring0 + s + 1, ring0 + s);
    index.push(ring0 + s, ring0 + s + 1, ring1 + s);
    index.push(ring0 + s + 1, ring1 + s + 1, ring1 + s);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(index);
  geo.computeVertexNormals();
  return geo;
}

/** One pointed, cupped petal: rooted at the origin, reaching out along +z. */
function petalGeometry(length: number, width: number, cup: number): THREE.BufferGeometry {
  const rows = 5;
  const positions: number[] = [];
  const uvs: number[] = [];
  const index: number[] = [];
  for (let i = 0; i <= rows; i++) {
    const t = i / rows;
    const w = width * 0.5 * Math.pow(Math.sin(Math.PI * Math.min(0.999, t * 0.92 + 0.06)), 0.75);
    const y = cup * t * t;
    const z = length * t;
    positions.push(-w, y + w * 0.5, z, 0, y, z, w, y + w * 0.5, z);
    uvs.push(0, t, 0.5, t, 1, t);
  }
  for (let i = 0; i < rows; i++) {
    const a = i * 3;
    const b = a + 3;
    index.push(a, b, a + 1, a + 1, b, b + 1, a + 1, b + 1, a + 2, a + 2, b + 1, b + 2);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(index);
  geo.computeVertexNormals();
  return geo;
}

/** A pink water lily of radius ~1: three whorls of petals around a golden centre. */
function bloomGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const whorls = [
    { count: 9, length: 1.0, width: 0.42, tilt: 0.28, cup: 0.18, base: [0.9, 0.4, 0.58], tip: [1.0, 0.82, 0.88] },
    { count: 8, length: 0.82, width: 0.36, tilt: 0.75, cup: 0.22, base: [0.9, 0.3, 0.52], tip: [1.0, 0.7, 0.8] },
    { count: 6, length: 0.6, width: 0.3, tilt: 1.15, cup: 0.2, base: [0.86, 0.24, 0.46], tip: [0.98, 0.58, 0.72] },
  ];
  whorls.forEach((w, wi) => {
    for (let k = 0; k < w.count; k++) {
      const petal = petalGeometry(w.length, w.width, w.cup);
      const uv = petal.getAttribute('uv');
      paint(petal, (_x, _y, _z, i) =>
        tmp
          .setRGB(w.base[0], w.base[1], w.base[2])
          .lerp(new THREE.Color(w.tip[0], w.tip[1], w.tip[2]), Math.pow(uv.getY(i), 0.7))
      );
      // Tilt up out of the water, then spin into place around the centre.
      parts.push(place(petal, [0, 0.04 + wi * 0.03, 0], [-w.tilt, (k / w.count) * TAU + wi * 0.35, 0]));
    }
  });
  const heart = paint(new THREE.SphereGeometry(0.2, 10, 6), new THREE.Color(1.0, 0.74, 0.08));
  parts.push(place(heart, [0, 0.2, 0], [0, 0, 0], [1, 0.75, 1]));
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * TAU;
    const stamen = paint(new THREE.CylinderGeometry(0.012, 0.02, 0.3, 4, 1), new THREE.Color(1.0, 0.8, 0.12));
    parts.push(place(stamen, [Math.cos(a) * 0.16, 0.3, Math.sin(a) * 0.16], [Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5]));
  }
  return merge(parts);
}

export interface LilyResult {
  group: THREE.Group;
  /** World positions of the open blooms (y is the top of the flower). */
  blooms: THREE.Vector3[];
}

/**
 * Lily cove: a field of floating pads with pink blooms, a smaller cluster at
 * the cove mouth, a trail of strays, and one pad cluster with a bloom right in
 * front of the spawn point. Pads ride the simulated water surface.
 */
export function buildLilies(ctx: WorldContext): LilyResult {
  const group = new THREE.Group();
  group.name = 'lilies';
  const rng = new Rng(2718);
  const field = ctx.field;

  interface Pad {
    x: number;
    z: number;
    r: number;
  }
  const pads: Pad[] = [];
  const blooms: Array<{ x: number; z: number; r: number }> = [];

  const tryPad = (x: number, z: number, r: number): Pad | null => {
    if (field.depth(x, z) < 0.18) return null;
    for (const p of pads) {
      if (Math.hypot(p.x - x, p.z - z) < (p.r + r) * 0.9) return null;
    }
    const pad = { x, z, r };
    pads.push(pad);
    return pad;
  };
  const tryBloom = (pad: Pad, minGap: number) => {
    const a = rng.range(0, TAU);
    const bx = pad.x + Math.cos(a) * pad.r * 0.75;
    const bz = pad.z + Math.sin(a) * pad.r * 0.75;
    for (const b of blooms) if (Math.hypot(b.x - bx, b.z - bz) < minGap) return;
    blooms.push({ x: bx, z: bz, r: rng.range(0.075, 0.105) });
  };
  const cluster = (cx: number, cz: number, radius: number, attempts: number, bloomChance: number, gap: number) => {
    for (let i = 0; i < attempts; i++) {
      const a = rng.range(0, TAU);
      // Denser toward the middle of the cluster.
      const d = Math.pow(rng.f(), 0.7) * radius;
      const pad = tryPad(cx + Math.cos(a) * d, cz + Math.sin(a) * d, rng.range(0.1, 0.2));
      if (pad && rng.f() < bloomChance) tryBloom(pad, gap);
    }
  };

  // The bloom the player sees first: placed deliberately, then dressed with pads.
  const hero = LANDMARKS.heroBloom;
  const heroPads: Array<[number, number, number]> = [
    [0, 0, 0.19],
    [0.3, 0.16, 0.15],
    [-0.28, 0.2, 0.17],
    [0.08, -0.36, 0.18],
    [-0.38, -0.2, 0.13],
    [0.46, -0.24, 0.14],
    [0.16, 0.46, 0.12],
    [-0.1, 0.62, 0.15],
    [0.62, 0.22, 0.11],
    [-0.62, 0.1, 0.12],
  ];
  for (const [dx, dz, r] of heroPads) tryPad(hero.x + dx, hero.z + dz, r);
  blooms.push({ x: hero.x + 0.1, z: hero.z + 0.09, r: 0.11 });

  const lf = LANDMARKS.lilyField;
  cluster(lf.x, lf.z, 3.7, 520, 0.11, 0.8);
  cluster(lf.x - 3.4, lf.z + 2.3, 1.5, 100, 0.09, 0.7);
  cluster(lf.x + 1.2, lf.z + 3.3, 1.3, 70, 0.08, 0.7);
  // Strays leading from the open water toward the cove.
  for (let i = 0; i < 14; i++) {
    const t = rng.range(0.12, 0.95);
    cluster(lerp(hero.x, lf.x - 3, t) + rng.range(-1, 1), lerp(hero.z, lf.z + 1.6, t) + rng.range(-0.9, 0.9), 0.5, 4, 0.08, 1.2);
  }
  // A few pads have also found the quiet water behind the log.
  cluster(LANDMARKS.log.x - 0.6, LANDMARKS.log.z - 1.6, 1.4, 50, 0.06, 1.0);

  const padGeos = [padGeometry(1), padGeometry(2), padGeometry(3)];
  const padMat = applyPondShading(
    new THREE.MeshStandardMaterial({
      map: makeLilyPadTexture(),
      side: THREE.DoubleSide,
      roughness: 0.62,
      metalness: 0,
    }),
    ctx.pond,
    { underwater: false, floatOnWater: { gain: 1.6 }, key: 'pad' }
  );
  const padLists: Placement[][] = [[], [], []];
  for (const p of pads) {
    padLists[rng.int(0, 2)].push({
      x: p.x,
      y: 0.004,
      z: p.z,
      yaw: rng.range(0, TAU),
      scale: p.r,
      color: new THREE.Color().setHSL(rng.range(0.2, 0.3), rng.range(0.25, 0.5), rng.range(0.7, 0.95)),
    });
    if (rng.f() < 0.12) ctx.perches.push(new THREE.Vector3(p.x, 0.035, p.z));
  }
  padGeos.forEach((geo, k) => {
    const mesh = buildInstanced(geo, padMat, padLists[k], { castShadow: true, receiveShadow: true, name: `lilyPads${k}` });
    group.add(mesh);
  });

  const bloomMat = applyPondShading(
    new THREE.MeshStandardMaterial({
      vertexColors: true,
      side: THREE.DoubleSide,
      roughness: 0.5,
      emissive: new THREE.Color(0.25, 0.06, 0.12),
      emissiveIntensity: 0.35,
    }),
    ctx.pond,
    { underwater: false, floatOnWater: { gain: 1.6 }, key: 'bloom' }
  );
  const bloomPlacements: Placement[] = blooms.map((b) => ({
    x: b.x,
    y: 0.012,
    z: b.z,
    yaw: rng.range(0, TAU),
    scale: b.r,
  }));
  const bloomMesh = buildInstanced(bloomGeometry(), bloomMat, bloomPlacements, {
    castShadow: true,
    receiveShadow: true,
    name: 'lilyBlooms',
  });
  group.add(bloomMesh);

  // Stems: every pad and bloom is tethered to the bed, which is what you see from below.
  const stemCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0.05, -0.3, 0.03),
    new THREE.Vector3(-0.04, -0.7, -0.05),
    new THREE.Vector3(0.02, -1, 0.02),
  ]);
  const stemGeo = taperedTube(stemCurve, 8, 5, () => 0.007, [1, 1]);
  const stemMat = applyPondShading(
    new THREE.MeshStandardMaterial({ color: 0x5d7a36, roughness: 0.8 }),
    ctx.pond,
    { key: 'stem' }
  );
  const stems: Placement[] = [];
  for (const p of [...pads, ...blooms]) {
    const depth = field.depth(p.x, p.z);
    if (depth < 0.1) continue;
    stems.push({ x: p.x, y: 0, z: p.z, yaw: rng.range(0, TAU), scale: 1, scaleY: depth + 0.03 });
  }
  const stemMesh = buildInstanced(stemGeo, stemMat, stems, { name: 'lilyStems' });
  group.add(stemMesh);

  const bloomPoints = blooms.map((b) => new THREE.Vector3(b.x, 0.012 + b.r * 0.55, b.z));
  for (const b of bloomPoints) ctx.perches.push(b.clone());
  return { group, blooms: bloomPoints };
}
