import type { QualityTier } from '../app/store';

export interface QualityProfile {
  tier: QualityTier;
  maxPixelRatio: number;
  shadows: boolean;
  shadowMapSize: number;
  msaaSamples: number; // samples of the scene render target (0 = FXAA instead)
  bloom: boolean;
  ao: boolean; // screen-space ambient occlusion (GTAO)
  propDensity: number; // 0..1 share of decorative props drawn (trees, lamps, parked cars)
  farBuildings: boolean; // distant skyline ring
  lightPools: boolean; // light cast on the road by street lamps and headlights at night
  vehicleLod: number; // vehicles within this distance of the camera use the detailed model, m
  dynamicShadows: boolean; // vehicles cast sun shadows (shadow map redrawn every frame); otherwise contact shadows
}

export const QUALITY: Record<QualityTier, QualityProfile> = {
  high: {
    tier: 'high',
    maxPixelRatio: 2,
    shadows: true,
    shadowMapSize: 4096,
    msaaSamples: 4,
    bloom: true,
    ao: true,
    propDensity: 1,
    farBuildings: true,
    lightPools: true,
    vehicleLod: 230,
    dynamicShadows: true,
  },
  balanced: {
    tier: 'balanced',
    maxPixelRatio: 1.25,
    shadows: true,
    shadowMapSize: 2048,
    msaaSamples: 4,
    bloom: true,
    ao: false,
    propDensity: 0.75,
    farBuildings: true,
    lightPools: true,
    vehicleLod: 150,
    dynamicShadows: false,
  },
  performance: {
    tier: 'performance',
    maxPixelRatio: 1,
    shadows: false,
    shadowMapSize: 1024,
    msaaSamples: 0,
    bloom: false,
    ao: false,
    propDensity: 0.4,
    farBuildings: false,
    lightPools: false,
    vehicleLod: 60,
    dynamicShadows: false,
  },
};

/** Lower tier for adaptive degradation; null when already at the floor. */
export function lowerTier(t: QualityTier): QualityTier | null {
  if (t === 'high') return 'balanced';
  if (t === 'balanced') return 'performance';
  return null;
}

/** Adaptive quality: step down a tier after this much net time below the frame-rate floor. */
export const AUTO_QUALITY = {
  windowS: 0.5, // length of one sampling window
  lowFps: 27, // frame rate below which a window counts as slow
  triggerS: 4, // net slow time that triggers a downgrade
  settleS: 1, // windows within this long after a disturbance are not sampled
};

/** Frame statistics and the automatic quality downgrade, kept free of the DOM so it can be tested.
    FPS comes from the real (unclamped) time between displayed frames; frame time is the measured
    work per frame, averaged over the window. Windows that overlap a disturbance (seeking, a policy
    replay, simulating ahead, a hidden tab, a quality change) and the settle time after one are
    skipped, so only frames slowed by rendering load count toward a downgrade. */
export class FrameMonitor {
  fps = 60;
  frameMs = 0;
  /** net time spent below the floor, s */
  lowTime = 0;
  private frames = 0;
  private elapsed = 0;
  private workMs = 0;
  private quiet: number;
  private tainted: boolean;

  /** `settleS`: time after start (shader compilation, first uploads) that is not sampled */
  constructor(settleS = AUTO_QUALITY.settleS) {
    this.quiet = settleS;
    this.tainted = settleS > 0;
  }

  /** Frames from now on are slow for reasons other than rendering load: skip them and settle after. */
  disturb(settleS = AUTO_QUALITY.settleS): void {
    this.quiet = Math.max(this.quiet, settleS);
    this.tainted = true;
  }

  /** Forget accumulated slow time (for example after the quality tier changed). */
  resetLow(): void {
    this.lowTime = 0;
  }

  /**
   * Record one displayed frame. `elapsedS` is the real time since the previous frame, `workMs` the
   * measured update and render time, `eligible` false while adapting is off or the frame is disturbed.
   * Returns true when the quality should step down one tier.
   */
  frame(elapsedS: number, workMs: number, eligible: boolean): boolean {
    this.frames++;
    this.elapsed += Math.max(0, elapsedS);
    this.workMs += workMs;
    if (!eligible) {
      this.quiet = Math.max(this.quiet, AUTO_QUALITY.settleS);
      this.tainted = true;
    } else if (this.quiet > 0) {
      this.quiet -= elapsedS;
      this.tainted = true;
    }
    if (this.elapsed < AUTO_QUALITY.windowS - 1e-9) return false;
    this.fps = this.frames / this.elapsed;
    this.frameMs = this.workMs / this.frames;
    const sampled = !this.tainted;
    this.frames = 0;
    this.elapsed = 0;
    this.workMs = 0;
    this.tainted = this.quiet > 0;
    if (!sampled) return false;
    // each sampled window counts the same, however long a single slow frame made it
    const w = AUTO_QUALITY.windowS;
    this.lowTime = this.fps < AUTO_QUALITY.lowFps ? this.lowTime + w : Math.max(0, this.lowTime - w);
    if (this.lowTime < AUTO_QUALITY.triggerS) return false;
    this.lowTime = 0;
    return true;
  }
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
