import { useEffect, useRef } from 'react';
import { controller } from '../controller';
import { useT } from '../i18n';
import { vehiclePose } from '../../render/vehicles';
import type { VehicleClass } from '../../core/sim/types';

/* Without WebGL the simulation still runs; this draws the same live state as a 2D map: roads by
   width, junctions (dark ones in red), closures, and every vehicle as a dot. */

const CLASS_COLOR: Record<VehicleClass, string> = {
  robotaxi: '#45d4e8',
  car: '#c3cdd8',
  van: '#a78bfa',
  bus: '#f4b740',
  ambulance: '#ffffff',
};

export function MapFallback() {
  const t = useT();
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const e = controller.engine;
      const net = e.net;
      const st = e.state;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = '#0b1119';
      ctx.fillRect(0, 0, w, h);
      const b = net.bounds;
      const pad = 28;
      const k = Math.min((w - 2 * pad) / (b.maxX - b.minX), (h - 2 * pad) / (b.maxY - b.minY));
      const ox = (w - (b.maxX - b.minX) * k) / 2 - b.minX * k;
      const oy = (h + (b.maxY - b.minY) * k) / 2 + b.minY * k;
      const X = (x: number) => ox + x * k;
      const Y = (y: number) => oy - y * k;
      // roads: one stroke per direction, as wide as its lanes
      ctx.lineCap = 'butt';
      for (const id of net.linkIds) {
        const l = net.links[id];
        const off = (l.laneOffsets[0] + l.laneOffsets[l.lanes - 1]) / 2;
        ctx.strokeStyle = 'rgba(148, 163, 184, 0.28)';
        ctx.lineWidth = Math.max(1, l.lanes * 3.5 * k);
        ctx.beginPath();
        ctx.moveTo(X(l.start.x + l.right.x * off), Y(l.start.y + l.right.y * off));
        ctx.lineTo(X(l.end.x + l.right.x * off), Y(l.end.y + l.right.y * off));
        ctx.stroke();
      }
      // closures on the road
      ctx.strokeStyle = '#e0702a';
      for (const c of st.road.closures) {
        const l = net.links[c.link];
        const offs = c.lanes.map((q) => l.laneOffsets[q]);
        const off = (Math.min(...offs) + Math.max(...offs)) / 2;
        ctx.lineWidth = Math.max(2, c.lanes.length * 3.5 * k);
        ctx.beginPath();
        ctx.moveTo(X(l.start.x + l.dir.x * c.s0 + l.right.x * off), Y(l.start.y + l.dir.y * c.s0 + l.right.y * off));
        ctx.lineTo(X(l.start.x + l.dir.x * c.s1 + l.right.x * off), Y(l.start.y + l.dir.y * c.s1 + l.right.y * off));
        ctx.stroke();
      }
      // junctions
      for (const id of net.junctionIds) {
        const j = net.junctions[id];
        const dark = st.road.dark.includes(id);
        ctx.fillStyle = dark ? 'rgba(239, 83, 80, 0.55)' : 'rgba(148, 163, 184, 0.18)';
        ctx.fillRect(X(j.x - j.boxHalfX), Y(j.y + j.boxHalfY), j.boxHalfX * 2 * k, j.boxHalfY * 2 * k);
        ctx.fillStyle = dark ? '#ef5350' : 'rgba(195, 205, 216, 0.75)';
        ctx.font = '600 11px "JetBrains Mono Variable", monospace';
        ctx.fillText(id, X(j.x + j.boxHalfX) + 3, Y(j.y + j.boxHalfY) - 3);
      }
      // vehicles
      const r = Math.max(1.6, 1.1 * k);
      for (const vid of st.order) {
        const v = st.vehicles[vid];
        const p = vehiclePose(e, v);
        ctx.fillStyle = v.mode === 'mrc' ? '#ef5350' : CLASS_COLOR[v.cls];
        ctx.beginPath();
        ctx.arc(X(p.x), Y(p.y), v.cls === 'ambulance' ? r * 2 : r, 0, Math.PI * 2);
        ctx.fill();
      }
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, []);
  return <canvas ref={ref} className="map2d" role="img" aria-label={t('nowebgl.map')} />;
}
