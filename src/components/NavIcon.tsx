export type NavIconName = 'bench' | 'machines' | 'trace' | 'editor' | 'learn' | 'settings';

/** Small machine-inspired marks, drawn for Patchbay's navigation. */
export function NavIcon({ name }: { name: NavIconName }) {
  return (
    <svg
      className="nav-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
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
          <circle className="nav-icon-detail" cx="17" cy="12" r="2.5" />
        </>
      )}
      {name === 'machines' && (
        <>
          <rect x="7.5" y="3" width="13" height="15" rx="3" />
          <path d="M16.5 18v1a2 2 0 0 1-2 2h-9a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h2" />
          <path d="M11 8h6M11 12h3" />
          <circle className="nav-icon-detail" cx="17" cy="12" r=".8" />
        </>
      )}
      {name === 'trace' && (
        <>
          <path d="M5 6v12M10 5h10M10 12h6M10 19h10" />
          <circle cx="5" cy="5" r="1.5" fill="var(--deep)" />
          <circle className="nav-icon-detail" cx="5" cy="12" r="1.5" fill="var(--deep)" />
          <circle cx="5" cy="19" r="1.5" fill="var(--deep)" />
        </>
      )}
      {name === 'editor' && (
        <>
          <circle cx="5.5" cy="5.5" r="2.5" />
          <circle cx="17.5" cy="5.5" r="2.5" />
          <circle cx="5.5" cy="17.5" r="2.5" />
          <path d="M8 5.5h7M5.5 8v7" />
          <path
            className="nav-icon-detail"
            d="m12.5 21 1-4.5L19 11l3 3-5.5 5.5-4.5 1ZM17.5 12.5l3 3"
          />
        </>
      )}
      {name === 'learn' && (
        <>
          <path d="M12 6c-2.4-2-5.3-2.6-9-2v15c3.7-.6 6.6 0 9 2 2.4-2 5.3-2.6 9-2V4c-3.7-.6-6.6 0-9 2ZM12 6v15" />
          <path d="M6 8.5c1-.1 2 .2 3 .7M6 12.5c1-.1 2 .2 3 .7" />
          <path className="nav-icon-detail" d="M15 9.2c1-.5 2-.8 3-.7M15 13.2c1-.5 2-.8 3-.7" />
        </>
      )}
      {name === 'settings' && (
        <>
          <path d="M3 6h4M11 6h10M3 12h10M17 12h4M3 18h4M11 18h10" />
          <circle cx="9" cy="6" r="2" />
          <circle className="nav-icon-detail" cx="15" cy="12" r="2" />
          <circle cx="9" cy="18" r="2" />
        </>
      )}
    </svg>
  );
}
