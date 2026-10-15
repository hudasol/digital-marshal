# WP2.9 policy review: independent, coordinated and the new exploratory baselines

Status: AI-authored review of `src/confirmatory.py`; every claim below was checked by running code in the dev copy (commands in the evidence pack). Pending human review. No confirmatory run has been executed or authorised.

## 1. Frozen `independent_periodic` (confirmatory.py)

**What it does.** At each epoch the first vehicle of the batch (`probe=group[0]`) estimates its arrival at D on route A and on route B against previously committed vehicles only, then the **whole batch copies that choice**. Ties go to A.

**Findings**
1. **Herding is built in.** `max_30s_batch_dominant_route_share` is 1.00 for this policy in all five scenarios. The mechanism the experiment claims to demonstrate is therefore assumed by construction, not emergent.
2. **Probe choice is arbitrary but matters off the frozen timing.** Replacing `group[0]` with `group[-1]` leaves all 15 frozen results byte-identical, but changes the independent total in 5 of 40 timing cells once the epoch grid is shifted (for example near-capacity at +5 s: 251.65 vs 254.93 vehicle-min). `tests/test_exploratory.py::ProbeSensitivity` pins the `group[0]` behaviour.
3. **A per-vehicle reading exists and is available.** `exploratory.independent_each_vehicle` has every vehicle evaluate its own costs against the same pre-batch snapshot. It reproduces the frozen independent policy exactly at the frozen timing (test-pinned), so the frozen results do not depend on the batch-copy shortcut, but shifted grids do.
4. **No look-ahead.** `estimate_added_vehicle` simulates only committed vehicles plus the probe, so no later batch can influence a decision. Verified by reading `run_fixed_routes` inputs; `coordinated_batch` scores committed plus current-batch vehicles only.
5. **Epoch anchor is a literal.** `batches()` hard-codes `180.0` as the first possible P arrival. It equals E1's free-flow time today; `tests/test_exploratory.py::EpochGrid` now fails if E1 changes without the anchor.

**Recommendation for the frozen protocol:** state explicitly whether the independent comparator is batch-copy or per-vehicle, and freeze the epoch phase. Do not leave it implicit.

## 2. Frozen `coordinated_batch`

* It searches the count `k` of vehicles sent to A with A assignments spread evenly through the batch (`((i+1)*k)//m > (i*k)//m`), not all 2^m assignments. It is a restricted optimiser: good for a screening comparison, not a proven batch optimum. An exhaustive check on small batches is a candidate follow-up, not done here.
* Tie-break prefers larger `k`. Flipping it changes several pinned results (mutation-tested).

## 3. New exploratory baselines (`src/exploratory.py`, never written to `results/`)

| Policy | Information | Decision rule |
|---|---|---|
| `independent_each_vehicle` | pre-batch commitments only | each vehicle minimises its own estimated arrival |
| `peer_aware_sequential` | pre-batch commitments **and earlier peers in the same batch** | vehicles decide in (P arrival, id) order, greedy |

Exploratory comparison at the frozen timing (coordinated improvement over each, %):

| Scenario | static | independent (frozen) | independent_each | peer_aware_sequential |
|---|---:|---:|---:|---:|
| manageable_primary | 0.00 | 0.00 | 0.00 | 0.00 |
| near_branch_capacity | 4.60 | 1.70 | 1.70 | **0.49** |
| overload_stress | 24.04 | 2.55 | 2.55 | 1.45 |
| primary_half_capacity | 2.10 | 1.20 | 1.20 | 0.27 |
| primary_double_capacity | 0.00 | 0.00 | 0.00 | 0.00 |

Reading: in this synthetic model most of the benefit of coordination over the frozen independent policy is obtained by letting vehicles see their peers' commitments. This is exploratory screening, not a PASS/FAIL result.

## 4. Correction to the earlier review

The earlier phase-offset sweep used an epoch grid that, for offsets above zero, gave the first batch an epoch **after** its P arrival (a retroactive decision). With the corrected grid (`batches(..., offset_s=...)`, every epoch at or before the arrival it serves) the coordinated-vs-independent improvement on the near-capacity scenario ranges from **0.73% to 1.74%** across offsets 0 to 25 s. The frozen anchor (offset 0, 1.70%) is therefore **not** the maximum, as previously stated; offset 25 s gives 1.74%.
