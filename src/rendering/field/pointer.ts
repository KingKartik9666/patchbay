import type { Signals } from '../../signals';

/** Where the light rests without a pointer, in NDC (x right, y up). */
export const REST = { x: -0.6, y: 0.7 } as const;
/** Surfaces the user works on; the field calms while the pointer is over them. */
export const WORK_SELECTOR = '#sheet,#dock,.graph-editor,#drawer,input,textarea,select';

export const pointer = {
  x: REST.x as number,
  y: REST.y as number,
  rest: true,
  overWork: false,
  /** performance.now() of the last move. */
  moved: -Infinity,
  windowActive: true,
};

/** One passive window listener feeds the light, parallax and cable bend. It
 * still fires during the editor's pointer capture. Also owns html[data-window]. */
export function installPointer(signals: Signals, wake: () => void): () => void {
  const root = document.documentElement;
  const toRest = () => {
    pointer.rest = true;
    pointer.overWork = false;
    signals.pointer.x = REST.x;
    signals.pointer.y = REST.y;
    wake();
  };
  const setWindow = (active: boolean) => {
    pointer.windowActive = active;
    root.dataset.window = active ? 'active' : 'inactive';
    if (active) wake();
    else toRest();
  };
  const move = (event: PointerEvent) => {
    const width = innerWidth || 1,
      height = innerHeight || 1;
    pointer.x = Math.max(-1, Math.min(1, (event.clientX / width) * 2 - 1));
    pointer.y = Math.max(-1, Math.min(1, 1 - (event.clientY / height) * 2));
    pointer.rest = false;
    pointer.moved = performance.now();
    pointer.overWork =
      event.target instanceof Element && event.target.closest(WORK_SELECTOR) !== null;
    signals.pointer.x = pointer.x;
    signals.pointer.y = pointer.y;
    wake();
  };
  const out = (event: PointerEvent) => {
    if (!event.relatedTarget) toRest();
  };
  const blur = () => setWindow(false),
    focus = () => setWindow(true);
  addEventListener('pointermove', move, { passive: true });
  addEventListener('pointerout', out, { passive: true });
  addEventListener('blur', blur);
  addEventListener('focus', focus);
  setWindow(document.hasFocus());
  return () => {
    removeEventListener('pointermove', move);
    removeEventListener('pointerout', out);
    removeEventListener('blur', blur);
    removeEventListener('focus', focus);
    delete root.dataset.window;
  };
}
