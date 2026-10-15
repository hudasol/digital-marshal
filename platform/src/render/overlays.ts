import * as THREE from 'three';
import type { Network } from '../core/network/types';
import type { Pulse } from '../core/dm/types';

/* Information overlays. These are illustrative: an expanding ring marks that a message was put on
   the air at a roadside unit; it is not a model of radio propagation. Zones mark the junctions an
   active incident covers. All of it can be switched off. */

const ZONE_COLOR = new THREE.Color(1.0, 0.36, 0.3);
const PULSE_COLORS: Record<Pulse['kind'], THREE.Color> = {
  publish: new THREE.Color(0.35, 2.2, 2.6),
  rsu: new THREE.Color(0.35, 2.2, 2.6),
  authorize: new THREE.Color(0.4, 2.4, 1.2),
  reject: new THREE.Color(2.6, 0.5, 0.4),
};

export class OverlayLayer {
  readonly group = new THREE.Group();
  private net: Network;
  private zones = new Map<string, THREE.Group>();
  private pulsePool: THREE.Mesh[] = [];
  private pulseGeo = new THREE.RingGeometry(0.94, 1, 64);
  enabled = true;

  constructor(net: Network) {
    this.net = net;
    this.group.name = 'overlays';
    this.pulseGeo.rotateX(-Math.PI / 2);
  }

  private zone(jid: string): THREE.Group {
    let z = this.zones.get(jid);
    if (z) return z;
    const j = this.net.junctions[jid];
    z = new THREE.Group();
    const w = j.boxHalfX * 2 + 10;
    const d = j.boxHalfY * 2 + 10;
    const fill = new THREE.Mesh(
      new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: ZONE_COLOR, transparent: true, opacity: 0.12, depthWrite: false }),
    );
    fill.position.y = 0.09;
    fill.renderOrder = 3;
    const edgeGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(w, 0.01, d));
    const edge = new THREE.LineSegments(edgeGeo, new THREE.LineBasicMaterial({ color: ZONE_COLOR, transparent: true, opacity: 0.85 }));
    edge.position.y = 0.12;
    // a tall thin beacon so the affected junctions can be found from the overview
    const beacon = new THREE.Mesh(
      new THREE.CylinderGeometry(1.2, 1.2, 60, 12, 1, true),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 0.4, 0.3), transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide }),
    );
    beacon.position.y = 30;
    z.add(fill, edge, beacon);
    z.position.set(j.x, 0, -j.y);
    z.userData = { fill, edge, beacon };
    this.group.add(z);
    this.zones.set(jid, z);
    return z;
  }

  private camDist = 1000;
  setCameraDistance(d: number): void {
    this.camDist = d;
  }

  /** Refresh for the current frame. */
  update(dark: string[], pulses: Pulse[], simT: number, wall: number): void {
    // zones for dark junctions
    for (const [jid, z] of this.zones) z.visible = this.enabled && dark.includes(jid);
    if (this.enabled) {
      const k = 0.5 + 0.5 * Math.sin(wall * 3.2);
      for (const jid of dark) {
        const z = this.zone(jid);
        z.visible = true;
        const { fill, edge, beacon } = z.userData as { fill: THREE.Mesh; edge: THREE.LineSegments; beacon: THREE.Mesh };
        // subtle up close, findable from afar: the beacon only appears at overview distances
        const far = Math.max(0, Math.min(1, (this.camDist - 260) / 500));
        (fill.material as THREE.MeshBasicMaterial).opacity = 0.035 + 0.04 * k;
        (edge.material as THREE.LineBasicMaterial).opacity = 0.45 + 0.4 * k;
        (beacon.material as THREE.MeshBasicMaterial).opacity = far * (0.1 + 0.12 * k);
        beacon.visible = far > 0.01;
      }
    }
    // message pulses within the last 2.4 s of simulated time
    let n = 0;
    if (this.enabled) {
      for (let i = pulses.length - 1; i >= 0 && n < 60; i--) {
        const p = pulses[i];
        const age = simT - p.t;
        if (age < 0) continue;
        if (age > 2.4) break;
        const mesh = this.pulse(n++);
        const f = age / 2.4;
        const r = 6 + f * 70;
        mesh.scale.set(r, 1, r);
        mesh.position.set(p.x, 0.25 + n * 0.002, -p.y);
        const mat = mesh.material as THREE.MeshBasicMaterial;
        mat.color.copy(PULSE_COLORS[p.kind]);
        mat.opacity = (1 - f) * 0.85;
        mesh.visible = true;
      }
    }
    for (let i = n; i < this.pulsePool.length; i++) this.pulsePool[i].visible = false;
  }

  private pulse(i: number): THREE.Mesh {
    while (this.pulsePool.length <= i) {
      const m = new THREE.Mesh(this.pulseGeo, new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, toneMapped: true }));
      m.renderOrder = 6;
      m.visible = false;
      this.group.add(m);
      this.pulsePool.push(m);
    }
    return this.pulsePool[i];
  }
}
