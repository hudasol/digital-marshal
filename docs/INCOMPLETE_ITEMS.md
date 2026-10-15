# Incomplete items and blockers

Last updated with the repository bootstrap. Items needing a human are marked (human).

## Needs the project owner or a human engineer
* (human) Independent reproduction of the point queue results on a separate machine (A-01).
* (human) Confirm the 7200 s horizon (ADR-0001).
* (human) Independent re transcription and review of `config/graph_spec.json` and of the new audit.
* (human) Decide whether the frozen independent comparator is batch copy or per vehicle, and freeze the epoch phase.
* (human) Protocol freeze, SUMO scenario matrix freeze, and the decision on the 5% target.
* (human) Choose a licence. None has been added; until one is added, default copyright applies.
* (human) Confirm the imported baseline matches the original WP2.7 archive. The project owner reports doing this; it was not verified by the AI assistant. Five files listed in the WP2.7 manifest were not in the imported copy.

## Engineering work not done
* SUMO half capacity and double capacity scenarios.
* A closure and stale information scenario.
* SUMO horizon is 3600 s while the point queue contract is 7200 s.
* SUMO policy decision log lacks capacity state, closures and fallback fields; the run summary lacks a configuration hash.
* SUMO independent periodic policy does not share the frozen batch copy semantics (see the reconciliation); a version that matches them exactly is not built.
* Historical SUMO aggregates (160 runs) were not regenerated at this commit; the raw archive is not committed. A full re run takes about six minutes on two cores (`simulation/sumo/scripts/run_matrix.py`).
* The mutation check runs in CI but is not a required gate on pull requests.
* `coordinated_batch` is a restricted optimiser (even spread search over the count sent to Route A), not exhaustively checked on small batches.
* Artifacts A-02: four files listed in the WP2.7 manifest (`execution_summary.json`, `paired_comparison.json`, `run_manifest.json`, `test_results.txt`) and the WP2.7 audit report were not produced by the documented command and are not in this repository.

## Process note
The first commits in this repository were made through an AI assistant. One commit (`docs(adr): record horizon...`) carries the assistant's default author identity instead of the project owner's; history was not rewritten.
