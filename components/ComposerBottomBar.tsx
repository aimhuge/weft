// The Composer's bottom bar: the attach / dictation / format / Markdown toggle buttons on the left,
// the dictation status (error or "Listening…") in the middle, and the caller's actions (e.g. Send)
// on the right. The hidden file input lives here too, so its ref is the same the bar's click opens.
import { type ReactNode, type RefObject } from "react";
import { useDictation } from "@/lib/use-dictation";
import { useThreadTransport } from "@/lib/thread-transport";
import type { Editor } from "@tiptap/react";
import { insertFiles } from "./MediaNode";
import { currentBinding, formatBinding } from "@/lib/shortcuts";
import ComposerMicButton from "./ComposerMicButton";
import Icon, { type IconName } from "./Icon";
import Tip from "./Tip";

function ToolButton({
  icon,
  label,
  active,
  onClick,
  disabled,
}: {
  icon: IconName;
  label: string;
  active?: boolean;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <Tip text={label} className="inline-flex">
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={onClick}
        disabled={disabled}
        aria-label={label}
        aria-pressed={active}
        className={`rounded p-1.5 ${active ? "bg-accent-soft text-accent" : "text-muted hover:bg-sunken hover:text-ink"} disabled:opacity-40`}
      >
        <Icon name={icon} size={14} />
      </button>
    </Tip>
  );
}

export default function ComposerBottomBar({
  editor,
  source,
  variant,
  showFormat,
  setShowFormat,
  toggleSource,
  dictation,
  fileInput,
  uploadIntoSource,
  modelPicker,
  actions,
}: {
  editor: Editor | null;
  source: string | null;
  variant: "dialog" | "reply";
  showFormat: boolean;
  setShowFormat: (next: boolean) => void;
  toggleSource: () => void;
  dictation: ReturnType<typeof useDictation>;
  fileInput: RefObject<HTMLInputElement | null>;
  uploadIntoSource: (files: File[]) => Promise<void>;
  modelPicker?: ReactNode;
  actions?: ReactNode;
}) {
  const { upload } = useThreadTransport();
  return (
    <>
      <div className="flex shrink-0 items-center gap-0.5 px-1.5 pb-1.5 pt-0.5">
        <ToolButton
          icon="paperclip"
          label="Attach images, videos, or files"
          onClick={() => fileInput.current?.click()}
        />
        <ComposerMicButton dictation={dictation} />
        {variant === "reply" && source === null && (
          <ToolButton
            icon="heading"
            label="Formatting"
            active={showFormat}
            onClick={() => setShowFormat(!showFormat)}
          />
        )}
        <ToolButton
          icon="markdown"
          label={source === null ? "Edit as Markdown" : "Back to formatted text"}
          active={source !== null}
          onClick={toggleSource}
        />
        {modelPicker && <div className="ml-1 min-w-0">{modelPicker}</div>}
        <span className="min-w-0 flex-1 truncate px-1.5 text-[11.5px]">
          {dictation.error ? (
            <button type="button" onClick={dictation.clearError} className="text-danger" title="Dismiss">
              {dictation.error}
            </button>
          ) : dictation.state === "recording" ? (
            <span className="text-muted">Listening… {formatBinding(currentBinding("dictation"))} or the mic again to insert, Esc cancels</span>
          ) : null}
        </span>
        {actions}
      </div>

      <input
        ref={fileInput}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = "";
          if (!files.length) return;
          if (source !== null) void uploadIntoSource(files);
          else if (editor) insertFiles(editor, files, upload);
        }}
      />
    </>
  );
}
