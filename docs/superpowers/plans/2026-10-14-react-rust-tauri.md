# React, Rust and Tauri migration implementation plan

> **For agentic workers:** Use superpowers:executing-plans for integration and superpowers:dispatching-parallel-agents for the independent core and rendering/editor work.

**Goal:** Deliver a maintainable, verified Patchbay Windows application with the existing features and visual design.

**Architecture:** One independent Rust domain crate behind one typed batch command. React owns application state and UI. Tauri owns desktop integration; React hosts resource-managed Canvas/WebGL drawing.

**Tech Stack:** React 19.3.0, TypeScript 6.0.3, Vite 8.3.2, Rust 1.99.0 MSVC, Tauri 2.12.3 (CLI 2.12.2), ESLint 10.12.0. Exact direct versions and lockfiles are recorded with the source.

**Spec:** `docs/migration-spec.md`; IPC DTOs: `src/domain/contracts.ts`.

## Global constraints

- Preserve existing capabilities, saved project formats, offline operation and the current visual design.
- Domain logic independent of Tauri; no duplicate TypeScript algorithms.
- Narrow local capabilities; work off the UI thread; no fine-grained per-frame IPC.
- Ship a Windows distributable and exercise its installation lifecycle.

## Review focus

- Invalid imports and rapid asynchronous edits must retain the last valid machine and latest edit.
- Unicode whitespace/codepoint handling and omitted initial word outputs must match fixtures.
- Unchanged generated text must not rebuild a graph or erase inactive outputs.
- Close/restart must preserve invalid manual drafts and unfinished graphs.
- Hidden/unmounted components must release observers, frame callbacks and graphics resources.

## Task 1: Baseline and compatibility oracle

Files: `tests/fixtures/*`, `artifacts/migration/*`, `docs/verification.md`.

- [x] Inspect source, desktop integration, tests and documentation; no applicable AGENTS or Git history.
- [x] Capture parser, simulation, conversion and graph compatibility fixtures before changing algorithms.
- [x] Measure 256-state/512-transition, 4096-character parse/simulate/convert baseline (500 samples).
- [ ] Run production visual and behavior baseline; record the existing CSS blur failure and its correction.

## Task 2: Independent Rust domain

Files: `crates/patchbay-core/{src,tests}`, root `Cargo.toml`, `rust-toolchain.toml`.
Interface: `execute(DomainRequest) -> Result<DomainResponse, DomainError>` matches the TypeScript DTOs. Public pure parse/simulate/convert/graph functions allow direct parity tests.

- [ ] Add failing parity tests against the captured fixtures.
- [ ] Implement parser/validator/simulation/conversion/serialization and graph operations; validate all incoming data and bounds.
- [ ] Pass Rust parity, format, clippy and edge/scale tests; produce release benchmark results.

## Task 3: React rendering and graphical editor

Files: `src/rendering/*`, `src/editor/*tsx`, `src/playback/*`, `src/motion/*`.
Interfaces: React components accept typed immutable DTOs, preferences/frame clock and application callbacks. Graph edits emit semantic `GraphEdit` commands; drag previews stay local and commit once. Playback accepts Rust traces and only advances presentation state.

- [ ] Render state/edge labels and graph controls with React; preserve drawing, history, selection, viewport and accessibility behaviors.
- [ ] Isolate Canvas/WebGL drawing with disposal, context loss and shared clock management.
- [ ] Verify geometry, playback, keyboard focus priority and lifecycle cleanup.

## Task 4: Application state and Tauri desktop shell

Files: `src/app/*`, `src/components/*`, `src/domain/client.ts`, `src-tauri/*`, frontend build/lint config.

- [ ] Implement focused React Bench/library/learn/drawers and one authoritative application reducer/controller.
- [ ] Implement one batched domain command using bounded workers, narrow desktop commands, native file/screenshot and compatible durable session migration.
- [ ] Preserve directional motion, theme wave, preferences, trace windowing and all shortcuts.
- [ ] Run actual Windows WebView2 frontend-to-Rust UI workflows, error paths and offline checks.

## Task 5: Verification, retirement and delivery

Files: `scripts/*`, `tests/*`, `docs/*`, dependency lockfiles and distributables.

- [ ] Pass frontend type/lint/build/unit/UI checks, cargo fmt/clippy/tests and native end-to-end flows.
- [ ] Compare actual performance/size measurements and inspect the production visuals.
- [ ] Build NSIS and portable artifacts; verify install, launch, uninstall, reinstall and desktop shortcut.
- [ ] Remove verified-obsolete Electron/domain/UI code and dependencies; rerun required checks after removal.
- [ ] Update architecture/setup/testing/packaging/verification documentation and commit source plus dependency lockfiles locally.
