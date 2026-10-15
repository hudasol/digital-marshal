# Known issues in the preserved WP2.7 baseline

These are limitations of the historical baseline. They are recorded here, not fixed, in the baseline import. File references are to `models/point_queue/baseline_wp2_7`. Candidate corrections exist in `models/point_queue/wp2_9` on `main`; they were written before this register, are outside Track A, and have not had a human review.

| ID | Issue | Evidence | Impact | Status |
|---|---|---|---|---|
| KI-01 | The closure violation flag is a constant. Every vehicle row sets `closure_violation` to `False`, and the closed link entry count is written as `0`. | `src/canonical_model.py` line 91 (row flag), line 148 (count); `src/confirmatory.py` line 133 (count) | The gate "zero closed link entries" cannot fail, so it is not evidence about routing. | Open. Not fixed in Track A. |
| KI-02 | The audit flags `all_depart_before_incident` and `all_p_arrivals_at_or_after_incident` are written as `True` constants. | `src/confirmatory.py` line 155 | Same as KI-01 for the incident timing audit. | Open |
| KI-03 | Horizon mismatch. The documents and `results/metric_spec.json` state 7200 s and `confirmatory.py` defines `HORIZON_S = 7200.0`, but the trip completion and censoring logic uses a local 3600 s. | `src/canonical_model.py` line 88; `src/confirmatory.py` line 10; `results/metric_spec.json` | A trip finishing between 3600 s and 7200 s would be marked incomplete. All 15 historical runs finish before 3600 s, so the historical numbers are unaffected. | Open |
| KI-04 | The FIFO audit is not independent. `audit_fifo` recomputes the expected exit time with the same service recurrence the model uses, so an error in that recurrence would pass. | `src/confirmatory.py` function `audit_fifo` (line 104) | "0 FIFO violations" shows the records are consistent with the recurrence, not that the recurrence is right. | Open |
| KI-05 | Route feasibility and the horizon have not been independently established. The tests do not include a closed route, an illegal route, an incomplete trip or a horizon boundary case. | `tests/test_confirmatory.py` (6 tests) | The six tests passing does not demonstrate the gates. | Open |
| KI-06 | The independent periodic policy is a batch copy: the first vehicle of each 30 s batch estimates the costs and the whole batch takes its choice. Herding is therefore built in. | `src/confirmatory.py` lines 71 to 73 | The mechanism under study is assumed by construction. This is consistent with the documented intent ("shared pre batch snapshot") but should be stated in any claim. | Documented limitation |
| KI-07 | The coordinated policy searches only an even spread split by the count of vehicles sent to Route A, not every assignment. | `src/confirmatory.py` assign_policy (line 82 onward) | It is a restricted optimiser. It was not checked against exhaustive search. | Documented limitation |
| KI-08 | A second engineer has not reproduced the package, and no SUMO or microscopic run was part of WP2.7. | `results/historical/wp2_7_reported/WP2_7_Audit_Report.md` | The reported PASS applies to the synthetic mechanism experiment only. | Open |
| KI-09 | One member of the original archive (`results/run_manifest.json`) was not available. The original archive itself was not available, so its hash is unverified here. | `docs/provenance/source-inventory.csv` | Provenance of that one file cannot be checked in this repository. | Open |
| KI-10 | The loose `run_manifest.json` and `scenario_results.csv` supplied next to the packages belong to WP2.6, not WP2.7, and were not imported. | Hash comparison in the source inventory | Avoids attributing WP2.6 records to WP2.7. | Closed (recorded) |

## Prioritised follow up list for the next work package (not done in Track A)

| ID | Item | Evidence | Impact | Proposed owner role | Acceptance condition |
|---|---|---|---|---|---|
| FU-01 | Derive the closure gate and audit flags from vehicle and edge records (KI-01, KI-02) | Lines cited above | High: gates currently cannot fail | Simulation engineer | A test that sends a vehicle through E2 or E3 after the incident makes the gate fail |
| FU-02 | One horizon contract (KI-03) | Lines cited above | High: wrong censoring in longer trips | Simulation engineer | A single constant, tests at 3600 s and 7200 s and the boundary; migration note |
| FU-03 | Independent raw record audit (KI-04, KI-05) | `audit_fifo` | High | Verification engineer, not the model author | Audit imports nothing from the model; fault injection tests fail as expected |
| FU-04 | Adversarial and value asserting tests (KI-05) | 6 tests | High | Verification engineer | Tests with hand computed expected values for closure, FIFO, incomplete trips, horizon and illegal routes |
| FU-05 | Human independent reproduction on a separate machine (KI-08) | Audit report limitation 5 | High | Second engineer | Clean checkout, tests and regeneration check reproduce the historical hashes |
| FU-06 | Review policy semantics and decide the frozen comparator (KI-06, KI-07) | Policy lines | Medium | Algorithm owner with reviewer | Written decision; any new policy has a separate name |
| FU-07 | Obtain the original archive and the missing manifest, verify its hash (KI-09) | Source inventory | Medium | Project owner | Archive hash recomputed and recorded |
| FU-08 | Decide the licence | No licence in the sources | Medium | Project owner | Licence file added by explicit owner decision |

Items FU-01 to FU-04 already have candidate implementations on `main` under `models/point_queue/wp2_9` (written before this register, AI assisted, not human reviewed). They are listed so the next work package can review them under separate control.
