import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import type { CopilotClient, CopilotSession, SessionConfig } from "@github/copilot-sdk";
import { CLI_ADAPTER_CODE, driveAdapter, type CliAdapter } from "./cli-adapter";
import { CLI_MESSAGES_CODE, fileReply, fileResult, keepSessionId } from "./cli-messages";
import { CODEX_INPUT_CODE, codexInput } from "./codex-input";
import { copilotSessionDefaults, githubCopilotClient } from "./github-copilot-client";
import { githubCopilotTools } from "./github-copilot-tools";
import type { Session } from "./runner-state";

// A Weft thread on GitHub Copilot (docs/architecture/github-copilot.md), as a CLI adapter (docs/architecture/cli-adapters.md).
// The SDK's runtime starts for each turn and stops when it ends, like Codex's process; the conversation lives on in the
// SDK's session, resumed by id on the next turn. A stop is the SDK session's abort(), which ends the turn and leaves the
// thread open; a session abort (closing the thread, or a stop that didn't take) stops the runtime itself.

const TURN_TIMEOUT_MS = 60 * 60_000;
const MODEL = "GitHub Copilot";

/** The running turn: the SDK session once it's open, and whether a stop cancelled it. */
type CopilotTurn = { cancel: AbortController; copilot?: CopilotSession };
export type CopilotState = { turn?: CopilotTurn };

export function copilotSessionConfig(session: Session): SessionConfig {
  return {
    ...copilotSessionDefaults,
    workingDirectory: session.spec.cwd,
    availableTools: ["custom:weft_list_files", "custom:weft_read_file", "custom:weft_edit_file"],
    tools: githubCopilotTools(session),
  };
}

/** What a Copilot thread can't do, refused before its first turn. */
export function startCopilot(session: Session): Promise<CopilotState> {
  if (process.env.WEFT_WORKER === "1") throw new Error("GitHub Copilot is only available on the local desktop.");
  if (session.spec.forkSession || session.spec.resumeAt) {
    throw new Error("GitHub Copilot does not support Weft session forks or rewind.");
  }
  return Promise.resolve({});
}

/** Starts the runtime, checks sign-in and opens the card's conversation: its own again, or a new one. */
async function openCopilot(session: Session, client: CopilotClient, turn: CopilotTurn, live: AbortSignal) {
  live.throwIfAborted();
  await client.start();
  const status = await client.getAuthStatus();
  if (!status.isAuthenticated) throw new Error("GitHub Copilot is not logged in. Sign in to GitHub Copilot in Weft.");
  live.throwIfAborted();
  const config = copilotSessionConfig(session);
  const previous = session.sessionId ?? session.spec.sessionId;
  turn.copilot = previous ? await client.resumeSession(previous, config) : await client.createSession(config);
  live.throwIfAborted();
  keepSessionId(session, turn.copilot.sessionId);
  return turn.copilot;
}

/** One turn: the prompt and its images to the SDK session, its final reply filed, then the result row. */
export async function runCopilotTurn(session: Session, message: SDKUserMessage, state: CopilotState): Promise<void> {
  const turn: CopilotTurn = { cancel: new AbortController() };
  state.turn = turn;
  const client = await githubCopilotClient();
  const signal = session.abort.signal;
  const live = AbortSignal.any([signal, turn.cancel.signal]);
  const stop = () => { void client.forceStop().catch(() => {}); };
  signal.addEventListener("abort", stop, { once: true });
  try {
    const copilot = await openCopilot(session, client, turn, live);
    const { text, images } = codexInput(message);
    const reply = await copilot.sendAndWait({
      prompt: text,
      attachments: images.map(({ mediaType, data }) => ({ type: "blob" as const, mimeType: mediaType, data })),
    }, TURN_TIMEOUT_MS);
    live.throwIfAborted();
    if (!reply?.data.content) throw new Error("GitHub Copilot ended the turn without a reply.");
    await fileReply(session, reply.data.content, MODEL, "copilot");
    await fileResult(session, MODEL, { text: reply.data.content });
  } catch (err) {
    // A stop ends the turn with its result row, so the thread stays open for the next message.
    if (signal.aborted || !turn.cancel.signal.aborted) throw err;
    await fileResult(session, MODEL, {});
  } finally {
    state.turn = undefined;
    signal.removeEventListener("abort", stop);
    await client.forceStop();
  }
}

/** Stops the running turn: the SDK session's abort, which makes its sendAndWait reject; the thread stays open. */
export function cancelCopilot(_session: Session, state: CopilotState): void {
  const turn = state.turn;
  if (!turn) return;
  turn.cancel.abort();
  void turn.copilot?.abort().catch(() => {});
}

export function githubCopilotAdapter(): CliAdapter<CopilotState> {
  return { name: MODEL, start: startCopilot, runTurn: runCopilotTurn, cancel: cancelCopilot };
}

export function driveGitHubCopilot(session: Session) {
  return driveAdapter(session, githubCopilotAdapter());
}

// The code in this module, fed into the runner's BUILD fingerprint (lib/runner-session.ts) so a change to any of it
// replaces idle sessions.
export const GITHUB_COPILOT_CODE = [
  driveGitHubCopilot, githubCopilotAdapter, startCopilot, openCopilot, runCopilotTurn, cancelCopilot, copilotSessionConfig,
  ...CODEX_INPUT_CODE, ...CLI_ADAPTER_CODE, ...CLI_MESSAGES_CODE,
];
