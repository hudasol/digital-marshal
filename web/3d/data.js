/* Digital Marshal 3D data tab: the full set of tables and charts from the 2D viewer, rebuilt from the same
   run data. Nothing is invented here; every value comes from the runs passed in. */
(function (root) {
'use strict';
var POL = ['static', 'independent_periodic', 'coordinated_batch'];
var COL = { static: '#64748B', independent_periodic: '#FFB715', coordinated_batch: '#DA291C' };
// SUMO figures: historical aggregates from docs/CROSS_MODEL_RECONCILIATION.md
var XM = [['manageable_primary', '0.00', '0.03', '[0.0, 0.095]', '1 of 10'], ['near_branch_capacity', '1.70', '0.53', '[0.125, 0.903]', '16 of 20'], ['overload_stress', '2.55', '1.18', '[0.018, 2.43]', '7 of 10']];
var TX = {
en: {
  title: 'Data', sub: 'Every table and chart from the model output for the selected scenario',
  perf: 'Corridor Performance Summary', cum: 'Cumulative Throughput at Destination', cumS: 'Vehicles that completed the corridor by each moment',
  strip: 'Journey Time per Vehicle', stripS: 'One marker per vehicle; the coloured tick marks the mean (minutes)',
  heat: 'Corridor Capacity Congestion Map', heatS: 'Total point queue waiting time per segment, vehicle minutes',
  bars: 'Fleet Delay and Corridor Allocation', barsS: 'Total fleet travel time and share of vehicles per corridor',
  log: 'Incident Response Epoch Log', logS: 'Routing decision at each 30 second epoch',
  xm: 'Model Cross Verification', xmS: 'Coordinated gain over independent periodic routing, percent (point queue vs SUMO)',
  veh: 'Vehicle Records', vehS: 'Route and journey time of every vehicle under each policy',
  pol: { static: 'Static Routing (Corridor A)', independent_periodic: 'Independent Periodic Routing', coordinated_batch: 'Dynamic Coordinated Routing' },
  sh: { static: 'Static', independent_periodic: 'Independent', coordinated_batch: 'Dynamic' },
  rows: ['Total fleet travel time (veh min)', 'Mean journey time (min)', 'P95 journey time (min)', 'Corridor allocation A / B', 'Max epoch batch share', 'Closed link entries', 'Queue audit violations', 'Queue wait total (veh min)'],
  hlTotal: 'Coordinated total fleet time (veh min)', hlInd: 'Change vs independent periodic', hlStat: 'Change vs static Route A',
  hlIdle: 'Collective idling time under the stress test (60 vehicles): coordinated batch routing cuts it by {s}% against static routing and {i}% against independent periodic routing, saving {n} vehicle minutes of idling.',
  vm: 'veh min', epoch: 'Epoch', time: 'Time (s)', batch: 'Batch', ind: 'Independent A / B', coo: 'Dynamic A / B', vid: 'Vehicle', depart: 'Depart (s)', jt: 'min', route: 'Route',
  xmPQ: 'Point queue', xmSumo: 'SUMO mean', xmCI: '95% CI', xmSeeds: 'Seeds better',
  n1: 'Both models rank coordinated at or below independent, and both below static, in the loaded scenarios.',
  n2: 'Gains over independent periodic routing are modest (0.5 to 2.6 percent across both engines), while gains over static routing reach 24 percent under overload in the point queue engine.',
  n3: 'Policy definitions differ between the two engines, so the columns serve as independent cross checks rather than a replication.',
  inc: 'Incident', pre: 'pre', sec: 's'
},
ar: {
  title: 'البيانات', sub: 'كل جدول ورسم من مخرجات النموذج للسيناريو المختار',
  perf: 'ملخص أداء الممر', cum: 'الإنتاجية التراكمية عند الوجهة', cumS: 'المركبات التي أتمت الممر في كل لحظة',
  strip: 'زمن رحلة كل مركبة', stripS: 'علامة لكل مركبة؛ الخط الملون يمثل المتوسط (بالدقائق)',
  heat: 'خريطة ازدحام السعة التشغيلية للممر', heatS: 'إجمالي زمن الانتظار في الطابور النقطي لكل مقطع، بالمركبة دقيقة',
  bars: 'تأخر الأسطول وتخصيص الممرات', barsS: 'إجمالي زمن رحلات الأسطول ونسبة المركبات لكل ممر',
  log: 'سجل دورات الاستجابة للحادث', logS: 'قرار التوجيه في كل دورة مدتها 30 ثانية',
  xm: 'التحقق المتقاطع بين النماذج', xmS: 'مكسب المنسق على المستقل الدوري بالنسبة المئوية (الطوابير النقطية مقابل SUMO)',
  veh: 'سجلات المركبات', vehS: 'مسار كل مركبة وزمن رحلتها تحت كل سياسة',
  pol: { static: 'التوجيه الثابت (الممر أ)', independent_periodic: 'التوجيه المستقل الدوري', coordinated_batch: 'التوجيه الديناميكي المنسق' },
  sh: { static: 'ثابت', independent_periodic: 'مستقل', coordinated_batch: 'ديناميكي' },
  rows: ['إجمالي زمن رحلات الأسطول (مركبة دقيقة)', 'متوسط زمن الرحلة (دقيقة)', 'زمن الرحلة P95 (دقيقة)', 'تخصيص الممرات أ / ب', 'أعلى حصة دفعة في الدورة', 'دخول الروابط المغلقة', 'مخالفات تدقيق الطابور', 'إجمالي انتظار الطابور (مركبة دقيقة)'],
  hlTotal: 'إجمالي زمن الأسطول المنسق (مركبة دقيقة)', hlInd: 'التغير مقارنة بالمستقل الدوري', hlStat: 'التغير مقارنة بالمسار الثابت أ',
  hlIdle: 'زمن التوقف الجماعي في اختبار الضغط (60 مركبة): يخفضه التوجيه الدفعي المنسق بنسبة {s}% مقارنة بالتوجيه الثابت و{i}% مقارنة بالمستقل الدوري، بتوفير {n} مركبة دقيقة من التوقف.',
  vm: 'مركبة دقيقة', epoch: 'الدورة', time: 'الزمن (ث)', batch: 'الدفعة', ind: 'المستقل أ / ب', coo: 'الديناميكي أ / ب', vid: 'المركبة', depart: 'المغادرة (ث)', jt: 'دقيقة', route: 'المسار',
  xmPQ: 'الطوابير النقطية', xmSumo: 'متوسط SUMO', xmCI: 'فترة ثقة 95%', xmSeeds: 'البذور الأفضل',
  n1: 'يضع النموذجان المنسق عند مستوى المستقل أو أفضل منه، وكلاهما أفضل من الثابت، في السيناريوهات المحملة.',
  n2: 'مكاسب التوجيه المنسق على المستقل الدوري متواضعة (من 0.5 إلى 2.6 بالمئة في المحركين)، وتبلغ على التوجيه الثابت نحو 24 بالمئة تحت الحمل الزائد في محرك الطوابير النقطية.',
  n3: 'تختلف تعريفات السياسات بين المحركين، لذلك تعمل الأعمدة كفحوص متقاطعة مستقلة وليست تكراراً.',
  inc: 'الحادث', pre: 'قبل', sec: 'ث'
}};
function f2(x) { return (Math.round(parseFloat(x) * 100) / 100).toFixed(2); }
function f1(x) { return (Math.round(x * 10) / 10).toFixed(1); }
function txt(x, y, s, o) { o = o || {}; return '<text x="' + x + '" y="' + y + '" font-size="' + (o.s || 10) + '" fill="' + (o.f || '#64748B') + '" text-anchor="' + (o.a || 'middle') + '" font-weight="' + (o.w || 500) + '">' + s + '</text>'; }
function vl(run) { return Object.keys(run.vehicles).sort().map(function (k) { var v = run.vehicles[k]; v.id = k; return v; }); }
function waitSum(run) { var w = 0; Object.keys(run.vehicles).forEach(function (k) { run.vehicles[k].ev.forEach(function (e) { w += e[3]; }); }); return w / 60; }

function render(host, c) {
  var L = TX[c.lang], runs = c.runs, M = {}, tot = {}, h = '';
  POL.forEach(function (p) { M[p] = runs[p].metrics; tot[p] = parseFloat(M[p].total_fleet_travel_time_vehicle_min); });
  var sc = c.D.scenarios[c.scn];
  function pct(a, b) { return (a - b) / b * 100; }
  function lab(x) { return (x < 0 ? '' : '+') + x.toFixed(2) + '%'; }
  var idle = {}; POL.forEach(function (p) { idle[p] = waitSum(c.D.runs['overload_stress|' + p]); });
  var sv = (1 - idle.coordinated_batch / idle.static) * 100, iv = (1 - idle.coordinated_batch / idle.independent_periodic) * 100;

  // headline tiles and summary table
  h += '<section class="dc wide"><h3>' + L.perf + '</h3><div class="dsub">' + c.scnName + ' · ' + sc.vehicles + ' / ' + sc.spacing_s + ' s · ' + c.incLabel + '</div>';
  h += '<div class="hl"><div><b>' + tot.coordinated_batch.toFixed(1) + '</b><span>' + L.hlTotal + '</span></div><div><b>' + lab(pct(tot.coordinated_batch, tot.independent_periodic)) + '</b><span>' + L.hlInd + '</span></div><div><b>' + lab(pct(tot.coordinated_batch, tot.static)) + '</b><span>' + L.hlStat + '</span></div>' +
    '<div class="idle"><b>-' + sv.toFixed(1) + '%</b><span>' + L.hlIdle.replace('{s}', sv.toFixed(1)).replace('{i}', iv.toFixed(1)).replace('{n}', Math.round(idle.static - idle.coordinated_batch)) + '</span></div></div>';
  var vals = [function (p) { return f2(M[p].total_fleet_travel_time_vehicle_min); }, function (p) { return f2(M[p].mean_travel_time_min); }, function (p) { return f2(M[p].p95_nearest_rank_min); },
    function (p) { return M[p].route_A_count + ' / ' + M[p].route_B_count + (+M[p].route_C_count > 0 ? ' (+' + M[p].route_C_count + ' ' + L.pre + ')' : ''); }, function (p) { return f2(M[p].max_30s_batch_dominant_route_share); },
    function (p) { return M[p].closed_link_entries; }, function (p) { return M[p].fifo_violations; }, function (p) { return f1(waitSum(runs[p])); }];
  var num = ['total_fleet_travel_time_vehicle_min', 'mean_travel_time_min', 'p95_nearest_rank_min'];
  h += '<div class="tw"><table><tr><th></th>' + POL.map(function (p) { return '<th>' + L.pol[p] + '</th>'; }).join('') + '</tr>';
  vals.forEach(function (fn, r) {
    var best = null, v3 = POL.map(function (p) { return r < 3 ? parseFloat(M[p][num[r]]) : 0; });
    if (r < 3) best = Math.min.apply(null, v3);
    h += '<tr><td>' + L.rows[r] + '</td>' + POL.map(function (p, i) { var b = r < 3 && Math.abs(v3[i] - best) < 1e-9 && (v3[0] !== v3[1] || v3[1] !== v3[2]); return '<td class="' + (b ? 'best' : '') + '">' + fn(p) + '</td>'; }).join('') + '</tr>';
  });
  h += '</table></div></section>';

  // cumulative throughput
  var n = vl(runs.static).length, tM = c.tMax, W0 = 36, W1 = 510, H = 230, top = 10, bot = 28;
  function xc(t) { return W0 + t / tM * (W1 - W0); }
  function yc(v) { return top + (1 - v / n) * (H - top - bot); }
  var s = '<svg viewBox="0 0 545 ' + H + '" role="img">';
  for (var g = 0; g <= 4; g++) { var v = n * g / 4, yy = yc(v); s += '<line x1="36" x2="510" y1="' + yy + '" y2="' + yy + '" stroke="#E2E8F0"/>' + txt(30, yy + 4, Math.round(v), { a: 'end' }); }
  for (var g2 = 0; g2 <= 5; g2++) { var tt = tM * g2 / 5; s += txt(xc(tt), H - 10, Math.round(tt) + L.sec); }
  POL.forEach(function (p) {
    var a = vl(runs[p]).map(function (v) { return v.a; }).sort(function (x, y) { return x - y; }), pts = '36,' + yc(0);
    a.forEach(function (t, i) { pts += ' ' + xc(t).toFixed(1) + ',' + yc(i).toFixed(1) + ' ' + xc(t).toFixed(1) + ',' + yc(i + 1).toFixed(1); });
    pts += ' 510,' + yc(n); s += '<polyline points="' + pts + '" fill="none" stroke="' + COL[p] + '" stroke-width="' + (p === 'coordinated_batch' ? 3 : 2.2) + '" stroke-linejoin="round"/>';
  });
  s += '<line x1="' + xc(c.inc) + '" x2="' + xc(c.inc) + '" y1="' + top + '" y2="' + (H - bot) + '" stroke="#FFB715" stroke-width="2.5"/></svg>';
  h += '<section class="dc"><h3>' + L.cum + '</h3><div class="dsub">' + L.cumS + '</div>' + s + '</section>';

  // journey strip
  var all = []; POL.forEach(function (p) { vl(runs[p]).forEach(function (v) { all.push((v.a - v.d) / 60); }); });
  var lo = Math.floor(Math.min.apply(null, all)), hi = Math.ceil(Math.max.apply(null, all)); if (hi - lo < 2) hi = lo + 2;
  function xs(m) { return 150 + (m - lo) / (hi - lo) * 330; }
  var step = Math.max(1, Math.round((hi - lo) / 6)); s = '<svg viewBox="0 0 520 230" role="img">';
  for (var m = lo; m <= hi; m += step) s += '<line x1="' + xs(m) + '" x2="' + xs(m) + '" y1="12" y2="190" stroke="#E2E8F0"/>' + txt(xs(m), 210, m + ' ' + L.jt);
  POL.forEach(function (p, i) {
    var y0 = 52 + i * 62, vs = vl(runs[p]), mean = 0; s += txt(8, y0 + 4, L.sh[p], { a: 'start', w: 600 }) + '<line x1="150" x2="480" y1="' + y0 + '" y2="' + y0 + '" stroke="#CBD5E1"/>';
    vs.forEach(function (v) { mean += (v.a - v.d) / 60; }); mean /= vs.length; var bins = {};
    vs.slice().sort(function (a, b) { return (a.a - a.d) - (b.a - b.d); }).forEach(function (v) { var mm = (v.a - v.d) / 60, k = Math.round(mm * 4); bins[k] = (bins[k] || 0) + 1; s += '<circle cx="' + xs(mm) + '" cy="' + (y0 - 4 - (bins[k] - 1) * 8) + '" r="3.6" fill="' + (v.r === 'B' ? '#94A3B8' : '#242526') + '" stroke="' + (v.r === 'B' ? '#242526' : '#fff') + '" stroke-width=".8"/>'; });
    s += '<line x1="' + xs(mean) + '" x2="' + xs(mean) + '" y1="' + (y0 - 30) + '" y2="' + (y0 + 8) + '" stroke="' + COL[p] + '" stroke-width="3"/>' + txt(xs(mean), y0 + 20, mean.toFixed(1), { w: 700 });
  });
  h += '<section class="dc"><h3>' + L.strip + '</h3><div class="dsub">' + L.stripS + '</div>' + s + '</svg></section>';

  // congestion heat grid
  var eds = c.D.graph.edges.map(function (e) { return e.id; }), grid = {}, mx = 0, LANES = c.lanes;
  POL.forEach(function (p) { grid[p] = {}; eds.forEach(function (e) { grid[p][e] = 0; }); vl(runs[p]).forEach(function (v) { v.ev.forEach(function (e) { grid[p][e[0]] += e[3]; }); }); eds.forEach(function (e) { grid[p][e] /= 60; if (grid[p][e] > mx) mx = grid[p][e]; }); });
  var cw = 118, rh = 22; s = '<svg viewBox="0 0 520 300" role="img">';
  POL.forEach(function (p, j) { s += txt(70 + j * cw + cw / 2, 14, L.sh[p], { w: 600 }); });
  eds.forEach(function (e, i) {
    s += txt(60, 40 + i * rh + 4, e + ' (' + (LANES[e] || 1) + ')', { a: 'end', w: 600 });
    POL.forEach(function (p, j) { var val = grid[p][e], k = mx ? val / mx : 0, col = val < 0.005 ? '#F8FAFC' : (k > 0.55 ? '#DA291C' : (k > 0.2 ? '#F08A82' : '#FFD98A'));
      s += '<rect x="' + (70 + j * cw + 2) + '" y="' + (26 + i * rh) + '" width="' + (cw - 4) + '" height="' + (rh - 3) + '" fill="' + col + '" stroke="#E2E8F0"/>' + txt(70 + j * cw + cw / 2, 26 + i * rh + 14, val.toFixed(1), { w: 600, f: k > 0.55 ? '#fff' : '#1B1D21' }); });
  });
  s += txt(70, 292, '0', { a: 'start' }) + txt(455, 292, mx.toFixed(1) + ' ' + L.vm, { a: 'end' });
  [['#F8FAFC'], ['#FFD98A'], ['#F08A82'], ['#DA291C']].forEach(function (l, i) { s += '<rect x="' + (90 + i * 30) + '" y="282" width="28" height="8" fill="' + l[0] + '" stroke="#E2E8F0"/>'; });
  h += '<section class="dc"><h3>' + L.heat + '</h3><div class="dsub">' + L.heatS + '</div>' + s + '</svg></section>';

  // bars
  var tm = Math.max(tot.static, tot.independent_periodic, tot.coordinated_batch); s = '<svg viewBox="0 0 520 290" role="img">';
  POL.forEach(function (p, i) {
    var y0 = 20 + i * 52, w = tot[p] / tm * 250, A = +M[p].route_A_count, B = +M[p].route_B_count, N = +M[p].vehicles, Cc = N - A - B, sw = 250;
    s += txt(8, y0 + 16, L.sh[p], { a: 'start', w: 600 }) + '<rect x="150" y="' + y0 + '" width="250" height="22" fill="#F1F5F9"/><rect x="150" y="' + y0 + '" width="' + w + '" height="22" fill="' + COL[p] + '"/>' + txt(150 + w + 6, y0 + 15, tot[p].toFixed(1) + ' ' + L.vm, { a: 'start', w: 700, f: '#1B1D21' });
    s += '<rect x="150" y="' + (y0 + 26) + '" width="' + sw * A / N + '" height="10" fill="#242526"/><rect x="' + (150 + sw * A / N) + '" y="' + (y0 + 26) + '" width="' + sw * B / N + '" height="10" fill="#94A3B8"/>';
    if (Cc > 0) s += '<rect x="' + (150 + sw * (A + B) / N) + '" y="' + (y0 + 26) + '" width="' + sw * Cc / N + '" height="10" fill="#CBD5E1"/>';
    s += txt(150 + sw + 6, y0 + 35, 'A ' + A + ' · B ' + B + (Cc > 0 ? ' · ' + Cc : ''), { a: 'start' });
  });
  s += '<rect x="8" y="190" width="504" height="96" fill="#FFFBEF" stroke="#FFB715"/>' + txt(20, 214, L.hlInd + ': ' + lab(pct(tot.coordinated_batch, tot.independent_periodic)), { a: 'start', w: 700, s: 13, f: '#1B1D21' }) + txt(20, 238, L.hlStat + ': ' + lab(pct(tot.coordinated_batch, tot.static)), { a: 'start', w: 700, s: 13, f: '#1B1D21' }) + txt(20, 266, c.scnName, { a: 'start' });
  h += '<section class="dc"><h3>' + L.bars + '</h3><div class="dsub">' + L.barsS + '</div>' + s + '</svg></section>';

  // epoch log
  var bi = runs.independent_periodic.batches, bc = runs.coordinated_batch.batches;
  h += '<section class="dc"><h3>' + L.log + '</h3><div class="dsub">' + L.logS + '</div><div class="tw scr"><table><tr><th>' + L.epoch + '</th><th>' + L.time + '</th><th>' + L.batch + '</th><th>' + L.ind + '</th><th>' + L.coo + '</th></tr>';
  bi.forEach(function (b, i) { var q = bc[i]; if (!q) return; h += '<tr><td>' + (i + 1) + '</td><td>' + Math.round(b[0]) + '</td><td>' + b[1] + '</td><td>' + b[2] + ' / ' + b[3] + '</td><td>' + q[2] + ' / ' + q[3] + '</td></tr>'; });
  h += '</table></div></section>';

  // cross model
  h += '<section class="dc"><h3>' + L.xm + '</h3><div class="dsub">' + L.xmS + '</div><div class="tw"><table><tr><th></th><th>' + L.xmPQ + '</th><th>' + L.xmSumo + '</th><th>' + L.xmCI + '</th><th>' + L.xmSeeds + '</th></tr>';
  XM.forEach(function (r) { h += '<tr><td>' + c.scNames[r[0]].split(' (')[0] + '</td><td>' + r[1] + '</td><td>' + r[2] + '</td><td>' + r[3] + '</td><td>' + r[4] + '</td></tr>'; });
  h += '</table></div><ul class="dn"><li>' + L.n1 + '</li><li>' + L.n2 + '</li><li>' + L.n3 + '</li></ul></section>';

  // vehicle records
  var ids = Object.keys(runs.static.vehicles).sort();
  h += '<section class="dc wide"><h3>' + L.veh + '</h3><div class="dsub">' + L.vehS + '</div><div class="tw scr"><table><tr><th>' + L.vid + '</th><th>' + L.depart + '</th>' + POL.map(function (p) { return '<th>' + L.sh[p] + ' · ' + L.route + '</th><th>' + L.sh[p] + ' · ' + L.jt + '</th>'; }).join('') + '</tr>';
  ids.forEach(function (id) {
    h += '<tr><td>' + id + '</td><td>' + Math.round(runs.static.vehicles[id].d) + '</td>' + POL.map(function (p) { var v = runs[p].vehicles[id]; return '<td>' + v.r + '</td><td>' + f2((v.a - v.d) / 60) + '</td>'; }).join('') + '</tr>';
  });
  h += '</table></div></section>';

  host.innerHTML = '<div class="dhead"><h2>' + L.title + '</h2><div class="dsub">' + L.sub + '</div></div><div class="dgrid">' + h + '</div>';
}
root.DM3D_DATA = { render: render };
})(window);
