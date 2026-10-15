import type { ReactElement } from 'react';
import { BRAND, MARK } from '../brandMark';

/* Small stroke icon set (24 px grid, currentColor) drawn for this project. */

const P: Record<string, ReactElement> = {
  play: <path d="M8 5.5v13l10.5-6.5z" fill="currentColor" stroke="none" />,
  pause: (
    <>
      <rect x="7" y="5.5" width="3.6" height="13" rx="1" fill="currentColor" stroke="none" />
      <rect x="13.4" y="5.5" width="3.6" height="13" rx="1" fill="currentColor" stroke="none" />
    </>
  ),
  restart: (
    <>
      <path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3" />
      <path d="M4.5 4.5v4h4" />
    </>
  ),
  next: (
    <>
      <path d="M6 6l7 6-7 6z" />
      <path d="M17 6v12" />
    </>
  ),
  chevronLeft: <path d="M15 5l-7 7 7 7" />,
  chevronRight: <path d="M9 5l7 7-7 7" />,
  panelLeft: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
      <path d="M9.5 4.5v15" />
    </>
  ),
  panelRight: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
      <path d="M14.5 4.5v15" />
    </>
  ),
  city: (
    <>
      <path d="M3.5 20.5h17" />
      <path d="M5.5 20.5V11l4-2v11.5" />
      <path d="M9.5 20.5V5.5l5-2v17" />
      <path d="M14.5 20.5V10l4 1.5v9" />
    </>
  ),
  topdown: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <path d="M4 12h16M12 4v16" />
    </>
  ),
  target: (
    <>
      <circle cx="12" cy="12" r="7.5" />
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3" />
    </>
  ),
  car: (
    <>
      <path d="M5 16.5h14v-4l-2-4.5H7l-2 4.5z" />
      <path d="M5 12.5h14" />
      <circle cx="8" cy="16.5" r="1.6" />
      <circle cx="16" cy="16.5" r="1.6" />
    </>
  ),
  ambulance: (
    <>
      <path d="M3.5 17V8.5h10V17" />
      <path d="M13.5 11h4l3 3v3h-17" />
      <path d="M8.5 10v4M6.5 12h4" />
      <circle cx="7" cy="17.5" r="1.6" />
      <circle cx="17" cy="17.5" r="1.6" />
    </>
  ),
  street: (
    <>
      <path d="M8 21l2.5-18M16 21L13.5 3" />
      <path d="M12 7v2M12 12v2M12 17v2" />
    </>
  ),
  move: (
    <>
      <path d="M12 3v18M3 12h18" />
      <path d="M12 3l-2.5 2.5M12 3l2.5 2.5M12 21l-2.5-2.5M12 21l2.5-2.5M3 12l2.5-2.5M3 12l2.5 2.5M21 12l-2.5-2.5M21 12l-2.5 2.5" />
    </>
  ),
  home: (
    <>
      <path d="M4 11l8-6.5 8 6.5" />
      <path d="M6.5 9.5V19h11V9.5" />
    </>
  ),
  gauge: (
    <>
      <path d="M4.5 16a7.5 7.5 0 1 1 15 0" />
      <path d="M12 16l3.5-4.5" />
      <circle cx="12" cy="16" r="1.2" fill="currentColor" />
    </>
  ),
  x: <path d="M6 6l12 12M18 6L6 18" />,
  alert: (
    <>
      <path d="M12 4l9 15.5H3z" />
      <path d="M12 10v4.5M12 17.2v.3" />
    </>
  ),
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  info: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5.5M12 7.8v.3" />
    </>
  ),
  signal: (
    <>
      <rect x="8.5" y="2.5" width="7" height="15" rx="2" />
      <circle cx="12" cy="6.3" r="1.3" />
      <circle cx="12" cy="10" r="1.3" />
      <circle cx="12" cy="13.7" r="1.3" />
      <path d="M12 17.5v4" />
    </>
  ),
  cone: (
    <>
      <path d="M9.5 4h5l3.5 15.5H6z" />
      <path d="M8.3 10h7.4M7.4 14.5h9.2" />
      <path d="M4 19.5h16" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3l7.5 3v5.5c0 4.6-3.2 8-7.5 9.5-4.3-1.5-7.5-4.9-7.5-9.5V6z" />
      <path d="M8.8 12l2.3 2.3 4.3-4.6" />
    </>
  ),
  radio: (
    <>
      <circle cx="12" cy="12" r="2" />
      <path d="M8.2 8.2a5.4 5.4 0 0 0 0 7.6M15.8 8.2a5.4 5.4 0 0 1 0 7.6" />
      <path d="M5.4 5.4a9.3 9.3 0 0 0 0 13.2M18.6 5.4a9.3 9.3 0 0 1 0 13.2" />
    </>
  ),
  download: (
    <>
      <path d="M12 4v11" />
      <path d="M7.5 10.5L12 15l4.5-4.5" />
      <path d="M4.5 19.5h15" />
    </>
  ),
  layers: (
    <>
      <path d="M12 4l8.5 4.5L12 13 3.5 8.5z" />
      <path d="M3.5 12.5L12 17l8.5-4.5" />
      <path d="M3.5 16.5L12 21l8.5-4.5" />
    </>
  ),
  bolt: <path d="M13 3L5.5 13.5H11L10 21l8-11h-5.5z" />,
  compare: (
    <>
      <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
    </>
  ),
  code: (
    <>
      <path d="M8.5 7L3.5 12l5 5M15.5 7l5 5-5 5" />
    </>
  ),
  book: (
    <>
      <path d="M4.5 5.5c2.5-1 5-1 7.5.5 2.5-1.5 5-1.5 7.5-.5v13c-2.5-1-5-1-7.5.5-2.5-1.5-5-1.5-7.5-.5z" />
      <path d="M12 6v13" />
    </>
  ),
  flag: (
    <>
      <path d="M5.5 21V4" />
      <path d="M5.5 4.5h11l-2 4 2 4h-11" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8.5" r="3" />
      <path d="M3.5 19c.5-3 2.7-4.8 5.5-4.8s5 1.8 5.5 4.8" />
      <path d="M15.5 6a3 3 0 0 1 0 5.5M17.5 14.6c1.6.6 2.7 2 3 4.4" />
    </>
  ),
  route: (
    <>
      <circle cx="6" cy="18" r="2" />
      <circle cx="18" cy="6" r="2" />
      <path d="M8 18h7.5a3.5 3.5 0 0 0 0-7h-7a3.5 3.5 0 0 1 0-7H16" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7" />
    </>
  ),
  sunset: (
    <>
      <path d="M3 17.5h18M6 21h12" />
      <path d="M7.5 17.5a4.5 4.5 0 0 1 9 0" />
      <path d="M12 6.5v3.5M5.6 9.6l1.7 1.7M18.4 9.6l-1.7 1.7" />
    </>
  ),
  dusk: (
    <>
      <path d="M3 18h18" />
      <path d="M8 18a4 4 0 0 1 8 0" />
      <path d="M17.5 4.5a3.6 3.6 0 1 0 2.8 5.9 3 3 0 0 1-2.8-5.9z" />
    </>
  ),
  moon: <path d="M19.5 14.5A8 8 0 1 1 9.5 4.5a6.4 6.4 0 0 0 10 10z" />,
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  locate: (
    <>
      <circle cx="12" cy="12" r="6.5" />
      <circle cx="12" cy="12" r="2" fill="currentColor" stroke="none" />
      <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3" />
    </>
  ),
  map: (
    <>
      <path d="M3.5 6.5l5.5-2.5 6 2.5 5.5-2.5v13.5L15 20l-6-2.5-5.5 2.5z" />
      <path d="M9 4v13.5M15 6.5V20" />
    </>
  ),
};

export type IconName = keyof typeof P;

export function Icon({ name, title, className }: { name: IconName; title?: string; className?: string }) {
  return (
    <svg
      className={`icon-svg ${className ?? ''}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
    >
      {title ? <title>{title}</title> : null}
      {P[name]}
    </svg>
  );
}

/** The Digital Marshal mark (src/app/brandMark.ts): red signal arcs, the arrow and road in the
    current text colour, the road's dashes cut out so the background shows through. */
export function BrandMark() {
  return (
    <svg className="brand-mark" viewBox={MARK.viewBox} aria-hidden="true">
      <g fill="none" stroke={BRAND.red} strokeWidth={MARK.arcWidth} strokeLinecap="round">
        {MARK.arcs.map((d) => (
          <path key={d} d={d} />
        ))}
      </g>
      <path d={MARK.arrow} fill="currentColor" stroke="currentColor" strokeWidth={MARK.arrowRound} strokeLinejoin="round" />
      <path d={MARK.road} fill="currentColor" fillRule="evenodd" />
    </svg>
  );
}
