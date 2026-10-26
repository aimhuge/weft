"use client";

import { Node, NodeViewWrapper, ReactNodeViewRenderer, type Editor, type NodeViewProps } from "@tiptap/react";
import { NodeSelection } from "@tiptap/pm/state";
import { useSyncExternalStore } from "react";
import { api } from "@/lib/client";
import { mediaKind, mediaMarkdown, mediaUrl, type MediaKind } from "@/lib/media";
import { finishUpload, onUploadChange, setUpload, uploadOf, type Upload } from "@/lib/media-uploads";
import Icon, { Spinner } from "./Icon";

// An image, video, or file pasted or dropped into the composer. It sits where it was pasted, and
// serializes to ![name](path) once its upload has finished. The uploads in flight live in
// lib/media-uploads.ts.

function useUpload(id: string | null) {
  return useSyncExternalStore(
    (onChange) => onUploadChange(onChange),
    () => (id ? uploadOf(id) : undefined),
    () => undefined,
  );
}

function kindOfFile(file: File): MediaKind {
  if (/^image\/(png|jpe?g|gif|webp|svg\+xml)$/.test(file.type)) return "image";
  if (file.type.startsWith("video/")) return "video";
  if (file.type.startsWith("audio/")) return "audio";
  return mediaKind(file.name);
}

// Clipboard images arrive as "image.png"; give them a name that says where they came from.
function nameOf(file: File, kind: MediaKind) {
  if (file.name && file.name !== "image.png") return file.name;
  const ext = file.type.split("/")[1]?.replace("jpeg", "jpg").replace(/\+.*/, "") || "png";
  return `${kind === "video" ? "pasted-video" : kind === "audio" ? "pasted-audio" : "pasted-image"}.${ext}`;
}

// Inserts a node for each file (at pos, or the cursor) and uploads them.
export function insertFiles(editor: Editor, files: File[], pos?: number) {
  const nodes = files.map((file) => {
    const id = crypto.randomUUID();
    const kind = kindOfFile(file);
    const name = nameOf(file, kind);
    setUpload(id, { preview: kind === "file" ? undefined : URL.createObjectURL(file), progress: 0 });
    api
      .uploadAttachment(file, name, (progress) => setUpload(id, { progress }))
      .then((saved) => {
        if (!editor.isDestroyed) {
          editor.state.doc.descendants((node, at) => {
            if (node.type.name !== "media" || node.attrs.uploadId !== id) return;
            editor.view.dispatch(editor.state.tr.setNodeMarkup(at, undefined, { ...node.attrs, src: saved.path, uploadId: null }));
            return false;
          });
        }
        // The node shows the saved file now; let it load before dropping the local copy.
        const preview = finishUpload(id);
        if (preview) setTimeout(() => URL.revokeObjectURL(preview), 10_000);
      })
      .catch((err: unknown) => setUpload(id, { error: err instanceof Error ? err.message : String(err) }));
    return { type: "media", attrs: { src: null, name, kind, uploadId: id } };
  });
  const chain = editor.chain().focus();
  (pos === undefined ? chain.insertContent(nodes) : chain.insertContentAt(pos, nodes)).run();
  // Leave the cursor after the new media, not on it, so typing or pasting again doesn't replace it.
  const { selection } = editor.state;
  if (selection instanceof NodeSelection) {
    const after = selection.to;
    const next = editor.state.doc.resolve(after).nodeAfter;
    const chainAfter = editor.chain();
    if (!next?.isTextblock) chainAfter.insertContentAt(after, { type: "paragraph" });
    chainAfter.setTextSelection(after + 1).scrollIntoView().run();
  }
}

// Uploads still running, and ones that failed, in the editor's document.
export { pendingMedia } from "@/lib/media-uploads";

function formatPercent(fraction: number) {
  return `${Math.round(fraction * 100)}%`;
}

// The strip along the bottom of a media node while it uploads, then while the server saves it, or why it failed.
function UploadBar({ upload }: { upload?: Upload }) {
  const progress = upload?.progress ?? 0;
  return (
    <span className="absolute inset-x-0 bottom-0 flex items-center gap-2 rounded-b-lg bg-black/60 px-2 py-1 text-[11px] text-white">
      {upload?.error ? (
        <span className="truncate">Upload failed: {upload.error}</span>
      ) : (
        <>
          <Spinner size={10} />
          <span>{progress >= 1 ? "Saving…" : `Uploading ${formatPercent(progress)}`}</span>
          <span className="h-1 flex-1 overflow-hidden rounded bg-white/25">
            <span className="block h-full bg-white" style={{ width: formatPercent(progress) }} />
          </span>
        </>
      )}
    </span>
  );
}

function MediaView({ node, selected, deleteNode }: NodeViewProps) {
  const { src, name, kind, uploadId } = node.attrs as MediaAttrs;
  const upload = useUpload(uploadId);
  const url = upload?.preview ?? (src ? mediaUrl(src) : null);
  const busy = Boolean(uploadId) && !upload?.error;

  return (
    <NodeViewWrapper
      data-drag-handle
      className={`group relative my-2 inline-block max-w-full rounded-lg border align-top ${
        selected ? "border-accent ring-2 ring-accent/40" : "border-line-strong"
      } ${upload?.error ? "border-danger" : ""}`}
      title={src ?? name}
    >
      {kind === "image" && url ? (
        <img src={url} alt={name} draggable={false} className="block max-h-72 max-w-full rounded-lg object-contain" />
      ) : kind === "video" && url ? (
        <video src={url} controls preload="metadata" className="block max-h-72 max-w-full rounded-lg bg-black" />
      ) : kind === "audio" && url ? (
        <span className="flex flex-col gap-1 px-3 py-2">
          <span className="max-w-[260px] truncate text-[12.5px] text-ink">{name}</span>
          <audio src={url} controls preload="metadata" className="h-8 w-[260px] max-w-full" />
        </span>
      ) : (
        <span className="flex items-center gap-2 px-3 py-2 text-[12.5px] text-ink">
          <Icon name="file" size={14} className="text-muted" />
          <span className="max-w-[260px] truncate">{name}</span>
        </span>
      )}

      {(busy || upload?.error) && <UploadBar upload={upload} />}

      <button
        type="button"
        contentEditable={false}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => deleteNode()}
        aria-label={`Remove ${name}`}
        className="absolute right-1.5 top-1.5 rounded-md bg-black/60 p-1 text-white opacity-0 transition-opacity hover:bg-black/80 focus:opacity-100 group-hover:opacity-100"
      >
        <Icon name="x" size={12} />
      </button>
    </NodeViewWrapper>
  );
}

// A media node's attributes, as addAttributes below declares them.
type MediaAttrs = { src: string | null; name: string; kind: MediaKind; uploadId: string | null };

// Only web URLs and file paths survive a paste; data: and blob: sources would bloat the prompt.
function usableSrc(src: string | null) {
  return src && (/^https?:\/\//.test(src) || src.startsWith("/")) ? src : null;
}

export const Media = Node.create({
  name: "media",
  group: "block",
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      src: { default: null },
      name: { default: "" },
      kind: { default: "file" },
      uploadId: { default: null, rendered: false },
    };
  },

  parseHTML() {
    return [
      {
        tag: "figure[data-media]",
        getAttrs: (el) => {
          const src = usableSrc(el.getAttribute("data-src"));
          return src ? { src, name: el.getAttribute("data-name") ?? "", kind: mediaKind(src) } : false;
        },
      },
      {
        tag: "img[src]",
        getAttrs: (el) => {
          const src = usableSrc(el.getAttribute("src"));
          return src ? { src, name: el.getAttribute("alt") ?? "", kind: "image" } : false;
        },
      },
      {
        tag: "video[src]",
        getAttrs: (el) => {
          const src = usableSrc(el.getAttribute("src"));
          return src ? { src, name: "", kind: "video" } : false;
        },
      },
    ];
  },

  renderHTML({ node }) {
    const { src, name } = node.attrs as MediaAttrs;
    return ["figure", { "data-media": "", "data-src": src ?? "", "data-name": name }];
  },

  addNodeView() {
    return ReactNodeViewRenderer(MediaView);
  },

  // ![name](path) on its own line; the paragraph parser hands a lone image token to us.
  markdownTokenName: "image",
  parseMarkdown: (token, helpers) => {
    const src = String(token.href ?? "");
    return helpers.createNode("media", { src, name: token.text ?? "", kind: mediaKind(src) });
  },
  renderMarkdown: (node) => {
    const { src, name } = (node.attrs ?? {}) as Partial<MediaAttrs>;
    return src ? mediaMarkdown(name ?? "", src) : "";
  },
});
