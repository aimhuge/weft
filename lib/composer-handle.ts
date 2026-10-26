// The Composer's imperative handle: the methods callers reach through the ref. The plain-Markdown
// view (source !== null) and the rich editor (source === null) are both supported — read/write/clear
// go to whichever is on screen.
import { useImperativeHandle, type Ref } from "react";
import type { Editor } from "@tiptap/react";
import { pendingMedia } from "@/lib/media-uploads";

export interface ComposerHandle {
  focus(): void;
  // The prompt as Markdown, or throws if an upload is still running or failed.
  read(): string;
  readText(): string; // plain text as typed, for a "!" shell command that Markdown would escape
  clear(): void;
  // Replace the content with Markdown and focus the end.
  write(markdown: string): void;
  isEmpty(): boolean;
}

export function useComposerHandle({
  ref,
  source,
  setSource,
  editor,
  sourceBox,
}: {
  ref: Ref<ComposerHandle>;
  source: string | null;
  setSource: (next: string | null) => void;
  editor: Editor | null;
  sourceBox: { current: HTMLTextAreaElement | null };
}) {
  useImperativeHandle(ref, () => ({
    focus: () => (source !== null ? sourceBox.current?.focus() : editor?.commands.focus("end")),
    read: () => {
      if (source !== null) return source.trim();
      if (!editor) return "";
      const { uploading, failed } = pendingMedia(editor);
      if (uploading) throw new Error(`Wait for ${uploading === 1 ? "the upload" : `${uploading} uploads`} to finish.`);
      if (failed) throw new Error("An attachment didn't upload. Remove it and paste it again.");
      return editor.getMarkdown().trim();
    },
    readText: () => (source !== null ? source : (editor?.getText({ blockSeparator: "\n" }) ?? "")).trim(),
    clear: () => {
      if (source !== null) setSource("");
      editor?.commands.clearContent(true);
    },
    write: (markdown) => {
      if (source !== null) setSource(markdown);
      else editor?.chain().setContent(markdown, { contentType: "markdown" }).focus("end").run();
    },
    isEmpty: () => (source !== null ? !source.trim() : (editor?.isEmpty ?? true)),
  }));
}
