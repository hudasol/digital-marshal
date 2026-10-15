# ADR-0002: Independent raw record audit

Status: applied in `models/point_queue/wp2_9`.

Context. The WP2.7 FIFO check re applied the model's own service recurrence to the model's own records, so a recurrence bug would pass its own check. The closure gate was a constant.

Decision. `src/raw_audit.py` imports nothing from the model and reads a separately transcribed graph (`config/graph_spec.json`). It checks properties that any correct FIFO point queue record must satisfy: path legality, hand off continuity, the free flow lower bound, wait bookkeeping, no overtaking, minimum headway, work conservation, closure entry, vehicle conservation, horizon and censoring, metric recomputation, and the departure schedule. A drift test fails if the graph file and the model disagree.

Evidence that the audit can fail. `tests/test_raw_audit.py` injects 14 faults into otherwise valid records and requires the matching check to fire. `tools/mutation_check.py` re breaks each fix in a scratch copy of the code and requires the suite to fail (13 of 13 mutants caught at the time of writing).

Limit. The graph file was transcribed with AI assistance and has not been transcribed independently by a human.
