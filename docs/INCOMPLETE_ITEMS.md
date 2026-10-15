# Incomplete items and blockers

Three groups: completed engineering actions, outstanding engineering work, and decisions that only a human can make. Nothing in the second and third groups has been done. The Track A pull request (#1) is open and not merged; the known issues register and the reproduction guide exist only on that branch.

## 1. Completed engineering actions (AI assisted, not independently reviewed)
* Repository bootstrap with the WP2.7 baseline imported unchanged.
* WP2.9 fixes: closure gate measured from vehicle records, one horizon constant, independent raw record audit.
* B-01: audit completeness fixed; fail closed on missing, empty, malformed, duplicated, unexpected or inconsistent packages; 47 audit tests, 34 mutants, 75 case adversarial run, original missing row defect reproduced on the old audit and now rejected.
* B-02 engineering part: code, spec, metric file and tests agree on 7200 s; boundary and censoring tests exist; the point queue versus SUMO difference is documented (ADR-0001 addendum).
* B-03 and B-07 preparation: traceability, independence analysis and reviewer checklist written.
* B-04: README replaced.
* Bounded closeout: per epoch batch contents and decision log time fields are now audited; the exhaustive batch oracle was added.
* Post engineering review: found and fixed a gap (route labels and route counts were not tied to the driven paths); see `results/manifests/wp2_9_closure/HANDOFF.md`.
* Evidence recorded in `results/manifests/wp2_9_closure/`.

## 2. Outstanding engineering work
* SUMO half capacity and double capacity scenarios; a closure and stale information scenario.
* SUMO horizon is 3600 s while the point queue contract is 7200 s; align or document in the protocol.
* SUMO policy decision log lacks capacity state, closures and fallback fields; the run summary lacks a configuration hash.
* SUMO independent periodic policy does not share the frozen batch copy semantics; a matching version is not built.
* Historical SUMO aggregates (160 runs) were not regenerated at this commit; the raw archive is not committed (about six minutes on two cores with `simulation/sumo/scripts/run_matrix.py`).
* Cross model differences between the point queue and SUMO remain open (`docs/CROSS_MODEL_RECONCILIATION.md`).
* `coordinated_batch` is a restricted optimiser. An exhaustive per batch oracle exists and shows a small gap in 2 of 20 frozen batches (see the policy review); the algorithm is unchanged and no global optimality is claimed (B-05). The oracle shares the queue simulator and objective with production.
* The mutation check runs as a CI step that fails the check, but `main` has no branch protection, so it is not an enforced required gate.
* Artifacts listed in the WP2.7 manifest and not produced by the documented command (A-02) are not in this repository; Track A work on provenance is in PR #1.

## 3. Decisions requiring a human
See `docs/decisions/OWNER_DECISIONS.md` (all open): horizon, comparator semantics, epoch phase, scenario matrix, the provisional 5% target, licence (none added; default copyright applies), independent review, protocol freeze.
* Independent human reproduction and review (A-01, B-03, B-07): not done. Use `docs/review/reviewer-checklist.md`.
* Confirm the imported baseline matches the original WP2.7 archive. The owner reports doing this; the AI assistant did not verify it in this branch.

## Process note
The first commits in this repository were made through an AI assistant. One commit on `main` (`docs(adr): record horizon...`) carries the assistant's default author identity instead of the project owner's; history was not rewritten.
