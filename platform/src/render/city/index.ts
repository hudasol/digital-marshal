import * as THREE from 'three';
import type { Network } from '../../core/network/types';
import { aspectFor, signalState, type SignalState } from '../../core/sim/signals';
import { buildRoads } from './roads';
import { buildBlocks, type BlockOutput } from './blocks';
import { buildFurniture, type FurnitureLayer } from './furniture';
import { buildSkyline, type SkylineLayer } from './skyline';
import {
  asphaltTexture,
  decalTexture,
  glassFacade,
  grassTexture,
  labelTexture,
  pavingTexture,
  plotTexture,
  podiumFacade,
  stoneFacade,
} from './textures';
import type { QualityProfile } from '../quality';

/* The whole static city plus the live signal lamps. Built once from the network. */

export class CityRenderer {
  readonly group = new THREE.Group();
  readonly labels = new THREE.Group();
  readonly net: Network;
  private furniture: FurnitureLayer;
  private skyline: SkylineLayer;
  private blocks: BlockOutput;
  private darkJunctions = new Set<string>();
  private readonly obsRay = new THREE.Ray();
  private readonly obsBox = new THREE.Box3();
  private readonly obsHit = new THREE.Vector3();

  constructor(net: Network, maxAnisotropy: number, quality: QualityProfile) {
    this.net = net;
    this.group.name = 'city';
    const an = Math.min(8, maxAnisotropy);
    const tile = (t: THREE.Texture) => {
      t.anisotropy = an;
      return t;
    };
    const glass = glassFacade(31, [70, 98, 118]);
    const stone = stoneFacade(32, [222, 206, 178], true);
    const office = stoneFacade(33, [214, 210, 202], false);
    const podium = podiumFacade(34);
    [glass, stone, office, podium].forEach((f) => {
      tile(f.map);
      tile(f.emissive);
    });

    const roads = buildRoads(net, an);
    this.group.add(roads.group);

    this.blocks = buildBlocks(net, {
      glass,
      stone,
      office,
      podium,
      paving: tile(pavingTexture()),
      plot: tile(plotTexture()),
      grass: tile(grassTexture()),
      asphalt: tile(asphaltTexture()),
      helipad: decalTexture('helipad'),
      hospital: decalTexture('hospital'),
    });
    this.group.add(this.blocks.group);

    this.furniture = buildFurniture(net, this.blocks.trees, this.blocks.palms, quality.propDensity);
    this.group.add(this.furniture.group);

    this.skyline = buildSkyline(this.blocks.materials.glass, this.blocks.materials.office, this.blocks.materials.roof, [
      glass.tileW,
      glass.tileH,
    ]);
    this.skyline.far.visible = quality.farBuildings;
    this.group.add(this.skyline.group);

    this.buildLabels();
    this.labels.visible = false;
    this.group.add(this.labels);
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
    this.skyline.far.visible = q.farBuildings;
  }

  setDark(junctions: Iterable<string>): void {
    this.darkJunctions = new Set(junctions);
  }

  /** Update live elements for simulation time t; `stateOf` supplies the simulation's own signal state. */
  update(t: number, stateOf?: (jid: string) => SignalState): void {
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
    for (const b of this.blocks.bounds) {
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
