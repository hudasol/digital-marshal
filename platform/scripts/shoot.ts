/* Visual check: drives the running app in a local Chrome or Edge (no browser download) and saves
   full-resolution screenshots for the shots listed in a JSON spec.
   Usage: npx tsx scripts/shoot.ts <spec.json> <outDir> [url]
   Spec: [{ "name": "overview", "quality": "high", "pose": {...}, "eval": "js", "wait": 1500, "size": [1920,1080] }] */
import { chromium, type Browser } from 'playwright-core';
import { readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

interface Shot {
  name: string;
  quality?: 'high' | 'balanced' | 'performance';
  pose?: { tx: number; ty: number; tz: number; yaw: number; pitch: number; dist: number; fov: number };
  mode?: string;
  eval?: string;
  wait?: number;
  size?: [number, number];
  hideUi?: boolean;
  lang?: 'en' | 'ar';
}

async function launch(): Promise<Browser> {
  const args = ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11', '--enable-unsafe-swiftshader'];
  for (const channel of ['chrome', 'msedge']) {
    try {
      return await chromium.launch({ channel, headless: true, args });
    } catch {
      /* try the next installed browser */
    }
  }
  throw new Error('No local Chrome or Edge found for screenshots');
}

async function main() {
  const [specPath, outDir, url = 'http://localhost:5173/'] = process.argv.slice(2);
  const shots: Shot[] = JSON.parse(readFileSync(specPath, 'utf8'));
  mkdirSync(outDir, { recursive: true });
  const browser = await launch();
  const logs: string[] = [];
  for (const shot of shots) {
    const [w, h] = shot.size ?? [1920, 1080];
    const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
    page.on('console', (m) => {
      if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${shot.name}] ${m.type()}: ${m.text().slice(0, 300)}`);
    });
    page.on('pageerror', (e) => logs.push(`[${shot.name}] pageerror: ${e.message}`));
    await page.addInitScript((lang) => {
      try {
        localStorage.setItem('dm.lang', lang);
      } catch {
        /* ignore */
      }
    }, shot.lang ?? 'en');
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForFunction(() => !!(window as unknown as { digitalMarshal?: { world?: unknown } }).digitalMarshal?.world, null, {
      timeout: 30000,
    });
    await page.evaluate(
      ({ quality, pose, mode, hideUi }) => {
        const dm = (window as unknown as { digitalMarshal: any }).digitalMarshal;
        if (quality) dm.setQualityChoice(quality);
        if (mode) dm.setCamMode(mode);
        if (pose) dm.world.rig.flyTo(pose, { duration: 0.001 });
        const fade = document.querySelector('.stage-fade') as HTMLElement | null;
        if (fade) fade.style.display = 'none';
        if (hideUi) document.querySelectorAll('.panel, .bar, .cam-toolbar, .panel-toggle').forEach((e) => ((e as HTMLElement).style.display = 'none'));
      },
      { quality: shot.quality, pose: shot.pose, mode: shot.mode, hideUi: shot.hideUi },
    );
    if (shot.eval) await page.evaluate(shot.eval);
    await page.waitForTimeout(shot.wait ?? 2500);
    const file = join(outDir, `${shot.name}.png`);
    await page.screenshot({ path: file });
    const stats = await page.evaluate(() => {
      const dm = (window as unknown as { digitalMarshal: any }).digitalMarshal;
      const i = dm.world.renderer.info;
      return { calls: i.render.calls, tris: i.render.triangles, t: dm.renderT ?? 0, n: dm.engine?.state.order.length ?? 0 };
    });
    console.log(`${shot.name}: ${file}  calls=${stats.calls} tris=${stats.tris} t=${stats.t.toFixed(1)} vehicles=${stats.n}`);
    await page.close();
  }
  await browser.close();
  if (logs.length) console.log('console:\n' + logs.join('\n'));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
