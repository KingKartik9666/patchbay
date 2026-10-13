/// <reference types="vite/client" />
interface Window {
  patchbay?: {
    openMachine(): Promise<{ name: string; source: string } | null>;
    saveMachine(source: string, format?: 'text' | 'graph'): Promise<boolean>;
    saveScreenshot(): Promise<boolean>;
    platform: string;
    minimize(): Promise<void>;
    toggleMaximize(): Promise<boolean>;
    close(): Promise<void>;
    isMaximized(): Promise<boolean>;
    onMaximized(callback: (maximized: boolean) => void): () => void;
  };
}
