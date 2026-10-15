# Migration log

Track A, branch `feature/track-a-point-queue-import`. Files were relocated, never edited.

## State of the repository before Track A

The repository was not empty. `main` already contained earlier commits made at the project owner's direction before the Track A brief was received: the baseline import (`models/point_queue/baseline_wp2_7`), a development module (`models/point_queue/wp2_9`), a SUMO prototype (`simulation/sumo`), historical SUMO aggregates, a reconciliation report and execution logs. Track A's brief says to keep `main` untouched and not to include fixes or SUMO work. Those earlier commits were not removed or rewritten (published history is never rewritten). They are outside Track A, are not reviewed here, and are listed as separate material. This branch adds only the Track A provenance, verification and documentation deliverables on top of `main`, and the pull request is the review point for them.

## Mapping

| Original | Destination | Class |
|---|---|---|
| WP2.7 archive members (17 verified) | `models/point_queue/baseline_wp2_7/` and `results/historical/wp2_7_reported/` | DOCUMENTED RELOCATION |
| `src/__pycache__/*.pyc`, `tests/__pycache__/*.pyc` (3) | not imported | NOT IMPORTED (bytecode) |
| `results/run_manifest.json` (WP2.7) | not imported | NOT IMPORTED (not available) |
| WP2.8 Phase 1 decision record and criteria | `docs/decisions/source/` | DOCUMENTED RELOCATION (byte identical) |

The per file table with hashes is `source-inventory.csv`; hashes are in `sha256-manifest.txt`. No file was classified as a transformation, because none was edited.

## Layout decision

The brief's target tree has `src/point_queue`. The preserved layout `models/point_queue/baseline_wp2_7/{src,tests,results,docs}` was kept so that the documented commands work unchanged and the baseline stays a self contained unit. A move to `src/point_queue` is possible later as a documented relocation.

## Exclusions

Bytecode, virtual environments, the WP2.5, WP2.6, WP3.1 and WP2.8 Blocker and Phase 2 packages (inventoried only), and the unverified original archive. The WP3.1 audit package is a separate work package and was deliberately not merged.

## Publication checks (performed by scanning the tree)

* No credentials, tokens or keys matched a pattern scan of the changed files.
* No personal contact details or private machine paths in published text; sandbox paths in logs are replaced.
* No third party code was added. Licence: none present in the sources; none invented. See FU-08.
* Review material is attributed as AI generated and is not presented as human approval.
* Em dashes appear only inside preserved historical files, which are kept byte for byte.

## Known gaps

The original WP2.7 archive was not available to this environment, so its hash is copied from a record and not recomputed here (the project owner reports verifying it). The WP2.7 `run_manifest.json` was not available. The referenced packages WP2.9 Track B and WP2.10 were not found.
