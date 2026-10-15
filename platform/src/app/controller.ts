import { World } from '../render/World';
import { guessTier, lowerTier } from '../render/quality';
import { useStore, type CamMode, type QualityTier } from './store';
import { translate } from './i18n';

/* App controller: owns the render world and the simulation clock, runs the frame loop, and publishes
   compact frames to the UI store at a low rate so React never re-renders at 60 fps. */

export const SIM_START_CLOCK_S = 16 * 3600 + 45 * 60; // scenario clock starts at 16:45:00 local

export function formatClock(t: number): string {
  const s = Math.floor(SIM_START_CLOCK_S + t);
  const hh = Math.floor(s / 3600) % 24;
  const mm = Math.floor(s / 60) % 60;
  const ss = s % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

export function formatRel(t: number): string {
  const s = Math.max(0, Math.floor(t));
  const m = Math.floor(s / 60);
  return `T+${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

class SimClock {
  t = 0;
  playing = true;
  speed = 1;
  horizon = 0;
  advance(realDt: number): void {
    if (!this.playing) return;
    this.t += realDt * this.speed;
    this.horizon = Math.max(this.horizon, this.t);
  }
}

class Controller {
  world: World | null = null;
  readonly clock = new SimClock();
  private raf = 0;
  private last = 0;
  private uiAccum = 0;
  private fpsFrames = 0;
  private fpsAccum = 0;
  private fps = 60;
  private lowFpsTime = 0;
  private autoQuality = true;
  private started = false;

  mount(host: HTMLElement): boolean {
    if (this.world) return true;
    try {
      this.world = new World(host);
    } catch (err) {
      console.error('WebGL initialisation failed', err);
      useStore.getState().setWebgl(false);
      return false;
    }
    const w = this.world;
    const st = useStore.getState();
    w.rig.reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    w.rig.onUserTakeover = () => useStore.getState().setCamMode('free');
    w.onDragState = (d) => host.classList.toggle('dragging', d);
    this.applyQuality(st.quality === 'auto' ? guessTier() : st.quality);
    this.autoQuality = st.quality === 'auto';
    this.installPresets();
    w.rig.setMode('overview');
    // start slightly further out and settle in, as an opening shot
    const ov = w.rig.getPreset('overview');
    if (ov) {
      w.rig.pose = { ...ov, dist: ov.dist * 1.6, pitch: ov.pitch + 0.25, yaw: ov.yaw - 0.35 };
      w.rig.flyTo(ov, { duration: w.rig.reducedMotion ? 0.001 : 3.2, hop: false });
    }
    this.start();
    return true;
  }

  /** Camera presets for the district; refined once the city is built. */
  installPresets(): void {
    const rig = this.world?.rig;
    if (!rig) return;
    rig.setPreset('overview', { tx: 40, ty: 0, tz: 20, yaw: 0.36, pitch: 0.56, dist: 1250, fov: 40 });
    rig.setPreset('topdown', { tx: 0, ty: 0, tz: 0, yaw: 0, pitch: 1.53, dist: 2300, fov: 30 });
    rig.setPreset('street', { tx: 0, ty: 0, tz: 0, yaw: 0.8, pitch: 0.12, dist: 34, fov: 52 });
    rig.setPreset('incident', { tx: 0, ty: 0, tz: 0, yaw: 0.5, pitch: 0.7, dist: 260, fov: 40 });
    rig.setPreset('free', { tx: 40, ty: 0, tz: 20, yaw: 0.36, pitch: 0.56, dist: 1250, fov: 40 });
  }

  applyQuality(tier: QualityTier): void {
    this.world?.setQuality(tier);
    useStore.getState().setEffectiveQuality(tier);
  }

  setQualityChoice(choice: 'auto' | QualityTier): void {
    useStore.getState().setQuality(choice);
    this.autoQuality = choice === 'auto';
    this.lowFpsTime = 0;
    this.applyQuality(choice === 'auto' ? guessTier() : choice);
  }

  setCamMode(mode: CamMode): void {
    useStore.getState().setCamMode(mode);
    const rig = this.world?.rig;
    if (!rig) return;
    if (mode === 'free') {
      rig.mode = 'free';
      return;
    }
    rig.setMode(mode);
  }

  resetCamera(): void {
    this.setCamMode('overview');
  }

  /** Projection centre shift so the city's focus sits between the open panels. */
  updateViewShift(leftPx: number, rightPx: number, immediate = false): void {
    const rtl = document.documentElement.dir === 'rtl';
    const l = rtl ? rightPx : leftPx;
    const r = rtl ? leftPx : rightPx;
    this.world?.setViewShift((l - r) / 2, immediate);
  }

  // ---------------------------------------------------------------- clock control

  togglePlay(): void {
    this.clock.playing = !this.clock.playing;
    this.publishClock();
  }

  setSpeed(s: number): void {
    this.clock.speed = s;
    this.publishClock();
  }

  restart(): void {
    this.clock.t = 0;
    this.clock.horizon = 0;
    this.publishClock();
  }

  seek(t: number): void {
    this.clock.t = Math.max(0, Math.min(t, this.clock.horizon));
    this.publishClock();
  }

  private publishClock(): void {
    const c = this.clock;
    useStore.getState().setClock({ t: c.t, playing: c.playing, speed: c.speed, horizon: c.horizon });
  }

  // ---------------------------------------------------------------- loop

  private start(): void {
    if (this.started) return;
    this.started = true;
    this.last = performance.now();
    const loop = (now: number) => {
      this.raf = requestAnimationFrame(loop);
      this.tickAt(now, 0.1, true);
    };
    this.raf = requestAnimationFrame(loop);
    // Some embedded webviews pause requestAnimationFrame while the page still counts as visible.
    // A low-rate timer keeps the simulation (and the picture) advancing in that case.
    this.watchdog = window.setInterval(() => {
      const now = performance.now();
      if (now - this.last > 150) this.tickAt(now, 0.5, false);
    }, 100);
    useStore.getState().setReady();
  }

  private watchdog = 0;

  private tickAt(now: number, maxDt: number, fromRaf: boolean): void {
    const dt = Math.min(maxDt, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    this.step(dt, fromRaf);
  }

  private step(dt: number, fromRaf: boolean): void {
    const t0 = performance.now();
    this.clock.advance(dt);
    const simMs = performance.now() - t0;
    const st = useStore.getState();
    let stats = null;
    if (this.world && st.view === 'twin') stats = this.world.frame(dt);

    // statistics and adaptive quality (only real display frames count; timer frames are a fallback)
    if (fromRaf) {
      this.fpsFrames++;
      this.fpsAccum += dt;
    }
    if (fromRaf && this.fpsAccum >= 0.5) {
      this.fps = this.fpsFrames / this.fpsAccum;
      this.fpsFrames = 0;
      this.fpsAccum = 0;
      if (this.autoQuality && st.view === 'twin' && document.visibilityState === 'visible') {
        this.lowFpsTime = this.fps < 34 ? this.lowFpsTime + 0.5 : Math.max(0, this.lowFpsTime - 0.5);
        if (this.lowFpsTime >= 4) {
          const lower = lowerTier(st.effectiveQuality);
          this.lowFpsTime = 0;
          if (lower) {
            this.applyQuality(lower);
            const q = translate(st.lang, lower === 'balanced' ? 'gfx.balanced' : 'gfx.performance');
            st.pushToast(translate(st.lang, 'gfx.downgraded', { q }), 'warn');
          }
        }
      }
    }
    this.uiAccum += dt;
    if (this.uiAccum >= 0.1) {
      this.uiAccum = 0;
      this.publishClock();
      if (st.perfOpen && stats) {
        st.setPerf({
          fps: this.fps,
          frameMs: 1000 / Math.max(1, this.fps),
          calls: stats.calls,
          tris: stats.tris,
          geometries: stats.geometries,
          textures: stats.textures,
          simMs,
          pixelRatio: stats.pixelRatio,
        });
      }
    }
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    clearInterval(this.watchdog);
    this.world?.dispose();
    this.world = null;
    this.started = false;
  }
}

export const controller = new Controller();
