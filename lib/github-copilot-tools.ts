import fs from "node:fs";
import path from "node:path";
import type { Tool, ToolInvocation } from "@github/copilot-sdk";
import { z } from "zod";
import { openInside, within, writeInside } from "./file-handle";
import { globalSingleton } from "./global-singleton";
import { askAboutCall } from "./guards/ask";
import { decide, type GuardCall } from "./guards/decide";
import { guardHooks } from "./guards/hooks";
import { touchFile } from "./overlap";
import { busyCards, safeUpdate, type Session } from "./runner-state";
import { getCard } from "./store";

const FILE_LIMIT = 128 * 1024;
const EDIT_LIMIT = 64 * 1024;
const PATH = z.string().min(1).max(2048);
const READ = z.object({ path: PATH });
const EDIT = READ.extend({ before: z.string().min(1).max(EDIT_LIMIT), after: z.string().max(EDIT_LIMIT) });
const activeEdits = globalSingleton("__weftGitHubCopilotEdits", () => new Set<string>());

const outside = () => new Error("This tool only works inside the card's folder.");

function projectPath(cwd: string, input: string) {
  const parts = input.split(/[\\/]/);
  // Keep Windows device paths, alternate streams and Git internals out of the tool.
  if (path.isAbsolute(input) || /[:\u0000]/.test(input) ||
      parts.some((part) => part === ".." || /^\.git[ .]*$/i.test(part) || (part !== "." && /[ .]$/.test(part)))) {
    throw new Error("Use a path relative to this card's folder.");
  }
  const root = fs.realpathSync(cwd);
  const absolute = path.resolve(root, input);
  const real = fs.realpathSync(absolute);
  if (!within(root, absolute) || !within(root, real) ||
      path.relative(root, real).split(path.sep).some((part) => /^\.git$/i.test(part))) {
    throw outside();
  }
  return { root, file: real };
}

async function fileText(file: string, root: string) {
  const handle = await openInside(file, root, outside);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > FILE_LIMIT) {
      throw new Error("This tool only supports regular text files up to 128 KB.");
    }
    const bytes = await handle.readFile();
    if (bytes.length > FILE_LIMIT) throw new Error("The file grew past 128 KB.");
    return { text: new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes), mode: stat.mode & 0o777 };
  } finally {
    await handle.close();
  }
}

async function editFile(file: string, root: string, before: string, after: string, signal: AbortSignal): Promise<string> {
  if (activeEdits.has(file)) throw new Error("Another edit is saving this file. Read it again before retrying.");
  activeEdits.add(file);
  try {
    const { text, mode } = await fileText(file, root);
    const index = text.indexOf(before);
    if (index < 0 || text.indexOf(before, index + 1) !== -1) {
      throw new Error("The original text must occur exactly once. Read the file and try a more specific edit.");
    }
    const updated = text.slice(0, index) + after + text.slice(index + before.length);
    if (Buffer.byteLength(updated) > FILE_LIMIT) throw new Error("The edited file would exceed 128 KB.");
    signal.throwIfAborted();
    await writeInside(file, root, updated, outside, mode);
    return "Updated the file.";
  } finally {
    activeEdits.delete(file);
  }
}

export function githubCopilotTools(session: Session): Tool[] {
  const cwd = session.spec.cwd;
  const signal = session.abort.signal;
  const hooks = guardHooks(() => busyCards().filter((id) => id !== session.cardId).length, () => session.cardId ?? undefined);

  async function refusal(call: GuardCall, original: string, file: string): Promise<string | undefined> {
    // Check the original spelling too, in case a sensitive filename is itself a symlink.
    if (original !== file) {
      const alias = await decide(hooks, {
        ...call, tool: call.tool === "Edit" ? "Read" : call.tool,
        input: call.tool === "LS" ? { path: original } : { file_path: original },
      }, signal);
      if (alias.decision !== "allow") return alias.reason;
    }
    const verdict = await decide(hooks, call, signal);
    if (verdict.decision === "deny") return verdict.reason;
    if (verdict.decision === "allow" && call.tool !== "Edit") return undefined;
    const answer = await askAboutCall(session, call.tool, call.input, call.id, signal);
    if (answer.behavior === "deny") return answer.message;
    if (JSON.stringify(answer.updatedInput) !== JSON.stringify(call.input)) return "The approved input differs from the requested operation.";
    return undefined;
  }

  async function run(
    invocation: ToolInvocation,
    tool: "Read" | "LS" | "Edit",
    input: { path: string; before?: string; after?: string },
    work: (file: string, root: string) => string | Promise<string>,
  ): Promise<string> {
    try {
      signal.throwIfAborted();
      const { file, root } = projectPath(cwd, input.path);
      const fields = tool === "LS" ? { path: file } : { file_path: file };
      const call: GuardCall = {
        event: "PreToolUse", tool, cwd, id: invocation.toolCallId,
        input: tool === "Edit" ? { ...fields, old_string: input.before, new_string: input.after } : fields,
      };
      const denied = await refusal(call, path.resolve(cwd, input.path), file);
      if (denied !== undefined) return denied;
      signal.throwIfAborted();
      if (projectPath(cwd, input.path).file !== file) return "The path changed while the request was pending.";
      const result = await work(file, root);
      if (tool === "Edit" && session.cardId) {
        const touchedFiles = touchFile(getCard(session.cardId)?.touchedFiles, file);
        if (touchedFiles) safeUpdate(session.cardId, { touchedFiles });
      }
      const post = await decide(hooks, { ...call, event: "PostToolUse", response: result }, signal);
      return post.decision === "allow" && post.feedback ? result + "\n" + post.feedback : result;
    } catch (error) {
      return error instanceof Error ? error.message : "Weft could not run the file operation.";
    }
  }

  return [
    {
      name: "weft_list_files", description: "List files in a directory in this project. Use . for the project root.",
      parameters: READ, skipPermission: true,
      handler: (args, call) => run(call, "LS", READ.parse(args), (file) => fs.readdirSync(file, { withFileTypes: true })
        .filter((entry) => entry.name !== ".git").slice(0, 300).map((entry) => entry.name + (entry.isDirectory() ? "/" : "")).join("\n")),
    },
    {
      name: "weft_read_file", description: "Read a project text file by its relative path.",
      parameters: READ, skipPermission: true,
      handler: (args, call) => run(call, "Read", READ.parse(args), async (file, root) => (await fileText(file, root)).text),
    },
    {
      name: "weft_edit_file", description: "Replace exactly one occurrence of text in an existing project file. The user approves the edit.",
      parameters: EDIT, skipPermission: true,
      handler: (args, call) => {
        const input = EDIT.parse(args);
        return run(call, "Edit", input, (file, root) => editFile(file, root, input.before, input.after, signal));
      },
    },
  ];
}
