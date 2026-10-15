/* Digital Marshal 3D viewer: interface, camera, guided tour and results.
   Every figure shown is read from window.DM_DATA (frozen model output) or recomputed by window.DM_ENGINE
   for a live incident time. The tour captions are generated from those same numbers. */
(function () {
'use strict';
var D = window.DM_DATA, ENG = window.DM_ENGINE, S = window.DM3D, THREE = window.THREE, POL = S.POL;
function $(s, r) { return (r || document).querySelector(s); }
var BASE = D.graph.incident_s, EDGE = {}; D.graph.edges.forEach(function (e) { EDGE[e.id] = e; });
var POLCOL = { static: '#64748B', independent_periodic: '#FFB715', coordinated_batch: '#DA291C' };
var SCN = ['manageable_primary', 'near_branch_capacity', 'overload_stress', 'primary_half_capacity', 'primary_double_capacity'];
var LANG = 'en';

/* ---------- text ---------- */
var I18N = {
en: {
  title: 'Digital Marshal 3D', subtitle: 'Corridor incident response replayed from the frozen point queue model',
  chip1: 'Synthetic network', chip2: 'Exploratory results', chip3: 'Simulation proposal for the hackathon', resBtn: 'Results', dataBtn: 'Data', dataClose: '3D view', skip: 'Skip to controls',
  stageA: '3D corridor view. Arrow keys orbit, plus and minus zoom, shift with arrow keys pans, Home resets the view.', dockA: 'Simulation controls', camsA: 'Camera views', spdA: 'Playback speed', speedA: 'Speed {s} times', scrubA: 'Simulation time', incA: 'Incident time in seconds', close: 'Close caption', dataA: 'Data tables and charts', timeA: '{t} of {m} seconds', view2d: '2D view',
  resT: 'Corridor Performance Summary', resNote: 'Fleet time is the sum of every vehicle journey. Queue wait is time spent held at the head of a segment. Both come straight from the model output.',
  chartT: 'Vehicles waiting over time', scn: 'Scenario', play: 'Play', pause: 'Pause', restart: 'Restart', incT: 'Incident time', injNow: 'Inject incident now', injReset: 'Baseline',
  labels: 'Labels', tour: 'Guided tour', tourOff: 'Exit tour',
  cams: { overview: 'Overview', static: 'Static', independent_periodic: 'Independent', coordinated_batch: 'Coordinated' },
  pol: { static: 'Static Routing', independent_periodic: 'Independent Periodic Routing', coordinated_batch: 'Dynamic Coordinated Routing' },
  polD: { static: 'All vehicles on Route A, no advisory', independent_periodic: 'Each 30 s batch copies one probe decision', coordinated_batch: 'Joint split searched for every 30 s batch' },
  hud: ['Queued', 'Done', 'Route A', 'Route B', 'Wait vm'],
  total: 'Fleet travel time', unit: 'vehicle min', mean: 'Mean journey', p95: 'P95 journey', split: 'Allocation A / B', qwait: 'Queue wait', closed: 'Closed link entries', audit: 'Queue audit violations',
  vsStat: 'vs static', vsInd: 'vs independent', min: 'min', vm: 'vehicle min', second: 's',
  ft1: 'SYNTHETIC NETWORK', ft2: 'Exploratory results, no confirmatory experiment run, provisional 5 percent target not met. Simulation proposal for the hackathon; the RTA logo is shown for context only. Every number comes from the frozen model output.',
  iEye: 'One corridor · one incident · three routing policies', iH: 'A closure at 120 seconds. <em>Three ways to respond.</em>',
  iP: 'The same autonomous fleet, the same network and the same incident. Only the routing logic differs. Watch where the queues form.',
  kpT: 'Fleet travel time, {s}', goTour: 'Watch the three policies', goFree: 'Explore freely',
  iNote: 'About two minutes. Drag to orbit, scroll to zoom, click a vehicle to follow it.', iNote2: 'A simulation of an abstract network, not a live traffic test.',
  sc: { manageable_primary: 'Manageable primary (10 vehicles)', near_branch_capacity: 'Near branch capacity (24 vehicles)', overload_stress: 'Overload stress (60 vehicles)', primary_half_capacity: 'Half capacity (10 vehicles)', primary_double_capacity: 'Double capacity (10 vehicles)' },
  route: { A: 'Route A', B: 'Route B', critical: 'Critical route' },
  tipQ: 'queued at the head of {e}', tipR: 'driving on {e}', tipW: 'queue wait so far',
  step: 'STEP {i} / {n}',
  dLow: '{p}% lower than static', dHigh: '{p}% higher than static', dSame: 'the same as static',
  cap: [
    'c0: {n} autonomous vehicles enter at O, one every {sp} seconds. All three corridors receive identical demand.',
    'c1: Every vehicle first drives E1 to the split point P, where its route is locked.',
    'c2: Incident at {inc} seconds. Segments E2 and E3 close. Every vehicle that reaches P later must take Route A or Route B.',
    'c3: The Marshal advisory goes out from P (a simulated broadcast). The static policy has no advisory and keeps sending everyone to Route A.',
    'c4: A batch is decided every 30 seconds. Independent routing copies one probe decision for the whole batch. Coordinated routing searches every joint split.',
    'c5: Static peak at {t} seconds: {q} vehicles are held at P waiting for the single lane Route A.',
    'c6: Coordinated batch at {t} seconds sends {a} vehicles to Route A and {b} to Route B, using spare capacity on the wider branch.',
    'c7: Corridor clearance times: coordinated {fc} seconds, independent {fi} seconds, static {fs} seconds.',
    'c8: All vehicles are through. Fleet travel time: static {s}, independent {i}, coordinated {c} vehicle minutes ({d}).'
  ]
},
ar: {
  title: 'المارشال الرقمي ثلاثي الأبعاد', subtitle: 'الاستجابة لحادث الممر، إعادة تشغيل من نموذج الطوابير النقطية المجمد',
  chip1: 'شبكة اصطناعية', chip2: 'نتائج استكشافية', chip3: 'مقترح محاكاة للهاكاثون', resBtn: 'النتائج', dataBtn: 'البيانات', dataClose: 'العرض ثلاثي الأبعاد', skip: 'انتقل إلى عناصر التحكم',
  stageA: 'العرض ثلاثي الأبعاد للممر. مفاتيح الأسهم للدوران، زائد وناقص للتكبير، وShift مع الأسهم للتحريك، وHome لإعادة العرض.', dockA: 'عناصر التحكم في المحاكاة', camsA: 'زوايا الكاميرا', spdA: 'سرعة التشغيل', speedA: 'السرعة {s} أضعاف', scrubA: 'زمن المحاكاة', incA: 'وقت الحادث بالثواني', close: 'إغلاق التعليق', dataA: 'جداول ورسوم البيانات', timeA: '{t} من {m} ثانية', view2d: 'العرض الثنائي',
  resT: 'ملخص أداء الممر', resNote: 'زمن الأسطول هو مجموع زمن رحلات كل المركبات. انتظار الطابور هو الزمن المحتجز عند مقدمة المقطع. كلاهما مأخوذ مباشرة من مخرجات النموذج.',
  chartT: 'المركبات المنتظرة عبر الزمن', scn: 'السيناريو', play: 'تشغيل', pause: 'إيقاف مؤقت', restart: 'إعادة', incT: 'وقت الحادث', injNow: 'حقن حادث الآن', injReset: 'الأساس',
  labels: 'التسميات', tour: 'جولة موجهة', tourOff: 'إنهاء الجولة',
  cams: { overview: 'نظرة عامة', static: 'الثابت', independent_periodic: 'المستقل', coordinated_batch: 'المنسق' },
  pol: { static: 'التوجيه الثابت', independent_periodic: 'التوجيه المستقل الدوري', coordinated_batch: 'التوجيه الديناميكي المنسق' },
  polD: { static: 'كل المركبات على المسار أ دون نشرة', independent_periodic: 'كل دفعة كل 30 ثانية تنسخ قرار مركبة استكشافية', coordinated_batch: 'يُبحث تقسيم مشترك لكل دفعة كل 30 ثانية' },
  hud: ['في الطابور', 'أتمت', 'المسار أ', 'المسار ب', 'انتظار'],
  total: 'زمن رحلات الأسطول', unit: 'مركبة دقيقة', mean: 'متوسط الرحلة', p95: 'الرحلة P95', split: 'التخصيص أ / ب', qwait: 'انتظار الطابور', closed: 'دخول الروابط المغلقة', audit: 'مخالفات تدقيق الطابور',
  vsStat: 'مقارنة بالثابت', vsInd: 'مقارنة بالمستقل', min: 'دقيقة', vm: 'مركبة دقيقة', second: 'ث',
  ft1: 'شبكة اصطناعية', ft2: 'نتائج استكشافية ولم يُجرَ تجربة تأكيدية والهدف المبدئي 5 بالمئة لم يتحقق. مقترح محاكاة للهاكاثون، وشعار الهيئة معروض للسياق فقط. كل رقم مأخوذ من مخرجات النموذج المجمدة.',
  iEye: 'ممر واحد · حادث واحد · ثلاث سياسات توجيه', iH: 'إغلاق عند 120 ثانية. <em>ثلاث طرق للاستجابة.</em>',
  iP: 'الأسطول ذاتي القيادة نفسه والشبكة نفسها والحادث نفسه. يختلف منطق التوجيه فقط. راقب أين تتشكل الطوابير.',
  kpT: 'زمن رحلات الأسطول، {s}', goTour: 'شاهد السياسات الثلاث', goFree: 'استكشف بحرية',
  iNote: 'نحو دقيقتين. اسحب للدوران ومرر للتكبير وانقر على مركبة لمتابعتها.', iNote2: 'محاكاة لشبكة مجردة وليست اختباراً مباشراً لحركة المرور.',
  sc: { manageable_primary: 'أساسي قابل للإدارة (10 مركبات)', near_branch_capacity: 'قرب سعة الفرع (24 مركبة)', overload_stress: 'ضغط زائد (60 مركبة)', primary_half_capacity: 'نصف السعة (10 مركبات)', primary_double_capacity: 'ضعف السعة (10 مركبات)' },
  route: { A: 'المسار أ', B: 'المسار ب', critical: 'المسار الحرج' },
  tipQ: 'في الطابور عند مقدمة {e}', tipR: 'يسير على {e}', tipW: 'انتظار الطابور حتى الآن',
  step: 'الخطوة {i} / {n}',
  dLow: 'أقل بنسبة {p}% من الثابت', dHigh: 'أعلى بنسبة {p}% من الثابت', dSame: 'مثل الثابت',
  cap: [
    'c0: تدخل {n} مركبة ذاتية القيادة عند O، مركبة كل {sp} ثوانٍ. تتلقى الممرات الثلاثة الطلب نفسه.',
    'c1: تسلك كل مركبة المقطع E1 أولاً إلى نقطة التفرع P حيث يُثبَّت مسارها.',
    'c2: حادث عند {inc} ثانية. يُغلق المقطعان E2 وE3. كل مركبة تصل إلى P بعد ذلك يجب أن تسلك المسار أ أو المسار ب.',
    'c3: تصدر نشرة المارشال من P (بث محاكى). لا تملك السياسة الثابتة نشرة وتواصل إرسال الجميع إلى المسار أ.',
    'c4: تُحسم دفعة كل 30 ثانية. ينسخ التوجيه المستقل قرار مركبة استكشافية واحدة لكل الدفعة، بينما يبحث التوجيه المنسق في كل تقسيم مشترك.',
    'c5: ذروة السياسة الثابتة عند {t} ثانية: {q} مركبة محتجزة عند P بانتظار المسار أ أحادي المسار.',
    'c6: دفعة منسقة عند {t} ثانية ترسل {a} مركبات إلى المسار أ و{b} إلى المسار ب، مستفيدة من السعة الفائضة في الفرع الأوسع.',
    'c7: أزمنة إخلاء الممر: المنسق {fc} ثانية، المستقل {fi} ثانية، الثابت {fs} ثانية.',
    'c8: عبرت كل المركبات. زمن رحلات الأسطول: الثابت {s}، المستقل {i}، المنسق {c} مركبة دقيقة ({d}).'
  ]
}};
function T(k) { var v = I18N[LANG][k]; return v !== undefined ? v : k; }
function fmt(s, o) { return s.replace(/\{(\w+)\}/g, function (m, k) { return o && o[k] !== undefined ? o[k] : m; }); }
function n2(x) { return (Math.round(x * 100) / 100).toFixed(2); }
function n1(x) { return (Math.round(x * 10) / 10).toFixed(1); }

/* ---------- state ---------- */
var state = { scn: 'near_branch_capacity', t: 0, playing: false, speed: 20, inc: BASE, tMax: 600, tour: false, labels: true, resOpen: true, follow: null, beat: -1, userCam: false, capOpen: true };
var runs = {}, beats = [], series = null, world, lastNow = 0;

function runsFor(scn, inc) {
  var o = {}; POL.forEach(function (p) { o[p] = (inc === BASE || !ENG) ? D.runs[scn + '|' + p] : ENG.compute(D, scn, p, inc); }); return o;
}
function computeTMax() { var mx = 0; POL.forEach(function (p) { Object.keys(runs[p].vehicles).forEach(function (k) { if (runs[p].vehicles[k].a > mx) mx = runs[p].vehicles[k].a; }); }); state.tMax = Math.ceil((mx + 20) / 10) * 10; $('#scrub').max = state.tMax; }

/* ---------- derived numbers (all from the run data) ---------- */
function waitedSoFar(run, t) {
  var s = 0; Object.keys(run.vehicles).forEach(function (k) { run.vehicles[k].ev.forEach(function (e) { var ms = e[2] - EDGE[e[0]].free_min * 60; if (ms - e[1] > 1e-6 && t > e[1]) s += Math.min(t, ms) - e[1]; }); }); return s / 60;
}
function waitTotal(run) { var s = 0; Object.keys(run.vehicles).forEach(function (k) { run.vehicles[k].ev.forEach(function (e) { var ms = e[2] - EDGE[e[0]].free_min * 60; if (ms - e[1] > 1e-6) s += ms - e[1]; }); }); return s / 60; }
function queueAt(run, t) { var q = 0; Object.keys(run.vehicles).forEach(function (k) { run.vehicles[k].ev.forEach(function (e) { var ms = e[2] - EDGE[e[0]].free_min * 60; if (ms - e[1] > 1e-6 && t >= e[1] && t < ms) q++; }); }); return q; }
function buildSeries() { series = {}; POL.forEach(function (p) { var a = []; for (var t = 0; t <= state.tMax; t += 5) a.push(queueAt(runs[p], t)); series[p] = a; }); }
function tot(p) { return parseFloat(runs[p].metrics.total_fleet_travel_time_vehicle_min); }

/* ---------- camera ---------- */
var cam = { tx: 330, ty: 0, tz: 0, yaw: 0, pit: 0.5, dist: 900 }, want = { tx: 330, ty: 0, tz: 0, yaw: 0, pit: 0.5, dist: 900 };
var SHOT = {
  overview: { tx: 330, ty: 0, tz: 0, yaw: 0, pit: 0.5, dist: 900 },
  static: { tx: 190, ty: 0, tz: -165, yaw: -0.22, pit: 0.5, dist: 430 },
  independent_periodic: { tx: 190, ty: 0, tz: 0, yaw: -0.22, pit: 0.5, dist: 430 },
  coordinated_batch: { tx: 190, ty: 0, tz: 165, yaw: -0.22, pit: 0.5, dist: 430 }
};
function setShot(o) { for (var k in o) want[k] = o[k]; }
function stepCam(dt, now) {
  if (state.follow) {
    var r = state.follow;
    if (!r.g.visible) { state.follow = null; }
    else { want.tx = r.g.position.x; want.ty = 0; want.tz = r.g.position.z; }
  }
  if (!$('#intro').classList.contains('gone')) { want.yaw = REDUCE ? 0 : Math.sin(now * 0.12) * 0.28; want.pit = 0.5; want.dist = 900; want.tx = 330; want.tz = 0; }
  var k = 1 - Math.exp(-dt * 3.2);
  ['tx', 'ty', 'tz', 'yaw', 'pit', 'dist'].forEach(function (a) { cam[a] += (want[a] - cam[a]) * k; });
  var cp = Math.cos(cam.pit);
  var pos = new THREE.Vector3(cam.tx + cam.dist * cp * Math.sin(cam.yaw), cam.ty + cam.dist * Math.sin(cam.pit), cam.tz + cam.dist * cp * Math.cos(cam.yaw));
  return { pos: pos, tgt: new THREE.Vector3(cam.tx, cam.ty, cam.tz) };
}
function initPointer() {
  var el = $('#stage'), ptrs = {}, last = null, moved = 0, pinch = 0;
  el.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  el.addEventListener('pointerdown', function (e) { el.setPointerCapture(e.pointerId); ptrs[e.pointerId] = { x: e.clientX, y: e.clientY }; moved = 0; el.classList.add('drag'); pinch = 0; });
  el.addEventListener('pointermove', function (e) {
    var p = ptrs[e.pointerId];
    if (!p) { hover(e); return; }
    var dx = e.clientX - p.x, dy = e.clientY - p.y; moved += Math.abs(dx) + Math.abs(dy);
    var ids = Object.keys(ptrs);
    if (ids.length === 2) {
      var a = ptrs[ids[0]], b = ptrs[ids[1]], dist = Math.hypot(a.x - b.x, a.y - b.y); if (pinch) { want.dist = Math.max(25, Math.min(1800, want.dist * pinch / dist)); state.userCam = true; } pinch = dist;
      p.x = e.clientX; p.y = e.clientY; return;
    }
    p.x = e.clientX; p.y = e.clientY;
    if (e.buttons & 2 || e.shiftKey) {
      var s = want.dist * 0.0016, cy = Math.cos(want.yaw), sy = Math.sin(want.yaw);
      want.tx -= (dx * cy) * s; want.tz += (dx * sy) * s; want.tx -= (dy * sy) * s; want.tz -= (dy * cy) * s; state.follow = null;
    } else { want.yaw -= dx * 0.005; want.pit = Math.max(0.1, Math.min(1.45, want.pit + dy * 0.005)); }
    state.userCam = true; hideTip();
  });
  function up(e) {
    var had = ptrs[e.pointerId]; delete ptrs[e.pointerId]; pinch = 0; el.classList.remove('drag');
    if (had && moved < 6 && e.type === 'pointerup') clickPick(e);
  }
  el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
  el.addEventListener('wheel', function (e) { e.preventDefault(); want.dist = Math.max(25, Math.min(1800, want.dist * Math.exp(e.deltaY * 0.0011))); state.userCam = true; }, { passive: false });
}
function ndc(e) { var r = $('#stage').getBoundingClientRect(); return [((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1]; }
var lastHover = 0;
function hover(e) {
  var now = performance.now(); if (now - lastHover < 50) return; lastHover = now;
  var n = ndc(e), h = world.pick(n[0], n[1]);
  if (!h) { hideTip(); return; }
  var rec = h.rec, run = runs[h.pol], w = waitedSoFar({ vehicles: (function () { var o = {}; o[rec.id] = rec.d; return o; })() }, state.t);
  var st = rec.state === 'wait' ? fmt(T('tipQ'), { e: rec.edge }) : fmt(T('tipR'), { e: rec.edge || '' });
  var tip = $('#tip'); tip.style.borderInlineStartColor = POLCOL[h.pol];
  tip.innerHTML = '<b>' + rec.id + '</b> · ' + T('route')[rec.r] + '<br>' + T('pol')[h.pol] + '<br>' + st + '<br>' + T('tipW') + ': <b>' + n1(w * 60) + ' ' + T('second') + '</b>';
  tip.style.left = Math.min(window.innerWidth - 250, e.clientX + 14) + 'px'; tip.style.top = (e.clientY + 14) + 'px'; tip.style.opacity = 1;
}
function hideTip() { $('#tip').style.opacity = 0; }
function clickPick(e) {
  var n = ndc(e), h = world.pick(n[0], n[1]);
  if (h) { state.follow = h.rec; want.dist = 46; want.pit = 0.42; state.userCam = true; } else if (state.follow) { state.follow = null; }
}

/* ---------- guided tour ---------- */
function buildBeats() {
  var inc = state.inc, b = [], nveh = Object.keys(runs.static.vehicles).length, sc = D.scenarios[state.scn];
  var ep = null, cb = null, k;
  (runs.independent_periodic.batches || []).forEach(function (x) { if (!ep && x[0] >= inc && x[1] > 0) ep = x[0]; });
  (runs.coordinated_batch.batches || []).forEach(function (x) { if (!cb && x[0] >= inc && x[3] > 0) cb = x; });
  var sp = 0, pk = 0, pt = 0; for (k = 0; k < series.static.length; k++) if (series.static[k] > pk) { pk = series.static[k]; pt = k * 5; }
  function fin(p) { var m = 0; Object.keys(runs[p].vehicles).forEach(function (k) { if (runs[p].vehicles[k].a > m) m = runs[p].vehicles[k].a; }); return m; }
  var fs = fin('static'), fi = fin('independent_periodic'), fc = fin('coordinated_batch'), tEnd = Math.max(60, Math.min(state.tMax - 10, Math.max(fs, fi, fc) + 12));
  var s = tot('static'), i = tot('independent_periodic'), c = tot('coordinated_batch'), pc = (c - s) / s * 100, d;
  d = Math.abs(pc) < 0.05 ? T('dSame') : fmt(T(pc < 0 ? 'dLow' : 'dHigh'), { p: n1(Math.abs(pc)) });
  var cap = I18N[LANG].cap;
  function txt(i2, o) { return fmt(cap[i2].replace(/^c\d:\s*/, ''), o); }
  var P = { overview: SHOT.overview };
  b.push({ t: 0, i: 0, o: { n: nveh, sp: sc.spacing_s }, cam: SHOT.overview });
  if (inc >= 40) b.push({ t: Math.max(10, inc - 60), i: 1, o: {}, cam: { tx: 125, ty: 0, tz: 165, yaw: -0.32, pit: 0.42, dist: 230 } });
  b.push({ t: inc, i: 2, o: { inc: inc }, cam: { tx: 200, ty: 0, tz: 0, yaw: -0.4, pit: 0.62, dist: 600 } });
  b.push({ t: inc + 14, i: 3, o: {}, cam: { tx: 160, ty: 0, tz: 90, yaw: -0.18, pit: 0.5, dist: 420 } });
  b.push({ t: ep || inc + 60, i: 4, o: {}, cam: { tx: 220, ty: 0, tz: 80, yaw: 0.0, pit: 0.5, dist: 480 } });
  if (pk >= 3 && pt > inc + 20) b.push({ t: pt, i: 5, o: { t: Math.round(pt), q: pk }, cam: { tx: 55, ty: 0, tz: -165, yaw: -0.16, pit: 0.38, dist: 210 } });
  if (cb) b.push({ t: cb[0] + 10, i: 6, o: { t: Math.round(cb[0]), a: cb[2], b: cb[3] }, cam: { tx: 230, ty: 0, tz: 165, yaw: -0.08, pit: 0.5, dist: 330 } });
  if (tEnd - fc > 40) b.push({ t: fc + 5, i: 7, o: { fc: Math.round(fc), fi: Math.round(fi), fs: Math.round(fs) }, cam: { tx: 520, ty: 0, tz: 80, yaw: 0.05, pit: 0.52, dist: 560 } });
  b.push({ t: tEnd, i: 8, o: { s: n2(s), i: n2(i), c: n2(c), d: d }, cam: SHOT.overview });
  b.sort(function (x, y) { return x.t - y.t; });
  var out = []; b.forEach(function (x) { if (!out.length || x.t - out[out.length - 1].t >= 6 || x.i === 8) { if (out.length && x.i === 8 && x.t - out[out.length - 1].t < 6) out.pop(); out.push(x); } });
  out.forEach(function (x, n) { x.n = n; x.txt = function () { return txt(x.i, x.o); }; });
  return out;
}
function startTour() {
  state.tour = true; state.t = 0; state.beat = -1; state.userCam = false; state.follow = null; state.speed = Math.max(3, Math.min(25, Math.round(state.tMax / 110 * 10) / 10)); state.playing = true;
  state.capOpen = true; syncPlay(); syncSpeed(); $('#tourBtn').textContent = T('tourOff'); $('#tourBtn').classList.add('on'); $('#tourBtn').setAttribute('aria-pressed', 'true'); leaveIntro();
}
function stopTour() { $('#tourBtn').setAttribute('aria-pressed', 'false'); state.tour = false; $('#cap').classList.add('off'); $('#tourBtn').textContent = T('tour'); $('#tourBtn').classList.remove('on'); }
function tourFrame() {
  if (!state.tour) return;
  var idx = 0; for (var k = 0; k < beats.length; k++) if (state.t >= beats[k].t) idx = k;
  if (idx !== state.beat) {
    state.beat = idx; state.userCam = false; var bt = beats[idx];
    $('#capK').textContent = fmt(T('step'), { i: idx + 1, n: beats.length }); $('#capT').textContent = bt.txt();
    if (state.capOpen) $('#cap').classList.remove('off');
  }
  if (!state.userCam && !state.follow) setShot(beats[idx].cam);
}

/* ---------- summary, HUD, chart ---------- */
var huds = {};
function buildHud() {
  var host = $('#huds'); host.innerHTML = '';
  POL.forEach(function (p) {
    var d = document.createElement('div'); d.className = 'hud'; d.style.setProperty('--c', POLCOL[p]);
    d.innerHTML = '<h3></h3><div class="s"></div><div class="g"><div class="q"><b>0</b><span></span></div><div><b>0</b><span></span></div><div><b>0</b><span></span></div><div><b>0</b><span></span></div><div><b>0</b><span></span></div></div>';
    host.appendChild(d); var cells = d.querySelectorAll('.g > div'); huds[p] = { el: d, h: $('h3', d), s: $('.s', d), b: [], l: [], last: [] };
    for (var i = 0; i < 5; i++) { huds[p].b.push($('b', cells[i])); huds[p].l.push($('span', cells[i])); }
  });
}
function labelHud() { POL.forEach(function (p) { var h = huds[p]; h.el.setAttribute('role', 'group'); h.el.setAttribute('aria-label', T('pol')[p]); h.h.textContent = T('pol')[p]; h.s.textContent = T('polD')[p]; for (var i = 0; i < 5; i++) h.l[i].textContent = T('hud')[i]; h.last = []; }); }
function updateHud(counts) {
  POL.forEach(function (p) {
    var h = huds[p], c = counts[p], v = [c.inq, c.arr, c.A, c.B, n1(waitedSoFar(runs[p], state.t))];
    for (var i = 0; i < 5; i++) if (h.last[i] !== v[i]) { h.b[i].textContent = v[i]; h.last[i] = v[i]; }
  });
}
function renderResults() {
  var st = tot('static'), mx = Math.max(tot('static'), tot('independent_periodic'), tot('coordinated_batch')), host = $('#prs'); host.innerHTML = '';
  $('#resSub').textContent = I18N[LANG].sc[state.scn] + ' · ' + (state.inc === BASE ? T('incT') + ' ' + BASE + ' ' + T('second') : T('incT') + ' ' + state.inc + ' ' + T('second') + ' (live)');
  POL.forEach(function (p) {
    var m = runs[p].metrics, t = tot(p), dv = (t - st) / st * 100, di = (t - tot('independent_periodic')) / tot('independent_periodic') * 100, chips = '';
    function chip(v, k) { if (Math.abs(v) < 0.05) return '<span class="d">0.0% ' + T(k) + '</span>'; return '<span class="d ' + (v < 0 ? 'dn' : 'up') + '">' + (v < 0 ? '−' : '+') + n1(Math.abs(v)) + '% ' + T(k) + '</span>'; }
    if (p === 'independent_periodic') chips = chip(dv, 'vsStat'); else if (p === 'coordinated_batch') chips = chip(dv, 'vsStat') + ' ' + chip(di, 'vsInd');
    var d = document.createElement('div'); d.className = 'pr'; d.style.setProperty('--c', POLCOL[p]);
    d.innerHTML = '<div class="n"><i></i>' + T('pol')[p] + '</div><div class="big"><b>' + n2(t) + '</b><span>' + T('unit') + '</span></div>' + (chips ? '<div style="display:flex;gap:4px;flex-wrap:wrap">' + chips + '</div>' : '') +
      '<div class="bar"><i style="width:' + (t / mx * 100) + '%"></i></div>' +
      '<div class="m"><span>' + T('mean') + '</span><b>' + n2(parseFloat(m.mean_travel_time_min)) + ' ' + T('min') + '</b><span>' + T('p95') + '</span><b>' + n2(parseFloat(m.p95_nearest_rank_min)) + ' ' + T('min') + '</b><span>' + T('split') + '</span><b>' + m.route_A_count + ' / ' + m.route_B_count + '</b><span>' + T('qwait') + '</span><b>' + n1(waitTotal(runs[p])) + ' ' + T('vm') + '</b><span>' + T('closed') + '</span><b>' + m.closed_link_entries + '</b><span>' + T('audit') + '</span><b>' + m.fifo_violations + '</b></div>';
    host.appendChild(d);
  });
}
function drawChart() {
  var cv = $('#chart'), x = cv.getContext('2d'), W = cv.width, H = cv.height, pad = 22, mx = 1;
  x.clearRect(0, 0, W, H); if (!series) return;
  POL.forEach(function (p) { series[p].forEach(function (v) { if (v > mx) mx = v; }); });
  x.strokeStyle = '#E2E8F0'; x.lineWidth = 1; x.fillStyle = '#64748B'; x.font = '600 18px Montserrat, sans-serif';
  for (var g = 0; g <= 2; g++) { var yy = H - pad - (H - pad - 8) * g / 2; x.beginPath(); x.moveTo(pad + 14, yy); x.lineTo(W - 6, yy); x.stroke(); x.fillText(Math.round(mx * g / 2), 2, yy + 5); }
  var n = series.static.length;
  POL.forEach(function (p) { x.beginPath(); series[p].forEach(function (v, i) { var px = pad + 14 + (W - pad - 20) * i / (n - 1), py = H - pad - (H - pad - 8) * v / mx; if (i) x.lineTo(px, py); else x.moveTo(px, py); }); x.strokeStyle = POLCOL[p]; x.lineWidth = 4; x.stroke(); });
  var ix = pad + 14 + (W - pad - 20) * Math.min(1, state.t / state.tMax); x.strokeStyle = '#242526'; x.lineWidth = 2; x.beginPath(); x.moveTo(ix, 4); x.lineTo(ix, H - pad); x.stroke();
  var mxp = pad + 14 + (W - pad - 20) * Math.min(1, state.inc / state.tMax); x.strokeStyle = '#FFB715'; x.lineWidth = 3; x.beginPath(); x.moveTo(mxp, 4); x.lineTo(mxp, H - pad); x.stroke();
  x.fillStyle = '#64748B'; x.fillText('0', pad + 10, H - 4); x.fillText(state.tMax + ' ' + T('second'), W - 70, H - 4);
}
function renderIntro() {
  var rows = $('#kpRows'); rows.innerHTML = ''; var base = {}, mx = 0;
  POL.forEach(function (p) { base[p] = parseFloat(D.runs[state.scn + '|' + p].metrics.total_fleet_travel_time_vehicle_min); mx = Math.max(mx, base[p]); });
  $('#kpT').textContent = fmt(T('kpT'), { s: I18N[LANG].sc[state.scn] });
  POL.forEach(function (p) { var r = document.createElement('div'); r.className = 'kr'; r.style.setProperty('--c', POLCOL[p]); r.innerHTML = '<span class="n">' + T('pol')[p] + '</span><div class="bar"><i style="width:' + (base[p] / mx * 100) + '%"></i></div><span class="v">' + n2(base[p]) + ' ' + T('vm') + '</span>'; rows.appendChild(r); });
}

/* ---------- dock ---------- */
function syncPlay() { $('#play').textContent = state.playing ? T('pause') : T('play'); }
function syncSpeed() { var sp = $('#spd'); Array.prototype.forEach.call(sp.children, function (b) { var on = parseFloat(b.dataset.s) === state.speed; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); b.setAttribute('aria-label', fmt(T('speedA'), { s: b.dataset.s })); }); }
function buildDock() {
  var sel = $('#scn'); sel.innerHTML = ''; SCN.forEach(function (k) { var o = document.createElement('option'); o.value = k; sel.appendChild(o); });
  var sp = $('#spd'); sp.innerHTML = ''; [1, 5, 20, 60].forEach(function (s) { var b = document.createElement('button'); b.className = 'b'; b.dataset.s = s; b.textContent = s + '×'; b.onclick = function () { state.speed = s; syncSpeed(); }; sp.appendChild(b); });
  var cams = $('#cams'); cams.innerHTML = ''; ['overview'].concat(POL).forEach(function (k) { var b = document.createElement('button'); b.className = 'b'; b.dataset.k = k; b.onclick = function () { state.follow = null; setShot(SHOT[k]); state.userCam = true; }; cams.appendChild(b); });
}
function labelDock() {
  Array.prototype.forEach.call($('#scn').options, function (o) { o.textContent = I18N[LANG].sc[o.value]; }); $('#scn').value = state.scn;
  Array.prototype.forEach.call($('#cams').children, function (b) { b.textContent = T('cams')[b.dataset.k]; });
  $('#tourBtn').textContent = state.tour ? T('tourOff') : T('tour'); syncPlay(); syncSpeed();
}

/* ---------- language ---------- */
function applyLang() {
  document.documentElement.lang = LANG; document.documentElement.dir = LANG === 'ar' ? 'rtl' : 'ltr'; document.body.className = LANG === 'ar' ? 'ar' : '';
  Array.prototype.forEach.call(document.querySelectorAll('[data-i]'), function (n) { var k = n.getAttribute('data-i'), v = T(k); if (k === 'iH') n.innerHTML = v; else n.textContent = v; });
  Array.prototype.forEach.call(document.querySelectorAll('[data-ia]'), function (n) { n.setAttribute('aria-label', T(n.getAttribute('data-ia'))); });
  $('#langBtn').textContent = LANG === 'ar' ? 'English' : 'العربية'; $('#langBtn').setAttribute('lang', LANG === 'ar' ? 'en' : 'ar'); labelDock(); labelHud(); renderResults(); renderIntro(); drawChart();
  beats = buildBeats(); state.beat = -1; openData(!!state.dataOpen);
  if (state.tour) tourFrame();
}

/* ---------- data tab ---------- */
function renderData() {
  window.DM3D_DATA.render($('#data'), { lang: LANG, runs: runs, scn: state.scn, inc: state.inc, tMax: state.tMax, D: D, scnName: I18N[LANG].sc[state.scn], scNames: I18N[LANG].sc, lanes: S.LANES, incLabel: T('incT') + ' ' + state.inc + ' ' + T('second') });
}
function openData(on) { state.dataOpen = on; $('#data').hidden = !on; $('#dataBtn').textContent = on ? T('dataClose') : T('dataBtn'); $('#dataBtn').classList.toggle('on', on); $('#dataBtn').setAttribute('aria-pressed', on ? 'true' : 'false'); if (on) { hideTip(); renderData(); $('#data').focus({ preventScroll: true }); } else if (state.dataFocused) { $('#dataBtn').focus(); } state.dataFocused = on; }

/* ---------- apply scenario or incident ---------- */
function applyRuns(keepT) {
  runs = runsFor(state.scn, state.inc); world.setRuns(runs, state.inc); computeTMax(); if (!keepT) state.t = 0; if (state.t > state.tMax) state.t = state.tMax; state.follow = null;
  buildSeries(); renderResults(); renderIntro(); beats = buildBeats(); state.beat = -1; $('#incT').value = state.inc; $('#incV').textContent = state.inc + ' ' + T('second'); placeMark(); if (state.dataOpen) renderData();
}
function placeMark() { var m = $('#mk'); m.style.insetInlineStart = (state.inc / state.tMax * 100) + '%'; m.style.left = ''; if (LANG === 'en') m.style.left = 'calc(' + (state.inc / state.tMax * 100) + '% - 1px)'; }

/* ---------- loop ---------- */
function frame(ms) {
  var now = ms / 1000, dt = Math.min(0.1, now - lastNow); lastNow = now;
  var sp = state.speed;
  if (state.tour && state.beat >= 0) { var nb = beats[state.beat + 1], gap = (nb ? nb.t : state.tMax) - state.t; if (gap > 90 && state.t - beats[state.beat].t > 40) sp *= 3; if (beats[1] && state.t < beats[1].t) sp *= 2.6; }
  if (state.playing) { state.t = Math.min(state.tMax, state.t + dt * sp); if (state.t >= state.tMax) { state.playing = false; syncPlay(); } }
  tourFrame();
  var counts = world.update(state.t, state.inc, now), c = stepCam(dt, now);
  world.render(c.pos, c.tgt); updateHud(counts);
  ariaTime(now); $('#scrub').value = state.t; $('#clock').textContent = (LANG === 'ar' ? '' : 't ') + Math.round(state.t) + ' / ' + state.tMax + ' ' + T('second');
  drawChart();
  requestAnimationFrame(frame);
}

/* ---------- accessibility helpers ---------- */
var REDUCE = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
function leaveIntro() { var i = $('#intro'); if (i.classList.contains('gone')) return; i.classList.add('gone'); i.setAttribute('aria-hidden', 'true'); $('#stage').focus({ preventScroll: true }); }
function initA11y() {
  var dock = $('#dock'), sync = function () { document.documentElement.style.setProperty('--dockh', dock.offsetHeight + 'px'); };
  sync(); if (window.ResizeObserver) new ResizeObserver(sync).observe(dock); window.addEventListener('resize', sync);
  window.addEventListener('keydown', function (e) { if (e.key === 'Tab' || e.key.indexOf('Arrow') === 0) document.body.classList.add('kbd'); }, true);
  window.addEventListener('pointerdown', function () { document.body.classList.remove('kbd'); }, true);
  $('#goTour').focus();
  $('#intro').addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { e.preventDefault(); $('#goFree').click(); return; }
    if (e.key !== 'Tab') return; var f = [$('#goTour'), $('#goFree')], i = f.indexOf(document.activeElement);
    e.preventDefault(); f[(i + (e.shiftKey ? -1 : 1) + f.length) % f.length].focus();
  });
  $('#stage').addEventListener('keydown', function (e) {
    var step = e.shiftKey ? 0 : 0.08, pan = e.shiftKey ? want.dist * 0.04 : 0, cy = Math.cos(want.yaw), sy = Math.sin(want.yaw), used = true;
    if (e.key === 'ArrowLeft') { if (pan) { want.tx -= cy * pan; want.tz += sy * pan; } else want.yaw -= step; }
    else if (e.key === 'ArrowRight') { if (pan) { want.tx += cy * pan; want.tz -= sy * pan; } else want.yaw += step; }
    else if (e.key === 'ArrowUp') { if (pan) { want.tx -= sy * pan; want.tz -= cy * pan; } else want.pit = Math.min(1.45, want.pit + step); }
    else if (e.key === 'ArrowDown') { if (pan) { want.tx += sy * pan; want.tz += cy * pan; } else want.pit = Math.max(0.1, want.pit - step); }
    else if (e.key === '+' || e.key === '=') want.dist = Math.max(25, want.dist / 1.15);
    else if (e.key === '-' || e.key === '_') want.dist = Math.min(1800, want.dist * 1.15);
    else if (e.key === 'Home') { state.follow = null; setShot(SHOT.overview); }
    else used = false;
    if (used) { e.preventDefault(); state.userCam = true; if (pan) state.follow = null; }
  });
}
var lastAria = 0;
function ariaTime(now) { if (now - lastAria < 0.6) return; lastAria = now; $('#scrub').setAttribute('aria-valuetext', fmt(T('timeA'), { t: Math.round(state.t), m: state.tMax })); }

/* ---------- boot ---------- */
function boot() {
  world = new S.World($('#stage'), D); buildDock(); buildHud(); initPointer();
  window.addEventListener('resize', function () { world.resize(); });
  runs = runsFor(state.scn, state.inc); world.setRuns(runs, state.inc); computeTMax(); buildSeries(); applyLang(); placeMark();
  $('#play').onclick = function () { if (state.t >= state.tMax) state.t = 0; state.playing = !state.playing; syncPlay(); };
  $('#restart').onclick = function () { state.t = 0; state.beat = -1; state.playing = true; syncPlay(); };
  $('#scrub').oninput = function () { state.t = parseFloat(this.value); };
  $('#scn').onchange = function () { state.scn = this.value; state.playing = false; applyRuns(false); syncPlay(); };
  $('#incT').oninput = function () { $('#incV').textContent = this.value + ' ' + T('second'); };
  $('#incT').onchange = function () { state.inc = parseInt(this.value, 10); applyRuns(true); };
  $('#injNow').onclick = function () { state.inc = Math.max(0, Math.min(300, Math.round(state.t / 5) * 5)); applyRuns(true); };
  $('#injReset').onclick = function () { state.inc = BASE; applyRuns(true); };
  $('#dataBtn').onclick = function () { openData(!state.dataOpen); };
  $('#resBtn').onclick = function () { state.resOpen = !state.resOpen; $('#res').classList.toggle('hide', !state.resOpen); document.body.classList.toggle('res-open', state.resOpen); this.setAttribute('aria-expanded', state.resOpen ? 'true' : 'false'); };
  $('#lblBtn').onclick = function () { state.labels = !state.labels; world.setEdgeLabels(state.labels); this.classList.toggle('on', !state.labels); this.setAttribute('aria-pressed', state.labels ? 'true' : 'false'); };
  $('#langBtn').onclick = function () { LANG = LANG === 'en' ? 'ar' : 'en'; applyLang(); placeMark(); };
  $('#goTour').onclick = startTour; $('#goFree').onclick = function () { leaveIntro(); setShot(SHOT.overview); };
  $('#tourBtn').onclick = function () { if (state.tour) stopTour(); else startTour(); };
  $('#capX').onclick = function () { state.capOpen = false; $('#cap').classList.add('off'); };
  window.addEventListener('keydown', function (e) {
    if (/INPUT|SELECT|TEXTAREA/.test(e.target.tagName) && e.key !== ' ') return;
    if (e.key === ' ') { e.preventDefault(); $('#play').click(); }
    else if (e.key === 'r' || e.key === 'R') $('#restart').click();
    else if (e.key === 'Escape') { if (state.dataOpen) { openData(false); return; } state.follow = null; if (state.tour) stopTour(); }
    else if ('1234'.indexOf(e.key) >= 0 && e.key) { var k = ['overview'].concat(POL)[parseInt(e.key, 10) - 1]; state.follow = null; setShot(SHOT[k]); state.userCam = true; }
    else if (e.key === 'l' || e.key === 'L') $('#lblBtn').click();
  });
  if (window.innerWidth < 1100) { state.resOpen = false; $('#res').classList.add('hide'); }
  document.body.classList.toggle('res-open', state.resOpen); $('#resBtn').setAttribute('aria-expanded', state.resOpen ? 'true' : 'false'); $('#lblBtn').setAttribute('aria-pressed', 'true'); $('#dataBtn').setAttribute('aria-pressed', 'false');
  initA11y();
  window.__dm = { state: state, cam: cam, want: want, world: world, runs: function () { return runs; }, startTour: startTour, setShot: setShot, SHOT: SHOT };
  requestAnimationFrame(frame);
}
boot();
})();
