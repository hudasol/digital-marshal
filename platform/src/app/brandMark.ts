/* The Digital Marshal mark: three signal arcs over a navigation arrow and a road seen in
   perspective. One geometry, in a 100 x 100 box, shared by the interface (BrandMark) and the static
   icons (scripts/brand-assets.ts) so they cannot drift apart. The road's centre dashes are holes,
   so they show whatever is behind the mark: white on paper, the tile's colour on an app icon. */

export const MARK = {
  viewBox: '0 0 100 100',
  /** concentric arcs about (50, 63.5), stroked with round caps, each spanning 46.5 degrees either side of vertical */
  arcs: [
    'M8.44 24.06A57.3 57.3 0 0 1 91.56 24.06',
    'M18.52 33.63A43.4 43.4 0 0 1 81.48 33.63',
    'M28.24 42.85A30.0 30.0 0 0 1 71.76 42.85',
  ],
  arcWidth: 7.1,
  /** notched navigation arrowhead; drawn with a thin stroke of its own colour to soften the corners */
  arrow: 'M50 42.4L69.4 71.6L50 62.9L30.6 71.6Z',
  arrowRound: 1.4,
  /** the road: flat-topped under the arrow's notch, flaring toward the viewer; three dashes growing with it (even-odd holes) */
  road: 'M42.9 69.8L57.1 69.8L77 96.6L23 96.6Z M48.45 72.1h3.1v4.6h-3.1Z M47.9 79h4.2v5.8h-4.2Z M47.1 88.3h5.8v6.9h-5.8Z',
};

export const BRAND = {
  red: '#ec0101',
  redTile: '#fc191b',
  navy: '#1d2a39',
  tileDark: '#192836',
  paper: '#f1f5f9',
  tagline: 'See the road before it happens',
};

/** A standalone SVG of the mark, optionally on an app-icon tile. */
export function markSvg(opts: { arcs: string; body: string; tile?: string; size?: number; rx?: number } = { arcs: BRAND.red, body: BRAND.navy }): string {
  const { arcs, body, tile } = opts;
  const inner = `<g fill="none" stroke="${arcs}" stroke-width="${MARK.arcWidth}" stroke-linecap="round">${MARK.arcs.map((d) => `<path d="${d}"/>`).join('')}</g>`
    + `<path d="${MARK.arrow}" fill="${body}" stroke="${body}" stroke-width="${MARK.arrowRound}" stroke-linejoin="round"/>`
    + `<path d="${MARK.road}" fill="${body}" fill-rule="evenodd"/>`;
  const content = tile
    ? `<rect width="100" height="100" rx="${opts.rx ?? 22}" fill="${tile}"/><g transform="translate(17 17.3) scale(0.66)">${inner}</g>`
    : inner;
  const size = opts.size ? ` width="${opts.size}" height="${opts.size}"` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${MARK.viewBox}"${size}>${content}</svg>`;
}
