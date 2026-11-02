// Type shim for ./app-data-frame.cjs: the worker-app checks its tests import (the rest reach TS through app-data.d.cts).
export function isInside(parent: string, child: string): boolean;
export function isWorkerAppPath(dataDir: string, real: string): boolean;
export function isWorkerAppPage(dataDir: string, frameUrl: unknown): boolean;
export const WORKER_APP_PREFIX: string;
export const WORKER_APP_REFUSED: string;
