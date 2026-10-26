import type {
  Evaluation,
  GraphResult,
  Page,
  Panel,
  ParseError,
  Preferences,
  Preset,
} from '../domain/contracts';
export interface WorkbenchState {
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
}
export const defaults: Preferences = {
  theme: 'light',
  motionBlur: false,
  quality: 'medium',
  glass: 'solid',
  reducedMotion: false,
  focusMode: false,
  highContrast: false,
  mooreInitial: true,
};
export const initialState: WorkbenchState = {
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
