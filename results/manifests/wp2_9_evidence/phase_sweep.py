import sys; sys.path.insert(0,'src')
import confirmatory as c
sc=next(s for s in c.SCENARIOS if s['name']=='near_branch_capacity')
vs=c.make_vehicles(sc['n'],sc['spacing_s'])
def tot(pol,off):
    r,d,b=c.assign_policy(vs,sc['scale'],pol,30.0,off)
    return c.summarize(vs,r,sc['scale'],pol,d,b)[0]['total_fleet_travel_time_vehicle_min']
print('offset_s,independent,coordinated,improvement_pct')
for off in (0,5,10,15,20,25):
    i,k=tot('independent_periodic',float(off)),tot('coordinated_batch',float(off))
    print(f'{off},{i:.4f},{k:.4f},{100*(i-k)/i:.2f}')
