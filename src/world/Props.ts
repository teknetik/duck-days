import * as THREE from 'three';
import { Rng, TAU, fbm, lerp, smoothstep, valueNoise } from '../core/math';
import { applyPondShading } from '../water/pondShading';
import { rockGeometry, taperedTube } from './geometry';
import { buildInstanced, merge, paint, shuffle, type Placement } from './instancing';
import { LANDMARKS } from './PondLayout';
import { makeBarkTexture } from './textures';
import type { WorldContext } from './WorldContext';

const tmp = new THREE.Color();

function rockMaterial(ctx: WorldContext, detail: THREE.Texture) {
  return applyPondShading(
    new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.92,
      metalness: 0,
    }),
    ctx.pond,
    { wetBand: true, detail: { texture: detail, scale: 1.6 }, key: 'rock' }
  );
}

/** Rocks: damp boulders at the margins, big stones in the deep pool, gravel on the bed. */
export function buildRocks(ctx: WorldContext, detail: THREE.Texture): THREE.Group {
  const group = new THREE.Group();
  group.name = 'rocks';
  const rng = new Rng(4242);
  const field = ctx.field;
  const mat = rockMaterial(ctx, detail);

  const protos = [rockGeometry(1, 2, 0.7), rockGeometry(2, 2, 0.82), rockGeometry(3, 2, 0.6)];
  for (const g of protos) {
    const pos = g.getAttribute('position');
    const uvs = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) {
      uvs[i * 2] = pos.getX(i) * 0.9 + pos.getY(i) * 0.4;
      uvs[i * 2 + 1] = pos.getZ(i) * 0.9 + pos.getY(i) * 0.4;
    }
    g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  }
  const lists: Placement[][] = [[], [], []];
  const grey = () => new THREE.Color().setHSL(rng.range(0.07, 0.13), rng.range(0.06, 0.16), rng.range(0.3, 0.46));

  const addRock = (x: number, z: number, size: number, sink: number, solid: boolean) => {
    const ground = field.height(x, z);
    const k = rng.int(0, 2);
    const y = ground + size * (0.5 - sink);
    lists[k].push({
      x,
      y,
      z,
      yaw: rng.range(0, TAU),
      scale: size,
      scaleY: rng.range(0.8, 1.15),
      tiltX: rng.range(-0.2, 0.2),
      tiltZ: rng.range(-0.2, 0.2),
      color: grey(),
    });
    if (solid) ctx.colliders.addSphere(x, y, z, size * 0.82);
  };

  // Damp boulders grouped along the margin of the willow shallows and at the
  // mouth of the lily cove -- a few stand in the water, most sit on the bank.
  const clusters: Array<{ x: number; z: number; n: number; r: number }> = [
    { x: -9.9, z: -2.5, n: 7, r: 1.3 },
    { x: -3.2, z: -8.6, n: 6, r: 1.2 },
    { x: -1.6, z: -5.0, n: 4, r: 0.8 },
    { x: 4.2, z: -6.9, n: 6, r: 1.2 },
    { x: 11.8, z: -2.2, n: 5, r: 1.1 },
    { x: 9.4, z: 3.2, n: 6, r: 1.3 },
    { x: -6.8, z: 5.4, n: 6, r: 1.3 },
    { x: 1.0, z: 9.6, n: 5, r: 1.2 },
  ];
  for (const c of clusters) {
    for (let i = 0; i < c.n; i++) {
      const a = rng.range(0, TAU);
      const d = Math.sqrt(rng.f()) * c.r;
      const x = c.x + Math.cos(a) * d;
      const z = c.z + Math.sin(a) * d;
      const sd = field.shoreDistance(x, z);
      if (sd < -1.6 || sd > 2.2) continue;
      const size = rng.range(0.22, 0.6) * (i === 0 ? 1.5 : 1);
      addRock(x, z, size, rng.range(0.25, 0.42), size > 0.3 && sd < 0.6);
    }
  }
  // Scattered single stones around the whole shoreline.
  for (let i = 0; i < 130; i++) {
    const x = rng.range(-15, 15);
    const z = rng.range(-14, 13);
    const sd = field.shoreDistance(x, z);
    if (sd < -0.9 || sd > 1.4) continue;
    addRock(x, z, rng.range(0.1, 0.3), rng.range(0.2, 0.45), false);
  }

  // The deep pool: a few large stones on the silt, the landmark you find by diving.
  const deep = LANDMARKS.deepCentre;
  const stones: Array<[number, number, number]> = [
    [deep.x - 0.9, deep.z + 0.8, 0.52],
    [deep.x + 1.25, deep.z - 0.55, 0.4],
    [deep.x + 0.4, deep.z + 1.9, 0.62],
    [deep.x - 2.0, deep.z - 0.7, 0.34],
    [deep.x + 2.4, deep.z + 0.9, 0.3],
  ];
  for (const [x, z, size] of stones) addRock(x, z, size, 0.3, true);
  for (let i = 0; i < 26; i++) {
    const a = rng.range(0, TAU);
    const d = rng.range(0.6, 4.2);
    const x = deep.x + Math.cos(a) * d;
    const z = deep.z + Math.sin(a) * d;
    if (field.depth(x, z) < 1.2) continue;
    addRock(x, z, rng.range(0.1, 0.26), 0.35, false);
  }

  protos.forEach((geo, k) => {
    const mesh = buildInstanced(geo, mat, lists[k], { castShadow: true, receiveShadow: true, name: `rocks${k}` });
    group.add(mesh);
  });

  // Gravel: small pebbles drifted into patches on the bed and the shallows.
  const pebbleGeo = rockGeometry(7, 1, 0.55);
  const pp = pebbleGeo.getAttribute('position');
  const puv = new Float32Array(pp.count * 2);
  for (let i = 0; i < pp.count; i++) {
    puv[i * 2] = pp.getX(i);
    puv[i * 2 + 1] = pp.getZ(i);
  }
  pebbleGeo.setAttribute('uv', new THREE.BufferAttribute(puv, 2));
  const pebbles: Placement[] = [];
  for (let z = -11; z <= 10.5; z += 0.2) {
    for (let x = -12.5; x <= 13.5; x += 0.2) {
      const px = x + rng.range(-0.1, 0.1);
      const pz = z + rng.range(-0.1, 0.1);
      const h = field.height(px, pz);
      if (h > 0.05) continue;
      const patch = fbm(px * 0.6, pz * 0.6, 3, 71);
      const want = smoothstep(0.52, 0.72, patch) * (h < -0.6 ? 0.55 : 0.3);
      if (rng.f() > want) continue;
      const size = rng.range(0.025, 0.07);
      pebbles.push({
        x: px,
        y: h + size * 0.2,
        z: pz,
        yaw: rng.range(0, TAU),
        scale: size,
        color: new THREE.Color().setHSL(rng.range(0.06, 0.14), rng.range(0.05, 0.25), rng.range(0.32, 0.62)),
      });
    }
  }
  shuffle(pebbles, rng);
  const pebbleMesh = buildInstanced(pebbleGeo, mat, pebbles, { receiveShadow: true, name: 'pebbles' });
  ctx.density.register(pebbleMesh);
  group.add(pebbleMesh);

  return group;
}

/** The half-submerged log in the willow shallows, with moss along its top. */
export function buildLog(ctx: WorldContext): THREE.Group {
  const group = new THREE.Group();
  group.name = 'log';
  const rng = new Rng(808);
  const { x, z, yaw, length, radius } = LANDMARKS.log;
  const dir = new THREE.Vector3(Math.cos(yaw), 0, Math.sin(yaw));
  // One end rests a little higher than the other so it reads as floating debris, not a pipe.
  const a = new THREE.Vector3(x, 0.035, z).addScaledVector(dir, -length / 2);
  const b = new THREE.Vector3(x, -0.07, z).addScaledVector(dir, length / 2);
  const mid = a.clone().lerp(b, 0.5).add(new THREE.Vector3(0, 0.02, 0));
  const curve = new THREE.CatmullRomCurve3([a, mid, b]);

  const bark = taperedTube(curve, 16, 14, (t) => radius * (1.08 - 0.22 * t + 0.05 * Math.sin(t * 17)), [2, 3]);
  // Knobbly bark, and moss wherever the surface faces the sky above the waterline.
  const pos = bark.getAttribute('position');
  const nrm = bark.getAttribute('normal');
  for (let i = 0; i < pos.count; i++) {
    const bump = (valueNoise(pos.getX(i) * 9, pos.getZ(i) * 9 + pos.getY(i) * 7, 3) - 0.5) * 0.03;
    pos.setXYZ(i, pos.getX(i) + nrm.getX(i) * bump, pos.getY(i) + nrm.getY(i) * bump, pos.getZ(i) + nrm.getZ(i) * bump);
  }
  bark.computeVertexNormals();
  paint(bark, (px, py, pz, i) => {
    const up = bark.getAttribute('normal').getY(i);
    const patch = fbm(px * 2.2, pz * 2.2, 2, 13);
    const moss = smoothstep(0.25, 0.75, up) * smoothstep(0.0, 0.06, py) * smoothstep(0.3, 0.55, patch + up * 0.25);
    return tmp.setRGB(0.5, 0.42, 0.33).lerp(new THREE.Color(0.2, 0.36, 0.07), moss);
  });
  const parts = [bark];
  // Sawn / broken end caps with a paler heartwood.
  for (const [end, t] of [[a, 0], [b, 1]] as Array<[THREE.Vector3, number]>) {
    const r = radius * (1.08 - 0.22 * t);
    const cap = new THREE.CircleGeometry(r * 0.98, 14);
    paint(cap, (cx, cy) => tmp.setRGB(0.62, 0.5, 0.34).multiplyScalar(0.7 + 0.3 * Math.hypot(cx, cy) / r));
    const q = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 0, 1),
      t === 0 ? dir.clone().negate() : dir.clone()
    );
    cap.applyQuaternion(q);
    cap.translate(end.x, end.y, end.z);
    parts.push(cap);
  }
  // Two snapped branch stubs.
  for (let i = 0; i < 2; i++) {
    const t = i === 0 ? 0.3 : 0.68;
    const base = curve.getPointAt(t);
    const out = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(i === 0 ? 1 : -1);
    const stub = taperedTube(
      new THREE.CatmullRomCurve3([
        base,
        base.clone().addScaledVector(out, 0.2).add(new THREE.Vector3(0, 0.16, 0)),
        base.clone().addScaledVector(out, 0.34).add(new THREE.Vector3(0, 0.36, 0)),
      ]),
      5,
      6,
      (s) => lerp(0.06, 0.03, s),
      [1, 1]
    );
    paint(stub, new THREE.Color(0.46, 0.38, 0.3));
    parts.push(stub);
    ctx.colliders.addCapsule(
      base.clone().addScaledVector(out, 0.1).add(new THREE.Vector3(0, 0.1, 0)),
      base.clone().addScaledVector(out, 0.34).add(new THREE.Vector3(0, 0.36, 0)),
      0.1
    );
  }

  const mat = applyPondShading(
    new THREE.MeshStandardMaterial({
      map: makeBarkTexture(21, [150, 130, 110]),
      vertexColors: true,
      roughness: 0.95,
    }),
    ctx.pond,
    { wetBand: true, key: 'log' }
  );
  const mesh = new THREE.Mesh(merge(parts), mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.name = 'logMesh';
  group.add(mesh);
  ctx.colliders.addCapsule(a, b, radius * 1.05);
  ctx.perches.push(curve.getPointAt(0.25).add(new THREE.Vector3(0, radius + 0.02, 0)));
  ctx.perches.push(curve.getPointAt(0.55).add(new THREE.Vector3(0, radius + 0.02, 0)));

  // Moss cushions sitting proud of the bark along the top.
  const tuftGeo = new THREE.IcosahedronGeometry(1, 1);
  const tufts: Placement[] = [];
  for (let i = 0; i < 46; i++) {
    const t = rng.range(0.04, 0.9);
    const p = curve.getPointAt(t);
    const side = rng.range(-0.55, 0.55);
    const r = radius * (1.08 - 0.22 * t);
    const y = p.y + Math.cos(side) * r;
    if (y < 0.05) continue;
    tufts.push({
      x: p.x - dir.z * Math.sin(side) * r,
      y: y - 0.012,
      z: p.z + dir.x * Math.sin(side) * r,
      yaw: rng.range(0, TAU),
      scale: rng.range(0.03, 0.075),
      scaleY: rng.range(0.4, 0.7),
      color: new THREE.Color().setHSL(rng.range(0.22, 0.3), rng.range(0.5, 0.75), rng.range(0.2, 0.36)),
    });
  }
  const tuftMat = new THREE.MeshStandardMaterial({ roughness: 1, color: 0xffffff });
  const tuftMesh = buildInstanced(tuftGeo, tuftMat, tufts, { castShadow: false, receiveShadow: true, name: 'logMoss' });
  group.add(tuftMesh);

  return group;
}

/** A waterlogged branch lying across the silt of the deep pool. */
export function buildSunkenBranch(ctx: WorldContext): THREE.Group {
  const group = new THREE.Group();
  group.name = 'sunkenBranch';
  const field = ctx.field;
  const deep = LANDMARKS.deepCentre;
  const rng = new Rng(66);
  const onBed = (x: number, z: number, lift: number) => new THREE.Vector3(x, field.height(x, z) + lift, z);

  const start = onBed(deep.x + 2.6, deep.z - 2.2, 0.1);
  const end = onBed(deep.x - 1.6, deep.z + 0.2, 0.22);
  const main = new THREE.CatmullRomCurve3([
    start,
    onBed(lerp(start.x, end.x, 0.35), lerp(start.z, end.z, 0.35) + 0.25, 0.2),
    onBed(lerp(start.x, end.x, 0.7), lerp(start.z, end.z, 0.7) - 0.2, 0.34),
    end.clone().add(new THREE.Vector3(0, 0.3, 0)),
  ]);
  const parts: THREE.BufferGeometry[] = [
    taperedTube(main, 18, 9, (t) => lerp(0.13, 0.045, t) * (1 + 0.08 * Math.sin(t * 23)), [1, 6]),
  ];
  ctx.colliders.addCapsule(main.getPointAt(0.05), main.getPointAt(0.5), 0.15);
  ctx.colliders.addCapsule(main.getPointAt(0.5), main.getPointAt(0.95), 0.11);

  // Side branches fork up off the bed and split again.
  for (let i = 0; i < 5; i++) {
    const t = lerp(0.25, 0.9, i / 4);
    const from = main.getPointAt(t);
    const tangent = main.getTangentAt(t);
    const sideSign = i % 2 === 0 ? 1 : -1;
    const out = new THREE.Vector3(-tangent.z, 0, tangent.x).multiplyScalar(sideSign);
    const len = rng.range(0.6, 1.25);
    const tip = from.clone().addScaledVector(out, len * 0.8).addScaledVector(tangent, len * 0.4);
    tip.y = Math.max(field.height(tip.x, tip.z) + 0.08, from.y + len * rng.range(0.25, 0.6));
    const midPt = from.clone().lerp(tip, 0.5).add(new THREE.Vector3(0, 0.08, 0));
    const twig = new THREE.CatmullRomCurve3([from, midPt, tip]);
    parts.push(taperedTube(twig, 8, 6, (s) => lerp(0.05, 0.014, s), [1, 3]));
    const fork = tip.clone().addScaledVector(out, 0.3).add(new THREE.Vector3(0, 0.22, rng.range(-0.2, 0.2)));
    parts.push(
      taperedTube(new THREE.CatmullRomCurve3([twig.getPointAt(0.6), twig.getPointAt(0.8).add(new THREE.Vector3(0, 0.08, 0)), fork]), 5, 5, (s) => lerp(0.022, 0.008, s), [1, 2])
    );
  }

  const mat = applyPondShading(
    new THREE.MeshStandardMaterial({
      map: makeBarkTexture(31, [128, 120, 96]),
      color: 0x9a9480,
      roughness: 1,
    }),
    ctx.pond,
    { key: 'branch' }
  );
  const mesh = new THREE.Mesh(merge(parts), mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.name = 'sunkenBranchMesh';
  group.add(mesh);
  return group;
}
