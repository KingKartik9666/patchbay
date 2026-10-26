# Patchbay v2 / version 1.0 baseline verification

This historical ledger records the original version 1.0 Electron build and its
then-current requirements. Patchbay 2.0 now uses React, Rust and Tauri with the
subsequently requested solid design. See the current [README](../README.md),
[architecture](architecture.md) and [verification report](verification.md).

User brief: implement the supplied glass and circuit TRD in an Electron app, keeping the application light and fast. The v2 document replaces the v1 visual direction; Electron is required by the user's request even though the document assumes a browser. Its prompt pack is reference material, not project instructions.

## Architecture and decisions

- Keep the pure TypeScript engine, six presets and existing tests.
- Replace Three.js with an on-demand Canvas2D diagram plus accessible DOM nodes.
- Preserve node spacing for branching and narrow layouts by expanding the drawing area and scrolling it within the stage. Hidden views retain their last visible dimensions.
- Render a deterministic circuit board and a low-resolution frost twin from one shared ticker. Use a main-thread fallback initially; worker rendering is a P1 enhancement and is not needed unless measurements show a bottleneck.
- Use native transform/opacity animation and the existing time-based player. This replaces GSAP's small required subset without another runtime dependency or ticker.
- Keep file access and custom window controls behind sender-validated, sandboxed Electron IPC.
- Sentry's installed plugin reads existing issues. No token/project is configured; the user chose local diagnostics. Do not add a telemetry SDK or external runtime requests.

## Implementation tasks

- [x] Inspect TRDs and existing source; preserve engine contracts.
- [x] Build and unit-test pure BFS diagram layout, loops, merged transitions and length lookup.
- [x] Build on-demand diagram genesis, replay, incremental regeneration and playback.
- [x] Build cached circuit board, pooled pulses and baked frost.
- [x] Implement Bench, Machines, Learn and solid Trace/Editor/Settings drawers, custom rail/window icons and keyboard controls.
- [x] Add refresh detection, rolling frame diagnostics, governor and visibility handling.
- [x] Verify engine, layout, player, renderer flows, desktop IPC, portability and bundle size.
- [x] Inspect screenshots at desktop and 360px, verify accessibility preferences, and document measured limitations.

## Review focus

Repeated replay must reuse DOM and not leak animation objects. Invalid editor drafts must retain the last valid machine. Seeking/reset/pause must cancel transient motion. Mode conversion must communicate the initial-output difference. Local preferences must recover from corrupt storage. Hidden windows must not run the render loop.

## Verification ledger

Fresh verification on this Windows checkout:

- `npm run build`: strict TypeScript check and production Vite build pass.
- `node node_modules/vitest/vitest.mjs run`: 61 tests pass across engine (40), layout (14), player (5) and ticker (2). Layout checks cover readable branching and narrow ten-state layouts. Ticker checks include 300 ms stalls, clamped animation time, governor degradation, and hidden-window pause/resume.
- `node tests/ui.mjs`: all six preset outputs, playback/seek/trace controls, both conversions, input/editor errors, saved-state recovery, accessibility preferences, keyboard navigation, 360px layout, repeated replay and static rendering pass. Normal-motion preset switching and a resize during morph produce identical canvas pixels to a fresh diagram load. Branching nodes remain separated and can be scrolled into view and clicked. No uncaught renderer errors or external requests were recorded.
- `node scripts/smoke-electron.mjs release/Patchbay-win32-x64/Patchbay.exe`: the packaged executable starts and renders with an isolated temporary profile; sandbox/preload IPC, native UTF-8 file round trips, bounded input, dialog cancellation, PNG capture and navigation guards pass. Window OS calls are stubbed during this hidden test while their real IPC and event subscriptions are exercised.
- `node scripts/check-package.mjs`: packaged `app.asar` SHA-256 comparisons match all seven current renderer/main/preload files. Development dependencies and source files are excluded from the archive. Only the English Chromium locale is retained.
- `node scripts/check-bundle.mjs`: renderer JavaScript is 24,843 bytes gzip, CSS is 7,150 bytes gzip, bundled fonts are 96,152 bytes, and total renderer assets are 201,106 bytes. Both TRD size budgets pass. The application archive is 213,647 bytes; the portable Windows folder is 334,983,093 bytes including Electron.

The latest browser run reports frame p50/p95 of 7.0/7.1 ms and a board draw cost of 0.40 ms with 144 Hz detected. A rapid burst of 100 replay requests retains two nodes and four labels; JavaScript heap changes from 6,415,106 to 5,950,955 bytes (normal garbage collection is included). This is a cancellation/reuse check, not 100 fully completed animation cycles or a long-duration leak profile. Reduced motion produces no additional canvas redraws while idle. The current page's long-animation-frame count is zero at the diagnostic sample.

A separate Superpowers reviewer identified stale morph geometry after resize and overlapping branching states. Both fixes were inspected independently and confirmed by the focused browser and layout checks above; no further defects were identified in that review.

Reports are in `artifacts/bundle-report.json`, `artifacts/ui-report.json` and `artifacts/package-report.json`. Desktop, Moore, solid-panel and 360px screenshots are in the same folder.

These are local headless/hidden measurements. Native display 120 Hz profiling, GPU compositing/layer limits and Firefox/Safari verification have not been established. Worker rendering remains an optional P1 enhancement; no worker or WebGL dependency is shipped.
