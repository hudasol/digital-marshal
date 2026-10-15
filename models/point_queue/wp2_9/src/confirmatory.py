#!/usr/bin/env python3
"""WP2.7 periodic independent vs information-matched coordinated assignment.
Synthetic deterministic point-queue model; not a microscopic or calibrated traffic simulator.
"""
import csv, json, math, statistics, hashlib, sys, platform
from pathlib import Path
import canonical_model as m
import raw_audit

UPDATE_S = 30.0
HORIZON_S = m.HORIZON_S          # single source of truth (was a separate 7200 here and a hard-coded 3600 in the model)
AUDIT_SPEC = raw_audit.load_spec()   # independent graph/scenario spec; see config/graph_spec.json
# Queue-discipline checks reported under the legacy 'fifo_violations' column (name kept so the CSV stays byte-identical).
QUEUE_CHECKS = {'overtaking','headway_below_service_time','server_idle_while_vehicle_waited','faster_than_free_flow','wait_bookkeeping'}
BRANCH_IDS = {'E4','E5','E6','E7','E8','E9','E10'}

SCENARIOS = [
    {'name':'manageable_primary','n':10,'spacing_s':10.0,'scale':1.0},
    {'name':'near_branch_capacity','n':24,'spacing_s':5.0,'scale':1.0},
    {'name':'overload_stress','n':60,'spacing_s':2.0,'scale':1.0},
    {'name':'primary_half_capacity','n':10,'spacing_s':10.0,'scale':0.5},
    {'name':'primary_double_capacity','n':10,'spacing_s':10.0,'scale':2.0},
]

def make_vehicles(n, spacing):
    vs=m.vehicles(n,spacing)
    # The E1 FIFO queue determines each vehicle's arrival at P.
    prev=-float('inf'); e1=next(e for e in m.EDGES if e['id']=='E1'); head=60/e1['cap_vpm']
    for v in vs:
        v['p_arrival_s']=max(v['depart_s']+e1['free_min']*60,prev+head); prev=v['p_arrival_s']
    return vs

def edge_costs(scale):
    return {e['id']:{**e,'cap_vpm':e['cap_vpm']*(scale if e['id'] in BRANCH_IDS else 1.0)} for e in m.EDGES}

def estimate_added_vehicle(v, route, assigned, vs, scale):
    """One-agent estimate against only already committed vehicles; no future realized exits."""
    active=[x for x in vs if x['id'] in assigned or x['id']==v['id']]
    routes={x['id']:assigned[x['id']] for x in active if x['id'] in assigned}
    routes[v['id']]=route
    rows,_=m.run_fixed_routes(active,routes,scale)
    row=next(x for x in rows if x['vehicle']==v['id'])
    return row['arrival_s']

def evaluate_assignment(vs, assigned, scale, score_ids):
    # Simulate only committed and current-batch vehicles. Excluding future vehicles avoids
    # accidental look-ahead through route-dependent merge arrival times.
    active=[v for v in vs if v['id'] in assigned or v['id'] in set(score_ids)]
    routes={v['id']:assigned[v['id']] for v in active if v['id'] in assigned}
    routes.update({vid:assigned[vid] for vid in score_ids if vid in assigned})
    rows,logs=m.run_fixed_routes(active,routes,scale)
    score=set(score_ids)
    total=sum(r['travel_time_s'] for r in rows if r['vehicle'] in score)
    return total, rows, logs

def batches(vs, update_s=None, offset_s=0.0):
    # Common decision epochs anchored at t=180, the first possible P arrival. Defaults reproduce WP2.7 exactly.
    # update_s / offset_s exist only for exploratory sensitivity runs; the frozen experiment never passes them.
    u=UPDATE_S if update_s is None else update_s
    assert 0.0<=offset_s<u, 'offset_s must lie in [0, update_s)'
    groups={}
    for v in vs:
        if offset_s==0.0:
            epoch=180.0+math.floor(max(0.0,v['p_arrival_s']-180.0)/u)*u
        else:
            # Shifted grid. Anchoring one period earlier guarantees epoch <= P arrival, i.e. no retroactive decisions.
            anchor=180.0+offset_s-u
            epoch=anchor+math.floor((v['p_arrival_s']-anchor)/u)*u
        groups.setdefault(epoch,[]).append(v)
    return [(t,sorted(group,key=lambda v:(v['p_arrival_s'],v['id']))) for t,group in sorted(groups.items())]

def assign_policy(vs, scale, policy, update_s=None, offset_s=0.0):
    assigned={}; decision_log=[]; batch_stats=[]
    for epoch, group in batches(vs, update_s, offset_s):
        ids=[v['id'] for v in group]
        before=dict(assigned)
        if policy=='static':
            choices={v['id']:'A' for v in group}
            method='static_free_flow_shortest'
        elif policy=='independent_periodic':
            # Same pre-batch snapshot for every vehicle in the batch. No vehicle can see peers'
            # simultaneous uncommitted choices; this is the deliberate herding/independent policy.
            probe=group[0]
            costA=estimate_added_vehicle(probe,'A',before,vs,scale)
            costB=estimate_added_vehicle(probe,'B',before,vs,scale)
            chosen=min(('A','B'),key=lambda r:({'A':costA,'B':costB}[r],r))
            choices={v['id']:chosen for v in group}
            method='same_snapshot_independent_argmin_no_peer_reservation'
        elif policy=='coordinated_batch':
            # Same graph, capacities, incident, 30-second batch and schedule. Only difference is
            # joint allocation within the current batch. Exhaust all A/B counts and evenly spread
            # A assignments across the batch; score all committed + current vehicles, not future trips.
            best=None; best_choices=None; best_k=None
            for k in range(len(group)+1):
                cand=dict(before)
                for i,v in enumerate(group):
                    cand[v['id']]='A' if ((i+1)*k)//len(group) > (i*k)//len(group) else 'B'
                score_ids=list(before)+ids
                score,_,_=evaluate_assignment(vs,cand,scale,score_ids)
                key=(score,-k)
                if best is None or key<best:
                    best=key; best_choices={v['id']:cand[v['id']] for v in group}; best_k=k
            choices=best_choices; method='joint_batch_split_exhaustive_min_total_committed_plus_current'
        else: raise ValueError(policy)
        assigned.update(choices)
        for v in group:
            decision_log.append({'vehicle':v['id'],'decision_epoch_s':epoch,'p_arrival_s':v['p_arrival_s'],
                'seconds_after_incident':epoch-m.INCIDENT_S,'policy':policy,'chosen_route':choices[v['id']],
                'eligible_routes':'A;B','available_info':'same synthetic graph, free-flow times, nominal capacities, closure at 120s, common departure/P-arrival schedule, prior committed assignments only; no future realized exits',
                'decision_method':method,'route_switches':0})
        batch_stats.append({'epoch_s':epoch,'batch_size':len(group),'A_count':sum(choices[x['id']]=='A' for x in group),
            'B_count':sum(choices[x['id']]=='B' for x in group),'dominant_route_share':max(sum(choices[x['id']]==r for x in group) for r in ('A','B'))/len(group),
            'coordinator_A_split':best_k if policy=='coordinated_batch' else None})
    return assigned,decision_log,batch_stats

def independent_audit(vs, rows, logs, scale):
    """WP2.9: replaces the circular audit_fifo (which re-applied the model's own recurrence). Delegates to raw_audit, which
    shares no code or graph definition with the model. Returns the legacy {'events_checked','violations','pass'} shape for the
    queue-discipline checks, plus the full audit under 'audit'."""
    events=[e for evs in logs.values() for e in evs]
    spacing=vs[1]['depart_s']-vs[0]['depart_s'] if len(vs)>1 else None
    full=raw_audit.audit_run(AUDIT_SPEC,events,rows,scale=scale,expected_vehicles=len(vs),spacing_s=spacing,horizon_s=HORIZON_S)
    queue=[v for v in full['violations'] if v['check'] in QUEUE_CHECKS]
    return {'events_checked':full['events_checked'],'violations':queue,'pass':not queue,'audit':full}

def summarize(vs, routes, scale, policy, decisions, batch_stats):
    rows,logs=m.run_fixed_routes(vs,routes,scale,horizon_s=HORIZON_S)
    byid={r['vehicle']:r for r in rows}
    travel=[r['travel_time_s']/60 for r in rows]
    sorted_t=sorted(travel); p95=sorted_t[math.ceil(.95*len(sorted_t))-1]
    fifo=independent_audit(vs,rows,logs,scale)
    closed_entries=sum(r['closure_violation'] for r in rows)
    ac=sum(r=='A' for r in routes.values()); bc=sum(r=='B' for r in routes.values())
    maxshare=max((b['dominant_route_share'] for b in batch_stats),default=0)
    primary_pass=(all(r['complete'] for r in rows) and fifo['audit']['pass'] and closed_entries==0)
    metrics={'policy':policy,'vehicles':len(vs),'departure_spacing_s':vs[1]['depart_s']-vs[0]['depart_s'] if len(vs)>1 else None,
      'demand_veh_per_min':60/(vs[1]['depart_s']-vs[0]['depart_s']) if len(vs)>1 else None,'capacity_scale_E4_E10_only':scale,
      'total_fleet_travel_time_vehicle_min':round(sum(travel),6),'mean_travel_time_min':round(statistics.mean(travel),6),
      'median_travel_time_min':round(statistics.median(travel),6),'p95_nearest_rank_min':round(p95,6),
      'completed':sum(r['complete'] for r in rows),'incomplete':sum(not r['complete'] for r in rows),
      'route_A_count':ac,'route_B_count':bc,'route_A_share':round(ac/len(vs),6),'route_B_share':round(bc/len(vs),6),
      'max_30s_batch_dominant_route_share':round(maxshare,6),'route_switches_total':sum(r['route_switches'] for r in decisions),
      'first_feasible_decision_after_incident_s':min((d['decision_epoch_s']-m.INCIDENT_S for d in decisions),default=None),
      'closed_link_entries':closed_entries,'fifo_events_checked':fifo['events_checked'],'fifo_violations':len(fifo['violations']),
      'all_trips_complete':all(r['complete'] for r in rows),'checks_pass':primary_pass}
    return metrics, rows, logs, fifo

def run_all(outdir):
    out=Path(outdir); out.mkdir(parents=True,exist_ok=True)
    all_metrics=[]; all_decisions=[]; all_batch=[]; all_vehicle=[]; all_edges=[]; audit_rows=[]
    for sc in SCENARIOS:
        vs=make_vehicles(sc['n'],sc['spacing_s'])
        # Schedule/incident preconditions are assertions, not post-hoc exclusions.
        assert max(v['depart_s'] for v in vs)<m.INCIDENT_S
        assert min(v['p_arrival_s'] for v in vs)>=m.INCIDENT_S
        for pol in ('static','independent_periodic','coordinated_batch'):
            routes,decisions,batch_stats=assign_policy(vs,sc['scale'],pol)
            metrics,vehicle_rows,edge_logs,fifo=summarize(vs,routes,sc['scale'],pol,decisions,batch_stats)
            metrics.update({'scenario':sc['name'],'scenario_n':sc['n'],'scenario_spacing_s':sc['spacing_s']})
            all_metrics.append(metrics)
            for d in decisions: all_decisions.append({'scenario':sc['name'],**d})
            for b in batch_stats: all_batch.append({'scenario':sc['name'],'policy':pol,**b})
            for v in vehicle_rows: all_vehicle.append({'scenario':sc['name'],'policy':pol,**v})
            for eid,events in edge_logs.items():
                for e in events: all_edges.append({'scenario':sc['name'],'policy':pol,**e})
            audit_rows.append({'scenario':sc['name'],'policy':pol,
                'all_depart_before_incident':max(v['depart_s'] for v in vs)<m.INCIDENT_S,
                'all_p_arrivals_at_or_after_incident':min(v['p_arrival_s'] for v in vs)>=m.INCIDENT_S,
                'all_trips_complete':metrics['all_trips_complete'],'fifo':fifo,'zero_closed_link_entries':metrics['closed_link_entries']==0,
                'horizon_s':HORIZON_S,'overall_pass':metrics['checks_pass']})
    def write_csv(name,rows):
        if not rows: return
        with (out/name).open('w',newline='') as f:
            w=csv.DictWriter(f,fieldnames=list(rows[0])); w.writeheader(); w.writerows(rows)
    write_csv('confirmatory_metrics.csv',all_metrics); write_csv('decision_log.csv',all_decisions); write_csv('batch_allocation_log.csv',all_batch); write_csv('vehicle_records.csv',all_vehicle); write_csv('edge_event_records.csv',all_edges)
    (out/'invariant_audit.json').write_text(json.dumps(audit_rows,indent=2))
    # Confirmatory metrics frozen before this run. Threshold is proposal until team approves it.
    metric_spec={'primary':'total_fleet_travel_time_vehicle_min = sum(arrival_s - scheduled_departure_s) / 60 across every vehicle; no censoring in these runs',
      'secondary':['mean and median travel time in minutes','nearest-rank P95: sorted completed travel times at 1-based index ceil(0.95*n)','completed/incomplete count','route A/B counts and shares','maximum dominant-route share in any 30-second decision batch','total route switches (zero by design because route is locked at P entry; rerouting mid-branch is prohibited)','seconds from incident activation to first feasible route decision','closed-link entries','FIFO recurrence violations and event count'],
      'frozen_before_execution':True,'horizon_s':HORIZON_S,'decision_interval_s':UPDATE_S,'tie_break':'Independent: Route A before B on exact estimated-cost tie. Coordinator: among equal total travel-time scores, prefer the larger A count (key=(score,-k)). Vehicle order within a batch is (P arrival timestamp, vehicle ID).','threshold_proposal_not_approved':'At least 5% lower total fleet travel time than independent_periodic in primary near-capacity scenario, zero closed-link entries, zero FIFO violations, all trips complete, and no P95 degradation. Team approval required before treating as acceptance gate.'}
    (out/'metric_spec.json').write_text(json.dumps(metric_spec,indent=2))
    return all_metrics,audit_rows

if __name__=='__main__':
    import argparse
    ap=argparse.ArgumentParser(); ap.add_argument('--out',default='results'); args=ap.parse_args()
    metrics,audits=run_all(args.out)
    print(json.dumps({'runs':len(metrics),'all_invariants_pass':all(a['overall_pass'] for a in audits),'metrics':[{k:r[k] for k in ('scenario','policy','total_fleet_travel_time_vehicle_min','route_A_count','route_B_count','max_30s_batch_dominant_route_share','fifo_violations','checks_pass')} for r in metrics]},indent=2))
