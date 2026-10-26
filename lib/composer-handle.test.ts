// @vitest-environment happy-dom
import { renderHook } from "@testing-library/react";
import { createRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Editor } from "@tiptap/react";

const media = vi.hoisted(() => ({ pendingMedia: vi.fn(() => ({ uploading: 0, failed: 0 })) }));
vi.mock("@/lib/media-uploads", () => media);

import { useComposerHandle, type ComposerHandle } from "./composer-handle";

function fakeEditor(over: Record<string, unknown> = {}) {
  const run = vi.fn();
  const chain = { setContent: vi.fn(() => chain), focus: vi.fn(() => chain), run };
  const editor = {
    commands: { focus: vi.fn(), clearContent: vi.fn() },
    chain: () => chain,
    getMarkdown: () => "  **md**  ",
    getText: vi.fn(() => " plain "),
    isEmpty: true,
    ...over,
  };
  return { editor: editor as unknown as Editor, raw: editor, chain };
}

function handle(opts: { source?: string | null; editor?: Editor | null; box?: HTMLTextAreaElement | null } = {}) {
  const ref = createRef<ComposerHandle>();
  const setSource = vi.fn();
  renderHook(() =>
    useComposerHandle({ ref, source: opts.source ?? null, setSource, editor: opts.editor ?? null, sourceBox: { current: opts.box ?? null } }),
  );
  return { h: ref.current as ComposerHandle, setSource };
}

beforeEach(() => media.pendingMedia.mockReturnValue({ uploading: 0, failed: 0 }));

describe("the rich editor", () => {
  it("focuses the end and reads Markdown trimmed", () => {
    const { editor, raw } = fakeEditor();
    const { h } = handle({ editor });
    h.focus();
    expect(raw.commands.focus).toHaveBeenCalledWith("end");
    expect(h.read()).toBe("**md**");
  });

  it("refuses to read while an upload runs or after one failed", () => {
    const { editor } = fakeEditor();
    const { h } = handle({ editor });
    media.pendingMedia.mockReturnValue({ uploading: 1, failed: 0 });
    expect(() => h.read()).toThrow("Wait for the upload to finish.");
    media.pendingMedia.mockReturnValue({ uploading: 3, failed: 0 });
    expect(() => h.read()).toThrow("Wait for 3 uploads to finish.");
    media.pendingMedia.mockReturnValue({ uploading: 0, failed: 1 });
    expect(() => h.read()).toThrow("An attachment didn't upload");
  });

  it("reads plain text, clears, writes and reports empty", () => {
    const { editor, raw, chain } = fakeEditor();
    const { h, setSource } = handle({ editor });
    expect(h.readText()).toBe("plain");
    h.clear();
    expect(raw.commands.clearContent).toHaveBeenCalledWith(true);
    expect(setSource).not.toHaveBeenCalled();
    h.write("# hi");
    expect(chain.setContent).toHaveBeenCalledWith("# hi", { contentType: "markdown" });
    expect(chain.run).toHaveBeenCalled();
    expect(h.isEmpty()).toBe(true);
  });
});

describe("no editor yet", () => {
  it("is quiet and empty", () => {
    const { h } = handle();
    h.focus();
    expect(h.read()).toBe("");
    expect(h.readText()).toBe("");
    h.clear();
    h.write("x");
    expect(h.isEmpty()).toBe(true);
  });

  it("reads plain text from an editor that returns nothing", () => {
    const { editor } = fakeEditor({ getText: () => undefined });
    expect(handle({ editor }).h.readText()).toBe("");
  });
});

describe("the Markdown source view", () => {
  it("focuses the textarea and reads the source", () => {
    const box = document.createElement("textarea");
    const focus = vi.spyOn(box, "focus");
    const { h } = handle({ source: "  # src  ", box });
    h.focus();
    expect(focus).toHaveBeenCalled();
    expect(h.read()).toBe("# src");
    expect(h.readText()).toBe("# src");
    expect(h.isEmpty()).toBe(false);
  });

  it("focuses nothing without a textarea and is empty for blank source", () => {
    const { h } = handle({ source: "   " });
    h.focus();
    expect(h.isEmpty()).toBe(true);
  });

  it("clears and writes the source, and the editor too if it's mounted", () => {
    const { editor, raw, chain } = fakeEditor();
    const { h, setSource } = handle({ source: "abc", editor });
    h.clear();
    expect(setSource).toHaveBeenCalledWith("");
    expect(raw.commands.clearContent).toHaveBeenCalled();
    h.write("new");
    expect(setSource).toHaveBeenCalledWith("new");
    expect(chain.setContent).not.toHaveBeenCalled();
  });
});
