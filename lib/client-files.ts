// The editor column's calls to /api/cards/<id>/files (lib/file-access.ts on the server): read, stat for
// live reload, the HEAD version for the diff, the folder's file list for ⌘P, and a save that refuses to
// overwrite a file that changed since it was read.

import { API_HEADERS } from "./api-client";

export interface OpenedFile {
  // Relative to the card's folder.
  path: string;
  exists: boolean;
  text: string;
  // sha1 of the text on disk; a save sends it back as baseHash.
  hash: string | null;
  mtime: number | null;
  size: number;
}

export interface FileStat {
  exists: boolean;
  mtime: number | null;
  size: number;
}

export interface SaveResult {
  hash: string;
  mtime: number;
}

// A save refused because the file changed on disk since it was read: what's there now.
export class FileConflictError extends Error {
  constructor(readonly current: OpenedFile) {
    super(`${current.path} changed on disk since you opened it.`);
    this.name = "FileConflictError";
  }
}

const HEADERS = { ...API_HEADERS, "content-type": "application/json" };

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: HEADERS });
  let data: (T & { error?: string; current?: OpenedFile }) | undefined;
  try {
    data = (await res.json()) as T & { error?: string; current?: OpenedFile };
  } catch {
    data = undefined;
  }
  if (res.status === 409 && data?.current) throw new FileConflictError(data.current);
  if (!res.ok || !data) throw new Error(data?.error ?? `Request failed (${res.status}).`);
  return data;
}

const base = (cardId: string) => `/api/cards/${encodeURIComponent(cardId)}/files`;
const q = (path: string) => `path=${encodeURIComponent(path)}`;

export const filesApi = {
  read: (cardId: string, path: string) => call<{ file: OpenedFile }>(`${base(cardId)}?${q(path)}`).then((r) => r.file),
  stat: (cardId: string, path: string) => call<{ stat: FileStat }>(`${base(cardId)}?${q(path)}&op=stat`).then((r) => r.stat),
  // The file as git HEAD has it; null when untracked or the folder isn't a repo.
  head: (cardId: string, path: string) => call<{ text: string | null }>(`${base(cardId)}?${q(path)}&op=head`).then((r) => r.text),
  list: (cardId: string) => call<{ files: string[] }>(`${base(cardId)}?op=list`).then((r) => r.files),
  // baseHash: the hash the text was read at; null for a file that didn't exist; undefined to overwrite blindly.
  write: (cardId: string, path: string, text: string, baseHash?: string | null) =>
    call<SaveResult>(base(cardId), { method: "PUT", body: JSON.stringify({ path, text, baseHash }) }),
};
