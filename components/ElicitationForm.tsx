"use client";

import { useState } from "react";
import type { ElicitField, PendingElicitation } from "@/lib/types";
import { BUTTON_PRIMARY_SMALL as PRIMARY, BUTTON_SECONDARY_SMALL as SECONDARY } from "./button-styles";

// An MCP server asking you something mid-call (lib/elicitation.ts): its message, the URL it sends you to,
// and a field per property of the form it asked for. Accept sends the values back to the server (as
// strings; the server side types them and refuses a required field left empty), Decline tells it no.

const INPUT = "w-full rounded border border-line-strong bg-panel px-2 py-1 text-[12.5px] text-ink";

// Each field's starting value: its schema default, "false" for an unticked box, an empty list for a multi-select.
export function initialAnswers(fields: ElicitField[]): Record<string, string> {
  return Object.fromEntries(fields.map((f) => [f.name, f.default ?? (f.kind === "boolean" ? "false" : f.kind === "multi" ? "[]" : "")]));
}

function Field({ field, value, onChange }: { field: ElicitField; value: string; onChange: (v: string) => void }) {
  const id = `elicit-${field.name}`;
  const label = (
    <label htmlFor={id} className="text-[12px] font-medium text-ink">
      {field.title}
      {field.required && <span className="text-danger"> *</span>}
    </label>
  );
  const hint = field.description && <span className="text-[11.5px] text-muted">{field.description}</span>;
  if (field.kind === "boolean")
    return (
      <div className="flex items-center gap-2">
        <input id={id} type="checkbox" checked={value === "true"} onChange={(e) => onChange(String(e.target.checked))} />
        {label}
        {hint}
      </div>
    );
  if (field.kind === "multi") {
    const picked = new Set<string>(JSON.parse(value || "[]") as string[]);
    const toggle = (v: string) => {
      if (picked.has(v)) picked.delete(v);
      else picked.add(v);
      onChange(JSON.stringify([...picked]));
    };
    return (
      <fieldset className="flex flex-col gap-1">
        <legend className="text-[12px] font-medium text-ink">{field.title}</legend>
        {hint}
        {field.options?.map((o) => (
          <label key={o.value} className="flex items-center gap-2 text-[12.5px] text-ink">
            <input type="checkbox" checked={picked.has(o.value)} onChange={() => toggle(o.value)} />
            {o.label}
          </label>
        ))}
      </fieldset>
    );
  }
  return (
    <div className="flex flex-col gap-0.5">
      {label}
      {hint}
      {field.kind === "enum" ? (
        <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className={INPUT}>
          {!field.required && <option value="">—</option>}
          {field.required && !value && <option value="">Pick one…</option>}
          {field.options?.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ) : (
        <input id={id} type={field.kind === "string" ? "text" : "number"} step={field.kind === "integer" ? 1 : "any"} value={value} onChange={(e) => onChange(e.target.value)} className={INPUT} />
      )}
    </div>
  );
}

export default function ElicitationForm({
  elicitation,
  answered,
  readOnly,
  onAnswer,
}: {
  elicitation: PendingElicitation;
  answered: boolean;
  readOnly: boolean;
  onAnswer: (allow: boolean, answers?: Record<string, string>) => void;
}) {
  const [answers, setAnswers] = useState(() => initialAnswers(elicitation.fields));
  const { fields, url } = elicitation;
  return (
    <div className="mt-1.5 flex flex-col gap-2">
      <p className="whitespace-pre-wrap text-[12.5px] text-muted">
        <span className="font-mono text-[11.5px] text-faint">{elicitation.server}</span> {elicitation.message}
      </p>
      {url && (
        <a href={url} target="_blank" rel="noreferrer" className="truncate text-[12.5px] font-medium text-accent hover:underline">
          {url}
        </a>
      )}
      {fields.map((f) => (
        <Field key={f.name} field={f} value={answers[f.name] ?? ""} onChange={(v) => setAnswers((a) => ({ ...a, [f.name]: v }))} />
      ))}
      {!readOnly && (
        <div className="flex gap-2">
          <button onClick={() => onAnswer(true, fields.length ? answers : undefined)} disabled={answered} className={PRIMARY}>
            {fields.length ? "Submit" : "Accept"}
          </button>
          <button onClick={() => onAnswer(false)} disabled={answered} className={SECONDARY}>
            Decline
          </button>
        </div>
      )}
    </div>
  );
}
