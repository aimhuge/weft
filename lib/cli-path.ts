import { execFileSync } from "node:child_process";
import type { Backend } from "./types";

const paths: Partial<Record<Backend, string>> = {};

// Claude Code comes from the Agent SDK; puku-cli, Codex and Goose come from the user's PATH.
export function executableFor(backend: Backend) {
  if (backend === "claude") return undefined;
  if (!paths[backend]) {
    const command = backend === "puku" ? "puku-cli" : backend === "goose" ? "goose" : "codex";
    try {
      paths[backend] = execFileSync("/usr/bin/which", [command], { encoding: "utf8" }).trim();
    } catch {
      throw new Error(`${command} isn't on this app's PATH.`);
    }
  }
  return paths[backend];
}
