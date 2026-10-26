import type { GraphDraft } from '../domain/contracts';
import { STATE_RADIUS, type Curve, type Point } from './geometry';
import type { Camera, ViewSize } from './viewport';

export interface InkSnapshot {
  draft: GraphDraft;
  curves: readonly Curve[];
  camera: Camera;
  size: ViewSize;
  selectedTransition: string;
  connection: { source: string; point: Point | null };
}
export interface InkColors {
  copper: string;
  mint: string;
  line: string;
}

/** Canvas owns only visible ink. Semantic states and labels are React buttons. */
export function drawGraphInk(
  context: CanvasRenderingContext2D,
  snapshot: InkSnapshot,
  dpr: number,
  colors: InkColors,
  viewLeft: number,
  viewTop: number,
): void {
  const {
    draft,
    curves,
    camera: { zoom },
    size: { width, height },
    selectedTransition,
    connection,
  } = snapshot;
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.clearRect(0, 0, width, height);
  const viewRight = viewLeft + width / zoom,
    viewBottom = viewTop + height / zoom;
  const spacing = 40 * zoom;
  if (spacing >= 12) {
    context.fillStyle = colors.line;
    const startX = (((-viewLeft * zoom) % spacing) + spacing) % spacing;
    const startY = (((-viewTop * zoom) % spacing) + spacing) % spacing;
    for (let y = startY; y < height; y += spacing)
      for (let x = startX; x < width; x += spacing) context.fillRect(x, y, 1, 1);
  }
  context.translate(-viewLeft * zoom, -viewTop * zoom);
  context.scale(zoom, zoom);
  context.lineCap = 'round';
  for (const curve of curves) {
    const bounds = curve.bounds;
    if (
      bounds.right < viewLeft - 20 ||
      bounds.left > viewRight + 20 ||
      bounds.bottom < viewTop - 20 ||
      bounds.top > viewBottom + 20
    )
      continue;
    const selected = curve.transition.id === selectedTransition;
    context.strokeStyle = context.fillStyle = selected ? colors.mint : colors.copper;
    context.lineWidth = (selected ? 2.4 : 1.6) / zoom;
    context.beginPath();
    context.moveTo(curve.a.x, curve.a.y);
    context.bezierCurveTo(curve.b.x, curve.b.y, curve.c.x, curve.c.y, curve.d.x, curve.d.y);
    context.stroke();
    const angle = Math.atan2(curve.d.y - curve.c.y, curve.d.x - curve.c.x),
      head = 8 / zoom;
    context.beginPath();
    context.moveTo(curve.d.x, curve.d.y);
    context.lineTo(
      curve.d.x - Math.cos(angle - 0.45) * head,
      curve.d.y - Math.sin(angle - 0.45) * head,
    );
    context.lineTo(
      curve.d.x - Math.cos(angle + 0.45) * head,
      curve.d.y - Math.sin(angle + 0.45) * head,
    );
    context.closePath();
    context.fill();
  }
  const start = draft.states.find((state) => state.id === draft.start);
  if (start) {
    context.strokeStyle = context.fillStyle = colors.mint;
    context.lineWidth = 1.5 / zoom;
    context.beginPath();
    context.moveTo(start.x - STATE_RADIUS - 35, start.y);
    context.lineTo(start.x - STATE_RADIUS - 4, start.y);
    context.stroke();
    context.beginPath();
    context.moveTo(start.x - STATE_RADIUS - 3, start.y);
    context.lineTo(start.x - STATE_RADIUS - 11, start.y - 4);
    context.lineTo(start.x - STATE_RADIUS - 11, start.y + 4);
    context.closePath();
    context.fill();
  }
  const source = draft.states.find((state) => state.id === connection.source);
  if (source && connection.point) {
    context.strokeStyle = colors.mint;
    context.lineWidth = 1.7 / zoom;
    context.setLineDash([6 / zoom, 5 / zoom]);
    context.beginPath();
    context.moveTo(source.x, source.y);
    context.lineTo(connection.point.x, connection.point.y);
    context.stroke();
    context.setLineDash([]);
  }
}
