import path from "node:path";
import { editPreview } from "./edit-preview";

// The path a tool call names (Read/Edit/Write/MultiEdit/NotebookEdit) and the EditPreview, when
// the call edits a file. Used by the thread to render a clickable file link and an inline diff
// instead of the raw tool result. Paths are returned relative to the card's folder when they
// sit inside it (so the editor opens the same path), absolute when they don't. Wrapped in a
// try/catch: a throw here (a bad path, fs error) drops the preview but never breaks the turn.
const FILE_TOOLS = new Set(["Read", "Edit", "Write", "MultiEdit", "NotebookEdit"]);
export function readFileEdit(toolName: string, input: Record<string, unknown>, cwd: string): { file?: string; edit?: ReturnType<typeof editPreview> } {
  if (!FILE_TOOLS.has(toolName)) return {};
  const raw = typeof input.file_path === "string" ? input.file_path : typeof input.notebook_path === "string" ? input.notebook_path : "";
  if (!raw) return {};
  const file = relativize(raw, cwd);
  let edit: ReturnType<typeof editPreview> = undefined;
  try {
    edit = editPreview(toolName, input, cwd);
  } catch {
    // The diff is decoration; a thrown preview (bad path, fs read) must not drop the tool call.
  }
  return { file, ...(edit && { edit }) };
}

// A path relative to `cwd` when it sits inside, absolute otherwise. Empty when neither can be done.
export function relativize(given: string, cwd: string): string {
  try {
    const abs = path.resolve(cwd, given);
    const rel = path.relative(cwd, abs);
    if (rel && !rel.startsWith("..") && !path.isAbsolute(rel)) return rel;
    return abs;
  } catch {
    return given;
  }
}
