import type { GraphDraft } from '../domain/contracts';
import { STATE_RADIUS, type Curve, type Point } from './geometry';

export interface Bounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}
export interface ViewSize {
  width: number;
  height: number;
}
export interface Camera {
  center: Point;
  zoom: number;
}
export interface ViewLayout extends Bounds {
  width: number;
  height: number;
  scrollLeft: number;
  scrollTop: number;
}

export interface MoveAnchor {
  initial: Point;
  pointer: Point;
  scroll: Point;
  zoom: number;
}

export function movePosition(anchor: MoveAnchor, pointer: Point, scroll: Point): Point {
  return {
    x: anchor.initial.x + (pointer.x - anchor.pointer.x + scroll.x - anchor.scroll.x) / anchor.zoom,
    y: anchor.initial.y + (pointer.y - anchor.pointer.y + scroll.y - anchor.scroll.y) / anchor.zoom,
  };
}

/** Rendering margins include loops, arrowheads and labels, including negative coordinates. */
export function graphBounds(draft: GraphDraft, curves: readonly Curve[]): Bounds {
  let left = 0,
    top = 0,
    right = 400,
    bottom = 260;
  for (const state of draft.states) {
    left = Math.min(left, state.x - STATE_RADIUS);
    top = Math.min(top, state.y - STATE_RADIUS);
    right = Math.max(right, state.x + STATE_RADIUS);
    bottom = Math.max(bottom, state.y + STATE_RADIUS);
  }
  for (const curve of curves) {
    left = Math.min(left, curve.bounds.left - 50);
    top = Math.min(top, curve.bounds.top - 30);
    right = Math.max(right, curve.bounds.right + 50);
    bottom = Math.max(bottom, curve.bounds.bottom + 30);
  }
  return { left: left - 100, top: top - 100, right: right + 100, bottom: bottom + 100 };
}

/** World padding around fitted content. */
export const FIT_PADDING = 32;

/**
 * Everything the stage draws for a draft, in world units: each state, the start arrow and
 * its "start" label (left of the start state, under the arrow's tail), each "+" handle (a
 * 28px button placed at x + R with translate(-25%, -50%)), and each curve with room for its
 * label pill. Fitting to this keeps every glyph inside the stage. An empty draft keeps the
 * default 400 x 260 drawing area.
 */
export function contentBounds(draft: GraphDraft, curves: readonly Curve[]): Bounds {
  if (!draft.states.length) return { left: 0, top: 0, right: 400, bottom: 260 };
  let left = Infinity,
    top = Infinity,
    right = -Infinity,
    bottom = -Infinity;
  const include = (l: number, t: number, r: number, b: number) => {
    left = Math.min(left, l);
    top = Math.min(top, t);
    right = Math.max(right, r);
    bottom = Math.max(bottom, b);
  };
  for (const state of draft.states) {
    include(
      state.x - STATE_RADIUS,
      state.y - STATE_RADIUS,
      state.x + STATE_RADIUS,
      state.y + STATE_RADIUS,
    );
    include(state.x + STATE_RADIUS - 7, state.y - 16, state.x + STATE_RADIUS + 24, state.y + 16);
    if (state.id === draft.start) {
      include(state.x - STATE_RADIUS - 40, state.y, state.x - STATE_RADIUS, state.y);
      include(state.x - STATE_RADIUS - 44, state.y + 6, state.x - STATE_RADIUS - 4, state.y + 28);
    }
  }
  for (const curve of curves)
    include(
      curve.bounds.left - 50,
      curve.bounds.top - 30,
      curve.bounds.right + 50,
      curve.bounds.bottom + 30,
    );
  return {
    left: left - FIT_PADDING,
    top: top - FIT_PADDING,
    right: right + FIT_PADDING,
    bottom: bottom + FIT_PADDING,
  };
}

/** Keep the current world viewport available when a draft's content bounds shrink. */
export function layoutViewport(bounds: Bounds, camera: Camera, size: ViewSize): ViewLayout {
  const halfWidth = size.width / camera.zoom / 2,
    halfHeight = size.height / camera.zoom / 2;
  const left = Math.min(bounds.left, camera.center.x - halfWidth);
  const top = Math.min(bounds.top, camera.center.y - halfHeight);
  const right = Math.max(bounds.right, camera.center.x + halfWidth);
  const bottom = Math.max(bounds.bottom, camera.center.y + halfHeight);
  return {
    left,
    top,
    right,
    bottom,
    width: Math.max(size.width, (right - left) * camera.zoom),
    height: Math.max(size.height, (bottom - top) * camera.zoom),
    scrollLeft: (camera.center.x - left) * camera.zoom - size.width / 2,
    scrollTop: (camera.center.y - top) * camera.zoom - size.height / 2,
  };
}

export function zoomCamera(
  camera: Camera,
  requestedZoom: number,
  size: ViewSize,
  at: Point = { x: size.width / 2, y: size.height / 2 },
): Camera {
  const zoom = Math.max(0.05, Math.min(2.5, requestedZoom));
  const dx = at.x - size.width / 2,
    dy = at.y - size.height / 2;
  return {
    zoom,
    center: {
      x: camera.center.x + dx / camera.zoom - dx / zoom,
      y: camera.center.y + dy / camera.zoom - dy / zoom,
    },
  };
}

export function fitCamera(bounds: Bounds, size: ViewSize): Camera {
  return {
    zoom: Math.max(
      0.05,
      Math.min(
        2.5,
        1.2,
        size.width / (bounds.right - bounds.left),
        size.height / (bounds.bottom - bounds.top),
      ),
    ),
    center: { x: (bounds.left + bounds.right) / 2, y: (bounds.top + bounds.bottom) / 2 },
  };
}

/** Toolbar placement avoids overlapping nodes; it makes no changes to the draft. */
export function statePlacement(draft: GraphDraft, point: Point): Point {
  let x = point.x,
    y = point.y;
  for (
    let attempt = 1;
    draft.states.some((state) => Math.hypot(state.x - x, state.y - y) < 90);
    attempt++
  ) {
    const angle = attempt * 2.399963229728653,
      distance = 100 * Math.sqrt(attempt);
    x = point.x + Math.cos(angle) * distance;
    y = point.y + Math.sin(angle) * distance;
  }
  return { x, y };
}
