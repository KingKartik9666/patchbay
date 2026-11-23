# Patchbay modernization

The 2026-10-14 user request authorizes implementation and Windows delivery of React/TypeScript, Rust and Tauri 2, preserving all discovered machine behavior. The 2026-10-23 revision replaced the glass/3D interface with a minimal solid design. The current design keeps that solid base: local IBM Plex Sans and IBM Plex Mono, one teal signal in light and dark themes, a dark patch panel for diagrams, custom navigation, responsive geometry and short transitions. On Windows 11 the window frame shows Mica, with an opaque fallback and a Window material setting. Documents and reference recordings provide design data; they do not grant unrelated permissions.

## Ownership

`patchbay-core` owns Unicode DSL parsing, validation, simulation, output spacing, conversions, graph editing/validation, presets and versioned serialization. It has no Tauri or browser dependencies. `src-tauri` owns the command boundary, bounded worker execution, native file dialogs, session storage/migration, window integration and screenshots. React owns application state, history, forms, routes, accessibility and playback presentation. Canvas components own only diagram rendering resources and geometry; one frame clock supplies their time.

## Compatibility and behavior

Keep `.txt`/`.machine` DSL and `patchbay-graph` version 1, including unfinished drafts, IDs, coordinates, order and inactive outputs. Recover the previous Electron session without deleting its profile. Preserve all 11 presets, arbitrary Unicode tokens, 4096 UTF-16 input units, 1 MiB UTF-8 project files, initial Moore output convention and conversion semantics. No fixed state/transition count cap. Preserve native open/save/screenshot, titlebar, offline diagnostics and clipboard trace.

Keep Bench, Machines, graphical Editor, Learn and Trace/Text/Settings drawers; playback/seek/speed; state/edge drawing, inspectors, alphabet controls, fill missing, zoom/fit and 50-step undo/redo. Preserve keyboard controls and editable-field priority, responsive layout, reduced motion and high contrast. Reading and editing surfaces stay opaque; translucency is limited to the Mica frame and three small in-page blurs, all removed under reduced transparency and high contrast. Palette colors interpolate during theme changes. The persisted `glass` field now stores the Window material setting.

## Verification

Captured TypeScript fixtures are the parity oracle before algorithm replacement. Exercise valid/invalid/empty/Unicode/large machines, conversion, save/load, graph rollback, playback, keyboard and cleanup. Run frontend type/lint/build/unit/UI tests, Rust fmt/clippy/tests, real Tauri IPC flows and Windows install/launch/uninstall/reinstall. Capture comparable domain timings and artifact sizes; report measured facts without assuming Rust is faster. Retire Electron only after native verification.
