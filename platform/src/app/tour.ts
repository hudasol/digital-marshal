import { controller } from './controller';
import { useStore, type ScenarioKey } from './store';
import { BLACKOUT_JUNCTIONS } from '../core/network/district';

/* Judge mode: a guided tour of about five minutes that drives the real simulation. Every scene
   starts from a clean run (same seed, policy C) and triggers its scenario through the same controller
   calls as the buttons, so what the tour shows is exactly what the interface does. Scenes can be
   skipped, revisited or paused, and the tour can be left at any time. */

export type TourStepId = 'intro' | 'traffic' | 'blackout' | 'emergency' | 'roadworks' | 'security' | 'evidence' | 'about';

interface Beat {
  at: number; // seconds into the scene
  run: () => void;
}

export interface TourStep {
  id: TourStepId;
  duration: number; // seconds
  beats: Beat[];
}

/** Start a scene from a clean run in the twin view. */
function scene(scenario: ScenarioKey): void {
  const st = useStore.getState();
  st.setView('twin');
  st.setScenario(scenario);
  if (!st.leftOpen) st.toggleLeft();
  controller.resetScenario();
  controller.setSpeed(1);
  if (!controller.playing) controller.togglePlay();
}

function scrollView(selector: string, offset = 70): void {
  const view = document.querySelector('.view');
  const el = document.querySelector(selector);
  if (view && el) view.scrollTo({ top: (el as HTMLElement).offsetTop - offset, behavior: 'smooth' });
}

function scrollPanel(text: string): void {
  const body = document.querySelector('.panel.left .panel-body');
  const sec = [...document.querySelectorAll('.panel.left .section')].find((s) => s.textContent?.includes(text));
  if (body && sec) body.scrollTo({ top: (sec as HTMLElement).offsetTop - 50, behavior: 'smooth' });
}

/** A robotaxi moving on the boulevard, for the follow camera. */
function pickRobotaxi(): number | null {
  const e = controller.engine;
  let best: number | null = null;
  let bestScore = -Infinity;
  for (const id of e.state.order) {
    const v = e.state.vehicles[id];
    if (v.cls !== 'robotaxi' || v.seg.k !== 'L') continue;
    const l = e.net.links[v.seg.id];
    if (l.cls !== 'arterial') continue;
    const score = v.v + (l.length - v.s) / 50;
    if (score > bestScore) {
      bestScore = score;
      best = id;
    }
  }
  return best;
}

export const TOUR: TourStep[] = [
  {
    id: 'intro',
    duration: 24,
    beats: [
      {
        at: 0,
        run: () => {
          controller.setPolicy('C');
          scene('normal');
          const rig = controller.world?.rig;
          const ov = rig?.getPreset('overview');
          if (rig && ov) {
            rig.pose = { ...ov, dist: ov.dist * 1.45, pitch: ov.pitch + 0.18, yaw: ov.yaw - 0.4 };
            rig.flyTo(ov, { duration: rig.reducedMotion ? 0.001 : 6, hop: false });
            useStore.getState().setCamMode('overview');
          }
        },
      },
      { at: 13, run: () => controller.world?.rig.flyTo({ tx: -40, ty: 0, tz: 20, yaw: 0.62, pitch: 0.46, dist: 760, fov: 40 }, { duration: 5 }) },
    ],
  },
  {
    id: 'traffic',
    duration: 26,
    beats: [
      {
        at: 0,
        run: () => {
          useStore.getState().setView('twin');
          const id = pickRobotaxi();
          if (id !== null) {
            controller.selectVehicle(id);
            const st = useStore.getState();
            if (!st.rightOpen) st.toggleRight();
            controller.setCamMode('follow');
          }
        },
      },
    ],
  },
  {
    id: 'blackout',
    duration: 50,
    beats: [
      {
        at: 0,
        run: () => {
          scene('blackout');
          controller.triggerBlackout([...BLACKOUT_JUNCTIONS], 420);
        },
      },
      { at: 8, run: () => controller.setSpeed(2) },
      { at: 24, run: () => controller.focusIncident() },
      { at: 44, run: () => controller.setSpeed(1) },
    ],
  },
  {
    id: 'emergency',
    duration: 48,
    beats: [
      {
        at: 0,
        run: () => {
          scene('emergency');
          controller.dispatchAmbulance();
        },
      },
      { at: 2, run: () => controller.setCamMode('emergency') },
    ],
  },
  {
    id: 'roadworks',
    duration: 44,
    beats: [
      {
        at: 0,
        run: () => {
          scene('roadworks');
          controller.planWorks('lane');
          controller.setSpeed(2);
        },
      },
      { at: 21, run: () => controller.planWorks('full') },
      { at: 38, run: () => controller.setSpeed(1) },
    ],
  },
  {
    id: 'security',
    duration: 30,
    beats: [
      {
        at: 0,
        run: () => {
          scene('roadworks');
          controller.planWorks('lane');
        },
      },
      { at: 2, run: () => scrollPanel('Message security') },
      { at: 3, run: () => controller.injectTest('tampered') },
      { at: 6, run: () => controller.injectTest('rogue') },
      { at: 9, run: () => controller.injectTest('scope') },
      { at: 12, run: () => controller.injectTest('stale') },
    ],
  },
  {
    id: 'evidence',
    duration: 40,
    beats: [
      { at: 0, run: () => useStore.getState().setView('compare') },
      { at: 13, run: () => scrollView('#bm-blackout') },
      { at: 27, run: () => scrollView('#bm-emergency') },
    ],
  },
  {
    id: 'about',
    duration: 24,
    beats: [{ at: 0, run: () => useStore.getState().setView('about') }],
  },
];

class TourRunner {
  private step = 0;
  private elapsed = 0;
  private fired = new Set<number>();
  private timer = 0;
  private last = 0;
  private paused = false;

  get active(): boolean {
    return useStore.getState().tour !== null;
  }

  start(from = 0): void {
    this.stopTimer();
    this.paused = false;
    this.last = performance.now();
    this.timer = window.setInterval(() => this.tick(), 100);
    this.goto(from);
  }

  goto(i: number): void {
    this.step = Math.max(0, Math.min(TOUR.length - 1, i));
    this.elapsed = 0;
    this.fired.clear();
    this.last = performance.now();
    this.fire();
    this.publish(false);
  }

  next(): void {
    if (this.step >= TOUR.length - 1) this.finish();
    else this.goto(this.step + 1);
  }

  prev(): void {
    this.goto(this.step - 1);
  }

  togglePause(): void {
    this.paused = !this.paused;
    this.last = performance.now();
    this.publish(false);
  }

  stop(): void {
    this.stopTimer();
    useStore.getState().setTour(null);
  }

  private finish(): void {
    this.stopTimer();
    useStore.getState().setTour({ step: this.step, elapsed: TOUR[this.step].duration, paused: false, done: true });
  }

  private stopTimer(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = 0;
  }

  private fire(): void {
    const s = TOUR[this.step];
    s.beats.forEach((b, k) => {
      if (!this.fired.has(k) && this.elapsed >= b.at) {
        this.fired.add(k);
        try {
          b.run();
        } catch (err) {
          console.error('tour beat failed', s.id, err);
        }
      }
    });
  }

  private tick(): void {
    const now = performance.now();
    const dt = Math.min(0.5, (now - this.last) / 1000);
    this.last = now;
    if (this.paused) return;
    this.elapsed += dt;
    this.fire();
    if (this.elapsed >= TOUR[this.step].duration) {
      this.next();
      return;
    }
    this.publish(false);
  }

  private publish(done: boolean): void {
    useStore.getState().setTour({ step: this.step, elapsed: this.elapsed, paused: this.paused, done });
  }
}

export const tour = new TourRunner();
