import * as THREE from 'three';
import { World } from '../render/World';
import { CityRenderer } from '../render/city';
import { VehicleLayer } from '../render/vehicles';
import { getNetwork } from '../core/network/build';
import { QUALITY, guessTier, lowerTier } from '../render/quality';
import type { SimSession } from '../core/sim/session';
import { createSession, dmFor } from '../core/scenarios';
import { OverlayLayer } from '../render/overlays';
import { dmFrame, incidentFrame, vehicleDmView } from './dmframes';
import type { Policy } from '../core/dm/types';
import type { Marker } from './store';
import { DT } from '../core/sim/params';
import { useStore, type CamMode, type QualityTier } from './store';
import { translate } from './i18n';
import { networkFrame, vehicleFrame, type VehicleFrame } from './frames';
import type { FollowTarget } from '../render/CameraRig';

/* App controller: owns the simulation session, the render world and the frame loop. The simulation
   advances in fixed 0.1 s steps; the picture is interpolated between the last two steps. Compact
   frames are published to the UI store a few times per second so React never renders at 60 fps. */

export const SIM_START_CLOCK_S = 16 * 3600 + 45 * 60; // scenario clock starts at 16:45:00 local

export function formatClock(t: number): string {
  const s = Math.floor(SIM_START_CLOCK_S + t);
  const hh = Math.floor(s / 3600) % 24;
  const mm = Math.floor(s / 60) % 60;
  const ss = s % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

export function formatRel(t: number): string {
  const neg = t < -0.5;
  const s = Math.abs(neg ? Math.ceil(t) : Math.floor(Math.max(0, t)));
  const m = Math.floor(s / 60);
  return `T${neg ? '−' : '+'}${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/** Length of the scenario timeline shown on the playback bar, s (the simulation can run past it). */
export const TIMELINE_S = 900;
const MAX_STEPS_PER_FRAME = 120;

function makeSession(): SimSession {
  return createSession(getNetwork(), { dm: { policy: 'C' } });
}

/** Events that get a marker on the playback timeline. */
const MARKER_KINDS: Record<string, Marker['tone']> = {
  'power-loss': 'critical',
  'outage-detected': 'critical',
  'msg-published': 'info',
  'assist-request': 'warn',
  'junction-authorized': 'ok',
  'power-restored': 'ok',
  'incident-resolved': 'ok',
  'inject-rejected': 'info',
  'inject-accepted': 'critical',
  'ev-dispatched': 'critical',
  'ev-arrived': 'ok',
};

class Controller {
  world: World | null = null;
  city: CityRenderer | null = null;
  vehicles: VehicleLayer | null = null;
  overlays: OverlayLayer | null = null;
  readonly session = makeSession();
  playing = true;
  speed = 1;
  /** continuous display time, between the previous and current simulation step */
  renderT = 0;
  private seekTarget: number | null = null;
  private raf = 0;
  private last = 0;
  private uiAccum = 0;
  private fpsFrames = 0;
  private fpsAccum = 0;
  private fps = 60;
  private lowFpsTime = 0;
  private autoQuality = true;
  private started = false;
  private watchdog = 0;
  private lastVehicleFrame: VehicleFrame | null = null;
  private simMs = 0;

  get engine() {
    return this.session.engine;
  }

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
    const tier = st.quality === 'auto' ? guessTier() : st.quality;
    const net = getNetwork();
    this.city = new CityRenderer(net, w.renderer.capabilities.getMaxAnisotropy(), QUALITY[tier]);
    w.scene.add(this.city.group);
    this.vehicles = new VehicleLayer();
    this.vehicles.setParked(this.city.parkedSpots);
    this.vehicles.statusOf = (v) => {
      if (v.mode === 'mrc') return 'mrc';
      const k = dmFor(this.engine).s.knowledge[v.id];
      if (k) for (const id of Object.keys(k.incidents)) if (k.incidents[id].active) return 'advisory';
      return 'normal';
    };
    w.scene.add(this.vehicles.group);
    this.overlays = new OverlayLayer(net);
    w.scene.add(this.overlays.group);
    this.vehicles.refresh(this.engine, true);
    const b = net.bounds;
    w.rig.bounds = { minX: b.minX, maxX: b.maxX, minZ: -b.maxY, maxZ: -b.minY };
    w.rig.setObstacleTest((a, c) => this.city?.obstacle(a, c) ?? null);
    w.pickHandler = (ndc, ray) => this.pick(ndc, ray);
    this.applyQuality(tier);
    this.autoQuality = st.quality === 'auto';
    this.installPresets();
    w.rig.setMode('overview');
    // opening shot: start further out and settle in
    const ov = w.rig.getPreset('overview');
    if (ov) {
      w.rig.pose = { ...ov, dist: ov.dist * 1.5, pitch: ov.pitch + 0.2, yaw: ov.yaw - 0.35 };
      w.rig.flyTo(ov, { duration: w.rig.reducedMotion ? 0.001 : 3.4, hop: false });
    }
    this.city.setLabels(st.overlays.labels);
    useStore.subscribe((now, prev) => {
      if (now.overlays.labels !== prev.overlays.labels) this.city?.setLabels(now.overlays.labels);
      if (now.overlays.v2x !== prev.overlays.v2x && this.overlays) this.overlays.enabled = now.overlays.v2x;
      if (now.selection !== prev.selection) this.onSelection();
    });
    this.start();
    return true;
  }

  /** Camera presets for the district (three.js coordinates: z = -north). */
  installPresets(): void {
    const rig = this.world?.rig;
    if (!rig) return;
    rig.setPreset('overview', { tx: 20, ty: 0, tz: -40, yaw: 0.34, pitch: 0.54, dist: 1720, fov: 40 });
    rig.setPreset('topdown', { tx: 0, ty: 0, tz: 0, yaw: 0, pitch: 1.53, dist: 2150, fov: 30 });
    rig.setPreset('street', { tx: 25, ty: 0, tz: 6, yaw: -1.36, pitch: 0.07, dist: 38, fov: 52 });
    rig.setPreset('incident', { tx: 5, ty: 0, tz: 120, yaw: 0.45, pitch: 0.66, dist: 360, fov: 40 });
    rig.setPreset('free', { tx: 20, ty: 0, tz: -40, yaw: 0.34, pitch: 0.54, dist: 1720, fov: 40 });
  }

  applyQuality(tier: QualityTier): void {
    this.world?.setQuality(tier);
    this.city?.setQuality(QUALITY[tier]);
    useStore.getState().setEffectiveQuality(tier);
  }

  setQualityChoice(choice: 'auto' | QualityTier): void {
    useStore.getState().setQuality(choice);
    this.autoQuality = choice === 'auto';
    this.lowFpsTime = 0;
    this.applyQuality(choice === 'auto' ? guessTier() : choice);
  }

  // ---------------------------------------------------------------- camera

  setCamMode(mode: CamMode): void {
    const rig = this.world?.rig;
    if (mode === 'follow') {
      const sel = useStore.getState().selection;
      if (sel?.kind !== 'vehicle') return;
    }
    useStore.getState().setCamMode(mode);
    if (!rig) return;
    if (mode === 'free') {
      rig.mode = 'free';
      return;
    }
    if (mode === 'follow') {
      rig.setMode('follow', () => this.followTarget());
      return;
    }
    if (mode === 'incident') {
      if (!this.focusIncident()) rig.setMode('overview');
      return;
    }
    if (mode === 'emergency') {
      if (!this.evTarget()) {
        rig.setMode('overview');
        return;
      }
      rig.setMode('emergency', () => this.evTarget());
      return;
    }
    rig.setMode(mode);
  }

  resetCamera(): void {
    this.setCamMode('overview');
  }

  /** Interpolated world position of the selected vehicle for the follow camera. */
  private followTarget(): FollowTarget | null {
    const sel = useStore.getState().selection;
    if (sel?.kind !== 'vehicle' || !this.vehicles) return null;
    const p = this.vehicles.pose(sel.id, this.alpha());
    if (!p) return null;
    const v = this.engine.state.vehicles[sel.id];
    return { x: p.x, y: 0, z: -p.y, heading: p.h, speed: v ? v.v : 0 };
  }

  /** Focus the camera on a point in simulation coordinates. */
  focusSim(x: number, y: number, dist = 260, pitch = 0.62): void {
    this.world?.rig.focus(x, -y, dist, pitch);
    useStore.getState().setCamMode('incident');
  }

  updateViewShift(leftPx: number, rightPx: number, immediate = false): void {
    const rtl = document.documentElement.dir === 'rtl';
    const l = rtl ? rightPx : leftPx;
    const r = rtl ? leftPx : rightPx;
    this.world?.setViewShift((l - r) / 2, immediate);
  }

  // ---------------------------------------------------------------- selection

  private pick(ndc: THREE.Vector2, ray: THREE.Raycaster): boolean {
    if (!this.vehicles || !this.world) return false;
    let id = this.vehicles.pick(ray);
    if (id === null) {
      // small vehicles from far away: take the nearest one to the clicked ground point
      const g = this.world.groundAt(ndc);
      if (g) {
        const radius = Math.max(6, this.world.rig.pose.dist * 0.018);
        let best = radius;
        for (const vid of this.engine.state.order) {
          const p = this.vehicles.pose(vid, this.alpha());
          if (!p) continue;
          const d = Math.hypot(p.x - g.x, -p.y - g.z);
          if (d < best) {
            best = d;
            id = vid;
          }
        }
      }
    }
    const st = useStore.getState();
    if (id !== null) {
      st.select({ kind: 'vehicle', id });
      if (!st.rightOpen) st.toggleRight();
      return true;
    }
    if (st.selection?.kind === 'vehicle') st.select(null);
    return false;
  }

  selectVehicle(id: number | null): void {
    useStore.getState().select(id === null ? null : { kind: 'vehicle', id });
  }

  private onSelection(): void {
    const sel = useStore.getState().selection;
    if (this.vehicles) this.vehicles.selected = sel?.kind === 'vehicle' ? sel.id : null;
    this.lastVehicleFrame = null;
    const mode = useStore.getState().camMode;
    if (mode === 'follow' && sel?.kind !== 'vehicle') this.setCamMode('free');
    this.publishFrames();
  }

  // ---------------------------------------------------------------- playback

  togglePlay(): void {
    this.playing = !this.playing;
    this.publishClock();
  }

  setSpeed(s: number): void {
    this.speed = s;
    this.publishClock();
  }

  restart(): void {
    this.seek(0);
  }

  /** Change the demand level from now on (recorded, so replays and policy switches reproduce it). */
  setDensity(scale: number): void {
    this.session.intervene('density', { scale });
    this.session.stepOnce();
    this.renderT = this.session.t;
    this.vehicles?.refresh(this.engine, true);
    this.publishFrames();
  }

  /** Jump to time t. Within known history this is immediate; beyond it the run is simulated. */
  seek(t: number): void {
    t = Math.max(0, t);
    const ahead = t - this.session.horizon;
    if (ahead > 30) {
      // simulate in chunks over several frames so the interface stays responsive
      this.seekTarget = t;
      return;
    }
    const t0 = performance.now();
    this.session.seek(t);
    this.simMs = performance.now() - t0;
    this.renderT = this.session.t;
    this.vehicles?.refresh(this.engine, true);
    this.publishClock();
    this.publishFrames();
  }

  private alpha(): number {
    return Math.max(0, Math.min(1, 1 - (this.session.t - this.renderT) / DT));
  }

  private advance(dt: number): void {
    if (this.seekTarget !== null) {
      const remaining = this.session.seek(this.seekTarget, MAX_STEPS_PER_FRAME * 4);
      const total = Math.max(1, this.seekTarget - this.renderT);
      useStore.getState().setBusy({ label: 'Simulating ahead', progress: 1 - (remaining * DT) / total });
      if (remaining === 0) {
        this.seekTarget = null;
        useStore.getState().setBusy(null);
      }
      this.renderT = this.session.t;
      this.vehicles?.refresh(this.engine, true);
      return;
    }
    if (!this.playing) return;
    let target = this.renderT + dt * this.speed;
    let steps = 0;
    while (this.session.t < target - 1e-9 && steps < MAX_STEPS_PER_FRAME) {
      // the pose before the last step of this frame is the start of the interpolation
      if (this.session.t + DT >= target - 1e-9) this.vehicles?.capturePrev(this.engine);
      this.session.stepOnce();
      steps++;
    }
    if (steps >= MAX_STEPS_PER_FRAME) target = this.session.t; // cannot keep up: drop the backlog
    if (steps) this.vehicles?.refresh(this.engine);
    this.renderT = Math.min(target, this.session.t);
  }

  private publishClock(): void {
    useStore.getState().setClock({
      t: this.renderT,
      playing: this.playing,
      speed: this.speed,
      horizon: this.session.horizon,
    });
  }

  private publishFrames(): void {
    const st = useStore.getState();
    const sel = st.selection;
    let vf: VehicleFrame | null = null;
    if (sel?.kind === 'vehicle') {
      vf = vehicleFrame(this.engine, sel.id, this.lastVehicleFrame);
      this.lastVehicleFrame = vf;
    }
    st.setFrames(networkFrame(this.engine), vf);
    const e = this.engine;
    const dmf = dmFrame(e);
    const inc = sel?.kind === 'incident' ? incidentFrame(e, sel.id) : null;
    const vdm = sel?.kind === 'vehicle' ? vehicleDmView(e, sel.id) : null;
    const events = e.state.events.slice(-40).reverse();
    const markers: Marker[] = [];
    for (const ev of this.session.knownEvents) {
      const tone = MARKER_KINDS[ev.kind];
      if (tone && (ev.kind !== 'msg-published' || ev.p?.policy !== 'A')) markers.push({ t: ev.t, tone, label: ev.kind });
    }
    st.setDmFrames(dmf, inc, vdm, events, markers.slice(-200));
    // header status
    const active = dmf.incidents.filter((i) => i.status === 'active');
    const label = active.length ? active.map((i) => `${i.title.split(' at ')[0]} \u00b7 ${i.id}`).join(' | ') : dmf.dark.length ? 'Signal outage (not yet detected)' : '';
    const level = dmf.dark.length || dmf.mrcNow ? 'critical' : dmf.exceptions.open || active.length ? 'warn' : 'normal';
    if (st.scenarioLabel !== label || st.alertLevel !== level) useStore.setState({ scenarioLabel: label, alertLevel: level });
  }

  // ---------------------------------------------------------------- scenarios

  /** Signal controllers lose power now; optionally power returns after `restoreAfter` seconds. */
  triggerBlackout(junctions: string[], restoreAfter: number | null): void {
    if (!junctions.length) return;
    const t = this.session.t;
    this.session.intervene('blackout', { junctions }, t);
    if (restoreAfter) this.session.intervene('restore', { junctions }, t + restoreAfter);
    this.afterIntervention();
    const c = this.centroid(junctions);
    this.focusSim(c.x, c.y, 520, 0.72);
  }

  restorePower(): void {
    const dark = [...this.engine.state.road.dark];
    if (!dark.length) return;
    // a power return that was scheduled for later is superseded by restoring now
    this.session.removeInterventions((iv) => iv.kind === 'restore' && iv.t > this.session.t);
    this.session.intervene('restore', { junctions: dark }, this.session.t);
    this.afterIntervention();
  }

  /** Emergency dispatch from the hospital to the medical call. */
  dispatchAmbulance(): void {
    this.session.intervene('dispatch', { from: 'hospital', to: 'scene' }, this.session.t);
    this.afterIntervention();
    // the ambulance exists from the next step; follow it
    const rec = dmFor(this.engine).s.ev;
    if (rec && this.engine.state.vehicles[rec.id]) {
      useStore.getState().select({ kind: 'vehicle', id: rec.id });
      this.setCamMode('emergency');
    }
  }

  /** Interpolated world pose of the active ambulance for the emergency camera. */
  private evTarget(): FollowTarget | null {
    const rec = dmFor(this.engine).s.ev;
    if (!rec || !this.vehicles) return null;
    const p = this.vehicles.pose(rec.id, this.alpha());
    if (!p) return null;
    const v = this.engine.state.vehicles[rec.id];
    return { x: p.x, y: 0, z: -p.y, heading: p.h, speed: v ? v.v : 0 };
  }

  /** Remove every scenario trigger and start again from the beginning. */
  resetScenario(): void {
    this.session.removeInterventions((iv) => iv.kind !== 'density');
    this.seek(0);
    useStore.getState().select(null);
  }

  /** Replay the same run (same seed, same interventions) under another coordination policy. */
  setPolicy(policy: Policy): void {
    const cfg = this.session.cfg as { dm?: Record<string, unknown> };
    if ((cfg.dm?.policy ?? 'C') === policy) return;
    const t = this.renderT;
    this.session.reset({ ...cfg, dm: { ...(cfg.dm ?? {}), policy } }, true);
    this.renderT = 0;
    this.vehicles?.refresh(this.engine, true);
    if (t > 0) this.seekTarget = t;
    this.publishClock();
    this.publishFrames();
  }

  setComms(params: Record<string, unknown>): void {
    this.session.intervene('comms', params, this.session.t);
    this.afterIntervention();
  }

  private afterIntervention(): void {
    this.session.stepOnce();
    this.renderT = this.session.t;
    this.vehicles?.refresh(this.engine, true);
    this.publishClock();
    this.publishFrames();
  }

  /** Points along the ambulance's remaining route, ahead of it, for the corridor ribbon. */
  private corridorPath(): Array<{ x: number; y: number }> | null {
    const rec = dmFor(this.engine).s.ev;
    if (!rec || rec.arrivedAt !== null || !useStore.getState().overlays.v2x) return null;
    const v = this.engine.state.vehicles[rec.id];
    if (!v || !this.vehicles) return null;
    const net = getNetwork();
    const pts: Array<{ x: number; y: number }> = [];
    const p0 = this.vehicles.pose(rec.id, this.alpha());
    if (p0) pts.push({ x: p0.x, y: p0.y });
    let budget = 360;
    const cur = v.seg.k === 'L' ? v.seg.id : net.connectors[v.seg.id].outLink;
    const start = Math.max(0, v.route.indexOf(cur));
    for (let i = start; i < v.route.length && budget > 0; i++) {
      const l = net.links[v.route[i]];
      const from = i === start && v.seg.k === 'L' ? v.s : 0;
      const to = Math.min(l.length, from + budget);
      const off = l.laneOffsets[0];
      for (let s = from; s <= to; s += 6) pts.push({ x: l.start.x + l.dir.x * s + l.right.x * off, y: l.start.y + l.dir.y * s + l.right.y * off });
      budget -= to - from;
    }
    return pts;
  }

  centroid(junctions: string[]): { x: number; y: number } {
    const net = getNetwork();
    let x = 0;
    let y = 0;
    for (const j of junctions) {
      x += net.junctions[j].x;
      y += net.junctions[j].y;
    }
    return { x: x / junctions.length, y: y / junctions.length };
  }

  selectIncident(id: string, focus = true): void {
    useStore.getState().select({ kind: 'incident', id });
    const st = useStore.getState();
    if (!st.rightOpen) st.toggleRight();
    if (!focus) return;
    const inc = dmFor(this.engine).s.incidents[id];
    const js = inc?.area.junctions ?? [];
    if (js.length) {
      const c = this.centroid(js);
      this.focusSim(c.x, c.y, js.length > 1 ? 520 : 260, 0.72);
    } else if (inc?.area.links?.length || inc?.area.lanes?.length) {
      const l = getNetwork().links[inc.area.links?.[0] ?? inc.area.lanes![0].link];
      this.focusSim((l.start.x + l.end.x) / 2, (l.start.y + l.end.y) / 2, 260, 0.7);
    }
  }

  /** Incident focus camera: the most recent active incident, else the most recent one. */
  focusIncident(): boolean {
    const incs = Object.values(dmFor(this.engine).s.incidents);
    const inc = [...incs].reverse().find((i) => i.status === 'active') ?? incs[incs.length - 1];
    if (!inc) return false;
    this.selectIncident(inc.id);
    return true;
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
    this.publishFrames();
  }

  private tickAt(now: number, maxDt: number, fromRaf: boolean): void {
    const dt = Math.min(maxDt, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    this.frame(dt, fromRaf, now / 1000);
  }

  private frame(dt: number, fromRaf: boolean, wall: number): void {
    const t0 = performance.now();
    this.advance(dt);
    const simMs = performance.now() - t0;
    this.simMs = this.simMs * 0.9 + simMs * 0.1;
    const st = useStore.getState();
    let stats = null;
    if (this.world && st.view === 'twin') {
      this.city?.setDark(this.engine.state.road.dark);
      this.city?.update(this.renderT, (j) => this.engine.signal(j));
      this.overlays?.setCameraDistance(this.world.rig.pose.dist);
      this.overlays?.update(this.engine.state.road.dark, dmFor(this.engine).s.pulses, this.renderT, wall);
      this.overlays?.updateCorridor(this.corridorPath());
      this.vehicles?.setCameraDistance(this.world.rig.pose.dist);
      this.vehicles?.draw(this.engine, this.alpha(), wall);
      stats = this.world.frame(dt);
    }

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
    if (this.uiAccum >= 0.125) {
      this.uiAccum = 0;
      this.publishClock();
      this.publishFrames();
      if (st.perfOpen && stats) {
        st.setPerf({
          fps: this.fps,
          frameMs: 1000 / Math.max(1, this.fps),
          calls: stats.calls,
          tris: stats.tris,
          geometries: stats.geometries,
          textures: stats.textures,
          simMs: this.simMs,
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
