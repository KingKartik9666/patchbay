import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
  type PointerEvent,
} from 'react';
import type { GraphDraft, GraphTransition } from '../domain/contracts';
import type { FrameClock } from '../rendering/frame-clock';
import { graphCurves, STATE_RADIUS, type Point } from './geometry';
import { drawGraphInk, type InkSnapshot } from './ink';
import {
  fitCamera,
  graphBounds,
  layoutViewport,
  movePosition,
  zoomCamera,
  type Camera,
  type MoveAnchor,
  type ViewLayout,
  type ViewSize,
} from './viewport';

export type GraphTool = 'select' | 'connect';
interface Gesture extends MoveAnchor {
  pointerId: number;
  stateId: string;
  mode: GraphTool;
  moved: boolean;
  position: Point;
}
interface Connection {
  source: string;
  hover: string;
  point: Point | null;
}
const emptyConnection = (): Connection => ({ source: '', hover: '', point: null });
interface GraphCanvasProps {
  draft: GraphDraft;
  clock: FrameClock;
  tool: GraphTool;
  busy: boolean;
  resetToken: number;
  selectedState: string;
  selectedTransition: string;
  onSelectState(id: string): void;
  onSelectTransition(edge: GraphTransition): void;
  onClearSelection(): void;
  onConnect(from: string, to: string): void;
  onAddState(point: Point): void;
  onMoveState(id: string, position: Point): Promise<boolean>;
  onMessage(message: string): void;
  viewCenterRef: { current: Point };
}

export function GraphCanvas(props: GraphCanvasProps) {
  const { draft, clock, tool, busy, resetToken, selectedState, selectedTransition, viewCenterRef } =
    props;
  const hostRef = useRef<HTMLDivElement>(null),
    scrollRef = useRef<HTMLDivElement>(null),
    canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState<ViewSize>({ width: 1, height: 1 });
  const [camera, setCamera] = useState<Camera>({ center: { x: 200, y: 130 }, zoom: 1 });
  const [preview, setPreview] = useState<{ id: string; position: Point } | null>(null);
  const [frozenLayout, setFrozenLayout] = useState<ViewLayout | null>(null);
  const [connection, setConnection] = useState<Connection>(emptyConnection);
  const [focusedEdge, setFocusedEdge] = useState('');
  const gestureRef = useRef<Gesture | null>(null),
    connectionRef = useRef<Connection>(emptyConnection());
  const suppressClick = useRef(0),
    dirtyRef = useRef(true),
    programmaticScroll = useRef<Point | null>(null);
  const committingRef = useRef(false),
    mountedRef = useRef(false);
  const baseCurves = useMemo(() => graphCurves(draft), [draft]);
  const bounds = useMemo(() => graphBounds(draft, baseCurves), [draft, baseCurves]);
  const displayDraft = useMemo(
    () =>
      preview
        ? {
            ...draft,
            states: draft.states.map((state) =>
              state.id === preview.id ? { ...state, ...preview.position } : state,
            ),
          }
        : draft,
    [draft, preview],
  );
  const curves = useMemo(
    () => (preview ? graphCurves(displayDraft) : baseCurves),
    [preview, displayDraft, baseCurves],
  );
  const curvesById = useMemo(
    () => new Map(curves.map((curve) => [curve.transition.id, curve])),
    [curves],
  );
  const layout = frozenLayout
    ? {
        ...frozenLayout,
        scrollLeft: (camera.center.x - frozenLayout.left) * camera.zoom - size.width / 2,
        scrollTop: (camera.center.y - frozenLayout.top) * camera.zoom - size.height / 2,
      }
    : layoutViewport(bounds, camera, size);
  const layoutRef = useRef(layout),
    cameraRef = useRef(camera),
    sizeRef = useRef(size),
    propsRef = useRef(props);
  const snapshotRef = useRef<InkSnapshot>({
    draft: displayDraft,
    curves,
    camera,
    size,
    selectedTransition,
    connection,
  });

  useLayoutEffect(() => {
    layoutRef.current = layout;
    cameraRef.current = camera;
    sizeRef.current = size;
    propsRef.current = props;
    viewCenterRef.current = camera.center;
    snapshotRef.current = {
      draft: displayDraft,
      curves,
      camera,
      size,
      selectedTransition,
      connection,
    };
    dirtyRef.current = true;
  });

  useLayoutEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll) return;
    scroll.scrollLeft = layout.scrollLeft;
    scroll.scrollTop = layout.scrollTop;
    programmaticScroll.current = { x: scroll.scrollLeft, y: scroll.scrollTop };
  }, [layout.left, layout.top, layout.width, layout.height, layout.scrollLeft, layout.scrollTop]);

  const updateConnection = useCallback((value: Connection) => {
    connectionRef.current = value;
    setConnection(value);
  }, []);
  const cancelGesture = useCallback(() => {
    const gesture = gestureRef.current;
    gestureRef.current = null;
    if (gesture && scrollRef.current?.hasPointerCapture(gesture.pointerId))
      scrollRef.current.releasePointerCapture(gesture.pointerId);
    suppressClick.current = performance.now() + 400;
    if (!committingRef.current) {
      setPreview(null);
      setFrozenLayout(null);
    }
    updateConnection(emptyConnection());
  }, [updateConnection]);

  useLayoutEffect(() => {
    cancelGesture();
  }, [tool, resetToken, cancelGesture]);

  useEffect(() => {
    const scroll = scrollRef.current,
      host = hostRef.current,
      canvas = canvasRef.current;
    if (!scroll || !host || !canvas) return;
    mountedRef.current = true;
    const resize = () => {
      const width = scroll.clientWidth,
        height = scroll.clientHeight;
      if (width && height)
        setSize((previous) =>
          previous.width === width && previous.height === height ? previous : { width, height },
        );
      dirtyRef.current = true;
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(scroll);
    const themeObserver = new MutationObserver(() => {
      dirtyRef.current = true;
    });
    for (
      let ancestor: HTMLElement | null = host.parentElement;
      ancestor;
      ancestor = ancestor.parentElement
    )
      themeObserver.observe(ancestor, {
        attributes: true,
        attributeFilter: ['class', 'style', 'data-theme'],
      });
    const context = canvas.getContext('2d', { alpha: true });
    const unsubscribe = clock.subscribe((_dt, signals) => {
      if (!context || !host.getClientRects().length || host.closest('[hidden]')) return;
      const snapshot = snapshotRef.current,
        currentLayout = layoutRef.current;
      const dpr = Math.min(
        window.devicePixelRatio || 1,
        signals.quality === 'high' ? 2 : signals.quality === 'medium' ? 1.5 : 1,
      );
      const pixelWidth = Math.max(1, Math.ceil(snapshot.size.width * dpr)),
        pixelHeight = Math.max(1, Math.ceil(snapshot.size.height * dpr));
      if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
        canvas.width = pixelWidth;
        canvas.height = pixelHeight;
        dirtyRef.current = true;
      }
      if (!dirtyRef.current) return;
      const style = getComputedStyle(host);
      drawGraphInk(
        context,
        snapshot,
        dpr,
        {
          copper: style.getPropertyValue('--copper').trim() || '#e0a458',
          mint: style.getPropertyValue('--mint').trim() || '#7ce3c3',
          line: style.getPropertyValue('--line').trim() || 'rgba(234,242,236,.13)',
        },
        currentLayout.left + scroll.scrollLeft / snapshot.camera.zoom,
        currentLayout.top + scroll.scrollTop / snapshot.camera.zoom,
      );
      dirtyRef.current = false;
    });
    const wheel = (event: WheelEvent) => {
      if ((!event.ctrlKey && !event.metaKey) || gestureRef.current || committingRef.current) return;
      event.preventDefault();
      const rect = scroll.getBoundingClientRect();
      setCamera((current) =>
        zoomCamera(current, current.zoom * Math.exp(-event.deltaY * 0.002), sizeRef.current, {
          x: event.clientX - rect.left,
          y: event.clientY - rect.top,
        }),
      );
    };
    scroll.addEventListener('wheel', wheel, { passive: false });
    void document.fonts.ready.then(() => {
      if (mountedRef.current) dirtyRef.current = true;
    });
    return () => {
      mountedRef.current = false;
      unsubscribe();
      observer.disconnect();
      themeObserver.disconnect();
      scroll.removeEventListener('wheel', wheel);
      const gesture = gestureRef.current;
      gestureRef.current = null;
      if (gesture && scroll.hasPointerCapture(gesture.pointerId))
        scroll.releasePointerCapture(gesture.pointerId);
    };
  }, [clock]);

  function clientToWorld(x: number, y: number): Point {
    const scroll = scrollRef.current,
      rect = scroll?.getBoundingClientRect(),
      view = layoutRef.current;
    return scroll && rect
      ? {
          x: view.left + (x - rect.left + scroll.scrollLeft) / cameraRef.current.zoom,
          y: view.top + (y - rect.top + scroll.scrollTop) / cameraRef.current.zoom,
        }
      : cameraRef.current.center;
  }
  function nodeAt(x: number, y: number): string {
    const element = document
      .elementFromPoint(x, y)
      ?.closest<HTMLElement>('.graph-node,.graph-connect-handle');
    return element && hostRef.current?.contains(element) ? element.dataset.stateId || '' : '';
  }
  function chooseConnection(id: string) {
    const source = connectionRef.current.source;
    if (source) {
      updateConnection(emptyConnection());
      propsRef.current.onConnect(source, id);
    } else {
      propsRef.current.onClearSelection();
      updateConnection({ source: id, hover: '', point: null });
      propsRef.current.onMessage(
        'Source chosen. Choose a target state, including the source for a self-loop.',
      );
    }
  }
  function pointerDown(event: PointerEvent<HTMLDivElement>) {
    if (
      busy ||
      committingRef.current ||
      event.button !== 0 ||
      gestureRef.current ||
      !(event.target instanceof Element)
    )
      return;
    const button = event.target.closest<HTMLButtonElement>('.graph-node,.graph-connect-handle');
    const state = draft.states.find((item) => item.id === button?.dataset.stateId);
    if (!state || !button) return;
    event.preventDefault();
    button.focus({ preventScroll: true });
    suppressClick.current = 0;
    const mode =
      tool === 'connect' ||
      button.classList.contains('graph-connect-handle') ||
      connectionRef.current.source
        ? 'connect'
        : 'select';
    if (mode === 'select') props.onSelectState(state.id);
    gestureRef.current = {
      pointerId: event.pointerId,
      stateId: state.id,
      mode,
      pointer: { x: event.clientX, y: event.clientY },
      scroll: { x: event.currentTarget.scrollLeft, y: event.currentTarget.scrollTop },
      initial: { x: state.x, y: state.y },
      position: { x: state.x, y: state.y },
      zoom: camera.zoom,
      moved: false,
    };
    setFrozenLayout(layout);
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function pointerMove(event: PointerEvent<HTMLDivElement>) {
    const gesture = gestureRef.current,
      point = clientToWorld(event.clientX, event.clientY);
    if (!gesture) {
      if (connectionRef.current.source)
        updateConnection({
          ...connectionRef.current,
          hover: nodeAt(event.clientX, event.clientY),
          point,
        });
      return;
    }
    if (gesture.pointerId !== event.pointerId) return;
    if (Math.hypot(event.clientX - gesture.pointer.x, event.clientY - gesture.pointer.y) >= 4)
      gesture.moved = true;
    if (gesture.mode === 'select' && gesture.moved) {
      gesture.position = movePosition(
        gesture,
        { x: event.clientX, y: event.clientY },
        { x: event.currentTarget.scrollLeft, y: event.currentTarget.scrollTop },
      );
      setPreview({ id: gesture.stateId, position: gesture.position });
    } else if (gesture.mode === 'connect')
      updateConnection({
        source: gesture.moved ? gesture.stateId : connectionRef.current.source,
        hover: nodeAt(event.clientX, event.clientY),
        point,
      });
  }
  async function pointerUp(event: PointerEvent<HTMLDivElement>) {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    gestureRef.current = null;
    suppressClick.current = performance.now() + 400;
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    if (
      gesture.mode === 'select' &&
      gesture.moved &&
      (gesture.position.x !== gesture.initial.x || gesture.position.y !== gesture.initial.y)
    ) {
      committingRef.current = true;
      try {
        await props.onMoveState(gesture.stateId, gesture.position);
      } finally {
        committingRef.current = false;
        if (mountedRef.current) {
          setPreview(null);
          setFrozenLayout(null);
        }
      }
    } else {
      setPreview(null);
      setFrozenLayout(null);
      if (gesture.mode === 'connect') {
        if (!gesture.moved) chooseConnection(gesture.stateId);
        else {
          const target = nodeAt(event.clientX, event.clientY);
          if (target) {
            updateConnection(emptyConnection());
            props.onConnect(gesture.stateId, target);
          } else {
            props.onClearSelection();
            updateConnection({
              source: gesture.stateId,
              hover: '',
              point: clientToWorld(event.clientX, event.clientY),
            });
            props.onMessage('Choose a target state to finish this connection.');
          }
        }
      }
    }
  }
  function click(event: MouseEvent<HTMLDivElement>) {
    if (
      busy ||
      committingRef.current ||
      (event.detail > 0 && performance.now() < suppressClick.current) ||
      !(event.target instanceof Element)
    )
      return;
    const node = event.target.closest<HTMLElement>('.graph-node,.graph-connect-handle');
    if (node?.dataset.stateId) {
      if (
        tool === 'connect' ||
        node.classList.contains('graph-connect-handle') ||
        connectionRef.current.source
      )
        chooseConnection(node.dataset.stateId);
      else props.onSelectState(node.dataset.stateId);
      return;
    }
    const label = event.target.closest<HTMLElement>('.graph-edge-label');
    if (label) {
      const edge = draft.transitions.find((item) => item.id === label.dataset.transitionId);
      if (edge) {
        updateConnection(emptyConnection());
        props.onSelectTransition(edge);
      }
      return;
    }
    if (tool === 'select') props.onClearSelection();
  }
  function scroll() {
    const element = scrollRef.current;
    if (!element) return;
    dirtyRef.current = true;
    const applied = programmaticScroll.current;
    if (applied && applied.x === element.scrollLeft && applied.y === element.scrollTop) return;
    programmaticScroll.current = null;
    const view = layoutRef.current,
      zoom = cameraRef.current.zoom,
      dimensions = sizeRef.current;
    setCamera({
      zoom,
      center: {
        x: view.left + (element.scrollLeft + dimensions.width / 2) / zoom,
        y: view.top + (element.scrollTop + dimensions.height / 2) / zoom,
      },
    });
  }
  const interacting = !!frozenLayout;
  const stateNames = useMemo(
    () => new Map(draft.states.map((state) => [state.id, state.name])),
    [draft.states],
  );
  const left = layout.scrollLeft,
    top = layout.scrollTop;
  return (
    <>
      <div className="graph-canvas-heading">
        <span id="graph-tool-hint">
          {tool === 'connect'
            ? 'Click source → target, or drag between states. Use the same state for a self-loop.'
            : 'Drag a + handle to draw an arrow. Drag a state to move it. Double-click space to add one.'}
        </span>
        <div className="graph-view-tools" role="group" aria-label="Graph view">
          <button
            id="graph-zoom-out"
            type="button"
            aria-label="Zoom out"
            title="Zoom out"
            disabled={interacting}
            onClick={() => setCamera((current) => zoomCamera(current, current.zoom / 1.25, size))}
          >
            −
          </button>
          <output id="graph-zoom" aria-label="Zoom level">
            {Math.round(camera.zoom * 100)}%
          </output>
          <button
            id="graph-zoom-in"
            type="button"
            aria-label="Zoom in"
            title="Zoom in"
            disabled={interacting}
            onClick={() => setCamera((current) => zoomCamera(current, current.zoom * 1.25, size))}
          >
            +
          </button>
          <button
            id="graph-fit"
            type="button"
            title="Fit graph in view"
            disabled={interacting}
            onClick={() => setCamera(fitCamera(bounds, size))}
          >
            Fit
          </button>
        </div>
      </div>
      <div
        id="graph-stage"
        ref={hostRef}
        className="graph-stage"
        data-tool={tool}
        aria-label="Graphical machine canvas"
      >
        <canvas id="graph-ink" ref={canvasRef} className="graph-ink" aria-hidden="true" />
        <div
          id="graph-scroll"
          ref={scrollRef}
          className="graph-scroll"
          tabIndex={0}
          aria-label="Graph viewport; use arrow keys or scroll to explore"
          onScroll={scroll}
          onPointerDown={pointerDown}
          onPointerMove={pointerMove}
          onPointerUp={(event) => {
            void pointerUp(event);
          }}
          onPointerCancel={cancelGesture}
          onLostPointerCapture={() => {
            if (gestureRef.current) cancelGesture();
          }}
          onClick={click}
          onDoubleClick={(event) => {
            if (
              busy ||
              interacting ||
              !(event.target instanceof Element) ||
              event.target.closest('.graph-node,.graph-connect-handle,.graph-edge-label')
            )
              return;
            event.preventDefault();
            props.onAddState(clientToWorld(event.clientX, event.clientY));
          }}
        >
          <div className="graph-surface" style={{ width: layout.width, height: layout.height }}>
            <div
              className="graph-labels"
              role="group"
              aria-label="Transition labels; activate to edit"
            >
              {draft.transitions.map((edge) => {
                const curve = curvesById.get(edge.id);
                if (!curve) return null;
                const x = (curve.label.x - layout.left) * camera.zoom,
                  y = (curve.label.y - layout.top) * camera.zoom;
                const visible =
                  (x >= left - 90 &&
                    y >= top - 45 &&
                    x <= left + size.width + 90 &&
                    y <= top + size.height + 45) ||
                  focusedEdge === edge.id;
                return (
                  <button
                    key={edge.id}
                    type="button"
                    className={`graph-edge-label${selectedTransition === edge.id ? ' is-selected' : ''}`}
                    data-transition-id={edge.id}
                    aria-label={`Edit transition from ${stateNames.get(edge.from) || edge.from} to ${stateNames.get(edge.to) || edge.to}, input ${edge.input}${draft.kind === 'mealy' ? `, output ${edge.output || 'missing'}` : ''}`}
                    aria-pressed={selectedTransition === edge.id}
                    disabled={busy}
                    onFocus={() => setFocusedEdge(edge.id)}
                    onBlur={() => setFocusedEdge('')}
                    style={
                      {
                        left: x,
                        top: y,
                        visibility: visible ? 'visible' : 'hidden',
                        '--graph-label-scale': Math.max(0.65, Math.min(1.15, camera.zoom)),
                      } as CSSProperties
                    }
                  >
                    {draft.kind === 'mealy' ? `${edge.input} / ${edge.output || '?'}` : edge.input}
                  </button>
                );
              })}
            </div>
            <div
              className="graph-nodes"
              role="group"
              aria-label="Machine states and drawing handles"
            >
              {displayDraft.states.map((state) => (
                <Fragment key={state.id}>
                  <button
                    type="button"
                    data-state-id={state.id}
                    title={state.name}
                    disabled={busy}
                    className={`graph-node${draft.start === state.id ? ' is-start' : ''}${selectedState === state.id ? ' is-selected' : ''}${connection.source === state.id ? ' is-connect-source' : ''}${connection.hover === state.id ? ' is-connect-target' : ''}`}
                    aria-label={`${state.name}${draft.start === state.id ? ', start state' : ''}${draft.kind === 'moore' ? `, output ${state.output || 'missing'}` : ''}. ${tool === 'connect' ? 'Choose connection endpoint' : 'Select or drag to move'}.`}
                    aria-pressed={selectedState === state.id || connection.source === state.id}
                    style={
                      {
                        left: (state.x - layout.left) * camera.zoom,
                        top: (state.y - layout.top) * camera.zoom,
                        width: STATE_RADIUS * 2 * camera.zoom,
                        height: STATE_RADIUS * 2 * camera.zoom,
                        fontSize: 15 * camera.zoom,
                        '--graph-node-scale': camera.zoom,
                      } as CSSProperties
                    }
                  >
                    <span className="graph-node-name">{state.name}</span>
                    <span className="graph-node-output" hidden={draft.kind !== 'moore'}>
                      {state.output || '?'}
                    </span>
                    <span className="graph-node-start" aria-hidden="true">
                      start
                    </span>
                  </button>
                  <button
                    type="button"
                    className="graph-connect-handle"
                    data-state-id={state.id}
                    aria-label={`Draw transition from ${state.name}; activate then choose a target state`}
                    aria-pressed={connection.source === state.id}
                    title={`Draw from ${state.name}: drag, or click then choose a target`}
                    disabled={busy}
                    style={{
                      left: (state.x - layout.left + STATE_RADIUS) * camera.zoom,
                      top: (state.y - layout.top) * camera.zoom,
                    }}
                  >
                    <span aria-hidden="true">+</span>
                  </button>
                </Fragment>
              ))}
            </div>
          </div>
        </div>
        <div id="graph-empty" className="graph-empty" hidden={!!draft.states.length}>
          <span className="graph-empty-mark" aria-hidden="true">
            ○ → ○
          </span>
          <strong>Draw your machine</strong>
          <span>Add a state, then connect states with labelled arrows.</span>
          <button
            id="graph-empty-add"
            type="button"
            className="graph-button"
            disabled={busy}
            onClick={() => props.onAddState(camera.center)}
          >
            Add first state
          </button>
        </div>
      </div>
    </>
  );
}
