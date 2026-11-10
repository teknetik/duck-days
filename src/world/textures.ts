import * as THREE from 'three';
import { Rng, TAU, lerp } from '../core/math';

/**
 * Every texture in Duck Days is painted here at start-up, so there are no
 * image downloads and nothing to license.
 */

function canvas(size: number, height = size): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = height;
  const ctx = c.getContext('2d')!;
  return [c, ctx];
}

function finish(c: HTMLCanvasElement, opts: { repeat?: boolean; srgb?: boolean; aniso?: number } = {}) {
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = opts.srgb === false ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  if (opts.repeat) tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = opts.aniso ?? 4;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.needsUpdate = true;
  return tex;
}

/** Tileable value noise on a `period`-cell lattice. */
function periodicNoise(x: number, y: number, period: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const h = (px: number, py: number) => {
    const a = ((px % period) + period) % period;
    const b = ((py % period) + period) % period;
    let n = Math.imul(a + 1, 374761393) ^ Math.imul(b + 1, 668265263) ^ Math.imul(seed + 1, 2147483647);
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  };
  return lerp(lerp(h(ix, iy), h(ix + 1, iy), ux), lerp(h(ix, iy + 1), h(ix + 1, iy + 1), ux), uy);
}

function periodicFbm(u: number, v: number, base: number, octaves: number, seed: number): number {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  let period = base;
  for (let o = 0; o < octaves; o++) {
    sum += amp * periodicNoise(u * period, v * period, period, seed + o * 13);
    norm += amp;
    amp *= 0.55;
    period *= 2;
  }
  return sum / norm;
}

/**
 * Breeze detail for the water: RG = surface slope (0.5 = flat), B = a smooth
 * low-frequency field used for gust patches. Linear data, tiled, mip-mapped.
 */
export function makeRippleTexture(): THREE.DataTexture {
  const size = 256;
  const height = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      height[y * size + x] = periodicFbm(x / size, y / size, 5, 5, 3);
    }
  }
  const data = new Uint8Array(size * size * 4);
  let maxSlope = 1e-6;
  const slopes = new Float32Array(size * size * 2);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const xl = height[y * size + ((x + size - 1) % size)];
      const xr = height[y * size + ((x + 1) % size)];
      const yu = height[((y + size - 1) % size) * size + x];
      const yd = height[((y + 1) % size) * size + x];
      const sx = xl - xr;
      const sy = yu - yd;
      slopes[(y * size + x) * 2] = sx;
      slopes[(y * size + x) * 2 + 1] = sy;
      maxSlope = Math.max(maxSlope, Math.abs(sx), Math.abs(sy));
    }
  }
  for (let i = 0; i < size * size; i++) {
    const y = Math.floor(i / size);
    const x = i % size;
    data[i * 4] = Math.round((0.5 + (0.5 * slopes[i * 2]) / maxSlope) * 255);
    data[i * 4 + 1] = Math.round((0.5 + (0.5 * slopes[i * 2 + 1]) / maxSlope) * 255);
    data[i * 4 + 2] = Math.round(periodicFbm(x / size, y / size, 3, 3, 91) * 255);
    data[i * 4 + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/** Fine organic grain multiplied over the ground's vertex colours. */
export function makeGroundDetailTexture(): THREE.Texture {
  const size = 256;
  const [c, ctx] = canvas(size);
  const img = ctx.createImageData(size, size);
  const rng = new Rng(42);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const n = periodicFbm(x / size, y / size, 8, 4, 5);
      const fine = periodicNoise((x / size) * 64, (y / size) * 64, 64, 9);
      const v = 0.72 + n * 0.3 + (fine - 0.5) * 0.22 + (rng.f() - 0.5) * 0.08;
      const o = (y * size + x) * 4;
      img.data[o] = Math.min(255, v * 255 * 1.02);
      img.data[o + 1] = Math.min(255, v * 255);
      img.data[o + 2] = Math.min(255, v * 255 * 0.94);
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return finish(c, { repeat: true, aniso: 8 });
}

function leafPath(ctx: CanvasRenderingContext2D, length: number, width: number) {
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(width, -length * 0.45, 0, -length);
  ctx.quadraticCurveTo(-width, -length * 0.45, 0, 0);
  ctx.closePath();
}

/** A spray of broad leaves on a transparent ground: one card of tree canopy. */
export function makeLeafClusterTexture(seed: number, hue: [number, number, number]): THREE.Texture {
  const size = 256;
  const [c, ctx] = canvas(size);
  const rng = new Rng(seed);
  ctx.translate(size / 2, size / 2);
  // A few twigs first so the cluster has structure.
  ctx.strokeStyle = 'rgba(52,40,26,0.9)';
  ctx.lineWidth = 2.2;
  for (let i = 0; i < 5; i++) {
    const a = rng.range(0, TAU);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(
      Math.cos(a) * 40 + rng.range(-20, 20),
      Math.sin(a) * 40 + rng.range(-20, 20),
      Math.cos(a) * 95,
      Math.sin(a) * 95
    );
    ctx.stroke();
  }
  for (let i = 0; i < 95; i++) {
    const a = rng.range(0, TAU);
    const r = Math.sqrt(rng.f()) * 104;
    const shade = rng.range(0.55, 1.15) * (0.75 + 0.35 * (r / 104));
    ctx.save();
    ctx.translate(Math.cos(a) * r, Math.sin(a) * r);
    ctx.rotate(a + Math.PI / 2 + rng.range(-0.9, 0.9));
    const len = rng.range(20, 34);
    leafPath(ctx, len, len * rng.range(0.42, 0.6));
    ctx.fillStyle = `rgb(${Math.round(hue[0] * shade)},${Math.round(hue[1] * shade)},${Math.round(hue[2] * shade)})`;
    ctx.fill();
    ctx.strokeStyle = 'rgba(20,40,10,0.35)';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, -len);
    ctx.stroke();
    ctx.restore();
  }
  return finish(c);
}

/** A hanging strand of narrow willow leaves. The top edge of the card is the twig's root. */
export function makeWillowStrandTexture(): THREE.Texture {
  const w = 128;
  const h = 512;
  const [c, ctx] = canvas(w, h);
  const rng = new Rng(7);
  for (let s = 0; s < 5; s++) {
    const x0 = w * (0.18 + 0.16 * s) + rng.range(-5, 5);
    const sway = rng.range(-10, 10);
    const end = h * rng.range(0.78, 0.98);
    ctx.strokeStyle = 'rgba(120,130,60,0.95)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(x0, 0);
    ctx.quadraticCurveTo(x0 + sway, end * 0.5, x0 + sway * 0.4, end);
    ctx.stroke();
    for (let y = 14; y < end; y += rng.range(9, 15)) {
      const t = y / end;
      const x = x0 + sway * (2 * t * (1 - t)) * 2 * 0.5 + sway * 0.4 * t * t;
      for (const side of [-1, 1]) {
        if (rng.f() < 0.15) continue;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(Math.PI + side * rng.range(0.25, 0.6));
        const len = rng.range(22, 34);
        leafPath(ctx, len, len * 0.16);
        const shade = rng.range(0.7, 1.15);
        ctx.fillStyle = `rgb(${Math.round(132 * shade)},${Math.round(160 * shade)},${Math.round(58 * shade)})`;
        ctx.fill();
        ctx.restore();
      }
    }
  }
  return finish(c);
}

/** Vertical fissured bark, tileable around the trunk. */
export function makeBarkTexture(seed: number, base: [number, number, number]): THREE.Texture {
  const size = 256;
  const [c, ctx] = canvas(size);
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const ridge = periodicFbm(x / size, y / size / 5, 12, 3, seed);
      const crack = Math.pow(Math.abs(ridge - 0.5) * 2, 0.6);
      const grain = periodicNoise((x / size) * 48, (y / size) * 10, 48, seed + 5);
      const v = 0.45 + crack * 0.6 + (grain - 0.5) * 0.25;
      const o = (y * size + x) * 4;
      img.data[o] = Math.min(255, base[0] * v);
      img.data[o + 1] = Math.min(255, base[1] * v);
      img.data[o + 2] = Math.min(255, base[2] * v);
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return finish(c, { repeat: true });
}

/** Lily pad: radial veins, darker centre, pale rim. UVs map the disc to the whole square. */
export function makeLilyPadTexture(): THREE.Texture {
  const size = 256;
  const [c, ctx] = canvas(size);
  const g = ctx.createRadialGradient(size / 2, size / 2, 4, size / 2, size / 2, size / 2);
  g.addColorStop(0, '#3f6a22');
  g.addColorStop(0.75, '#4f8228');
  g.addColorStop(0.96, '#6c9a34');
  g.addColorStop(1, '#8a8a3c');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  ctx.translate(size / 2, size / 2);
  const rng = new Rng(11);
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * TAU + rng.range(-0.04, 0.04);
    ctx.strokeStyle = 'rgba(190,215,120,0.42)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(a) * size * 0.5, Math.sin(a) * size * 0.5);
    ctx.stroke();
    // Each main vein forks near the rim.
    ctx.lineWidth = 0.9;
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * size * 0.3, Math.sin(a) * size * 0.3);
      ctx.lineTo(Math.cos(a + s * 0.07) * size * 0.5, Math.sin(a + s * 0.07) * size * 0.5);
      ctx.stroke();
    }
  }
  // Blotches and nibbles.
  for (let i = 0; i < 40; i++) {
    const a = rng.range(0, TAU);
    const r = Math.sqrt(rng.f()) * size * 0.48;
    ctx.fillStyle = rng.f() < 0.5 ? 'rgba(30,60,18,0.18)' : 'rgba(150,140,60,0.16)';
    ctx.beginPath();
    ctx.arc(Math.cos(a) * r, Math.sin(a) * r, rng.range(3, 12), 0, TAU);
    ctx.fill();
  }
  return finish(c, { aniso: 8 });
}

/** One fern frond, stalk at the bottom centre. */
export function makeFernTexture(): THREE.Texture {
  const w = 128;
  const h = 256;
  const [c, ctx] = canvas(w, h);
  const rng = new Rng(21);
  ctx.strokeStyle = '#4f6a26';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(w / 2, h);
  ctx.lineTo(w / 2, 6);
  ctx.stroke();
  for (let y = h - 14; y > 8; y -= 7.5) {
    const t = 1 - y / h;
    const len = (w * 0.47) * Math.sin(Math.min(1, t * 1.25 + 0.12) * Math.PI) * (0.9 + rng.range(-0.08, 0.08));
    for (const side of [-1, 1]) {
      ctx.save();
      ctx.translate(w / 2, y);
      ctx.rotate(side * (Math.PI / 2 - 0.35));
      leafPath(ctx, len, 4.6);
      const shade = rng.range(0.8, 1.12);
      ctx.fillStyle = `rgb(${Math.round(62 * shade)},${Math.round(118 * shade)},${Math.round(40 * shade)})`;
      ctx.fill();
      ctx.restore();
    }
  }
  return finish(c);
}

/** Overlapping scalloped rows: bump/colour detail for the mallard's body feathers. */
export function makeFeatherTexture(): THREE.Texture {
  const size = 256;
  const [c, ctx] = canvas(size);
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, size, size);
  const rows = 14;
  const cols = 10;
  const rh = size / rows;
  const cw = size / cols;
  // Drawn back-to-front so each row overlaps the one behind it.
  for (let r = -1; r <= rows; r++) {
    for (let k = -1; k <= cols; k++) {
      const cx = (k + (r % 2 === 0 ? 0 : 0.5)) * cw + cw / 2;
      const cy = r * rh;
      const g = ctx.createLinearGradient(0, cy, 0, cy + rh * 1.7);
      g.addColorStop(0, '#6a6a6a');
      g.addColorStop(0.75, '#c9c9c9');
      g.addColorStop(1, '#f2f2f2');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(cx, cy + rh * 0.55, cw * 0.56, rh * 1.15, 0, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = 'rgba(40,40,40,0.55)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.ellipse(cx, cy + rh * 0.55, cw * 0.56, rh * 1.15, 0, 0.12 * Math.PI, 0.88 * Math.PI);
      ctx.stroke();
      // Central shaft.
      ctx.strokeStyle = 'rgba(60,60,60,0.3)';
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx, cy + rh * 1.6);
      ctx.stroke();
    }
  }
  return finish(c, { repeat: true, srgb: false, aniso: 8 });
}

/** Soft round sprite for droplets and drifting specks. */
export function makeDotTexture(): THREE.Texture {
  const size = 64;
  const [c, ctx] = canvas(size);
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.6)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return finish(c, { srgb: false });
}

/** A bubble: bright rim, clear middle, one highlight. */
export function makeBubbleTexture(): THREE.Texture {
  const size = 64;
  const [c, ctx] = canvas(size);
  const g = ctx.createRadialGradient(size / 2, size / 2, size * 0.2, size / 2, size / 2, size * 0.48);
  g.addColorStop(0, 'rgba(255,255,255,0.05)');
  g.addColorStop(0.8, 'rgba(255,255,255,0.3)');
  g.addColorStop(0.93, 'rgba(255,255,255,0.95)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.beginPath();
  ctx.ellipse(size * 0.36, size * 0.34, size * 0.09, size * 0.05, -0.6, 0, TAU);
  ctx.fill();
  return finish(c, { srgb: false });
}

/** Dragonfly wing: clear membrane with dark veins. */
export function makeWingTexture(): THREE.Texture {
  const w = 128;
  const h = 32;
  const [c, ctx] = canvas(w, h);
  ctx.fillStyle = 'rgba(220,235,245,0.28)';
  ctx.beginPath();
  ctx.ellipse(w / 2, h / 2, w / 2 - 1, h / 2 - 2, 0, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = 'rgba(40,40,45,0.6)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.ellipse(w / 2, h / 2, w / 2 - 1, h / 2 - 2, 0, 0, TAU);
  ctx.stroke();
  for (let i = 1; i < 12; i++) {
    ctx.beginPath();
    ctx.moveTo((i / 12) * w, 3);
    ctx.lineTo((i / 12) * w + 5, h - 3);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(2, h / 2);
  ctx.lineTo(w - 2, h / 2 - 3);
  ctx.stroke();
  return finish(c);
}
