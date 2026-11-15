"use client";

// The New thread dialog at phone width on weft.zip (docs/architecture/new-card-parity.md): the phone app's design in
// the DOM, over the desktop dialog's own state (lib/use-new-card-dialog.ts), so the two widths can't pick differently.
// The chips sit above the input (PhoneChips), the WeChat-style bar at the bottom (PhoneInputBar). Sending is Start; ⋯
// holds Add to Backlog. Files go up to the workspace's blobs through the cloud transport and travel on the command.
import { useEffect, useRef, useState } from "react";
import { useUiText } from "@/lib/ui-language";
import type { NewCardInput, UploadedAttachment } from "@/lib/client-api";
import { mediaMarkdown } from "@/lib/media";
import { canBacklog, useNewCardTransport } from "@/lib/new-card-transport";
import { errorText } from "@/lib/new-thread";
import { useThreadTransport } from "@/lib/thread-transport";
import { useNewCardDialog } from "@/lib/use-new-card-dialog";
import type { WebTarget } from "@/lib/web-commands";
import { PhoneChips } from "./PhoneChips";
import { PhoneInputBar } from "./PhoneInputBar";

// The prompt as it goes: what's typed, what was said, then the files, each as the Markdown the desktop composer pastes.
export function phonePrompt(text: string, said: string | undefined, files: Pick<UploadedAttachment, "name" | "path">[]): string {
  return [text.trim(), said?.trim(), files.map((f) => mediaMarkdown(f.name, f.path)).join("\n")].filter(Boolean).join("\n\n");
}

export function PhoneNewCard({ places, defaultCwd, note, onCreate, onClose }: {
  places: WebTarget[];
  defaultCwd?: string;
  note?: string;
  onCreate: (input: NewCardInput) => Promise<void>;
  onClose: () => void;
}) {
  const t = useUiText();
  const dialog = useNewCardDialog("", defaultCwd, undefined, false, useNewCardTransport().startMode);
  const { upload } = useThreadTransport();
  const [text, setText] = useState(dialog.draftInitial);
  const [files, setFiles] = useState<UploadedAttachment[]>([]);
  const [uploading, setUploading] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const latest = useRef({ text, files });
  useEffect(() => {
    latest.current = { text, files };
  });

  const write = (next: string) => {
    setText(next);
    dialog.saveDraft(next);
  };
  const submit = (start: boolean, said?: string) =>
    void dialog.submit(start, {
      stay: false,
      read: () => phonePrompt(latest.current.text, said, latest.current.files),
      clear: () => setText(""),
      focus: () => field.current?.focus(),
      onCreate: (input) => onCreate(input),
      onClose,
    });
  const attach = async (picked: File[]) => {
    if (!upload) return;
    setUploadError(null);
    for (const file of picked) {
      setUploading(file.name);
      try {
        const done = await upload(file, file.name);
        setFiles((prev) => [...prev, done]);
      } catch (err) {
        setUploadError(`${file.name}: ${errorText(err)}`);
        break;
      }
    }
    setUploading(null);
  };

  return (
    <div role="dialog" aria-label={t("New thread")} className="fixed inset-0 z-50 flex flex-col bg-canvas">
      <header className="flex items-center justify-between border-b border-line px-4 py-3">
        <h2 className="text-[16px] font-semibold text-ink">{t("New thread")}</h2>
        <button type="button" onClick={onClose} aria-label={t("Close")} className="h-10 w-10 rounded-full text-[18px] text-muted">
          ✕
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 text-[13.5px] leading-relaxed">
        {text.trim() ? <p className="whitespace-pre-wrap text-ink">{text}</p> : <p className="text-faint">{t("Say or type what it should do. ⊕ for photos and files.")}</p>}
        {files.length > 0 && (
          <ul className="mt-3 flex flex-wrap gap-2">
            {files.map((f) => (
              <li key={f.path} className="flex items-center gap-1.5 rounded-md bg-sunken px-2 py-1 text-[12px] text-muted">
                {f.kind === "image" ? <img src={f.url} alt="" className="h-8 w-8 rounded object-cover" /> : "📄"}
                <span className="max-w-32 truncate">{f.name}</span>
                <button type="button" aria-label={`${t("Remove")} ${f.name}`} onClick={() => setFiles((prev) => prev.filter((x) => x !== f))} className="px-1">
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
        {uploading && <p className="mt-2 text-[12px] text-muted">{t("Uploading")} {uploading}…</p>}
        {uploadError && <p className="mt-2 text-[12px] text-warn">{uploadError}</p>}
        {dialog.error && (
          <p role="alert" className="mt-2 text-[12.5px] text-danger">
            {dialog.error}
          </p>
        )}
        {note && <p className="mt-3 text-[11.5px] text-faint">{note}</p>}
      </div>
      <PhoneChips dialog={dialog} places={places} />
      <PhoneInputBar
        text={text}
        onText={write}
        field={field}
        onSend={(said) => submit(true, said)}
        onBacklog={() => submit(false)}
        onFiles={(picked) => void attach(picked)}
        canBacklog={canBacklog(dialog.cwd)}
        busy={!!dialog.busy || uploading !== null}
      />
    </div>
  );
}
