import type { Network, Turn } from '../network/types';
import { TURN_DELAY_GUESS } from './params';

/* Route planning on the link graph (Dijkstra; 62 nodes, so a linear scan for the minimum is fine
   and keeps tie-breaking deterministic). A route is a list of link ids from the current link to the
   destination link, inclusive. */

export interface RouteOptions {
  /** links that must not be used (closed segments) */
  avoidLinks?: Set<string>;
  /** junctions that must not be passed through (for example outside the AV's operational domain) */
  avoidJunctions?: Set<string>;
  /** extra seconds charged for passing through a junction */
  junctionPenalty?: Map<string, number>;
  /** observed traversal times that replace free-flow estimates */
  linkTime?: Record<string, number>;
  /** extra seconds charged per link (used by coordinated allocation to spread load) */
  linkPenalty?: Map<string, number>;
  /** observed delay per movement `${inLink}>${outLink}` (signal wait and queueing), s */
  moveDelay?: Record<string, number>;
}

let successorsCache: {
  net: Network;
  succ: Record<string, string[]>;
  between: Record<string, string[]>;
  turn: Record<string, Turn>;
} | null = null;

function index(net: Network) {
  if (successorsCache && successorsCache.net === net) return successorsCache;
  const succ: Record<string, string[]> = {};
  const between: Record<string, string[]> = {};
  const turn: Record<string, Turn> = {};
  for (const id of net.linkIds) succ[id] = [];
  for (const cid of net.connectorIds) {
    const c = net.connectors[cid];
    const key = `${c.inLink}>${c.outLink}`;
    if (!between[key]) {
      between[key] = [];
      succ[c.inLink].push(c.outLink);
      turn[key] = c.turn;
    }
    between[key].push(cid);
  }
  successorsCache = { net, succ, between, turn };
  return successorsCache;
}

/** Connectors that lead from link a to link b (one per permitted entry lane). */
export function connectorsBetween(net: Network, a: string, b: string): string[] {
  return index(net).between[`${a}>${b}`] ?? [];
}

export function successors(net: Network, link: string): string[] {
  return index(net).succ[link] ?? [];
}

/** Expected delay for a movement: observed when available, otherwise a default by turn type. */
export function movementDelay(net: Network, from: string, to: string, opts: RouteOptions = {}): number {
  const key = `${from}>${to}`;
  const obs = opts.moveDelay?.[key];
  if (obs !== undefined) return obs;
  return TURN_DELAY_GUESS[index(net).turn[key] ?? 'S'];
}

export function turnOf(net: Network, from: string, to: string): Turn | undefined {
  return index(net).turn[`${from}>${to}`];
}

export function freeFlowTime(net: Network, link: string): number {
  const l = net.links[link];
  return l.length / l.speed;
}

export function routeCost(net: Network, route: string[], opts: RouteOptions = {}): number {
  let c = 0;
  for (let i = 0; i < route.length; i++) {
    const id = route[i];
    c += opts.linkTime?.[id] ?? freeFlowTime(net, id);
    c += opts.linkPenalty?.get(id) ?? 0;
    if (i > 0) {
      const j = net.links[id].from;
      c += movementDelay(net, route[i - 1], id, opts) + (opts.junctionPenalty?.get(j) ?? 0);
    }
  }
  return c;
}

/**
 * Cheapest route from `from` (the vehicle's current link, included) to `to` (destination link).
 * Returns null when no route exists under the constraints.
 */
export function planRoute(net: Network, from: string, to: string, opts: RouteOptions = {}): string[] | null {
  if (from === to) return [from];
  const { succ } = index(net);
  const dist: Record<string, number> = {};
  const prev: Record<string, string | null> = {};
  const done = new Set<string>();
  for (const id of net.linkIds) dist[id] = Infinity;
  dist[from] = 0;
  prev[from] = null;
  for (;;) {
    let u: string | null = null;
    let best = Infinity;
    for (const id of net.linkIds) {
      if (!done.has(id) && dist[id] < best) {
        best = dist[id];
        u = id;
      }
    }
    if (u === null) return null;
    if (u === to) break;
    done.add(u);
    const junction = net.links[u].to;
    // passing through an avoided junction is not allowed (callers decide what to do when even the
    // current approach leads into one)
    if (opts.avoidJunctions?.has(junction)) continue;
    for (const w of succ[u]) {
      if (opts.avoidLinks?.has(w)) continue;
      const cost =
        movementDelay(net, u, w, opts) +
        (opts.junctionPenalty?.get(junction) ?? 0) +
        (opts.linkTime?.[w] ?? freeFlowTime(net, w)) +
        (opts.linkPenalty?.get(w) ?? 0);
      const nd = dist[u] + cost;
      if (nd < dist[w]) {
        dist[w] = nd;
        prev[w] = u;
      }
    }
  }
  const path: string[] = [];
  let cur: string | null = to;
  while (cur) {
    path.push(cur);
    cur = prev[cur] ?? null;
  }
  path.reverse();
  return path[0] === from ? path : null;
}

/** Junctions a route passes through (the junction at the end of every link except the last). */
export function junctionsOf(net: Network, route: string[], fromIndex = 0): string[] {
  const out: string[] = [];
  for (let i = fromIndex; i < route.length - 1; i++) out.push(net.links[route[i]].to);
  return out;
}
