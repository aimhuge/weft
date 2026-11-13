import fs from "node:fs";
import path from "node:path";
import type { SessionConfig } from "@github/copilot-sdk";
import { cliEnv } from "./env";
import { DATA_DIR } from "./store";
import type { CliStatus } from "./types";

export const copilotSessionDefaults = {
  availableTools: [],
  includedBuiltinAgents: [],
  includedBuiltinSkills: [],
  enableConfigDiscovery: false,
  enableExperimentalMode: false,
  enableFileHooks: false,
  enableHostGitOperations: false,
  enableOnDemandInstructionDiscovery: false,
  enableSessionStore: false,
  enableSessionTelemetry: false,
  enableSkills: false,
  skipCustomInstructions: true,
  skipEmbeddingRetrieval: true,
  embeddingCacheStorage: "in-memory",
  mcpOAuthTokenStorage: "in-memory",
  memory: { enabled: false },
  customAgentsLocalOnly: true,
  coauthorEnabled: false,
  manageScheduleEnabled: false,
  systemMessage: { mode: "customize", sections: { environment_context: { action: "remove" } } },
  onPermissionRequest: () => ({ kind: "reject" }),
} satisfies SessionConfig;

export async function githubCopilotClient() {
  const { CopilotClient } = await import("@github/copilot-sdk");
  const baseDirectory = path.join(DATA_DIR, "github-copilot");
  fs.mkdirSync(baseDirectory, { recursive: true, mode: 0o700 });
  const env = cliEnv();
  for (const key of Object.keys(env)) {
    if (/^(ANTHROPIC_|PUKU_|CODEX_|CLAUDE_CODE_|COPILOT_|WEFT_)/i.test(key)) Reflect.deleteProperty(env, key);
  }
  env.COPILOT_HOME = baseDirectory;
  // SDK empty mode disables the OS credential store, including for device sign-in.
  return new CopilotClient({ mode: "copilot-cli", baseDirectory, env, logLevel: "error" });
}

export async function githubCopilotStatus(): Promise<CliStatus> {
  try {
    const client = await githubCopilotClient();
    const timeout = setTimeout(() => { void client.forceStop().catch(() => {}); }, 10_000);
    try {
      await client.start();
      const status = await client.getAuthStatus();
      return { loggedIn: status.isAuthenticated };
    } finally {
      clearTimeout(timeout);
      await client.forceStop();
    }
  } catch (err) {
    return { loggedIn: false, error: err instanceof Error ? err.message : "Could not check GitHub Copilot sign-in." };
  }
}
