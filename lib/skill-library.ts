import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { listSkills } from "./skills";
import type { PluginInfo, SkillInfo } from "./types";

// Every skill a thread in a folder could be given: Weft's, the folder's and yours (lib/skills.ts), plus the
// plugins Claude Code installed (/plugin install). A plugin is switched on or off as a whole, because Claude
// Code's `enabledPlugins` setting works that way and its `skillOverrides` don't reach a plugin's skills
// (checked against the CLI on 2026-10-19). posthog alone brings 173 skills.

export interface SkillLibrary {
  skills: SkillInfo[];
  plugins: PluginInfo[];
}

const configDir = () => process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");

function readJson(file: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
  } catch {
    return undefined;
  }
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

// How many skill folders (each with a SKILL.md) a plugin brings.
function skillCount(installPath: string): number {
  try {
    return fs.readdirSync(path.join(installPath, "skills")).filter((d) => fs.existsSync(path.join(installPath, "skills", d, "SKILL.md"))).length;
  } catch {
    return 0;
  }
}

function pluginDescription(installPath: string): string {
  const manifest = readJson(path.join(installPath, ".claude-plugin", "plugin.json"));
  const description = isObject(manifest) && typeof manifest.description === "string" ? manifest.description : "";
  return description.length > 240 ? `${description.slice(0, 239)}…` : description;
}

// The plugins in ~/.claude/plugins/installed_plugins.json that your settings haven't turned off, with the
// folder each is installed in. An id is "name@marketplace", the key `enabledPlugins` takes.
export function pluginInstalls(): { id: string; installPath: string }[] {
  const installed = readJson(path.join(configDir(), "plugins", "installed_plugins.json"));
  const settings = readJson(path.join(configDir(), "settings.json"));
  const enabled = isObject(settings) && isObject(settings.enabledPlugins) ? settings.enabledPlugins : {};
  const plugins = isObject(installed) && isObject(installed.plugins) ? installed.plugins : {};
  return Object.entries(plugins)
    .filter(([id]) => enabled[id] !== false)
    .map(([id, installs]) => {
      const install: unknown = Array.isArray(installs) ? installs[0] : undefined;
      return { id, installPath: isObject(install) && typeof install.installPath === "string" ? install.installPath : "" };
    });
}

export function installedPlugins(): PluginInfo[] {
  return pluginInstalls()
    .map(({ id, installPath }) => ({ id, name: id.replace(/@.*/, ""), skills: installPath ? skillCount(installPath) : 0, description: installPath ? pluginDescription(installPath) : "" }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function skillLibrary(cwd?: string): SkillLibrary {
  return { skills: listSkills(cwd), plugins: installedPlugins() };
}
