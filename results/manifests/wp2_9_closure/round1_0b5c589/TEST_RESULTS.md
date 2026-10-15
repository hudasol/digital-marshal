# Test results (candidate `0b5c58961614ad6fb2c1edcbd2cb075727e01bd7`)

| Suite | Tests | Exit |
|---|---:|---:|
| `tools/run_tests.py` combined: baseline WP2.7, WP2.9, SUMO smoke audit, repository | 4 suites OK | 0 |
| WP2.9 development, with `-W error::ResourceWarning` | 102 | 0 |
| Baseline WP2.7 (original tests, unchanged) | 6 | 0 |

The 102 WP2.9 tests include 36 audit completeness tests and 1 test that runs the 67 case adversarial runner. Counts are read from `wp29_suite_verbose.log` and `baseline_tests.log`; the combined run prints only OK per suite, see `run_tests.log`.
