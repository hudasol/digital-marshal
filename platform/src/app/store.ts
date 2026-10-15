import { create } from 'zustand';
import type { NetworkFrame, VehicleFrame } from './frames';
import type { DmFrame, IncidentFrame, VehicleDmView } from './dmframes';
import type { SimEvent } from '../core/sim/types';

export type View = 'twin' | 'compare' | 'engineering' | 'about';
export type CamMode = 'overview' | 'topdown' | 'incident' | 'follow' | 'emergency' | 'street' | 'free';
export type QualityChoice = 'auto' | 'high' | 'balanced' | 'performance';
export type QualityTier = Exclude<QualityChoice, 'auto'>;

export interface PerfStats {
  fps: number;
  frameMs: number;
  calls: number;
  tris: number;
  geometries: number;
  textures: number;
  simMs: number;
  pixelRatio: number;
}

export interface ClockFrame {
  t: number; // simulation seconds since scenario start
  playing: boolean;
  speed: number;
  horizon: number; // furthest simulated time
}

export interface Overlays {
  labels: boolean; // junction ids and names in the 3D view
  v2x: boolean; // illustrative information-flow overlays
  routes: boolean; // planned routes of selected and affected vehicles
}

export type Selection = { kind: 'vehicle'; id: number } | { kind: 'incident'; id: string } | null;
export type ScenarioKey = 'normal' | 'blackout' | 'emergency' | 'roadworks';

export interface Marker {
  t: number;
  tone: 'info' | 'warn' | 'critical' | 'ok';
  label: string;
}

/** Judge mode: which scene of the guided tour is showing. */
export interface TourState {
  step: number;
  elapsed: number;
  paused: boolean;
  done: boolean;
}

export interface Toast {
  id: number;
  text: string;
  tone: 'info' | 'warn' | 'critical';
}

interface UIState {
  view: View;
  lang: 'en' | 'ar';
  leftOpen: boolean;
  rightOpen: boolean;
  camMode: CamMode;
  quality: QualityChoice;
  effectiveQuality: QualityTier;
  perfOpen: boolean;
  webgl: boolean;
  ready: boolean;
  clock: ClockFrame;
  perf: PerfStats;
  toasts: Toast[];
  scenarioLabel: string;
  alertLevel: 'normal' | 'warn' | 'critical';
  overlays: Overlays;
  selection: Selection;
  network: NetworkFrame | null;
  vehicle: VehicleFrame | null;
  busy: { label: string; progress: number } | null;
  dm: DmFrame | null;
  incident: IncidentFrame | null;
  vehicleDm: VehicleDmView | null;
  events: SimEvent[];
  markers: Marker[];
  scenario: ScenarioKey;
  engineering: boolean;
  tour: TourState | null;

  setView: (v: View) => void;
  setTour: (t: TourState | null) => void;
  setDmFrames: (dm: DmFrame | null, incident: IncidentFrame | null, vehicleDm: VehicleDmView | null, events: SimEvent[], markers: Marker[]) => void;
  setScenario: (s: ScenarioKey) => void;
  toggleEngineering: () => void;
  select: (s: Selection) => void;
  setFrames: (network: NetworkFrame | null, vehicle: VehicleFrame | null) => void;
  setBusy: (b: { label: string; progress: number } | null) => void;
  setOverlay: (k: keyof Overlays, on: boolean) => void;
  setLang: (l: 'en' | 'ar') => void;
  toggleLeft: () => void;
  toggleRight: () => void;
  setCamMode: (m: CamMode) => void;
  setQuality: (q: QualityChoice) => void;
  setEffectiveQuality: (q: QualityTier) => void;
  togglePerf: () => void;
  setWebgl: (ok: boolean) => void;
  setReady: () => void;
  setClock: (c: ClockFrame) => void;
  setPerf: (p: PerfStats) => void;
  pushToast: (text: string, tone?: Toast['tone']) => void;
}

let toastSeq = 1;

function initialLang(): 'en' | 'ar' {
  try {
    const saved = localStorage.getItem('dm.lang');
    if (saved === 'en' || saved === 'ar') return saved;
  } catch {
    /* storage unavailable: fall back to English */
  }
  return 'en';
}

function initialQuality(): QualityChoice {
  try {
    const saved = localStorage.getItem('dm.quality');
    if (saved === 'auto' || saved === 'high' || saved === 'balanced' || saved === 'performance') return saved;
  } catch {
    /* ignore */
  }
  return 'auto';
}

export const useStore = create<UIState>((set, get) => ({
  view: 'twin',
  lang: initialLang(),
  leftOpen: true,
  rightOpen: true,
  camMode: 'overview',
  quality: initialQuality(),
  effectiveQuality: 'balanced',
  perfOpen: false,
  webgl: true,
  ready: false,
  clock: { t: 0, playing: true, speed: 1, horizon: 0 },
  perf: { fps: 0, frameMs: 0, calls: 0, tris: 0, geometries: 0, textures: 0, simMs: 0, pixelRatio: 1 },
  toasts: [],
  scenarioLabel: '',
  alertLevel: 'normal',
  overlays: { labels: false, v2x: true, routes: true },
  selection: null,
  network: null,
  vehicle: null,
  busy: null,
  dm: null,
  incident: null,
  vehicleDm: null,
  events: [],
  markers: [],
  scenario: 'normal',
  engineering: false,
  tour: null,

  setView: (view) => set({ view }),
  setTour: (tour) => set({ tour }),
  select: (selection) => set({ selection, vehicle: selection?.kind === 'vehicle' ? get().vehicle : null }),
  setFrames: (network, vehicle) => set({ network, vehicle }),
  setBusy: (busy) => set({ busy }),
  setDmFrames: (dm, incident, vehicleDm, events, markers) => set({ dm, incident, vehicleDm, events, markers }),
  setScenario: (scenario) => set({ scenario }),
  toggleEngineering: () => set({ engineering: !get().engineering }),
  setOverlay: (k, on) => set({ overlays: { ...get().overlays, [k]: on } }),
  setLang: (lang) => {
    try {
      localStorage.setItem('dm.lang', lang);
    } catch {
      /* ignore */
    }
    set({ lang });
  },
  toggleLeft: () => set({ leftOpen: !get().leftOpen }),
  toggleRight: () => set({ rightOpen: !get().rightOpen }),
  setCamMode: (camMode) => set({ camMode }),
  setQuality: (quality) => {
    try {
      localStorage.setItem('dm.quality', quality);
    } catch {
      /* ignore */
    }
    set({ quality });
  },
  setEffectiveQuality: (effectiveQuality) => set({ effectiveQuality }),
  togglePerf: () => set({ perfOpen: !get().perfOpen }),
  setWebgl: (webgl) => set({ webgl }),
  setReady: () => set({ ready: true }),
  setClock: (clock) => set({ clock }),
  setPerf: (perf) => set({ perf }),
  pushToast: (text, tone = 'info') => {
    const id = toastSeq++;
    set({ toasts: [...get().toasts, { id, text, tone }] });
    setTimeout(() => set({ toasts: get().toasts.filter((x) => x.id !== id) }), 4200);
  },
}));
