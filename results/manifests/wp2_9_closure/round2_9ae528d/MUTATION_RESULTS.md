# Mutation check (candidate `9ae528d2238d0d4dedcd07ba7083349f111d422a`)

`python tools/mutation_check.py . python` from `models/point_queue/wp2_9`: exit 0, **32/32 mutants killed**, 0 survived (18 fix mutants, 10 audit completeness mutants, 4 route consistency mutants). Per mutant lines in `mutation_check.log`.

A mutant counts as killed when the suite fails with the fix re-broken; the four new mutants are killed by test failures (not by errors in the test code). Mutants and tests share an author. The check is a CI step; `main` has no branch protection, so it is not an enforced required gate.
