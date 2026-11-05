// @vitest-environment jsdom
// weft.zip's transport and host (components/web-board/useCloudTransport.ts): pasted files up to the workspace's blobs, the
// held-edit choices and a subagent's Stop as host verbs, and one host whose acts are the same rows.
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { NewCommand } from "@/lib/cloud-commands";
import { useCloudTransport, webUploadsFor } from "./useCloudTransport";

function client(uploadError: string | null = null) {
  const uploads: { path: string; type?: string }[] = [];
  const read = { select: () => read, eq: () => read, maybeSingle: () => Promise.resolve({ data: { status: "done", error: null }, error: null }) };
  return {
    uploads,
    from: () => read,
    storage: {
      from: () => ({
        upload: (path: string, _bytes: unknown, opts: { contentType?: string }) => {
          uploads.push({ path, type: opts.contentType });
          return Promise.resolve({ error: uploadError ? { message: uploadError } : null });
        },
      }),
    },
  };
}

describe("webUploadsFor", () => {
  // jsdom has no object URLs.
  URL.createObjectURL = () => "blob:preview";
  it("puts a file under the workspace and its sha, as its type", async () => {
    const c = client();
    const got = await webUploadsFor(c as never, "o1").upload(new Blob([new Uint8Array([1])], { type: "image/png" }), "a.png");
    expect(c.uploads).toEqual([{ path: expect.stringMatching(/^o1\/[0-9a-f]{64}$/) as string, type: "image/png" }]);
    expect(got.path).toMatch(/^\/attachments\/a-[0-9a-f]{8}\.png$/);
  });

  it("counts one already there as uploaded, and says why another couldn't go", async () => {
    const file = new Blob([new Uint8Array([2])], { type: "image/png" });
    await expect(webUploadsFor(client("The resource already exists") as never, "o1").upload(file, "a.png")).resolves.toMatchObject({ kind: "image" });
    await expect(webUploadsFor(client("denied") as never, "o1").upload(file, "a.png")).rejects.toThrow("denied");
  });
});

describe("useCloudTransport", () => {
  function setup() {
    const rows: NewCommand[] = [];
    const sendCommand = vi.fn((row: NewCommand) => (rows.push(row), Promise.resolve({ id: `cmd-${rows.length}` })));
    const target = (cardId: string) => ({ orgId: "o1", device: "mac-1", folder: "/f", cardId });
    const uploads = { upload: vi.fn(), refsFor: () => [], send: vi.fn() };
    const bus = { subscribe: () => () => {} };
    const tools = vi.fn();
    const { result } = renderHook(() => useCloudTransport({ client: client() as never, orgId: "o1", bus, target, sendCommand, uploads, tools }));
    return { rows, result, uploads, tools };
  }

  it("sends Wait, This first, Others first and a subagent's Stop as host verbs", async () => {
    const { rows, result } = setup();
    const t = result.current.transport;
    await t.waitPermission?.("c1", "p1");
    await t.putFirst?.("c1", "p1");
    await t.putHolderFirst?.("c1", "p1");
    await t.stopTask?.("c1", "task-1");
    expect(rows.map((r) => r.payload)).toEqual([
      { verb: "card.permission.wait", args: { pendingId: "p1", id: "c1" } },
      { verb: "card.permission.first", args: { pendingId: "p1", id: "c1" } },
      { verb: "card.permission.otherFirst", args: { pendingId: "p1", id: "c1" } },
      { verb: "card.stopTask", args: { taskId: "task-1", id: "c1" } },
    ]);
  });

  it("offers the card's edits and uploads, and its host acts through the same rows", async () => {
    const { rows, result, uploads, tools } = setup();
    expect(result.current.transport).toMatchObject({ cardEdits: true, desktop: false, upload: uploads.upload });
    expect(result.current.host.tools).toBe(tools);
    await result.current.host.act("card.update", { id: "c1", body: { title: "T" } });
    expect(rows.at(-1)?.payload).toEqual({ verb: "card.update", args: { body: { title: "T" }, id: "c1" } });
  });
});
