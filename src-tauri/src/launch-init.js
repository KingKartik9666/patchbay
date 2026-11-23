// Runs on document creation, before the page's scripts, styles or first paint
// (see launch.rs). Sets the theme and the launch variant on <html> and lets the
// first key, press, wheel or touch skip the launch without consuming the event.
/* global __PATCHBAY_BOOT__ -- replaced with the boot JSON by launch::script */
(function (boot) {
  'use strict';
  if (window.__patchbayBoot) return;
  window.__patchbayBoot = Object.freeze(boot);
  var live = boot.launch !== 'off';
  function mark(root) {
    root.dataset.theme = boot.theme;
    if (!live) return;
    root.dataset.launch = boot.launch;
    if (boot.contrast) root.dataset.launchContrast = '';
  }
  if (document.documentElement) mark(document.documentElement);
  else
    new MutationObserver(function (_, observer) {
      if (!document.documentElement) return;
      observer.disconnect();
      mark(document.documentElement);
    }).observe(document, { childList: true });
  if (!live) return;
  var events = ['keydown', 'pointerdown', 'wheel', 'touchstart'],
    options = { capture: true, passive: true };
  function skip() {
    var root = document.documentElement,
      mode = root && root.dataset.launch;
    if (mode === 'full' || mode === 'short' || mode === 'still') root.dataset.launch = 'skip';
    events.forEach(function (name) {
      window.removeEventListener(name, skip, options);
    });
    document.removeEventListener('visibilitychange', hidden);
  }
  function hidden() {
    if (document.hidden) skip();
  }
  events.forEach(function (name) {
    window.addEventListener(name, skip, options);
  });
  document.addEventListener('visibilitychange', hidden);
})(__PATCHBAY_BOOT__);
