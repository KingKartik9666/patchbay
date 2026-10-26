import type { GraphDraft, GraphEdit, GraphResult, MachineKind } from '../domain/contracts';
import type { FrameClock } from '../rendering/frame-clock';
export interface GraphEditorProps {
  result: GraphResult;
  clock: FrameClock;
  busy: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onEdit(edit: GraphEdit): Promise<void>;
  onNew(kind: MachineKind): Promise<void>;
  onUndo(): void;
  onRedo(): void;
  onRun(): void;
  onText(): void;
  onOpen(): void;
  onSave(): void;
  onMessage(message: string): void;
}
export type GraphSnapshot = GraphDraft;
