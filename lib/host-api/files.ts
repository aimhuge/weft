// The editor's verbs (docs/architecture/project-hosts.md, H4): the card folder's file index, one file (or its git HEAD
// text, for the diff), and a save. A host runs these only for another machine (this Mac's own editor calls
// lib/file-access.ts through its route), so each acts inside the folder of the card args.id names through file-access
// (outside it, any .git, a secret file or a binary are refused) and adds @weft/client's file policy on the path after
// its realpath: no credentials read or written, and no save into what configures an agent. Each read and save is
// written to this host's audit log. They return their value, so a remote host sends it back as a result
// (lib/host-result.ts).
import fs from "node:fs";
import path from "node:path";
import { readRefusal, writeRefusal } from "@weft/client";
import { headOf, listFiles, readFile, safePath, writeFile, type OpenedFile, type SaveResult } from "../file-access";
import { DATA_DIR } from "../store";
import { requireCard } from "./types";

export type FileArgs = { id: string; path: string };

// One line per remote read or save, in this host's own data folder: when, which verb, which card, which file.
export const AUDIT_LOG = "remote-files.log";

function audit(verb: string, card: string, file: string) {
  try {
    fs.appendFileSync(path.join(DATA_DIR, AUDIT_LOG), `${JSON.stringify({ at: new Date().toISOString(), verb, card, path: file })}\n`);
  } catch {
    // A full disk doesn't stop the editor; the policy still held.
  }
}

const text = (v: unknown, what: string): string => {
  if (typeof v !== "string") throw new Error(`${what} is required.`);
  return v;
};

// The path relative to the card's folder after its realpath, refused by `rule` (so a symlink can't point past it).
async function checked(cwd: string, file: string, rule: (rel: string) => string | null): Promise<string> {
  const { rel } = await safePath(cwd, file);
  const posix = rel.split(path.sep).join("/");
  const refused = rule(posix);
  if (refused) throw new Error(refused);
  return posix;
}

// The index, without the files a read would refuse.
export async function listFilesVerb({ id }: { id: string }): Promise<{ files: string[] }> {
  const files = await listFiles(requireCard(id).cwd);
  audit("files.list", id, ".");
  return { files: files.filter((f) => !readRefusal(f)) };
}

// `at: "HEAD"` is the diff's base: the file as git's HEAD has it, null when it's untracked.
export async function readFileVerb({ id, path: file, at }: FileArgs & { at?: "HEAD" }): Promise<{ file: OpenedFile } | { path: string; text: string | null }> {
  const cwd = requireCard(id).cwd;
  const rel = await checked(cwd, text(file, "A path"), readRefusal);
  audit("files.read", id, rel);
  return at === "HEAD" ? headOf(cwd, file) : { file: await readFile(cwd, file) };
}

// A save that refuses to overwrite a file that changed since it was read (baseHash), as the Mac's editor does.
export async function writeFileVerb({ id, path: file, text: body, baseHash }: FileArgs & { text: string; baseHash?: string | null }): Promise<{ result: SaveResult } | { conflict: OpenedFile }> {
  const cwd = requireCard(id).cwd;
  const rel = await checked(cwd, text(file, "A path"), writeRefusal);
  const saved = await writeFile(cwd, file, text(body, "The file's text"), baseHash);
  audit("files.write", id, rel);
  return saved;
}
