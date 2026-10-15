# Mutation check (candidate `0b5c58961614ad6fb2c1edcbd2cb075727e01bd7`)

Command: `python tools/mutation_check.py . python` from `models/point_queue/wp2_9`. Exit status 0. Result: **28/28 mutants killed**, 0 survived (18 earlier fix mutants plus 10 audit mutants). Full per mutant list in `mutation_check.log`.

The check copies the module to a scratch directory, re-breaks one fix at a time and requires the suite to fail. The source tree is not modified. Mutants are written by the same AI that wrote the tests; a human may add more (see the reviewer checklist).

Enforcement: the check is a step in the CI workflow (`.github/workflows/tests.yml`, job `point-queue-and-docs`) and fails the check run. `main` has no branch protection, so it is not an enforced required gate; making it one is a repository setting for the owner.
