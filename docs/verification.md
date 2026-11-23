# Patchbay 2 verification

This report covers the React/TypeScript, Rust and Tauri migration and the earlier solid-theme revision. It also explains how to verify the current Night & Pearl design (the two-theme successor to Lumen, `DESIGN.md`). That covers Inter Variable, Newsreader and IBM Plex Mono type, the Night and Pearl palettes with a themed signal, the theme wave, the launch, native-refresh pacing, Liquid Glass-inspired chrome over a WebGL2 field, and a Windows 11 Mica frame with an opaque fallback. Test reports are local artifacts under `artifacts/`; commands and test sources are committed with the project.

## Baseline

The original Electron/TypeScript source was captured in the initial Git commit and `.cache/migration-baseline`. Behavioral fixtures were captured before replacing algorithms: 26 machines, 180 runs, 14 invalid definitions, all 11 presets, conversion conventions and version-1 graph files. Additional frozen machine DTOs exercise frontend geometry without retaining a second parser.

The original frontend had 162 distinct unit tests. An early baseline invocation reported 324 because it also discovered the copied tests under `.cache`; the current test configuration excludes that copy. A production CSS alias ordering issue prevented backdrop blur and was corrected before migration. The old solid-panel screenshot comparison still failed despite correct computed styles; it is historical evidence, not a pass. The user subsequently requested removal of glass and the 3D background, and on 2026-10-29 asked for them back in an Apple Liquid Glass direction. The current Lumen contract still keeps every reading and editing surface opaque. Glass is limited to navigation chrome over the field (title bar, sidebar, docked drawer) and three small blurs over content (tape overflow, toast and scrolled Machines heading).

## Automated checks

Run `npm run check`, `npm test`, `npm run build`, `npm run check:bundle`, `npm run test:rust`, `npm run test:browser`, `npm run desktop:debug`, `npm run test:ui`, `npm run test:appearance`, `npm run test:session`, `npm run test:launch` and `npm run test:refresh`. Native tests exercise the real Windows WebView2 → Tauri → Rust boundary and real native file dialogs. Frontend browser harnesses isolate canvas lifecycle, drawing interactions and large-machine viewport behavior; they do not substitute for native IPC tests.

Run `cargo fmt --all -- --check`, `cargo clippy --workspace --all-targets --locked -- -D warnings`, and `cargo test --workspace --all-targets --locked`. The independent core includes the frozen parity oracle. Desktop tests cover bounded UTF-8 reads, complete atomic writes, concurrent reads/writes, recovery backups, session round trips and read-only migration from a private copy of Electron LevelDB data.

### Native suites in both window modes

On Windows 11 the debug app creates a transparent window and applies Mica; with `PATCHBAY_OPAQUE=1` it creates an ordinary opaque window, as on Windows 10. `tests/helpers/native.mjs` passes the variable to the app only when it is `1`, and the appearance suite checks that the material the app reports matches the mode. Run each suite once in each mode. These commands need Node, Cargo and the installed `node_modules`, but not npm. The Tauri CLI is skipped because its `beforeBuildCommand` runs npm; `cargo build` still embeds `dist` because `custom-protocol` is a default feature of `patchbay-desktop`.

```powershell
node node_modules/typescript/bin/tsc --noEmit
node node_modules/vite/bin/vite.js build
node scripts/check-bundle.mjs
node scripts/cargo.mjs build -p patchbay-desktop --locked

# Mica frame (Windows 11)
node tests/native-ui.mjs
node tests/native-appearance.mjs
node tests/native-session.mjs
node tests/native-launch.mjs
node tests/native-refresh.mjs

# Opaque window
$env:PATCHBAY_OPAQUE = '1'
node tests/native-ui.mjs
node tests/native-appearance.mjs
node tests/native-session.mjs
node tests/native-launch.mjs
node tests/native-refresh.mjs
Remove-Item Env:PATCHBAY_OPAQUE
```

In Git Bash, prefix each opaque command instead: `PATCHBAY_OPAQUE=1 node tests/native-ui.mjs`. Reports and screenshots from the opaque run carry an `-opaque` suffix in `artifacts/migration/`, so both runs are kept. On Windows 10 both runs exercise the opaque window.

`PATCHBAY_OPAQUE=1` changes only the window material. The WebGL field is opaque and runs in both modes, so each run also exercises the field and the shader-drawn glass.

`tests/helpers/native.mjs` stops any `Patchbay.exe` still running from this checkout's `target` folder before its first launch. It passes `PATCHBAY_LAUNCH` only when a suite asks for a launch. Debug runs with a test data directory otherwise start with the launch off. After load it sets `html[data-theme-instant]`, so theme switches and screenshots never wait for the wave. Only the appearance and refresh suites turn the wave back on. The native-session Save dialog check can flake once on a cold build; rerun it before diagnosing.

### What the glass and field checks cover

| Area                | Where                      | What is asserted                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------- | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tokens and contrast | `check-bundle`             | Every built token matches `src/reference.css`. Text pairs reach 4.5:1 on opaque surfaces. Title bar and sidebar glass are measured over the shader clamp (L 0.06 dark, 0.55 light), the static field and frame tint over the worst wallpaper. Floating glass is measured over black and white. Non-text strokes, focus and the signal step reach 3:1. The instrument plate is themed: every plate token differs between Night and Pearl.                                                                                   |
| Glass allow-list    | `check-bundle`, appearance | Only `.titlebar`, `#rail`, `#drawer[data-mode=docked]`, `#toast`, `.library .view-heading[data-scrolled]` and `.tape-overflow::after` may blur. Each blur is 20px or less through a `--*filter*` token. Each surface is painted with an audited glass token and resets to `none` under reduced transparency, low quality, high contrast, both media queries and `data-capture`. The over-field three also reset under `data-bg=webgl`. No blur may touch `.patch-panel`, `#diagram` or `.graph-stage` at any tested width. |
| Rendered legibility | appearance                 | With the cursor light parked on the chrome and the labels hidden, a CDP capture is read under each title bar and sidebar label. Every text colour must reach 4.5:1 against the worst pixel, in both themes.                                                                                                                                                                                                                                                                                                                |
| Field               | appearance, UI, session    | `data-bg` is `webgl` or `static` by default, also under `PATCHBAY_OPAQUE=1`. It is `off` under reduced transparency (switch or emulated media query) and high contrast, and `static` at low quality. The canvas is fixed, `aria-hidden`, unfocusable and pointer-transparent, and never under a control centre. WebGL pixels are opaque and not black, and stay under the dark cap. `data-bg-fps` reaches 0 while idle under reduced motion. `data-capture` hides the canvas, and it returns after a real screenshot.      |
| Keyboard            | appearance, UI             | Rail Enter, E and ? routes are in place on the next frame, with no page animation running.                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Layout              | appearance                 | No page overflow at 360–2560px. The rail is a five-item tab bar at 719px and narrower. The drawer docks as glass at 1200px and wider and is a solid, non-modal overlay below. The 1366×768 transport fits.                                                                                                                                                                                                                                                                                                                 |
| Fonts               | `check-bundle`, appearance | Local `@font-face` rules for Inter Variable and IBM Plex Mono, byte-identical WOFF2 files and OFL texts, no remaining IBM Plex Sans, and both faces loaded in WebView2.                                                                                                                                                                                                                                                                                                                                                    |

The session suite checks that a saved screenshot has no transparent pixels and that its titlebar is not a flat black band.

### What the Night & Pearl checks add

| Area                | Where                      | What is asserted                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------- | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Palettes            | `check-bundle`             | Both themes define every token as opaque hex where audited. Text pairs reach 4.5:1 on mask, deep, solid, hover, selected and active. The exception is `--faint` on `--active`, which DESIGN.md forbids. Neutral selection (`--on-select` on `--select`), `::selection`, `--brand-pressed`, the quiet title tone, the round keys' ink on both gradient stops and the Space chip on Play (at rest and hover) reach 4.5:1. No text token is #0070D1, which is 4.27 on the Pearl mask. Plate tokens are defined and differ in both themes. Pearl's idle ink keeps L ≤ 0.0207 and its plate is no darker than #F5F6F9, and the plate fault colour is audited. No `rgb()`/`rgba()`/`hsl()` literal remains in `src/**/*.css` outside `reference.css`. |
| Fonts               | `check-bundle`, appearance | Newsreader 400 (`font-display: block`) is local and byte-identical, with its OFL text in `dist/licenses` and the release; `--serif` leads with it. In WebView2 the face loads and `#machine-title` is Newsreader 400 at ≥ 28px, identical in both themes.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Launch stage        | `check-bundle`, launch     | `<style id="launch-css">` is inline, without blur, hidden by `html[data-capture]` and forced colours; the stage is the first body child; `theme-color` is #0C0D0D. Natively: the first 100ms after first paint stay within 0.35 relative luminance of the theme mask (Night and Pearl); full, short and still timings; Space skips within one frame and still plays; a click reaches Step under the stage; `data-capture` hides it; `launchSeen` is recorded; launch animation off removes it; reduced motion animates opacity only.                                                                                                                                                                                                            |
| Theme wave          | appearance                 | View transition with a 1,200–1,800ms clip, foam canvas only while it runs, `--motion-theme` 0ms, label and `aria-pressed` flip on the press. Mid-wave the live page equals the settled Pearl surfaces. Under Mica the frame paints solid `--mask`. Filmed frames show the button side Pearl first and the far corner last. `set_theme` is sent after the clip finishes and before Mica returns. A second press reverses it (playback rate ≤ −1.5). A click on Step and the R key end it and still land. Reduced motion cross-fades in ≤ 350ms.                                                                                                                                                                                                  |
| Native refresh rate | refresh                    | Startup `display.refreshHz` equals `Win32_VideoController.CurrentRefreshRate`. At default quality, with the pointer moving, the field and the frame clock run within 5% of it, and so does each wave. The idle field reports 0 fps within 3s. Settings › Frame rate defaults to "Match display · N Hz", and the 60 fps choice holds 60 ± 5%. `#metric-hz` shows the detected rate.                                                                                                                                                                                                                                                                                                                                                              |
| Plate repaint       | renderers (Edge)           | Pearl and Night produce different Canvas ink; switching back restores the Pearl ink pixel for pixel.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

#### Input policy for the launch and the wave

- **Launch.** The stage is `pointer-events: none` and never stops or cancels an event. The first keydown, pointer press, wheel or touch (capture, passive) sets `data-launch="skip"`, which hides the stage on the next frame. The same event then reaches its target: Space plays and a click on Step steps. A click during the opaque early phase lands on a control the user cannot see yet. This is deliberate, because input is never lost, and the stage is already hidden when the press completes. Pointer movement does not skip. A key pressed before React mounts has no handler with or without the launch.
- **Wave.** Chromium routes pointer events to `<html>` during a view transition. A second press on the theme button reverses the wave. Any other pointer press ends the wave at once on the new theme and is re-dispatched to the element under the pointer. A drag started mid-wave must be started again. Keys end the wave and reach their handlers. Wheel ends it and replays the notch to the scroller under the pointer. Enter or Space on the theme button plays the wave; this is the one recorded exception to the instant-keyboard rule (DESIGN.md › Motion). A hidden window or `html[data-capture]` ends the wave.

#### Bundle budget (2026-10-30)

The total-asset budget is raised a third time, to the measured build plus 6 KB, rounded up to the next 1,000 bytes and capped at 600,000 bytes. The justification, also in `scripts/check-bundle.mjs`: Newsreader 400 latin (22,480 B WOFF2 + 4,520 B OFL) for the user-pinned serif display type; the theme wave (View Transition + compositor clip, about 8.4 KB) and the launch (inline CSS, no extra script) requested by the user; native-refresh pacing. No library was added, and the 150,000-byte gzip JavaScript budget is unchanged. Measured on 2026-10-30 before native integration: 599,628 bytes total (Newsreader 22,480; its OFL text 4,520; `index.html` with the inline launch CSS about 10 KB), 132,658 bytes gzip JavaScript. Measured plus 6 KB exceeds the cap, so the budget is 600,000 with only 372 bytes of headroom. The next change that adds bytes must first remove some. The backdrop-filter allow-list stays at exactly six surfaces and every built stylesheet, including lazily linked chunks, is scanned.

#### WebView2 frame rate

Chromium paces `requestAnimationFrame` and the compositor at the monitor's vsync; WebView2 adds no cap. The wave prototype measured 144.9 fps over 232 frames with none missed, in Edge 156 on this 144 Hz panel at 1440×900 and 2560×1440. Edge 156 is the engine WebView2 uses. Patchbay therefore sets no `additionalBrowserArgs`. The 30 fps cap the field applied at medium quality in Lumen (Lumen results below) was the app's own choice and has been removed. If `tests/native-refresh.mjs` ever shows a visible window throttled, the bounded fallback is `--disable-renderer-backgrounding --disable-background-timer-throttling`, appended to wry's default `--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection`. `--disable-frame-rate-limit`, `--disable-gpu-vsync` and `--disable-gpu` are never used. Occlusion (a minimised or fully covered window reporting `document.hidden`) is kept as a legitimate pause. Record the native measurements of both window modes in the results table when the suites run.

### Lumen results (2026-10-29)

Measured on this Windows 11 x64 host (WebView2 156, 143–145 Hz display) in both window modes, after integration.

| Check                             | Result                                                                                                                                                                                                                                                                                                             |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| TypeScript; ESLint                | Passed. `.work/` and `.taste-skill/` scratch folders are ignored.                                                                                                                                                                                                                                                  |
| Frontend unit tests               | 58 passed in 7 files                                                                                                                                                                                                                                                                                               |
| Rust workspace tests              | Passed                                                                                                                                                                                                                                                                                                             |
| Edge graph and diagram suites     | Passed                                                                                                                                                                                                                                                                                                             |
| Native UI, session and appearance | Passed in both the Mica and the `PATCHBAY_OPAQUE=1` run, with no deferred failures. A fresh session opens dark; the Bench dock ends at y 754 at 1366×768.                                                                                                                                                          |
| Rendered chrome text              | 66 samples per mode; worst 5.77:1 (`--faint` status text, light)                                                                                                                                                                                                                                                   |
| Token contrast audit              | All pairs pass. Worst glass over the field is 5.58 dark and 5.01 light; worst floating glass is 4.72 (faint on docked sheet over white).                                                                                                                                                                           |
| Bundle                            | 125,564 bytes gzip JavaScript of 150,000; 539,990 bytes total of the raised 544,000. The build targets Chromium 120, so Lightning CSS no longer emits `-webkit-` copies, and the Plex licence no longer carries the retired Plex Sans section.                                                                     |
| Field                             | rAF p50/p95 6.9/7.1 ms at 1440×900 and 2560×1440 on both the RTX 4050 and the Intel UHD (`--force_low_power_gpu`), medium and high, with the pointer moving. Medium draws at 29 fps (30 fps cap), high at the display rate. It drops to 0 fps when idle and under reduced motion, and is `static` at 0 fps on low. |

`prefers-reduced-transparency` could not be emulated through CDP in this WebView2. That path is covered by the Window material switch and by the CSS audit.

### Recorded results

The results below predate the current design; rerun both modes to verify it. Verified on Windows x64 on 2026-10-24, with the panel, direct-drawing and AppData fixes verified on 2026-10-26:

| Check                                    | Result                                                                                                                                                                                 |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TypeScript and ESLint                    | Passed, no errors or warnings                                                                                                                                                          |
| Frontend unit tests                      | 35 passed in 5 files                                                                                                                                                                   |
| Rust format, Clippy with warnings denied | Passed                                                                                                                                                                                 |
| Rust workspace tests, all targets        | 56 passed: 27 core and 29 desktop                                                                                                                                                      |
| Real Edge graph harness                  | Passed pointer, connect, forms, keyboard, rollback, undo, idle, remount and mobile checks                                                                                              |
| Real Edge diagram harness                | 9 passed, including 256-state rendering and 10 StrictMode cleanup cycles                                                                                                               |
| Native UI                                | 10 passed; all 11 presets, Unicode, conversion, direct drawing, editing, playback, keyboard and invalid inputs; zero renderer errors or external requests                              |
| Native appearance                        | 9 passed; both palettes, local font, keyboard navigation, reduced motion, temporal color interpolation, persistent workspace behind panels, trace scrubber and themed scrollbars       |
| Native files and persistence             | 9 passed; native text/graph round trips, PNG screenshot, cancel, restart, invalid draft recovery, 256 states/512 transitions/4096 inputs and repeated close during a delayed real save |

Appearance checks cover Bench, Editor, Machines and Learn at widths 360, 768,
1024, 1366, 1920 and 2560 CSS pixels without horizontal page overflow. The Bench
transport fits a 1366×768 viewport. Smaller windows scroll vertically rather than
shrinking labels and controls below readable sizes. Settled text and primary
button color pairs meet 4.5:1 in the built palette audit; disabled controls,
transient interpolation and decorative borders are outside that audit. These
checks do not claim a complete accessibility certification.

Native screenshot testing caught xcap excluding its own process. A private,
short-lived capture process now returns only the app window's PNG; the native
dialog test saves and checks that image. Session testing also verifies that
the last valid machine remains runnable while an invalid draft is recovered.

Installed-release testing exposed Windows AppData virtualization redirecting newly
created temporary files to a different drive while the existing parent directory
remained on C:. Both save and recovery now resolve the created file's physical
location before atomic publication. Regression tests exercise new directories and
pre-existing AppData parents, first saves, overwrites and recovery reuse. These
failures were caught during delivery and are distinct from the historical baseline
visual failures above.

## Performance boundaries

The core benchmark uses a 256-state, 512-transition machine with 4096 input characters, 50 warmups and 500 samples. See `crates/patchbay-core/validation-report.md` for measured p50/p95 values. Rust measurements include validation and remain slower than the captured TypeScript microbenchmark on this host. They exclude IPC and UI latency; no algorithm speedup is claimed.

Removing the background changes the visual workload, so current frame timings cannot establish a rendering-only migration speedup against the previous glass scene. Package and installed-directory sizes are measured separately from Microsoft's shared WebView2 runtime.

## Windows delivery

`npm run dist:windows` produces the NSIS installer, portable ZIP and SHA-256 manifest. Static package verification proves inventory/hash consistency. Runtime install, launch, uninstall and reinstall evidence is recorded separately; compilation or an unpacked directory alone does not establish delivery.

The final 2.0.0 package passed `node tests/install-lifecycle.mjs` on 2026-10-26:

- Installed the NSIS package in an isolated directory and ran the real React → Tauri → Rust Unicode simulation.
- Closed normally after saving, uninstalled, reinstalled the same payload and repeated the runtime check, then uninstalled the temporary copy.
- Upgraded `%LOCALAPPDATA%\Programs\Patchbay`, restored the user's session, repeated the runtime check and verified the desktop shortcut.
- Retained the previous Electron directory at `%LOCALAPPDATA%\Programs\Patchbay-Electron-backup`. Original personal data and project files were not removed.

Evidence: `artifacts/migration/installation-report.json`, `artifacts/package-report.json`
and `release/2.0.0/release-manifest.json`. The installed executable matches the
portable executable except for Tauri's documented three-byte bundle-type marker
(`UNK` for portable, `NSS` for NSIS); the lifecycle test verifies every other byte.
The installed copy was also inspected with Settings and Trace open: the workspace
and navigation remain visible, trace controls render, navigation works through the
open panel and renderer errors remain zero. Screenshots and the result are retained
in `artifacts/migration/installed-{settings,trace}.png` and `installed-ui-report.json`.

| Final artifact                                           |       Bytes |
| -------------------------------------------------------- | ----------: |
| `release/2.0.0/Patchbay-2.0.0-Setup-x64.exe`             |   2,483,430 |
| `release/2.0.0/Patchbay-2.0.0-Windows-x64.zip`           |   3,464,336 |
| Native executable                                        |   9,658,880 |
| Installed application, including notices and uninstaller |  12,155,456 |
| Previous Electron application directory                  | 335,006,020 |

The installed size excludes the shared WebView2 runtime, personal data and the
retained Electron backup. The new renderer is 434,642 bytes uncompressed with
104,050 bytes gzip JavaScript and passes the committed bundle budgets. These are
size measurements, not startup, memory or animation-latency speedup claims.

The installer is unsigned and requires an already installed WebView2 Evergreen
Runtime. Verification used this Windows x64 host; a separate clean Windows VM and
signed distribution were not available. The app remains fully usable offline.
