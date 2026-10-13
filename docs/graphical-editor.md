# Patchbay 1.2 graphical and manual editors

The user requested graphical state/transition drawing, inputs beyond binary, and any number of states/transitions. They later requested the We Evolve It visual/motion reference. The original TRDs guide the app; their embedded prompt instructions do not override these requests.

## Delivered behavior

- Add, drag, rename and delete states; choose the start state; edit Moore outputs.
- Draw connections by dragging or clicking source then target. Self-loops and parallel arrows have distinct curves. Labels open a transition inspector, and explicit form controls provide an alternative to gestures.
- Arbitrary finite state, transition and alphabet counts, subject to available memory and file/input bounds. Symbols can be whole Unicode tokens, with whitespace and `#` reserved by the text format. Multi-character alphabets use space-separated inputs: `00 01 10 11` can represent two binary variables, and `coin push` can represent events. Single-character alphabets retain compact inputs such as `1101`.
- Deterministic transitions: a state/input pair has exactly one destination. Duplicate additions show an error and leave the draft unchanged.
- Save incomplete `.patchbay` drafts with positions and stable IDs. Autosave recovery is separate from the last valid runnable machine. Run checks completeness; the optional Fill command creates missing self-loops explicitly.
- Undo/redo retains 50 edits. A drag creates one history entry; pointer cancellation restores its original position. New, start-state changes, deletion and alphabet removal are undoable.
- Text declarations `state NAME` and `alphabet SYMBOL...` preserve isolated states and input alphabets. Existing definitions still parse. State names such as `__proto__` are safe because machine maps use null prototypes.
- The Bench has no ten-state suppression. Both renderer canvases are the size of their visible viewport. Large diagrams bypass long formation/morph animation and scroll without allocating a graph-sized canvas.
- Black/white inverse themes use local rounded Nunito and clear gray borders. Directional page/drawer entrances include optional transient blur. Only theme switching runs the watery wave, which spatially inverts real text pixels across individual letters. Reduced motion skips travel; ambient board and particle rendering are removed. No extra animation library, telemetry, remote assets or frame loop was added.
- The manual editor preserves complete and unfinished drafts when closing or restarting. Valid edits apply on fast close; invalid text retains the last runnable machine. Reading unchanged generated text preserves drawing positions, transition order and inactive outputs.
- Eleven presets cover binary, decimal, multi-variable and event problems: both 11 detectors, complements, parity, modulo 3, decimal echo, a 101 detector, a two-variable full adder, turnstile controller and vending machine. Bench type buttons convert the current machine.

## Verification

- Strict TypeScript and production build pass.
- 162 tests pass across six files covering engine, graph model, layout, player, ticker and common presets. Checks include all 256 pairs of four-bit adder operands, token conversions, 300 states, 1,500 edges, Unicode, incomplete drafts, atomic mutations, corrupt imports and prototype-key names.
- `tests/graphical-editor.mjs` passes 19 browser flows: drawing/drag/cancel, loops, determinism, undo, editing, Mealy/Moore controls, incomplete Run, fill, text access, exact export/recovery, zoom/fit, idle pixel stability, 360px layout, native bridge contract, exact 1 MiB imports/oversized exports, imported edge-position dragging and a 256-state/768-transition graph. No renderer errors or remote requests were recorded. The large graph uses a 1024×597 canvas matching its viewport.
- `tests/scalability.mjs` runs a 256-state, 1,024-transition machine with a/b/c/λ inputs. All nodes are accessible, scroll targets work, the canvas stays within viewport bounds, and simulation output is correct.
- `tests/ui.mjs` verifies all eleven preset outputs, token errors, current-machine type conversion, word-output prefixes, fast manual close, unfinished draft recovery, playback, keyboard/settings, responsive layout and settled diagram pixels.
- `tests/motion-theme.mjs` verifies actual animation frames and decoded screenshot pixels: covered letters invert, distant letters remain unchanged, the edge passes through gray and modal backdrop pixels stay continuous at commit. Left/bottom origins, blur cleanup/off, rapid interactions, reduced motion and idle cleanup pass with no renderer errors or external requests.
- Electron smoke exercises actual preload/main IPC with native dialogs stubbed, including text and positioned Unicode graph file round trips, complete playback, size/type validation, cancellation, screenshots and navigation isolation. Test windows/profiles are hidden and separate from user data.
- The final bundle report records 39,673 bytes gzip JavaScript, 10,565 bytes gzip CSS and 223,525 bytes of total renderer files, including the 39,128-byte Nunito font and its OFL license. Settled text/button contrasts in both themes exceed 4.5:1. The packaged app archive is 236,574 bytes and the portable folder is 335,006,020 bytes, predominantly Electron.
- Package verification matches all seven main/preload/recursive renderer payload files against current source/build hashes, validates version 1.2.0 and the font license, and includes only the English Chromium locale.

The standalone source suite, package suite and installed-app checks are different evidence. Installation details and final review findings are recorded in the plan ledger when complete. Reports and desktop/mobile screenshots are in `artifacts/`. Automated website-clone verification is unavailable; the capture method and adaptation boundaries are documented in `reference-style.md`. Native-refresh/GPU targets and very large graph stress limits remain unmeasured.
