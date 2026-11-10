import * as THREE from 'three';
import { Rng, TAU, angleDelta, fbm, lerp, smoothstep } from '../core/math';
import { applyPondShading } from '../water/pondShading';
import { leafCloud, taperedTube } from './geometry';
import { buildInstanced, merge, paint, place, shuffle, type Placement } from './instancing';
import { LANDMARKS, SUN_GAP_BEARING } from './PondLayout';
import { TERRAIN_HALF } from './Terrain';
import { makeBarkTexture, makeLeafClusterTexture, makeWillowStrandTexture } from './textures';
import type { WorldContext } from './WorldContext';

interface TreePrototype {
  trunk: THREE.BufferGeometry;
  canopy: THREE.BufferGeometry;
}

function buildPrototype(seed: number, shape: 'round' | 'tall' | 'broad'): TreePrototype {
  const rng = new Rng(seed);
  const trunkHeight = shape === 'tall' ? 7.2 : shape === 'broad' ? 4.6 : 5.6;
  const lean = new THREE.Vector3(rng.range(-0.5, 0.5), 0, rng.range(-0.5, 0.5));
  const trunkCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, -0.4, 0),
    new THREE.Vector3(lean.x * 0.2, trunkHeight * 0.35, lean.z * 0.2),
    new THREE.Vector3(lean.x * 0.7, trunkHeight * 0.75, lean.z * 0.7),
    new THREE.Vector3(lean.x, trunkHeight * 1.1, lean.z),
  ]);
  const baseR = shape === 'tall' ? 0.26 : 0.34;
  const parts: THREE.BufferGeometry[] = [
    taperedTube(trunkCurve, 8, 8, (t) => lerp(baseR * (1 + 0.5 * Math.exp(-t * 14)), baseR * 0.38, t), [2, 5]),
  ];

  const canopyY = trunkHeight * (shape === 'tall' ? 1.12 : 1.18);
  const spread = shape === 'broad' ? 3.2 : shape === 'tall' ? 1.7 : 2.4;
  const rise = shape === 'tall' ? 3.0 : shape === 'broad' ? 1.6 : 2.1;
  const blobs: Array<{ x: number; y: number; z: number; r: number }> = [];
  const blobCount = shape === 'broad' ? 9 : 7;
  for (let i = 0; i < blobCount; i++) {
    const a = (i / blobCount) * TAU + rng.range(-0.4, 0.4);
    const d = i === 0 ? 0 : rng.range(0.45, 1) * spread;
    blobs.push({
      x: lean.x + Math.cos(a) * d,
      y: canopyY + rng.range(-0.5, 1) * rise * (i === 0 ? 1 : 1 - (d / spread) * 0.6),
      z: lean.z + Math.sin(a) * d,
      r: rng.range(1.25, 1.9) * (shape === 'tall' ? 0.85 : 1),
    });
    // A limb reaching into every other blob.
    if (i % 2 === 1) {
      const b = blobs[blobs.length - 1];
      const from = trunkCurve.getPointAt(rng.range(0.55, 0.8));
      const limb = new THREE.CatmullRomCurve3([
        from,
        new THREE.Vector3(lerp(from.x, b.x, 0.5), lerp(from.y, b.y, 0.35), lerp(from.z, b.z, 0.5)),
        new THREE.Vector3(b.x, b.y - 0.2, b.z),
      ]);
      parts.push(taperedTube(limb, 5, 5, (t) => lerp(0.11, 0.035, t), [1, 3]));
    }
  }
  const trunk = merge(parts);
  const canopy = leafCloud(rng, blobs, new THREE.Vector3(lean.x, canopyY - 0.5, lean.z), 15, [1.7, 2.5]);
  return { trunk, canopy };
}

function buildBush(seed: number): THREE.BufferGeometry {
  const rng = new Rng(seed);
  const blobs: Array<{ x: number; y: number; z: number; r: number }> = [];
  for (let i = 0; i < 5; i++) {
    const a = rng.range(0, TAU);
    const d = i === 0 ? 0 : rng.range(0.4, 1.0);
    blobs.push({ x: Math.cos(a) * d, y: rng.range(0.45, 1.05), z: Math.sin(a) * d, r: rng.range(0.6, 0.95) });
  }
  return leafCloud(rng, blobs, new THREE.Vector3(0, 0.1, 0), 11, [0.95, 1.5]);
}

/** The ring of woodland around the pond, with a meadow gap toward the low sun. */
export function buildWoodland(ctx: WorldContext): THREE.Group {
  const group = new THREE.Group();
  group.name = 'woodland';
  const rng = new Rng(1701);

  const barkTex = makeBarkTexture(3, [118, 96, 72]);
  const trunkMat = new THREE.MeshStandardMaterial({ map: barkTex, roughness: 1, color: 0xb8a48c });
  const leafTextures = [
    makeLeafClusterTexture(101, [86, 132, 44]),
    makeLeafClusterTexture(202, [104, 142, 48]),
    makeLeafClusterTexture(303, [70, 118, 46]),
  ];
  const leafMats = leafTextures.map((map) =>
    applyPondShading(
      new THREE.MeshLambertMaterial({
        map,
        alphaTest: 0.5,
        vertexColors: true,
        side: THREE.FrontSide,
      }),
      ctx.pond,
      { underwater: false, nearFade: true, wind: { amplitude: 0.1, height: 8, speed: 1 } }
    )
  );

  const protos = [buildPrototype(11, 'round'), buildPrototype(23, 'tall'), buildPrototype(37, 'broad')];
  const placements: Placement[][] = [[], [], []];

  const spacing = 4.4;
  const cells = Math.floor((TERRAIN_HALF * 2 - 8) / spacing);
  const candidates: Array<{ x: number; z: number }> = [];
  for (let j = 0; j < cells; j++) {
    for (let i = 0; i < cells; i++) {
      candidates.push({
        x: -TERRAIN_HALF + 4 + (i + rng.range(0.1, 0.9)) * spacing,
        z: -TERRAIN_HALF + 4 + (j + rng.range(0.1, 0.9)) * spacing,
      });
    }
  }
  for (const c of candidates) {
    const sd = ctx.field.shoreDistance(c.x, c.z);
    if (sd < 3.4) continue;
    const bearing = Math.atan2(c.z, c.x);
    const offGap = Math.abs(angleDelta(SUN_GAP_BEARING, bearing));
    // Keep a wedge of open meadow toward the sun so its light reaches the water.
    if (offGap < 0.5 && sd < 44) continue;
    const gapEdge = smoothstep(0.5, 0.75, offGap);
    const clump = fbm(c.x * 0.07, c.z * 0.07, 3, 301);
    let chance = smoothstep(3.4, 13, sd) * 0.8 + 0.16;
    chance *= lerp(0.45, 1.25, clump) * lerp(0.5, 1, gapEdge);
    // Leave room around the willow so it reads as its own landmark.
    if (Math.hypot(c.x - LANDMARKS.willowBase.x, c.z - LANDMARKS.willowBase.z) < 7.5) continue;
    if (rng.f() > chance) continue;
    const kind = rng.f() < 0.42 ? 0 : rng.f() < 0.55 ? 1 : 2;
    const scale = rng.range(0.82, 1.38) * (sd < 8 ? 0.85 : 1);
    const tint = new THREE.Color().setHSL(rng.range(0.14, 0.3), rng.range(0.2, 0.5), rng.range(0.7, 0.92));
    placements[kind].push({
      x: c.x,
      y: ctx.field.height(c.x, c.z) - 0.05,
      z: c.z,
      yaw: rng.range(0, TAU),
      scale,
      scaleY: rng.range(0.92, 1.15),
      color: tint,
    });
    if (sd < 7) {
      ctx.colliders.addCapsule(
        new THREE.Vector3(c.x, -0.5, c.z),
        new THREE.Vector3(c.x, 5 * scale, c.z),
        0.42 * scale
      );
    }
  }

  protos.forEach((proto, k) => {
    const list = placements[k];
    if (list.length === 0) return;
    const trunkPlacements = list.map((p) => ({ ...p, color: undefined }));
    const trunks = buildInstanced(proto.trunk, trunkMat, trunkPlacements, {
      castShadow: true,
      receiveShadow: true,
      name: `treeTrunks${k}`,
    });
    const canopies = buildInstanced(proto.canopy, leafMats[k], list, {
      castShadow: true,
      receiveShadow: true,
      name: `treeCanopies${k}`,
    });
    group.add(trunks, canopies);
  });

  // Understory: hazel-like bushes in drifts along the tree line and across the meadow gap.
  const bushGeo = buildBush(77);
  const bushes: Placement[] = [];
  for (let i = 0; i < 520; i++) {
    const x = rng.range(-46, 46);
    const z = rng.range(-46, 46);
    const sd = ctx.field.shoreDistance(x, z);
    if (sd < 1.6 || sd > 34) continue;
    if (fbm(x * 0.11, z * 0.11, 3, 811) < 0.5) continue;
    if (Math.hypot(x - LANDMARKS.willowBase.x, z - LANDMARKS.willowBase.z) < 3.5) continue;
    bushes.push({
      x,
      y: ctx.field.height(x, z) - 0.05,
      z,
      yaw: rng.range(0, TAU),
      scale: rng.range(0.7, 1.5) * (sd < 4 ? 0.7 : 1),
      scaleY: rng.range(0.8, 1.2),
      color: new THREE.Color().setHSL(rng.range(0.15, 0.29), rng.range(0.2, 0.5), rng.range(0.66, 0.9)),
    });
  }
  shuffle(bushes, rng);
  const bushMesh = buildInstanced(bushGeo, leafMats[1], bushes, {
    castShadow: true,
    receiveShadow: true,
    name: 'bushes',
  });
  ctx.density.register(bushMesh);
  group.add(bushMesh);

  return group;
}

/**
 * The weeping willow on the north-west bank: a leaning trunk, arching limbs,
 * and curtains of hanging leaves that sway over the shallows.
 */
export function buildWillow(ctx: WorldContext): THREE.Group {
  const group = new THREE.Group();
  group.name = 'willow';
  const rng = new Rng(555);
  const base = LANDMARKS.willowBase.clone();
  base.y = ctx.field.height(base.x, base.z);
  const lean = new THREE.Vector3(LANDMARKS.willowLean.x, 0, LANDMARKS.willowLean.y).normalize();
  const side = new THREE.Vector3(-lean.z, 0, lean.x);

  const barkTex = makeBarkTexture(9, [120, 104, 78]);
  const barkMat = applyPondShading(
    new THREE.MeshStandardMaterial({ map: barkTex, roughness: 1, color: 0xa39478 }),
    ctx.pond,
    { wetBand: true }
  );

  const parts: THREE.BufferGeometry[] = [];
  const crown = base.clone().addScaledVector(lean, 2.3).add(new THREE.Vector3(0, 4.6, 0));
  const trunkCurve = new THREE.CatmullRomCurve3([
    base.clone().add(new THREE.Vector3(0, -0.6, 0)),
    base.clone().addScaledVector(lean, 0.25).add(new THREE.Vector3(0, 1.3, 0)),
    base.clone().addScaledVector(lean, 1.2).add(new THREE.Vector3(0, 3.1, 0)),
    crown,
  ]);
  parts.push(
    taperedTube(trunkCurve, 12, 12, (t) => lerp(0.52 * (1 + 0.7 * Math.exp(-t * 9)), 0.26, t), [3, 4])
  );
  ctx.colliders.addCapsule(
    base.clone().add(new THREE.Vector3(0, -0.3, 0)),
    base.clone().addScaledVector(lean, 1.2).add(new THREE.Vector3(0, 3.1, 0)),
    0.62
  );

  // Arching limbs: up and out, then drooping. Their far ends carry the curtains.
  const limbTips: Array<{ curve: THREE.CatmullRomCurve3 }> = [];
  const limbCount = 9;
  for (let i = 0; i < limbCount; i++) {
    const a = (i / limbCount) * TAU + rng.range(-0.25, 0.25);
    const dir = new THREE.Vector3().addScaledVector(lean, Math.cos(a)).addScaledVector(side, Math.sin(a));
    // Reach further out over the water than back over the bank.
    const reach = lerp(3.4, 5.6, (Math.cos(a) + 1) / 2) * rng.range(0.9, 1.1);
    const top = rng.range(1.6, 2.6);
    const curve = new THREE.CatmullRomCurve3([
      crown.clone().add(new THREE.Vector3(0, -0.5, 0)),
      crown.clone().addScaledVector(dir, reach * 0.35).add(new THREE.Vector3(0, top, 0)),
      crown.clone().addScaledVector(dir, reach * 0.75).add(new THREE.Vector3(0, top * 0.75, 0)),
      crown.clone().addScaledVector(dir, reach).add(new THREE.Vector3(0, top * 0.1 - 0.4, 0)),
    ]);
    parts.push(taperedTube(curve, 10, 6, (t) => lerp(0.2, 0.035, t), [1, 5]));
    limbTips.push({ curve });
  }

  // Exposed roots snaking down the bank and into the water.
  for (let i = 0; i < 7; i++) {
    const a = rng.range(-1.25, 1.25);
    const dir = new THREE.Vector3().addScaledVector(lean, Math.cos(a)).addScaledVector(side, Math.sin(a));
    const length = rng.range(1.6, 3.4);
    const pts: THREE.Vector3[] = [];
    const steps = 5;
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const wobble = Math.sin(t * 5 + i) * 0.22 * t;
      const x = base.x + dir.x * length * t + side.x * wobble;
      const z = base.z + dir.z * length * t + side.z * wobble;
      const ground = ctx.field.height(x, z);
      // Arch out of the bank near the trunk, then press into the mud.
      const arch = Math.sin(Math.min(1, t * 1.4) * Math.PI) * 0.16 * (1 - t);
      pts.push(new THREE.Vector3(x, ground + arch + lerp(0.5, -0.05, Math.min(1, t * 2.2)), z));
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    const r0 = rng.range(0.1, 0.17);
    parts.push(taperedTube(curve, 12, 6, (t) => lerp(r0, 0.03, t), [1, 4]));
    if (i % 2 === 0) {
      ctx.colliders.addCapsule(curve.getPointAt(0.35), curve.getPointAt(0.9), r0 * 0.9);
    }
  }

  const wood = new THREE.Mesh(merge(parts), barkMat);
  wood.castShadow = true;
  wood.receiveShadow = true;
  wood.name = 'willowWood';
  group.add(wood);

  // Hanging strands. Each instance is a pair of crossed cards whose origin is
  // the twig it hangs from, so the wind shader swings the free end.
  const strandTex = makeWillowStrandTexture();
  const strandMat = applyPondShading(
    new THREE.MeshLambertMaterial({
      map: strandTex,
      alphaTest: 0.42,
      side: THREE.DoubleSide,
      color: 0xdfe8b0,
    }),
    ctx.pond,
    { underwater: false, nearFade: true, wind: { amplitude: 0.3, height: 1, speed: 0.9 } }
  );
  const card = new THREE.PlaneGeometry(0.7, 1, 1, 6);
  card.translate(0, -0.5, 0);
  const crossed = merge([card, place(card.clone(), [0, 0, 0], [0, Math.PI / 2, 0])]);
  const strands: Placement[] = [];
  const hangPoint = new THREE.Vector3();
  const addStrand = (p: THREE.Vector3) => {
    const ground = Math.max(ctx.field.height(p.x, p.z), 0);
    const room = p.y - ground - rng.range(0.12, 0.55);
    if (room < 0.8) return;
    const length = Math.min(room, rng.range(2.6, 4.6));
    strands.push({
      x: p.x,
      y: p.y,
      z: p.z,
      yaw: rng.range(0, TAU),
      scale: 1,
      scaleY: length,
      color: new THREE.Color().setHSL(rng.range(0.15, 0.24), 0.35, rng.range(0.78, 0.95)),
    });
  };
  for (const limb of limbTips) {
    for (let k = 0; k < 34; k++) {
      const t = rng.range(0.3, 1);
      limb.curve.getPointAt(t, hangPoint);
      hangPoint.x += rng.range(-0.7, 0.7);
      hangPoint.z += rng.range(-0.7, 0.7);
      hangPoint.y += rng.range(-0.25, 0.2);
      addStrand(hangPoint);
    }
  }
  // Fill the dome between the limbs.
  for (let k = 0; k < 110; k++) {
    const a = rng.range(0, TAU);
    const d = Math.sqrt(rng.f()) * 4.6;
    hangPoint.copy(crown).addScaledVector(lean, 0.9 + Math.cos(a) * d).addScaledVector(side, Math.sin(a) * d);
    hangPoint.y = crown.y + 2.2 - (d / 4.6) ** 2 * 1.9 + rng.range(-0.2, 0.2);
    addStrand(hangPoint);
  }
  shuffle(strands, rng);
  const strandMesh = buildInstanced(crossed, strandMat, strands, {
    castShadow: true,
    receiveShadow: false,
    name: 'willowStrands',
  });
  group.add(strandMesh);

  // A soft crown of foliage on top so the limbs are not bare from across the pond.
  const crownBlobs: Array<{ x: number; y: number; z: number; r: number }> = [];
  for (let i = 0; i < 11; i++) {
    const a = rng.range(0, TAU);
    const d = Math.sqrt(rng.f()) * 3.6;
    crownBlobs.push({
      x: crown.x + lean.x * 0.9 + Math.cos(a) * d,
      y: crown.y + 2.3 - (d / 3.6) ** 2 * 1.2,
      z: crown.z + lean.z * 0.9 + Math.sin(a) * d,
      r: rng.range(1.0, 1.5),
    });
  }
  const crownGeo = leafCloud(rng, crownBlobs, crown.clone().add(new THREE.Vector3(0, 0.6, 0)), 12, [1.5, 2.2]);
  paint(crownGeo, (_x, _y, _z, i) => {
    const shade = crownGeo.getAttribute('color').getX(i);
    return new THREE.Color(0.86 * shade, 0.95 * shade, 0.55 * shade);
  });
  const crownMat = applyPondShading(
    new THREE.MeshLambertMaterial({
      map: makeLeafClusterTexture(404, [128, 156, 62]),
      alphaTest: 0.5,
      vertexColors: true,
    }),
    ctx.pond,
    { underwater: false, nearFade: true, wind: { amplitude: 0.12, height: 8, speed: 1 }, key: 'willowCrown' }
  );
  const crownMesh = new THREE.Mesh(crownGeo, crownMat);
  crownMesh.castShadow = true;
  crownMesh.name = 'willowCrown';
  group.add(crownMesh);

  return group;
}
