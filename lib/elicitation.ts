import type { ElicitationRequest, ElicitationResult, PermissionResult } from "@anthropic-ai/claude-agent-sdk";
import type { Session } from "./runner-state";
import type { ElicitField, PendingElicitation } from "./types";

// An MCP server asking the user something mid-call (an MCP elicitation): the Supabase MCP confirming a
// destructive execute_sql, a server asking for a form's values or sending you to a URL. Without
// Options.onElicitation the SDK declines every one before the user sees it, so lib/runner-session.ts
// hands them here: each becomes a Needs-you prompt on the card (lib/runner-ask.ts askUser, rendered by
// components/ElicitationForm.tsx), and the user's Accept, Decline or form values go back to the server.

type Schema = Record<string, unknown>;
type Answers = Record<string, string>;
type Content = NonNullable<ElicitationResult["content"]>;

const record = (v: unknown): Schema | undefined => (v && typeof v === "object" && !Array.isArray(v) ? (v as Schema) : undefined);
const text = (v: unknown) => (typeof v === "string" && v.trim() ? v : undefined);
// A schema value (an enum's choice, a default) as the string its answer travels as; a list or object as JSON.
const str = (v: unknown) => (typeof v === "object" && v !== null ? JSON.stringify(v) : String(v));

// One choice list from `enum` (+ the older `enumNames`) or `oneOf`/`anyOf` of { const, title }.
function choices(prop: Schema): ElicitField["options"] {
  if (Array.isArray(prop.enum)) {
    const names = Array.isArray(prop.enumNames) ? prop.enumNames : [];
    return prop.enum.map((value, i) => ({ value: str(value), label: text(names[i]) ?? str(value) }));
  }
  const list = Array.isArray(prop.oneOf) ? prop.oneOf : Array.isArray(prop.anyOf) ? prop.anyOf : undefined;
  if (!list) return undefined;
  return list.flatMap((o) => {
    const opt = record(o);
    return opt && opt.const !== undefined ? [{ value: str(opt.const), label: text(opt.title) ?? str(opt.const) }] : [];
  });
}

function fieldKind(prop: Schema): Pick<ElicitField, "kind" | "options"> {
  if (prop.type === "array") return { kind: "multi", options: choices(record(prop.items) ?? {}) ?? [] };
  const options = choices(prop);
  if (options) return { kind: "enum", options };
  if (prop.type === "boolean") return { kind: "boolean" };
  if (prop.type === "integer") return { kind: "integer" };
  if (prop.type === "number") return { kind: "number" };
  return { kind: "string" };
}

// The form a requestedSchema asks for, one field per property, in the schema's order.
export function elicitationFields(schema: unknown): ElicitField[] {
  const root = record(schema);
  const props = record(root?.properties);
  if (!props) return [];
  const required = Array.isArray(root?.required) ? root.required : [];
  return Object.entries(props).map(([name, raw]) => {
    const prop = record(raw) ?? {};
    const fallback = prop.default;
    return {
      name,
      title: text(prop.title) ?? name,
      description: text(prop.description),
      required: required.includes(name),
      ...fieldKind(prop),
      default: fallback === undefined ? undefined : str(fallback),
    };
  });
}

// One answer as the type its field asks for; a multi-select arrives as a JSON array of its values.
function typed(field: ElicitField, value: string): Content[string] {
  if (field.kind === "boolean") return value === "true";
  if (field.kind === "number" || field.kind === "integer") {
    const n = Number(value);
    if (!value.trim() || !Number.isFinite(n) || (field.kind === "integer" && !Number.isInteger(n))) throw new Error(`${field.title} needs ${field.kind === "integer" ? "a whole number" : "a number"}.`);
    return n;
  }
  if (field.kind === "multi") {
    const picked: unknown = JSON.parse(value);
    if (!Array.isArray(picked)) throw new Error(`${field.title} needs a list.`);
    return picked.map(String);
  }
  if (field.kind === "enum" && field.options && !field.options.some((o) => o.value === value)) throw new Error(`${field.title} isn't one of its choices.`);
  return value;
}

// The answers as the content the server asked for. Throws (so the board shows it and you can try again)
// for a required field left empty or a value that doesn't fit its field.
export function elicitationContent(fields: ElicitField[], answers: Answers = {}): Content {
  const content: Content = {};
  for (const field of fields) {
    const value = answers[field.name];
    const empty = value === undefined || (value === "" && field.kind !== "string") || (field.kind === "string" && !value.trim());
    if (empty) {
      if (field.required && field.kind !== "boolean") throw new Error(`${field.title} is required.`);
      if (field.kind === "boolean" && field.required) content[field.name] = false;
      continue;
    }
    content[field.name] = typed(field, value);
  }
  return content;
}

// What the card shows: the request without the SDK's correlation ids.
export function pendingElicitation(request: ElicitationRequest): PendingElicitation {
  return {
    server: request.serverName,
    message: request.message,
    ...(request.mode === "url" ? { mode: "url" as const, url: request.url } : {}),
    fields: request.mode === "url" ? [] : elicitationFields(request.requestedSchema),
  };
}

// The prompt's answer, back in the elicitation's terms: Accept (with the form's values), Decline, or
// Cancel when the call was stopped before anyone answered (askUser's abort, "Cancelled.").
export function elicitationResult(result: PermissionResult, elicitation: PendingElicitation): ElicitationResult {
  if (result.behavior === "deny") return { action: result.message === "Cancelled." ? "cancel" : "decline" };
  if (!elicitation.fields.length) return { action: "accept" };
  const answers = record(result.updatedInput?.answers) as Answers | undefined;
  // lib/runner-pending.ts answerPermission checked the form already; one that still doesn't fit is declined, not sent half-made.
  try {
    return { action: "accept", content: elicitationContent(elicitation.fields, answers) };
  } catch {
    return { action: "decline" };
  }
}

type Ask = (
  cardId: string,
  session: Session,
  toolName: string,
  input: Record<string, unknown>,
  signal: AbortSignal,
  title?: string,
  extra?: { elicitation?: PendingElicitation },
) => Promise<PermissionResult>;

// Options.onElicitation for a session: a spare with no card yet can't ask anyone, so it declines.
// The prompt reads as the server's own title (the permission-display header) or its message.
export function onElicitation(session: Session, ask: Ask) {
  return async (request: ElicitationRequest, { signal }: { signal: AbortSignal }): Promise<ElicitationResult> => {
    if (!session.cardId) return { action: "decline" };
    const elicitation = pendingElicitation(request);
    const toolName = `mcp__${request.serverName}__elicitation`;
    const input = { message: request.message, ...(request.url ? { url: request.url } : {}), ...(request.requestedSchema ? { requestedSchema: request.requestedSchema } : {}) };
    const title = request.title ?? `${request.displayName ?? request.serverName}: ${request.message}`;
    return elicitationResult(await ask(session.cardId, session, toolName, input, signal, title, { elicitation }), elicitation);
  };
}
