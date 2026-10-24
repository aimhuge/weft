import { randomUUID } from "node:crypto";
import { connection } from "next/server";
import { patternRegex } from "@/lib/automations";
import { asText } from "@/lib/format";
import { elevated, fail, guard } from "@/lib/guard";
import { EFFORTS, ALL_MODEL_IDS, BACKEND_IDS } from "@/lib/new-thread";
import { GOOSE_PROVIDERS } from "@/lib/goose-provider";
import { setAutomations, setBackupModel, setCopilotModel, setDefaultBackend, setDefaultPermissionMode, setDoneEffort, setDoneModel, setGooseBaseUrl, setGooseModelId, setGooseProviderId, setKeepAliveMinutes, setPushOnDone, setReviewAllModel, setSubagentModel, setThreadPrompt, settingsView } from "@/lib/settings";
import { SKILL_NAME } from "@/lib/skills";
import { isSubagentModel } from "@/lib/subagents";
import { AUTOMATION_TRIGGERS, MODES, type Automation, type Backend, type PermissionMode } from "@/lib/types";

// Every CLI a setting may name. Shared (lib/new-thread.ts), so a CLI added there is
// settable here too.
const BACKENDS: Backend[] = BACKEND_IDS;
// Every model any CLI serves. The pickers offer them all — picking a model moves the thread's
// CLI to the one that serves it — so the API accepts them all too. The set is shared
// (lib/new-thread.ts), so a CLI's models come with it.
const DONE_EFFORT_IDS = new Set<string>(EFFORTS.map((e) => e.id));

// The rules as sent, checked; a leading slash on a skill name is dropped.
function readAutomations(value: unknown): Automation[] {
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

export async function GET(req: Request) {
  const denied = guard(req, { write: false });
  if (denied) return denied;
  await connection();
  return Response.json(settingsView());
}

function validateDone(field: "doneModel" | "doneEffort", value: unknown) {
  const allowed = field === "doneModel" ? ALL_MODEL_IDS : DONE_EFFORT_IDS;
  const names = field === "doneModel" ? [...ALL_MODEL_IDS] : EFFORTS.map((e) => e.id);
  if (value === undefined) return;
  if (typeof value !== "string" || !allowed.has(value)) {
    throw new Error(`${field} must be one of ${names.join(", ")}, or "" for the card's own.`);
  }
}

function validateCopilotModel(value: unknown) {
  if (value === undefined) return;
  if (typeof value !== "string" || !(value === "" || ALL_MODEL_IDS.has(value))) {
    throw new Error(`copilotModel must be one of ${[...ALL_MODEL_IDS].join(", ")}, or "" for the user's last-picked.`);
  }
}

function validateReviewAllModel(value: unknown) {
  if (value === undefined) return;
  if (typeof value !== "string" || !(value === "" || ALL_MODEL_IDS.has(value))) {
    throw new Error(`reviewAllModel must be one of ${[...ALL_MODEL_IDS].join(", ")}, or "" for the default.`);
  }
}

// Any model any installed CLI serves, or "" to disable the banner's rerun.
const BACKUP_MODEL_IDS = ALL_MODEL_IDS;
function validateBackupModel(value: unknown) {
  if (value === undefined) return;
  if (typeof value !== "string" || !(value === "" || BACKUP_MODEL_IDS.has(value))) {
    throw new Error(`backupModel must be one of ${[...BACKUP_MODEL_IDS].join(", ")}, or "" to disable.`);
  }
}

// The Goose provider a Goose thread runs on: one of the catalog's ids, or "" for none picked.
const GOOSE_PROVIDER_IDS = new Set<string>(GOOSE_PROVIDERS.map((p) => p.id));
function validateGooseProviderId(value: unknown) {
  if (value === undefined) return;
  if (typeof value !== "string" || !(value === "" || GOOSE_PROVIDER_IDS.has(value))) {
    throw new Error(`gooseProviderId must be one of ${[...GOOSE_PROVIDER_IDS].join(", ")}, or "" for none.`);
  }
}

// The model a new Goose thread runs on and the endpoint the providers that need one use.
// Both are free text: a provider can serve any model id, and an endpoint is the user's own
// URL. "" is the default — the provider's own model, no endpoint.
function validateGooseText(field: "gooseModelId" | "gooseBaseUrl", value: unknown) {
  if (value === undefined) return;
  if (typeof value !== "string") throw new Error(`${field} must be text.`);
}

function validate(body: {
  threadPrompt?: unknown;
  keepAliveMinutes?: unknown;
  defaultPermissionMode?: unknown;
  defaultBackend?: unknown;
  automations?: unknown;
  pushOnDone?: unknown;
  subagentModel?: unknown;
  doneModel?: unknown;
  doneEffort?: unknown;
  copilotModel?: unknown;
  reviewAllModel?: unknown;
  backupModel?: unknown;
  gooseProviderId?: unknown;
  gooseModelId?: unknown;
  gooseBaseUrl?: unknown;
}): Automation[] | undefined {
  if (body.threadPrompt !== undefined && typeof body.threadPrompt !== "string") {
    throw new Error("threadPrompt must be text.");
  }
  if (
    body.keepAliveMinutes !== undefined &&
    (typeof body.keepAliveMinutes !== "number" || !Number.isFinite(body.keepAliveMinutes) || body.keepAliveMinutes < 0)
  ) {
    throw new Error("keepAliveMinutes must be a number of minutes, 0 or more.");
  }
  if (body.defaultPermissionMode !== undefined && !MODES.includes(body.defaultPermissionMode as PermissionMode)) {
    throw new Error(`defaultPermissionMode must be one of ${MODES.join(", ")}.`);
  }
  if (body.defaultBackend !== undefined && !BACKENDS.includes(body.defaultBackend as Backend)) {
    throw new Error(`defaultBackend must be one of ${BACKENDS.join(", ")}.`);
  }
  if (body.pushOnDone !== undefined && typeof body.pushOnDone !== "boolean") throw new Error("pushOnDone must be true or false.");
  if (body.subagentModel !== undefined && !isSubagentModel(body.subagentModel)) {
    throw new Error("subagentModel must be choose, inherit, or a model id one of the CLIs serves.");
  }
  validateDone("doneModel", body.doneModel);
  validateDone("doneEffort", body.doneEffort);
  validateCopilotModel(body.copilotModel);
  validateReviewAllModel(body.reviewAllModel);
  validateBackupModel(body.backupModel);
  validateGooseProviderId(body.gooseProviderId);
  validateGooseText("gooseModelId", body.gooseModelId);
  validateGooseText("gooseBaseUrl", body.gooseBaseUrl);
  // Validate automations now so a bad rule 400s before any settings setter runs.
  return body.automations === undefined ? undefined : readAutomations(body.automations);
}

function commit(body: {
  threadPrompt?: unknown;
  keepAliveMinutes?: unknown;
  defaultPermissionMode?: unknown;
  defaultBackend?: unknown;
  pushOnDone?: unknown;
  subagentModel?: unknown;
  doneModel?: unknown;
  doneEffort?: unknown;
  copilotModel?: unknown;
  reviewAllModel?: unknown;
  backupModel?: unknown;
  gooseProviderId?: unknown;
  gooseModelId?: unknown;
  gooseBaseUrl?: unknown;
}, rules: Automation[] | undefined) {
  if (typeof body.threadPrompt === "string") setThreadPrompt(body.threadPrompt);
  if (typeof body.keepAliveMinutes === "number") setKeepAliveMinutes(body.keepAliveMinutes);
  if (body.defaultPermissionMode !== undefined) setDefaultPermissionMode(body.defaultPermissionMode as PermissionMode);
  if (body.defaultBackend !== undefined) setDefaultBackend(body.defaultBackend as Backend);
  if (typeof body.pushOnDone === "boolean") setPushOnDone(body.pushOnDone);
  if (isSubagentModel(body.subagentModel)) setSubagentModel(body.subagentModel);
  if (typeof body.doneModel === "string") setDoneModel(body.doneModel);
  if (typeof body.doneEffort === "string") setDoneEffort(body.doneEffort as "" | "low" | "medium" | "high" | "xhigh" | "max");
  if (typeof body.copilotModel === "string") setCopilotModel(body.copilotModel);
  if (typeof body.reviewAllModel === "string") setReviewAllModel(body.reviewAllModel);
  if (typeof body.backupModel === "string") setBackupModel(body.backupModel);
  if (typeof body.gooseProviderId === "string") setGooseProviderId(body.gooseProviderId);
  if (typeof body.gooseModelId === "string") setGooseModelId(body.gooseModelId);
  if (typeof body.gooseBaseUrl === "string") setGooseBaseUrl(body.gooseBaseUrl);
  if (rules) setAutomations(rules);
}

export async function PATCH(req: Request) {
  const denied = elevated(req);
  if (denied) return denied;
  try {
    const body = (await req.json()) as Parameters<typeof validate>[0];
    const rules = validate(body);
    commit(body, rules);
    return Response.json(settingsView());
  } catch (err) {
    return fail(err);
  }
}
