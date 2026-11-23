import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import type { MachineDef, Step } from '../domain/contracts';
import { buildDiagram, type DEdge } from '../diagram/layout';
import { DiagramInk, type DiagramPresentation, type Travel } from './diagram-ink';
import { field } from './field';
import type { FrameClock } from './frame-clock';

export interface StateDiagramProps {
  machine: MachineDef;
  clock: FrameClock;
  cursor: number;
  activeState: string;
  travelRef: RefObject<{ step?: Step; progress: number }>;
  replayKey: number;
  theme: 'light' | 'dark';
  onBuildingChange?: (building: boolean) => void;
  onInspect?: (state: string) => void;
}

const emptyPresentation = (reducedMotion: boolean, stateCount: number): DiagramPresentation => ({
  building: !reducedMotion && stateCount <= 32,
  nodeStages: new Map(),
  visibleEdges: new Set(),
  startVisible: false,
  reducedMotion,
});

/** React owns state buttons, labels, start text and their accessibility. */
export function StateDiagram({
  machine,
  clock,
  cursor,
  activeState,
  travelRef,
  replayKey,
  theme,
  onBuildingChange,
  onInspect,
}: StateDiagramProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const glyphCanvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<DiagramInk | null>(null);
  const nodeRefs = useRef(new Map<string, HTMLButtonElement>());
  const labelRefs = useRef(new Map<string, HTMLSpanElement>());
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [presentation, setPresentation] = useState(() =>
    emptyPresentation(clock.signals.reducedMotion, machine.states.length),
  );
  const propsRef = useRef({ travelRef, activeState, onBuildingChange, kind: machine.outputs.kind });
  const buildingRef = useRef(false);
  const data = useMemo(
    () => buildDiagram(machine, { w: viewport.width, h: viewport.height }),
    [machine, viewport.width, viewport.height],
  );

  useLayoutEffect(() => {
    propsRef.current = { travelRef, activeState, onBuildingChange, kind: machine.outputs.kind };
  });
  useLayoutEffect(() => {
    const host = hostRef.current,
      canvas = canvasRef.current,
      glyphCanvas = glyphCanvasRef.current;
    if (!host || !canvas || !glyphCanvas) return;
    let alive = true;
    const source = (step: Step, edge: DEdge): Element | null => {
      if (propsRef.current.kind === 'moore')
        return nodeRefs.current.get(step.to)?.querySelector('.diagram-node-output') ?? null;
      const rows = labelRefs.current.get(edge.id)?.children;
      const row = rows
        ? Array.from(rows).find((element) => (element as HTMLElement).dataset.symbol === step.sym)
        : undefined;
      return row?.querySelector('.edge-output') ?? null;
    };
    const renderer = new DiagramInk(
      host,
      canvas,
      glyphCanvas,
      (value) => {
        if (!alive) return;
        setPresentation(value);
        if (buildingRef.current !== value.building) {
          buildingRef.current = value.building;
          propsRef.current.onBuildingChange?.(value.building);
        }
      },
      clock.signals,
      source,
    );
    rendererRef.current = renderer;
    const measure = () => {
      const width = host.clientWidth,
        height = host.clientHeight;
      // Hidden routes preserve the last useful geometry.
      if (width > 0 && height > 0)
        setViewport((previous) =>
          previous.width === width && previous.height === height ? previous : { width, height },
        );
    };
    const observer =
      typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure);
    observer?.observe(host);
    window.addEventListener('resize', measure);
    measure();
    // html[data-theme] (and the high-contrast class) can move inside a View Transition's
    // update callback; repaint in the observer's microtask so the new snapshot is correct.
    const themeObserver =
      typeof MutationObserver === 'undefined'
        ? undefined
        : new MutationObserver(() => renderer.refreshTheme());
    themeObserver?.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme', 'class'],
    });
    const idle: Travel = { progress: 0 };
    const unsubscribe = clock.subscribe((dt, signals) => {
      const props = propsRef.current;
      renderer.update(dt, signals, props.travelRef.current ?? idle, props.activeState);
    });
    return () => {
      alive = false;
      unsubscribe();
      observer?.disconnect();
      themeObserver?.disconnect();
      window.removeEventListener('resize', measure);
      renderer.dispose();
      rendererRef.current = null;
      if (buildingRef.current) {
        buildingRef.current = false;
        propsRef.current.onBuildingChange?.(false);
      }
    };
    // Canvas lifetime follows the shared clock; source lookup reads committed DOM.
  }, [clock]);
  useLayoutEffect(() => {
    if (viewport.width > 0 && viewport.height > 0)
      rendererRef.current?.configure(machine, data, viewport.width, viewport.height, replayKey);
  }, [machine, data, viewport.width, viewport.height, replayKey, clock]);
  // The theme prop can commit before html[data-theme] moves (the parent's layout effect
  // runs after this one), so this only re-reads; the observer above repaints.
  useLayoutEffect(() => {
    rendererRef.current?.refreshTheme(false);
  }, [theme]);
  useLayoutEffect(() => {
    rendererRef.current?.invalidate();
  }, [cursor, activeState]);
  // A node removed or replaced under the pointer never sends pointerleave, so a
  // new machine and unmount both release the field's highlight.
  useEffect(() => () => field.setHoverState(null), [machine]);

  const start = data.nodes.find((node) => node.id === machine.start);
  const overflow = data.width > viewport.width || data.height > viewport.height;
  return (
    <>
      <div
        id="diagram"
        ref={hostRef}
        className={`diagram${presentation.reducedMotion ? ' diagram-reduced' : ''}`}
        data-kind={machine.outputs.kind}
        data-building={presentation.building}
        data-overflow={overflow}
        data-cursor={cursor}
      >
        <div className="diagram-surface" style={{ width: data.width, height: data.height }}>
          <canvas
            ref={canvasRef}
            className="diagram-ink"
            aria-hidden="true"
            style={{ width: viewport.width, height: viewport.height }}
          />
          <div className="diagram-labels" aria-hidden="true">
            {data.edges.map((edge) => (
              <span
                key={edge.id}
                data-edge={edge.id}
                ref={(element) => {
                  if (element) labelRefs.current.set(edge.id, element);
                  else labelRefs.current.delete(edge.id);
                }}
                className={`diagram-edge-label${presentation.visibleEdges.has(edge.id) ? ' is-visible' : ''}${edge.reachable ? '' : ' is-unreachable'}${presentation.traversed === edge.id ? ' is-traversed' : ''}`}
                title={edge.labels.join(', ')}
                style={{
                  transform: `translate3d(${edge.labelX}px,${edge.labelY}px,0) translate(-50%,-50%)`,
                }}
              >
                {edge.symbols.map((symbol, index) =>
                  index < 3 || edge.symbols.length <= 4 ? (
                    <span className="diagram-edge-symbol" data-symbol={symbol} key={symbol}>
                      <span className="edge-input">{symbol}</span>
                      {machine.outputs.kind === 'mealy' && (
                        <>
                          <span className="edge-slash">/</span>
                          <span className="edge-output">
                            {machine.outputs.lambda[edge.from]?.[symbol] ?? ''}
                          </span>
                        </>
                      )}
                    </span>
                  ) : null,
                )}
                {edge.symbols.length > 4 && (
                  <span className="diagram-edge-more">+{edge.symbols.length - 3} symbols</span>
                )}
              </span>
            ))}
          </div>
          <div
            className="diagram-nodes"
            role="group"
            aria-label="Machine states, in discovery order"
          >
            {data.nodes.map((node) => {
              const stage = presentation.nodeStages.get(node.id) ?? 'waiting';
              const description =
                `State ${node.id}${node.out !== undefined ? `, output ${node.out}` : ''}.` +
                machine.alphabet
                  .map(
                    (symbol) =>
                      ` On ${symbol} goes to ${machine.delta[node.id]?.[symbol] ?? 'no state'}.`,
                  )
                  .join('') +
                (node.reachable ? '' : ' Unreachable from the start state.');
              const active = node.id === activeState;
              return (
                <button
                  type="button"
                  key={node.id}
                  data-state={node.id}
                  ref={(element) => {
                    if (element) nodeRefs.current.set(node.id, element);
                    else nodeRefs.current.delete(node.id);
                  }}
                  className={`diagram-node${stage === 'waiting' ? '' : ' is-formed'}${stage === 'forming' ? ' is-forming' : ''}${node.reachable ? '' : ' is-unreachable'}${machine.outputs.kind === 'moore' ? ' is-moore' : ''}${active ? ' is-active' : ''}${presentation.reading === node.id ? ' is-reading' : ''}${presentation.arriving === node.id ? ' is-arriving' : ''}${presentation.fault === node.id ? ' is-fault' : ''}`}
                  style={
                    {
                      '--node-size': `${node.r * 2}px`,
                      transform: `translate3d(${node.x - node.r}px,${node.y - node.r}px,0)`,
                    } as CSSProperties
                  }
                  aria-label={description}
                  title={description}
                  aria-current={active ? 'true' : undefined}
                  onClick={() => onInspect?.(node.id)}
                  onPointerEnter={() => field.setHoverState(node.id)}
                  onPointerLeave={() => field.setHoverState(null)}
                >
                  <span className="diagram-node-name">{node.id}</span>
                  {node.out !== undefined && (
                    <span className="diagram-node-output">{node.out}</span>
                  )}
                </button>
              );
            })}
          </div>
          {start && (
            <span
              className={`diagram-start-label${presentation.startVisible ? ' is-visible' : ''}`}
              aria-hidden="true"
              style={{
                // layout.ts reserves r + 72 left of the start state; the clamp is a safety net.
                transform: `translate3d(${Math.max(4, start.x - start.r - 60)}px,${start.y + 12}px,0)`,
              }}
            >
              start
            </span>
          )}
        </div>
      </div>
      {createPortal(
        <canvas ref={glyphCanvasRef} className="diagram-glyph" aria-hidden="true" />,
        document.body,
      )}
    </>
  );
}
