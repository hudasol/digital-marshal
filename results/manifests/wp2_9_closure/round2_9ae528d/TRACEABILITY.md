# Traceability of review findings to changes and evidence

| Finding | Change | Evidence | State |
|---|---|---|---|
| B-01 audit completeness | `raw_audit.py` expected matrix from `graph_spec.json`, fails closed | 41 tests, mutants, 71 case CLI run, COMMANDS items 7 to 10 | Engineering complete; independent review pending |
| Post review gap: route labels and counts | route consistency check, `route_labels` in the spec | `RouteLabelsAndCountsMatchTheDrivenPaths` tests, 4 adversarial cases, 4 mutants | Engineering complete; independent review pending |
| B-02 horizon | consistency verified, ADR-0001 addendum | `tests/test_gates_and_horizon.py` | Owner decision D1 OPEN, not approved |
| B-03, B-07 | `docs/review/` | none | READY FOR INDEPENDENT REVIEW, NOT YET SIGNED OFF |
| B-04 README | READMEs corrected | link check | Done |
| B-05, B-06 | wording kept, exploratory policies separate | `WP2_9_POLICY_REVIEW.md` | Open |
