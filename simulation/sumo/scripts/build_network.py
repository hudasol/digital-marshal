#!/usr/bin/env python3
"""Build the synthetic Digital Marshal SUMO network (same graph as the WP2.7 point-queue model).

Design choices (all synthetic, none calibrated to Dubai):
  * Free-flow time of every edge equals the point-queue value: length = free_min * 60 * V.
  * Capacity RATIOS follow the point-queue table with 1 abstract veh/min == UNIT_VEH_H veh/h.
    SUMO has no 'service rate' knob, so capacity is expressed as lane count:
        E4-E6 (cap 4)  -> 1 lane      E7-E10 (cap 8) -> 2 lanes      E2,E3 (cap 4) -> 1 lane
        E1 (cap 30) and E11 (cap 20) are non-binding in the abstract model; they get 4 lanes each
        so that they stay non-binding for the near-capacity demand (see README for the overload caveat).
  * Real discharge rates are MEASURED by calibrate.py rather than assumed.
usage: build_network.py OUTDIR [--lane-scale 2]
  --lane-scale N multiplies the lane count of the branch edges E4..E10 (the edges the point queue's capacity_scale applies to) and
  writes dm_cap<N>.* files; without it the historical baseline dm.* files are written. Capacity scale 0.5 cannot be built with
  integer lanes and is handled in dm_run.py by the driver time headway (see VARIANTS there).
"""
import argparse, subprocess, sys, os
from pathlib import Path

V = 13.89            # m/s, 50 km/h
UNIT_VEH_H = 450.0   # veh/h per abstract veh/min  (1800 veh/h == one saturated lane == 4 units)

# id, from, to, free_min, lanes   (free_min from the point-queue model / FAIR_BASELINE_SPEC section 2)
EDGES = [
    ('E1', 'O', 'P', 3, 4), ('E2', 'P', 'C', 2, 1), ('E3', 'C', 'D', 2, 1),
    ('E4', 'P', 'A1', 1, 1), ('E5', 'A1', 'A2', 2, 1), ('E6', 'A2', 'M', 1, 1),
    ('E7', 'P', 'B1', 2, 2), ('E8', 'B1', 'B2', 2, 2), ('E9', 'B2', 'B3', 1, 2), ('E10', 'B3', 'M', 1, 2),
    ('E11', 'M', 'D', 2, 4)]
# Near-straight geometry on purpose: sharp bends make netconvert reduce junction speed, which would corrupt free-flow times.
NODES = {'O': (0, 0), 'P': (600, 0), 'C': (1200, 100), 'A1': (1100, -100), 'A2': (1700, -100),
         'B1': (1100, 0), 'B2': (1700, 0), 'B3': (2000, 0), 'M': (2300, -50), 'D': (2900, -50)}
ROUTES = {'critical': ['E1', 'E2', 'E3'], 'A': ['E1', 'E4', 'E5', 'E6', 'E11'],
          'B': ['E1', 'E7', 'E8', 'E9', 'E10', 'E11']}


def edge_len(free_min): return round(free_min * 60 * V, 2)


BRANCH = {'E4', 'E5', 'E6', 'E7', 'E8', 'E9', 'E10'}


def build(outdir, lane_scale=1):
    out = Path(outdir); out.mkdir(parents=True, exist_ok=True)
    pre = 'dm' if lane_scale == 1 else f'dm_cap{lane_scale}'
    edges = [(i, a, b, t, ln * lane_scale if i in BRANCH else ln) for i, a, b, t, ln in EDGES]
    (out / f'{pre}.nod.xml').write_text('<nodes>\n' + '\n'.join(
        f'  <node id="{n}" x="{x}" y="{y}" type="priority"/>' for n, (x, y) in NODES.items()) + '\n</nodes>\n')
    (out / f'{pre}.edg.xml').write_text('<edges>\n' + '\n'.join(
        f'  <edge id="{i}" from="{a}" to="{b}" numLanes="{ln}" speed="{V}" length="{edge_len(t)}"/>'
        for i, a, b, t, ln in edges) + '\n</edges>\n')
    (out / f'{pre}.rou.xml').write_text('<routes>\n' + '\n'.join(
        f'  <route id="{k}" edges="{" ".join(v)}"/>' for k, v in ROUTES.items()) + '\n</routes>\n')
    cmd = ['netconvert', '--node-files', str(out / f'{pre}.nod.xml'), '--edge-files', str(out / f'{pre}.edg.xml'),
           '-o', str(out / f'{pre}.net.xml'), '--no-turnarounds', 'true']
    if lane_scale > 1:
        # A connection file replaces the defaults for every edge it names, so E1 to E7 is listed too. netconvert's default lane mapping feeds every lane of E4 from E1 lane 0, which would leave the branch A capacity unchanged.
        # Explicit one to one connections let the doubled lanes carry traffic (demonstrated by calibration_cap2.json).
        (out / f'{pre}.con.xml').write_text('<connections>\n' + '\n'.join(
            f'  <connection from="E1" to="E4" fromLane="{k}" toLane="{k}"/>' for k in range(lane_scale)) + '\n' + '\n'.join(
            f'  <connection from="E1" to="E7" fromLane="{k}" toLane="{k}"/>' for k in range(2 * lane_scale)) + '\n</connections>\n')
        cmd += ['--connection-files', str(out / f'{pre}.con.xml')]
    subprocess.run(cmd, check=True)
    return out / f'{pre}.net.xml'


if __name__ == '__main__':
    ap = argparse.ArgumentParser(); ap.add_argument('outdir'); ap.add_argument('--lane-scale', type=int, default=1); a = ap.parse_args()
    print(build(a.outdir, a.lane_scale))
