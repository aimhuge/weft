// Type shim for ./show-export.cjs so its test gets real types instead of `any`.

import type { OwnsPane } from "./app-setup.d.cts";

export interface ExportFile {
  name: string;
  text?: string;
  base64?: string;
  from?: string;
}

export interface ExportResult {
  ok: boolean;
  dir?: string;
  files?: number;
  written?: number;
  error?: string;
}

export function registerShowExport(
  ipcMain: { handle: (channel: string, fn: (event: unknown, ...args: unknown[]) => unknown) => void },
  opts: { owns: OwnsPane; dataDir: string },
): void;

export function pageFolder(dataDir: string, frameUrl: string): string | null;
export function besidePage(folder: string, src: string): string | null;
export function cleanFiles(folder: string, raw: unknown): { name: string; body: Buffer }[];
export function writeExport(folder: string, files: { name: string; body: Buffer }[]): ExportResult;
export const MAX_FILES: number;
