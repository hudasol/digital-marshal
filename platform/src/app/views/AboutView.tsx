/* About: the research question, the architecture, what is and is not claimed, and the roadmap.
   Written for judges and engineers; it states limits as plainly as results. */

function ArchitectureDiagram() {
  const box = (x: number, y: number, w: number, h: number, title: string, sub: string, tone = '#45d4e8') => (
    <g key={title}>
      <rect x={x} y={y} width={w} height={h} rx={10} fill="rgba(23,33,49,0.9)" stroke={tone} strokeOpacity={0.55} />
      <text x={x + 12} y={y + 22} fill="#f3f6f9" fontSize={13} fontWeight={650}>
        {title}
      </text>
      <text x={x + 12} y={y + 40} fill="#8b98a8" fontSize={11}>
        {sub}
      </text>
    </g>
  );
  const arrow = (x1: number, y1: number, x2: number, y2: number, label?: string) => (
    <g key={`${x1}-${y1}-${x2}-${y2}`}>
      <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#5e6b7b" strokeWidth={1.6} markerEnd="url(#arr)" />
      {label ? (
        <text x={(x1 + x2) / 2 + 6} y={(y1 + y2) / 2 - 4} fill="#8b98a8" fontSize={10.5}>
          {label}
        </text>
      ) : null}
    </g>
  );
  return (
    <svg viewBox="0 0 1000 430" role="img" aria-label="Digital Marshal logical architecture" style={{ width: '100%', height: 'auto' }}>
      <defs>
        <marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0 0L10 5L0 10z" fill="#5e6b7b" />
        </marker>
      </defs>
      <text x={20} y={24} fill="#8b98a8" fontSize={11} letterSpacing="0.1em">
        INFRASTRUCTURE AND ISSUERS (SIMULATED)
      </text>
      {box(20, 36, 210, 54, 'Signal controllers', 'heartbeat, phase state', '#8b98a8')}
      {box(250, 36, 210, 54, 'Works contractors', 'planned closures', '#8b98a8')}
      {box(480, 36, 210, 54, 'Emergency dispatch', 'corridor requests', '#8b98a8')}
      {box(710, 36, 270, 54, 'Remote assistance desk', 'limited operator capacity', '#8b98a8')}

      <text x={20} y={128} fill="#45d4e8" fontSize={11} letterSpacing="0.1em">
        DIGITAL MARSHAL CORE
      </text>
      {box(20, 140, 220, 58, 'Incident management', 'stable ids, lifecycle, versions')}
      {box(260, 140, 220, 58, 'Trust and validation', 'ECDSA P-256, scope, freshness')}
      {box(500, 140, 220, 58, 'Road-state management', 'restrictions, outages, corridors')}
      {box(740, 140, 240, 58, 'Exception coordination', 'grouping, WSPT priority, capacity')}
      {box(140, 226, 260, 58, 'V2X message service', 'latency, loss, coverage (simulated)')}
      {box(420, 226, 300, 58, 'Experiment and measurement', 'matched runs, metric definitions')}

      <text x={20} y={322} fill="#3ccb8f" fontSize={11} letterSpacing="0.1em">
        VEHICLES (FINAL MOVEMENT AUTHORITY STAYS ON BOARD)
      </text>
      {box(20, 334, 300, 58, 'Vehicle adapter', 'accepted message -> constraints', '#3ccb8f')}
      {box(340, 334, 300, 58, 'AV planner and safety layer', 'IDM, gap checks, ODD rules', '#3ccb8f')}
      {box(660, 334, 320, 58, 'Twin renderer (this page)', 'draws simulation state only', '#a78bfa')}

      {arrow(125, 90, 125, 140, 'outage')}
      {arrow(355, 90, 355, 140, 'submit')}
      {arrow(585, 90, 610, 140, 'request')}
      {arrow(845, 140, 845, 90, 'tasks')}
      {arrow(240, 169, 260, 169)}
      {arrow(480, 169, 500, 169)}
      {arrow(370, 198, 300, 226)}
      {arrow(270, 284, 170, 334, 'signed messages')}
      {arrow(320, 363, 340, 363)}
      {arrow(640, 363, 660, 363)}
      {arrow(560, 334, 820, 198, 'exceptions')}
      {arrow(570, 284, 570, 334)}
    </svg>
  );
}

export function AboutView() {
  return (
    <div className="view" role="main">
      <div className="view-inner stack">
        <div>
          <h1>Digital Marshal</h1>
          <p className="lede">
            Digital Marshal is a concept for city infrastructure that gives autonomous vehicles trustworthy, current,
            location-specific information during abnormal road conditions, and coordinates fleet-level exceptions when
            many vehicles are affected by the same event. The long-term operator could be a transport authority. This
            prototype simulates that architecture; it has no connection to production systems.
          </p>
        </div>

        <div className="grid-2">
          <div className="card">
            <h2>Research question</h2>
            <p style={{ color: 'var(--text-1)', lineHeight: 1.6, margin: '6px 0 0' }}>
              Can incident-level coordination reduce fleet-wide obstruction and exception workload during shared traffic
              disruptions, compared with independent autonomous vehicle responses, without overriding onboard safety
              constraints?
            </p>
            <div className="note" style={{ marginTop: 10 }}>
              This is a hypothesis under test, not a claim of novelty. Incident messaging to connected vehicles (for
              example decentralised event notifications and traveller information messages) already exists; the
              question here is whether coordinating the fleet's response adds measurable value.
            </div>
          </div>
          <div className="card">
            <h2>Scenarios</h2>
            <ul className="clean">
              <li>
                <b>01 Traffic signal blackout</b> - junction signals fail; vehicles apply their own dark-signal rules;
                the system shares the outage and coordinates exceptions.
              </li>
              <li>
                <b>02 Emergency vehicle priority</b> - an ambulance crosses the district; vehicles evaluate safe
                yielding; infeasible yields are reported, not forced.
              </li>
              <li>
                <b>05 Temporary roadworks</b> - lane and segment closures are published, validated and routed around,
                including stale and invalid updates.
              </li>
            </ul>
          </div>
        </div>

        <div className="card">
          <h2>Logical architecture</h2>
          <div className="sub">One incident-information and coordination core shared by all three scenarios</div>
          <ArchitectureDiagram />
        </div>

        <div className="grid-3">
          <div className="card">
            <h2>What is real here</h2>
            <ul className="clean">
              <li>A deterministic microscopic traffic simulation (car following, lane changes, signals) that drives every vehicle on screen.</li>
              <li>Message signing and verification with audited ECDSA P-256 code; rejected messages are rejected by rule.</li>
              <li>Metrics computed from recorded runs with fixed seeds, exportable as CSV and JSON.</li>
            </ul>
          </div>
          <div className="card">
            <h2>What is simulated or assumed</h2>
            <ul className="clean">
              <li>The district, roads, demand and signal plans are synthetic and Dubai-inspired, not real streets.</li>
              <li>Radio transport is modelled (latency, loss, coverage), not measured propagation.</li>
              <li>Remote assistance capacity, handling times and AV operational limits are stated assumptions.</li>
            </ul>
          </div>
          <div className="card">
            <h2>What is not claimed</h2>
            <ul className="clean">
              <li>No RTA endorsement, data access or connection; independent student prototype.</li>
              <li>No certified SAE Level 4 behaviour; the AV logic is a simulated planner in a defined domain.</li>
              <li>No real-world validation, calibration or statistical significance beyond what the runs show.</li>
            </ul>
          </div>
        </div>

        <div className="card">
          <h2>Roadmap</h2>
          <div className="grid-3" style={{ marginTop: 8 }}>
            <div>
              <div className="chip cyan">Now</div>
              <ul className="clean" style={{ marginTop: 8 }}>
                <li>Interactive twin and matched comparison runs in a synthetic district.</li>
                <li>Earlier corridor study preserved with its SUMO cross check.</li>
              </ul>
            </div>
            <div>
              <div className="chip muted">Next</div>
              <ul className="clean" style={{ marginTop: 8 }}>
                <li>Higher-fidelity runs of the same scenarios in SUMO with recorded traces replayed in the twin.</li>
                <li>Independent human review of the coordination algorithm and metrics.</li>
              </ul>
            </div>
            <div>
              <div className="chip muted">Later</div>
              <ul className="clean" style={{ marginTop: 8 }}>
                <li>Standards-aligned message profiles and certificate management.</li>
                <li>Pilot design with an operator, subject to its own safety case and approvals.</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
