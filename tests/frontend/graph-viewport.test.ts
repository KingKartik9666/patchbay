import { describe, expect, it } from 'vitest';
import {
  fitCamera,
  graphBounds,
  layoutViewport,
  movePosition,
  zoomCamera,
} from '../../src/editor/viewport';
import { graphCurves } from '../../src/editor/geometry';
import type { GraphDraft } from '../../src/domain/contracts';

describe('graph viewport gestures', () => {
  it('moves imported (0, 35) by the client delta at the captured zoom', () => {
    const initial = { x: 0, y: 35 };
    const result = movePosition(
      { initial, pointer: { x: 100, y: 150 }, scroll: { x: 80, y: 60 }, zoom: 0.8 },
      { x: 110, y: 150 },
      { x: 80, y: 60 },
    );
    expect(result.x).toBeCloseTo(12.5, 10);
    expect(result.y).toBe(35);
    expect(initial).toEqual({ x: 0, y: 35 });
  });

  it('includes scrolling during a gesture without imposing a coordinate clamp', () => {
    const result = movePosition(
      { initial: { x: 0, y: 35 }, pointer: { x: 100, y: 150 }, scroll: { x: 80, y: 60 }, zoom: 2 },
      { x: 60, y: 140 },
      { x: 90, y: 70 },
    );
    expect(result).toEqual({ x: -15, y: 35 });
  });

  it('preserves the camera when content shrinks or its leading margin changes', () => {
    const camera = { center: { x: -220, y: 380 }, zoom: 0.75 };
    const size = { width: 700, height: 400 };
    const layout = layoutViewport({ left: -134, top: -134, right: 500, bottom: 400 }, camera, size);
    expect(layout.left + (layout.scrollLeft + size.width / 2) / camera.zoom).toBeCloseTo(
      camera.center.x,
      9,
    );
    expect(layout.top + (layout.scrollTop + size.height / 2) / camera.zoom).toBeCloseTo(
      camera.center.y,
      9,
    );
    expect(layout.scrollLeft).toBeGreaterThanOrEqual(0);
    expect(layout.scrollTop).toBeGreaterThanOrEqual(0);
    expect(layout.width - layout.scrollLeft).toBeGreaterThanOrEqual(size.width);
    expect(layout.height - layout.scrollTop).toBeGreaterThanOrEqual(size.height);
  });

  it('keeps the world point beneath a cursor fixed when zooming and respects zoom limits', () => {
    const size = { width: 800, height: 600 },
      at = { x: 123, y: 456 };
    const camera = { center: { x: 400, y: 300 }, zoom: 1 };
    const next = zoomCamera(camera, 1.25, size, at);
    const point = (view: typeof camera) => ({
      x: view.center.x + (at.x - 400) / view.zoom,
      y: view.center.y + (at.y - 300) / view.zoom,
    });
    expect(point(next).x).toBeCloseTo(point(camera).x, 10);
    expect(point(next).y).toBeCloseTo(point(camera).y, 10);
    expect(zoomCamera(camera, 0, size).zoom).toBe(0.05);
    expect(zoomCamera(camera, 10, size).zoom).toBe(2.5);
  });

  it('includes negative loops and separates parallel arrows without altering the draft', () => {
    const draft: GraphDraft = {
      kind: 'mealy',
      states: [
        { id: 's0', name: 'Zero', output: '0', x: 0, y: 35 },
        { id: 's1', name: 'Next', output: '0', x: 200, y: 35 },
      ],
      transitions: [
        { id: 't0', from: 's0', to: 's0', input: 'a', output: '0' },
        { id: 't1', from: 's0', to: 's1', input: 'b', output: '0' },
        { id: 't2', from: 's0', to: 's1', input: 'c', output: '0' },
      ],
      alphabet: ['a', 'b', 'c'],
      start: 's0',
      nextId: 5,
    };
    const before = structuredClone(draft),
      curves = graphCurves(draft),
      bounds = graphBounds(draft, curves);
    expect(bounds.top).toBeLessThan(-150);
    expect(bounds.left).toBeLessThan(-100);
    expect(curves[1].label.y).not.toBe(curves[2].label.y);
    expect(draft).toEqual(before);
    const fit = fitCamera(bounds, { width: 800, height: 500 });
    expect(fit.zoom).toBeGreaterThanOrEqual(0.05);
    expect(fit.zoom).toBeLessThanOrEqual(1.2);
  });
});
