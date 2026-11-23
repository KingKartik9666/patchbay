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
import { FieldCanvas } from '../components/FieldCanvas';
import { field, type FieldStatus } from '../rendering/field';
import type { FrameClock } from '../rendering/frame-clock';
import type { Direction, NavigationSource } from '../motion/ui-motion';
import { LAUNCH_HANDOFF_EVENT, launchMode, onLaunchSettled } from '../launch/launch';
const emptyTrace = { steps: [], output: '', outputSeparator: '' };
/** Rail order: moving down the rail brings the next page up from below. */
const PAGE_ORDER: Page[] = ['bench', 'machines', 'editor', 'learn'];
const ROUTE_TITLES: Record<Page, string> = {
  bench: 'Bench',
  machines: 'Machines',
  editor: 'Editor',
  learn: 'Learn',
};

/** Test-visible diagnostics; subscribes to the field so the app shell need not re-render. */
function Debug({ clock, cursor, errors }: { clock: FrameClock; cursor: number; errors: number }) {
  const [background, setBackground] = useState<FieldStatus>(() => field.status());
  useEffect(() => field.onStatus(setBackground), []);
  return (
    <output id="debug" hidden>
      {JSON.stringify({
        clockSubscribers: clock.subscriberCount,
        cursor,
        rendererErrors: errors,
        background,
      })}
    </output>
  );
}

export function App() {
  const workbench = useWorkbench(),
    { state } = workbench,
    visual = useVisualSystem(state.preferences, state.backdrop, workbench.setPreferences);
  const { controller: player, ...playback } = usePlayback(
    state.evaluation?.trace ?? emptyTrace,
    visual.clock,
  );
  const [replayKey, setReplayKey] = useState(0),
    [errors, setErrors] = useState(0);
  const pageRef = useRef<HTMLDivElement>(null),
    navigation = useRef(0),
    navSource = useRef<NavigationSource>('pointer'),
    pageDirection = useRef<Direction>('bottom'),
    closing = useRef(false),
    allowClose = useRef(false),
    captures = useRef(0);
  const latest = useRef({ workbench, visual, player, playback });
  useLayoutEffect(() => {
    latest.current = { workbench, visual, player, playback };
  });
  /** Pointer routes play the exit, then the entrance; keyboard routes
   * (E, ?, Escape, rail Enter/Space) swap within the same frame. */
  const navigate = useCallback(
    async (page: Page, panel: Panel = null, source: NavigationSource = 'pointer') => {
      const version = ++navigation.current,
        { workbench, visual } = latest.current,
        motion = visual.motion.current,
        drawer = document.getElementById('drawer'),
        host = pageRef.current;
      const samePage = workbench.state.page === page;
      if (samePage && workbench.state.panel === panel) {
        motion?.cancel((workbench.state.panel ? drawer : host) ?? undefined);
        return;
      }
      navSource.current = source;
      pageDirection.current =
        PAGE_ORDER.indexOf(page) >= PAGE_ORDER.indexOf(workbench.state.page) ? 'bottom' : 'top';
      if (source === 'keyboard') {
        if (drawer) motion?.cancel(drawer);
        if (host) motion?.cancel(host);
        await workbench.route(page, panel);
        return;
      }
      const outgoing = workbench.state.panel ? drawer : samePage ? null : host;
      if (outgoing)
        await motion?.exit(outgoing, motion.origin(), workbench.state.panel ? 'drawer' : 'page');
      if (version === navigation.current) await workbench.route(page, panel);
    },
    [],
  );
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
  // The launch condenses into the Bench's start jack: replay the diagram build
  // under it, unless the user already moved on (skipping cancels the hand-off).
  useEffect(() => {
    const handoff = () => {
      const { workbench, visual, playback } = latest.current;
      if (
        workbench.state.page === 'bench' &&
        workbench.state.evaluation?.machine &&
        playback.cursor === 0 &&
        !playback.playing &&
        !visual.effective.reducedMotion
      )
        setReplayKey((value) => value + 1);
    };
    window.addEventListener(LAUNCH_HANDOFF_EVENT, handoff);
    return () => window.removeEventListener(LAUNCH_HANDOFF_EVENT, handoff);
  }, []);
  // A launch that played (to the end or skipped) is seen for this version, so
  // the next start plays the short variant.
  const version = state.version;
  useEffect(() => {
    if (!version) return;
    return onLaunchSettled(() => {
      if (launchMode() !== 'off') latest.current.workbench.markLaunchSeen(version);
    });
  }, [version]);
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
    // .page-host is the sheet's own scroller, so a page change resets it too.
    if (pageRef.current) pageRef.current.scrollTop = 0;
    const host = pageRef.current,
      motion = visual.motion.current;
    if (!host || !motion) return;
    if (navSource.current === 'keyboard') motion.cancel(host);
    else motion.enter(host, { ...motion.origin(), direction: pageDirection.current }, 'page');
  }, [state.page, visual.motion]);
  // Runs after the rail, drawer and page have read the source of this commit.
  useLayoutEffect(() => {
    navSource.current = 'pointer';
  }, [state.page, state.panel]);
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
        void navigate(workbench.state.page, null, 'keyboard');
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
      } else if (event.key.toLowerCase() === 'e') void navigate('editor', null, 'keyboard');
      else if (event.key.toLowerCase() === 'f')
        workbench.setPreferences({ focusMode: !workbench.state.preferences.focusMode });
      else if (event.key.toLowerCase() === 'q') {
        const options = ['low', 'medium', 'high'] as const;
        workbench.setPreferences({
          quality: options[(options.indexOf(workbench.state.preferences.quality) + 1) % 3],
        });
      } else if (event.key === '?') void navigate('learn', null, 'keyboard');
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
  const presetName = state.presets.find((item) => item.id === state.presetId)?.name;
  const caption = machine
    ? `${ROUTE_TITLES[state.page]} · ${presetName ?? 'Custom machine'}`
    : ROUTE_TITLES[state.page];
  /** The native capture reads the window's pixels, Mica included. data-capture
   * paints the frame opaque for two frames so the saved image never depends on
   * the wallpaper or shows transparent pixels. */
  const screenshot = async () => {
    const root = document.documentElement;
    captures.current++;
    root.dataset.capture = '';
    try {
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
      return await desktop.screenshot();
    } finally {
      if (--captures.current === 0) delete root.dataset.capture;
    }
  };
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
    <>
      <FieldCanvas
        clock={visual.clock}
        machine={machine}
        player={player}
        page={state.page}
        panel={state.panel}
        theme={visual.effective.theme}
        quality={visual.effective.quality}
        reducedMotion={visual.effective.reducedMotion}
        off={visual.reducedTransparency || visual.effective.highContrast}
      />
      <div
        className="react-app"
        data-drawer={state.panel ?? undefined}
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
            caption={caption}
            source={navSource}
            onNavigate={(name, source) => {
              if (name === 'trace') void navigate('bench', name, source);
              else if (name === 'text' || name === 'settings')
                void navigate(state.page, name, source);
              else void navigate(name, null, source);
            }}
            onTheme={visual.toggleTheme}
            themeIntent={visual.themeIntent}
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
                    <h1>Editor</h1>
                    <p>Place states, patch transitions between them, then run the machine.</p>
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
        </main>
        <Drawer
          panel={state.panel}
          onClose={(source) => {
            void navigate(state.page, null, source);
          }}
          motion={visual.motion}
          source={navSource}
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
              backdrop={state.backdrop}
              onChange={workbench.setPreferences}
              onTheme={visual.toggleTheme}
              themeIntent={visual.themeIntent}
              onScreenshot={() => {
                void screenshot()
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
        <div id="toast" role="status" data-glass="float" hidden={!state.message}>
          {state.message}
        </div>
        <div id="narration" className="sr-only" aria-live="polite" aria-atomic="true">
          {machine
            ? `Step ${playback.cursor}. State ${playback.cursor ? player.trace.steps[playback.cursor - 1]?.to : machine.start}. Output ${outputTokens(player, playback.cursor).join(player.trace.outputSeparator) || 'empty'}.`
            : ''}
        </div>
        <Debug clock={visual.clock} cursor={playback.cursor} errors={errors} />
      </div>
    </>
  );
}
