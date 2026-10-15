SUPERSEDED by results/manifests/wp2_9_closure (85 tests, 18 mutants; an intermediate state of the audit fix). Kept as history.

# Audit completeness (B-01) execution evidence

Produced by an AI assistant in a cloud sandbox on 2026-10-15; not independently reproduced by a human. `<workdir>` and `<repo>` replace sandbox paths.

* `red_old_audit_14_rows.log`: the audit as it was on `main`, run on a results package with one metrics row removed. It reports 14 runs, `all_pass: true`, exit 0 (the defect).
* `green_new_audit_14_rows.log`: the fixed audit on the same package. It exits 1 and names the missing run.
* `audit_complete_package.log`: the fixed audit on a freshly regenerated complete package (15 runs, 1792 events, exit 0). The regeneration went to a scratch folder and is not a confirmatory run.
* `full_suite.log`, `mutation_check.log`: 85 tests, and 18 of 18 mutants caught.
* `frozen_outputs_vs_baseline.txt`: six frozen output files from regeneration compared by hash with the preserved baseline.
* `baseline_untouched.txt`: no change under the baseline or historical results folders.
