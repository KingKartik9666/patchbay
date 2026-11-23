import { useId } from 'react';

/** The eight sun rays, as one path around the 12,12 centre. */
const RAYS =
  'M12 2.2v2.3M12 19.5v2.3M2.2 12h2.3M19.5 12h2.3M5.07 5.07l1.63 1.63M17.3 17.3l1.63 1.63M5.07 18.93l1.63-1.63M17.3 6.7l1.63-1.63';

/**
 * The theme toggle's glyph: one disc that morphs between a sun and a crescent
 * moon. A masked circle (.cut) bites the core into a crescent, the rays shrink
 * away, and the whole glyph turns, all on the bouncy spring in theme-wave.css,
 * keyed on html[data-theme-intent]. It shows the current theme (a moon in
 * Night); the owning button carries the accessible name.
 */
export function ThemeGlyph() {
  // Two instances (title bar and Settings) need distinct mask ids.
  const mask = `theme-glyph-cut-${useId().replace(/[^\w-]/g, '')}`;
  return (
    <svg className="theme-glyph" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <defs>
        <mask id={mask} maskUnits="userSpaceOnUse" x="-6" y="-6" width="36" height="36">
          <rect x="-6" y="-6" width="36" height="36" fill="#fff" />
          <circle className="cut" cx="31" cy="-7" r="7" fill="#000" />
        </mask>
      </defs>
      <circle className="core" cx="12" cy="12" r="4.6" fill="currentColor" mask={`url(#${mask})`} />
      <g className="rays" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
        <path d={RAYS} />
      </g>
    </svg>
  );
}
