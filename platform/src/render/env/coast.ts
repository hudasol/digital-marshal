/* The coastline of the scenery, north-west of the district, running south-west to north-east.
   Shared by the terrain shader, the surrounding city and its placement code. Coordinates:
   simulation metres (x east, y north). */

export const COAST: Array<[number, number]> = [
  [-9000, -3200],
  [-2200, 900],
  [-900, 1700],
  [1200, 3100],
  [6000, 6400],
];

/** True when a point lies on the sea side (north-west) of the coastline. */
export function inSea(x: number, y: number): boolean {
  for (let i = 0; i + 1 < COAST.length; i++) {
    const [ax, ay] = COAST[i];
    const [bx, by] = COAST[i + 1];
    if (x >= ax && x <= bx) {
      const t = (x - ax) / (bx - ax);
      return y > ay + (by - ay) * t;
    }
  }
  return false;
}

/** Signed distance to the coastline in metres, positive at sea (the terrain shader's dmCoast). */
export function coastDistance(x: number, y: number): number {
  let d = 1e9;
  let side = -1;
  for (let i = 0; i + 1 < COAST.length; i++) {
    const [ax, ay] = COAST[i];
    const [bx, by] = COAST[i + 1];
    const abx = bx - ax;
    const aby = by - ay;
    const t = Math.min(1, Math.max(0, ((x - ax) * abx + (y - ay) * aby) / (abx * abx + aby * aby)));
    d = Math.min(d, Math.hypot(x - ax - abx * t, y - ay - aby * t));
    if (x >= ax && x <= bx) side = y > ay + (aby * (x - ax)) / abx ? 1 : -1;
  }
  return d * side;
}
