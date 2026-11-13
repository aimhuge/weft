// A stand-in for Composer in component tests: the real one is a TipTap editor, which jsdom can't type
// into reliably. Same handle and props; a plain textarea where Enter submits and Shift+Enter is a
// newline, as Composer's own keymap does; Ctrl+Enter is onSubmitAlt (⌃↵).
import { forwardRef, useImperativeHandle, useRef, type ReactNode } from "react";
import type { ComposerHandle } from "./Composer";

const ComposerMock = forwardRef<
  ComposerHandle,
  { initial?: string; placeholder?: string; autoFocus?: boolean; onSubmit: () => void; onSubmitAlt?: () => void; onChange?: (markdown: string) => void; actions?: ReactNode; modelPicker?: ReactNode; header?: ReactNode; dropTarget?: string }
>(function ComposerMock({ initial, placeholder, autoFocus, onSubmit, onSubmitAlt, onChange, actions, modelPicker, header, dropTarget }, ref) {
  const box = useRef<HTMLTextAreaElement>(null);
  useImperativeHandle(ref, () => ({
    focus: () => box.current?.focus(),
    read: () => box.current?.value.trim() ?? "",
    readText: () => box.current?.value.trim() ?? "",
    clear: () => {
      if (box.current) box.current.value = "";
    },
    write: (markdown) => {
      if (box.current) box.current.value = markdown;
    },
    isEmpty: () => !box.current?.value.trim(),
  }));
  return (
    // data-handed-to: the target whose dropped files this composer takes (lib/file-drop.ts).
    <div data-handed-to={dropTarget}>
      {header}
      <textarea
        ref={box}
        aria-label="Message"
        placeholder={placeholder}
        autoFocus={autoFocus}
        defaultValue={initial}
        onChange={(e) => onChange?.(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && e.ctrlKey && onSubmitAlt) {
            e.preventDefault();
            onSubmitAlt();
          } else if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            onSubmit();
          }
        }}
      />
      {modelPicker}
      {actions}
    </div>
  );
});

export default ComposerMock;
