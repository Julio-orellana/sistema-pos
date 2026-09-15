/// <reference types="vite/client" />

import type { ApiPos } from '@shared/types/ipc';

declare global {
  interface Window {
    /** Única puerta del renderer hacia el proceso principal (ver preload). */
    readonly pos: ApiPos;
  }
}

export {};
