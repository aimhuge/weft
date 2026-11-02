// @vitest-environment jsdom
// Where a pasted file goes (components/MediaNode.tsx insertFiles): through the upload the thread's transport gives,
// so a worker card's file is saved on this Mac to travel with its message, and where there's none (weft.zip) the
// node says the file can't be attached rather than post to a server that isn't there.
import { describe, expect, it, vi } from "vitest";
import type { Editor } from "@tiptap/react";
import "./test-utils";
import { NO_UPLOAD, insertFiles } from "./MediaNode";
import { uploadOf } from "@/lib/media-uploads";

// An editor that records what was inserted and the src each upload sets.
function fakeEditor() {
  const inserted: { attrs: { uploadId: string; name: string } }[] = [];
  const marked: Record<string, unknown>[] = [];
  const chain = {
    focus: () => chain,
    insertContent: (nodes: typeof inserted) => (inserted.push(...nodes), chain),
    insertContentAt: (_pos: number, nodes: typeof inserted) => (inserted.push(...nodes), chain),
    run: () => true,
  };
  const editor = {
    isDestroyed: false,
    chain: () => chain,
    state: {
      selection: {},
      doc: { descendants: (visit: (node: unknown, at: number) => unknown) => inserted.forEach((n, i) => visit({ type: { name: "media" }, attrs: n.attrs }, i)) },
      tr: { setNodeMarkup: (_at: number, _t: unknown, attrs: Record<string, unknown>) => (marked.push(attrs), {}) },
    },
    view: { dispatch: () => {} },
  } as unknown as Editor;
  return { editor, inserted, marked };
}

const file = () => new File(["x"], "shot.png", { type: "image/png" });

describe("insertFiles", () => {
  it("uploads through the transport's upload and points the node at the saved file", async () => {
    vi.stubGlobal("URL", { ...URL, createObjectURL: () => "blob:x", revokeObjectURL: () => {} });
    const { editor, inserted, marked } = fakeEditor();
    const upload = vi.fn(() => Promise.resolve({ name: "shot.png", path: "/att/shot.png", url: "u", kind: "image" as const, bytes: 1 }));
    insertFiles(editor, [file()], upload, 3);
    expect(upload).toHaveBeenCalledWith(expect.any(File), "shot.png", expect.any(Function));
    await vi.waitFor(() => expect(marked).toEqual([expect.objectContaining({ src: "/att/shot.png", uploadId: null })]));
    expect(inserted).toHaveLength(1);
    vi.unstubAllGlobals();
  });

  it("marks the file as not attachable where the transport has no upload", async () => {
    vi.stubGlobal("URL", { ...URL, createObjectURL: () => "blob:x", revokeObjectURL: () => {} });
    const { editor, inserted } = fakeEditor();
    insertFiles(editor, [file()], undefined);
    const id = inserted[0]!.attrs.uploadId;
    await vi.waitFor(() => expect(uploadOf(id)?.error).toBe(NO_UPLOAD));
    vi.unstubAllGlobals();
  });
});
