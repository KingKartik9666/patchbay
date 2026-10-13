/** Mirrors patchbay-core DTOs. No parsing, validation or simulation lives here. */
export type MachineKind = 'mealy' | 'moore';
export type Outputs = { kind: 'mealy'; lambda: Record<string, Record<string, string>> } | { kind: 'moore'; lambda: Record<string, string> };
export interface MachineDef { states: string[]; alphabet: string[]; start: string; delta: Record<string, Record<string, string>>; outputs: Outputs }
export interface Step { i: number; from: string; sym: string; to: string; out: string }
export interface Trace { initialOut?: string; steps: Step[]; output: string; fault?: { at: number; state: string; sym: string }; outputSeparator: string }
export interface ParseError { line: number; msg: string }
export interface InputIssue { index: number; sym: string }
export interface Evaluation { machine?: MachineDef; source: string; errors: ParseError[]; trace?: Trace; inputSymbols: string[]; inputIssues: InputIssue[]; tokenInput: boolean }
export interface GraphState { id: string; name: string; output: string; x: number; y: number }
export interface GraphTransition { id: string; from: string; to: string; input: string; output: string }
export interface GraphDraft { kind: MachineKind; states: GraphState[]; transitions: GraphTransition[]; alphabet: string[]; start: string; nextId: number }
export interface GraphResult { draft: GraphDraft; source: string; errors: string[]; machine?: MachineDef }
export interface Preset { id: string; name: string; kind: MachineKind; category: 'Binary' | 'Multi-variable' | 'Events' | 'Decimal'; description: string; input: string; source: string; expected: string }
export type GraphEdit =
  | { type: 'addState'; x: number; y: number; name?: string }
  | { type: 'updateState'; id: string; name: string; output: string; start: boolean }
  | { type: 'moveState'; id: string; x: number; y: number }
  | { type: 'removeState'; id: string }
  | { type: 'upsertTransition'; id?: string; from: string; to: string; input: string; output: string }
  | { type: 'removeTransition'; id: string }
  | { type: 'setAlphabet'; symbols: string[] }
  | { type: 'setKind'; kind: MachineKind }
  | { type: 'setStart'; id: string }
  | { type: 'fillMissing'; output: string };
export type DomainRequest =
  | { type: 'presets' }
  | { type: 'parse'; source: string; input: string; mooreInitial: boolean }
  | { type: 'simulate'; machine: MachineDef; input: string; mooreInitial: boolean }
  | { type: 'convert'; machine: MachineDef; target: MachineKind; input: string; mooreInitial: boolean; initialOutput?: string }
  | { type: 'inspectGraph'; draft: GraphDraft }
  | { type: 'editGraph'; draft: GraphDraft; edit: GraphEdit }
  | { type: 'fromMachine'; machine: MachineDef; positions?: Record<string, { x: number; y: number }> }
  | { type: 'openProject'; source: string }
  | { type: 'exportGraph'; draft: GraphDraft };
export type DomainResponse =
  | { type: 'presets'; value: Preset[] }
  | { type: 'evaluation'; value: Evaluation }
  | { type: 'graph'; value: GraphResult }
  | { type: 'text'; value: string };
export interface AppError { code: 'validation' | 'limit' | 'format' | 'io' | 'internal'; message: string; details: string[] }
export interface Preferences { theme: 'light' | 'dark'; motionBlur: boolean; quality: 'low' | 'medium' | 'high'; glass: 'solid' | 'baked'; reducedMotion: boolean; focusMode: boolean; highContrast: boolean; mooreInitial: boolean }
export type Page = 'bench' | 'machines' | 'editor' | 'learn';
export type Panel = 'trace' | 'text' | 'settings' | null;
export interface SavedSession extends Preferences { source: string; input: string; manualDraft: string | null; route: Page; graph: GraphDraft | null }
export interface Startup { session: SavedSession | null; migrated: boolean; warnings: string[]; version: string }
