# ADR-0004: Repository layout and baseline preservation

Status: applied.

Decision. `models/point_queue/baseline_wp2_7` holds the supplied WP2.7 source, tests, documents and results byte for byte, and is never edited. Corrections live in `models/point_queue/wp2_9`. SUMO material is under `simulation/sumo`. Historical outputs that were not produced by the scripts at their commit are kept under `results/historical` with a label. Large raw outputs are not committed.

Process. Work is committed directly to `main` in small commits, as agreed with the project owner. No history is rewritten.
