import * as THREE from 'three';
import { Rng, TAU, fbm, lerp, smoothstep } from '../core/math';
import { applyPondShading } from '../water/pondShading';
import { bladeStrip } from './geometry';
import { buildInstanced, merge, paint, place, shuffle, type Placement } from './instancing';
import { LANDMARKS } from './PondLayout';
import { makeFernTexture } from './textures';
import type { WorldContext } from './WorldContext';

const c0 = new THREE.Color();
const c1 = new THREE.Color();
const tmp = new THREE.Color();

/** Paints a blade root-to-tip using its UV.y, with a little per-blade variation. */
function gradient(
  geo: THREE.BufferGeometry,
  root: [number, number, number],
  tip: [number, number, number],
  variation: number
): THREE.BufferGeometry {
  const uv = geo.getAttribute('uv');
  c0.setRGB(root[0], root[1], root[2]);
  c1.setRGB(tip[0], tip[1], tip[2]);
  return paint(geo, (_x, _y, _z, i) => tmp.copy(c0).lerp(c1, Math.pow(uv.getY(i), 0.8)).multiplyScalar(variation));
}

function reedClump(rng: Rng): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const matrix = new THREE.Matrix4();
  const tipPos = new THREE.Vector3();
  for (let b = 0; b < 8; b++) {
    const height = rng.range(1.25, 2.15);
    const bend = rng.range(0.08, 0.5);
    const blade = gradient(
      bladeStrip({ height, width: rng.range(0.028, 0.042), segments: 5, bend, tipWidth: 0.1, crease: 0.35 }),
      [0.1, 0.17, 0.04],
      [0.5, 0.5, 0.16],
      rng.range(0.8, 1.15)
    );
    const pos: [number, number, number] = [rng.range(-0.17, 0.17), 0, rng.range(-0.17, 0.17)];
    const rot: [number, number, number] = [rng.range(0.02, 0.16), rng.range(0, TAU), 0];
    parts.push(place(blade, pos, rot));
    if (b % 3 === 0) {
      // Feathery seed plume nodding from the tip.
      const plume = gradient(
        bladeStrip({ height: rng.range(0.2, 0.3), width: 0.07, segments: 3, bend: 0.12, tipWidth: 0.25, crease: 0.5 }),
        [0.32, 0.22, 0.2],
        [0.5, 0.38, 0.3],
        rng.range(0.85, 1.1)
      );
      matrix.compose(
        new THREE.Vector3(...pos),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(rot[0], rot[1], rot[2], 'YXZ')),
        new THREE.Vector3(1, 1, 1)
      );
      tipPos.set(0, height * 0.98, bend * 0.96).applyMatrix4(matrix);
      parts.push(place(plume, [tipPos.x, tipPos.y, tipPos.z], [rot[0] + 0.5, rot[1], 0]));
    }
  }
  return merge(parts);
}

function cattailClump(rng: Rng): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (let b = 0; b < 7; b++) {
    const blade = gradient(
      bladeStrip({ height: rng.range(1.0, 1.6), width: rng.range(0.026, 0.036), segments: 4, bend: rng.range(0.03, 0.22), tipWidth: 0.12, crease: 0.2 }),
      [0.1, 0.2, 0.08],
      [0.33, 0.45, 0.17],
      rng.range(0.85, 1.12)
    );
    parts.push(place(blade, [rng.range(-0.1, 0.1), 0, rng.range(-0.1, 0.1)], [rng.range(0.01, 0.1), rng.range(0, TAU), 0]));
  }
  const stalks = rng.int(2, 3);
  for (let s = 0; s < stalks; s++) {
    const h = rng.range(1.25, 1.7);
    const x = rng.range(-0.07, 0.07);
    const z = rng.range(-0.07, 0.07);
    const stalk = paint(new THREE.CylinderGeometry(0.006, 0.008, h, 5, 1), new THREE.Color(0.3, 0.4, 0.14));
    parts.push(place(stalk, [x, h / 2, z]));
    const head = paint(new THREE.CylinderGeometry(0.021, 0.021, 0.17, 8, 1), new THREE.Color(0.17, 0.085, 0.03));
    parts.push(place(head, [x, h - 0.02, z]));
    const cap = paint(new THREE.SphereGeometry(0.021, 8, 4), new THREE.Color(0.17, 0.085, 0.03));
    parts.push(place(cap, [x, h + 0.065, z], [0, 0, 0], [1, 0.6, 1]));
    const spike = paint(new THREE.CylinderGeometry(0.002, 0.006, 0.12, 4, 1), new THREE.Color(0.36, 0.32, 0.14));
    parts.push(place(spike, [x, h + 0.13, z]));
  }
  return merge(parts);
}

function grassTuft(rng: Rng): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (let b = 0; b < 9; b++) {
    const blade = gradient(
      bladeStrip({ height: rng.range(0.2, 0.62), width: rng.range(0.018, 0.03), segments: 2, bend: rng.range(0.05, 0.3), tipWidth: 0.05, crease: 0.4 }),
      [0.09, 0.17, 0.03],
      [0.4, 0.5, 0.13],
      rng.range(0.8, 1.15)
    );
    parts.push(place(blade, [rng.range(-0.1, 0.1), 0, rng.range(-0.1, 0.1)], [rng.range(0.05, 0.4), rng.range(0, TAU), 0]));
  }
  return merge(parts);
}

function buttercupClump(rng: Rng): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const petal = new THREE.Color(1.0, 0.72, 0.03);
  for (let s = 0; s < 6; s++) {
    const h = rng.range(0.18, 0.42);
    const x = rng.range(-0.14, 0.14);
    const z = rng.range(-0.14, 0.14);
    const yaw = rng.range(0, TAU);
    const stem = gradient(
      bladeStrip({ height: h, width: 0.008, segments: 2, bend: rng.range(0, 0.06), tipWidth: 0.8 }),
      [0.12, 0.24, 0.05],
      [0.3, 0.42, 0.1],
      1
    );
    parts.push(place(stem, [x, 0, z], [0.04, yaw, 0]));
    // Five-petalled cup, opening upward.
    const cup = paint(new THREE.ConeGeometry(0.024, 0.014, 5, 1, true), petal);
    parts.push(place(cup, [x, h + 0.004, z], [Math.PI, yaw, 0]));
    const eye = paint(new THREE.SphereGeometry(0.007, 5, 4), new THREE.Color(0.95, 0.55, 0.02));
    parts.push(place(eye, [x, h + 0.004, z]));
  }
  for (let l = 0; l < 5; l++) {
    const leaf = gradient(
      bladeStrip({ height: rng.range(0.08, 0.14), width: 0.05, segments: 2, bend: 0.06, tipWidth: 0.3 }),
      [0.1, 0.2, 0.04],
      [0.26, 0.4, 0.1],
      rng.range(0.85, 1.1)
    );
    parts.push(place(leaf, [rng.range(-0.1, 0.1), 0, rng.range(-0.1, 0.1)], [0.8, rng.range(0, TAU), 0]));
  }
  return merge(parts);
}

function loosestrifeClump(rng: Rng): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (let s = 0; s < 4; s++) {
    const h = rng.range(0.6, 1.05);
    const x = rng.range(-0.12, 0.12);
    const z = rng.range(-0.12, 0.12);
    const yaw = rng.range(0, TAU);
    const leanX = rng.range(0.0, 0.12);
    const stem = paint(new THREE.CylinderGeometry(0.005, 0.008, h, 5, 1), new THREE.Color(0.22, 0.32, 0.1));
    parts.push(place(place(stem, [0, h / 2, 0]), [x, 0, z], [leanX, yaw, 0]));
    // Flower spike: a knobbly taper of magenta whorls on the top third.
    const spikeLen = h * rng.range(0.36, 0.5);
    const spike = new THREE.ConeGeometry(0.034, spikeLen, 7, 6);
    const sp = spike.getAttribute('position');
    for (let i = 0; i < sp.count; i++) {
      const k = 1 + 0.35 * Math.sin(sp.getY(i) * 95 + i);
      sp.setX(i, sp.getX(i) * k);
      sp.setZ(i, sp.getZ(i) * k);
    }
    spike.computeVertexNormals();
    paint(spike, (_x, y, _z, i) =>
      tmp.setRGB(0.5, 0.09, 0.44).lerp(c1.setRGB(0.72, 0.26, 0.66), (Math.sin(y * 70 + i) + 1) / 2)
    );
    parts.push(place(place(spike, [0, h + spikeLen * 0.42, 0]), [x, 0, z], [leanX, yaw, 0]));
    for (let l = 0; l < 4; l++) {
      const leaf = gradient(
        bladeStrip({ height: 0.11, width: 0.03, segments: 2, bend: 0.03, tipWidth: 0.2 }),
        [0.14, 0.26, 0.07],
        [0.3, 0.42, 0.12],
        1
      );
      const y = h * lerp(0.2, 0.62, l / 3);
      parts.push(place(place(leaf, [0, y, 0], [1.0, l * 1.7, 0]), [x, 0, z], [leanX, yaw, 0]));
    }
  }
  return merge(parts);
}

/** Unit-height clump of ribbon weed; instances are stretched to fit the water depth. */
function pondweedClump(rng: Rng): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (let b = 0; b < 7; b++) {
    const blade = gradient(
      bladeStrip({ height: rng.range(0.55, 1), width: rng.range(0.018, 0.03), segments: 7, bend: rng.range(-0.1, 0.1), tipWidth: 0.35, crease: 0.15 }),
      [0.12, 0.24, 0.06],
      [0.4, 0.55, 0.16],
      rng.range(0.8, 1.15)
    );
    parts.push(place(blade, [rng.range(-0.14, 0.14), 0, rng.range(-0.14, 0.14)], [rng.range(-0.12, 0.12), rng.range(0, TAU), 0]));
  }
  return merge(parts);
}

function fernPlant(rng: Rng): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const fronds = 8;
  for (let f = 0; f < fronds; f++) {
    const len = rng.range(0.55, 0.85);
    const frond = new THREE.PlaneGeometry(len * 0.36, len, 1, 5);
    frond.translate(0, len / 2, 0);
    const pos = frond.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      const t = pos.getY(i) / len;
      // Arch outward and droop at the tip.
      pos.setZ(i, t * t * len * 0.55);
      pos.setY(i, pos.getY(i) * (1 - 0.28 * t));
    }
    frond.computeVertexNormals();
    const shade = rng.range(0.8, 1.1);
    paint(frond, new THREE.Color(shade, shade, shade));
    parts.push(place(frond, [0, 0, 0], [rng.range(0.25, 0.75), (f / fronds) * TAU + rng.range(-0.3, 0.3), 0]));
  }
  return merge(parts);
}

function bladeMaterial(ctx: WorldContext, wind: { amplitude: number; height: number; speed?: number; underwater?: boolean }, underwater: boolean) {
  return applyPondShading(
    new THREE.MeshLambertMaterial({
      vertexColors: true,
      side: THREE.DoubleSide,
    }),
    ctx.pond,
    { underwater, wind, nearFade: true }
  );
}

/**
 * Marginal and bank planting. Everything is placed from the terrain's
 * shore-distance field plus low-frequency patch noise, so plants gather in
 * drifts where the ground is wet rather than being sprinkled evenly.
 */
export function buildVegetation(ctx: WorldContext): THREE.Group {
  const group = new THREE.Group();
  group.name = 'vegetation';
  const rng = new Rng(9001);
  const field = ctx.field;

  const reedProtos = [reedClump(new Rng(1)), reedClump(new Rng(2))];
  const cattailProto = cattailClump(new Rng(3));
  const grassProtos = [grassTuft(new Rng(4)), grassTuft(new Rng(5))];
  const buttercupProto = buttercupClump(new Rng(6));
  const loosestrifeProto = loosestrifeClump(new Rng(7));
  const weedProto = pondweedClump(new Rng(8));
  const fernProto = fernPlant(new Rng(10));

  const reedMat = bladeMaterial(ctx, { amplitude: 0.17, height: 1.8, speed: 1.1 }, true);
  const grassMat = bladeMaterial(ctx, { amplitude: 0.06, height: 0.5, speed: 1.4 }, false);
  const flowerMat = bladeMaterial(ctx, { amplitude: 0.05, height: 0.5, speed: 1.3 }, false);
  const tallFlowerMat = bladeMaterial(ctx, { amplitude: 0.1, height: 1.0, speed: 1.2 }, true);
  const weedMat = bladeMaterial(ctx, { amplitude: 0.16, height: 1, speed: 0.75, underwater: true }, true);
  const fernMat = applyPondShading(
    new THREE.MeshLambertMaterial({
      map: makeFernTexture(),
      alphaTest: 0.4,
      side: THREE.DoubleSide,
      vertexColors: true,
    }),
    ctx.pond,
    { underwater: false, nearFade: true, wind: { amplitude: 0.04, height: 0.6, speed: 1.2 }, key: 'fern' }
  );

  const reeds: Placement[][] = [[], []];
  const cattails: Placement[] = [];
  const grass: Placement[][] = [[], []];
  const buttercups: Placement[] = [];
  const loosestrife: Placement[] = [];
  const weeds: Placement[] = [];
  const ferns: Placement[] = [];
  const normal = new THREE.Vector3();

  const willow = LANDMARKS.willowBase;
  const log = LANDMARKS.log;

  // --- Waterline band: reeds, cattails, loosestrife -------------------------------
  const step = 0.3;
  for (let z = -15; z <= 15; z += step) {
    for (let x = -15.5; x <= 15.5; x += step) {
      const px = x + rng.range(-0.14, 0.14);
      const pz = z + rng.range(-0.14, 0.14);
      const sd = field.shoreDistance(px, pz);
      if (sd < -1.9 || sd > 1.6) continue;
      const h = field.height(px, pz);
      const patch = fbm(px * 0.16, pz * 0.16, 3, 501);
      const patch2 = fbm(px * 0.21 + 40, pz * 0.21, 3, 502);
      // The lily cove keeps a clear, low grassy edge; reeds thin out there.
      const cove = Math.exp(-((px - 9.5) ** 2 + (pz + 6.5) ** 2) / 26);
      // Keep the channel into the willow shallows and the log itself clear.
      const nearLog = Math.hypot(px - log.x, pz - log.z) < 2.1;

      if (sd > -1.7 && sd < 0.45 && !nearLog) {
        const want = smoothstep(0.42, 0.56, patch) * (1 - cove * 0.85);
        if (rng.f() < want * 0.82) {
          const k = rng.f() < 0.5 ? 0 : 1;
          reeds[k].push({
            x: px,
            y: h - 0.04,
            z: pz,
            yaw: rng.range(0, TAU),
            scale: rng.range(0.78, 1.18),
            scaleY: rng.range(0.85, 1.2),
            color: new THREE.Color().setHSL(rng.range(0.17, 0.25), 0.25, rng.range(0.72, 0.95)),
          });
          if (reeds[0].length % 45 === 0) ctx.reedBeds.push(new THREE.Vector3(px, 0.8, pz));
          continue;
        }
      }
      if (sd > -0.95 && sd < 0.3 && !nearLog) {
        const want = smoothstep(0.55, 0.66, patch2) * (1 - cove * 0.6);
        if (rng.f() < want * 0.5) {
          cattails.push({
            x: px,
            y: h - 0.03,
            z: pz,
            yaw: rng.range(0, TAU),
            scale: rng.range(0.85, 1.2),
            scaleY: rng.range(0.9, 1.15),
          });
          continue;
        }
      }
      if (sd > 0.02 && sd < 1.5) {
        const patch3 = fbm(px * 0.3 + 90, pz * 0.3 + 15, 2, 503);
        if (patch3 > 0.6 && rng.f() < 0.2) {
          loosestrife.push({
            x: px,
            y: h - 0.02,
            z: pz,
            yaw: rng.range(0, TAU),
            scale: rng.range(0.85, 1.25),
          });
        }
      }
    }
  }

  // --- Banks: grass everywhere, buttercups in sunny drifts, ferns in the willow's shade ----
  const bankStep = 0.36;
  for (let z = -24; z <= 22; z += bankStep) {
    for (let x = -26; x <= 26; x += bankStep) {
      const px = x + rng.range(-0.17, 0.17);
      const pz = z + rng.range(-0.17, 0.17);
      const sd = field.shoreDistance(px, pz);
      if (sd < 0.06 || sd > 12) continue;
      const h = field.height(px, pz);
      // Dense at the water's edge, thinning into the woodland floor.
      const keep = lerp(0.95, 0.12, smoothstep(0.5, 9, sd)) * lerp(0.6, 1.2, fbm(px * 0.25, pz * 0.25, 2, 601));
      if (rng.f() < keep) {
        field.normal(px, pz, normal);
        const k = rng.f() < 0.5 ? 0 : 1;
        grass[k].push({
          x: px,
          y: h - 0.02,
          z: pz,
          yaw: rng.range(0, TAU),
          scale: rng.range(0.75, 1.5) * lerp(1.15, 0.8, smoothstep(0.5, 6, sd)),
          tiltX: normal.z * 0.6,
          tiltZ: -normal.x * 0.6,
          color: new THREE.Color().setHSL(rng.range(0.16, 0.27), rng.range(0.2, 0.45), rng.range(0.68, 0.95)),
        });
      }
      if (sd > 0.25 && sd < 4.5) {
        const drift = fbm(px * 0.22 + 7, pz * 0.22 + 60, 3, 602);
        if (drift > 0.6 && rng.f() < 0.36) {
          buttercups.push({ x: px, y: h - 0.01, z: pz, yaw: rng.range(0, TAU), scale: rng.range(0.8, 1.35) });
        }
      }
      const toWillow = Math.hypot(px - willow.x, pz - willow.z);
      const shade = Math.max(Math.exp(-(toWillow * toWillow) / 60), smoothstep(5.5, 9, sd) * 0.5);
      if (sd > 0.35 && sd < 10 && rng.f() < shade * 0.085) {
        ferns.push({
          x: px,
          y: h - 0.02,
          z: pz,
          yaw: rng.range(0, TAU),
          scale: rng.range(0.8, 1.45),
          color: new THREE.Color().setHSL(0.27, 0.2, rng.range(0.75, 0.98)),
        });
      }
    }
  }

  // --- Pondweed: beds on the deeper floor ------------------------------------------------
  for (let z = -11; z <= 10; z += 0.42) {
    for (let x = -12; x <= 13.5; x += 0.42) {
      const px = x + rng.range(-0.2, 0.2);
      const pz = z + rng.range(-0.2, 0.2);
      const depth = field.depth(px, pz);
      if (depth < 0.55) continue;
      const bed = fbm(px * 0.3 + 5, pz * 0.3 + 33, 3, 701);
      if (bed < 0.52 || rng.f() > smoothstep(0.52, 0.66, bed) * 0.55) continue;
      const tall = Math.min(depth * rng.range(0.45, 0.8), 1.7);
      weeds.push({
        x: px,
        y: -depth - 0.03,
        z: pz,
        yaw: rng.range(0, TAU),
        scale: rng.range(0.8, 1.3),
        scaleY: tall / 1.0,
        color: new THREE.Color().setHSL(rng.range(0.2, 0.3), 0.3, rng.range(0.7, 0.95)),
      });
    }
  }

  const add = (
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    list: Placement[],
    name: string,
    castShadow: boolean
  ) => {
    if (list.length === 0) return;
    shuffle(list, rng);
    // scaleY in a placement multiplies the uniform scale; undo that for the weed's absolute heights.
    const mesh = buildInstanced(geo, mat, list, { castShadow, receiveShadow: true, name });
    ctx.density.register(mesh);
    group.add(mesh);
  };

  add(reedProtos[0], reedMat, reeds[0], 'reedsA', true);
  add(reedProtos[1], reedMat, reeds[1], 'reedsB', true);
  add(cattailProto, reedMat, cattails, 'cattails', true);
  add(grassProtos[0], grassMat, grass[0], 'grassA', false);
  add(grassProtos[1], grassMat, grass[1], 'grassB', false);
  add(buttercupProto, flowerMat, buttercups, 'buttercups', false);
  add(loosestrifeProto, tallFlowerMat, loosestrife, 'loosestrife', true);
  add(weedProto, weedMat, weeds.map((w) => ({ ...w, scaleY: (w.scaleY ?? 1) / w.scale })), 'pondweed', false);
  add(fernProto, fernMat, ferns, 'ferns', false);

  return group;
}
