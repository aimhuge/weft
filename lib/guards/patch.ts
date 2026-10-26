import path from "node:path";

// Codex edits files with apply_patch, one patch for any number of files. Weft's guards know Claude Code's edit tools,
// so a patch becomes the calls Claude Code would have made: a Write for a file it adds (or moves to, or deletes, as
// an empty one), a MultiEdit of each hunk's old and new text for a file it updates. Paths are made absolute against
// the call's folder, as Claude Code's are.
//
//   *** Begin Patch
//   *** Add File: a.ts            +line …
//   *** Update File: b.ts         @@ context / " keep" / "-old" / "+new"
//   *** Move to: c.ts             (after an Update: the file's new name)
//   *** Delete File: d.ts
//   *** End Patch

export type PatchCall = { tool: "Write" | "MultiEdit"; input: Record<string, unknown> };

type Edit = { old_string: string; new_string: string };
type FilePatch = { kind: "add" | "update" | "delete"; file: string; moveTo?: string; added: string[]; edits: Edit[] };

const HEADER = /^\*\*\* (Add|Update|Delete) File: (.+)$/;

function hunkEdit(lines: string[]): Edit | null {
  const before: string[] = [];
  const after: string[] = [];
  for (const line of lines) {
    const body = line.slice(1);
    if (line.startsWith("-")) before.push(body);
    else if (line.startsWith("+")) after.push(body);
    else if (line.startsWith(" ") || line === "") {
      before.push(body);
      after.push(body);
    }
  }
  return before.length || after.length ? { old_string: before.join("\n"), new_string: after.join("\n") } : null;
}

// Each file's part of the patch, in order. Lines outside a file (Begin/End Patch) are skipped.
export function parsePatch(patch: string): FilePatch[] {
  const files: FilePatch[] = [];
  let hunk: string[] = [];
  const flush = () => {
    const file = files.at(-1);
    const edit = file?.kind === "update" ? hunkEdit(hunk) : null;
    if (file && edit) file.edits.push(edit);
    hunk = [];
  };
  for (const line of patch.split(/\r?\n/)) {
    const header = HEADER.exec(line);
    if (header) {
      flush();
      const [, kind = "", file = ""] = header;
      files.push({ kind: kind.toLowerCase() as FilePatch["kind"], file: file.trim(), added: [], edits: [] });
      continue;
    }
    const file = files.at(-1);
    if (!file || line.startsWith("*** End") || line.startsWith("*** Begin")) continue;
    if (line.startsWith("*** Move to: ")) file.moveTo = line.slice(13).trim();
    else if (file.kind === "add" && line.startsWith("+")) file.added.push(line.slice(1));
    else if (line.startsWith("@@")) flush();
    else if (file.kind === "update") hunk.push(line);
  }
  flush();
  return files;
}

/** The Claude Code calls a patch amounts to; none when it names no file. */
export function patchCalls(patch: string, cwd: string): PatchCall[] {
  const full = (file: string) => path.resolve(cwd, file);
  return parsePatch(patch).flatMap((file): PatchCall[] => {
    if (file.kind === "add") return [{ tool: "Write", input: { file_path: full(file.file), content: file.added.join("\n") } }];
    if (file.kind === "delete") return [{ tool: "Write", input: { file_path: full(file.file), content: "" } }];
    const update: PatchCall = { tool: "MultiEdit", input: { file_path: full(file.file), edits: file.edits } };
    if (!file.moveTo) return [update];
    return [update, { tool: "Write", input: { file_path: full(file.moveTo), content: file.edits.map((e) => e.new_string).join("\n") } }];
  });
}
