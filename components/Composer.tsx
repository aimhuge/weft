"use client";

import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Placeholder } from "@tiptap/extensions";
import { Markdown } from "@tiptap/markdown";
import { forwardRef, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { mediaMarkdown } from "@/lib/media";
import { LOOKS_LIKE_MARKDOWN } from "@/lib/composer-slash";
import { useComposerHandle, type ComposerHandle } from "@/lib/composer-handle";
import { useThreadTransport } from "@/lib/thread-transport";
import { useComposerKeys } from "@/lib/use-composer-keys";
import { useDictation } from "@/lib/use-dictation";
import { useDesktopDictation } from "@/lib/use-desktop-dictation";
import { useHandedFiles } from "@/lib/use-file-drop";
import { removeFromEditor, SecretBars, useComposerSecrets } from "./SecretPaste";
import { Media, NO_UPLOAD, insertFiles } from "./MediaNode";
import { useComposerTypeaheads } from "./use-composer-typeaheads";
import ComposerFormatBar from "./ComposerFormatBar";
import ComposerBottomBar from "./ComposerBottomBar";
import ComposerSourceTextarea from "./ComposerSourceTextarea";
import { submitKeys } from "./submit-keys";

export type { ComposerHandle };

// The prompt box for new threads and replies: rich text that reads and writes Markdown, images and
// videos pasted or dropped right where they go, dictation, and a raw Markdown view.
const Composer = forwardRef<
  ComposerHandle,
  {
    // A draft to start from, as Markdown.
    initial?: string;
    placeholder: string;
    autoFocus?: boolean;
    // A reply box sends on Enter and keeps its formatting bar folded; a new thread sends on ⌘↵.
    variant: "dialog" | "reply";
    onSubmit: () => void;
    // ⌃↵ on macOS, where ⌘ is the mod key: the New thread dialog starts the thread and stays open.
    onSubmitAlt?: () => void;
    // Called with the Markdown as it changes, for saving drafts.
    onChange?: (markdown: string) => void;
    // Buttons at the right end of the bottom bar, such as Send.
    actions?: ReactNode;
    modelPicker?: ReactNode;
    // A line at the top inside the frame, such as the reply box's mode chip.
    header?: ReactNode;
    // The editing area's height, e.g. "min-h-[260px] max-h-[55vh]".
    sizeClass: string;
    // Classes for the outer frame, e.g. "flex-1" to fill a dialog.
    className?: string;
    // The folder the thread works in; typing "/" suggests the skills available there.
    cwd?: string;
    // The card a reply box writes to, whose host lists those skills (lib/thread-transport.ts listSkills).
    cardId?: string;
    // Files dropped elsewhere for this composer (a card id, or "new"; lib/file-drop.ts) land here.
    dropTarget?: string;
  }
>(function Composer(
  { initial = "", placeholder, autoFocus, variant, onSubmit, onSubmitAlt, onChange, actions, modelPicker, header, sizeClass, className = "", cwd, cardId, dropTarget },
  ref,
) {
  const [source, setSource] = useState<string | null>(null);
  const [showFormat, setShowFormat] = useState(variant === "dialog");
  const [dragging, setDragging] = useState(false);
  const secrets = useComposerSecrets();
  const fileInput = useRef<HTMLInputElement>(null);
  const sourceBox = useRef<HTMLTextAreaElement>(null);
  // The editor, for the paste and drop handlers, which are set up before it exists.
  const editorRef = useRef<Editor | null>(null);
  const onSubmitRef = useRef(onSubmit);
  const onSubmitAltRef = useRef(onSubmitAlt);
  const onChangeRef = useRef(onChange);
  const placeholderRef = useRef(placeholder);
  // Pasted files go where the card's host keeps them (lib/thread-transport.ts upload).
  const { upload } = useThreadTransport();
  const uploadRef = useRef(upload);
  useEffect(() => {
    onSubmitRef.current = onSubmit;
    onSubmitAltRef.current = onSubmitAlt;
    onChangeRef.current = onChange;
    uploadRef.current = upload;
  });

  const editor = useEditor({
    immediatelyRender: false,
    autofocus: autoFocus ? "end" : false,
    content: initial,
    contentType: "markdown",
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        // Markdown has no underline.
        underline: false,
        link: { openOnClick: false, autolink: true, defaultProtocol: "https" },
      }),
      Placeholder.configure({ placeholder: () => placeholderRef.current }),
      Markdown,
      Media,
      submitKeys(variant, () => ({ submit: onSubmitRef.current, submitAlt: onSubmitAltRef.current })),
    ],
    editorProps: {
      attributes: {
        class: `composer-content md-body outline-none px-3.5 py-3 ${sizeClass} overflow-y-auto`,
      },
      handlePaste: (view, event) => {
        const files = [...(event.clipboardData?.files ?? [])];
        const text = event.clipboardData?.getData("text/plain") ?? "";
        const html = event.clipboardData?.getData("text/html") ?? "";
        if (secrets.paste.hold(text)) return true;
        // Copying a picture gives the file plus a scrap of HTML or alt text; copying from a
        // spreadsheet gives a picture of the cells plus the text, and the text is what's wanted.
        if (files.length && (!text.trim() || (html.includes("<img") && text.length < 300))) {
          if (editorRef.current) insertFiles(editorRef.current, files, uploadRef.current);
          return true;
        }
        if (!html && text && LOOKS_LIKE_MARKDOWN.test(text) && !editorRef.current?.isActive("codeBlock")) {
          editorRef.current?.chain().focus().insertContent(text, { contentType: "markdown" }).run();
          return true;
        }
        return false;
      },
      handleDrop: (view, event, _slice, moved) => {
        const files = [...(event.dataTransfer?.files ?? [])];
        if (moved || !files.length || !editorRef.current) return false;
        event.preventDefault();
        const pos = view.posAtCoords({
          left: event.clientX,
          top: event.clientY,
        })?.pos;
        insertFiles(editorRef.current, files, uploadRef.current, pos);
        return true;
      },
    },
    onUpdate: ({ editor: e }) => {
      onChangeRef.current?.(e.getMarkdown());
      secrets.setPlain(e.getText({ blockSeparator: "\n" }));
    },
  });
  useEffect(() => {
    editorRef.current = editor;
  }, [editor]);

  // Typing "/" offers the skills for this folder, "@" people (lib/use-composer-typeaheads.ts).
  const { typeahead, pick, list } = useComposerTypeaheads(editor, cwd, cardId, variant);

  // The placeholder can change (a reply box while its thread works); redraw it when it does.
  useEffect(() => {
    placeholderRef.current = placeholder;
    if (editor && !editor.isDestroyed) editor.view.dispatch(editor.state.tr.setMeta("placeholder", placeholder));
  }, [editor, placeholder]);

  function insertIntoSource(text: string) {
    const box = sourceBox.current;
    const current = source ?? "";
    const at = box ? box.selectionStart : current.length;
    const next = current.slice(0, at) + text + current.slice(box ? box.selectionEnd : at);
    editSource(next);
    requestAnimationFrame(() => {
      box?.focus();
      box?.setSelectionRange(at + text.length, at + text.length);
    });
  }

  const recorder = useDictation((text) => {
    if (source !== null) {
      insertIntoSource(text);
      return;
    }
    if (!editor) return;
    // Keep a space between dictated text and what's before it.
    const { from } = editor.state.selection;
    const before = editor.state.doc.textBetween(Math.max(0, from - 1), from, "\n", "\n");
    editor
      .chain()
      .focus()
      .insertContent(before && !/\s/.test(before) ? ` ${text}` : text)
      .run();
  });

  // In the desktop app the floating pill records; the caret goes back here first so its text lands in this composer.
  const focusForDictation = useCallback(() => {
    if (source !== null) sourceBox.current?.focus();
    else editor?.commands.focus();
  }, [source, editor]);
  const dictation = useDesktopDictation(recorder, focusForDictation);

  const { onKeyDownCapture, onKeyDown } = useComposerKeys({ typeahead, dictation, pickSkill: pick });

  // The Markdown view's text changed: by typing, an insert, or Remove it.
  function editSource(next: string) {
    setSource(next);
    secrets.setPlain(next);
    onChangeRef.current?.(next);
  }

  // In the Markdown view, a pasted file is uploaded first and its Markdown inserted after.
  async function uploadIntoSource(files: File[]) {
    for (const file of files) {
      try {
        if (!upload) throw new Error(NO_UPLOAD);
        const saved = await upload(file, file.name || "pasted-image.png");
        insertIntoSource(`${mediaMarkdown(file.name || saved.name, saved.path)}\n`);
      } catch (err) {
        window.alert(err instanceof Error ? err.message : String(err));
      }
    }
  }

  function toggleSource() {
    if (!editor) return;
    if (source === null) {
      setSource(editor.getMarkdown());
      requestAnimationFrame(() => sourceBox.current?.focus());
    } else {
      editor.commands.setContent(source, { contentType: "markdown" });
      setSource(null);
      requestAnimationFrame(() => editor.commands.focus("end"));
    }
  }

  useComposerHandle({ ref, source, setSource, editor, sourceBox });

  // Files dropped on this composer's card, thread or the empty board go in at the cursor.
  useHandedFiles(editor && !editor.isDestroyed ? dropTarget : undefined, (files) =>
    source !== null ? void uploadIntoSource(files) : editor && insertFiles(editor, files, upload),
  );

  return (
    <div
      onKeyDownCapture={onKeyDownCapture}
      onKeyDown={onKeyDown}
      onDragEnter={(e) => e.dataTransfer.types.includes("Files") && setDragging(true)}
      onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setDragging(false)}
      onDrop={(e) => {
        setDragging(false);
        // The editor places a drop on its text itself. One on the bars around it goes in at the cursor;
        // the Markdown view is a plain textarea, so its files upload and their Markdown goes in.
        const files = [...e.dataTransfer.files];
        if (e.defaultPrevented || !files.length) return;
        e.preventDefault();
        if (source !== null) void uploadIntoSource(files);
        else if (editor) insertFiles(editor, files, upload);
      }}
      className={`composer relative flex min-h-0 flex-col rounded-lg border bg-canvas transition-colors focus-within:border-accent ${
        dragging ? "border-accent bg-accent-soft" : "border-line-strong"
      } ${className}`}
    >
      {list}

      {header}

      {showFormat && editor && source === null && (
        <div className="flex shrink-0 items-center border-b border-line px-1.5 py-1">
          <ComposerFormatBar editor={editor} />
        </div>
      )}

      {source !== null ? (
        <ComposerSourceTextarea
          sourceBox={sourceBox}
          value={source}
          onChange={editSource}
          sizeClass={sizeClass}
          variant={variant}
          hasAlt={Boolean(onSubmitAltRef.current)}
          onSubmitRef={onSubmitRef}
          onSubmitAltRef={onSubmitAltRef}
          secrets={secrets}
          uploadIntoSource={uploadIntoSource}
        />
      ) : (
        <EditorContent editor={editor} className="min-h-0 flex-1 overflow-hidden" />
      )}

      <SecretBars
        guard={secrets}
        onInsert={(text) => (source === null ? secrets.paste.pasteInto(editor?.view, text) : insertIntoSource(text))}
        onRemove={(value) => (source === null ? removeFromEditor(editor, value) : editSource(source.replace(value, "")))}
      />

      {dragging && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-lg text-[13px] font-medium text-accent">
          Drop images or videos to add them here
        </div>
      )}

      <ComposerBottomBar
        editor={editor}
        source={source}
        variant={variant}
        showFormat={showFormat}
        setShowFormat={setShowFormat}
        toggleSource={toggleSource}
        dictation={dictation}
        fileInput={fileInput}
        uploadIntoSource={uploadIntoSource}
        modelPicker={modelPicker}
        actions={actions}
      />
    </div>
  );
});

export default Composer;
