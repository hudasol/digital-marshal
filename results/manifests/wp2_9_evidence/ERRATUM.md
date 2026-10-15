# ERRATUM to the Phase 1 review (REVIEW_REPORT.md)

Author of the error: the AI assistant. Found during WP2.9.

Claim in Phase 1: "Epoch phase (offset 0 to 25 s at 30 s epochs): 0.73% to 1.70%. The frozen anchor is the maximum."

Problem: my sweep shifted the epoch grid so that, for offsets above zero, the first batch was decided after its vehicles had already reached P (a retroactive decision). That is not a valid policy.

Corrected sweep (no decision after P arrival; see logs/corrected_phase_sweep.csv, script phase_sweep.py):
offset 0: 1.70, 5: 0.73, 10: 1.04, 15: 1.19, 20: 1.25, 25: 1.74 (percent, coordinated vs frozen independent, near_branch_capacity).

Corrected conclusion: the range is 0.73% to 1.74% and the frozen anchor is not the maximum. The conclusion that the effect is small and timing sensitive still holds, and every cell is below the provisional 5% target. the Phase 1 review report line was amended accordingly.
