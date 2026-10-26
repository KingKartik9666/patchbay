# Patchbay 2 verification

This report describes the React/TypeScript, Rust and Tauri migration and the subsequent minimal solid-theme revision. Test reports are local artifacts under `artifacts/`; commands and test sources are committed with the project.

## Baseline

The original Electron/TypeScript source was captured in the initial Git commit and `.cache/migration-baseline`. Behavioral fixtures were captured before replacing algorithms: 26 machines, 180 runs, 14 invalid definitions, all 11 presets, conversion conventions and version-1 graph files. Additional frozen machine DTOs exercise frontend geometry without retaining a second parser.

The original frontend had 162 distinct unit tests. An early baseline invocation reported 324 because it also discovered the copied tests under `.cache`; the current test configuration excludes that copy. A production CSS alias ordering issue prevented backdrop blur and was corrected before migration. The old solid-panel screenshot comparison still failed despite correct computed styles; it is historical evidence, not a pass. The user subsequently requested removal of glass and the 3D background, so the current visual contract is solid surfaces and the two accent palettes.

## Automated checks

Run `npm run check`, `npm test`, `npm run build`, `npm run test:browser`, `npm run desktop:debug`, `npm run test:ui`, `npm run test:appearance`, and `node tests/native-session.mjs`. Native tests exercise the real Windows WebView2 → Tauri → Rust boundary and real native file dialogs. Frontend browser harnesses isolate canvas lifecycle, drawing interactions and large-machine viewport behavior; they do not substitute for native IPC tests.

Run `cargo fmt --all -- --check`, `cargo clippy --workspace --all-targets --locked -- -D warnings`, and `cargo test --workspace --all-targets --locked`. The independent core includes the frozen parity oracle. Desktop tests cover bounded UTF-8 reads, complete atomic writes, concurrent reads/writes, recovery backups, session round trips and read-only migration from a private copy of Electron LevelDB data.

Verified on Windows x64 on 2026-10-24, with the panel, direct-drawing and AppData fixes verified on 2026-10-26:

| Check | Result |
| --- | --- |
| TypeScript and ESLint | Passed, no errors or warnings |
| Frontend unit tests | 35 passed in 5 files |
| Rust format, Clippy with warnings denied | Passed |
| Rust workspace tests, all targets | 56 passed: 27 core and 29 desktop |
| Real Edge graph harness | Passed pointer, connect, forms, keyboard, rollback, undo, idle, remount and mobile checks |
| Real Edge diagram harness | 9 passed, including 256-state rendering and 10 StrictMode cleanup cycles |
| Native UI | 10 passed; all 11 presets, Unicode, conversion, direct drawing, editing, playback, keyboard and invalid inputs; zero renderer errors or external requests |
| Native appearance | 9 passed; both palettes, local font, keyboard navigation, reduced motion, temporal color interpolation, persistent workspace behind panels, trace scrubber and themed scrollbars |
| Native files and persistence | 9 passed; native text/graph round trips, PNG screenshot, cancel, restart, invalid draft recovery, 256 states/512 transitions/4096 inputs and repeated close during a delayed real save |

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

| Final artifact | Bytes |
| --- | ---: |
| `release/2.0.0/Patchbay-2.0.0-Setup-x64.exe` | 2,483,430 |
| `release/2.0.0/Patchbay-2.0.0-Windows-x64.zip` | 3,464,336 |
| Native executable | 9,658,880 |
| Installed application, including notices and uninstaller | 12,155,456 |
| Previous Electron application directory | 335,006,020 |

The installed size excludes the shared WebView2 runtime, personal data and the
retained Electron backup. The new renderer is 434,642 bytes uncompressed with
104,050 bytes gzip JavaScript and passes the committed bundle budgets. These are
size measurements, not startup, memory or animation-latency speedup claims.

The installer is unsigned and requires an already installed WebView2 Evergreen
Runtime. Verification used this Windows x64 host; a separate clean Windows VM and
signed distribution were not available. The app remains fully usable offline.
