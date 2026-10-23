// Shared test helpers for lib/app-preview-capture.test.ts. The vi.hoisted mocks can't be re-exported
// from a helper, so the test file declares its own; what lives here is the pure side of the setup:
// the state shape the mocks share, the Ready contexts (the client, the workspace, the app and the
// page) and the fixtures that put a site or a folder app on disk. The split keeps the test file
// under the 300-line cap.
import fs from "node:fs";
import path from "node:path";
import { vi } from "vitest";

// The mocked shell (Electron's control server), Haiku and the blob store, and the row's write.
export interface CaptureState {
  shell: { png?: unknown } | null;
  shellThrows: boolean;
  haiku: string | null;
  haikuThrows: boolean;
  uploaded: string[];
  uploadRef: string | null;
  writes: { row: Record<string, unknown>; filters: Record<string, unknown> }[];
  pendingRow: Record<string, unknown>;
  writeError: { message: string } | null;
  writeThrows: unknown;
}

export function emptyCaptureState(): CaptureState {
  return {
    shell: null,
    shellThrows: false,
    haiku: null,
    haikuThrows: false,
    uploaded: [],
    uploadRef: null,
    writes: [],
    pendingRow: {},
    writeError: null,
    writeThrows: null,
  };
}

export const APP = { id: "app1", name: "Growth", url: "https://example.com/app" };

// A Ready context (lib/app-share-row.ts): the client, the workspace, the app and the page. The client
// records the row's write; it can also fail, with an error or with something that isn't one.
export function ready(state: CaptureState, page: unknown): never {
  const filters: Record<string, unknown> = {};
  const then = (
    done: (r: { error: { message: string } | null }) => unknown,
    fail?: (err: unknown) => unknown,
  ) => {
    state.writes.push({ row: state.pendingRow, filters });
    if (state.writeThrows !== null) return Promise.resolve(fail ? fail(state.writeThrows) : undefined);
    return Promise.resolve({ error: state.writeError }).then(done);
  };
  const client = {
    from: (table: string) => {
      if (table !== "cloud_app_shares") throw new Error(`unexpected table ${table}`);
      return {
        update: (row: Record<string, unknown>) => {
          state.pendingRow = row;
          return { eq: (col: string, value: unknown) => { filters[col] = value; return { then }; } };
        },
      };
    },
  };
  return { client, orgId: "o1", userId: "u1", app: APP, page } as never;
}

export const sitePage = (state: CaptureState, url = "https://example.com/app") =>
  ready(state, { kind: "site", url });
export const blobPage = (state: CaptureState, local: string) => ready(state, { kind: "blob", local, hash: "" });
export const folderPage = (state: CaptureState, folder: string, entry = "index.html") =>
  ready(state, { kind: "folder", folder, entry, files: [], manifest: {} });

// A site that answers with this html.
export function stubSite(html: string, contentType = "text/html") {
  const fetchMock = vi.fn(() =>
    Promise.resolve(new Response(html, { headers: contentType ? { "content-type": contentType } : {} })),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

// A page with enough words for Haiku to be asked about it.
export const LONG_PAGE = "<p>A page with quite a lot of words on it, more than forty characters in all.</p>";

// A folder app on disk, with a weft-app.json when one is given.
export function folderFixture(sandbox: string, manifest?: string) {
  const folder = path.join(sandbox, "app");
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, "index.html"), "<p>text</p>");
  if (manifest !== undefined) fs.writeFileSync(path.join(folder, "weft-app.json"), manifest);
  return folder;
}
