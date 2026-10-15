# Track B closeout: single entry point

**Disposition: ENGINEERING READY FOR INDEPENDENT REVIEW. GOVERNANCE GATES BLOCKED.** Track B is not closed. Independent review has not occurred and no reviewer is named. Owner decisions D1 to D8 and the protocol freeze are pending. No confirmatory run was executed, no historical output was overwritten, nothing was merged.

## 1. Identity
* Repository `hudasol/digital-marshal`, branch `feature/wp2.9-audit-completeness`, PR #2 https://github.com/hudasol/digital-marshal/pull/2 (open, not merged).
* Code candidate tested: `0bf46d0396e83e20c0c67e3cbd8694af98d1fb7b`. The commit that adds this evidence directory sits on top and changes only files under `results/manifests/`. Its SHA and the CI run on it are in the pull request and the final report, not here (a file cannot contain the hash of its own commit).
* At the start of this round: head `7d37f7d08ca3f7e1d1c2cd23a3441932cf5e20ea` (remote verified by `git ls-remote`), CI success on both jobs, route consistency fix present. Track A PR #1: open, not merged, head `c91520492b77e9389b7b1f1c71fd8e1e0068c55b`. `main` is `8072895`.

## 2. What changed in this round (and why)
* **Residual audit blind spots closed** (`c2d499e`): per epoch batch log contents against the vehicles' P arrivals (`batch_epoch_mismatch`); decision log time fields (`decision_field_mismatch`: P arrival equals the vehicle record, epoch not after P arrival, epoch equals the batch epoch, seconds after incident equals epoch minus incident time); the CLI prints `spec_sha256` and `spec_is_default`. `graph_spec.json` gained `epoch_s` 30 and `epoch_anchor_s` 180 (protocol parameters, decision D3, not new choices). No false positives on the 15 frozen runs.
* **Exhaustive batch oracle** (`0d3ee24`, analysis only): all 2^m assignments of every frozen batch scored with the production objective. Result: the restricted optimiser is optimal in 18 of 20 batches and short by 4.5 s (near_branch_capacity, epoch 240) and 12.0 s (overload_stress, epoch 180) of summed batch travel time in the other two; production was never better than the optimum. This is evidence of a gap, not a change: the policy, the results and the claim (restricted optimiser, no global optimality) are unchanged. The oracle shares the queue simulator and objective with production.
* Docs and counts updated (`0bf46d0`). Earlier in the branch: the route consistency fix (`e3c35d5`), and the B-01 fixes.
* Changed files since `7d37f7d`: `src/raw_audit.py`, `config/graph_spec.json`, `tests/test_audit_completeness.py`, `tests/test_audit_adversarial_runner.py`, `tests/test_raw_audit.py` (stdlib whitelist gained hashlib), `tests/test_exhaustive_oracle.py` (new), `tools/audit_adversarial.py`, `tools/mutation_check.py`, `tools/exhaustive_batch_oracle.py` (new), documentation files, and this evidence directory. No model, policy, scenario, metric, horizon or baseline file changed.

## 3. Verification (run once on `0bf46d0396e83e20c0c67e3cbd8694af98d1fb7b`, clean worktree, Python 3.13.16)
| Check | Command (directory) | Result | Status | Evidence |
|---|---|---|---|---|
| All suites | `python tools/run_tests.py` (root) | exit 0, 4 suites OK | PASS, fresh | `run_tests.log` |
| WP2.9 tests, ResourceWarning as error | `PYTHONPATH=src python -W error::ResourceWarning -m unittest discover -s tests -v` (wp2_9) | exit 0, 116 tests | PASS, fresh | `wp29_suite_verbose.log` |
| Baseline tests | same, in `baseline_wp2_7` | exit 0, 6 tests | PASS, fresh | `baseline_tests.log` |
| Mutation check | `python tools/mutation_check.py . python` (wp2_9) | exit 0, 34/34 killed | PASS, fresh | `mutation_check.log` |
| Adversarial CLI cases | `python tools/audit_adversarial.py <scratch>` | exit 0, 75/75, fixture hash unchanged | PASS, fresh | `AUDIT_ADVERSARIAL_RESULTS.md` |
| Golden hashes | regenerate with `src/confirmatory.py --out <scratch>` then `sha256sum -c tests/golden/SHA256SUMS` | regen exit 0; 6/6 OK, exit 0 | PASS, fresh | `golden_check.log` |
| Complete package audit | `python src/raw_audit.py --results <scratch>` | exit 0; 15 expected, 15 audited, 1,792 events | PASS, fresh | `audit_complete_package.json` |
| Missing row regression | one metrics row removed; audit and spec as on `main` versus this branch | main: exit 0, runs_audited 14, all_pass true. Branch: exit 1, `missing_run` (primary_double_capacity / coordinated_batch) | PASS, fresh | `audit_14_rows_*.json` and `.exit` |
| Exhaustive oracle | `python tools/exhaustive_batch_oracle.py --max-batch 16` | exit 0; 20 of 20 batches enumerated; 18 optimal | PASS (analysis), fresh | `EXHAUSTIVE_ORACLE_RESULTS.md` |
| Tree integrity versus main `8072895` | `git rev-parse <rev>:<path>` | baseline_wp2_7 `4413642d…`, results/historical `a87f2544…`, simulation `414a3ef7…`: identical on both; WP2.9 `src` differs only in `raw_audit.py` | PASS, fresh | this file |
| Evidence checksums | `sha256sum -c SHA256SUMS.txt` in this directory, and in each round directory | 19/19, 18/18 and 22/22 OK | PASS, fresh | `SHA256SUMS.txt` |
| PR head and CI | GitHub API | verified at the start of the round for `7d37f7d`; for the final head see the pull request | PASS at start; final head reported in the final report | pull request |
| Track A reconciliation against the original WP2.7 archive | none | archive not available | BLOCKED | section 7 |
| SUMO regeneration, SUMO scenarios, horizon alignment | none | not part of this bounded closeout | NOT RUN | OPEN_BLOCKERS |
| Independent human review and reproduction | none | not performed | BLOCKED | section 6 |

Shared authorship: the audit, tests, mutants, adversarial table and oracle were all written by the same AI. Passing them is automated test evidence, not independent review, and no gate was marked passed because of them.

## 4. Defects fixed across this review (cumulative)
B-01 completeness (missing, duplicate, unexpected, malformed groups; matrix from the spec); route labels, decision routes and route counts not tied to driven paths; batch contents per epoch and decision log time fields not validated; CLI did not name its specification. Each has regression tests, adversarial cases and mutants.

## 5. Evidence and historical integrity
Round 3 files are described in `README.md` (machine output with sandbox paths replaced versus authored notes). Earlier rounds are in `round1_0b5c589/` and `round2_9ae528d/` and are superseded. Checksum status when this file was finalised: round 3 `SHA256SUMS.txt` (19 files) 19/19 OK, written last; round 1 18/18 OK; round 2 22/22 OK (each verified with `sha256sum -c` in its own directory). Historical outputs: the baseline, `results/historical` and `simulation` trees are byte identical to `main` (git tree hashes above) and the six regenerated frozen outputs match `tests/golden/SHA256SUMS`; regeneration only wrote to a scratch directory.

## 6. Residual limitations, owner decisions and review
**Residual limitations and impact**
* Decision log text fields (`eligible_routes`, `available_info`, `decision_method`, `route_switches`) are not validated. Low impact on the numbers.
* `--spec` still accepts any file; the CLI now names it, and the default is pinned to the model by tests. Impact: a weakened spec is visible but not rejected.
* The 30 s epoch rule is a shared assumption between model and audit (D3). The oracle shares the simulator and objective with production.
* `coordinated_batch` is a restricted optimiser with a measured small gap in 2 of 20 batches. The 7200 s horizon is provisional; the SUMO runner uses 3600 s; SUMO half and double capacity and closure scenarios are not built; cross model differences are unresolved. The 5% target is unapproved and the near capacity result (1.70%) does not meet it.
* The work is synthetic and exploratory: no calibration, field validation or significance claim, and no RTA or EDGE endorsement.

**Owner decisions, all PENDING (identifiers as in `docs/decisions/OWNER_DECISIONS.md`). Recommendations are suggestions, not approvals.**
| ID | Decision | Recommendation (not an approval) |
|---|---|---|
| D1 | Horizon | Confirm 7200 s, the value in the WP2.7 documents, and decide whether SUMO should follow it |
| D2 | Independent comparator semantics | Keep the frozen batch copy comparator; report per vehicle and peer aware results as labelled sensitivity |
| D3 | Epoch phase | Keep the 30 s epoch anchored at 180 s |
| D4 | Scenario matrix and identifiers | Keep the five scenarios with the WP2.7 identifiers |
| D5 | Acceptance criterion | Keep 5% provisional until freeze; do not lower it to fit results |
| D6 | Licence | Owner's choice; none added |
| D7 | Independent review | Name one person who is not the owner's AI assistant and did not write the audit |
| D8 | Protocol freeze and confirmatory run authorisation | Decide after D1 to D5 and D7 |

**Independent review status:** not performed. A reviewer must be a different person from the authors of the code; use `docs/review/reviewer-checklist.md` and fill in its sign off block. No name, date or result has been invented.

## 7. Track A and the WP2.7 archive (separate from Track B)
The files available to the session were searched (uploads, mounted folders, the working area). The only WP2.7 related items are extracted copies and `WP2_7_Audit_Report.md`; the zip with SHA-256 `28a24168e7b22c2e1f9c88b5dcdd79cdc18f0d26a4f40551d670d2869dc80d3e` is not present. The WP2.10 package named in the order was not found either and is not the WP2.7 archive. No archive reconciliation is claimed here; Track A (PR #1, unmerged) keeps its own status. Smallest action: upload `Digital_Marshal_WP2_7_Fair_Comparison_Package.zip` to the session.

## 8. Confirmations
No confirmatory experiment was run. No historical output was overwritten. No merge, no push to `main`, no force push. Commits in this round carry no assistant trailer; earlier trailers on six older commits are disclosed in the previous round's handoff (`round2_9ae528d/HANDOFF.md`) and history was not rewritten.
