# Digital Marshal platform

Interactive digital twin of a **synthetic Dubai-inspired urban district** with a deterministic traffic
simulation and the Digital Marshal incident-coordination core. Independent student research prototype for
the Dubai World Challenge for Self-Driving Transport 2027. It is not an RTA system, uses no RTA data and
implies no endorsement.

## Run

Requires Node.js 20 or newer.

```bash
cd platform
npm ci
npm run dev        # http://localhost:5173
```

Other commands:

```bash
npm run typecheck  # TypeScript, strict
npm test           # unit, determinism and data-staleness tests (Vitest)
npm run build      # production build in platform/dist (relative paths, works from any static host)
npm run preview    # serve the production build on http://localhost:4173
```

## Layout

| Path | Contents |
|---|---|
| `src/core` | Simulation and Digital Marshal services. Pure TypeScript, no DOM, deterministic from a seed. |
| `src/render` | Three.js renderer: lighting, sky, post-processing, camera rig, quality tiers. Draws simulation state only. |
| `src/app` | React interface: header, operations and intelligence panels, playback bar, views, i18n (English and Arabic). |
| `src/data` | Generated data bundled into the app (for example the preserved corridor study). |
| `scripts` | Node scripts: data import and the experiment runner. |
| `tests` | Vitest suites. |

## Controls

| Input | Action |
|---|---|
| Drag | Orbit |
| Right drag, Shift drag, two fingers | Pan |
| Wheel, pinch | Zoom toward the cursor |
| Space | Play or pause |
| 1 to 7 | Camera modes (overview, top-down, incident, follow, emergency, street, free) |
| Home | Reset camera |
| `[` and `]` | Collapse the operations and intelligence panels |
| Shift + P | Performance monitor |
| Judge mode (header) | Guided tour of about five minutes that drives the live simulation; Esc leaves it |

## Scenarios

All three run on the same incident, message, validation and exception-coordination core, under policy
A (no shared city information), B (validated broadcast, independent responses) or C (B plus coordination).

| Scenario | What happens |
|---|---|
| 01 Signal blackout | Controllers lose power. Vehicles treat dark junctions as all-way stops; AVs stop in a minimal risk condition at junctions outside their operating domain and ask for remote assistance. |
| 02 Emergency vehicle | An ambulance crosses the district. Vehicles yield only when their own gap check passes; infeasible yields are recorded with a reason. Policy C adds signal priority. |
| 05 Roadworks | A contractor submits a signed lane closure, then a full closure. The node validates the submission against the contractor's permit before republishing it ahead of time. An audit counts any entry into a closed lane (expected 0). |

The roadworks panel also runs 13 message security tests (tampered, forged, unknown sender, retired key,
beyond permission, outside permit, unknown location, other map version, expired, replayed, future-dated,
older version, conflicting version). Each crafted message is validated by the node and by every vehicle
that receives it, and the panel reports their actual verdicts.

## A/B/C benchmark

```bash
npm run experiments              # all experiments, 10 seeds, parallel workers (about 2 to 4 minutes)
npm run experiments -- --seeds 3 --only blackout
```

`scripts/run-experiments.ts` runs every experiment in `src/core/experiments.ts` (blackout, emergency
vehicle, ambulance during the blackout, roadworks) under A, B and C plus ablations that switch off one
coordination feature at a time (grouped assistance, detour advice, signal priority). Every variant uses
the same seeds, demand and triggers. Results, with the seeds, a configuration hash and the commit of the
simulation code, go to `src/data/experiments.json`. The Evidence view shows them with 95% intervals and
paired per-seed differences, and can re-run any seed in the browser to check it against the committed
numbers. The benchmark is exploratory: synthetic district, one demand level, not a confirmatory evaluation.

## How it works

* **Network** (`src/core/network`): one road network (12 junctions, 62 directed links, 14 gateways) built
  from `district.ts`. The 3D city, the simulation and the 2D fallback map are all drawn from it.
* **Traffic** (`src/core/sim`): fixed 0.1 s steps with a synchronous update. IDM car following, MOBIL lane
  changes, dual-ring signal plans with a boulevard green wave, all-way stops at dark junctions, and a
  junction safety layer (no conflicting box occupancy, no blocking the box). Every slowdown records the
  constraint that binds it, which the inspector shows as the reason. Snapshots every 10 s make seeking
  and replay exact.
* **Digital Marshal services** (`src/core/dm`): incident management (stable ids, versions, lifecycle);
  a V2X message service (roadside units within range, cellular otherwise, seeded latency and loss,
  repetition and re-signing); trust and validation (ECDSA P-256 via `@noble/curves`, issuer permissions and
  scope, freshness, version ordering, with a reason code for every rejection); a vehicle adapter that turns
  accepted messages into planning constraints while final movement authority stays on board; and exception
  coordination (first come first served under A and B; grouped, prioritised, junction-scoped authorisations
  under C).
* **Measurement** (`src/core/experiments.ts`): the benchmark definitions and metrics, shared by the headless
  runner and the in-browser re-run.

## Metric definitions

| Metric | Definition |
|---|---|
| System time | Vehicle-hours spent in the district or waiting to enter it over the horizon. Demand is identical in every variant, so this is the fair total. |
| Delay per trip | Travel time minus free-flow time, over trips completed within the horizon. It can flatter a worse policy when fewer trips complete. |
| Minimal risk stops | Vehicle-minutes AVs spent stopped in a minimal risk condition. |
| Operator time | Operator-minutes spent on remote assistance tasks. |
| Ambulance delay | Arrival time minus dispatch time minus the ambulance's free-flow time on its route, for runs where it arrived; arrivals are reported separately. |
| Late discoveries | Vehicles that learned of a closure on their path only when they saw it. |
| Safety invariants | Unauthorised AV entries into a dark junction outside their domain (excluding vehicles already committed when the power failed), conflicting box occupancy, and entries into a closed lane. Expected 0 in every run. |

## Verification

* `npm test`: determinism and exact replay, safety invariants under every policy, message validation
  (one test per rejection rule), the roadworks lifecycle, all 13 security tests, the benchmark runner and
  the committed results.
* The Evidence view re-runs any benchmark seed in a background thread and compares every metric with the
  committed results.
* The Engineering view exports the run (seed, configuration and interventions to reproduce it, plus every
  message, exception, trip and event) as JSON and CSV.
* `scripts/shoot.ts` drives the app in a local Chrome or Edge for visual checks; `?nowebgl` shows the 2D
  fallback map; `window.digitalMarshal` is a read-only hook for such checks.

## Known limitations

* The district, roads, demand and signal plans are synthetic and Dubai-inspired; nothing is calibrated to
  real traffic. Street names are codes, not real streets.
* Vehicle behaviour is IDM and MOBIL with rule-based junction logic; there are no pedestrians, cyclists,
  bus stops, parking manoeuvres or driver errors.
* Radio transport is modelled (latency, loss, range), not measured propagation. Overlays that show
  information flow are illustrative.
* Message keys are demo keys derived from fixed labels: no PKI, revocation or key rotation.
* Remote assistance capacity and handling times are assumptions; that a fleet accepts a junction-scoped
  authorisation (policy C) is the assumption under test, not an operator agreement.
* One emergency vehicle at a time; signal priority is simplified to amber, all-red, then green.
* The benchmark is exploratory (10 seeds, one demand level). Every metric is computed from recorded runs;
  unavailable metrics are shown as unavailable.
