# Graphical editor implementation plan

> For agentic workers: implement the tasks below with tested interfaces, then perform a fresh final code review. The user explicitly requested implementation; local design and implementation choices are authorized.

**Goal:** Add a graphical Mealy/Moore editor, support arbitrary finite state/transition counts and nonbinary alphabets, and adapt verified style/motion observations from weevolveit.com.

**Architecture:** A pure graph draft model permits incomplete drawings; validated drafts feed the existing deterministic engine. A Canvas2D viewport plus accessible DOM controls supports dragging, connection gestures, zoom, scrolling and inspection without new runtime dependencies. The existing shared ticker drives dirty rendering. Text editing, presets and saved machines remain available.

**Spec:** User requests in this chat; supplied v2 TRD remains the behavior/performance baseline, except the user now removes the ten-state display limit and requests website-informed styling. The website request is adaptation, not a clone of its marketing content.

## Constraints and rulings

- No fixed state, transition or alphabet-count limit. Hardware, UTF-8 file-size and input-length bounds still apply.
- Inputs/outputs support arbitrary nonempty Unicode tokens without whitespace or #. Multi-character input alphabets use spaces in the Bench; single-character alphabets retain compact input. Determinism requires one transition per state/input pair.
- Incomplete drawings are saved as drafts; Run reports missing transitions rather than silently inventing behavior. An explicit Fill missing self-loops action assists completion.
- Zero new renderer dependencies, no WebGL, no remote runtime requests, reduced-motion support.
- Source folder has no Git history; do not create worktrees or perform unrelated Git setup.
- Site capture pipeline dependencies are missing. Await the user's optional capture-method preference while independently implementing the graphical editor.

## Shared interfaces

`src/editor/model.ts` exports:

```ts
type GraphKind = 'mealy' | 'moore';
interface GraphState { id: string; name: string; output: string; x: number; y: number }
interface GraphTransition { id: string; from: string; to: string; input: string; output: string }
interface GraphDraft { kind: GraphKind; states: GraphState[]; transitions: GraphTransition[]; alphabet: string[]; start: string; nextId: number }
createDraft(kind?: GraphKind): GraphDraft;
cloneDraft(draft: GraphDraft): GraphDraft;
draftFromMachine(machine: MachineDef, positions?: Record<string, { x: number; y: number }>): GraphDraft;
addState(draft: GraphDraft, x: number, y: number, name?: string): GraphState;
renameState(draft: GraphDraft, id: string, name: string): void;
removeState(draft: GraphDraft, id: string): void;
upsertTransition(draft: GraphDraft, transition: Omit<GraphTransition, 'id'> & { id?: string }): GraphTransition;
removeTransition(draft: GraphDraft, id: string): void;
setAlphabet(draft: GraphDraft, symbols: string[]): void;
fillMissing(draft: GraphDraft, output?: string): void;
validateDraft(draft: GraphDraft): string[];
draftToMachine(draft: GraphDraft): MachineDef; // throws for incomplete/invalid drafts
draftToSource(draft: GraphDraft): string; // includes explicit state/alphabet declarations, even incomplete
serializeDraft(draft: GraphDraft): string; // versioned .patchbay JSON, including positions
parseDraft(source: string): GraphDraft; // versioned JSON or valid machine text; validates imported structure
```

`src/editor/editor.ts` exports:

```ts
class GraphicalEditor {
  constructor(host: HTMLElement, options: { onApply: (source: string) => void; onText: () => void; onMessage: (message: string) => void });
  setMachine(machine: MachineDef, preserveSavedDraft?: boolean): void;
  getSource(): string;
  openSource(source: string): void;
  resize(): void;
  update(dt: number, signals: Readonly<Signals>): void;
  dispose(): void;
}
```

Main owns routing/template, native save-kind support, integration and installation. Editor owns its internal controls/CSS. Model owns engine parser/serializer changes and model tests. Avoid overlapping file edits.

## Tasks

- [x] Pure draft model and text interoperability. Add explicit `state NAME` and `alphabet SYMBOL...` directives while preserving existing text behavior. Prove Unicode/nonbinary simulation, zero/incomplete drafts, rename/delete, determinism, safe JSON import, 256+ states and multi-symbol alphabets.
- [x] Graphical UI. Add/move/select/delete states, drag/click source→target connections including loops, transition/state inspectors, start-state choice, Mealy/Moore output controls, alphabet editing, undo/redo, fit/zoom, native/browser save/open, draft recovery, Run and text access. Incomplete/duplicate transitions must show actionable errors.
- [x] Scalable Bench rendering. Remove ten-state suppression, use a viewport-sized canvas for oversized layouts, scroll/cull off-screen geometry, avoid long animated genesis/morph for large machines, retain accessible nodes. Verify 256-state machines without oversized GPU canvases.
- [x] Capture style/motion reference with the available browser, preserve evidence, and adapt tokens and interaction/reveal motion to app controls with reduced-motion fallback. The automatic ui_clone pipeline is unavailable and no pipeline pass is claimed.
- [x] Integrate and verify complete browser flows, existing suite, native IPC/export, source/package identity, size budgets and desktop screenshots. Review independently, correct important findings, package and update the installed app/desktop shortcut without losing user drafts.

## Review focus

- Editing or deleting a state updates every incident transition and the start state.
- Renamed states cannot change behavior through reserved names or prototype keys.
- Duplicate state/input transitions do not create nondeterminism or silently overwrite a different edge.
- Incomplete drawings, graph files and existing text files reopen without losing their positions or invalidating the last runnable machine.
- Pointer cancellation, drag history and zoom/scroll retain correct state/edge hit targets; large layouts never allocate a canvas the size of the whole graph.

## Ledger

Version 1.2 source/build and 162 unit tests pass. Graphical browser coverage passes 19 flows; the UI suite verifies eleven presets, token/mode conversion, word output and manual draft recovery. The 256-state/1,024-transition scalability check and source/packaged Electron graph/text IPC checks pass. Motion regression checks spatial letter inversion, grey edges, left/bottom origins, temporary blur, modal continuity, rapid interactions and idle cleanup. Reference capture/provenance is documented; no automatic ui_clone pass is claimed.

Independent review found and verified fixes for initial word-output spacing, rapid manual close, and preservation of untouched generated graph text. The final package has seven current source/build payload files, exact SHA-256 identity, the OFL license, version 1.2.0 and only en-US Chromium locale. Renderer size is 223,525 bytes; ASAR is 236,574 bytes. The user closed the old app; the original Programs/Patchbay installation and desktop shortcut now point to version 1.2.0. The final installed-path Electron smoke passed with a separate hidden test profile. Archive SHA-256 is CD60811C117C16978B86A097687FC1C05C8F5F8635255E5D5B082A369201127F. The temporary duplicate was removed using a manifest/hash-checked file-only cleanup, followed by empty directory removal, after broad recursive cleanup was rejected by automatic review. Installation evidence is in artifacts/install-report.json.
