export type NavIconName = 'bench' | 'machines' | 'trace' | 'text' | 'editor' | 'learn' | 'settings';

/** Small machine-inspired marks, drawn for Patchbay's navigation. Every stroke
 * is currentColor, so an icon reads the same on the window frame as its label. */
export function NavIcon({ name }: { name: NavIconName }) {
  return (
    <svg
      className="nav-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {name === 'bench' && (
        <>
          <rect x="2.5" y="4.5" width="19" height="15" rx="4" />
          <circle cx="7.5" cy="12" r="2.5" />
          <path d="M10 12h4M12.5 10.5 14 12l-1.5 1.5" />
          <circle cx="17" cy="12" r="2.5" />
        </>
      )}
      {name === 'machines' && (
        <>
          <rect x="7.5" y="3" width="13" height="15" rx="3" />
          <path d="M16.5 18v1a2 2 0 0 1-2 2h-9a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h2" />
          <path d="M11 8h6M11 12h3" />
          <circle cx="17" cy="12" r=".8" />
        </>
      )}
      {name === 'trace' && (
        <>
          <path d="M5 6.5v4M5 13.5v4M10 5h10M10 12h6M10 19h10" />
          <circle cx="5" cy="5" r="1.5" />
          <circle cx="5" cy="12" r="1.5" />
          <circle cx="5" cy="19" r="1.5" />
        </>
      )}
      {name === 'text' && (
        <>
          <path d="M8 4H6.5A2.5 2.5 0 0 0 4 6.5V10l-1.5 2L4 14v3.5A2.5 2.5 0 0 0 6.5 20H8" />
          <path d="M16 4h1.5A2.5 2.5 0 0 1 20 6.5V10l1.5 2-1.5 2v3.5a2.5 2.5 0 0 1-2.5 2.5H16" />
          <path d="M8.5 9.5h7M8.5 14.5h4.5" />
        </>
      )}
      {name === 'editor' && (
        <>
          <circle cx="5.5" cy="5.5" r="2.5" />
          <circle cx="17.5" cy="5.5" r="2.5" />
          <circle cx="5.5" cy="17.5" r="2.5" />
          <path d="M8 5.5h7M5.5 8v7" />
          <path d="m12.5 21 1-4.5L19 11l3 3-5.5 5.5-4.5 1ZM17.5 12.5l3 3" />
        </>
      )}
      {name === 'learn' && (
        <>
          <path d="M12 6c-2.4-2-5.3-2.6-9-2v15c3.7-.6 6.6 0 9 2 2.4-2 5.3-2.6 9-2V4c-3.7-.6-6.6 0-9 2ZM12 6v15" />
          <path d="M6 8.5c1-.1 2 .2 3 .7M6 12.5c1-.1 2 .2 3 .7" />
          <path d="M15 9.2c1-.5 2-.8 3-.7M15 13.2c1-.5 2-.8 3-.7" />
        </>
      )}
      {name === 'settings' && (
        <>
          <path d="M3 6h4M11 6h10M3 12h10M17 12h4M3 18h4M11 18h10" />
          <circle cx="9" cy="6" r="2" />
          <circle cx="15" cy="12" r="2" />
          <circle cx="9" cy="18" r="2" />
        </>
      )}
    </svg>
  );
}
