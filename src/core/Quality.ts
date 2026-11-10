export type QualityLevel = 'low' | 'medium' | 'high';

export interface QualitySettings {
  level: QualityLevel;
  label: string;
  /** Wave simulation grid resolution. */
  waterSize: number;
  /** Caustic map resolution and the density of the grid that draws it. */
  causticSize: number;
  causticGrid: number;
  /** Segments per side of the visible water surface grid. */
  surfaceGrid: number;
  /** Reflection / refraction pass resolution relative to the canvas. */
  planarScale: number;
  /**
   * Render the mirrored scene for reflections of nearby things (the duck,
   * lilies, the near bank). Off, the water still reflects the baked sky and
   * tree line, and a whole scene pass is saved.
   */
  planarReflection: boolean;
  /** 0 disables shadows. */
  shadowMapSize: number;
  /** Fraction of instanced foliage that is drawn. */
  foliageDensity: number;
  maxPixelRatio: number;
}

export const QUALITY: Record<QualityLevel, QualitySettings> = {
  low: {
    level: 'low',
    label: 'Low',
    waterSize: 256,
    causticSize: 512,
    causticGrid: 192,
    surfaceGrid: 128,
    planarScale: 0.4,
    planarReflection: false,
    shadowMapSize: 0,
    foliageDensity: 0.4,
    maxPixelRatio: 1,
  },
  medium: {
    level: 'medium',
    label: 'Medium',
    waterSize: 512,
    causticSize: 1024,
    causticGrid: 320,
    surfaceGrid: 200,
    planarScale: 0.5,
    planarReflection: true,
    shadowMapSize: 2048,
    foliageDensity: 0.7,
    maxPixelRatio: 1.5,
  },
  high: {
    level: 'high',
    label: 'High',
    waterSize: 1024,
    causticSize: 2048,
    causticGrid: 512,
    surfaceGrid: 256,
    planarScale: 0.6,
    planarReflection: true,
    shadowMapSize: 4096,
    foliageDensity: 1,
    maxPixelRatio: 2,
  },
};

const STORAGE_KEY = 'duck-days.quality';

export function loadQualityLevel(): QualityLevel {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'low' || saved === 'medium' || saved === 'high') return saved;
  } catch {
    // Storage can be unavailable (private mode, sandboxed frames); fall through.
  }
  // Phones and small tablets start on Low; everything else on Medium.
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  return coarse ? 'low' : 'medium';
}

export function saveQualityLevel(level: QualityLevel) {
  try {
    localStorage.setItem(STORAGE_KEY, level);
  } catch {
    // Not fatal: the choice simply will not persist.
  }
}
