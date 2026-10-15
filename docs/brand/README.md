# Brand

`logo-sheet.webp` is the logo the team chose: the mark, the wordmark "digital marshal", the tagline
"See the road before it happens", and the mark on dark, red and white app tiles.

## The mark

Three red signal arcs over a navigation arrow and a road seen in perspective.

- **Vector rebuild.** The interface and every icon use a vector rebuild of the sheet's mark, measured from the sheet itself. The geometry lives in one file, `platform/src/app/brandMark.ts`.
- **Dashes.** The road's dashes are cut out, so they show the background: white on paper, the tile colour on an app icon.
- **On dark backgrounds** (the interface, the demo video), the arrow and road are white and the arcs stay red.

| Use | Colour |
|---|---|
| Arcs | `#ec0101` |
| Arrow, road, wordmark on light | `#1d2a39` |
| Red tile | `#fc191b` |
| Dark tile | `#192836` |
| Paper | `#f1f5f9` |

## Type

- **Wordmark.** Lowercase "digital marshal" in Montserrat ExtraBold (800). This is the closest open-licence (OFL) face to the sheet's lettering; it is bundled through `@fontsource/montserrat`.
- **Tagline.** Montserrat SemiBold (600), uppercase, letter-spaced about 0.3 em.
- **Arabic.** The interface shows the brand as المارشال الرقمي, with the tagline شاهد الطريق قبل أن يحدث, in IBM Plex Sans Arabic.

## Files

`npx tsx scripts/brand-assets.ts` (from `platform/`) regenerates these from `brandMark.ts`:

- `public/favicon.svg` (the red tile)
- `public/apple-touch-icon.png`
- `public/og-image.png`: the link preview, with the full lockup
- `public/brand/`: the mark on light and dark backgrounds, and the three tiles

If the mark changes, change `brandMark.ts` and run the script again.
