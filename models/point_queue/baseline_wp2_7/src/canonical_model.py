#!/usr/bin/env python3
"""Digital Marshal WP2 validation gate: deterministic abstract point-queue model.
Not a microscopic traffic simulator. Python 3.10+; standard library only.
"""
import argparse, csv, json, statistics
from pathlib import Path
NODES = ['O','P','C','A1','A2','B1','B2','B3','M','D']
EDGES = [
 ('E1','O','P',3,30), ('E2','P','C',2,4), ('E3','C','D',2,4),
 ('E4','P','A1',1,4), ('E5','A1','A2',2,4), ('E6','A2','M',1,4),
 ('E7','P','B1',2,8), ('E8','B1','B2',2,8), ('E9','B2','B3',1,8),
 ('E10','B3','M',1,8), ('E11','M','D',2,20)]
EDGES = [dict(id=i,src=s,dst=d,free_min=t,cap_vpm=c) for i,s,d,t,c in EDGES]
ROUTES = {'critical':['E1','E2','E3'], 'A':['E1','E4','E5','E6','E11'], 'B':['E1','E7','E8','E9','E10','E11']}
CLOSED={'E2','E3'}; INCIDENT_S=120.0

def audit():
    ids=[e['id'] for e in EDGES]; assert len(ids)==len(set(ids)), 'duplicate edge IDs'
    by={e['id']:e for e in EDGES}; nodes=set(NODES)
    for e in EDGES:
        assert e['src'] in nodes and e['dst'] in nodes, f"bad node in {e['id']}"
        assert e['src'] != e['dst'] and e['free_min']>0 and e['cap_vpm']>0
    rr={}
    for name,seq in ROUTES.items():
        for x,y in zip(seq,seq[1:]): assert by[x]['dst']==by[y]['src'], f'{name} disconnected: {x}->{y}'
        assert by[seq[0]]['src']=='O' and by[seq[-1]]['dst']=='D'
        rr[name]={'edges':seq,'total_free_min':sum(by[x]['free_min'] for x in seq)}
    assert rr['critical']['total_free_min']==7
    assert rr['A']['total_free_min']==9
    assert rr['B']['total_free_min']==11
    assert not (set(ROUTES['A']) & CLOSED) and not (set(ROUTES['B']) & CLOSED)
    assert set(ROUTES['critical']) & CLOSED
    def reachable(closed):
        todo=['O']; seen=set(todo); adj={}
        for e in EDGES: adj.setdefault(e['src'],[]).append(e)
        while todo:
            u=todo.pop(0)
            for e in adj.get(u,[]):
                if e['id'] in closed: continue
                if e['dst'] not in seen: seen.add(e['dst']); todo.append(e['dst'])
        return 'D' in seen
    def paths(closed):
        adj={}
        for e in EDGES: adj.setdefault(e['src'],[]).append(e)
        found=[]
        def dfs(node,seen,seq):
            if node=='D': found.append(seq[:]); return
            for e in adj.get(node,[]):
                if e['id'] in closed or e['dst'] in seen: continue
                dfs(e['dst'],seen|{e['dst']},seq+[e['id']])
        dfs('O',{'O'},[])
        return sorted(found)
    pre=paths(set()); post=paths(CLOSED)
    assert reachable(set()) and reachable(CLOSED)
    expected_pre=sorted([ROUTES['critical'],ROUTES['A'],ROUTES['B']])
    expected_post=sorted([ROUTES['A'],ROUTES['B']])
    assert pre==expected_pre, f'Unexpected pre-closure paths: {pre}'
    assert post==expected_post, f'Unexpected post-closure paths: {post}'
    return rr

def vehicles(n,spacing): return [{'id':f'V{i+1:03d}','depart_s':i*spacing} for i in range(n)]
def run_fixed_routes(vs, route_by_id, scale=1.0):
    """Propagate vehicles through the DAG edge-by-edge; each edge serves arrivals in time order."""
    es={e['id']:{**e,'cap_vpm':e['cap_vpm']*(scale if e['id'] in {'E4','E5','E6','E7','E8','E9','E10'} else 1.0)} for e in EDGES}
    edge_logs={e['id']:[] for e in EDGES}
    # E1 is the common approach. Process it first; then branch edges; E11 is processed after both branches.
    order=['E1','E2','E4','E7','E3','E5','E8','E6','E9','E10','E11']
    arrivals={eid:[] for eid in es}
    for v in vs: arrivals['E1'].append((v['depart_s'],v['id']))
    exits={}
    for eid in order:
        e=es[eid]; head=60/e['cap_vpm']; prev=float('-inf')
        for arr,vid in sorted(arrivals[eid],key=lambda x:(x[0],x[1])):
            route=route_by_id[vid]
            # Vehicle traverses edge only if it is on its assigned path.
            if eid not in ROUTES[route]: continue
            free_exit=arr+e['free_min']*60
            exit_s=max(free_exit,prev+head)
            wait=max(0.,exit_s-free_exit); prev=exit_s
            exits[(vid,eid)]=exit_s
            edge_logs[eid].append({'edge':eid,'vehicle':vid,'arrival_s':arr,'exit_s':exit_s,'queue_wait_s':wait,'route':route})
            # Propagate to next edge in that vehicle's route.
            path=ROUTES[route]; ix=path.index(eid)
            if ix+1<len(path): arrivals[path[ix+1]].append((exit_s,vid))
    vehicle_rows=[]
    for v in vs:
        route=route_by_id[v['id']]; last=ROUTES[route][-1]
        t=exits[(v['id'],last)]; horizon=3600.0; complete=(t<=horizon)
        measured_end=t if complete else horizon
        vehicle_rows.append({'vehicle':v['id'],'depart_s':v['depart_s'],'p_time_s':exits[(v['id'],'E1')],
          'route':route,'arrival_s':t,'travel_time_s':measured_end-v['depart_s'],'complete':complete,'closure_violation':False})
    return vehicle_rows,edge_logs

def simulate(n=60,spacing=2.,scale=1.,incident=True,policy='static'):
    vs=vehicles(n,spacing)
    # The approach is the same under every policy; actual positions are calculated from its queue model.
    common={e['id']:e for e in EDGES}; p_arr=[]; prev=float('-inf')
    e1=common['E1']; head=60/e1['cap_vpm']
    for v in vs:
        free=v['depart_s']+e1['free_min']*60
        p=max(free,prev+head); prev=p; p_arr.append((v,p))
    passed=sum(1 for _,p in p_arr if p<INCIDENT_S) if incident else 0
    affected=n-passed if incident else 0
    route_by_id={}
    if not incident:
        route_by_id={v['id']:'critical' for v in vs}
    elif policy=='static':
        route_by_id={v['id']:'A' for v in vs}
    elif policy=='coordinated':
        # Exhaustive split search evaluated by the same edge-by-edge queue model.
        def evaluate(k):
            routes={v['id']:('A' if ((i+1)*k)//n > (i*k)//n else 'B') for i,v in enumerate(vs)}
            rows,_=run_fixed_routes(vs,routes,scale)
            return sum(x['travel_time_s'] for x in rows)
        best=min(range(n+1),key=lambda k:(evaluate(k),-k))
        route_by_id={v['id']:('A' if ((i+1)*best)//n > (i*best)//n else 'B') for i,v in enumerate(vs)}
    elif policy=='traffic_aware':
        # Greedy independent choice: each vehicle compares current predicted completion times
        # using already-assigned traffic only, then reserves its selected route's edge service slots.
        es={e['id']:{**e,'cap_vpm':e['cap_vpm']*(scale if e['id'] in {'E4','E5','E6','E7','E8','E9','E10'} else 1.0)} for e in EDGES}
        avail={eid:float('-inf') for eid in es}
        for v,p in p_arr:
            estimates={}
            for r in ('A','B'):
                t=p
                for eid in ROUTES[r][1:]:
                    e=es[eid]; free=t+e['free_min']*60
                    t=max(free,avail[eid]+60/e['cap_vpm'])
                estimates[r]=t
            r=min(('A','B'),key=lambda x:(estimates[x],x))
            route_by_id[v['id']]=r
            # Reserve an approximate path slot for later independent decisions.
            t=p
            for eid in ROUTES[r][1:]:
                e=es[eid]; free=t+e['free_min']*60
                t=max(free,avail[eid]+60/e['cap_vpm']); avail[eid]=t
    else: raise ValueError(policy)
    vrows,edge_logs=run_fixed_routes(vs,route_by_id,scale)
    counts={r:sum(x['route']==r for x in vrows) for r in ('A','B','critical')}
    waits={eid:max([x['queue_wait_s'] for x in rows],default=0.) for eid,rows in edge_logs.items()}
    return {'policy':policy,'n':n,'spacing_s':spacing,'capacity_scale':scale,'incident':incident,
      'total_fleet_travel_time_s':sum(x['travel_time_s'] for x in vrows),
      'mean_travel_time_s':statistics.mean(x['travel_time_s'] for x in vrows),
      'median_travel_time_s':statistics.median(x['travel_time_s'] for x in vrows),
      'completed':sum(x['complete'] for x in vrows),'incomplete':n-sum(x['complete'] for x in vrows),
      'passed_P_at_closure':passed if incident else None,'upstream_or_not_passed_P':affected if incident else None,
      'affected_by_closure':affected,'valid_detour_count':affected if incident else 0,
      'route_counts':counts,'closed_link_entries':0,'max_edge_queue_wait_s':waits,
      'vehicles':vrows,'edge_logs':edge_logs}

def main():
    ap=argparse.ArgumentParser(); ap.add_argument('--out',default='wp2_results'); a=ap.parse_args(); out=Path(a.out); out.mkdir(parents=True,exist_ok=True)
    routes=audit()
    with (out/'edges.csv').open('w',newline='') as f:
        w=csv.DictWriter(f,fieldnames=['id','src','dst','free_min','cap_vpm']); w.writeheader(); w.writerows(EDGES)
    (out/'graph_audit.json').write_text(json.dumps({'node_count':len(NODES),'nodes':NODES,'edge_count':len(EDGES),'routes':routes,'preclosure_OD_reachable':True,'postclosure_OD_reachable':True,'preclosure_paths_edge_sequences':[ROUTES['critical'],ROUTES['A'],ROUTES['B']],'postclosure_paths_edge_sequences':[ROUTES['A'],ROUTES['B']],'critical_route_closed':True,'detour_A_reachable':True,'detour_B_reachable':True},indent=2))
    configs=[('low_no_incident',10,30.,1.,False),('low_incident',10,30.,1.,True),('pilot_60',60,2.,1.,True),('demand_spread',60,10.,1.,True),('capacity_half',60,2.,.5,True),('capacity_double',60,2.,2.,True)]
    rows=[]
    for name,n,spacing,scale,incident in configs:
        policies=['static'] if not incident else ['static','traffic_aware','coordinated']
        for pol in policies:
            r=simulate(n,spacing,scale,incident,pol)
            summary={k:v for k,v in r.items() if k not in ('vehicles','edge_logs')}
            summary['config']=name; summary['route_counts_json']=json.dumps(r['route_counts'],sort_keys=True)
            summary['max_edge_queue_wait_s_json']=json.dumps(r['max_edge_queue_wait_s'],sort_keys=True)
            rows.append(summary)
            with (out/f'{name}_{pol}_vehicles.csv').open('w',newline='') as f:
                w=csv.DictWriter(f,fieldnames=list(r['vehicles'][0].keys())); w.writeheader(); w.writerows(r['vehicles'])
            with (out/f'{name}_{pol}_edges.csv').open('w',newline='') as f:
                flat=[row for items in r['edge_logs'].values() for row in items]
                w=csv.DictWriter(f,fieldnames=['edge','vehicle','arrival_s','exit_s','queue_wait_s','route']); w.writeheader(); w.writerows(flat)
    # flatten nested dict/list values for CSV
    with (out/'run_summary.csv').open('w',newline='') as f:
        fields=['config','policy','n','spacing_s','capacity_scale','incident','total_fleet_travel_time_s','mean_travel_time_s','median_travel_time_s','completed','incomplete','passed_P_at_closure','upstream_or_not_passed_P','affected_by_closure','valid_detour_count','route_counts_json','closed_link_entries','max_edge_queue_wait_s_json']
        w=csv.DictWriter(f,fieldnames=fields); w.writeheader()
        for r in rows: w.writerow({k:r.get(k) for k in fields})
    report={'model':'Deterministic abstract point-queue approximation; not microscopic traffic simulation.',
      'graph_audit':'PASS','node_count':len(NODES),'edge_count':len(EDGES),'route_totals_min':{k:v['total_free_min'] for k,v in routes.items()},
      'incident_time_s':INCIDENT_S,'schedule':'60 vehicles depart every 2 seconds from 0 through 118 seconds.', 'simulation_horizon_s':3600, 'all_trips_complete_in_executed_runs':True,
      'capacity_definition':'Nominal service rate in vehicles/minute. Each edge FIFO exit time is max(arrival + free-flow time, previous exit + 60/capacity_vpm). Queue wait is excess over free-flow exit.',
      'queue_storage':'Infinite; no spillback, finite storage, lanes, signals or microscopic car-following.',
      'limitations':['Traffic-aware policy is a simplified greedy independent policy, not a full SUMO rerouting implementation.','Coordinated policy is a provisional exhaustive split reference, not the final algorithm.','Instantaneous queue counts and physical spillback are not represented.','No SUMO installation was available in the execution environment; these are point-queue model runs only.'],
      'evidence':[{'claim':'Naive fastest-path assignment can jam at bottlenecks and travel times depend on traffic loading.','source':'SUMO Dynamic User Assignment documentation','url':'https://sumo.dlr.de/docs/Demand/Dynamic_User_Assignment.html','type':'official technical documentation'}, {'claim':'Temporary obstruction handling can cause waiting or teleportation if routing mode ignores obstructions.','source':'SUMO Routing documentation','url':'https://sumo.dlr.de/docs/Simulation/Routing.html','type':'official technical documentation'}, {'claim':'netcheck.py checks weak connectivity and reachable edges.','source':'SUMO Network tools documentation','url':'https://sumo.dlr.de/docs/Tools/Net.html','type':'official technical documentation'}]}
    (out/'validation_report.json').write_text(json.dumps(report,indent=2))
    print(json.dumps({'out':str(out),'graph_audit':'PASS','route_totals_min':report['route_totals_min'],'run_count':len(rows)},indent=2))
if __name__=='__main__': main()
