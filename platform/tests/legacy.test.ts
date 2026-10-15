import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildLegacy } from '../scripts/import-legacy';

describe('preserved corridor study', () => {
  it('the bundled JSON matches the repository sources (regenerate with npx tsx scripts/import-legacy.ts)', () => {
    const bundled = JSON.parse(readFileSync(join(__dirname, '..', 'src', 'data', 'legacy-study.json'), 'utf8'));
    expect(bundled).toEqual(JSON.parse(JSON.stringify(buildLegacy())));
  });

  it('keeps the original policy names and the reported 1.70% near-capacity figure', () => {
    const d = buildLegacy();
    expect(d.policies).toEqual(['static', 'independent_periodic', 'coordinated_batch']);
    const near = d.coordinatedVsIndependent.find((r) => r.scenario === 'near_branch_capacity');
    expect(near?.pointQueuePct).toBeCloseTo(1.7, 2);
    expect(d.pointQueue).toHaveLength(15);
    expect(d.pointQueue.every((r) => r.checksPass)).toBe(true);
  });
});
