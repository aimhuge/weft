import { describe, expect, it, vi } from "vitest";
import { sendOutbox, type SendDeps } from "./site-notes-send";
import type { UploadResult } from "./site-notes-remote";
import type { OutboxItem } from "./site-notes-store";

// Sending the outbox to everyone: a note weft.zip refuses is dropped with its reason; one that couldn't
// go (offline, signed out) waits for next time.

const item = (over: Partial<OutboxItem> = {}): OutboxItem => ({ id: "example.com/p", host: "example.com", path: "/p", body: "body", queuedAt: "2026-01-01T00:00:00.000Z", ...over });

type Upload = { host: string; path: string; body: string; scope: "public" };
type UploadMock = (u: Upload) => Promise<UploadResult>;
const uploadMock = (result: UploadResult): UploadMock => () => Promise.resolve(result);

function fakeDeps(items: OutboxItem[], over: Partial<SendDeps> = {}) {
  const taken: (string[] | undefined)[] = [];
  const requeued: OutboxItem[] = [];
  const uploaded: Upload[] = [];
  const deps: SendDeps = {
    take: vi.fn((ids?: string[]) => {
      taken.push(ids);
      return ids ? items.filter((i) => ids.includes(i.id)) : items;
    }),
    requeue: vi.fn((i: OutboxItem) => requeued.push(i)),
    upload: vi.fn<UploadMock>((u) => {
      uploaded.push(u);
      return Promise.resolve({ ok: true, versionId: "v1" });
    }),
    ...over,
  };
  return { deps, taken, requeued, uploaded };
}

describe("sendOutbox", () => {
  it("sends every queued note publicly", async () => {
    const { deps, uploaded } = fakeDeps([item()]);
    expect(await sendOutbox(undefined, deps)).toEqual([{ id: "example.com/p", sent: true }]);
    expect(uploaded).toEqual([{ host: "example.com", path: "/p", body: "body", scope: "public" }]);
  });

  it("sends only the notes it was asked for", async () => {
    const { deps, uploaded } = fakeDeps([item({ id: "a" }), item({ id: "b", path: "/q" })]);
    expect(await sendOutbox(["b"], deps)).toEqual([{ id: "b", sent: true }]);
    expect(uploaded).toHaveLength(1);
    expect(uploaded[0]?.path).toBe("/q");
  });

  it("drops a note the server refuses, with its reason", async () => {
    const { deps, requeued } = fakeDeps([item()], { upload: vi.fn<UploadMock>(uploadMock({ ok: false, error: "not-public-host" })) });
    expect(await sendOutbox(undefined, deps)).toEqual([{ id: "example.com/p", sent: false, error: "not-public-host" }]);
    expect(requeued).toEqual([]);
  });

  it("keeps a note that couldn't go for next time", async () => {
    for (const error of ["offline", "signed-out", "too-many", "unconfigured"]) {
      const { deps, requeued } = fakeDeps([item()], { upload: vi.fn<UploadMock>(uploadMock({ ok: false, error })) });
      expect(await sendOutbox(undefined, deps)).toEqual([{ id: "example.com/p", sent: false, error }]);
      expect(requeued).toEqual([item()]);
    }
  });

  it("sends the ones it can and reports each one", async () => {
    const items = [item({ id: "a" }), item({ id: "b" })];
    let call = 0;
    const { deps } = fakeDeps(items, {
      upload: vi.fn<UploadMock>(() => Promise.resolve(++call === 1 ? { ok: true, versionId: "v1" } : { ok: false, error: "offline" })),
    });
    expect(await sendOutbox(undefined, deps)).toEqual([
      { id: "a", sent: true },
      { id: "b", sent: false, error: "offline" },
    ]);
  });

  it("is empty when there is nothing to send", async () => {
    const { deps } = fakeDeps([]);
    expect(await sendOutbox(undefined, deps)).toEqual([]);
  });
});
