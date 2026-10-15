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

## Honesty labels

* The district, roads, demand and signal plans are synthetic. Street names are codes, not real streets.
* Radio transport is modelled, not measured. Overlays that show information flow are illustrative.
* Every metric is computed from recorded runs; unavailable metrics are shown as unavailable.
