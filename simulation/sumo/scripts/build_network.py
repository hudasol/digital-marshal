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
  * Track C: branch_lane_factor multiplies the lane count of the branch edges E4..E10 (graph_spec.json
    branch_scaled_edges). Factor 2 realises the WP2.7 primary_double_capacity scale 2.0; lengths, speeds and node
    positions are unchanged. Output: network/branch_x2/.
usage: build_network.py OUTDIR [BRANCH_LANE_FACTOR]
"""
import subprocess, sys, os
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


BRANCH_EDGES = ('E4', 'E5', 'E6', 'E7', 'E8', 'E9', 'E10')


P_OUT = ('E4', 'E7', 'E2')   # outgoing edges at the P diverge, rightmost first (same lane order as the base network)


def lanes(edge_id, ln, branch_lane_factor=1):
    """Lane count of an edge. Branch edges scale with the factor. E1 keeps one approach lane per outgoing lane at P, so
    that the diverge does not cap a branch below its own lane count (base: 1 + 2 + 1 = 4, unchanged)."""
    if edge_id in BRANCH_EDGES: return ln * branch_lane_factor
    if edge_id == 'E1' and branch_lane_factor != 1:
        base = {i: n for i, _, _, _, n in EDGES}
        return sum(lanes(e, base[e], branch_lane_factor) for e in P_OUT)
    return ln


def p_connections(branch_lane_factor):
    """Explicit one-to-one E1 lane -> outgoing lane connections at P, in P_OUT order (rightmost lanes feed E4)."""
    base = {i: n for i, _, _, _, n in EDGES}; cons, k = [], 0
    for e in P_OUT:
        for to_lane in range(lanes(e, base[e], branch_lane_factor)):
            cons.append(('E1', e, k, to_lane)); k += 1
    return cons


def build(outdir, branch_lane_factor=1):
    out = Path(outdir); out.mkdir(parents=True, exist_ok=True)
    (out / 'dm.nod.xml').write_text('<nodes>\n' + '\n'.join(
        f'  <node id="{n}" x="{x}" y="{y}" type="priority"/>' for n, (x, y) in NODES.items()) + '\n</nodes>\n', newline='\n')
    (out / 'dm.edg.xml').write_text('<edges>\n' + '\n'.join(
        f'  <edge id="{i}" from="{a}" to="{b}" numLanes="{lanes(i, ln, branch_lane_factor)}" speed="{V}" length="{edge_len(t)}"/>'
        for i, a, b, t, ln in EDGES) + '\n</edges>\n', newline='\n')
    (out / 'dm.rou.xml').write_text('<routes>\n' + '\n'.join(
        f'  <route id="{k}" edges="{" ".join(v)}"/>' for k, v in ROUTES.items()) + '\n</routes>\n', newline='\n')
    cmd = ['netconvert', '--node-files', str(out / 'dm.nod.xml'), '--edge-files', str(out / 'dm.edg.xml'),
           '-o', str(out / 'dm.net.xml'), '--no-turnarounds', 'true']
    if branch_lane_factor != 1:      # the base network keeps netconvert's own connections (it is historical)
        (out / 'dm.con.xml').write_text('<connections>\n' + '\n'.join(
            f'  <connection from="{a}" to="{b}" fromLane="{fl}" toLane="{tl}"/>' for a, b, fl, tl in p_connections(branch_lane_factor))
            + '\n</connections>\n', newline='\n')
        cmd += ['--connection-files', str(out / 'dm.con.xml')]
    subprocess.run(cmd, check=True)
    return out / 'dm.net.xml'


if __name__ == '__main__':
    print(build(sys.argv[1], int(sys.argv[2]) if len(sys.argv) > 2 else 1))
