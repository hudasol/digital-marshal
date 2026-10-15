import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

/* The 3D asset kit: original procedural buildings, landmarks and props from the Encirra kit
   (public/models, see its README). Metres, +Y up, fronts face +Z, origins at the footprint centre
   on the ground. Loading is all or nothing per file: a file that fails keeps the procedural
   fallback for whatever needed it. */

export interface KitAsset {
  id: string;
  kind: string;
  variant: number;
  node: string;
  file: string;
  nominalSize?: [number, number, number];
  floors?: number;
  storeyHeight?: number;
  lobbyHeight?: number;
  roofY?: number;
  anchors?: Record<string, unknown>;
}

export interface KitPbr {
  baseColor?: string;
  roughness?: number;
  metalness?: number;
  emissive?: string;
  emissiveIntensity?: number;
  opacity?: number;
  transparent?: boolean;
  doubleSided?: boolean;
}

interface KitManifest {
  assets: KitAsset[];
  files: Record<string, { bytes: number; nodes: string[] }>;
  materialPBR?: Record<string, KitPbr>;
}

/** One mesh of a kit node, with its transform relative to the node. */
export interface KitPart {
  geometry: THREE.BufferGeometry;
  material: string;
  matrix: THREE.Matrix4;
}

export class Kit {
  private readonly nodes = new Map<string, THREE.Object3D>();
  private readonly parts = new Map<string, KitPart[]>();
  private readonly byId = new Map<string, KitAsset>();

  constructor(
    readonly assets: KitAsset[],
    readonly pbr: Record<string, KitPbr>,
    scenes: THREE.Object3D[],
  ) {
    for (const a of assets) this.byId.set(a.id, a);
    for (const s of scenes) for (const c of s.children) this.nodes.set(c.name, c);
  }

  has(node: string): boolean {
    return this.nodes.has(node);
  }

  asset(id: string): KitAsset | undefined {
    return this.byId.get(id);
  }

  /** Assets of one kind present in the loaded files, ordered by variant. */
  variants(kind: string): KitAsset[] {
    return this.assets.filter((a) => a.kind === kind && this.nodes.has(a.node)).sort((a, b) => a.variant - b.variant);
  }

  /** Meshes under a node, relative to the node itself (skyline nodes carry a placement we ignore). */
  partsOf(node: string): KitPart[] {
    const cached = this.parts.get(node);
    if (cached) return cached;
    const root = this.nodes.get(node);
    const out: KitPart[] = [];
    if (root) {
      root.updateMatrixWorld(true);
      const inv = root.matrixWorld.clone().invert();
      root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        const mats = Array.isArray(m.material) ? m.material : [m.material];
        for (const mat of mats) out.push({ geometry: m.geometry, material: mat.name, matrix: new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld) });
      });
    }
    this.parts.set(node, out);
    return out;
  }

  /** Axis-aligned size of a node in its own frame [x, y(height), z]. */
  sizeOf(node: string): THREE.Vector3 {
    const box = new THREE.Box3();
    for (const p of this.partsOf(node)) {
      p.geometry.computeBoundingBox();
      box.union(p.geometry.boundingBox!.clone().applyMatrix4(p.matrix));
    }
    return box.isEmpty() ? new THREE.Vector3() : box.getSize(new THREE.Vector3());
  }
}

/** Base URL of the kit, relative to the page so the build works from any sub path. */
export function kitBase(): string {
  return `${import.meta.env.BASE_URL}models/`;
}

/**
 * Load the manifest and every listed GLB. `onProgress` receives the share of bytes loaded (0..1).
 * Resolves to null when there is no manifest (the city then uses its procedural fallback).
 */
export async function loadKit(onProgress?: (k: number) => void, base = kitBase()): Promise<Kit | null> {
  let manifest: KitManifest;
  try {
    const r = await fetch(`${base}manifest.json`);
    if (!r.ok) return null;
    manifest = (await r.json()) as KitManifest;
  } catch {
    return null;
  }
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const files = Object.keys(manifest.files);
  const total = files.reduce((s, f) => s + (manifest.files[f].bytes || 1), 0) || 1;
  const got = new Map<string, number>();
  const report = () => onProgress?.(Math.min(1, [...got.values()].reduce((a, b) => a + b, 0) / total));
  const scenes: THREE.Object3D[] = [];
  // a few at a time keeps the main thread responsive while the meshopt decoder runs
  const queue = [...files];
  const worker = async () => {
    for (let f = queue.shift(); f; f = queue.shift()) {
      const name = f;
      try {
        const gltf = await loader.loadAsync(`${base}${name}`, (e) => {
          got.set(name, Math.min(e.loaded, manifest.files[name].bytes || e.loaded));
          report();
        });
        scenes.push(gltf.scene);
      } catch (err) {
        console.warn(`Kit file ${name} failed to load; its buildings use the procedural fallback.`, err);
      }
      got.set(name, manifest.files[name].bytes || 1);
      report();
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  return new Kit(manifest.assets, manifest.materialPBR ?? {}, scenes);
}
