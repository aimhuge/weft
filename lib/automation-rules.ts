// The automation rules as a body sends them (Settings → Automations), checked: the settings route takes them from the
// form, and a worker from your account's synced settings (lib/host-settings.ts), so both refuse the same rule.
import { randomUUID } from "node:crypto";
import { patternRegex } from "./automations";
import { asText } from "./format";
import { SKILL_NAME } from "./skills";
import { AUTOMATION_TRIGGERS, type Automation } from "./types";

// The rules as sent, checked; a leading slash on a skill name is dropped.
export function readAutomations(value: unknown): Automation[] {
  if (!Array.isArray(value)) throw new Error("automations must be a list.");
  return value.map((raw) => {
    const rule = (raw ?? {}) as Record<string, unknown>;
    const trigger = AUTOMATION_TRIGGERS.find((t) => t.id === rule.on);
    if (!trigger) throw new Error(`Unknown automation trigger ${JSON.stringify(rule.on)}.`);
    const skill = asText(rule.skill).trim().replace(/^\//, "");
    if (!SKILL_NAME.test(skill)) throw new Error(`Pick a skill for “when ${trigger.label}”.`);
    const id = typeof rule.id === "string" && rule.id ? rule.id : randomUUID();
    if (trigger.id !== "prompt-matches") return { id, on: trigger.id, skill };
    const pattern = asText(rule.pattern).trim();
    if (!pattern) throw new Error(`Enter a pattern for “when ${trigger.label}”.`);
    if (!patternRegex(pattern)) throw new Error(`“${pattern}” isn't a valid pattern.`);
    return { id, on: trigger.id, skill, pattern };
  });
}
