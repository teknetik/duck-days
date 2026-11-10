import * as THREE from 'three';
import { TAU, lerp, smoothstep, valueNoise } from '../core/math';
import { applyPondShading, type PondUniforms } from '../water/pondShading';
import { makeFeatherTexture } from '../world/textures';

/**
 * A stylised but recognisable mallard drake, built from shaped meshes.
 * Local frame: +z forward (bill), +y up, +x the duck's left. Units are metres
 * at life size; the whole model is scaled up a little so it reads from the
 * third-person camera. y = 0 is the waterline when floating at rest.
 */
export const DUCK_SCALE = 1.3;

interface Ring {
  z: number;
  y: number;
  w: number;
  top: number;
  bot: number;
}

type ColorFn = (z: number, angle: number, x: number, y: number, out: THREE.Color) => void;

/** Catmull-Rom through a list of scalars, clamped at the ends. */
function spline(values: number[], i: number, t: number): number {
  const p0 = values[Math.max(0, i - 1)];
  const p1 = values[i];
  const p2 = values[Math.min(values.length - 1, i + 1)];
  const p3 = values[Math.min(values.length - 1, i + 2)];
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

/** Inserts smoothly interpolated cross-sections so a handful of authored rings skin into a round form. */
function refineRings(rings: Ring[], subdiv: number): Ring[] {
  if (subdiv <= 1) return rings;
  const keys: Array<keyof Ring> = ['z', 'y', 'w', 'top', 'bot'];
  const cols = keys.map((k) => rings.map((r) => r[k]));
  const out: Ring[] = [];
  for (let i = 0; i < rings.length - 1; i++) {
    for (let s = 0; s < subdiv; s++) {
      const t = s / subdiv;
      const v = cols.map((c) => spline(c, i, t));
      out.push({ z: v[0], y: v[1], w: Math.max(0, v[2]), top: Math.max(0, v[3]), bot: Math.max(0, v[4]) });
    }
  }
  out.push(rings[rings.length - 1]);
  return out;
}

/** Skins a row of superellipse cross-sections (each in the XY plane) into a closed surface. */
function loft(
  authored: Ring[],
  radial: number,
  squareness: number,
  colorFn: ColorFn,
  uvRepeat: [number, number],
  subdiv = 3
): THREE.BufferGeometry {
  const rings = refineRings(authored, subdiv);
  const positions: number[] = [];
  const colors: number[] = [];
  const uvs: number[] = [];
  const index: number[] = [];
  const color = new THREE.Color();
  const exp = 2 / squareness;
  const zMin = rings[0].z;
  const zMax = rings[rings.length - 1].z;
  for (let i = 0; i < rings.length; i++) {
    const r = rings[i];
    for (let j = 0; j <= radial; j++) {
      // Seam along the belly, where nobody looks.
      const a = -Math.PI / 2 + (j / radial) * TAU;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const x = r.w * Math.sign(ca) * Math.pow(Math.abs(ca), exp);
      const y = r.y + (sa >= 0 ? r.top : r.bot) * Math.sign(sa) * Math.pow(Math.abs(sa), exp);
      positions.push(x, y, r.z);
      colorFn(r.z, a, x, y, color);
      colors.push(color.r, color.g, color.b);
      uvs.push((j / radial) * uvRepeat[0], ((r.z - zMin) / (zMax - zMin)) * uvRepeat[1]);
    }
  }
  const ring = radial + 1;
  for (let i = 0; i < rings.length - 1; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * ring + j;
      const b = a + 1;
      const c = a + ring;
      const d = c + 1;
      index.push(a, b, c, b, d, c);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(index);
  geo.computeVertexNormals();
  // Weld the shading across the seam.
  const n = geo.getAttribute('normal');
  for (let i = 0; i < rings.length; i++) {
    const a = i * ring;
    const b = a + radial;
    const nx = n.getX(a) + n.getX(b);
    const ny = n.getY(a) + n.getY(b);
    const nz = n.getZ(a) + n.getZ(b);
    const len = Math.hypot(nx, ny, nz) || 1;
    n.setXYZ(a, nx / len, ny / len, nz / len);
    n.setXYZ(b, nx / len, ny / len, nz / len);
  }
  return geo;
}

const srgb = (hex: number) => new THREE.Color(hex);
const CHESTNUT = srgb(0x6e3523);
const FLANK = srgb(0xbdbbb0);
const BACK = srgb(0x675d50);
const BELLY = srgb(0xcfccc0);
const RUMP = srgb(0x121214);
const TAIL_WHITE = srgb(0xe9e7dd);
const COVERT = srgb(0x8d8374);
const FLIGHT = srgb(0x3a352f);
const SPECULUM = srgb(0x2440c0);
const WHITE = srgb(0xf2f2ec);
const HEAD_GREEN = srgb(0x0b5a34);
const BILL = srgb(0xc9b233);
const BILL_NAIL = srgb(0x1b1a14);
const FOOT = srgb(0xea7318);

const BODY_RINGS: Ring[] = [
  { z: -0.215, y: 0.072, w: 0.0, top: 0.0, bot: 0.0 },
  { z: -0.198, y: 0.068, w: 0.022, top: 0.011, bot: 0.01 },
  { z: -0.165, y: 0.054, w: 0.05, top: 0.03, bot: 0.028 },
  { z: -0.115, y: 0.038, w: 0.074, top: 0.054, bot: 0.052 },
  { z: -0.055, y: 0.027, w: 0.088, top: 0.074, bot: 0.068 },
  { z: 0.005, y: 0.022, w: 0.093, top: 0.084, bot: 0.074 },
  { z: 0.065, y: 0.022, w: 0.089, top: 0.083, bot: 0.076 },
  { z: 0.115, y: 0.026, w: 0.078, top: 0.076, bot: 0.073 },
  { z: 0.158, y: 0.033, w: 0.063, top: 0.064, bot: 0.062 },
  { z: 0.188, y: 0.04, w: 0.043, top: 0.05, bot: 0.045 },
  { z: 0.204, y: 0.045, w: 0.022, top: 0.028, bot: 0.024 },
  { z: 0.21, y: 0.047, w: 0.0, top: 0.0, bot: 0.0 },
];

/** Half-width of the body at a given z, for seating wings and legs on its surface. */
function bodyWidthAt(z: number): number {
  for (let i = 0; i < BODY_RINGS.length - 1; i++) {
    const a = BODY_RINGS[i];
    const b = BODY_RINGS[i + 1];
    if (z >= a.z && z <= b.z) return lerp(a.w, b.w, (z - a.z) / (b.z - a.z));
  }
  return 0;
}

function bodyColor(z: number, angle: number, _x: number, _y: number, out: THREE.Color) {
  const up = Math.sin(angle);
  // Fine grey vermiculation on the flanks.
  const verm = 0.9 + 0.2 * valueNoise(z * 260, angle * 26, 5);
  out.copy(FLANK).multiplyScalar(verm);
  out.lerp(BELLY, smoothstep(-0.35, -0.85, up));
  out.lerp(BACK, smoothstep(0.45, 0.85, up));
  // Chestnut breast, wrapping further back along the waterline.
  out.lerp(CHESTNUT, smoothstep(0.075 - 0.03 * (1 - up), 0.115 - 0.03 * (1 - up), z));
  // Black rump and undertail, white tail tip.
  out.lerp(RUMP, smoothstep(-0.105, -0.14, z));
  out.lerp(TAIL_WHITE, smoothstep(-0.185, -0.2, z));
}

function buildWing(side: 1 | -1): THREE.BufferGeometry {
  const rings: Ring[] = [
    { z: -0.21, y: 0.07, w: 0.0, top: 0.0, bot: 0.0 },
    { z: -0.175, y: 0.066, w: 0.007, top: 0.018, bot: 0.012 },
    { z: -0.125, y: 0.06, w: 0.012, top: 0.033, bot: 0.026 },
    { z: -0.06, y: 0.06, w: 0.016, top: 0.044, bot: 0.04 },
    { z: 0.0, y: 0.061, w: 0.018, top: 0.047, bot: 0.046 },
    { z: 0.05, y: 0.06, w: 0.016, top: 0.043, bot: 0.04 },
    { z: 0.095, y: 0.054, w: 0.01, top: 0.026, bot: 0.022 },
    { z: 0.112, y: 0.052, w: 0.0, top: 0.0, bot: 0.0 },
  ];
  const geo = loft(
    rings,
    14,
    2.2,
    (z, angle, _x, y, out) => {
      const outer = Math.cos(angle) * side;
      out.copy(COVERT).multiplyScalar(0.9 + 0.2 * valueNoise(z * 120, y * 160, 9));
      // Dark flight feathers folded over the rump.
      out.lerp(FLIGHT, smoothstep(-0.085, -0.13, z));
      // The speculum: a blue-violet panel edged in white, on the outer lower half.
      const panel = smoothstep(0.0, 0.25, outer) * smoothstep(0.066, 0.05, y);
      const inBar = smoothstep(-0.105, -0.099, z) * smoothstep(-0.024, -0.03, z);
      const edge = smoothstep(-0.114, -0.108, z) * smoothstep(-0.015, -0.021, z);
      out.lerp(WHITE, edge * panel);
      out.lerp(SPECULUM, inBar * panel);
    },
    [1, 2]
  );
  // Seat the wing on the flank and lean its top edge in over the back.
  const pos = geo.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const z = pos.getZ(i);
    const y = pos.getY(i);
    const seat = bodyWidthAt(z) * 0.9;
    pos.setX(i, side * (seat - (y - 0.03) * 0.42) + pos.getX(i));
  }
  geo.computeVertexNormals();
  return geo;
}

function buildFoot(): THREE.BufferGeometry {
  // Webbed foot as a flat paddle hanging from the ankle (origin), toes toward -y.
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.lineTo(-0.008, -0.012);
  shape.lineTo(-0.032, -0.062);
  shape.quadraticCurveTo(-0.018, -0.056, -0.001, -0.074);
  shape.quadraticCurveTo(0.018, -0.056, 0.032, -0.062);
  shape.lineTo(0.008, -0.012);
  shape.lineTo(0, 0);
  const geo = new THREE.ShapeGeometry(shape, 4);
  return geo;
}

export interface DuckRig {
  root: THREE.Group;
  /** Pitch / roll of the whole body. */
  tilt: THREE.Group;
  /** Vertical bob and squash. */
  body: THREE.Group;
  neck: THREE.Group;
  head: THREE.Group;
  jaw: THREE.Group;
  tail: THREE.Group;
  wings: [THREE.Mesh, THREE.Mesh];
  hips: [THREE.Group, THREE.Group];
  ankles: [THREE.Group, THREE.Group];
  feet: [THREE.Mesh, THREE.Mesh];
  /** Rest height of the foot pivots, used to aim paddle splashes. */
  footRest: THREE.Vector3;
}

export function buildDuck(pond: PondUniforms): DuckRig {
  const feather = makeFeatherTexture();
  const plumage = applyPondShading(
    new THREE.MeshStandardMaterial({
      vertexColors: true,
      map: feather,
      bumpMap: feather,
      bumpScale: 0.9,
      roughness: 0.62,
      metalness: 0,
    }),
    pond,
    { key: 'duckPlumage' }
  );
  const headMat = applyPondShading(
    new THREE.MeshPhysicalMaterial({
      color: HEAD_GREEN,
      roughness: 0.46,
      metalness: 0.2,
      iridescence: 1,
      iridescenceIOR: 1.7,
      iridescenceThicknessRange: [220, 480],
      sheen: 0.6,
      sheenColor: new THREE.Color(0.1, 0.9, 0.45),
      sheenRoughness: 0.4,
    }),
    pond,
    { key: 'duckHead' }
  );
  const billMat = applyPondShading(
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42 }),
    pond,
    { key: 'duckBill' }
  );
  const footMat = applyPondShading(
    new THREE.MeshStandardMaterial({ color: FOOT, roughness: 0.6, side: THREE.DoubleSide }),
    pond,
    { key: 'duckFoot' }
  );
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 0.08, metalness: 0.2 });

  const root = new THREE.Group();
  root.name = 'duck';
  const model = new THREE.Group();
  model.scale.setScalar(DUCK_SCALE);
  root.add(model);
  const tilt = new THREE.Group();
  model.add(tilt);
  const body = new THREE.Group();
  tilt.add(body);

  const shadowed = <T extends THREE.Mesh>(mesh: T, name: string): T => {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = name;
    return mesh;
  };

  // --- Body --------------------------------------------------------------------------
  const bodyMesh = shadowed(new THREE.Mesh(loft(BODY_RINGS, 28, 2.25, bodyColor, [3, 2.5]), plumage), 'duckBody');
  body.add(bodyMesh);

  const wingL = shadowed(new THREE.Mesh(buildWing(1), plumage), 'duckWingL');
  const wingR = shadowed(new THREE.Mesh(buildWing(-1), plumage), 'duckWingR');
  body.add(wingL, wingR);

  // --- Tail: a fan of pale feathers, plus the drake's two curled black ones -----------
  const tail = new THREE.Group();
  tail.position.set(0, 0.066, -0.185);
  body.add(tail);
  const tailParts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 5; i++) {
    const spread = (i - 2) * 0.3;
    const f = new THREE.PlaneGeometry(0.034, 0.05, 1, 2);
    f.translate(0, -0.025, 0);
    const fp = f.getAttribute('position');
    const colors: number[] = [];
    for (let k = 0; k < fp.count; k++) {
      const t = -fp.getY(k) / 0.05;
      fp.setX(k, fp.getX(k) * (1 - 0.55 * t));
      const c = TAIL_WHITE.clone().lerp(FLANK, 0.5 * (1 - t));
      colors.push(c.r, c.g, c.b);
    }
    f.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    // Lay the feather back along -z, tipped up a little, then fan it.
    f.rotateX(Math.PI / 2 + 0.22);
    f.rotateY(spread);
    f.translate(0, -Math.abs(i - 2) * 0.004, 0);
    tailParts.push(f);
  }
  const tailGeo = mergeSimple(tailParts);
  tailGeo.computeVertexNormals();
  const tailMat = applyPondShading(
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, side: THREE.DoubleSide }),
    pond,
    { key: 'duckTail' }
  );
  tail.add(shadowed(new THREE.Mesh(tailGeo, tailMat), 'duckTailFan'));
  const curlMat = new THREE.MeshStandardMaterial({ color: RUMP, roughness: 0.35 });
  for (const s of [-1, 1]) {
    const curl = new THREE.Mesh(new THREE.TorusGeometry(0.014, 0.0038, 5, 10, Math.PI * 1.25), curlMat);
    curl.rotation.set(0, Math.PI / 2 + s * 0.25, 0);
    curl.position.set(s * 0.006, 0.02, 0.018);
    curl.castShadow = true;
    tail.add(curl);
  }

  // --- Neck and head -------------------------------------------------------------------
  const neck = new THREE.Group();
  neck.position.set(0, 0.074, 0.128);
  body.add(neck);
  const NECK_LEN = 0.082;
  const neckRadius = (t: number) => lerp(0.045, 0.0262, Math.pow(t, 0.7));
  const neckSection = (from: number, to: number, steps: number): Ring[] => {
    const rings: Ring[] = [];
    for (let i = 0; i <= steps; i++) {
      const t = lerp(from, to, i / steps);
      const r = neckRadius(t);
      rings.push({ z: t * NECK_LEN, y: 0, w: r, top: r, bot: r });
    }
    return rings;
  };
  // Lower neck: chestnut rising out of the breast, finished with the narrow white collar.
  const COLLAR = 0.5;
  const lowerNeck = loft(
    neckSection(0, COLLAR, 5),
    18,
    2,
    (z, _a, _x, _y, out) => {
      const t = z / NECK_LEN;
      out.copy(CHESTNUT).lerp(WHITE, smoothstep(COLLAR - 0.14, COLLAR - 0.09, t));
    },
    [2, 0.4],
    2
  );
  // Upper neck: part of the glossy green head.
  const upperNeck = loft(neckSection(COLLAR, 1.06, 5), 18, 2, (_z, _a, _x, _y, out) => out.setRGB(1, 1, 1), [1, 1], 2);
  // The lofts run along +z; stand them up so the neck rises from the breast.
  lowerNeck.rotateX(-Math.PI / 2);
  upperNeck.rotateX(-Math.PI / 2);
  neck.add(shadowed(new THREE.Mesh(lowerNeck, plumage), 'duckNeck'));
  neck.add(shadowed(new THREE.Mesh(upperNeck, headMat), 'duckNeckUpper'));
  neck.rotation.x = 0.32;

  const head = new THREE.Group();
  head.position.set(0, NECK_LEN + 0.016, 0.006);
  head.rotation.x = -0.3;
  neck.add(head);
  // Rounded crown, full cheeks, and a forehead that slopes down into the bill.
  const headRings: Ring[] = [
    { z: -0.043, y: 0.004, w: 0.0, top: 0.0, bot: 0.0 },
    { z: -0.039, y: 0.004, w: 0.013, top: 0.014, bot: 0.013 },
    { z: -0.028, y: 0.005, w: 0.0235, top: 0.026, bot: 0.024 },
    { z: -0.01, y: 0.006, w: 0.0298, top: 0.0335, bot: 0.03 },
    { z: 0.004, y: 0.005, w: 0.0305, top: 0.0315, bot: 0.031 },
    { z: 0.019, y: 0.002, w: 0.0275, top: 0.029, bot: 0.029 },
    { z: 0.031, y: -0.003, w: 0.021, top: 0.021, bot: 0.023 },
    { z: 0.04, y: -0.007, w: 0.0145, top: 0.014, bot: 0.016 },
    { z: 0.046, y: -0.009, w: 0.0, top: 0.0, bot: 0.0 },
  ];
  const headGeo = loft(headRings, 22, 2, (_z, _a, _x, _y, out) => out.setRGB(1, 1, 1), [1, 1], 3);
  head.add(shadowed(new THREE.Mesh(headGeo, headMat), 'duckHead'));

  for (const s of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.0052, 10, 8), eyeMat);
    eye.position.set(s * 0.0262, 0.011, 0.018);
    head.add(eye);
  }

  const billColor: ColorFn = (z, _a, _x, _y, out) => {
    out.copy(BILL).lerp(BILL_NAIL, smoothstep(0.092, 0.099, z));
  };
  const upperBill = loft(
    [
      { z: 0.028, y: -0.0045, w: 0.0128, top: 0.0125, bot: 0.006 },
      { z: 0.048, y: -0.0105, w: 0.0122, top: 0.008, bot: 0.003 },
      { z: 0.068, y: -0.0145, w: 0.0132, top: 0.0058, bot: 0.003 },
      { z: 0.086, y: -0.0172, w: 0.0138, top: 0.0048, bot: 0.003 },
      { z: 0.097, y: -0.0182, w: 0.0108, top: 0.004, bot: 0.003 },
      { z: 0.102, y: -0.0186, w: 0.0, top: 0.0, bot: 0.0 },
    ],
    12,
    2.6,
    billColor,
    [1, 1]
  );
  head.add(shadowed(new THREE.Mesh(upperBill, billMat), 'duckBillUpper'));
  for (const s of [-1, 1]) {
    const nostril = new THREE.Mesh(new THREE.SphereGeometry(0.0016, 6, 4), eyeMat);
    nostril.position.set(s * 0.0052, -0.0035, 0.05);
    nostril.scale.set(1, 0.6, 2.2);
    head.add(nostril);
  }
  const jaw = new THREE.Group();
  jaw.position.set(0, -0.0145, 0.03);
  head.add(jaw);
  const lowerBill = loft(
    [
      { z: 0.0, y: 0.0, w: 0.0105, top: 0.002, bot: 0.005 },
      { z: 0.02, y: -0.002, w: 0.011, top: 0.002, bot: 0.004 },
      { z: 0.045, y: -0.0052, w: 0.0118, top: 0.0018, bot: 0.0032 },
      { z: 0.062, y: -0.0068, w: 0.0095, top: 0.0016, bot: 0.0028 },
      { z: 0.067, y: -0.007, w: 0.0, top: 0.0, bot: 0.0 },
    ],
    10,
    2.6,
    (_z, _a, _x, _y, out) => out.copy(BILL).multiplyScalar(0.8),
    [1, 1]
  );
  jaw.add(shadowed(new THREE.Mesh(lowerBill, billMat), 'duckBillLower'));

  // --- Legs and webbed feet -------------------------------------------------------------
  const footGeo = buildFoot();
  const legGeo = new THREE.CylinderGeometry(0.0048, 0.0058, 0.05, 6, 1);
  legGeo.translate(0, -0.025, 0);
  const hips: THREE.Group[] = [];
  const ankles: THREE.Group[] = [];
  const feet: THREE.Mesh[] = [];
  const footRest = new THREE.Vector3(0.05, -0.05, -0.06);
  for (const s of [1, -1]) {
    const hip = new THREE.Group();
    hip.position.set(s * footRest.x, footRest.y, footRest.z);
    body.add(hip);
    hip.add(shadowed(new THREE.Mesh(legGeo, footMat), s === 1 ? 'duckLegL' : 'duckLegR'));
    const ankle = new THREE.Group();
    ankle.position.set(0, -0.05, 0);
    hip.add(ankle);
    const foot = shadowed(new THREE.Mesh(footGeo, footMat), s === 1 ? 'duckFootL' : 'duckFootR');
    ankle.add(foot);
    hips.push(hip);
    ankles.push(ankle);
    feet.push(foot);
  }

  return {
    root,
    tilt,
    body,
    neck,
    head,
    jaw,
    tail,
    wings: [wingL, wingR],
    hips: [hips[0], hips[1]],
    ankles: [ankles[0], ankles[1]],
    feet: [feet[0], feet[1]],
    footRest,
  };
}

/** Concatenates non-indexed-compatible plane geometries (position / color / uv). */
function mergeSimple(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const positions: number[] = [];
  const colors: number[] = [];
  const index: number[] = [];
  let offset = 0;
  for (const g of parts) {
    const p = g.getAttribute('position');
    const c = g.getAttribute('color');
    for (let i = 0; i < p.count; i++) {
      positions.push(p.getX(i), p.getY(i), p.getZ(i));
      colors.push(c.getX(i), c.getY(i), c.getZ(i));
    }
    const idx = g.index!;
    for (let i = 0; i < idx.count; i++) index.push(idx.getX(i) + offset);
    offset += p.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  out.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  out.setIndex(index);
  return out;
}
