import legacy from '../../data/legacy-study.json';

/* Evidence view. Section 1 (added with the coordination experiments) shows the new matched runs.
   Section 2 preserves the earlier corridor routing study exactly as it was reported, with its own
   policy names, so the new work never overwrites or relabels it. */

const SCENARIOS = ['manageable_primary', 'near_branch_capacity', 'overload_stress', 'primary_half_capacity', 'primary_double_capacity'];
const POLICY_LABEL: Record<string, string> = {
  static: 'static',
  independent_periodic: 'independent_periodic',
  coordinated_batch: 'coordinated_batch',
};
const POLICY_COLOR: Record<string, string> = {
  static: '#8b98a8',
  independent_periodic: '#f4b740',
  coordinated_batch: '#45d4e8',
};

function pct(a: number, b: number): number {
  return ((b - a) / b) * 100;
}

export function LegacyStudy() {
  const rows = legacy.pointQueue;
  const byScn = (s: string) => rows.filter((r) => r.scenario === s);
  const maxTotal = Math.max(...rows.map((r) => r.totalFleetTravelTimeVehMin));
  return (
    <section className="stack" aria-labelledby="legacy-h">
      <div>
        <h2 id="legacy-h">Earlier corridor routing study (WP2.7 point queue model)</h2>
        <div className="muted small">
          Preserved unchanged from <span className="mono">{legacy.sources.pointQueue.path}</span> and{' '}
          <span className="mono">{legacy.sources.reconciliation.path}</span>. Policy names are the study's own.
        </div>
      </div>
      <div className="callout">
        <b>Status.</b> {legacy.status} The near-capacity improvement of coordinated over independent periodic routing is{' '}
        <b>1.70%</b> in the point queue model, below the provisional 5% target. The SUMO cross check uses different policy
        semantics, so the two columns are independent checks, not a replication.
      </div>
      <div className="grid-2">
        <div className="card">
          <h2>Total fleet travel time</h2>
          <div className="sub">Vehicle minutes, deterministic point queue model, lower is better</div>
          <div style={{ display: 'grid', gap: 12 }}>
            {SCENARIOS.map((s) => (
              <div key={s}>
                <div className="mono small" style={{ marginBottom: 4, color: 'var(--text-1)' }}>
                  {s}
                </div>
                {byScn(s).map((r) => (
                  <div key={r.policy} style={{ display: 'grid', gridTemplateColumns: '150px 1fr 70px', gap: 8, alignItems: 'center', fontSize: 11.5 }}>
                    <span className="mono muted">{POLICY_LABEL[r.policy]}</span>
                    <div style={{ height: 8, background: 'rgba(148,163,184,0.12)', borderRadius: 4, overflow: 'hidden' }}>
                      <div
                        style={{
                          width: `${(r.totalFleetTravelTimeVehMin / maxTotal) * 100}%`,
                          height: '100%',
                          background: POLICY_COLOR[r.policy],
                          borderRadius: 4,
                        }}
                      />
                    </div>
                    <span className="mono num" style={{ textAlign: 'end' }}>
                      {r.totalFleetTravelTimeVehMin.toFixed(2)}
                    </span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
        <div className="stack">
          <div className="card">
            <h2>Coordinated vs independent periodic</h2>
            <div className="sub">Improvement in total fleet travel time, percent (positive = coordinated better)</div>
            <div className="table-wrap" style={{ maxHeight: 'none' }}>
              <table className="data">
                <thead>
                  <tr>
                    <th>Scenario</th>
                    <th className="r">Point queue</th>
                    <th className="r">SUMO mean</th>
                    <th>SUMO 95% interval</th>
                    <th className="r">Seeds better</th>
                  </tr>
                </thead>
                <tbody>
                  {legacy.coordinatedVsIndependent.map((r) => (
                    <tr key={r.scenario}>
                      <td className="mono">{r.scenario}</td>
                      <td className="r mono">{r.pointQueuePct.toFixed(2)}</td>
                      <td className="r mono">{r.sumoMeanPct.toFixed(2)}</td>
                      <td className="mono">{r.sumoInterval}</td>
                      <td className="r mono">{r.seedsBetter}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="note" style={{ marginTop: 8 }}>
              SUMO figures are historical aggregates of an earlier prototype run (not regenerated at this commit) and
              exist only for the three scenarios shown.
            </div>
          </div>
          <div className="card">
            <h2>All point queue scenarios</h2>
            <div className="sub">Coordinated batch against each comparator, computed from the frozen totals</div>
            <div className="table-wrap" style={{ maxHeight: 'none' }}>
              <table className="data">
                <thead>
                  <tr>
                    <th>Scenario</th>
                    <th className="r">vs independent</th>
                    <th className="r">vs static</th>
                    <th className="r">Closed-link entries</th>
                  </tr>
                </thead>
                <tbody>
                  {SCENARIOS.map((s) => {
                    const get = (p: string) => byScn(s).find((r) => r.policy === p)!;
                    const c = get('coordinated_batch');
                    const i = get('independent_periodic');
                    const st = get('static');
                    return (
                      <tr key={s}>
                        <td className="mono">{s}</td>
                        <td className="r mono">{pct(c.totalFleetTravelTimeVehMin, i.totalFleetTravelTimeVehMin).toFixed(2)}%</td>
                        <td className="r mono">{pct(c.totalFleetTravelTimeVehMin, st.totalFleetTravelTimeVehMin).toFixed(2)}%</td>
                        <td className="r mono">{byScn(s).reduce((a, r) => a + r.closedLinkEntries, 0)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

export function EvidenceView() {
  return (
    <div className="view" role="main">
      <div className="view-inner stack">
        <div>
          <h1>Research evidence</h1>
          <p className="lede">
            Every number on this page comes from a recorded simulation run in this repository. Where a result is small,
            negative or inconclusive it is shown as it is. The district, demand and capacities are synthetic.
          </p>
        </div>
        <LegacyStudy />
      </div>
    </div>
  );
}
