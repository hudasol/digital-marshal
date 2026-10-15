# WP2.9 Track B closure evidence: start with HANDOFF.md

Current evidence (round 3) is for code commit `0bf46d0396e83e20c0c67e3cbd8694af98d1fb7b`. `round1_0b5c589/` and `round2_9ae528d/` are superseded earlier rounds kept as history (their own SHA256SUMS.txt still verify); do not use their numbers.

| Kind | Files |
|---|---|
| Machine output, only sandbox paths replaced by `<repo>`, `<workdir>`, `<tmp>` (not untouched terminal transcripts) | `run_tests.log`, `wp29_suite_verbose.log`, `baseline_tests.log`, `mutation_check.log`, `golden_check.log`, `adversarial_run.log`, `exhaustive_oracle_run.log`, `audit_*.json`, `audit_*.exit` (exit status written by the shell) |
| Machine output plus one inserted header paragraph | `AUDIT_ADVERSARIAL_RESULTS.md`, `EXHAUSTIVE_ORACLE_RESULTS.md` |
| Authored notes (not machine output) | `README.md`, `HANDOFF.md`, `OPEN_BLOCKERS.md`, `ENVIRONMENT.txt` |

`SHA256SUMS.txt` covers every file in this directory except the two round subdirectories and was generated last. The CI result for the final pull request head cannot be inside a checksummed file; read it from the pull request.
