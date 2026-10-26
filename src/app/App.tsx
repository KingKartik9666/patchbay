import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import type { Page, Panel } from '../domain/contracts';
import { desktop, errorMessage } from '../domain/client';
import { useWorkbench } from './use-workbench';
import { useVisualSystem } from './use-visual-system';
import { usePlayback } from '../playback/use-playback';
import { GraphEditor } from '../editor/GraphEditor';
import { Bench, outputTokens } from '../components/Bench';
import { Chrome } from '../components/Chrome';
import { Library } from '../components/Library';
import { Learn } from '../components/Learn';
import { Drawer } from '../components/Drawer';
import { TracePanel, traceText } from '../components/TracePanel';
import { TextPanel } from '../components/TextPanel';
import { SettingsPanel } from '../components/SettingsPanel';
const emptyTrace = { steps: [], output: '', outputSeparator: '' };

export function App() {
  const workbench = useWorkbench(),
    { state } = workbench,
    visual = useVisualSystem(state.preferences, workbench.setPreferences);
  const { controller: player, ...playback } = usePlayback(
    state.evaluation?.trace ?? emptyTrace,
    visual.clock,
  );
  const [replayKey, setReplayKey] = useState(0),
    [errors, setErrors] = useState(0);
  const pageRef = useRef<HTMLDivElement>(null),
    navigation = useRef(0),
    closing = useRef(false),
    allowClose = useRef(false);
  const latest = useRef({ workbench, visual, player, playback });
  useLayoutEffect(() => {
    latest.current = { workbench, visual, player, playback };
  });
  const navigate = useCallback(async (page: Page, panel: Panel = null) => {
    const version = ++navigation.current,
      { workbench, visual } = latest.current;
    const samePage = workbench.state.page === page;
    if (samePage && workbench.state.panel === panel) {
      visual.motion.current?.cancel(
        workbench.state.panel
          ? (document.getElementById('drawer') ?? undefined)
          : (pageRef.current ?? undefined),
      );
      return;
    }
    const outgoing = workbench.state.panel
      ? document.getElementById('drawer')
      : samePage
        ? null
        : pageRef.current;
    if (outgoing)
      await visual.motion.current?.exit(
        outgoing,
        visual.motion.current.origin(),
        workbench.state.panel ? 'drawer' : 'page',
      );
    if (version === navigation.current) await workbench.route(page, panel);
  }, []);
  const onClose = useCallback(async () => {
    if (closing.current) return;
    closing.current = true;
    try {
      await latest.current.workbench.flush();
      allowClose.current = true;
      if (isTauri()) await getCurrentWindow().close();
    } catch (error) {
      closing.current = false;
      allowClose.current = false;
      latest.current.workbench.message(errorMessage(error));
    }
  }, []);
  useEffect(() => {
    if (!isTauri()) return;
    let alive = true,
      stop: (() => void) | undefined;
    void getCurrentWindow()
      .onCloseRequested((event) => {
        if (allowClose.current) return;
        event.preventDefault();
        void onClose();
      })
      .then((unlisten) => {
        if (alive) stop = unlisten;
        else unlisten();
      });
    return () => {
      alive = false;
      stop?.();
    };
  }, [onClose]);
  useEffect(() => {
    const fail = () => setErrors((count) => count + 1);
    window.addEventListener('error', fail);
    window.addEventListener('unhandledrejection', fail);
    return () => {
      window.removeEventListener('error', fail);
      window.removeEventListener('unhandledrejection', fail);
    };
  }, []);
  useLayoutEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    if (pageRef.current)
      visual.motion.current?.enter(pageRef.current, visual.motion.current.origin(), 'page');
  }, [state.page, visual.motion]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      const { workbench, visual, player, playback } = latest.current;
      if (
        event.defaultPrevented ||
        (event.target as HTMLElement).closest('input,textarea,select,[contenteditable=true]') ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey
      )
        return;
      if (event.key === ' ' && (event.target as HTMLElement).closest('button,a')) return;
      if (event.key === 'Escape' && workbench.state.panel) {
        event.preventDefault();
        void navigate(workbench.state.page);
        return;
      }
      if (workbench.state.page === 'editor' && !workbench.state.panel) return;
      const invalid = !!workbench.state.evaluation?.inputIssues.length;
      if (event.key === ' ') {
        event.preventDefault();
        if (!invalid) player.toggle();
      } else if (event.key === 'ArrowRight' && !invalid) {
        event.preventDefault();
        player.step(visual.effective.reducedMotion);
      } else if (event.key === 'ArrowLeft' && !invalid) {
        event.preventDefault();
        player.seek(playback.cursor - 1);
      } else if (event.key.toLowerCase() === 'r') player.seek(0);
      else if (event.key.toLowerCase() === 'b') {
        player.seek(0);
        setReplayKey((value) => value + 1);
      } else if (event.key.toLowerCase() === 'e') void navigate('editor');
      else if (event.key.toLowerCase() === 'f')
        workbench.setPreferences({ focusMode: !workbench.state.preferences.focusMode });
      else if (event.key.toLowerCase() === 'q') {
        const options = ['low', 'medium', 'high'] as const;
        workbench.setPreferences({
          quality: options[(options.indexOf(workbench.state.preferences.quality) + 1) % 3],
        });
      } else if (event.key === '?') void navigate('learn');
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [navigate]);
  const dispatch = workbench.dispatch;
  useEffect(() => {
    if (!state.message) return;
    const timer = setTimeout(() => dispatch({ type: 'patch', value: { message: '' } }), 4500);
    return () => clearTimeout(timer);
  }, [state.message, dispatch]);
  useLayoutEffect(() => {
    const root = document.getElementById('app');
    if (root) root.dataset.ready = String(!!state.evaluation);
  }, [state.evaluation]);
  const machine = state.evaluation?.machine;
  const copyTrace = async () => {
    try {
      await navigator.clipboard.writeText(
        traceText(player, state.input, machine?.outputs.kind ?? ''),
      );
      workbench.message('Full trace copied.');
    } catch {
      workbench.message('Clipboard unavailable. Try again with the app focused.');
    }
  };
  return (
    <div
      className="react-app"
      onClickCapture={(event) => {
        const trigger = (event.target as HTMLElement).closest<HTMLElement>(
          'button,a,input[type=checkbox],select',
        );
        if (trigger) {
          visual.motion.current?.origin(trigger);
          if (trigger.matches('button')) visual.motion.current?.feedback(trigger);
        }
      }}
    >
      <main className="main-content">
        <Chrome
          page={state.page}
          panel={state.panel}
          preferences={visual.effective}
          onNavigate={(name) => {
            if (name === 'trace') void navigate('bench', name);
            else if (name === 'settings') void navigate(state.page, name);
            else void navigate(name);
          }}
          onTheme={visual.toggleTheme}
          onFocus={() => workbench.setPreferences({ focusMode: !state.preferences.focusMode })}
          onClose={() => {
            void onClose();
          }}
        />
        {!machine ? (
          <section className="sheet loading-screen" role="status">
            <h1>Patchbay</h1>
            <p>{state.loadError || 'Opening your workbench…'}</p>
            {state.loadError && (
              <button
                className="primary-button"
                onClick={() => {
                  void workbench.boot();
                }}
              >
                Try again
              </button>
            )}
          </section>
        ) : (
          <div ref={pageRef} className="page-host">
            {state.page === 'bench' && (
              <Bench
                workbench={workbench}
                clock={visual.clock}
                player={player}
                playback={playback}
                replayKey={replayKey}
                onReplay={() => {
                  player.seek(0);
                  setReplayKey((value) => value + 1);
                }}
                onNavigate={(page, panel) => {
                  void navigate(page, panel);
                }}
                reduced={visual.effective.reducedMotion}
              />
            )}
            {state.page === 'machines' && (
              <Library
                presets={state.presets}
                onPreset={(id) => {
                  void workbench.loadPreset(id);
                }}
                onEdit={() => {
                  void navigate('editor');
                }}
              />
            )}
            {state.page === 'learn' && (
              <Learn
                onPreset={(id) => {
                  void workbench.loadPreset(id);
                }}
              />
            )}
            {state.page === 'editor' && state.graph && (
              <section id="view-editor" className="view" aria-label="Graphical editor">
                <header className="editor-intro">
                  <div>
                    <span className="workspace-eyebrow">Graphical editor</span>
                    <h1>
                      Draw it. <span>Run it.</span>
                    </h1>
                  </div>
                  <p>
                    Place states. Draw transitions.
                    <br />
                    Build your own Mealy or Moore machine.
                  </p>
                </header>
                <GraphEditor
                  result={state.graph}
                  clock={visual.clock}
                  busy={state.busy}
                  canUndo={!!state.past.length}
                  canRedo={!!state.future.length}
                  onEdit={workbench.editGraph}
                  onNew={workbench.newGraph}
                  onUndo={() => workbench.history(false)}
                  onRedo={() => workbench.history(true)}
                  onRun={() => {
                    void workbench.runGraph();
                  }}
                  onText={workbench.graphText}
                  onOpen={() => {
                    void workbench.openProject();
                  }}
                  onSave={() => {
                    void workbench.saveGraph();
                  }}
                  onMessage={workbench.message}
                />
              </section>
            )}
          </div>
        )}
        <footer className="app-footer">
          <span>
            <i />
            Offline ready
          </span>
          <span>Finite state studio</span>
          <button
            id="quality-button"
            onClick={() => {
              const choices = ['low', 'medium', 'high'] as const;
              workbench.setPreferences({
                quality: choices[(choices.indexOf(state.preferences.quality) + 1) % 3],
              });
            }}
          >
            {state.preferences.quality[0].toUpperCase() + state.preferences.quality.slice(1)}{' '}
            quality
          </button>
        </footer>
      </main>
      <Drawer
        panel={state.panel}
        onClose={() => {
          void navigate(state.page);
        }}
        motion={visual.motion}
      >
        {state.panel === 'trace' && machine && (
          <TracePanel
            player={player}
            playback={playback}
            start={machine.start}
            reduced={visual.effective.reducedMotion}
            invalid={!!state.evaluation?.inputIssues.length}
            onCopy={() => {
              void copyTrace();
            }}
          />
        )}
        {state.panel === 'text' && <TextPanel workbench={workbench} />}
        {state.panel === 'settings' && (
          <SettingsPanel
            preferences={visual.effective}
            onChange={workbench.setPreferences}
            onTheme={visual.toggleTheme}
            onScreenshot={() => {
              void desktop
                .screenshot()
                .then((saved) => {
                  if (saved) workbench.message('Screenshot saved.');
                })
                .catch((error) => workbench.message(errorMessage(error)));
            }}
            clock={visual.clock}
            errors={errors}
          />
        )}
      </Drawer>
      <div id="toast" role="status" hidden={!state.message}>
        {state.message}
      </div>
      <div id="narration" className="sr-only" aria-live="polite" aria-atomic="true">
        {machine
          ? `Step ${playback.cursor}. State ${playback.cursor ? player.trace.steps[playback.cursor - 1]?.to : machine.start}. Output ${outputTokens(player, playback.cursor).join(player.trace.outputSeparator) || 'empty'}.`
          : ''}
      </div>
      <output id="debug" hidden>
        {JSON.stringify({
          clockSubscribers: visual.clock.subscriberCount,
          cursor: playback.cursor,
          rendererErrors: errors,
        })}
      </output>
    </div>
  );
}
