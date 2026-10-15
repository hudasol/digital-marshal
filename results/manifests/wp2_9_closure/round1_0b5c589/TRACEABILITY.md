# Traceability of review findings to changes and evidence

| Finding | Change | Evidence | State |
|---|---|---|---|
| B-01 audit completeness | `src/raw_audit.py` derives 5 x 3 matrix from `config/graph_spec.json`, fails closed | `tests/test_audit_completeness.py` (36), 10 audit mutants, 67 case CLI run, items 7 to 9 in `COMMANDS.md` | Engineering complete; independent review pending |
| B-02 horizon | Consistency verified, ADR-0001 addendum, boundary and censoring tests already present | `tests/test_gates_and_horizon.py`; SUMO runner still 3600 s | Owner decision D1 OPEN. Not approved |
| B-03 independent reproduction | `docs/review/reviewer-checklist.md` | none | READY FOR INDEPENDENT REVIEW, NOT YET SIGNED OFF |
| B-04 stale README | `models/point_queue/wp2_9/README.md`, root `README.md` | no references to unmerged files | Done |
| B-05 restricted optimiser | wording kept in READMEs and policy review | exhaustive oracle not built | Open engineering |
| B-06 weak peer information | exploratory policies kept separate, scope sentence added | `WP2_9_POLICY_REVIEW.md` | Open interpretation |
| B-07 provenance of spec and audit | `docs/review/graph-spec-traceability.md`, `independence-and-common-mode.md`, rewritten `provenance` field | none | READY FOR INDEPENDENT REVIEW, NOT YET SIGNED OFF |
