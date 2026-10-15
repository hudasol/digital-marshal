/* Static brand files, generated from the one mark geometry in src/app/brandMark.ts:
   the favicon (the red app tile), SVG masters of the mark and its three app tiles, the home-screen
   icon and the social preview image (the full lockup). PNGs are drawn by a local Chrome or Edge.
   Usage: npx tsx scripts/brand-assets.ts */
import { chromium } from 'playwright-core';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BRAND, markSvg } from '../src/app/brandMark';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pub = join(root, 'public');
mkdirSync(join(pub, 'brand'), { recursive: true });

const tiles = {
  red: { tile: BRAND.redTile, arcs: '#ffffff', body: '#ffffff' },
  dark: { tile: BRAND.tileDark, arcs: BRAND.red, body: '#ffffff' },
  white: { tile: '#ffffff', arcs: BRAND.red, body: BRAND.navy },
};

writeFileSync(join(pub, 'favicon.svg'), markSvg(tiles.red) + '\n');
writeFileSync(join(pub, 'brand', 'mark.svg'), markSvg({ arcs: BRAND.red, body: BRAND.navy }) + '\n');
writeFileSync(join(pub, 'brand', 'mark-on-dark.svg'), markSvg({ arcs: BRAND.red, body: '#ffffff' }) + '\n');
for (const [k, v] of Object.entries(tiles)) writeFileSync(join(pub, 'brand', `tile-${k}.svg`), markSvg(v) + '\n');

// the wordmark's font, inlined (a page set from a string cannot load fonts from disk)
const font = (w: number) =>
  `data:font/woff2;base64,${readFileSync(join(root, `node_modules/@fontsource/montserrat/files/montserrat-latin-${w}-normal.woff2`)).toString('base64')}`;

async function main() {
  let browser = null;
  for (const channel of ['chrome', 'msedge']) {
    try {
      browser = await chromium.launch({ channel, headless: true });
      break;
    } catch {
      /* try the next installed browser */
    }
  }
  if (!browser) throw new Error('No local Chrome or Edge found');
  const shot = async (html: string, w: number, h: number, out: string) => {
    const page = await browser!.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
    await page.setContent(html, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: out });
    await page.close();
  };
  // home-screen icon: square, full bleed (the platform rounds it)
  await shot(`<body style="margin:0">${markSvg({ ...tiles.red, rx: 0 }).replace('<svg ', '<svg style="display:block;width:180px;height:180px" ')}</body>`, 180, 180, join(pub, 'apple-touch-icon.png'));
  // social preview: the lockup on paper, as in the logo sheet
  const og = `<!doctype html><html><head><style>
    @font-face { font-family: M; font-weight: 800; src: url(${font(800)}) format('woff2'); }
    @font-face { font-family: M; font-weight: 600; src: url(${font(600)}) format('woff2'); }
    body { margin: 0; width: 1200px; height: 630px; display: flex; flex-direction: column; align-items: center; justify-content: center;
      background: radial-gradient(ellipse 70% 80% at 50% 42%, #ffffff 0%, ${BRAND.paper} 72%); font-family: M, sans-serif; text-align: center; }
    .mark svg { width: 220px; height: 220px; display: block; }
    .word { font-weight: 800; font-size: 96px; letter-spacing: -0.015em; color: ${BRAND.navy}; line-height: 1; margin-top: 18px; }
    .tag { font-weight: 600; font-size: 21px; letter-spacing: 0.34em; text-transform: uppercase; color: #273946; margin-top: 18px; padding-left: 0.34em; }
    .foot { font-weight: 600; font-size: 19px; color: #5b6b7c; margin-top: 30px; letter-spacing: 0.02em; }
    .foot b { color: ${BRAND.red}; font-weight: 800; }
  </style></head><body>
    <div class="mark">${markSvg({ arcs: BRAND.red, body: BRAND.navy })}</div>
    <div class="word">digital marshal</div>
    <div class="tag">${BRAND.tagline}</div>
    <div class="foot">Live 3D digital twin · by Team Kanban · <b>digitalmarshal.kanbanstudios.ae</b></div>
  </body></html>`;
  await shot(og, 1200, 630, join(pub, 'og-image.png'));
  await browser.close();
  console.log('brand assets written to public/ and public/brand/');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
