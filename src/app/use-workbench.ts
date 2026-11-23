import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type {
  Evaluation,
  GraphDraft,
  GraphEdit,
  MachineDef,
  MachineKind,
  Page,
  Panel,
  Preferences,
  SavedSession,
} from '../domain/contracts';
import { desktop, domain, errorMessage } from '../domain/client';
import { buildDiagram } from '../diagram/layout';
import { initialState, noBackdrop, WorkbenchStore, type WorkbenchState } from './state';
import { SessionWriter } from './session-writer';

function positions(machine: MachineDef) {
  return Object.fromEntries(
    buildDiagram(machine, { w: 800, h: 440 }).nodes.map((node) => [
      node.id,
      { x: node.x, y: node.y },
    ]),
  );
}
export function sessionSnapshot(state: WorkbenchState): SavedSession | null {
  return state.evaluation
    ? {
        ...state.preferences,
        source: state.evaluation.source,
        input: state.input,
        manualDraft: state.manualDraft,
        route: state.page,
        graph: state.graph?.draft ?? null,
        launchSeen: state.launchSeen,
      }
    : null;
}

export function useWorkbench() {
  const [store] = useState(() => new WorkbenchStore());
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot),
    dispatch = store.dispatch;
  const current = useMemo(
    () => ({
      get current() {
        return store.getSnapshot();
      },
    }),
    [store],
  );
  const generation = useRef(0),
    graphGeneration = useRef(0),
    bootGeneration = useRef(0),
    manualTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const queue = useRef(Promise.resolve());
  const pending = useRef(new Set<Promise<unknown>>());
  const track = useCallback(<T>(operation: Promise<T>): Promise<T> => {
    pending.current.add(operation);
    const settle = () => pending.current.delete(operation);
    void operation.then(settle, settle);
    return operation;
  }, []);
  const message = useCallback(
    (value: string) => dispatch({ type: 'patch', value: { message: value } }),
    [dispatch],
  );
  const writer = useMemo(
    () => new SessionWriter(desktop.saveSession, (error) => message(errorMessage(error))),
    [message],
  );
  const boot = useCallback(async () => {
    const ticket = ++bootGeneration.current;
    try {
      const [startup, presets] = await Promise.all([desktop.startup(), domain.presets()]);
      const saved = startup.session,
        fallback = presets[0];
      if (!fallback) throw new Error('The preset library is unavailable.');
      const source = saved?.source ?? fallback.source,
        input = saved?.input ?? fallback.input;
      const evaluation = await domain.evaluate({
        type: 'parse',
        source,
        input,
        mooreInitial: saved?.mooreInitial ?? true,
      });
      if (!evaluation.machine) throw new Error('The saved machine could not be loaded.');
      const graph = saved?.graph
        ? await domain.graph({ type: 'inspectGraph', draft: saved.graph })
        : await domain.graph({
            type: 'fromMachine',
            machine: evaluation.machine,
            positions: positions(evaluation.machine),
          });
      const manualErrors =
        saved?.manualDraft && saved.manualDraft !== source
          ? (
              await domain.evaluate({
                type: 'parse',
                source: saved.manualDraft,
                input,
                mooreInitial: saved.mooreInitial,
              })
            ).errors
          : [];
      if (ticket !== bootGeneration.current) return;
      dispatch({
        type: 'patch',
        value: {
          // A backend without native material support (or a mocked one) keeps the frame opaque.
          backdrop: startup.backdrop ?? noBackdrop,
          evaluation,
          input,
          presets,
          graph,
          preferences: saved
            ? {
                theme: saved.theme,
                motionBlur: saved.motionBlur,
                quality: saved.quality,
                glass: saved.glass,
                reducedMotion: saved.reducedMotion,
                focusMode: saved.focusMode,
                highContrast: saved.highContrast,
                mooreInitial: saved.mooreInitial,
                // Optional so mocked or older backends still boot.
                launchAnimation: saved.launchAnimation ?? true,
                frameRate: saved.frameRate ?? 'match',
              }
            : initialState.preferences,
          // A launch that settled before the session arrived has already
          // recorded this version; keep it over the older saved value.
          launchSeen: current.current.launchSeen ?? saved?.launchSeen ?? null,
          version: startup.version,
          page: saved?.route ?? 'bench',
          manualDraft: saved?.manualDraft ?? null,
          manualErrors,
          presetId: presets.find((p) => p.source === source)?.id ?? 'custom',
          loadError: '',
          message:
            startup.warnings.join(' ') ||
            (startup.migrated ? 'Previous Patchbay session recovered.' : ''),
        },
      });
    } catch (error) {
      if (ticket === bootGeneration.current)
        dispatch({ type: 'patch', value: { loadError: errorMessage(error) } });
    }
  }, [dispatch, current]);
  const cancelPending = useCallback(() => {
    bootGeneration.current++;
    generation.current++;
    graphGeneration.current++;
    clearTimeout(manualTimer.current);
  }, []);
  useEffect(() => {
    void boot();
    return () => {
      cancelPending();
      writer.dispose();
    };
  }, [boot, writer, cancelPending]);
  const snapshot = useMemo(() => sessionSnapshot(state), [state]);
  useEffect(() => {
    if (snapshot) writer.schedule(snapshot);
  }, [writer, snapshot]);

  const install = useCallback(
    async (
      ticket: number,
      evaluation: Evaluation,
      input: string,
      options: { presetId?: string; syncGraph?: boolean; resetManual?: boolean } = {},
    ) => {
      if (!evaluation.machine) return false;
      const graphVersion = graphGeneration.current;
      const graph =
        options.syncGraph === false
          ? undefined
          : await domain.graph({
              type: 'fromMachine',
              machine: evaluation.machine,
              positions: positions(evaluation.machine),
            });
      if (ticket !== generation.current || graphVersion !== graphGeneration.current) return false;
      if (graph) graphGeneration.current++;
      dispatch({
        type: 'loaded',
        evaluation,
        input,
        graph,
        presetId: options.presetId,
        resetManual: options.resetManual,
      });
      return true;
    },
    [dispatch],
  );
  const loadPreset = useCallback(
    async (id: string) => {
      const preset = current.current.presets.find((p) => p.id === id);
      if (!preset) return;
      const ticket = ++generation.current;
      dispatch({ type: 'patch', value: { busy: true } });
      try {
        const evaluation = await domain.evaluate({
          type: 'parse',
          source: preset.source,
          input: preset.input,
          mooreInitial: current.current.preferences.mooreInitial,
        });
        if (
          ticket === generation.current &&
          (await install(ticket, evaluation, preset.input, { presetId: id, resetManual: true }))
        )
          dispatch({ type: 'patch', value: { page: 'bench', panel: null } });
      } catch (error) {
        if (ticket === generation.current) message(errorMessage(error));
      } finally {
        dispatch({ type: 'patch', value: { busy: false } });
      }
    },
    [install, message, current, dispatch],
  );
  const loadInput = useCallback(
    async (input: string) => {
      const machine = current.current.evaluation?.machine;
      if (!machine) return;
      const ticket = ++generation.current;
      try {
        const evaluation = await domain.evaluate({
          type: 'simulate',
          machine,
          input,
          mooreInitial: current.current.preferences.mooreInitial,
        });
        if (ticket === generation.current)
          dispatch({
            type: 'loaded',
            evaluation: { ...evaluation, source: current.current.evaluation!.source },
            input,
            presetId: current.current.presetId,
          });
      } catch (error) {
        message(errorMessage(error));
      }
    },
    [message, current, dispatch],
  );
  const convert = useCallback(
    async (target?: MachineKind) => {
      const machine = current.current.evaluation?.machine;
      if (!machine) return;
      const kind = target ?? (machine.outputs.kind === 'mealy' ? 'moore' : 'mealy');
      if (kind === machine.outputs.kind) return;
      const ticket = ++generation.current;
      dispatch({ type: 'patch', value: { busy: true } });
      try {
        const input = current.current.input,
          evaluation = await domain.evaluate({
            type: 'convert',
            machine,
            target: kind,
            input,
            mooreInitial: current.current.preferences.mooreInitial,
          });
        if (
          ticket === generation.current &&
          (await install(ticket, evaluation, input, { resetManual: true }))
        ) {
          dispatch({ type: 'patch', value: { page: 'bench', panel: null } });
          message(
            kind === 'moore'
              ? 'Converted to Moore. States split by incoming output; initial 0 is added.'
              : 'Converted to Mealy. The initial Moore output is dropped.',
          );
        }
      } catch (error) {
        message(errorMessage(error));
      } finally {
        dispatch({ type: 'patch', value: { busy: false } });
      }
    },
    [install, message, current, dispatch],
  );
  const validateText = useCallback(
    async (apply = false) => {
      clearTimeout(manualTimer.current);
      const text = current.current.manualDraft ?? current.current.evaluation?.source ?? '';
      if (!current.current.manualDirty && !apply) return true;
      const ticket = ++generation.current;
      try {
        const input = current.current.input,
          evaluation = await domain.evaluate({
            type: 'parse',
            source: text,
            input,
            mooreInitial: current.current.preferences.mooreInitial,
          });
        if (
          ticket !== generation.current ||
          text !== (current.current.manualDraft ?? current.current.evaluation?.source)
        )
          return false;
        dispatch({ type: 'patch', value: { manualErrors: evaluation.errors, manualDirty: false } });
        if (!evaluation.machine) return false;
        if (
          !(await install(ticket, evaluation, input, {
            syncGraph: text !== current.current.graph?.source,
          }))
        )
          return false;
        if (apply) {
          dispatch({ type: 'patch', value: { page: 'bench', panel: null } });
          message('Machine applied.');
        }
        return true;
      } catch (error) {
        message(errorMessage(error));
        return false;
      }
    },
    [install, message, current, dispatch],
  );
  const editText = useCallback(
    (value: string) => {
      generation.current++;
      dispatch({ type: 'patch', value: { manualDraft: value, manualDirty: true } });
      clearTimeout(manualTimer.current);
      manualTimer.current = setTimeout(() => {
        void track(validateText());
      }, 250);
    },
    [validateText, dispatch, track],
  );
  const route = useCallback(
    async (page: Page, panel: Panel = null) => {
      if (current.current.panel === 'text' && current.current.manualDirty) await validateText();
      dispatch({ type: 'patch', value: { page, panel } });
    },
    [validateText, current, dispatch],
  );
  const setPreferences = useCallback(
    (value: Partial<Preferences>) => {
      dispatch({ type: 'preferences', value });
      if (value.mooreInitial !== undefined) {
        const machine = current.current.evaluation?.machine;
        if (machine) {
          const input = current.current.input,
            ticket = ++generation.current;
          void domain
            .evaluate({ type: 'simulate', machine, input, mooreInitial: value.mooreInitial })
            .then((evaluation) => {
              if (ticket === generation.current)
                dispatch({
                  type: 'loaded',
                  evaluation: { ...evaluation, source: current.current.evaluation!.source },
                  input,
                  presetId: current.current.presetId,
                });
            })
            .catch((error) => message(errorMessage(error)));
        }
      }
    },
    [message, current, dispatch],
  );
  const editGraph = useCallback(
    (edit: GraphEdit): Promise<void> => {
      const change = async () => {
        const graph = current.current.graph;
        if (!graph) return;
        const version = graphGeneration.current;
        dispatch({ type: 'patch', value: { busy: true } });
        try {
          const result = await domain.graph({ type: 'editGraph', draft: graph.draft, edit });
          if (
            version === graphGeneration.current &&
            JSON.stringify(result.draft) !== JSON.stringify(graph.draft)
          ) {
            graphGeneration.current++;
            dispatch({ type: 'graph', result, record: true });
          }
        } catch (error) {
          message(errorMessage(error));
          throw error;
        } finally {
          dispatch({ type: 'patch', value: { busy: false } });
        }
      };
      const promise = queue.current.then(change);
      queue.current = promise.catch(() => {});
      return promise;
    },
    [message, current, dispatch],
  );
  const newGraph = useCallback(
    async (kind: MachineKind) => {
      const version = ++graphGeneration.current;
      generation.current++;
      try {
        const draft: GraphDraft = {
          kind,
          states: [],
          transitions: [],
          alphabet: [],
          start: '',
          nextId: 0,
        };
        const result = await domain.graph({ type: 'inspectGraph', draft });
        if (version === graphGeneration.current) dispatch({ type: 'graph', result, record: true });
      } catch (error) {
        message(errorMessage(error));
        throw error;
      }
    },
    [message, dispatch],
  );
  const history = useCallback(
    (redo: boolean) => {
      graphGeneration.current++;
      generation.current++;
      dispatch({ type: redo ? 'redo' : 'undo' });
    },
    [dispatch],
  );
  const graphText = useCallback(() => {
    const graph = current.current.graph;
    if (graph)
      dispatch({
        type: 'patch',
        value: {
          manualDraft: graph.source,
          manualDirty: false,
          manualErrors: [],
          page: 'bench',
          panel: 'text',
        },
      });
  }, [current, dispatch]);
  const runGraph = useCallback(async () => {
    const graph = current.current.graph;
    if (!graph?.machine) {
      message(graph?.errors[0] ?? 'Complete the drawing before running.');
      return;
    }
    const ticket = ++generation.current;
    try {
      let input = current.current.input;
      let evaluation = await domain.evaluate({
        type: 'simulate',
        machine: graph.machine,
        input,
        mooreInitial: current.current.preferences.mooreInitial,
      });
      if (evaluation.inputIssues.length) {
        input = graph.machine.alphabet.slice(0, 8).join(evaluation.tokenInput ? ' ' : '');
        evaluation = await domain.evaluate({
          type: 'simulate',
          machine: graph.machine,
          input,
          mooreInitial: current.current.preferences.mooreInitial,
        });
      }
      if (
        await install(ticket, { ...evaluation, source: graph.source }, input, {
          syncGraph: false,
          resetManual: true,
        })
      ) {
        dispatch({ type: 'patch', value: { page: 'bench', panel: null } });
        message('Drawing applied. Ready to run.');
      }
    } catch (error) {
      message(errorMessage(error));
    }
  }, [install, message, current, dispatch]);
  const importProject = useCallback(
    async (source: string) => {
      const version = ++graphGeneration.current;
      generation.current++;
      try {
        const result = await domain.graph({ type: 'openProject', source });
        if (version !== graphGeneration.current) return;
        dispatch({ type: 'graph', result, record: true });
        dispatch({ type: 'patch', value: { page: 'editor', panel: null } });
        message('Project opened.');
      } catch (error) {
        message(errorMessage(error));
      }
    },
    [message, dispatch],
  );
  const openProject = useCallback(async () => {
    try {
      const file = await desktop.openProject();
      if (!file) return;
      dispatch({ type: 'patch', value: { fileName: file.name } });
      if (
        file.name.toLowerCase().endsWith('.patchbay') ||
        file.source.trimStart().startsWith('{')
      ) {
        await importProject(file.source);
        return;
      }
      generation.current++;
      dispatch({
        type: 'patch',
        value: {
          manualDraft: file.source,
          manualDirty: true,
          manualErrors: [],
          page: 'bench',
          panel: 'text',
        },
      });
      await validateText();
      message('Text definition opened.');
    } catch (error) {
      message(errorMessage(error));
    }
  }, [importProject, message, dispatch, validateText]);
  const saveGraph = useCallback(async () => {
    try {
      const draft = current.current.graph?.draft;
      if (draft) {
        const source = await domain.exportGraph(draft);
        if (await desktop.saveProject(source, 'graph')) message('Drawing saved.');
      }
    } catch (error) {
      message(errorMessage(error));
    }
  }, [message, current]);
  const saveText = useCallback(async () => {
    try {
      const source = current.current.manualDraft ?? current.current.evaluation?.source ?? '';
      if (await desktop.saveProject(source, 'text')) message('Text definition saved.');
    } catch (error) {
      message(errorMessage(error));
    }
  }, [message, current]);
  /** Records that this version's launch was played or skipped, so the next
   * start plays the short variant. */
  const markLaunchSeen = useCallback(
    (version: string) => {
      if (version && current.current.launchSeen !== version)
        dispatch({ type: 'patch', value: { launchSeen: version } });
    },
    [current, dispatch],
  );
  const flush = useCallback(async () => {
    clearTimeout(manualTimer.current);
    if (current.current.manualDirty) await validateText();
    while (pending.current.size) await Promise.allSettled([...pending.current]);
    await queue.current;
    const latest = sessionSnapshot(current.current);
    if (latest) writer.schedule(latest);
    await writer.flush();
  }, [validateText, writer, current]);
  return {
    state,
    dispatch,
    message,
    boot,
    loadPreset: (id: string) => track(loadPreset(id)),
    loadInput: (input: string) => track(loadInput(input)),
    convert: (kind?: MachineKind) => track(convert(kind)),
    editText,
    validateText: (apply = false) => track(validateText(apply)),
    route: (page: Page, panel: Panel = null) => track(route(page, panel)),
    setPreferences,
    markLaunchSeen,
    editGraph: (edit: GraphEdit) => track(editGraph(edit)),
    newGraph: (kind: MachineKind) => track(newGraph(kind)),
    history,
    graphText,
    runGraph: () => track(runGraph()),
    openProject: () => track(openProject()),
    saveGraph,
    saveText,
    flush,
    importProject,
  };
}
export type Workbench = ReturnType<typeof useWorkbench>;
