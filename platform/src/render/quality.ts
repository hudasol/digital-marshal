import type { QualityTier } from '../app/store';

export interface QualityProfile {
  tier: QualityTier;
  maxPixelRatio: number;
  shadows: boolean;
  shadowMapSize: number;
  msaaSamples: number; // samples of the post-processing render target (0 = composer off)
  bloom: boolean;
  postprocessing: boolean;
  propDensity: number; // 0..1 share of decorative props drawn (trees, lamps, parked cars)
  farBuildings: boolean; // distant skyline ring
}

export const QUALITY: Record<QualityTier, QualityProfile> = {
  high: {
    tier: 'high',
    maxPixelRatio: 2,
    shadows: true,
    shadowMapSize: 4096,
    msaaSamples: 4,
    bloom: true,
    postprocessing: true,
    propDensity: 1,
    farBuildings: true,
  },
  balanced: {
    tier: 'balanced',
    maxPixelRatio: 1.5,
    shadows: true,
    shadowMapSize: 2048,
    msaaSamples: 4,
    bloom: true,
    postprocessing: true,
    propDensity: 0.75,
    farBuildings: true,
  },
  performance: {
    tier: 'performance',
    maxPixelRatio: 1,
    shadows: false,
    shadowMapSize: 1024,
    msaaSamples: 0,
    bloom: false,
    postprocessing: false,
    propDensity: 0.4,
    farBuildings: false,
  },
};

/** Lower tier for adaptive degradation; null when already at the floor. */
export function lowerTier(t: QualityTier): QualityTier | null {
  if (t === 'high') return 'balanced';
  if (t === 'balanced') return 'performance';
  return null;
}

/** Initial guess for "auto": conservative on small or touch screens. */
export function guessTier(): QualityTier {
  if (typeof window === 'undefined') return 'balanced';
  const coarse = window.matchMedia?.('(pointer: coarse)').matches;
  const small = Math.min(window.innerWidth, window.innerHeight) < 700;
  if (coarse || small) return 'performance';
  return 'balanced';
}

export function hasWebGL2(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!c.getContext('webgl2');
  } catch {
    return false;
  }
}
