import { invoke, isTauri } from '@tauri-apps/api/core';
import type {
  DomainRequest,
  DomainResponse,
  Evaluation,
  GraphResult,
  Preset,
  SavedSession,
  Startup,
} from './contracts';

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof error.message === 'string'
  )
    return error.message;
  return typeof error === 'string' ? error : 'The operation could not finish.';
}
export async function requestDomain(request: DomainRequest): Promise<DomainResponse> {
  if (!isTauri())
    throw new Error(
      'Start Patchbay with npm run dev. The Rust backend is available inside the desktop app.',
    );
  return invoke<DomainResponse>('domain', { request });
}
interface Payload {
  presets: Preset[];
  evaluation: Evaluation;
  graph: GraphResult;
  text: string;
}
async function response<T extends keyof Payload>(
  request: DomainRequest,
  expected: T,
): Promise<Payload[T]> {
  const result = await requestDomain(request);
  if (result.type !== expected) throw new Error('The desktop returned an unexpected response.');
  return result.value as Payload[T];
}
export const domain = {
  presets: () => response({ type: 'presets' }, 'presets') as Promise<Preset[]>,
  evaluate: (request: Extract<DomainRequest, { type: 'parse' | 'simulate' | 'convert' }>) =>
    response(request, 'evaluation') as Promise<Evaluation>,
  graph: (
    request: Extract<
      DomainRequest,
      { type: 'inspectGraph' | 'editGraph' | 'fromMachine' | 'openProject' }
    >,
  ) => response(request, 'graph') as Promise<GraphResult>,
  exportGraph: (draft: GraphResult['draft']) =>
    response({ type: 'exportGraph', draft }, 'text') as Promise<string>,
};
export const desktop = {
  startup: () => invoke<Startup>('startup'),
  saveSession: (session: SavedSession) => invoke<void>('save_session', { session }),
  openProject: () => invoke<{ name: string; source: string } | null>('open_project'),
  saveProject: (source: string, format: 'text' | 'graph') =>
    invoke<boolean>('save_project', { source, format }),
  screenshot: () => invoke<boolean>('save_screenshot'),
};
