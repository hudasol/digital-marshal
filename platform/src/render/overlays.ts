import * as THREE from 'three';
import type { Network } from '../core/network/types';
import type { Pulse } from '../core/dm/types';

/* Information overlays. These are illustrative: an expanding ring marks that a message was put on
   the air at a roadside unit; it is not a model of radio propagation. Zones mark the junctions an
   active incident covers. The corridor shows the lane the ambulance will use next, with chevrons
   running in its direction of travel. All of it can be switched off. */

const ZONE_COLOR = new THREE.Color(1.0, 0.36, 0.3);
const PULSE_COLORS: Record<Pulse['kind'], THREE.Color> = {
  publish: new THREE.Color(0.35, 2.2, 2.6),
  rsu: new THREE.Color(0.35, 2.2, 2.6),
  authorize: new THREE.Color(0.4, 2.4, 1.2),
  reject: new THREE.Color(2.6, 0.5, 0.4),
};

/** Soft expanding ring: bright leading edge, faint trail inside. */
const RING_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
varying vec2 vUv;
void main() {
  float r = length(vUv - 0.5) * 2.0;
  float edge = smoothstep(0.82, 0.97, r) * (1.0 - smoothstep(0.97, 1.0, r));
  float trail = smoothstep(0.2, 0.95, r) * (1.0 - smoothstep(0.95, 1.0, r)) * 0.18;
  gl_FragColor = vec4(uColor * (edge + trail), (edge + trail) * uOpacity);
}`;
const UV_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

/** Junction zone: a pulsing outline and hatched fill on the road surface. */
const ZONE_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uPulse;
uniform vec2 uSize;
varying vec2 vUv;
void main() {
  vec2 p = (vUv - 0.5) * uSize;
  vec2 d = uSize * 0.5 - abs(p);
  float edgeD = min(d.x, d.y);
  float outline = 1.0 - smoothstep(0.35, 0.9, edgeD);
  float hatch = step(0.5, fract((p.x + p.y) / 3.2)) * 0.22;
  float a = outline * (0.55 + 0.45 * uPulse) + hatch * (0.4 + 0.6 * uPulse) * smoothstep(0.0, 3.0, edgeD);
  gl_FragColor = vec4(uColor * a * 1.6, a);
}`;

export class OverlayLayer {
  readonly group = new THREE.Group();
  private net: Network;
  private zones = new Map<string, THREE.Group>();
  private pulsePool: THREE.Mesh[] = [];
  private pulseGeo = new THREE.PlaneGeometry(2, 2);
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
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: { uColor: { value: ZONE_COLOR.clone() }, uPulse: { value: 0 }, uSize: { value: new THREE.Vector2(w, d) } },
        vertexShader: UV_VERT,
        fragmentShader: ZONE_FRAG,
      }),
    );
    fill.position.y = 0.12;
    fill.renderOrder = 3;
    // a tall thin beacon so the affected junctions can be found from the overview
    const beacon = new THREE.Mesh(
      new THREE.CylinderGeometry(1.2, 1.2, 80, 12, 1, true),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(1.6, 0.4, 0.3),
        transparent: true,
        opacity: 0.18,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      }),
    );
    beacon.position.y = 40;
    z.add(fill, beacon);
    z.position.set(j.x, 0, -j.y);
    z.userData = { fill, beacon };
    z.traverse((o) => (o.userData.noAO = true));
    this.group.add(z);
    this.zones.set(jid, z);
    return z;
  }

  private camDist = 1000;
  private corridor: THREE.Mesh | null = null;

  /** The ambulance's lane ahead of it: a glowing strip with chevrons running forward. */
  updateCorridor(points: Array<{ x: number; y: number }> | null): void {
    if (!points || points.length < 2 || !this.enabled) {
      if (this.corridor) this.corridor.visible = false;
      return;
    }
    const n = points.length;
    const pos = new Float32Array(n * 2 * 3);
    const along = new Float32Array(n * 2 * 2);
    let s = 0;
    const half = 1.6;
    for (let i = 0; i < n; i++) {
      const a = points[Math.max(0, i - 1)];
      const b = points[Math.min(n - 1, i + 1)];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const L = Math.hypot(dx, dy) || 1;
      const rx = (dy / L) * half;
      const ry = (-dx / L) * half;
      const p = points[i];
      if (i > 0) s += Math.hypot(p.x - points[i - 1].x, p.y - points[i - 1].y);
      pos.set([p.x - rx, 0.13, -(p.y - ry), p.x + rx, 0.13, -(p.y + ry)], i * 6);
      along.set([s, -1, s, 1], i * 4);
    }
    const idx: number[] = [];
    for (let i = 0; i + 1 < n; i++) {
      const a = i * 2;
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
    if (!this.corridor) {
      const mat = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        // the strip is wound clockwise seen from above; draw both faces rather than depend on it
        side: THREE.DoubleSide,
        uniforms: { uTime: { value: 0 }, uLen: { value: 1 } },
        vertexShader: /* glsl */ `
          attribute vec2 aAlong;
          varying vec2 vA;
          void main() { vA = aAlong; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: /* glsl */ `
          uniform float uTime;
          uniform float uLen;
          varying vec2 vA;
          void main() {
            float s = vA.x;
            float x = vA.y;
            float fade = smoothstep(0.0, 6.0, s) * (1.0 - smoothstep(uLen * 0.55, uLen, s));
            float edge = smoothstep(0.72, 0.95, abs(x));
            // chevrons spaced 7 m, running ahead of the ambulance: the centre of each one leads its
            // arms, so the tip points the way the ambulance is going
            float u = fract((s - uTime * 9.0) / 7.0);
            float chev = u + abs(x) * 0.26;
            float band = smoothstep(0.42, 0.47, chev) * (1.0 - smoothstep(0.55, 0.6, chev)) * (1.0 - smoothstep(0.7, 0.85, abs(x)));
            vec3 red = vec3(1.0, 0.16, 0.12);
            vec3 col = red * (0.22 + edge * 1.4) + vec3(1.0, 0.55, 0.5) * band * 1.6;
            float a = (0.28 + edge * 0.7 + band) * fade;
            gl_FragColor = vec4(col * fade * 1.2, a);
          }`,
      });
      this.corridor = new THREE.Mesh(new THREE.BufferGeometry(), mat);
      this.corridor.frustumCulled = false;
      this.corridor.renderOrder = 7;
      this.corridor.userData.noAO = true;
      this.group.add(this.corridor);
    }
    const g = this.corridor.geometry;
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aAlong', new THREE.BufferAttribute(along, 2));
    g.setIndex(idx);
    const u = (this.corridor.material as THREE.ShaderMaterial).uniforms;
    u.uTime.value = performance.now() / 1000;
    u.uLen.value = Math.max(10, s);
    this.corridor.visible = true;
  }

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
        const { fill, beacon } = z.userData as { fill: THREE.Mesh; beacon: THREE.Mesh };
        (fill.material as THREE.ShaderMaterial).uniforms.uPulse.value = k;
        // subtle up close, findable from afar: the beacon only appears at overview distances
        const far = Math.max(0, Math.min(1, (this.camDist - 260) / 500));
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
        const u = (mesh.material as THREE.ShaderMaterial).uniforms;
        (u.uColor.value as THREE.Color).copy(PULSE_COLORS[p.kind]);
        u.uOpacity.value = (1 - f) * 0.9;
        mesh.visible = true;
      }
    }
    for (let i = n; i < this.pulsePool.length; i++) this.pulsePool[i].visible = false;
  }

  private pulse(i: number): THREE.Mesh {
    while (this.pulsePool.length <= i) {
      const m = new THREE.Mesh(
        this.pulseGeo,
        new THREE.ShaderMaterial({
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          uniforms: { uColor: { value: new THREE.Color() }, uOpacity: { value: 1 } },
          vertexShader: UV_VERT,
          fragmentShader: RING_FRAG,
        }),
      );
      m.renderOrder = 6;
      m.visible = false;
      m.userData.noAO = true;
      this.group.add(m);
      this.pulsePool.push(m);
    }
    return this.pulsePool[i];
  }
}
