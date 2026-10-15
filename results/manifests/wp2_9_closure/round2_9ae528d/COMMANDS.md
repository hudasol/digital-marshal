# Commands run on candidate `9ae528d2238d0d4dedcd07ba7083349f111d422a` (clean worktree)

| # | Command (directory) | Exit | Result | Log |
|---|---|---:|---|---|
| 1 | `python tools/run_tests.py` (root) | 0 | 4 suites OK | `run_tests.log` |
| 2 | `PYTHONPATH=src python -W error::ResourceWarning -m unittest discover -s tests -v` (`models/point_queue/wp2_9`) | 0 | Ran 107 tests, OK | `wp29_suite_verbose.log` |
| 3 | same without the warning flag (`models/point_queue/baseline_wp2_7`) | 0 | Ran 6 tests, OK | `baseline_tests.log` |
| 4 | `python tools/mutation_check.py . python` (`models/point_queue/wp2_9`) | 0 | 32/32 killed | `mutation_check.log` |
| 5 | `PYTHONPATH=src python src/confirmatory.py --out <scratch>` | 0 | regeneration, not a confirmatory run | n/a |
| 6 | `sha256sum -c tests/golden/SHA256SUMS` in the scratch directory | 0 | 6/6 OK | `golden_check.log` |
| 7 | `python src/raw_audit.py --results <scratch>` | 0 | 15 expected, 15 audited, 1,792 events, all_pass true | `audit_complete_package.json`, `.exit` |
| 8 | same, one metrics row removed (original B-01 defect) | 1 | `missing_run`, primary_double_capacity / coordinated_batch | `audit_14_rows_new.json`, `.exit` |
| 9 | the audit and spec as on `main`, same 14 row package | 0 | runs_audited 14, all_pass true (the defect) | `audit_14_rows_old_main_audit.json`, `.exit` |
| 10 | `python tools/audit_adversarial.py <scratch> --md ...` | 0 | 71/71 cases as expected, fixture unchanged | `AUDIT_ADVERSARIAL_RESULTS.md`, `adversarial_run.log` |

Python 3.13.16, Linux (see `ENVIRONMENT.txt`). The earlier probes that revealed the route gap (exit 0 before the fix) were run interactively before the fix and are not logged as files; the regression tests and four adversarial cases now encode them, and four mutants re-break the fix.
