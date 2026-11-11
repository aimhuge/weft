import { randomUUID } from "node:crypto";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { SessionConfig } from "@github/copilot-sdk";
import { codexInput } from "./codex-input";
import { copilotSessionDefaults, githubCopilotClient } from "./github-copilot-client";
import { githubCopilotTools } from "./github-copilot-tools";
import { handle } from "./runner-turn";
import { redactStored } from "./secret-run";
import { safeUpdate, type Session } from "./runner-state";

const TURN_TIMEOUT_MS = 60 * 60_000;
const MODEL = "GitHub Copilot";

export function copilotSessionConfig(session: Session): SessionConfig {
  return {
    ...copilotSessionDefaults,
    workingDirectory: session.spec.cwd,
    availableTools: ["custom:weft_list_files", "custom:weft_read_file", "custom:weft_edit_file"],
    tools: githubCopilotTools(session),
  };
}

export async function copilotAssistant(session: Session, content: unknown[]) {
  if (!session.cardId) return;
  await handle(session.cardId, session, {
    type: "assistant",
    parent_tool_use_id: null,
    message: { id: randomUUID(), type: "message", role: "assistant", model: MODEL, content },
  } as SDKMessage);
}

async function copilotResult(session: Session, text: string) {
  if (!session.cardId || !session.sessionId) return;
  await handle(session.cardId, session, {
    type: "result",
    subtype: "success",
    is_error: false,
    result: text,
    session_id: session.sessionId,
    total_cost_usd: 0,
    modelUsage: {},
  } as SDKMessage);
}

export async function driveGitHubCopilot(session: Session) {
  if (process.env.WEFT_WORKER === "1") throw new Error("GitHub Copilot is only available on the local desktop.");
  const id = session.cardId;
  if (!id) return;
  if (session.spec.forkSession || session.spec.resumeAt) {
    throw new Error("GitHub Copilot does not support Weft session forks or rewind.");
  }
  for await (const message of session.inbox) {
    if (session.abort.signal.aborted) break;
    await runTurn(session, id, message);
  }
}

async function runTurn(session: Session, id: string, message: SDKMessage) {
  const client = await githubCopilotClient();
  const signal = session.abort.signal;
  const stop = () => { void client.forceStop().catch(() => {}); };
  signal.addEventListener("abort", stop, { once: true });
  try {
    signal.throwIfAborted();
    await client.start();
    const status = await client.getAuthStatus();
    if (!status.isAuthenticated) throw new Error("GitHub Copilot is not logged in. Sign in to GitHub Copilot in Weft.");
    signal.throwIfAborted();
    const config = copilotSessionConfig(session);
    const previous = session.sessionId ?? session.spec.sessionId;
    const copilot = previous ? await client.resumeSession(previous, config) : await client.createSession(config);
    signal.throwIfAborted();
    session.sessionId = copilot.sessionId;
    if (!previous) safeUpdate(id, { sessionId: copilot.sessionId });
    const { text, images } = codexInput(message);
    const reply = await copilot.sendAndWait({
      prompt: text,
      attachments: images.map(({ mediaType, data }) => ({ type: "blob" as const, mimeType: mediaType, data })),
    }, TURN_TIMEOUT_MS);
    signal.throwIfAborted();
    if (!reply?.data.content) throw new Error("GitHub Copilot ended the turn without a reply.");
    const clean = await redactStored(id, reply.data.content);
    await copilotAssistant(session, [{ type: "text", text: clean }]);
    await copilotResult(session, clean);
  } finally {
    signal.removeEventListener("abort", stop);
    await client.forceStop();
  }
}
