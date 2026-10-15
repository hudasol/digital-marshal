# Traceability of `config/graph_spec.json`

Status: READY FOR INDEPENDENT REVIEW, NOT YET SIGNED OFF. The comparison below was made by an AI assistant on 2026-10-15 and is not an independent human check.

Source document: `FAIR_BASELINE_SPEC.md` (WP2.6 fair baseline specification), SHA 256 `872ce483a82aac468d2a5db4a78ebe0a3c4437aba4d425b2c24f0a15b42dceee` as received. That document is not stored in this repository; the reviewer needs the supplied copy. Other source: the WP2.7 `metric_spec.json` and documents (`models/point_queue/baseline_wp2_7/results/metric_spec.json`, `models/point_queue/baseline_wp2_7/docs/FAIRNESS_AND_METRICS.md`).

| Field | Value in `graph_spec.json` | Source and location | AI comparison | Reviewer to verify |
|---|---|---|---|---|
| nodes, origin, destination | O, P, C, A1, A2, B1, B2, B3, M, D; O to D | FAIR spec section 2, "Nodes" | Matches | Node list; origin and destination are implied by the edges, not stated |
| E1 | O to P, 3 min, 30 vpm | section 2 | Matches | |
| E2, E3 | P to C and C to D, 2 min each, 4 vpm | section 2 | Matches | |
| E4, E5, E6 | P-A1 1 min, A1-A2 2 min, A2-M 1 min, 4 vpm each | section 2, Route A | Matches | |
| E7, E8, E9, E10 | P-B1 2, B1-B2 2, B2-B3 1, B3-M 1 min, 8 vpm each | section 2, Route B | Matches | |
| E11 | M to D, 2 min, 20 vpm | section 2 | Matches | |
| branch scaled edges | E4 to E10 | section 2, "multiply E4-E10 ... E1 and E11 stay fixed" | Matches | |
| closed edges, incident time | E2, E3; 120 s | section 2, "Incident closure at t=120 s closes E2 and E3" | Matches | |
| allowed paths | E1,E2,E3 ; E1,E4,E5,E6,E11 ; E1,E7,E8,E9,E10,E11 | section 2, Routes A and B; critical route inferred from E2, E3 | Routes A and B match; the critical route is an inference | Whether the critical route should be listed as an allowed path (it is legal to enter before the closure) |
| scenarios: vehicles, spacing, scale | 10/10 s/1.0 ; 24/5 s/1.0 ; 60/2 s/1.0 ; 10/10 s/0.5 ; 10/10 s/2.0 | section 3 table | Values match | |
| scenario identifiers | `primary_half_capacity`, `primary_double_capacity` | section 3 calls them `primary_half_branch_capacity` and `primary_double_branch_capacity` | **Differs from the spec text.** The shorter names are the ones used in the WP2.7 code, outputs and tests. | Confirm the shorter names are the intended frozen identifiers |
| policies | static, independent_periodic, coordinated_batch | WP2.7 code and documents | Matches WP2.7; section 1 of the FAIR spec names the same three behaviours without these identifiers | Confirm identifiers |
| route_labels | A = E1,E4,E5,E6,E11; B = E1,E7,E8,E9,E10,E11 | The labels used in the WP2.7 result files; added in the post engineering review | The two paths are the open routes of section 2; the letters are an output naming convention, not in the FAIR spec | Confirm labels |
| epoch_s, epoch_anchor_s | 30 s epochs anchored at 180 s | WP2.7 code and documents; **not** in the FAIR spec | Added in the bounded closeout so the audit can check batch contents | Owner decision D3 |
| horizon | 7200 s | WP2.7 `metric_spec.json` and docs; **not** in the FAIR spec | Provisional value | Owner decision D1 (`docs/decisions/OWNER_DECISIONS.md`) |

Fields not covered by the audit specification at all: demand per minute (derived from spacing), decision epoch (30 s) and its anchor, tie-break rules, information contract. Those are policy and protocol items, not audit inputs.
