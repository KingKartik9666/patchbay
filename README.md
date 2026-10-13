# Patchbay

A local Electron workbench for Mealy and Moore machines, with graphical and manual editors. Its black-and-white interface uses rounded text, clear borders, directional motion and a watery theme-switch wave, informed by [We Evolve It](https://weevolveit.com/) and [React Bits](https://github.com/DavidHDev/react-bits).

Open `release/Patchbay-win32-x64/Patchbay.exe` after packaging. Keep the executable beside its accompanying files. No server, account or internet connection is required.

## Development

Node 24 or newer and npm are required.

```sh
npm ci
npm run dev
npm run build
npm start
npm test
npm run test:ui
npm run test:graph
npm run test:scale
npm run test:motion
node scripts/smoke-electron.mjs
node scripts/check-bundle.mjs
npm run package
node scripts/check-package.mjs
node scripts/smoke-electron.mjs release/Patchbay-win32-x64/Patchbay.exe
```

The browser-only development preview is `npm run dev:web`. UI tests use installed Microsoft Edge in headless mode; native tests keep Electron windows hidden and use a separate test profile.

## Use

Choose one of eleven presets from Machines, or open Editor to draw a machine. The library includes binary, decimal, multi-variable and event-based problems. Load input, then play, step, seek on the tapes or click a trace row. The Trace drawer has its own playback controls.

In Editor, double-click empty space or use **+ State**, then drag states to arrange them. With **Connect**, drag between states or click a source followed by a target; use the same state twice for a self-loop. Set the arrow's input/output in the inspector. Click a state to rename it, set it as the start state, or edit its Moore output. Click an arrow label to edit or delete it. **+ Transition** provides the same controls without drawing gestures.

Enter symbols separated by spaces in **Input alphabet**. Digits, Unicode symbols and whole tokens work: `00 01 10 11` represents two binary variables; `coin push` represents named events. Each state has one outgoing transition per input. Incomplete drawings can be saved and restored; **Run machine** explains missing transitions and outputs before applying a drawing. **Fill missing self-loops** explicitly completes a table. Undo/redo retains 50 edits, and **New machine** is undoable.

**Save draft** writes a `.patchbay` file including positions and unfinished edits. Drafts also recover locally across restarts. **Open** accepts graph files or valid text definitions. **Text definition**, or **Text** on the Bench, opens the manual editor. Complete changes preview after 250 ms; closing sooner applies valid changes. Unfinished text survives closing and restart while the last valid machine remains runnable. Reading an unchanged drawing's text does not alter its saved positions or inactive outputs.

Mealy writes on each transition. Moore writes from the destination state and includes the start state's output by default. Settings can omit that initial output. Mealy produces n outputs; Moore produces n + 1 with the initial output. These transducers have no accepting states: the input's end halts the run.

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
# Moore: define each state's output, then from input to
type moore
start A
out A 0
out B 1
A 0 A
A 1 B
B 0 A
B 1 B
```

Inputs and outputs are nonempty Unicode tokens without whitespace or `#`, separated by whitespace in definitions. `#` begins a comment. In the Bench, alphabets containing multi-character tokens use spaces between inputs, for example `11 01 10 00` or `coin push coin`. Single-character alphabets retain compact input such as `1101` or `290846`. Word outputs have space-separated boundaries. Every state must define every input, and every Moore state needs an output. The parser reports line numbers; simulation halts cleanly on an incomplete transition table.

The presets are both 11 detectors, one's complement, two's complement, parity, modulo 3, Decimal Echo, a 101 detector, a two-variable full adder, a turnstile controller and a vending machine. The adder reads bit pairs least significant first; append `00` to emit the final carry. Moore-to-Mealy conversion drops the initial output. Mealy-to-Moore conversion splits states and adds an initial 0; omit it in Settings to compare the runs. The Bench's Mealy/Moore buttons convert the current machine. Changing **Type** inside the drawing editor changes where outputs are assigned.

There is no fixed limit on state, transition or alphabet counts. Diagrams scroll inside the stage and both canvases stay the size of the visible viewport. Large builds skip long formation animations. Actual capacity depends on memory and graph complexity. Inputs are capped at 4,096 UTF-16 characters and machine files at 1 MiB in browser and Electron. Trace rows and tape cells are windowed for long runs.

Text supports `state NAME` and `alphabet SYMBOL...` declarations, so isolated states and the intended input alphabet can be written explicitly. `type`, `start`, `out`, `state` and `alphabet` are reserved state names. Whitespace and `#` are reserved in text definitions.

## Keyboard

| Key | Action |
| --- | --- |
| Space | Play / pause |
| Right / Left | Step / step back |
| R | Reset |
| B | Replay diagram build |
| E | Open graphical editor |
| Ctrl+Z / Ctrl+Shift+Z | Undo / redo in graphical editor |
| Delete | Delete selected state or arrow in graphical editor |
| F | Focus mode |
| Q | Cycle quality |
| ? | Learn view |

Arrow keys move focus through the navigation rail. Editing inputs retains normal keyboard behavior. States have accessible labels describing their transitions, and a polite live region narrates playback.

## Performance and diagnostics

The renderer uses Canvas2D, ordinary DOM and the browser's Web Animations API, without an animation library or WebGL. One frame loop drives playback, dirty diagram updates and the temporary theme wave. Ambient board/particle effects are removed. A theme change inverts actual text pixels as the wave crosses each letter, then commits the inverse palette; page changes use directional entrances. Blur runs only during motion and can be disabled in Settings. Reduced motion skips both travel and the theme wave; hidden windows pause playback and the frame loop.

Local frame diagnostics appear in Settings and with `?debug`. The governor lowers render quality and transparency under sustained slow frames. No telemetry is sent. The user chose local diagnostics because no Sentry project was configured.

Build and test measurements live in `artifacts/bundle-report.json` and `artifacts/ui-report.json`. Hidden/headless measurements do not prove target-laptop 120 Hz performance or GPU compositing limits. Native-refresh profiling, Firefox/Safari verification and an optional worker renderer remain platform-specific follow-up work. The Electron runtime accounts for most of the portable folder's size; the application payload is small.

Version 1.2 has 162 unit tests, plus browser and native Electron checks. Coverage includes all eleven presets, all 256 pairs of four-bit adder operands, token conversion, graphical editing, manual draft recovery, 256-state graphs and spatial theme-wave pixels. The renderer has about 40 KB of gzipped JavaScript and 224 KB of total assets. Electron accounts for most of the roughly 335 MB portable folder. Packaging omits development dependencies and unused Chromium language files. Reports record exact sizes and source-to-package hash verification.

Nunito is bundled locally with its OFL license; there are no runtime font requests. Dependency versions and the lockfile are pinned. Reference capture and adaptation details are in `docs/reference-style.md`. The ui-reverse-engineering plugin's automatic clone pipeline is unavailable; the reference was inspected with Playwright, and no pipeline verification pass is claimed.
