# Architecture

```
config/graph_spec.json  (hand transcribed graph, used only by the audit)
        |
src/canonical_model.py  deterministic FIFO point queue: graph, run_fixed_routes
        |
src/confirmatory.py     frozen policies, scenarios, metrics, output writers
src/exploratory.py      exploratory policies (never writes to results)
src/raw_audit.py        independent audit; imports nothing from the model
```

Layering rules. The audit does not import the model or the policies. The exploratory module imports the frozen module, never the reverse. A test fails if the audit gains an import from the model. Policies receive the same information at each 30 s decision epoch: committed vehicles only, no later demand. Route choice is locked at P.

## Models

Point queue: edge service is `exit = max(arrival + free_flow, previous_exit + 60 / capacity_vpm)` with infinite storage. Incident at 120 s closes E2 and E3. Horizon 7200 s (ADR-0001).

SUMO: a synthetic network with the same graph, free flow times equal to the point queue, lane counts for capacity ratios, measured discharge rates, and a TraCI controller that logs every decision (time, options, perceived costs, assigned route). The run options are in the header of `simulation/sumo/scripts/dm_run.py`.

## Parameter provenance

| Parameter | Value | Source | Status |
|---|---|---|---|
| Graph, free flow times, capacities | WP2.7 tables | Supplied WP2.7 model | Synthetic assumption, not calibrated |
| Incident time, closed edges | 120 s, E2 and E3 | WP2.7 | Synthetic assumption |
| Horizon | 7200 s | WP2.7 documents, ADR-0001 | Awaiting owner confirmation |
| Decision epoch | 30 s | WP2.7 | Synthetic assumption |
| SUMO vehicles per abstract vehicle | 7.5 | 450 vehicles per hour per abstract vehicle per minute | Scaling choice |
| SUMO discharge rates | `simulation/sumo/network/calibration.json` | Measured by `calibrate.py` on the synthetic network | Measured on synthetic network, uncertainty not quantified |
| SUMO driver model | accel 2.6, decel 4.5, sigma 0.5, tau 1.0, speed factor 1.0 +/- 0.1 | Assumed values in `dm_run.py` | Not calibrated |
| SUMO horizon | 3600 s | Runner constant | Mismatch with 7200 s, open |
