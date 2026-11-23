import { useEffect, useMemo, useRef, type PointerEvent, type RefObject } from 'react';
import { domain } from '../domain/client';
import type { MachineDef, Preset } from '../domain/contracts';
import { field } from '../rendering/field';
import { Icon } from './Icon';

const categories: Preset['category'][] = ['Binary', 'Decimal', 'Multi-variable', 'Events'];
/** Hover intent before a row rewires the background, so a pass across the list stays calm. */
const PREVIEW_INTENT_MS = 120;

/** Presets never change at runtime, so each parse runs once per session. */
const previewMachines = new Map<string, Promise<MachineDef | undefined>>();
function previewMachine(preset: Preset): Promise<MachineDef | undefined> {
  let machine = previewMachines.get(preset.id);
  if (!machine) {
    machine = domain
      .evaluate({ type: 'parse', source: preset.source, input: preset.input, mooreInitial: false })
      .then(
        (evaluation) => evaluation.machine,
        () => undefined,
      );
    previewMachines.set(preset.id, machine);
  }
  return machine;
}

/**
 * Shows the hovered row's wiring in the background field, falling back to the
 * focused row, then to the loaded machine. Pointer hover waits for intent;
 * keyboard focus previews at once. The field is decoration, so a failed parse
 * simply leaves the loaded machine in place.
 */
function usePresetPreview() {
  const preview = useMemo(() => {
    let hovered: Preset | null = null,
      focused: Preset | null = null,
      shown: string | null = null,
      timer = 0;
    const apply = () => {
      const preset = hovered ?? focused;
      if (!preset) {
        if (shown !== null) {
          shown = null;
          field.setPreview(null);
        }
        return;
      }
      if (shown === preset.id) return;
      const id = (shown = preset.id);
      void previewMachine(preset).then((machine) => {
        if (shown === id) field.setPreview(machine ?? null);
      });
    };
    return {
      enter(preset: Preset, event: PointerEvent) {
        if (event.pointerType === 'touch') return;
        hovered = preset;
        window.clearTimeout(timer);
        timer = window.setTimeout(apply, PREVIEW_INTENT_MS);
      },
      leave(preset: Preset) {
        if (hovered?.id !== preset.id) return;
        hovered = null;
        window.clearTimeout(timer);
        apply();
      },
      focus(preset: Preset) {
        focused = preset;
        apply();
      },
      blur(preset: Preset) {
        if (focused?.id !== preset.id) return;
        focused = null;
        apply();
      },
      dispose() {
        window.clearTimeout(timer);
        hovered = focused = shown = null;
        field.setPreview(null);
      },
    };
  }, []);
  useEffect(() => preview.dispose, [preview]);
  return preview;
}

/** The element whose scrollport the sticky heading pins to; null means the viewport. */
function scrollRoot(element: HTMLElement): HTMLElement | null {
  for (
    let node = element.parentElement;
    node && node !== document.body;
    node = node.parentElement
  ) {
    const { overflowY } = getComputedStyle(node);
    if (overflowY !== 'visible' && overflowY !== 'clip') return node;
  }
  return null;
}

/**
 * Marks the sticky heading with data-scrolled once rows pass under it. The
 * sentinel sits right after the heading, so it leaves the area below the
 * pinned heading exactly when the list starts to scroll beneath it.
 */
function useScrollEdge(
  heading: RefObject<HTMLElement | null>,
  sentinel: RefObject<HTMLElement | null>,
) {
  useEffect(() => {
    const header = heading.current,
      marker = sentinel.current;
    if (!header || !marker || typeof IntersectionObserver === 'undefined') return;
    let observer: IntersectionObserver | undefined,
      key = '';
    const connect = () => {
      const root = scrollRoot(header),
        top = Number.parseFloat(getComputedStyle(header).top) || 0,
        margin = `${-Math.round(top + header.offsetHeight)}px 0px 0px 0px`;
      // The scroll container changes with the layout (the sheet scrolls itself
      // on narrow windows), and the heading's height changes as it wraps.
      if (observer && observer.root === root && key === margin) return;
      observer?.disconnect();
      key = margin;
      observer = new IntersectionObserver(
        ([entry]) => {
          if (
            entry.isIntersecting ||
            entry.boundingClientRect.top > (entry.rootBounds?.bottom ?? 0)
          )
            delete header.dataset.scrolled;
          else header.dataset.scrolled = '';
        },
        { root, rootMargin: margin },
      );
      observer.observe(marker);
    };
    const resize = new ResizeObserver(connect);
    resize.observe(header);
    window.addEventListener('resize', connect);
    connect();
    return () => {
      resize.disconnect();
      window.removeEventListener('resize', connect);
      observer?.disconnect();
      delete header.dataset.scrolled;
    };
  }, [heading, sentinel]);
}

export function Library({
  presets,
  onPreset,
  onEdit,
}: {
  presets: Preset[];
  onPreset: (id: string) => void;
  onEdit: () => void;
}) {
  const heading = useRef<HTMLElement>(null),
    sentinel = useRef<HTMLDivElement>(null);
  useScrollEdge(heading, sentinel);
  const preview = usePresetPreview();
  const groups = categories
    .map((category) => ({
      category,
      items: presets.filter((preset) => preset.category === category),
    }))
    .filter((group) => group.items.length);
  return (
    <section id="view-machines" className="view sheet library" aria-label="Machines">
      <header ref={heading} className="view-heading">
        <div>
          <h1>Machines</h1>
          <p>
            {presets.length} {presets.length === 1 ? 'preset' : 'presets'}, each with a sample input
            and the output it writes.
          </p>
        </div>
        <button id="library-edit" className="secondary-button" onClick={onEdit}>
          <Icon name="editor" />
          Draw a machine
        </button>
      </header>
      <div ref={sentinel} className="library-sentinel" aria-hidden="true" />
      {groups.map((group) => (
        <section key={group.category} className="machine-group" aria-label={group.category}>
          <h2>
            {group.category} <span>{group.items.length}</span>
          </h2>
          <div className="machine-list">
            {group.items.map((preset) => (
              <button
                key={preset.id}
                className="preset-row"
                data-preset={preset.id}
                onClick={() => onPreset(preset.id)}
                onPointerEnter={(event) => preview.enter(preset, event)}
                onPointerLeave={() => preview.leave(preset)}
                onFocus={() => preview.focus(preset)}
                onBlur={() => preview.blur(preset)}
              >
                <span className="preset-info">
                  <strong>{preset.name}</strong>
                  <span>{preset.description}</span>
                </span>
                <span className="kind-badge">{preset.kind === 'mealy' ? 'Mealy' : 'Moore'}</span>
                <span
                  className="preset-example"
                  aria-label={`Input ${preset.input}, output ${preset.expected}`}
                >
                  <span className="preset-in">{preset.input}</span>
                  <Icon name="arrow" />
                  <span className="preset-out">{preset.expected}</span>
                </span>
                <Icon name="play" />
              </button>
            ))}
          </div>
        </section>
      ))}
      <p className="preview-caption" aria-hidden="true">
        Hover a machine to see its wiring
      </p>
    </section>
  );
}
