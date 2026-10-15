import * as THREE from 'three';
import { GeoBuilder } from './builder';
import type { Kit } from '../kit/kit';
import { KitBatcher } from '../kit/batch';
import { buildOutskirts } from './outskirts';
import { buildTraffic } from './traffic';

/* Context beyond the simulated district: the surrounding city (streets painted by the terrain,
   buildings, palms and lamps in outskirts.ts, traffic in traffic.ts) and an island with a
   sail-shaped tower offshore. None of it is simulated, and none of it is a replica of a real
   building or place. */

export interface ContextLayer {
  group: THREE.Group;
  /** kit towers and palms on the higher tiers, box stand-ins on the lowest */
  setDetail(on: boolean): void;
}

export function buildContext(kit: Kit | null): ContextLayer {
  const group = new THREE.Group();
  group.name = 'context';

  // ---------------------------------------------------------------- the island and its sail-shaped tower
  const island = new GeoBuilder();
  const cx = -1720;
  const cy = 1460;
  island.setColor(0xe6d2a8);
  const pts: Array<[number, number]> = [];
  for (let i = 0; i < 40; i++) {
    const a = (i / 40) * Math.PI * 2;
    const k = 1 + 0.06 * Math.sin(a * 3);
    pts.push([cx + Math.cos(a) * 100 * k, cy + Math.sin(a) * 82 * k]);
  }
  island.prism(pts, -0.6, 2.5, 1, 1, true);
  // causeway to the shore
  island.setColor(0x8f9399).box(cx + 70, cy - 210, 12, 300, 0.5, 2.2, -0.35);
  const islandMesh = new THREE.Mesh(island.build(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92 }));
  islandMesh.name = 'island';
  islandMesh.receiveShadow = true;
  group.add(islandMesh);
  if (kit?.has('skyline_sail')) {
    const batch = new KitBatcher(kit, 5000);
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 2.4);
    batch.add({ node: 'skyline_sail', matrix: new THREE.Matrix4().compose(new THREE.Vector3(cx + 10, 0, -(cy + 5)), q, new THREE.Vector3(0.82, 0.82, 0.82)), seed: 5000, grid: [0.82, 0.82], shadow: false });
    group.add(batch.build('island-tower'));
  }

  // ---------------------------------------------------------------- the city around the district
  const outskirts = buildOutskirts(kit);
  group.add(outskirts.group);
  group.add(buildTraffic());

  group.traverse((o) => {
    o.updateMatrix();
    o.matrixAutoUpdate = false;
  });
  return {
    group,
    setDetail: (on) => outskirts.setDetail(on),
  };
}
