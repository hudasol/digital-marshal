# WP2.9 execution record

Attribution: AI assisted independent reproduction and code review (an AI assistant). Nothing here is an RTA or EDGE sign-off or endorsement. No confirmatory experiment was run or authorised.

## A. What the AI personally executed in its sandbox (logs in logs/)
All run with Python 3.13 in a fresh venv, stdlib only, in the cloud workspace (ENVIRONMENT.txt).
| Command | Result | Log |
|---|---|---|
| WP2.7 baseline: original 6 tests | 6 OK, exit 0 | baseline_original_tests.log |
| New tests on UNFIXED baseline source (red) | 24 run, 5 failures, 7 errors, exit 1 | red_new_tests_on_baseline.log |
| Full suite on fixed branch (green), -W error::ResourceWarning | 65 tests OK | green_full_suite.log |
| tools/mutation_check.py | 13/13 mutants killed | mutation_check.log |
| confirmatory.py regeneration into a scratch folder (a regeneration check, not a confirmatory run) | exit 0 | frozen_pipeline_regeneration_NOT_CONFIRMATORY.log |
| raw_audit.py CLI on that folder | 15 runs, 1792 events, 0 violations | raw_audit_cli.log |
| Output hash comparison vs baseline | 6 of 7 files identical; invariant_audit.json differs by design | baseline_output_hashes.txt, new_output_hashes.txt |
| exploratory.py default run | exit 0, labelled exploratory | exploratory_default.log |
| Corrected phase sweep | 0.73 to 1.74 percent | corrected_phase_sweep.csv |

## B. AI authored, verified only by the tests above (no human review yet)
All changes in WP2_9_changes.diff (14 files): canonical_model.py, confirmatory.py, raw_audit.py, graph_spec.json, exploratory.py, 5 test files, mutation_check.py, two docs. The graph_spec.json was transcribed by the AI from the spec and checked by a drift test against the model, which is not the same as independent human transcription.

## C. Not done, or needs a human
* Human independent reproduction (A-01). Artifacts not produced by the documented command (A-02).
* Comparing the baseline copy to your original archive: I could not do this. You report you did.
* The baseline copy lacks 5 manifest files (WP2_7_Audit_Report.md, execution_summary.json, paired_comparison.json, run_manifest.json, test_results.txt).
* Horizon: the baseline enforced 3600 s while the docs and metric_spec say 7200 s. I applied 7200 s. Please confirm that is the intended frozen value.
* Frozen vs per-vehicle independent comparator, epoch phase, protocol freeze, SUMO matrix freeze, 5% target decision.
* coordinated_batch is a restricted optimiser, not exhaustively checked.
* SUMO work from Phase 1 is a prototype only.
