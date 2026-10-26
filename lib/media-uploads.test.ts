import type { Editor } from "@tiptap/react";
import { describe, expect, it, vi } from "vitest";
import { finishUpload, onUploadChange, pendingMedia, setUpload, uploadOf } from "./media-uploads";

// The composer's uploads store (lib/media-uploads.ts): progress, previews and errors by upload id, and
// what the editor's document still waits on.

// An editor whose document holds these nodes, as descendants() walks them.
const editorWith = (nodes: { name: string; uploadId?: string | null }[]) =>
  ({
    state: {
      doc: {
        descendants: (visit: (node: { type: { name: string }; attrs: { uploadId?: string | null } }) => void) =>
          nodes.forEach((n) => visit({ type: { name: n.name }, attrs: { uploadId: n.uploadId } })),
      },
    },
  }) as unknown as Editor;

describe("media uploads", () => {
  it("merges each patch over what the upload had, starting at 0%, and tells every listener", () => {
    const listener = vi.fn();
    const stop = onUploadChange(listener);
    setUpload("u1", { preview: "blob:1" });
    expect(uploadOf("u1")).toEqual({ progress: 0, preview: "blob:1" });
    setUpload("u1", { progress: 40 });
    expect(uploadOf("u1")).toEqual({ progress: 40, preview: "blob:1" });
    expect(listener).toHaveBeenCalledTimes(2);
    stop();
    setUpload("u1", { progress: 80 });
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("drops a finished upload, answering its preview, and tells the listeners", () => {
    const listener = vi.fn();
    const stop = onUploadChange(listener);
    setUpload("u2", { preview: "blob:2" });
    expect(finishUpload("u2")).toBe("blob:2");
    expect(uploadOf("u2")).toBeUndefined();
    expect(finishUpload("never")).toBeUndefined();
    expect(listener).toHaveBeenCalledTimes(3);
    stop();
  });

  it("counts the document's media still uploading and the ones that failed, skipping the rest", () => {
    setUpload("up", { progress: 10 });
    setUpload("bad", { error: "Too big" });
    const editor = editorWith([
      { name: "paragraph" },
      { name: "media", uploadId: "up" },
      { name: "media", uploadId: "bad" },
      { name: "media", uploadId: null },
      { name: "media" },
      { name: "media", uploadId: "unknown" },
    ]);
    expect(pendingMedia(editor)).toEqual({ uploading: 2, failed: 1 });
  });
});
