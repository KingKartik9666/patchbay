import type { MachineDef, Page } from '../../domain/contracts';

export type FieldMode = 'webgl' | 'static' | 'off';
export type FieldTier = 'high' | 'medium' | 'static';
export interface FieldStatus {
  mode: FieldMode;
  scale: number;
  fps: number;
  tier: FieldTier;
  reason: string | null;
}
export type NavHint = Page | 'trace' | 'text' | 'settings' | null;

export interface ModeInput {
  /** reducedTransparency || highContrast */
  off: boolean;
  forcedColors: boolean;
  quality: 'low' | 'medium' | 'high';
  webgl2: boolean;
  contextLosses: number;
  /** The startup auto-tier's ceiling, or null before it has stepped down. */
  autoTier: FieldTier | null;
}

const RANK: Record<FieldTier, number> = { static: 0, medium: 1, high: 2 };

/** Off, then static, then WebGL, in that order. PATCHBAY_OPAQUE plays no part:
 * the canvas is opaque and needs no Mica. */
export function decideMode(input: ModeInput): {
  mode: FieldMode;
  tier: FieldTier;
  reason: string | null;
} {
  if (input.off) return { mode: 'off', tier: 'static', reason: 'opaque-surfaces' };
  if (input.forcedColors) return { mode: 'off', tier: 'static', reason: 'forced-colors' };
  if (input.quality === 'low') return { mode: 'static', tier: 'static', reason: 'quality-low' };
  if (!input.webgl2) return { mode: 'static', tier: 'static', reason: 'no-webgl2' };
  if (input.contextLosses >= 2) return { mode: 'static', tier: 'static', reason: 'context-lost' };
  const preferred: FieldTier = input.quality,
    tier = input.autoTier && RANK[input.autoTier] < RANK[preferred] ? input.autoTier : preferred;
  if (tier === 'static') return { mode: 'static', tier, reason: 'auto-tier' };
  return { mode: 'webgl', tier, reason: tier === preferred ? null : 'auto-tier' };
}

/** Requests from views; the engine reads them each frame. */
export const fieldRequests: {
  preview: MachineDef | null;
  hover: string | null;
  navHint: NavHint;
} = { preview: null, hover: null, navHint: null };

let current: FieldStatus = { mode: 'off', scale: 0, fps: 0, tier: 'static', reason: 'unmounted' };
let wake: (() => void) | null = null;
const listeners = new Set<(status: FieldStatus) => void>();

/** Engine side of the bridge. */
export const fieldHost = {
  connect(callback: () => void): () => void {
    wake = callback;
    return () => {
      if (wake === callback) wake = null;
    };
  },
  publish(status: FieldStatus): void {
    current = status;
    for (const listener of listeners) listener(status);
  },
};

function request<K extends keyof typeof fieldRequests>(key: K, value: (typeof fieldRequests)[K]) {
  if (fieldRequests[key] === value) return;
  fieldRequests[key] = value;
  wake?.();
}

export const field = {
  setPreview(machine: MachineDef | null): void {
    request('preview', machine);
  },
  setHoverState(state: string | null): void {
    request('hover', state);
  },
  setNavHint(hint: NavHint): void {
    request('navHint', hint);
  },
  status(): FieldStatus {
    return current;
  },
  /** Fires about once a second and on every mode change. */
  onStatus(callback: (status: FieldStatus) => void): () => void {
    listeners.add(callback);
    return () => {
      listeners.delete(callback);
    };
  },
};
