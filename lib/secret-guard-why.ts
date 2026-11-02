// What a refusal says. Everything the guard turns away used to read "Weft keeps secret values out of threads", even a
// thread's own memory, another card's paste or a worker's log, so threads went looking for a secret that wasn't there
// (2026-11-02). Each kind of sealed place now says what it is and what's open instead; every one still says "can't be
// read here", which is what the guard's callers and tests look for.

import path from "node:path";
import { DATA_DIR } from "./store";
import { DATA_SECRET, PROC_ENV, SECRET_FILE, TEMPLATE, inTranscriptDir, placedPath } from "./secret-guard-files";
import { workerHome } from "./worker-config";

// The worker's files that hold a key or a token, as opposed to its log and update notes.
const WORKER_KEYS = /^(worker\.json|worker\.env|seal-key\.json|sign-key\.json|github-credentials)$/i;

const within = (file: string, dir: string) => {
  const rel = path.relative(dir, file);
  return !rel || (!rel.startsWith("..") && !path.isAbsolute(rel));
};

const SECRET = (name: string) =>
  `Weft keeps secret values out of threads, so ${name} can't be read here. Work with names instead: ` +
  "read or edit `.env.example`, and ask the user to set the value themselves.";

const KINDS: { is: (at: string, clean: string, dataDir: string) => boolean; say: (name: string) => string }[] = [
  {
    is: (_at, clean) => inTranscriptDir(clean),
    say: (name) =>
      `${name} is in the CLI's own folder (~/.claude), so it can't be read here: its transcripts hold every value a thread ` +
      "saw, and its settings and hooks decide what a thread may do. Keep memory in ~/.claude/projects/<project>/memory/, which is open.",
  },
  {
    is: (at, _clean, dataDir) => path.dirname(at) === path.join(path.resolve(dataDir), "attachments") || /\/\.weft\/attachments$/i.test(path.dirname(at)),
    say: (name) =>
      `${name} is in Weft's attachments folder, which holds every card's pasted files, so it can't be read here. ` +
      "The Read tool opens a file pasted into this card's own thread; one pasted into another card stays with that card.",
  },
  {
    is: (at, clean, dataDir) => within(at, path.resolve(dataDir)) || /(?:^|\/)\.weft(?:\/|$)/i.test(clean),
    say: (name) =>
      `${name} is in Weft's data folder, beside the control server's token, so it can't be read here. ` +
      "Threads may use its show/, apps/ and scout/ folders.",
  },
  {
    is: (at) => within(at, workerHome()),
    say: (name) =>
      WORKER_KEYS.test(name.replace(/`/g, ""))
        ? `${name} holds this Weft Worker's keys, so it can't be read here.`
        : `${name} is in this Weft Worker's own folder, so it can't be read here. Its checkouts (work/), its pages ` +
          "(data/show) and Weft's clone (weft/) are open, and `ls` lists the folder itself.",
  },
];

// Why a path can't be used, in words that fit what it is. literal text (a glob, "a `.env` file") goes in as it is.
export function refusal(what: string, dataDir = DATA_DIR, literal = false): string {
  if (literal) return SECRET(what);
  const clean = what.replace(/^["']|["']$/g, "");
  const name = `\`${path.basename(clean)}\``;
  const base = path.basename(clean);
  const at = placedPath(clean);
  const inData = [/\/\.weft\/(.+)$/i.exec(clean)?.[1], path.relative(path.resolve(dataDir), at)];
  if (PROC_ENV.test(clean) || (SECRET_FILE.test(base) && !TEMPLATE.test(base)) || inData.some((p) => p && DATA_SECRET.test(p))) return SECRET(name);
  return KINDS.find((k) => k.is(at, clean, dataDir))?.say(name) ?? SECRET(name);
}
