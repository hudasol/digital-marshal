import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import * as THREE from 'three';
import { controller } from '../controller';
import { useStore } from '../store';
import { useT, type I18nKey } from '../i18n';
import { Icon, type IconName } from './Icons';
import { vehiclePose } from '../../render/vehicles';
import { getNetwork } from '../../core/network/build';
import type { TodKey } from '../../render/env/tod';

/* District map in the corner of the 3D view: roads, junctions (dark ones pulse red), closures,
   every vehicle, the ambulance's route, and the part of the city the camera is looking at.
   Clicking the map flies the camera there. The header also switches the lighting. */

const TOD: Array<{ key: TodKey; icon: IconName }> = [
  { key: 'day', icon: 'sun' },
  { key: 'golden', icon: 'sunset' },
  { key: 'dusk', icon: 'dusk' },
  { key: 'night', icon: 'moon' },
];

const ZOOMS = [1, 1.7, 2.8];

export function TimeOfDaySwitch({ compact = false }: { compact?: boolean }) {
  const t = useT();
  const tod = useStore((s) => s.tod);
  return (
    <div className={`tod ${compact ? 'compact' : ''}`} role="radiogroup" aria-label={t('tod.title')}>
      {TOD.map((o) => (
        <button
          key={o.key}
          role="radio"
          aria-checked={tod === o.key}
          tabIndex={tod === o.key ? 0 : -1}
          title={t(`tod.${o.key}` as I18nKey)}
          aria-label={t(`tod.${o.key}` as I18nKey)}
          onClick={() => controller.setTimeOfDay(o.key)}
          onKeyDown={(e) => {
            const i = TOD.findIndex((x) => x.key === tod);
            const rtl = getComputedStyle(e.currentTarget).direction === 'rtl';
            const step = e.key === 'ArrowRight' ? (rtl ? -1 : 1) : e.key === 'ArrowLeft' ? (rtl ? 1 : -1) : 0;
            if (!step) return;
            e.preventDefault();
            const next = TOD[(i + step + TOD.length) % TOD.length];
            controller.setTimeOfDay(next.key);
            (e.currentTarget.parentElement?.querySelectorAll('button')[TOD.indexOf(next)] as HTMLButtonElement | undefined)?.focus();
          }}
        >
          <Icon name={o.icon} />
          {!compact && <span>{t(`tod.${o.key}` as I18nKey)}</span>}
        </button>
      ))}
    </div>
  );
}

export function Minimap() {
  const t = useT();
  const canvas = useRef<HTMLCanvasElement>(null);
  const [zoom, setZoom] = useState(0);
  const [open, setOpen] = useState(() => typeof window === 'undefined' || window.innerWidth > 1100);
  const view = useRef({ cx: 0, cy: 0, k: 1, ox: 0, oy: 0 });

  useEffect(() => {
    const c = canvas.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx || !open) return;
    let raf = 0;
    let last = 0;
    const ray = new THREE.Raycaster();
    const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const hit = new THREE.Vector3();
    const ndc = new THREE.Vector2();
    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      if (now - last < 80) return; // about 12 frames per second is plenty for a map
      last = now;
      const e = controller.engine;
      const net = getNetwork();
      const st = e.state;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = c.clientWidth;
      const h = c.clientHeight;
      if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
        c.width = Math.round(w * dpr);
        c.height = Math.round(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const b = net.bounds;
      const z = ZOOMS[zoom];
      const k0 = Math.min((w - 16) / (b.maxX - b.minX), (h - 16) / (b.maxY - b.minY));
      const k = k0 * z;
      const rig = controller.world?.rig;
      // at zoom 1 the whole district fits; zoomed in, the map centres on what the camera looks at
      let cx = (b.minX + b.maxX) / 2;
      let cy = (b.minY + b.maxY) / 2;
      if (z > 1 && rig) {
        cx = THREE.MathUtils.clamp(rig.pose.tx, b.minX + w / 2 / k, b.maxX - w / 2 / k);
        cy = THREE.MathUtils.clamp(-rig.pose.tz, b.minY + h / 2 / k, b.maxY - h / 2 / k);
      }
      const ox = w / 2 - cx * k;
      const oy = h / 2 + cy * k;
      view.current = { cx, cy, k, ox, oy };
      const X = (x: number) => ox + x * k;
      const Y = (y: number) => oy - y * k;
      // roads
      ctx.lineCap = 'round';
      for (const id of net.linkIds) {
        const l = net.links[id];
        if (l.dir.x < 0 || l.dir.y < 0) continue; // one stroke per road segment
        ctx.strokeStyle = 'rgba(148, 163, 184, 0.34)';
        ctx.lineWidth = Math.max(1.2, l.halfWidth * 2 * k);
        ctx.beginPath();
        ctx.moveTo(X(l.start.x - l.dir.x * 30), Y(l.start.y - l.dir.y * 30));
        ctx.lineTo(X(l.end.x + l.dir.x * 30), Y(l.end.y + l.dir.y * 30));
        ctx.stroke();
      }
      // the ambulance's corridor
      const dm = useStore.getState().dm;
      if (dm?.ev?.active) {
        ctx.strokeStyle = 'rgba(255, 82, 72, 0.95)';
        ctx.lineWidth = Math.max(2.4, 5 * k);
        ctx.shadowColor = 'rgba(255, 70, 60, 0.8)';
        ctx.shadowBlur = 6;
        ctx.beginPath();
        dm.ev.route.forEach((lid, i) => {
          const l = net.links[lid];
          if (!l) return;
          const off = l.laneOffsets[0];
          const ax = l.start.x + l.right.x * off;
          const ay = l.start.y + l.right.y * off;
          if (i === 0) ctx.moveTo(X(ax), Y(ay));
          else ctx.lineTo(X(ax), Y(ay));
          ctx.lineTo(X(l.end.x + l.right.x * off), Y(l.end.y + l.right.y * off));
        });
        ctx.stroke();
        ctx.shadowBlur = 0;
      }
      // closures
      ctx.strokeStyle = '#f08a2a';
      for (const cl of st.road.closures) {
        const l = net.links[cl.link];
        if (!l) continue;
        const offs = cl.lanes.map((q) => l.laneOffsets[q]);
        const off = (Math.min(...offs) + Math.max(...offs)) / 2;
        ctx.lineWidth = Math.max(2.5, cl.lanes.length * 3.5 * k);
        ctx.beginPath();
        ctx.moveTo(X(l.start.x + l.dir.x * cl.s0 + l.right.x * off), Y(l.start.y + l.dir.y * cl.s0 + l.right.y * off));
        ctx.lineTo(X(l.start.x + l.dir.x * cl.s1 + l.right.x * off), Y(l.start.y + l.dir.y * cl.s1 + l.right.y * off));
        ctx.stroke();
      }
      // junctions
      const pulse = 0.55 + 0.45 * Math.sin(now / 260);
      for (const id of net.junctionIds) {
        const j = net.junctions[id];
        const isDark = st.road.dark.includes(id);
        if (isDark) {
          ctx.fillStyle = `rgba(239, 83, 80, ${0.35 + 0.4 * pulse})`;
          ctx.beginPath();
          ctx.arc(X(j.x), Y(j.y), Math.max(5, 26 * k) * (0.9 + 0.2 * pulse), 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = isDark ? '#ff6b66' : 'rgba(69, 212, 232, 0.85)';
        ctx.fillRect(X(j.x) - 1.6, Y(j.y) - 1.6, 3.2, 3.2);
      }
      // vehicles
      for (const vid of st.order) {
        const v = st.vehicles[vid];
        const p = vehiclePose(e, v);
        const amb = v.cls === 'ambulance';
        ctx.fillStyle = amb ? '#ff5248' : v.mode === 'mrc' ? '#ff8a85' : v.av ? '#45d4e8' : 'rgba(214, 222, 232, 0.8)';
        ctx.beginPath();
        ctx.arc(X(p.x), Y(p.y), amb ? 3.6 : v.av ? 1.7 : 1.3, 0, Math.PI * 2);
        ctx.fill();
        if (amb) {
          ctx.strokeStyle = `rgba(255, 82, 72, ${0.6 * pulse})`;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(X(p.x), Y(p.y), 6 + 4 * pulse, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
      // what the camera sees: the ground footprint of the view
      const cam = rig?.camera;
      if (cam) {
        const pts: Array<[number, number]> = [];
        for (const [nx, ny] of [
          [-1, -1],
          [1, -1],
          [1, 1],
          [-1, 1],
        ]) {
          ndc.set(nx, ny);
          ray.setFromCamera(ndc, cam);
          if (ray.ray.direction.y < -0.02 && ray.ray.intersectPlane(ground, hit)) pts.push([hit.x, -hit.z]);
          else {
            const d = ray.ray.direction.clone().setY(0).normalize().multiplyScalar(2600);
            pts.push([cam.position.x + d.x, -(cam.position.z + d.z)]);
          }
        }
        ctx.fillStyle = 'rgba(69, 212, 232, 0.1)';
        ctx.strokeStyle = 'rgba(69, 212, 232, 0.75)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        pts.forEach(([x, y], i) => (i ? ctx.lineTo(X(x), Y(y)) : ctx.moveTo(X(x), Y(y))));
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#f3f6f9';
        ctx.beginPath();
        ctx.arc(X(cam.position.x), Y(-cam.position.z), 2.6, 0, Math.PI * 2);
        ctx.fill();
      }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [zoom, open]);

  const onPointer = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const { k, ox, oy } = view.current;
    const x = (e.clientX - r.left - ox) / k;
    const y = -(e.clientY - r.top - oy) / k;
    const rig = controller.world?.rig;
    controller.focusSim(x, y, Math.min(rig?.pose.dist ?? 600, 900), Math.max(0.5, rig?.pose.pitch ?? 0.62));
  };

  return (
    <section className={`minimap glass ${open ? '' : 'closed'}`} aria-label={t('map.title')}>
      <header className="minimap-head">
        <button className="minimap-title" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          <Icon name="map" />
          <span>{t('map.title')}</span>
        </button>
        <span className="spacer" />
        <TimeOfDaySwitch compact />
      </header>
      {open && (
        <div className="minimap-body">
          {/* a pointer shortcut for moving the camera: keyboard users have the camera modes and arrow keys */}
          <canvas ref={canvas} className="minimap-canvas" onPointerUp={onPointer} title={t('map.hint')} aria-hidden="true" />
          <div className="minimap-tools">
            <button onClick={() => setZoom((z) => Math.min(ZOOMS.length - 1, z + 1))} disabled={zoom === ZOOMS.length - 1} aria-label={t('map.zoomIn')} title={t('map.zoomIn')}>
              <Icon name="plus" />
            </button>
            <button onClick={() => setZoom((z) => Math.max(0, z - 1))} disabled={zoom === 0} aria-label={t('map.zoomOut')} title={t('map.zoomOut')}>
              <Icon name="minus" />
            </button>
            <button onClick={() => setZoom(1)} aria-label={t('map.locate')} title={t('map.locate')}>
              <Icon name="locate" />
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
