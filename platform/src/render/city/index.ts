import * as THREE from 'three';
import type { Network } from '../../core/network/types';
import { aspectFor, signalState, type SignalState } from '../../core/sim/signals';
import { buildRoads } from './roads';
import { buildBlocks, type Bound, type BlockOutput } from './blocks';
import { buildBuildings, type Placed } from './buildings';
import { buildFurniture, type FurnitureLayer } from './furniture';
import { buildContext, type ContextLayer } from './context';
import { TRAFFIC_CLOCK } from './traffic';
import { buildStreetDetails } from './streetDetails';
import { asphaltTexture, grassTexture, groundTexture, labelTexture, pavingTexture, plazaTexture } from './textures';
import type { QualityProfile } from '../quality';
import type { Kit } from '../kit/kit';

/* The whole static city plus the live signal lamps. Built once from the network and the kit. */

export class CityRenderer {
  readonly group = new THREE.Group();
  readonly labels = new THREE.Group();
  readonly net: Network;
  readonly placed: Placed[];
  private furniture: FurnitureLayer;
  private context: ContextLayer;
  private blocks: BlockOutput;
  private details: { group: THREE.Group; update: () => void };
  private bounds: Bound[];
  private darkJunctions = new Set<string>();
  private lodRadius = 520;
  private readonly obsRay = new THREE.Ray();
  private readonly obsBox = new THREE.Box3();
  private readonly obsHit = new THREE.Vector3();

  constructor(net: Network, maxAnisotropy: number, quality: QualityProfile, kit: Kit | null) {
    this.net = net;
    this.group.name = 'city';
    const an = Math.min(8, maxAnisotropy);
    const tile = (t: THREE.Texture) => {
      t.anisotropy = an;
      return t;
    };

    const roads = buildRoads(net, an);
    this.group.add(roads.group);

    this.blocks = buildBlocks(net, {
      paving: tile(pavingTexture()),
      plaza: tile(plazaTexture()),
      ground: tile(groundTexture()),
      grass: tile(grassTexture()),
      asphalt: tile(asphaltTexture()),
    });
    this.group.add(this.blocks.group);

    const fallback = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.1 });
    const buildings = buildBuildings(this.blocks.specs, kit, fallback);
    this.group.add(buildings.group);
    this.placed = buildings.placed;
    this.bounds = [...this.blocks.bounds, ...buildings.bounds];

    this.details = buildStreetDetails(net);
    this.group.add(this.details.group);

    this.furniture = buildFurniture(net, this.blocks.trees, this.blocks.palms, this.blocks.benches, buildings.roofs, quality.propDensity, kit);
    this.group.add(this.furniture.group);

    this.context = buildContext(kit);
    this.group.add(this.context.group);

    this.buildLabels();
    this.labels.visible = false;
    this.group.add(this.labels);
    this.setQuality(quality);
  }

  private buildLabels(): void {
    for (const jid of this.net.junctionIds) {
      const j = this.net.junctions[jid];
      const [, ...rest] = j.label.split(' ');
      const tex = labelTexture(jid, rest.join(' '));
      // constant on-screen size: readable from the overview and unobtrusive up close
      const sp = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: tex, depthWrite: false, depthTest: false, transparent: true, sizeAttenuation: false }),
      );
      const aspect = tex.image.width / tex.image.height;
      sp.scale.set(0.028 * aspect, 0.028, 1);
      sp.center.set(0.5, 0);
      sp.position.set(j.x, 18, -j.y);
      sp.renderOrder = 20;
      this.labels.add(sp);
    }
  }

  setLabels(on: boolean): void {
    this.labels.visible = on;
  }

  setQuality(q: QualityProfile): void {
    this.context.setDetail(q.farBuildings);
    this.lodRadius = q.tier === 'high' ? 620 : q.tier === 'balanced' ? 420 : 0;
    this.furniture.setPools(q.lightPools);
  }

  setDark(junctions: Iterable<string>): void {
    this.darkJunctions = new Set(junctions);
  }

  /** Update live elements for simulation time t; `stateOf` supplies the simulation's own signal state. */
  update(t: number, camera: THREE.Camera, stateOf?: (jid: string) => SignalState): void {
    TRAFFIC_CLOCK.value = t;
    const states: Record<string, SignalState> = {};
    for (const jid of this.net.junctionIds) {
      states[jid] = stateOf ? stateOf(jid) : signalState(this.net.junctions[jid], t, this.darkJunctions.has(jid));
    }
    this.furniture.setAspects((jid, inLink, turn) => aspectFor(this.net.junctions[jid], states[jid], inLink, turn), false);
    // roadside units: a slow breathing glow, dark when their junction has lost power
    const k = 0.75 + 0.25 * Math.sin(t * 2.1);
    const c = new THREE.Color();
    for (const jid of this.net.junctionIds) {
      const i = this.furniture.rsuIndex[jid];
      if (this.darkJunctions.has(jid)) c.setRGB(0.05, 0.05, 0.05);
      else c.setRGB(0.35 * k, 2.4 * k, 3.0 * k);
      this.furniture.rsuLeds.setColorAt(i, c);
    }
    if (this.furniture.rsuLeds.instanceColor) this.furniture.rsuLeds.instanceColor.needsUpdate = true;
    this.furniture.update(camera, this.lodRadius);
    this.details.update();
  }

  /** Distance from `from` toward `to` until a building is hit, for the camera; null when clear. */
  obstacle(from: THREE.Vector3, to: THREE.Vector3): number | null {
    // runs every frame on low camera shots (follow, street): scratch objects, and boxes off the
    // segment's ground footprint or below its lowest point are rejected before the ray test
    const ray = this.obsRay;
    const box = this.obsBox;
    const hit = this.obsHit;
    ray.origin.copy(from);
    ray.direction.subVectors(to, from);
    const len = ray.direction.length();
    if (len < 1e-6) return null;
    ray.direction.multiplyScalar(1 / len);
    const minX = Math.min(from.x, to.x);
    const maxX = Math.max(from.x, to.x);
    const minZ = Math.min(from.z, to.z);
    const maxZ = Math.max(from.z, to.z);
    const minY = Math.min(from.y, to.y);
    let best: number | null = null;
    for (const b of this.bounds) {
      if (b.x1 < minX || b.x0 > maxX || -b.y0 < minZ || -b.y1 > maxZ || b.h < minY) continue;
      box.min.set(b.x0, 0, -b.y1);
      box.max.set(b.x1, b.h, -b.y0);
      // a focus point inside a footprint (for example the centroid of an incident area) is not an obstacle
      if (box.containsPoint(from)) continue;
      if (ray.intersectBox(box, hit)) {
        const d = hit.distanceTo(from);
        if (d < len && (best === null || d < best)) best = d;
      }
    }
    return best;
  }

  get parkedSpots() {
    return this.blocks.parked;
  }
}
