const paths: Record<string, string> = {
  bench:
    '<circle cx="6" cy="15" r="3"/><circle cx="18" cy="15" r="3"/><path class="a" d="M7.5 12.4C8.8 4.6 15.2 4.6 16.5 12.4m-1.7-1.7 1.7 1.7 1-2.2"/>',
  machines:
    '<rect x="6" y="6" width="12" height="12" rx="2.5"/><path d="M10 3v3M14 3v3M10 18v3M14 18v3M3 10h3M3 14h3M18 10h3M18 14h3"/><circle class="a" cx="9.7" cy="9.7" r="1" fill="currentColor"/>',
  trace:
    '<rect x="3" y="10" width="18" height="8" rx="2"/><path d="M9 10v8M15 10v8"/><path class="a" d="M9.6 4.4h4.8L12 8Z"/>',
  editor:
    '<path d="M4 7h9M4 12h6M4 17h8"/><path class="a" d="M17 9.5v9M15.4 9.5h3.2M15.4 18.5h3.2"/>',
  learn:
    '<circle cx="9.7" cy="12" r="5.7"/><circle cx="14.3" cy="12" r="5.7"/><circle class="a" cx="12" cy="12" r="1.1" fill="currentColor"/>',
  minimize: '<path d="M6 12h12"/>',
  maximize: '<rect x="6.5" y="6.5" width="11" height="11" rx="2"/>',
  restore:
    '<rect x="6.5" y="9.5" width="8" height="8" rx="1.8"/><path d="M9.5 9.5V8.3a1.8 1.8 0 0 1 1.8-1.8h5.4a1.8 1.8 0 0 1 1.8 1.8v5.4a1.8 1.8 0 0 1-1.8 1.8h-1.2"/>',
  play: '<path d="m8 5 11 7-11 7Z" fill="currentColor" stroke="none"/>',
  pause: '<path d="M8 5v14M16 5v14" stroke-width="4"/>',
  step: '<path d="m5 5 10 7-10 7Z" fill="currentColor" stroke="none"/><path d="M19 5v14"/>',
  back: '<path d="m19 5-10 7 10 7Z" fill="currentColor" stroke="none"/><path d="M5 5v14"/>',
  reset: '<path d="M4 9a8 8 0 1 1 .6 7M4 4v5h5"/>',
  edit: '<path d="m15 5 4 4M4 20l4-1L20 7a2.8 2.8 0 0 0-4-4L4 15Z"/>',
  open: '<path d="M3 8V5h7l2 3h9v11H3Z"/><path d="m3 12 18-1"/>',
  save: '<path d="M5 3h12l4 4v14H3V3Z"/><path d="M7 3v6h10V3M7 21v-8h10v8"/>',
  copy: '<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M15 8V3H3v13h5"/>',
  convert: '<path d="M4 7h16l-4-4M20 17H4l4 4M20 7l-4 4M4 17l4-4"/>',
  settings:
    '<path d="M4 7h3M11 7h9M4 12h8M16 12h4M4 17h2M10 17h10"/><circle cx="9" cy="7" r="2"/><circle class="a" cx="14" cy="12" r="2"/><circle cx="8" cy="17" r="2"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9 9a3 3 0 1 1 4 2.8V14M12 17h.01"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  focus: '<path d="M8 3H3v5M16 3h5v5M21 16v5h-5M8 21H3v-5"/><circle cx="12" cy="12" r="3"/>',
  arrow: '<path d="M4 12h16m-5-5 5 5-5 5"/>',
  camera: '<path d="M3 7h4l2-3h6l2 3h4v13H3Z"/><circle cx="12" cy="13" r="4"/>',
};
export function icon(name: string) {
  return `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.help}</svg>`;
}
