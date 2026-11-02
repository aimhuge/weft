// The desktop board's side of signed widening (docs/architecture/project-hosts.md#signed-widening-as-built): before a
// worker card's action that the network would be refused (a new folder, agent or read scope, skipping permission
// prompts, a "!" line, a terminal, a new thread with an agent), Electron main asks Touch ID in its own words and signs
// exactly that change with this Mac's approval key (electron/widen-sign.cjs). The approval rides in the command as
// `widen`; the worker checks it against the key it pinned from the pairing code. Without the desktop app there's no
// signer, so those actions stay off (`canSignWiden`).
import { createTerms, widenArgsOf, widenChangeOf, type WidenAuth, type WidenChange, type WidenVerb } from "./widen";
import { parseWorkerProject } from "./worker-project";

export interface WidenRequest {
  host: string;
  card: string;
  verb: WidenVerb;
  change: WidenChange;
  // The rest of the command, bound whole (lib/widen.ts WidenFields.args).
  args: Record<string, unknown>;
}

export type Refreshed = { worker: string; generation?: number; endorsements: unknown[] };
type Bridge = {
  widen?: (req: WidenRequest) => Promise<WidenAuth | null>;
  endorse?: (req: { worker: string; revoke?: boolean }) => Promise<unknown[] | null>;
  endorseRefresh?: () => Promise<Refreshed[]>;
  endorseConfirm?: (req: { worker: string; receipt: unknown }) => Promise<boolean>;
};

const bridge = (): Bridge | undefined =>
  typeof window === "undefined" ? undefined : (window as unknown as { weft?: { approval?: Bridge } }).weft?.approval;

export const canSignWiden = () => Boolean(bridge()?.widen);

export const CANCELLED = "Not approved, so nothing changed.";
export const NO_SIGNER = "This needs your approval with Touch ID in the Weft desktop app.";

// The approval for one change, after Touch ID; throws when there's no signer or the person said no.
export async function signWiden(req: WidenRequest): Promise<WidenAuth> {
  const sign = bridge()?.widen;
  if (!sign) throw new Error(NO_SIGNER);
  const auth = await sign(req);
  if (!auth) throw new Error(CANCELLED);
  return auth;
}

// A worker card's folder as the worker names it: a project's name, from the worker:// path the board holds. A path on
// another host, or not a worker's at all, can't be one.
export function workerFolderOf(workerId: string, cwd: unknown): string {
  const project = typeof cwd === "string" ? parseWorkerProject(cwd) : null;
  if (project?.workerId === workerId) return project.folder;
  if (typeof cwd === "string" && !cwd.includes("/") && cwd) return cwd;
  throw new Error("A worker card moves only to another of that worker's projects.");
}

// The args a worker runs a verb with: a new folder as the worker's project name, and when the verb widens, the approval
// for exactly that change. Anything else goes as it came.
export async function signedArgs<A extends Record<string, unknown> & { id: string }>(workerId: string, verb: string, args: A): Promise<A> {
  const body = verb === "card.update" ? (args.body as Record<string, unknown> | undefined) : undefined;
  const placed = body?.cwd !== undefined ? { ...args, body: { ...body, cwd: workerFolderOf(workerId, body.cwd) } } : args;
  const change = widenChangeOf({ verb, args: placed });
  // With no signer (not the desktop app) it goes unsigned, and the worker refuses it in its own words.
  if (!change || !canSignWiden()) return placed;
  const widen = await signWiden({ host: workerId, card: args.id, verb: verb as WidenVerb, change, args: widenArgsOf(placed) });
  return { ...placed, widen };
}

// Lets this Mac's paired passkeys widen on a worker too: main signs one endorsement per passkey after Touch ID, and the
// caller sends them to the worker as a `pin` command. Null when Touch ID is refused, [] when no passkey is paired.
export async function endorsePasskeys(worker: string, revoke = false): Promise<unknown[] | null> {
  const endorse = bridge()?.endorse;
  if (!endorse) throw new Error(NO_SIGNER);
  return endorse({ worker, revoke });
}

// Every worker whose passkey set it hasn't confirmed yet, narrowed to what's still paired here (signed by main with no
// Touch ID), for the caller to send as `pin` commands until each confirms. [] without the desktop app.
export async function refreshEndorsements(): Promise<Refreshed[]> {
  return (await bridge()?.endorseRefresh?.()) ?? [];
}

// A worker's receipt for a pin, for main to check against the sign key it pinned for that worker: true once the worker
// holds the set main last signed for it, and main stops re-sending.
export async function confirmEndorsement(worker: string, receipt: unknown): Promise<boolean> {
  return (await bridge()?.endorseConfirm?.({ worker, receipt })) === true;
}

// A new thread on a worker that names an agent: the approval for that agent, that project and that first message (as
// the run will carry it, trimmed: lib/worker-commands.ts runCommand). Any other new thread goes as it came.
export async function withCreateWiden<T extends { cwd?: string; agent?: string; prompt?: string; start?: boolean }>(input: T): Promise<T & { widen?: WidenAuth }> {
  const project = input.cwd ? parseWorkerProject(input.cwd) : null;
  if (!project || !input.agent || !input.start) return input;
  const change = { create: { agent: input.agent, folder: project.folder, prompt: (input.prompt ?? "").trim() } };
  // The run's other terms as the worker will read them off the row lib/worker-board.ts builds from this input.
  return { ...input, widen: await signWiden({ host: project.workerId, card: "", verb: "card.create", change, args: createTerms(input) }) };
}
