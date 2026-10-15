/* Digital Marshal live engine: JavaScript port of models/point_queue/wp2_9 (canonical_model.py and confirmatory.py).
   Used only for live incident injection. Verified against the frozen results at an incident time of 120 s. */
(function(root){
'use strict';
var ROUTES={critical:['E1','E2','E3'],A:['E1','E4','E5','E6','E11'],B:['E1','E7','E8','E9','E10','E11']};
var BRANCH={E4:1,E5:1,E6:1,E7:1,E8:1,E9:1,E10:1};
var ORDER=['E1','E2','E4','E7','E3','E5','E8','E6','E9','E10','E11'];
var UPDATE=30;
function edgesOf(D,scale){var es={};D.graph.edges.forEach(function(e){es[e.id]={id:e.id,free_min:e.free_min,cap_vpm:e.cap_vpm*(BRANCH[e.id]?scale:1)};});return es;}
function runFixed(D,vs,routeById,scale){
  var es=edgesOf(D,scale),logs={},arrivals={};
  Object.keys(es).forEach(function(k){logs[k]=[];arrivals[k]=[];});
  vs.forEach(function(v){arrivals.E1.push([v.depart_s,v.id]);});
  var exits={};
  ORDER.forEach(function(eid){
    var e=es[eid],head=60/e.cap_vpm,prev=-Infinity;
    arrivals[eid].sort(function(a,b){return a[0]-b[0]||(a[1]<b[1]?-1:a[1]>b[1]?1:0);});
    arrivals[eid].forEach(function(x){
      var arr=x[0],vid=x[1],route=routeById[vid];
      if(ROUTES[route].indexOf(eid)<0)return;
      var freeExit=arr+e.free_min*60,exit=Math.max(freeExit,prev+head),wait=Math.max(0,exit-freeExit);prev=exit;
      exits[vid+'|'+eid]=exit;
      logs[eid].push({edge:eid,vehicle:vid,arrival_s:arr,exit_s:exit,queue_wait_s:wait,route:route});
      var path=ROUTES[route],ix=path.indexOf(eid);
      if(ix+1<path.length)arrivals[path[ix+1]].push([exit,vid]);
    });
  });
  var rows=vs.map(function(v){var route=routeById[v.id],last=ROUTES[route][ROUTES[route].length-1],t=exits[v.id+'|'+last];
    return {vehicle:v.id,depart_s:v.depart_s,p_time_s:exits[v.id+'|E1'],route:route,arrival_s:t,travel_time_s:t-v.depart_s};});
  return {rows:rows,logs:logs};
}
function makeVehicles(D,n,spacing){
  var e1=null;D.graph.edges.forEach(function(e){if(e.id==='E1')e1=e;});
  var head=60/e1.cap_vpm,prev=-Infinity,vs=[];
  for(var i=0;i<n;i++){var id='V'+('000'+(i+1)).slice(-3),d=i*spacing,p=Math.max(d+e1.free_min*60,prev+head);prev=p;vs.push({id:id,depart_s:d,p_arrival_s:p});}
  return vs;
}
function batches(vs,T){
  var groups={};
  vs.forEach(function(v){
    if(v.p_arrival_s<T)return;
    var epoch=180+Math.floor(Math.max(0,v.p_arrival_s-180)/UPDATE)*UPDATE;
    if(epoch<T)epoch=T;
    (groups[epoch]=groups[epoch]||[]).push(v);
  });
  return Object.keys(groups).map(Number).sort(function(a,b){return a-b;}).map(function(t){
    return [t,groups[t].sort(function(a,b){return a.p_arrival_s-b.p_arrival_s||(a.id<b.id?-1:1);})];
  });
}
function subset(vs,idset){return vs.filter(function(v){return idset[v.id];});}
function assign(D,vs,scale,policy,T){
  var assigned={},stats=[];
  vs.forEach(function(v){if(v.p_arrival_s<T)assigned[v.id]='critical';});   // already past the split point before the incident
  batches(vs,T).forEach(function(b){
    var epoch=b[0],group=b[1],before={};Object.keys(assigned).forEach(function(k){before[k]=assigned[k];});
    var choices={},bestK=null;
    if(policy==='static'){group.forEach(function(v){choices[v.id]='A';});}
    else if(policy==='independent_periodic'){
      var probe=group[0],cost={};
      ['A','B'].forEach(function(r){
        var ids={};Object.keys(before).forEach(function(k){ids[k]=1;});ids[probe.id]=1;
        var routes={};Object.keys(before).forEach(function(k){routes[k]=before[k];});routes[probe.id]=r;
        var res=runFixed(D,subset(vs,ids),routes,scale);
        cost[r]=res.rows.filter(function(x){return x.vehicle===probe.id;})[0].arrival_s;
      });
      var chosen=cost.A<=cost.B?'A':'B';
      group.forEach(function(v){choices[v.id]=chosen;});
    } else {
      var best=null,n=group.length;
      for(var k=0;k<=n;k++){
        var cand={};Object.keys(before).forEach(function(q){cand[q]=before[q];});
        group.forEach(function(v,i){cand[v.id]=(((i+1)*k)/n|0)>((i*k)/n|0)?'A':'B';});
        // integer floor division as in the Python source
        group.forEach(function(v,i){cand[v.id]=(Math.floor((i+1)*k/n)>Math.floor(i*k/n))?'A':'B';});
        var scoreIds={};Object.keys(before).forEach(function(q){scoreIds[q]=1;});group.forEach(function(v){scoreIds[v.id]=1;});
        var active={};Object.keys(cand).forEach(function(q){active[q]=1;});
        var res=runFixed(D,subset(vs,active),cand,scale);
        var score=0;res.rows.forEach(function(r){if(scoreIds[r.vehicle])score+=r.travel_time_s;});
        if(best===null||score<best[0]||(score===best[0]&&-k<best[1])){best=[score,-k];bestK=k;var ch={};group.forEach(function(v){ch[v.id]=cand[v.id];});choices=ch;}
      }
    }
    Object.keys(choices).forEach(function(k){assigned[k]=choices[k];});
    var a=0;group.forEach(function(v){if(choices[v.id]==='A')a++;});
    stats.push([epoch,group.length,a,group.length-a]);
  });
  return {assigned:assigned,batches:stats};
}
function compute(D,scn,policy,T){
  var sc=D.scenarios[scn],vs=makeVehicles(D,sc.vehicles,sc.spacing_s),scale=sc.branch_capacity_scale;
  var as=assign(D,vs,scale,policy,T),res=runFixed(D,vs,as.assigned,scale);
  var vehicles={};
  res.rows.forEach(function(r){vehicles[r.vehicle]={d:r.depart_s,p:r.p_time_s,r:as.assigned[r.vehicle]==='critical'?'C':as.assigned[r.vehicle],a:r.arrival_s,ev:[]};});
  var viol=0,closedEntries=0,heads={};
  D.graph.edges.forEach(function(e){heads[e.id]=60/(e.cap_vpm*(BRANCH[e.id]?scale:1));});
  Object.keys(res.logs).forEach(function(eid){
    var prevExit=-Infinity,prevArr=-Infinity;
    res.logs[eid].forEach(function(l){
      vehicles[l.vehicle].ev.push([eid,l.arrival_s,l.exit_s,l.queue_wait_s]);
      var free=D.graph.edges.filter(function(e){return e.id===eid;})[0].free_min*60;
      if(l.exit_s<l.arrival_s+free-1e-9)viol++;
      if(l.exit_s<prevExit+heads[eid]-1e-9)viol++;
      if(l.arrival_s<prevArr-1e-9)viol++;
      prevExit=l.exit_s;prevArr=l.arrival_s;
      if((eid==='E2'||eid==='E3')&&vehicles[l.vehicle].p>=T)closedEntries++;   // vehicle committed after the closure was published
    });
  });
  Object.keys(vehicles).forEach(function(k){vehicles[k].ev.sort(function(a,b){return a[1]-b[1];});});
  var tt=res.rows.map(function(r){return r.travel_time_s/60;}),sorted=tt.slice().sort(function(a,b){return a-b;});
  var sum=tt.reduce(function(a,b){return a+b;},0),n=tt.length;
  var med=n%2?sorted[(n-1)/2]:(sorted[n/2-1]+sorted[n/2])/2,p95=sorted[Math.ceil(.95*n)-1];
  var cA=0,cB=0,cC=0;Object.keys(as.assigned).forEach(function(k){var r=as.assigned[k];if(r==='A')cA++;else if(r==='B')cB++;else cC++;});
  var maxshare=0;as.batches.forEach(function(b){maxshare=Math.max(maxshare,Math.max(b[2],b[3])/b[1]);});
  var m={total_fleet_travel_time_vehicle_min:String(Math.round(sum*1e6)/1e6),mean_travel_time_min:String(sum/n),median_travel_time_min:String(med),p95_nearest_rank_min:String(p95),
    route_A_count:String(cA),route_B_count:String(cB),route_C_count:String(cC),max_30s_batch_dominant_route_share:String(maxshare),closed_link_entries:String(closedEntries),fifo_violations:String(viol),
    checks_pass:String(viol===0&&closedEntries===0),vehicles:String(n),departure_spacing_s:String(sc.spacing_s),capacity_scale_E4_E10_only:String(scale),live:true};
  return {metrics:m,vehicles:vehicles,batches:as.batches};
}
root.DM_ENGINE={compute:compute};
if(typeof module!=='undefined')module.exports=root.DM_ENGINE;
})(typeof window!=='undefined'?window:globalThis);
