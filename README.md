# Patchbay

smol project for visual learning

An offline Mealy and Moore machine workbench for Windows. React and TypeScript own the interface; an independent Rust library owns parsing, simulation, conversion and graph editing. Tauri 2 supplies the desktop window, native file dialogs and local persistence.

The interface ("Night & Pearl", see [DESIGN.md](DESIGN.md)) is one workbench in two themes, inspired by Apple's Liquid Glass. It does not use Apple's material or fonts, or Sony's branding. **Night**, the default, is near-black with sage-charcoal cards and one soft pistachio accent with a green glow. **Pearl** is a luminous off-white with a PlayStation-style blue and black ink. Both themes share the same layout, shapes, type and motion. A glass title bar and a floating glass sidebar sit over a calm 3D field: jacks and patch cables for the loaded machine, drawn with hand-written WebGL2 and tinted for the active theme. The cursor acts as the field's key light, and the glass rims catch it. The field is atmosphere only. It never takes input, and the 2D diagram, tapes and trace remain the complete interface. Everything you read or edit sits on opaque plates. The live signal is pistachio on a charcoal plate in Night and blue on a pearl plate in Pearl. Text uses local Inter Variable. Large page titles use Newsreader, a local serif. Tape symbols and code use IBM Plex Mono.

The theme button in the title bar switches themes with a slow wave that rolls out from the button for about 1.6 seconds. The sun/moon glyph changes with a springy bounce. Press the button again to roll the wave back; any other click or key ends it at once and still lands. When Patchbay starts, a short burst of colour plays and condenses into the active theme's signal while the workbench loads underneath. The first start of a version shows the full launch (about 2.2 seconds); later starts show a shorter one (under a second). The first key, click, wheel or touch skips it and still reaches its target. **Settings → Launch animation** turns it off.

Every animation runs at the display's native refresh rate, detected for the monitor the window is on (for example 144 fps on a 144 Hz panel). Quality settings trade resolution, not frames. If the GPU falls behind, the field lowers its render scale before it drops frames. **Settings → Frame rate** offers _Match display_ (the default) and 60 or 30 fps power savers. Rendering pauses only while the window is hidden or minimised.

Reduced motion freezes the field to a still frame and replaces the wave and the launch with short cross-fades. Low quality replaces the field with a static gradient. Reduced transparency, high contrast and **Settings → Window material** turn the field off and make every glass surface solid. On Windows 11 the frame behind the field is the desktop's Mica material; elsewhere it is opaque. Keys and playback steps are never delayed by animation. Frame diagnostics stay on the device.

## Run the Windows application

Build the distribution with `npm run dist:windows`. Version 2.0.0 produces:

- `release/2.0.0/Patchbay-2.0.0-Setup-x64.exe`: installer for the current Windows user.
- `release/2.0.0/Patchbay-2.0.0-Windows-x64.zip`: portable application; extract the entire ZIP and open `Patchbay.exe`.
- `release/2.0.0/SHA256SUMS.txt` and `release-manifest.json`: artifact hashes and the build's source inventory.

Windows 10 or 11 x64 and the **Microsoft Edge WebView2 Evergreen Runtime** are required. The application does not bundle Chromium. The installer checks for WebView2 and does not download it. A machine without the runtime needs Microsoft's [Evergreen Standalone Installer](https://developer.microsoft.com/microsoft-edge/webview2/) before installing Patchbay. Once the runtime is present, normal application use needs no account, server, Node installation or internet connection. See [Windows installation and data](docs/distribution.md).

## Development

Use Node **24.20.0 or newer**, npm **11.12.0**, and the Windows MSVC Rust toolchain. `rust-toolchain.toml` selects **1.99.0-x86_64-pc-windows-msvc**, including rustfmt and Clippy. Install Microsoft C++ Build Tools with the desktop C++ workload and Windows SDK, plus WebView2; see the official [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/). Dependency installation and the first toolchain/bundler setup can require internet access.

```powershell
npm ci
node scripts/cargo.mjs fetch --locked
npm run dev
```

`npm run dev` starts Vite and the Tauri desktop app. `npm run dev:web` starts a browser preview of the interface; domain operations and native dialogs require the desktop Rust backend. The preview reports that requirement rather than running a second JavaScript domain implementation.

```powershell
npm run desktop:debug
npm start -- --debug
npm run desktop:build
npm start
```

The desktop build commands embed the compiled renderer and honor `Cargo.lock`. `npm start` launches an existing native build. Shared process wrappers locate the normal Rust and npm installations when a desktop terminal omits them from its inherited PATH.

## Verification and packaging

```powershell
npm run check
npm test
npm run test:rust
npm run build
npm run check:bundle
npm run test:browser
npm run desktop:debug
npm run test:ui
npm run test:appearance
npm run test:session
npm run test:launch
npm run test:refresh
npm run licenses
npm run dist:windows
npm run check:package -- --current-source
```

The browser checks exercise graph and diagram renderers. Native checks use the real debug Tauri app and a separate test session directory; they need WebView2 and a Windows desktop session. On Windows 11, run them twice: once as is (Mica frame) and once with `PATCHBAY_OPAQUE=1` (opaque window). `npm run check:bundle` audits the built theme tokens and text contrast in both themes. Glass over the field is composited over the shader's luminance clamp, the static field and Mica; floating glass is composited over black and white. It also checks the six permitted backdrop blurs and their opaque fallbacks, and the inline launch stage. Other checks cover the field canvas rules, the local Inter, Newsreader and IBM Plex fonts and licences, the absence of colour literals outside `src/reference.css`, and the renderer size budgets. The appearance suite also measures the rendered pixels behind title bar and sidebar labels while the cursor light rests on them, and plays the theme wave. `npm run test:launch` checks the launch's first frames, skipping and variants. `npm run test:refresh` checks that the field, the frame clock and the wave run at the detected refresh rate. `npm run dist:windows` builds the locked release and NSIS installer, includes dependency notices, creates the portable ZIP, and verifies its source snapshot and hashes. `npm run package` is an alias for the same distribution pipeline.

`npm run check:package` checks release integrity without launching the program. Add `-- --current-source` when validating a fresh build against this checkout; without it, later documentation or source edits do not invalidate an unchanged release's hashes. An integrity check does not prove installation, startup, persistence, upgrade or uninstall behavior. Run those lifecycle checks on the resulting installer before sharing a release.

Reports are written under `artifacts/`. Exact renderer and distribution sizes come from `bundle-report.json` and `package-report.json`; they are not fixed claims in this README. The distribution is unsigned unless signing is explicitly configured. See the [Rust core contract](crates/patchbay-core/README.md).

`node tests/install-lifecycle.mjs` exercises the current release installer in an isolated installation directory, uninstalls and reinstalls it, then upgrades `%LOCALAPPDATA%\Programs\Patchbay` and verifies its desktop shortcut. It changes the installed application and should be run as an intentional delivery step with Patchbay closed. The previous Electron application directory is retained as a rollback backup; personal session files are preserved.

## Use

Choose one of eleven presets in **Machines**, or open **Editor** to draw a machine. Load input, then play, step, seek on a tape or click a trace row. The Trace drawer also has playback controls.

In Editor, double-click empty space or use **+ State**, then drag states into place. Drag a state's **+** handle to another state, or activate **+** then choose a target; choose the same state for a self-loop. Arrows save directly using **Draw arrows** defaults: the next unused alphabet input (or a chosen symbol) and a remembered Mealy output. An occupied state/input opens the existing arrow for deliberate editing. **Connect** mode and **+ Transition** remain available. The inspector edits state names, the start state, Moore outputs and transition labels.

Trace shows the current state, accumulated output, next transition, playback controls and a step scrubber above its bounded table. Settings and trace are side panels: they preserve the visible workspace and leave navigation available. Escape closes a panel, including while editing a text field.

**Input alphabet** accepts whitespace-separated tokens or a JSON array. Digits, Unicode and whole tokens work: `00 01 10 11` represents two binary variables; `coin push` represents named events. Incomplete drawings can be saved. **Run machine** explains missing transitions and outputs before applying a drawing. **Fill missing self-loops** explicitly completes a table. Undo/redo retains 50 edits, including **New machine**.

**Save draft** writes a `.patchbay` graph file with positions and unfinished edits. **Open** accepts graph files or text definitions. **Text definition** in the sidebar, or **Text** on the Bench, opens the manual editor. At phone widths the sidebar becomes a bottom tab bar, and Trace and Text open from the Bench. Valid changes preview after 250 ms. Unfinished text and graph drafts recover across restarts while the last valid machine remains runnable. Local sessions are stored at `%APPDATA%\io.patchbay.studio\session.json`; project files are saved only where selected in a native dialog.

Mealy writes on each transition. Moore writes from the destination state and includes the start state's output by default; Settings can omit it. These transducers have no accepting states: the end of input halts the run. Moore-to-Mealy conversion drops the initial output; Mealy-to-Moore splits states and adds an initial `0`.

```text
# Mealy: from input to output
type mealy
start A
A 0 A 0
A 1 B 0
B 0 A 0
B 1 B 1
```

```text
# Moore: define outputs, then from input to
type moore
start A
out A 0
out B 1
A 0 A
A 1 B
B 0 A
B 1 B
```

Definition tokens are nonempty Unicode strings without whitespace or `#`; `#` begins a comment. `state NAME` and `alphabet SYMBOL...` declare isolated states and the intended alphabet. `type`, `start`, `out`, `state` and `alphabet` are reserved state names. Every runnable state must define each input; each Moore state needs an output.

Use spaces between multi-character inputs, such as `11 01 10 00` or `coin push coin`. Single-character alphabets accept compact input such as `1101` or `290846`. Word outputs retain spaces between tokens. The two-variable full adder reads bit pairs least significant first; append `00` to emit the final carry.

Input is limited to 4,096 UTF-16 units and project text/files to 1 MiB UTF-8. There is no fixed state or transition count cap; Rust applies byte budgets to generated graphs, traces and IPC messages. Diagrams use viewport-sized canvases, while tape cells and trace rows are windowed. Capacity and frame times depend on the actual machine and hardware.

## Keyboard

| Key                   | Action                             |
| --------------------- | ---------------------------------- |
| Space                 | Play / pause                       |
| Right / Left          | Step / step back                   |
| R                     | Reset                              |
| B                     | Replay diagram build               |
| E                     | Open graphical editor              |
| Ctrl+Z / Ctrl+Shift+Z | Undo / redo in the editor          |
| Delete                | Delete the selected state or arrow |
| F                     | Focus mode                         |
| Q                     | Cycle diagram quality              |
| ?                     | Learn view                         |
| Escape                | Close an open drawer               |

Editing inputs retain normal keyboard behavior. Theme changes are the one deliberate exception: Enter or Space on the theme button plays the wave, like a click. States expose transition labels and a polite live region describes playback. Settings provide theme, window material, reduced motion, high contrast, launch animation, rendering quality, frame rate and local frame diagnostics. The diagnostics show the detected display rate, the measured frame rate and the field's mode, render scale, frame rate and the reason for any resolution step. High contrast and reduced transparency use opaque surfaces only. Hidden windows pause the shared animation clock, which stops the field too. Diagnostic readings describe the current session and do not guarantee a particular refresh rate.

Inter Variable, Newsreader and IBM Plex Mono are bundled locally with their OFL texts (`licenses/Inter-OFL.txt`, `licenses/Newsreader-OFL.txt`, `licenses/IBM-Plex-OFL.txt`). Patchbay is MIT licensed. Release notices include the locked runtime packages and a conservative Rust dependency inventory; the shared Microsoft WebView2 runtime is installed separately.

## Maintainer

KingKartik (@KingKartik9666)
