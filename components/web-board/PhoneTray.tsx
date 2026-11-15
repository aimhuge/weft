"use client";

// The ⊕ tray under weft.zip's phone-width input bar (components/web-board/PhoneInputBar.tsx): Photos, Camera, File and
// Paste, the phone app's tray as a browser has it (Scan, Draw and Location need the app). Each hands back files, which
// go up to the workspace's blobs (lib/web-upload.ts) for the Mac that runs the card to fetch.
import { useState } from "react";
import { useUiText } from "@/lib/ui-language";
import { TRAVEL_MIME } from "@/lib/attachment-refs";

const ACCEPT_ALL = Object.values(TRAVEL_MIME).join(",");

// Images on the clipboard, as files; none when the browser won't share them.
// The clipboard is undefined outside a secure page, whatever the DOM types say.
export async function clipboardFiles(given?: Partial<Pick<Clipboard, "read">>): Promise<File[]> {
  const clipboard = given ?? (navigator as Partial<Pick<Navigator, "clipboard">>).clipboard;
  if (!clipboard?.read) return [];
  const files: File[] = [];
  for (const item of await clipboard.read()) {
    const type = item.types.find((t) => t.startsWith("image/"));
    if (!type) continue;
    const blob = await item.getType(type);
    files.push(new File([blob], `paste.${type.slice("image/".length)}`, { type }));
  }
  return files;
}

const ITEM = "flex cursor-pointer flex-col items-center gap-1 rounded-lg py-2 text-[11.5px] text-muted hover:bg-sunken";

// One tray item that opens the browser's own picker: a label around a hidden file input.
function Pick({ icon, label, accept, capture, onFiles }: { icon: string; label: string; accept: string; capture?: "environment"; onFiles: (files: File[]) => void }) {
  return (
    <label className={ITEM}>
      <span aria-hidden className="text-[22px]">{icon}</span>
      {label}
      <input
        type="file"
        accept={accept}
        capture={capture}
        multiple={!capture}
        hidden
        onChange={(e) => {
          if (e.target.files?.length) onFiles([...e.target.files]);
        }}
      />
    </label>
  );
}

export function PhoneTray({ onFiles }: { onFiles: (files: File[]) => void }) {
  const t = useUiText();
  const [problem, setProblem] = useState<string | null>(null);
  const paste = async () => {
    try {
      const files = await clipboardFiles();
      if (files.length) onFiles(files);
      else setProblem(t("No picture on the clipboard."));
    } catch {
      setProblem(t("This browser won't share the clipboard."));
    }
  };
  return (
    <div className="border-t border-line px-3 pb-3 pt-2">
      <div className="grid grid-cols-4 gap-2">
        <Pick icon="🖼" label={t("Photos")} accept="image/*" onFiles={onFiles} />
        <Pick icon="📷" label={t("Camera")} accept="image/*" capture="environment" onFiles={onFiles} />
        <Pick icon="📄" label={t("File")} accept={ACCEPT_ALL} onFiles={onFiles} />
        <button type="button" onClick={() => void paste()} className={ITEM}>
          <span aria-hidden className="text-[22px]">📋</span>
          {t("Paste")}
        </button>
      </div>
      {problem && <p className="pt-1 text-center text-[12px] text-warn">{problem}</p>}
    </div>
  );
}
