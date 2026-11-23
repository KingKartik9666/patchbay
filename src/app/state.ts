import type {
  Backdrop,
  Evaluation,
  GraphResult,
  Page,
  Panel,
  ParseError,
  Preferences,
  Preset,
} from '../domain/contracts';
export interface WorkbenchState {
  backdrop: Backdrop;
  evaluation: Evaluation | null;
  input: string;
  presets: Preset[];
  presetId: string;
  graph: GraphResult | null;
  past: GraphResult[];
  future: GraphResult[];
  manualDraft: string | null;
  manualDirty: boolean;
  manualErrors: ParseError[];
  fileName: string;
  preferences: Preferences;
  page: Page;
  panel: Panel;
  message: string;
  loadError: string;
  busy: boolean;
  /** The app version whose launch was last played or skipped (persisted). */
  launchSeen: string | null;
  /** This build's version, from the startup payload. */
  version: string;
}
/** Set by the native initialization script before the page parses, so a
 * Pearl user never sees a Night frame while the startup payload is in flight. */
const boot = typeof window === 'undefined' ? undefined : window.__patchbayBoot;
export const defaults: Preferences = {
  theme: boot?.theme ?? 'dark',
  motionBlur: false,
  quality: 'medium',
  glass: 'baked',
  reducedMotion: false,
  focusMode: false,
  highContrast: false,
  mooreInitial: true,
  launchAnimation: true,
  frameRate: 'match',
};
/** Browser previews and tests have no native window, so the frame stays opaque. */
export const noBackdrop: Backdrop = { kind: 'none', reason: null };
export const initialState: WorkbenchState = {
  backdrop: noBackdrop,
  evaluation: null,
  input: '',
  presets: [],
  presetId: 'custom',
  graph: null,
  past: [],
  future: [],
  manualDraft: null,
  manualDirty: false,
  manualErrors: [],
  fileName: 'machine.txt',
  preferences: defaults,
  page: 'bench',
  panel: null,
  message: '',
  loadError: '',
  busy: false,
  launchSeen: null,
  version: boot?.version ?? '',
};
export type Action =
  | { type: 'patch'; value: Partial<WorkbenchState> }
  | { type: 'preferences'; value: Partial<Preferences> }
  | {
      type: 'loaded';
      evaluation: Evaluation;
      input: string;
      graph?: GraphResult;
      presetId?: string;
      resetManual?: boolean;
    }
  | { type: 'graph'; result: GraphResult; record: boolean }
  | { type: 'undo' | 'redo' };
export function reducer(state: WorkbenchState, action: Action): WorkbenchState {
  switch (action.type) {
    case 'patch':
      return { ...state, ...action.value };
    case 'preferences':
      return { ...state, preferences: { ...state.preferences, ...action.value } };
    case 'loaded':
      return {
        ...state,
        evaluation: action.evaluation,
        input: action.input,
        presetId: action.presetId ?? 'custom',
        ...(action.graph ? { graph: action.graph, past: [], future: [] } : {}),
        ...(action.resetManual ? { manualDraft: null, manualDirty: false, manualErrors: [] } : {}),
        loadError: '',
      };
    case 'graph':
      return {
        ...state,
        graph: action.result,
        past: action.record && state.graph ? [...state.past, state.graph].slice(-50) : state.past,
        future: action.record ? [] : state.future,
      };
    case 'undo': {
      const result = state.past.at(-1);
      return result
        ? {
            ...state,
            graph: result,
            past: state.past.slice(0, -1),
            future: state.graph ? [...state.future, state.graph] : state.future,
          }
        : state;
    }
    case 'redo': {
      const result = state.future.at(-1);
      return result
        ? {
            ...state,
            graph: result,
            future: state.future.slice(0, -1),
            past: state.graph ? [...state.past, state.graph].slice(-50) : state.past,
          }
        : state;
    }
  }
}

/** One synchronous owner lets queued IPC completions and close-time persistence
 * observe the latest committed state, independently of React's render schedule. */
export class WorkbenchStore {
  private state: WorkbenchState = initialState;
  private listeners = new Set<() => void>();
  getSnapshot = (): WorkbenchState => this.state;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  dispatch = (action: Action): void => {
    const next = reducer(this.state, action);
    if (next === this.state) return;
    this.state = next;
    this.listeners.forEach((listener) => listener());
  };
}
