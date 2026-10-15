# Track B handoff: state, evidence, defects and remaining actions

Status: **READY FOR INDEPENDENT REVIEW. NO INDEPENDENT APPROVAL IS IMPLIED.** Independent review has not occurred; no reviewer is named. Owner decisions D1 to D8 and the protocol freeze are pending; none is recorded. No confirmatory run has been executed or authorised.

## 1. Verified state (post engineering closure order)
* Repository `hudasol/digital-marshal`, branch `feature/wp2.9-audit-completeness`. Before this round: PR #2 head `f055dcc579828bd62b26ca7e334922581f1d2c0e`, open, not merged, CI success (both jobs), checked through the GitHub API. `f055dcc` differs from the tested code commit `0b5c589` by 19 added files, all under `results/manifests/wp2_9_closure/`, so `0b5c589` code was the tested code.
* Track A PR #1: open, not merged, head `c91520492b77e9389b7b1f1c71fd8e1e0068c55b`, CI success. `main` is `8072895`.
* This round added code commit `9ae528d2238d0d4dedcd07ba7083349f111d422a` (the fix, below). CI for the final head is read from the pull request, not from this file.

## 2. What was rerun and what was not
| Check | Status |
|---|---|
| Items 1 to 10 in `COMMANDS.md` | Freshly run on `9ae528d2238d0d4dedcd07ba7083349f111d422a` (and earlier on PR head `f055dcc`: same results, 102 tests, 28 mutants, 67 cases) |
| Evidence checksums of round 1 | Freshly recomputed, 18/18 OK |
| Baseline, historical, simulation trees versus main | Freshly compared by git tree hash, identical |
| Track A reconciliation against the original WP2.7 archive | Not run here (Track A work, archive not part of this task) |
| SUMO regeneration of historical aggregates | Not run |
| Independent human reproduction | Not run; not possible for an AI to substitute |

## 3. Evidence package status
Round 1 package: complete, checksums valid, but describes the code before the fix, so it is archived as superseded. It also contained one inaccuracy, corrected here: the older `results/manifests/audit_completeness/README.md` was not labelled superseded; it now is. Round 2 package (this directory): see `README.md` for which files are machine output with sandbox paths replaced, and which are authored notes; `SHA256SUMS.txt` was generated last.

## 4. Defects found and resolved
One gap found by reviewing `raw_audit.py` and probing it: swapping `route_A_count` and `route_B_count` in the metrics, flipping a route label in `vehicle_records.csv`, or flipping `chosen_route` in `decision_log.csv` still gave exit 0, because those fields were not compared with the driven edge paths. Fixed in `e3c35d5`: four new checks, five regression tests, four adversarial cases, four mutants. Frozen outputs and golden hashes are unchanged.

Residual blind spots (not closed, documented in `docs/review/independence-and-common-mode.md`): per epoch batch splits are checked for arithmetic only; `--spec` accepts any specification file; other decision log fields are not validated; tests, mutants and audit share an author.

## 5. Items by owner
**Engineering complete (AI assisted, unreviewed):** B-01 audit completeness and route consistency; B-02 consistency check and documentation; B-04 README; review document preparation; evidence package.

**Independent human review items**

| # | Artifact | Role | Required evidence | Closure condition |
|---|---|---|---|---|
| H1 | `config/graph_spec.json` against FAIR_BASELINE_SPEC.md (B-07) | Independent engineer | Completed checklist, findings, name, date, commit | Signed block in `docs/review/reviewer-checklist.md` with no open finding |
| H2 | `src/raw_audit.py` and tests (B-07) | Independent engineer | Same | Same |
| H3 | Reproduction from the original WP2.7 archive (B-03) | Independent engineer | Archive hash, commands, environment, logs, differences | Recorded reproduction at a named commit |

**Project owner decisions** (identifiers and meanings as in `docs/decisions/OWNER_DECISIONS.md`): D1 horizon, D2 comparator semantics, D3 epoch phase, D4 scenario matrix and identifiers, D5 acceptance criterion (5% provisional), D6 licence, D7 independent human review, D8 protocol freeze and authorisation of any confirmatory run. Closure condition for each: the decider's name, date and choice written into that file. All pending.

**Further engineering:** exhaustive small batch oracle for `coordinated_batch` (B-05); SUMO half and double capacity, closure and stale information scenarios; SUMO horizon alignment; decision log fields; cross model differences; required status check for the mutation check (owner setting). See `OPEN_BLOCKERS.md`.

## 6. Confirmations
* Independent review has not occurred. No reviewer, date or signature has been invented.
* Owner decisions and protocol freeze are pending. The 7200 s horizon and the 5% target are provisional and unapproved.
* Track A is not merged.
* Commit trailers: commits `dfd447f`, `fa22404`, `e188dde`, `d16f658`, `0b5c589`, `f055dcc` carry a Co-Authored-By assistant trailer and the PR #2 description carried assistant attribution lines. The project owner's preference is that no such attribution appears in pushed material. History was not rewritten; the pull request description was corrected and later commits carry no trailer.
