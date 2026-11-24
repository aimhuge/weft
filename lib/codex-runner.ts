import fs from "node:fs";
import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { CLI_ADAPTER_CODE, driveAdapter, type CliAdapter } from "./cli-adapter";
import { CLI_MESSAGES_CODE, fileReply, fileResult, fileToolResult, fileToolStart, keepSessionId, noteTouched } from "./cli-messages";
import { CLI_TURN_CODE, readJsonLines, runCliTurn } from "./cli-turn";
import { CODEX_PROMPT_CODE, argsFor, promptFor } from "./codex-runner-prompt";
import { CODEX_INPUT_CODE, codexInput, writeImages } from "./codex-input";

// Re-exports for tests and existing callers of codex-runner.ts. The prompt/argv code moved to
// lib/codex-runner-prompt.ts; lib/codex-runner.ts runs the turn and converts the events.
export { argsFor, promptFor };
import { codexGuardArgs } from "./guards/codex";
import { openGuards } from "./guards/turn";
import { BRIDGE_TOKEN_ENV, codexMcpArgs, openBridge } from "./mcp-bridge";
import { weftMcpServers } from "./weft-mcp";
import { CODEX_DEFAULT_MODEL } from "./new-thread";
import { withConnectorEnv } from "./connector-env";
import { cliEnv } from "./env";
import type { Session } from "./runner-state";

// A Weft thread on `codex exec` (docs/architecture/cli-adapters.md): one process per turn, its stdout a stream of JSON
// events, each turned into the thread's rows through lib/cli-messages.ts.

type CodexItem = {
  id?: string;
  type?: string;
  text?: string;
  command?: string;
  aggregated_output?: string;
  exit_code?: number;
  status?: string;
  changes?: { path?: string }[];
  // An MCP tool call, such as Weft's own (mcp__browser__open_url).
  server?: string;
  tool?: string;
  arguments?: Record<string, unknown>;
  result?: { content?: { type?: string; text?: string }[] } | null;
  error?: { message?: string } | string | null;
};

type CodexEvent = {
  type?: string;
  thread_id?: string;
  item?: CodexItem;
  usage?: { input_tokens?: number; output_tokens?: number; cached_input_tokens?: number; cache_write_input_tokens?: number };
  error?: { message?: string };
};

/** The model a thread's replies and result are filed under: the card's own, or "Codex" on the default. */
export function codexLabel(session: Session): string {
  const model = session.spec.model;
  return model && model !== CODEX_DEFAULT_MODEL ? model : "Codex";
}

// The tool the thread shows for an item: a shell command is Bash, an MCP call keeps Claude's mcp__server__tool name.
export function toolUse(item: CodexItem) {
  if (item.type === "mcp_tool_call") return { name: `mcp__${item.server}__${item.tool}`, input: item.arguments ?? {} };
  return { name: "Bash", input: { command: item.command ?? "Codex command" } };
}

export function mcpResult(item: CodexItem) {
  if (item.error) return { result: typeof item.error === "string" ? item.error : (item.error.message ?? "The tool failed."), isError: true };
  const text = (item.result?.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("\n").trim();
  return { result: text, isError: item.status === "failed" };
}

/** A finished item's outcome: an MCP call's result, or a command's output (its exit code when it printed nothing). */
export function commandResult(item: CodexItem) {
  if (item.type === "mcp_tool_call") return mcpResult(item);
  const output = item.aggregated_output?.trim();
  return {
    result: output || (item.exit_code === undefined ? "" : `Exited with code ${item.exit_code}.`),
    isError: item.status === "failed" || (item.exit_code !== undefined && item.exit_code !== 0),
  };
}

// A tool row is filed under the spec's model as it is, the default's own id included.
async function toolStart(session: Session, item: CodexItem) {
  await fileToolStart(session, item.id ?? "", toolUse(item), session.spec.model ?? "Codex", "codex");
}

async function toolFinish(session: Session, item: CodexItem) {
  if (!item.id) return;
  await toolStart(session, item);
  await fileToolResult(session, item.id, commandResult(item));
}

/** A file_change's paths, so the card's overlap warning knows them. */
function noteFileChanges(session: Session, item: CodexItem) {
  noteTouched(session, (item.changes ?? []).map((change) => change.path ?? ""));
}

async function result(session: Session, event: CodexEvent, error?: string) {
  const usage = event.usage ?? {};
  await fileResult(session, codexLabel(session), {
    error,
    usage: { input: usage.input_tokens, output: usage.output_tokens, cacheRead: usage.cached_input_tokens, cacheWrite: usage.cache_write_input_tokens },
  });
}

async function handleItemEvent(session: Session, event: CodexEvent) {
  const item = event.item;
  if (!item) return;
  if (item.type === "command_execution" || item.type === "mcp_tool_call") {
    if (event.type === "item.started") await toolStart(session, item);
    else if (event.type === "item.completed") await toolFinish(session, item);
    return;
  }
  if (event.type !== "item.completed") return;
  if (item.type === "file_change") noteFileChanges(session, item);
  else if (item.type === "agent_message" && item.text) await fileReply(session, item.text, codexLabel(session), "codex");
}

/** Applies one event to the thread. True when it ended the turn. */
async function handleEvent(session: Session, event: CodexEvent) {
  if (event.type === "thread.started") {
    if (event.thread_id) keepSessionId(session, event.thread_id);
    return false;
  }
  if (event.type === "item.started" || event.type === "item.updated" || event.type === "item.completed") {
    await handleItemEvent(session, event);
    return false;
  }
  if (event.type === "turn.completed") {
    await result(session, event);
    return true;
  }
  if (event.type === "turn.failed") {
    await result(session, event, event.error?.message ?? "Codex turn failed.");
    return true;
  }
  return false;
}

/** One turn: `codex exec` behind Weft's guards and tools, the prompt on stdin, its events filed as they come. */
async function runCodexTurn(session: Session, executable: string, message: SDKUserMessage) {
  const input = codexInput(message);
  // Weft's guards, through Codex's own hooks (lib/guards/codex.ts). Without them the turn doesn't start.
  const guards = openGuards(session, "codex");
  const attachments = writeImages(input.images);
  const env = withConnectorEnv(cliEnv(), () => session.cardId ?? undefined) as NodeJS.ProcessEnv;
  delete env.CLAUDE_CODE_ENTRYPOINT;
  // Weft's tools for this turn, over HTTP; the server's own port says where (PORT is stripped from the CLI's env).
  const servers = () => weftMcpServers(session.spec, () => session.cardId ?? undefined);
  const bridge = process.env.PORT ? openBridge(servers) : undefined;
  if (bridge) env[BRIDGE_TOKEN_ENV] = bridge.token;
  const mcp = bridge ? codexMcpArgs(`http://127.0.0.1:${process.env.PORT}`, Object.keys(servers())) : [];
  Object.assign(env, guards.env);
  try {
    await runCliTurn(session, {
      name: "Codex",
      command: executable,
      args: argsFor(session, attachments.paths, [...codexGuardArgs(), ...mcp]),
      env,
      stdin: promptFor(session, input.text),
      read: (stdout) => readJsonLines(stdout, (event) => handleEvent(session, event)),
    });
  } finally {
    guards.close();
    bridge?.close();
    if (attachments.directory) fs.rmSync(attachments.directory, { recursive: true, force: true });
  }
}

export function codexAdapter(executable: string): CliAdapter {
  return { name: "Codex", runTurn: (session, message) => runCodexTurn(session, executable, message) };
}

export function driveCodex(session: Session, executable: string) {
  return driveAdapter(session, codexAdapter(executable));
}

export const CODEX_CODE = [
  driveCodex, codexAdapter, runCodexTurn, codexLabel, toolStart, toolFinish, commandResult, noteFileChanges, result, ...CODEX_PROMPT_CODE, ...CODEX_INPUT_CODE,
  handleItemEvent, handleEvent, codexGuardArgs, ...CLI_ADAPTER_CODE, ...CLI_MESSAGES_CODE, ...CLI_TURN_CODE,
];
