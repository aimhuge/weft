"use client";

import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { api } from "@/lib/client";
import Icon from "./Icon";

// The pictures a theme can be built around (lib/custom-themes.ts uploadedPictureName checks the bytes too).
const PICTURE_TYPES = "image/jpeg,image/png,image/webp";
const droppedPicture = (e: DragEvent) => [...e.dataTransfer.files].find((f) => f.type.startsWith("image/"));

// Lets a picture be dropped on an element: the dragover has to be refused for the drop to fire.
function dropTarget(onPicture: (file: File) => void) {
  return {
    onDragOver: (e: DragEvent) => {
      if (e.dataTransfer.types.includes("Files")) e.preventDefault();
    },
    onDrop: (e: DragEvent) => {
      const file = droppedPicture(e);
      if (!file) return;
      e.preventDefault();
      onPicture(file);
    },
  };
}

// The last Appearance tile: describe a theme in words, or drop your own picture on it, and a thread
// makes it (lib/custom-themes.ts). Collapsed it's a tile like the scenes beside it; open, it takes the grid's full width.
export function DescribeTile({ onOpen }: { onOpen: (picture?: File) => void }) {
  return (
    <button
      onClick={() => onOpen()}
      {...dropTarget(onOpen)}
      title="Describe a theme, or drop a picture, and a thread makes it"
      className="flex aspect-[4/3] flex-col items-center justify-center gap-1 rounded-md border border-dashed border-line-strong text-[11px] text-muted hover:border-accent hover:text-accent"
    >
      <Icon name="sparkles" size={15} />
      Your own
    </button>
  );
}

// The picture slot beside the describe box: click to pick, drop to set, × to clear. It shows the
// picture once there is one, so you see what the theme will be built around.
function PictureSlot({ picture, onPick }: { picture: File | null; onPick: (file: File | null) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const preview = useMemo(() => (picture ? URL.createObjectURL(picture) : null), [picture]);
  useEffect(() => {
    if (preview) return () => URL.revokeObjectURL(preview);
  }, [preview]);

  return (
    <div className="relative aspect-[4/3] w-[78px] shrink-0">
      <button
        type="button"
        onClick={() => input.current?.click()}
        title={picture ? `${picture.name}: click to pick another` : "Use your own picture as the backdrop (or drop one here)"}
        style={preview ? { backgroundImage: `url(${preview})` } : undefined}
        className="flex size-full flex-col items-center justify-center gap-0.5 rounded border border-dashed border-line-strong bg-card bg-cover bg-center text-[10.5px] leading-tight text-muted hover:border-accent hover:text-accent"
      >
        {!preview && (
          <>
            <Icon name="image" size={14} />
            Your picture
          </>
        )}
      </button>
      {picture && (
        <button
          type="button"
          aria-label="Remove the picture"
          onClick={() => onPick(null)}
          className="absolute -right-1 -top-1 flex size-4 items-center justify-center rounded-full bg-ink text-[10px] leading-none text-canvas"
        >
          ×
        </button>
      )}
      <input
        ref={input}
        type="file"
        accept={PICTURE_TYPES}
        hidden
        aria-label="Theme picture"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onPick(file);
          e.target.value = "";
        }}
      />
    </div>
  );
}

const hint = (picture: File | null) =>
  picture
    ? "Your picture stays the backdrop; a new card picks the colors around it. Words are optional."
    : "A new card paints the picture and picks the colors; the theme lands here when it's done.";

export default function ThemeDescriber({
  initialPicture = null,
  onStarted,
  onClose,
}: {
  initialPicture?: File | null;
  onStarted: (id: string) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState("");
  const [picture, setPicture] = useState<File | null>(initialPicture);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = (!!text.trim() || !!picture) && !busy;

  async function submit() {
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      const { id } = picture ? await api.themeFromPicture(text, picture) : await api.createTheme(text);
      onStarted(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      {...dropTarget(setPicture)}
      className="col-span-6 flex flex-col gap-1.5 rounded-md border border-line-strong bg-sunken p-2"
    >
      <div className="flex gap-1.5">
        <PictureSlot picture={picture} onPick={setPicture} />
        <textarea
          autoFocus
          rows={2}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void submit();
            }
            if (e.key === "Escape") onClose();
          }}
          placeholder={picture ? "Optional: what to bring out of it, e.g. warm and quiet…" : "A rainy Tokyo alley at night, neon pink and teal…"}
          className="min-w-0 flex-1 resize-none rounded bg-card px-2 py-1.5 text-[12.5px] text-ink outline-none placeholder:text-faint focus-visible:ring-1 focus-visible:ring-accent"
        />
      </div>
      <div className="flex items-center gap-2 text-[11.5px] text-muted">
        <span className="flex-1">{error ?? hint(picture)}</span>
        <button type="button" onClick={onClose} className="rounded px-2 py-1 hover:bg-card hover:text-ink">
          Cancel
        </button>
        <button type="submit" disabled={!ready} className="rounded bg-accent px-2.5 py-1 font-medium text-on-accent disabled:opacity-50">
          {busy ? "Starting…" : picture ? "Theme it" : "Paint it"}
        </button>
      </div>
    </form>
  );
}
