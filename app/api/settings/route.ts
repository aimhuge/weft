import { randomUUID } from "node:crypto";
import { connection } from "next/server";
import { patternRegex } from "@/lib/automations";
import { asText } from "@/lib/format";
import { elevated, fail, guard } from "@/lib/guard";
import { EFFORTS, ALL_MODEL_IDS, BACKEND_IDS, isModelValue } from "@/lib/new-thread";
import { setNamedModels, type GooseNamedModel } from "@/lib/goose-models";
import { GOOSE_PROVIDERS } from "@/lib/goose-provider";
import { setAutomations, setBackupModel, setCopilotModel, setDefaultBackend, setDefaultPermissionMode, setDoneEffort, setDoneModel, setGooseBaseUrl, setGooseModelId, setGooseProviderId, setKeepAliveMinutes, setMaxThreads, MAX_THREADS_CEILING, setPushOnDone, setReviewAllModel, setSubagentModel, setThreadPrompt, settingsView } from "@/lib/settings";
import { freeSlots } from "@/lib/runner";
import { SKILL_NAME } from "@/lib/skills";
import { isSubagentModel } from "@/lib/subagents";
import { AUTOMATION_TRIGGERS, MODES, type Automation, type Backend, type SettingsPatch } from "@/lib/types";

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
  // A model is one of the CLIs' own ids or a Goose model ("goose:<id>", lib/new-thread.ts).
  const allowed = field === "doneModel" ? isModelValue : (v: string) => DONE_EFFORT_IDS.has(v);
  const names = field === "doneModel" ? [...ALL_MODEL_IDS] : EFFORTS.map((e) => e.id);
  if (value === undefined) return;
  if (typeof value !== "string" || !(value === "" || allowed(value))) {
    throw new Error(`${field} must be one of ${names.join(", ")}, or "" for the card's own.`);
  }
}

function validateCopilotModel(value: unknown) {
  if (value === undefined) return;
  if (typeof value !== "string" || !(value === "" || isModelValue(value))) {
    throw new Error(`copilotModel must be one of ${[...ALL_MODEL_IDS].join(", ")}, or "" for the user's last-picked.`);
  }
}

function validateReviewAllModel(value: unknown) {
  if (value === undefined) return;
  if (typeof value !== "string" || !(value === "" || isModelValue(value))) {
    throw new Error(`reviewAllModel must be one of ${[...ALL_MODEL_IDS].join(", ")}, or "" for the default.`);
  }
}

// Any model any installed CLI serves, or "" to disable the banner's rerun.
function validateBackupModel(value: unknown) {
  if (value === undefined) return;
  if (typeof value !== "string" || !(value === "" || isModelValue(value))) {
    throw new Error(`backupModel must be one of ${[...ALL_MODEL_IDS].join(", ")}, or "" to disable.`);
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

// The names the user gave their Goose models (lib/goose-models.ts): a list of { id, name }, both text.
// Blank rows are dropped when saved, so the list as typed is fine; anything else is refused.
function readNamedModels(value: unknown): GooseNamedModel[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error("gooseNamedModels must be a list of { id, name }.");
  const models: GooseNamedModel[] = [];
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null) throw new Error("gooseNamedModels must be a list of { id, name }.");
    const { id, name } = entry as { id?: unknown; name?: unknown };
    if (typeof id !== "string" || typeof name !== "string") {
      throw new Error("gooseNamedModels must be a list of { id, name }.");
    }
    models.push({ id, name });
  }
  return models;
}

// How many threads may run at once: a whole number, 0 for no limit.
function validateMaxThreads(value: unknown) {
  if (value === undefined) return;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > MAX_THREADS_CEILING) {
    throw new Error(`maxThreads must be a whole number from 0 (no limit) to ${MAX_THREADS_CEILING}.`);
  }
}

// Saves the cap, then lets the threads that were waiting for a slot go if it went up.
function applyMaxThreads(value: unknown) {
  if (typeof value !== "number") return;
  setMaxThreads(value);
  freeSlots();
}

// The body as it arrived: every field checked before anything is saved. The checks are runtime
// checks on untrusted JSON, so they read each field as it is rather than trusting its type.
function validate(body: SettingsPatch): { rules: Automation[] | undefined; named: GooseNamedModel[] | undefined } {
  if (body.threadPrompt !== undefined && typeof body.threadPrompt !== "string") {
    throw new Error("threadPrompt must be text.");
  }
  if (
    body.keepAliveMinutes !== undefined &&
    (typeof body.keepAliveMinutes !== "number" || !Number.isFinite(body.keepAliveMinutes) || body.keepAliveMinutes < 0)
  ) {
    throw new Error("keepAliveMinutes must be a number of minutes, 0 or more.");
  }
  validateMaxThreads(body.maxThreads);
  if (body.defaultPermissionMode !== undefined && !MODES.includes(body.defaultPermissionMode)) {
    throw new Error(`defaultPermissionMode must be one of ${MODES.join(", ")}.`);
  }
  if (body.defaultBackend !== undefined && !BACKENDS.includes(body.defaultBackend)) {
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
  const named = readNamedModels(body.gooseNamedModels);
  // Validate automations now so a bad rule 400s before any settings setter runs.
  return { rules: body.automations === undefined ? undefined : readAutomations(body.automations), named };
}

// The Goose settings: the provider, the model, the endpoint, and the names the user gave their
// models. Their own function, so commit stays a list of one-line saves.
function commitGoose(body: SettingsPatch, named: GooseNamedModel[] | undefined) {
  if (typeof body.gooseProviderId === "string") setGooseProviderId(body.gooseProviderId);
  if (typeof body.gooseModelId === "string") setGooseModelId(body.gooseModelId);
  if (typeof body.gooseBaseUrl === "string") setGooseBaseUrl(body.gooseBaseUrl);
  if (named) setNamedModels(named);
}

// The rules arrive already read and checked (readAutomations), so commit saves them as they are.
// The body type is the shared one (lib/types-settings.ts); the automations field on it is left
// alone here — the checked rules are what gets saved.
function commit(body: SettingsPatch, { rules, named }: ReturnType<typeof validate>) {
  if (typeof body.threadPrompt === "string") setThreadPrompt(body.threadPrompt);
  if (typeof body.keepAliveMinutes === "number") setKeepAliveMinutes(body.keepAliveMinutes);
  applyMaxThreads(body.maxThreads);
  if (body.defaultPermissionMode !== undefined) setDefaultPermissionMode(body.defaultPermissionMode);
  if (body.defaultBackend !== undefined) setDefaultBackend(body.defaultBackend);
  if (typeof body.pushOnDone === "boolean") setPushOnDone(body.pushOnDone);
  if (isSubagentModel(body.subagentModel)) setSubagentModel(body.subagentModel);
  if (typeof body.doneModel === "string") setDoneModel(body.doneModel);
  if (typeof body.doneEffort === "string") setDoneEffort(body.doneEffort);
  if (typeof body.copilotModel === "string") setCopilotModel(body.copilotModel);
  if (typeof body.reviewAllModel === "string") setReviewAllModel(body.reviewAllModel);
  if (typeof body.backupModel === "string") setBackupModel(body.backupModel);
  commitGoose(body, named);
  if (rules) setAutomations(rules);
}

export async function PATCH(req: Request) {
  const denied = elevated(req);
  if (denied) return denied;
  try {
    // The body is parsed JSON, so it is untrusted whatever the type says: the cast gives the
    // fields their names, and validate() checks each one before anything is saved.
    const body = (await req.json()) as SettingsPatch;
    commit(body, validate(body));
    return Response.json(settingsView());
  } catch (err) {
    return fail(err);
  }
}
