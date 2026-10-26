import type { SiteNote } from "./site-notes-format";
import type { NoteFinding } from "./site-notes-safety";
import type { ServedVersion } from "./site-notes-status";

// The desktop's side of shared site notes: weft.zip's /api/site-notes/cloud, called from the local Next server
// with the signed-in user's own access token (docs/architecture/site-notes.md#share). Reads are cached per host
// and time out fast, so a slow or offline weft.zip costs open_url at most READ_TIMEOUT_MS once per host.

export type RemoteDeps = {
  token: () => Promise<string | null>;
  fetchFn: typeof fetch;
  env: Record<string, string | undefined>;
};

const DEFAULT_URL = "https://weft.zip";
export const READ_TIMEOUT_MS = 1500;
const WRITE_TIMEOUT_MS = 8000;
export const CACHE_MS = 20 * 60 * 1000;

const base = (env: Record<string, string | undefined>) => (env.WEFT_TEAMS_URL || DEFAULT_URL).replace(/\/+$/, "");

type Reply = { status: number; json: Record<string, unknown> | null };

async function call(deps: RemoteDeps, init: { query?: string; body?: unknown; timeoutMs: number }): Promise<Reply> {
  const token = await deps.token();
  if (!token) return { status: 401, json: null };
  const headers: Record<string, string> = { authorization: `Bearer ${token}` };
  const req: RequestInit = { method: init.body === undefined ? "GET" : "POST", headers, signal: AbortSignal.timeout(init.timeoutMs) };
  if (init.body !== undefined) {
    headers["content-type"] = "application/json";
    req.body = JSON.stringify(init.body);
  }
  try {
    const res = await deps.fetchFn(`${base(deps.env)}/api/site-notes/cloud${init.query ?? ""}`, req);
    return { status: res.status, json: (await res.json()) as Record<string, unknown> };
  } catch {
    return { status: 502, json: null };
  }
}

export function toSiteNote(v: ServedVersion): SiteNote {
  return {
    host: v.host,
    path: v.path,
    body: v.body,
    updated: "",
    source: v.scope,
    versionId: v.versionId,
    confirmations: v.confirmations,
    ...(v.candidate ? { candidate: true } : {}),
    ...(v.stale ? { stale: true } : {}),
    ...(v.lastSuccess ? { lastSuccess: v.lastSuccess } : {}),
  };
}

const cache = new Map<string, { at: number; notes: SiteNote[] }>();

export function clearRemoteCache() {
  cache.clear();
}

// The team and public notes for a host, or [] when signed out, offline or slow. A failed read is cached too,
// so an offline Mac doesn't wait on every open_url.
export async function remoteNotes(host: string, contributor: boolean, deps: RemoteDeps, now = Date.now()): Promise<SiteNote[]> {
  const hit = cache.get(host);
  if (hit && now - hit.at < CACHE_MS) return hit.notes;
  const reply = await call(deps, { query: `?host=${encodeURIComponent(host)}${contributor ? "&contributor=1" : ""}`, timeoutMs: READ_TIMEOUT_MS });
  const value = reply.status === 200 && Array.isArray(reply.json?.value) ? (reply.json.value as ServedVersion[]) : [];
  const notes = value.map(toSiteNote);
  cache.set(host, { at: now, notes });
  return notes;
}

export type UploadResult = { ok: true; versionId: string } | { ok: false; error: string; findings?: NoteFinding[] };

export async function uploadRemote(upload: { host: string; path: string; body: string; scope: "team" | "public" }, deps: RemoteDeps): Promise<UploadResult> {
  const reply = await call(deps, { body: { action: "upload", ...upload }, timeoutMs: WRITE_TIMEOUT_MS });
  cache.delete(upload.host);
  const value = reply.json?.value as { versionId?: string } | undefined;
  if (reply.status === 200 && value?.versionId) return { ok: true, versionId: value.versionId };
  const error = typeof reply.json?.error === "string" ? reply.json.error : reply.status === 401 ? "signed-out" : "offline";
  const findings = reply.json?.findings as NoteFinding[] | undefined;
  return { ok: false, error, ...(findings ? { findings } : {}) };
}

export async function reportRemote(report: { versionId: string; outcome: "success" | "failure"; step?: string }, deps: RemoteDeps): Promise<boolean> {
  const reply = await call(deps, { body: { action: "report", ...report }, timeoutMs: WRITE_TIMEOUT_MS });
  return reply.status === 200;
}
