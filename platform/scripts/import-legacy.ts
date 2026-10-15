/* Imports the existing corridor study (WP2.7 point queue, frozen golden metrics, and the historical
   SUMO aggregates from the generated reconciliation tables) into a JSON file the platform can show.
   Nothing is recomputed or re-labelled: policy names stay as the study defined them.
   Run: npx tsx scripts/import-legacy.ts   (tests/legacy.test.ts fails if the JSON goes stale) */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = resolve(HERE, '..', '..');
export const SOURCES = {
  pointQueue: 'models/point_queue/wp2_9/tests/golden/confirmatory_metrics.csv',
  reconciliation: 'docs/CROSS_MODEL_RECONCILIATION.md',
};

function sha256(path: string): string {
  // hash with normalised line endings so a Windows checkout gives the same digest as CI
  const text = readFileSync(join(REPO, path), 'utf8').replace(/\r\n/g, '\n');
  return createHash('sha256').update(text).digest('hex');
}

function parseCsv(text: string): Record<string, string>[] {
  const lines = text.replace(/\r\n/g, '\n').trim().split('\n');
  const head = lines[0].split(',');
  return lines.slice(1).map((l) => {
    const cells = l.split(',');
    const o: Record<string, string> = {};
    head.forEach((h, i) => (o[h] = cells[i]));
    return o;
  });
}

function parseMdTable(block: string): string[][] {
  return block
    .split('\n')
    .filter((l) => l.startsWith('|') && !/^\|\s*-/.test(l) && !/---/.test(l))
    .map((l) =>
      l
        .slice(1, -1)
        .split('|')
        .map((c) => c.trim()),
    )
    .slice(1);
}

export function buildLegacy() {
  const pq = parseCsv(readFileSync(join(REPO, SOURCES.pointQueue), 'utf8'));
  const md = readFileSync(join(REPO, SOURCES.reconciliation), 'utf8').replace(/\r\n/g, '\n');
  const gen = md.split('<!-- BEGIN GENERATED -->')[1].split('<!-- END GENERATED -->')[0];
  const sections = gen.split('### ').filter((s) => s.trim().length > 0);
  const totals = parseMdTable(sections[0]);
  const vsIndependent = parseMdTable(sections[1]);
  const vsStatic = parseMdTable(sections[2]);

  return {
    title: 'WP2.7 corridor routing study (point queue) with historical SUMO cross check',
    status:
      'Exploratory. Synthetic network. Not a confirmatory experiment; protocol not frozen; provisional 5% target not met; not independently reviewed.',
    sources: Object.fromEntries(Object.entries(SOURCES).map(([k, p]) => [k, { path: p, sha256: sha256(p) }])),
    policies: ['static', 'independent_periodic', 'coordinated_batch'],
    pointQueue: pq.map((r) => ({
      scenario: r.scenario,
      policy: r.policy,
      vehicles: Number(r.vehicles),
      spacingS: Number(r.departure_spacing_s),
      capacityScale: Number(r.capacity_scale_E4_E10_only),
      totalFleetTravelTimeVehMin: Number(r.total_fleet_travel_time_vehicle_min),
      meanTravelTimeMin: Number(r.mean_travel_time_min),
      p95TravelTimeMin: Number(r.p95_nearest_rank_min),
      routeA: Number(r.route_A_count),
      routeB: Number(r.route_B_count),
      closedLinkEntries: Number(r.closed_link_entries),
      fifoViolations: Number(r.fifo_violations),
      checksPass: r.checks_pass === 'True',
    })),
    sumoTotals: totals.map((c) => ({
      scenario: c[0],
      policy: c[1],
      pointQueueVehMin: Number(c[2]),
      sumoMeanVehMin: Number(c[3]),
      sumoScaled: Number(c[4]),
    })),
    coordinatedVsIndependent: vsIndependent.map((c) => ({
      scenario: c[0],
      pointQueuePct: Number(c[1]),
      sumoMeanPct: Number(c[2]),
      sumoInterval: c[3],
      seedsBetter: c[4],
    })),
    coordinatedVsStatic: vsStatic.map((c) => ({ scenario: c[0], pointQueuePct: Number(c[1]), sumoMeanPct: Number(c[2]) })),
  };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const out = join(HERE, '..', 'src', 'data', 'legacy-study.json');
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(buildLegacy(), null, 2) + '\n');
  console.log('wrote', out);
}
