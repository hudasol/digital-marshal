import { useStore } from './store';

/* English is the source; Arabic must define every key (the compiler enforces it).
   Values may contain {name} placeholders filled by fmt(). */
const en = {
  'brand.name': 'DIGITAL MARSHAL',
  'brand.sub': 'Autonomous Mobility Intelligence Platform',
  'chip.prototype': 'Synthetic research prototype',
  'chip.prototype.title':
    'Independent student prototype. Synthetic Dubai-inspired district; no RTA systems, data or endorsement.',
  'view.twin': 'Digital twin',
  'view.compare': 'Evidence',
  'view.engineering': 'Engineering',
  'view.about': 'About',
  'lang.toggle': 'العربية',
  'lang.toggle.label': 'Switch language to Arabic',
  'status.running': 'Running',
  'status.paused': 'Paused',
  'status.scenario': 'Scenario',
  'scenario.normal': 'Normal operations',
  'panel.ops': 'Operations',
  'panel.intel': 'Intelligence',
  'panel.collapse': 'Collapse panel',
  'panel.expand.ops': 'Show operations panel',
  'panel.expand.intel': 'Show intelligence panel',
  'cam.overview': 'City overview',
  'cam.topdown': 'Top-down',
  'cam.incident': 'Incident focus',
  'cam.follow': 'Vehicle follow',
  'cam.emergency': 'Emergency follow',
  'cam.street': 'Street view',
  'cam.free': 'Free camera',
  'cam.reset': 'Reset camera',
  'cam.toolbar': 'Camera modes',
  'play.play': 'Play',
  'play.pause': 'Pause',
  'play.restart': 'Restart',
  'play.speed': 'Playback speed',
  'play.scrub': 'Simulation timeline',
  'play.next': 'Jump to next important event',
  'play.time': 'Simulation time',
  'gfx.title': 'Graphics',
  'gfx.auto': 'Auto',
  'gfx.high': 'High',
  'gfx.balanced': 'Balanced',
  'gfx.performance': 'Performance',
  'gfx.perf': 'Performance monitor',
  'gfx.downgraded': 'Graphics lowered to {q} to keep the simulation smooth.',
  'perf.fps': 'FPS',
  'perf.frame': 'Frame time',
  'perf.calls': 'Draw calls',
  'perf.tris': 'Triangles',
  'perf.geo': 'Geometries',
  'perf.tex': 'Textures',
  'perf.sim': 'Sim step',
  'perf.quality': 'Quality',
  'perf.pr': 'Pixel ratio',
  'nowebgl.title': 'WebGL is not available',
  'nowebgl.body':
    'This browser or device cannot create a WebGL context, so the 3D city cannot be drawn. The simulation still runs; the map view below shows the same state in 2D.',
  'loading': 'Preparing the district',
} as const;

export type I18nKey = keyof typeof en;

const ar: Record<I18nKey, string> = {
  'brand.name': 'المارشال الرقمي',
  'brand.sub': 'منصة ذكاء التنقل الذاتي',
  'chip.prototype': 'نموذج بحثي اصطناعي',
  'chip.prototype.title':
    'نموذج طلابي مستقل. حي اصطناعي مستوحى من دبي؛ لا أنظمة ولا بيانات ولا اعتماد من هيئة الطرق والمواصلات.',
  'view.twin': 'التوأم الرقمي',
  'view.compare': 'الأدلة',
  'view.engineering': 'الهندسة',
  'view.about': 'حول المشروع',
  'lang.toggle': 'English',
  'lang.toggle.label': 'التبديل إلى الإنجليزية',
  'status.running': 'قيد التشغيل',
  'status.paused': 'متوقف مؤقتاً',
  'status.scenario': 'السيناريو',
  'scenario.normal': 'التشغيل الاعتيادي',
  'panel.ops': 'العمليات',
  'panel.intel': 'المعلومات',
  'panel.collapse': 'طي اللوحة',
  'panel.expand.ops': 'إظهار لوحة العمليات',
  'panel.expand.intel': 'إظهار لوحة المعلومات',
  'cam.overview': 'نظرة عامة',
  'cam.topdown': 'من الأعلى',
  'cam.incident': 'التركيز على الحادث',
  'cam.follow': 'تتبع مركبة',
  'cam.emergency': 'تتبع الإسعاف',
  'cam.street': 'مستوى الشارع',
  'cam.free': 'كاميرا حرة',
  'cam.reset': 'إعادة ضبط الكاميرا',
  'cam.toolbar': 'أوضاع الكاميرا',
  'play.play': 'تشغيل',
  'play.pause': 'إيقاف مؤقت',
  'play.restart': 'إعادة البدء',
  'play.speed': 'سرعة التشغيل',
  'play.scrub': 'الخط الزمني للمحاكاة',
  'play.next': 'الانتقال إلى الحدث المهم التالي',
  'play.time': 'زمن المحاكاة',
  'gfx.title': 'الرسوميات',
  'gfx.auto': 'تلقائي',
  'gfx.high': 'عالية',
  'gfx.balanced': 'متوازنة',
  'gfx.performance': 'أداء',
  'gfx.perf': 'مراقب الأداء',
  'gfx.downgraded': 'تم خفض الرسوميات إلى {q} للحفاظ على سلاسة المحاكاة.',
  'perf.fps': 'إطار/ث',
  'perf.frame': 'زمن الإطار',
  'perf.calls': 'استدعاءات الرسم',
  'perf.tris': 'المثلثات',
  'perf.geo': 'الأشكال',
  'perf.tex': 'الخامات',
  'perf.sim': 'خطوة المحاكاة',
  'perf.quality': 'الجودة',
  'perf.pr': 'نسبة البكسل',
  'nowebgl.title': 'تقنية WebGL غير متاحة',
  'nowebgl.body':
    'لا يستطيع هذا المتصفح أو الجهاز إنشاء سياق WebGL، لذلك لا يمكن رسم المدينة ثلاثية الأبعاد. تستمر المحاكاة في العمل، وتعرض الخريطة أدناه الحالة نفسها بشكل ثنائي الأبعاد.',
  'loading': 'جارٍ تجهيز الحي',
};

export const DICTS = { en, ar } as const;
export type Lang = keyof typeof DICTS;

export function fmt(s: string, params?: Record<string, string | number>): string {
  if (!params) return s;
  return s.replace(/\{(\w+)\}/g, (m, k: string) => (params[k] !== undefined ? String(params[k]) : m));
}

export function translate(lang: Lang, key: I18nKey, params?: Record<string, string | number>): string {
  const d = DICTS[lang] as Record<I18nKey, string>;
  return fmt(d[key] ?? en[key] ?? key, params);
}

export function useT() {
  const lang = useStore((s) => s.lang);
  return (key: I18nKey, params?: Record<string, string | number>) => translate(lang, key, params);
}
