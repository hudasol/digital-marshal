# Track C cross model report: point queue and SUMO

Status: AI assisted engineering evidence, exploratory, not independently reviewed. This is a synthetic, student built comparison. It is not RTA or EDGE endorsed, not field validated and not calibrated to Dubai. Nothing here validates either model against the other or against reality. The 5% target remains provisional and unapproved. The existing 160 run SUMO set (`results/historical/sumo_phase1`) is exploratory and unchanged.

Scope of the SUMO data used here: the Track C smoke matrix in `results/track_c`, five scenarios, three policies (static, independent_periodic, coordinated_batch), seeds 1 to 3, horizon 3600 s and 7200 s. Three seeds are not enough for any statement about significance and none is made. Improvement is `100 * (baseline - coordinated) / baseline` with baseline `independent_periodic`.

## Generated tables

<!-- BEGIN GENERATED -->
### 1. Scenario identity and comparability

| Scenario | Abstract vehicles | Spacing s | Point queue capacity scale | SUMO variant | SUMO achieved A, B ratio to base | Comparability |
|---|---:|---:|---:|---|---|---|
| manageable_primary | 10 | 10 | 1 | base | 1.00, 1.00 (reference) | directly comparable (inputs); mechanism differs |
| near_branch_capacity | 24 | 5 | 1 | base | 1.00, 1.00 (reference) | partially comparable (comparator semantics, D2) |
| overload_stress | 60 | 2 | 1 | base | 1.00, 1.00 (reference) | partially comparable (comparator semantics, D2) |
| primary_half_capacity | 10 | 10 | 0.5 | cap0p5 | 0.50, 0.49 | partially comparable (capacity ratio approximate) |
| primary_double_capacity | 10 | 10 | 2 | cap2 | 1.01, 1.76 | not comparable on capacity (achieved ratio is not 2.0) |

### 2. Total fleet travel time, vehicle minutes (SUMO: mean of seeds 1 to 3, horizon 3600 s)

| Scenario | PQ independent | PQ coordinated | SUMO independent | SUMO coordinated | SUMO independent / 7.5 | SUMO coordinated / 7.5 |
|---|---:|---:|---:|---:|---:|---:|
| manageable_primary | 93.75 | 93.75 | 836.1 | 836.1 | 111.5 | 111.5 |
| near_branch_capacity | 254.28 | 249.95 | 2170.7 | 2158.2 | 289.4 | 287.8 |
| overload_stress | 719.88 | 701.49 | 6536.2 | 6478.7 | 871.5 | 863.8 |
| primary_half_capacity | 104.05 | 102.80 | 892.0 | 888.2 | 118.9 | 118.4 |
| primary_double_capacity | 90.00 | 90.00 | 856.4 | 856.4 | 114.2 | 114.2 |

### 3. Coordinated improvement over independent periodic, percent

| Scenario | Point queue | SUMO seed 1 | SUMO seed 2 | SUMO seed 3 | SUMO mean | Seeds with negative improvement |
|---|---:|---:|---:|---:|---:|---:|
| manageable_primary | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0 of 3 |
| near_branch_capacity | 1.70 | 0.76 | 0.61 | 0.36 | 0.58 | 0 of 3 |
| overload_stress | 2.55 | 1.12 | -0.91 | 2.38 | 0.86 | 1 of 3 |
| primary_half_capacity | 1.20 | 0.44 | 1.12 | -0.32 | 0.42 | 1 of 3 |
| primary_double_capacity | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0 of 3 |

### 4. Completion, unfinished trips and checks

| Scenario | PQ horizon s | PQ incomplete (ind, coord) | SUMO horizon s | SUMO incomplete, all 9 runs | SUMO in network or not inserted at end | SUMO runs with checks_pass | Latest SUMO end time s | Termination |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| manageable_primary | 7200 | 0, 0 | 3600 | 0 | 0 | 9 of 9 | 947 | all_arrived |
| near_branch_capacity | 7200 | 0, 0 | 3600 | 0 | 0 | 9 of 9 | 1018 | all_arrived |
| overload_stress | 7200 | 0, 0 | 3600 | 0 | 0 | 9 of 9 | 1560 | all_arrived |
| primary_half_capacity | 7200 | 0, 0 | 3600 | 0 | 0 | 9 of 9 | 962 | all_arrived |
| primary_double_capacity | 7200 | 0, 0 | 3600 | 0 | 0 | 9 of 9 | 954 | all_arrived |

### 5. SUMO horizon sensitivity, 3600 s against 7200 s

| Scenario | Largest absolute difference in any run total, vehicle minutes | Runs compared | Runs whose horizon was reached |
|---|---:|---:|---:|
| manageable_primary | 0.0000 | 9 | 0 |
| near_branch_capacity | 0.0000 | 9 | 0 |
| overload_stress | 0.0000 | 9 | 0 |
| primary_half_capacity | 0.0000 | 9 | 0 |
| primary_double_capacity | 0.0000 | 9 | 0 |

### 6. Negative control (not a comparator)

| Run | Completed | Route infeasible | Closed link entries | checks_pass | Failed gates |
|---|---:|---:|---:|---|---|
| near_branch_capacity no_reroute_control seed 1 | 180 of 180 | 180 | 0 | False | route_infeasible |
<!-- END GENERATED -->

## Findings that the artifacts demonstrate

1. Every SUMO run in the matrix passed the independent auditor (`simulation/sumo/scripts/sumo_audit.py`, 90 runs, 60 baseline and treatment pairs matched on scenario, seed, capacity variant, network, demand, calibration, horizon and SUMO version). Every run completed all trips, so there are no unfinished trips to count in this matrix.
2. The SUMO horizon is not binding in any run. Totals at 3600 s and 7200 s are identical and the latest end time is 1560 s (table 5). The horizon difference between the point queue (7200 s) and SUMO (3600 s) therefore does not explain any difference in this matrix. It could matter in a scenario that leaves trips unfinished, which none of these five does. Decision D1 is not resolved by this finding.
3. The SUMO `independent_periodic` policy evaluates each vehicle against a shared snapshot with no batch copy and no peer reservation (`decide` in `dm_run.py`). The frozen point queue comparator lets the first vehicle of a batch probe and the whole batch copy it. The two baselines are therefore different policies under the same name. Decision D2 is open.
4. Achieved SUMO capacity for the two new capacity scenarios was measured, not assumed (`simulation/sumo/network/calibration_cap0p5.json`, `calibration_cap2.json`). Half capacity (driver time headway 3.0 s) reached 0.50 on branch A and 0.49 on branch B. Double capacity (doubled lanes) reached 1.01 on branch A and 1.76 on branch B. The branch A doubling did not raise measured discharge after explicit lane connections were added; the reason was not established. Table 1 labels the double capacity scenario not comparable on capacity.
5. The negative control (`no_reroute_control`) shows that the validity gates can fail. All 180 vehicles kept the closed route, SUMO rejected every route (route_infeasible 180) and the trips still ended after about 330 s, so a run with all trips complete and short travel times was still flagged (`checks_pass` false, auditor exit 1). This is why completion alone is not accepted as a pass.
6. A run with missing or inconsistent outputs is written as INVALID and the command exits with code 3 (a first attempt of the control run produced an INVALID manifest this way before a defect in the control branch was fixed).

## Plausible explanations that were not tested

* The smaller SUMO improvement in near capacity (0.58% mean against 1.70%) may come from the missing batch copy in the SUMO baseline, from car following and discharge behaviour, or from both. A batch copy SUMO baseline was not built, so this is not demonstrated.
* Negative seed values in overload_stress and primary_half_capacity may reflect stochastic departure jitter and car following noise acting on differences of about one percent. Three seeds cannot separate this from a real effect.
* SUMO totals divided by 7.5 exceed the point queue totals in every scenario. Plausible causes are acceleration and queue discharge effects and the 7.5 vehicle expansion. Not isolated.

## Comparability

| Quantity | Label | Reason |
|---|---|---|
| Scenario inputs (demand, incident time, closed links) | directly comparable | Same abstract vehicle counts and spacing, same incident, same closed links, SUMO expands by 7.5 |
| Improvement percent, manageable and half and double capacity (zero or small) | partially comparable | Comparator semantics differ (D2); capacity ratios differ for half and double |
| Improvement percent, near capacity and overload | partially comparable | Comparator semantics differ (D2); stochastic against deterministic |
| Total travel time in vehicle minutes | not directly comparable | Different units and different flow physics; the division by 7.5 is a rescaling only |
| Double capacity scenario | not comparable on capacity | Achieved branch A ratio 1.01 and branch B ratio 1.76 |
| Horizon | different by construction | 7200 s point queue (provisional), 3600 s SUMO default; no run reached either |

## Limits

No claim of validation, equivalence, significance or Dubai relevance is made. Three seeds per cell. Half capacity is an approximation by driver time headway. Double capacity did not reach twice the capacity on branch A. The point queue values are frozen WP2.7 numbers and are used as given. The SUMO result files are committed with checksums in `results/track_c/SHA256SUMS`; tripinfo.xml contains a generation timestamp and paths that differ between repeated runs, while every other output file is byte identical on repetition (checked for one run).
