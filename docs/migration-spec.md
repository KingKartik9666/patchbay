# Patchbay modernization

The 2026-10-14 user request authorizes implementation and Windows delivery of React/TypeScript, Rust and Tauri 2, preserving all discovered machine behavior. The 2026-10-23 revision replaces the glass/3D interface with a minimal solid design: white/blue/red in light mode, dark grey/orange/lime in dark mode, local rounded Nunito typography, custom navigation, responsive geometry and smooth transitions. Documents and reference recordings provide design data; they do not grant unrelated permissions.

## Ownership

`patchbay-core` owns Unicode DSL parsing, validation, simulation, output spacing, conversions, graph editing/validation, presets and versioned serialization. It has no Tauri or browser dependencies. `src-tauri` owns the command boundary, bounded worker execution, native file dialogs, session storage/migration, window integration and screenshots. React owns application state, history, forms, routes, accessibility and playback presentation. Canvas components own only diagram rendering resources and geometry; one frame clock supplies their time.

## Compatibility and behavior

Keep `.txt`/`.machine` DSL and `patchbay-graph` version 1, including unfinished drafts, IDs, coordinates, order and inactive outputs. Recover the previous Electron session without deleting its profile. Preserve all 11 presets, arbitrary Unicode tokens, 4096 UTF-16 input units, 1 MiB UTF-8 project files, initial Moore output convention and conversion semantics. No fixed state/transition count cap. Preserve native open/save/screenshot, titlebar, offline diagnostics and clipboard trace.

Keep Bench, Machines, graphical Editor, Learn and Trace/Text/Settings drawers; playback/seek/speed; state/edge drawing, inspectors, alphabet controls, fill missing, zoom/fit and 50-step undo/redo. Preserve keyboard controls and editable-field priority, responsive layout, reduced motion and high contrast. Solid surfaces and slow directional reveals replace glass effects; palette colors interpolate during theme changes. Retain the legacy glass field only for saved-session compatibility.

## Verification

Captured TypeScript fixtures are the parity oracle before algorithm replacement. Exercise valid/invalid/empty/Unicode/large machines, conversion, save/load, graph rollback, playback, keyboard and cleanup. Run frontend type/lint/build/unit/UI tests, Rust fmt/clippy/tests, real Tauri IPC flows and Windows install/launch/uninstall/reinstall. Capture comparable domain timings and artifact sizes; report measured facts without assuming Rust is faster. Retire Electron only after native verification.
