import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { AcpClient, ACP_CLIENT_CODE } from "./acp-client";
import { ANTIGRAVITY_EVENTS_CODE, agySteps, agyStopError, agyUsage, type AgyStep } from "./antigravity-events";
import { openAgyMcp } from "./antigravity-mcp";
import { ANTIGRAVITY_PROMPT_CODE, agyMode, agyModel, agyPrompt, agySystemAppend } from "./antigravity-prompt";
import { ANTIGRAVITY_TOOLS_CODE, agyTool } from "./antigravity-tools";
import { publish } from "./bus";
import { CLI_ADAPTER_CODE, type CliAdapter } from "./cli-adapter";
import { codexInput } from "./codex-input";
import { rememberAgyModels } from "./antigravity-models";
import { CLI_MESSAGES_CODE, fileReply, fileResult, fileToolResult, fileToolStart, keepSessionId, noteTouched, stderrLogger } from "./cli-messages";
import { spawnCli, type CliProcess } from "./cli-process";
import { withConnectorEnv } from "./connector-env";
import { cliEnv } from "./env";
import { askAboutCall } from "./guards/ask";
import { openAgyGuards, type AgyGuards } from "./guards/antigravity";
import { getCard } from "./store";
import type { Session } from "./runner-state";

// A Weft thread on Google's Antigravity CLI (docs/architecture/antigravity.md). Unlike Codex and Goose, which start a
// process per turn, Antigravity stays warm: `agy acp` is an Agent Client Protocol server, started once per card and fed
// each turn as session/prompt, the way Claude Code's process lives across turns. A stop is session/cancel, which ends
// the turn and keeps the process. A card that comes back after Weft restarts resumes its conversation with session/load.

export type AgyState = {
  proc: CliProcess;
  client: AcpClient;
  guards: AgyGuards;
  closeMcp: () => void;
  sessionId: string;
  mode?: string;
  model?: string;
  // The reply being streamed this turn, filed as one row when a tool starts or the turn ends.
  reply: string;
  last: string;
  // True while session/load replays the old conversation, which is already in the thread.
  replaying: boolean;
  // Aborts the asks a turn left open when it's cancelled.
  turn?: AbortController;
};

/** The model a thread's rows are filed under. */
export function agyLabel(session: Session): string {
  return agyModel(getCard(session.cardId ?? "")?.model ?? session.spec.model) ?? "Antigravity";
}

async function flush(session: Session, state: AgyState) {
  if (!state.reply.trim()) return;
  const text = state.reply;
  state.reply = "";
  state.last = text;
  await fileReply(session, text, agyLabel(session), "agy");
}

async function step(session: Session, state: AgyState, s: AgyStep) {
  if (s.kind === "text") {
    state.reply += s.text;
    if (session.cardId) publish({ type: "delta", cardId: session.cardId, text: s.text });
    return;
  }
  if (s.kind === "context") return;
  await flush(session, state);
  if (s.kind === "tool-start") {
    await fileToolStart(session, s.id, s.use, agyLabel(session), "agy");
    return;
  }
  // A tool whose start never came (agy sent its update first) still gets a row.
  await fileToolStart(session, s.id, s.use, agyLabel(session), "agy");
  await fileToolResult(session, s.id, s.outcome);
  noteTouched(session, s.files);
}

type PermissionRequest = { toolCall?: { toolCallId?: string; name?: string; rawInput?: Record<string, unknown>; args?: Record<string, unknown>; title?: string }; options?: { optionId: string; kind?: string }[] };

function optionFor(request: PermissionRequest, allow: boolean): string | undefined {
  const kinds = allow ? ["allow_once", "allow_always"] : ["reject_once", "reject_always"];
  return request.options?.find((o) => kinds.includes(o.kind ?? ""))?.optionId;
}

/**
 * agy's question before a call its mode doesn't allow: Weft's own tools and a Bypass card go ahead; anything else is
 * asked on the card, the way Claude Code's canUseTool asks (lib/guards/ask.ts). Weft's guards have already seen the
 * call in agy's PreToolUse hook (lib/guards/antigravity.ts), which runs first.
 */
export async function answerPermission(session: Session, state: AgyState, params: unknown): Promise<unknown> {
  const request = (params ?? {}) as PermissionRequest;
  const call = request.toolCall ?? {};
  const use = agyTool(call.name ?? "", call.rawInput ?? call.args ?? {}, session.spec.cwd);
  const mode = getCard(session.cardId ?? "")?.permissionMode ?? session.spec.permissionMode;
  let allow = use.name.startsWith("mcp__") || mode === "bypassPermissions";
  if (!allow) {
    const signal = AbortSignal.any([session.abort.signal, ...(state.turn ? [state.turn.signal] : [])]);
    const answer = await askAboutCall(session, use.name, use.input, call.toolCallId ?? "", signal, call.title);
    allow = answer.behavior === "allow";
  }
  const optionId = optionFor(request, allow);
  return optionId ? { outcome: { outcome: "selected", optionId } } : { outcome: { outcome: "cancelled" } };
}

/** The session's settings agy should run with now: its mode and model, sent only when they changed. */
async function sync(session: Session, state: AgyState) {
  const card = getCard(session.cardId ?? "");
  const mode = agyMode(card?.permissionMode ?? session.spec.permissionMode);
  if (mode !== state.mode) {
    await state.client.request("session/set_mode", { sessionId: state.sessionId, modeId: mode });
    state.mode = mode;
  }
  const model = agyModel(card?.model ?? session.spec.model);
  if (model && model !== state.model) {
    await state.client.request("session/set_model", { sessionId: state.sessionId, modelId: model });
    state.model = model;
  }
}

/** Opens the conversation: the card's own again when it has one, a new one otherwise. */
async function openConversation(session: Session, state: AgyState, mcpServers: unknown[]): Promise<string> {
  const resume = session.sessionId ?? session.spec.sessionId;
  if (resume) {
    state.replaying = true;
    try {
      const loaded = await state.client.request<{ models?: unknown } | null>("session/load", { sessionId: resume, cwd: session.spec.cwd, mcpServers });
      // What this account can use, for the pickers (lib/antigravity-models.ts).
      rememberAgyModels(loaded?.models);
      return resume;
    } catch (err) {
      // A conversation agy no longer has (deleted, another machine's): the card goes on in a new one.
      console.error(`[agy] couldn't resume ${resume}, starting a new conversation:`, err);
    } finally {
      state.replaying = false;
    }
  }
  const opened = await state.client.request<{ sessionId?: string; models?: unknown } | null>("session/new", {
    cwd: session.spec.cwd,
    mcpServers,
    _meta: { antigravity: { systemPrompt: { append: agySystemAppend(session) } } },
  });
  if (!opened?.sessionId) throw new Error("Antigravity didn't open a conversation.");
  rememberAgyModels(opened.models);
  return opened.sessionId;
}

/** Starts `agy acp` for the session, with Weft's guards and tools, and opens its conversation. */
export async function startAgy(session: Session, executable: string): Promise<AgyState> {
  // Weft's guards, through agy's own PreToolUse hook. Without them agy doesn't start.
  const guards = openAgyGuards(session);
  const mcp = openAgyMcp(session);
  const env = withConnectorEnv(cliEnv(), () => session.cardId ?? undefined) as NodeJS.ProcessEnv;
  delete env.CLAUDE_CODE_ENTRYPOINT;
  Object.assign(env, guards.env);
  const state = {} as AgyState;
  try {
    const proc = spawnCli({ command: executable, args: ["acp"], cwd: session.spec.cwd, env, signal: session.abort.signal }, stderrLogger(session));
    session.process = proc;
    proc.stdin.on("error", () => {});
    const client = new AcpClient(
      (line) => proc.stdin.write(line),
      (method, params) => (method === "session/request_permission" ? answerPermission(session, state, params) : Promise.reject(new Error(`Weft doesn't answer ${method}.`))),
      async (method, params) => {
        if (method !== "session/update" || state.replaying) return;
        for (const s of agySteps(params, session.spec.cwd)) await step(session, state, s);
      },
    );
    Object.assign(state, { proc, client, guards, closeMcp: mcp.close, reply: "", last: "", replaying: false });
    void client.listen(proc.stdout, () => proc.stderrTail().trim() || "Antigravity's process ended.");
    await client.request("initialize", { protocolVersion: 1, clientCapabilities: {} });
    state.sessionId = await openConversation(session, state, mcp.servers);
    keepSessionId(session, state.sessionId);
    guards.bind(state.sessionId);
    return state;
  } catch (err) {
    // A start that failed part way: only what it got to is there.
    const started = state as Partial<AgyState>;
    started.client?.close();
    started.proc?.stdin.end();
    mcp.close();
    guards.close();
    throw err;
  }
}

/**
 * The turn's ACP prompt: its text (a /name turned into the skill's text), then any image pasted with it, as the image
 * blocks agy's initialize says it takes (promptCapabilities.image).
 */
export function agyPromptBlocks(session: Session, message: SDKUserMessage): Record<string, string>[] {
  const input = codexInput(message);
  return [{ type: "text", text: agyPrompt(session, input.text) }, ...input.images.map((image) => ({ type: "image", mimeType: image.mediaType, data: image.data }))];
}

/** One turn: the prompt as session/prompt, its updates filed as they come, then the result row. */
export async function runAgyTurn(session: Session, message: SDKUserMessage, state: AgyState): Promise<void> {
  state.reply = "";
  state.last = "";
  state.turn = new AbortController();
  try {
    await sync(session, state);
    const result = await state.client.request("session/prompt", { sessionId: state.sessionId, prompt: agyPromptBlocks(session, message) });
    await flush(session, state);
    await fileResult(session, agyLabel(session), { text: state.last, error: agyStopError(result), usage: agyUsage(result) });
  } finally {
    state.turn = undefined;
  }
}

/** Stops the running turn; agy answers its session/prompt with stopReason "cancelled", and the process stays. */
export function cancelAgy(_session: Session, state: AgyState): void {
  state.turn?.abort();
  state.client.notify("session/cancel", { sessionId: state.sessionId });
}

/** Ends the process: stdin closed is agy's own way out. */
export function closeAgy(_session: Session, state: AgyState): void {
  state.client.close();
  state.proc.stdin.end();
  state.closeMcp();
  state.guards.close();
}

export function antigravityAdapter(executable: string): CliAdapter<AgyState> {
  return { name: "Antigravity", start: (session) => startAgy(session, executable), runTurn: runAgyTurn, cancel: cancelAgy, close: closeAgy };
}

// The code in this module and what it starts agy with, fed into the runner's BUILD fingerprint (lib/runner-session.ts)
// so a change to any of it replaces idle sessions.
export const ANTIGRAVITY_CODE = [
  startAgy, runAgyTurn, agyPromptBlocks, cancelAgy, closeAgy, answerPermission, openConversation, sync, step, flush, agyLabel,
  ...ACP_CLIENT_CODE, ...ANTIGRAVITY_EVENTS_CODE, ...ANTIGRAVITY_PROMPT_CODE, ...ANTIGRAVITY_TOOLS_CODE, ...CLI_ADAPTER_CODE, ...CLI_MESSAGES_CODE,
];
