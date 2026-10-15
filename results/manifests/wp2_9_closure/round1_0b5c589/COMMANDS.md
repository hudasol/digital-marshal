# Commands run on the candidate commit `0b5c58961614ad6fb2c1edcbd2cb075727e01bd7`

Environment is in `ENVIRONMENT.txt`. Exit statuses are the actual ones.

| # | Command (from) | Exit | Result | Log |
|---|---|---:|---|---|
| 1 | `python tools/run_tests.py` (repo root) | 0 | 4 suites OK | `run_tests.log` |
| 2 | `PYTHONPATH=src python -W error::ResourceWarning -m unittest discover -s tests -v` (`models/point_queue/wp2_9`) | 0 | Ran 102 tests, OK | `wp29_suite_verbose.log` |
| 3 | `PYTHONPATH=src python -m unittest discover -s tests -v` (`models/point_queue/baseline_wp2_7`) | 0 | Ran 6 tests, OK | `baseline_tests.log` |
| 4 | `python tools/mutation_check.py . python` (`models/point_queue/wp2_9`) | 0 | 28/28 mutants killed | `mutation_check.log` |
| 5 | `PYTHONPATH=src python src/confirmatory.py --out <scratch>` | 0 | regeneration into a scratch directory, not a confirmatory run | n/a |
| 6 | `sha256sum -c tests/golden/SHA256SUMS` in the scratch directory | 0 | 6/6 OK | `golden_check.log` |
| 7 | `python src/raw_audit.py --results <scratch>` | 0 | 15 expected, 15 audited, 1,792 events, all_pass true | `audit_complete_package.json` |
| 8 | same, after removing one metrics row (original B-01 defect) | 1 | `missing_run` for primary_double_capacity / coordinated_batch | `audit_14_rows_new.json` |
| 9 | the audit as it was on `main`, same 14 row package | 0 | runs_audited 14, all_pass true (the defect) | `audit_14_rows_old_main_audit.json` |
| 10 | `python tools/audit_adversarial.py <scratch> --md ...` | 0 | 67/67 cases as expected, fixture unchanged | `AUDIT_ADVERSARIAL_RESULTS.md`, `adversarial_run.log` |

Python 3.13.16 on Linux. The WP2.9 suite also runs inside command 1 (without the warning flag) and in CI.
