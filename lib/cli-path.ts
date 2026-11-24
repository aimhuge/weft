import { execFileSync } from "node:child_process";
import { antigravityBin } from "./antigravity-login";
import type { Backend } from "./types";
import { findOnWindowsPath, isWindows } from "./win-command";

const paths: Partial<Record<Backend, string>> = {};

// Claude Code comes from the Agent SDK; puku-cli, Codex and Goose come from the user's PATH. Antigravity's agy
// too, or from ~/.local/bin where Google's installer puts it (an app opened from the Dock may not have it on PATH).
export function executableFor(backend: Backend) {
  if (backend === "claude" || backend === "github-copilot") return undefined;
  if (!paths[backend]) {
    const command = backend === "puku" ? "puku-cli" : backend === "goose" ? "goose" : backend === "antigravity" ? "agy" : "codex";
    try {
      if (backend === "antigravity") paths[backend] = antigravityBin() || fail();
      else paths[backend] = isWindows() ? findOnWindowsPath(command) || fail() : execFileSync("/usr/bin/which", [command], { encoding: "utf8" }).trim();
    } catch {
      throw new Error(`${command} isn't on this app's PATH.`);
    }
  }
  return paths[backend];
}

function fail(): never {
  throw new Error("not found");
}
