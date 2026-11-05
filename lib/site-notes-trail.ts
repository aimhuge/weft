// What a card did in its browser pane this turn, kept in memory for the site-notes capture after the turn
// (docs/architecture/site-notes.md#capture). Each step names its page and the element it touched by the snapshot's
// role and label, never by a value: typed text is a length, a secret fill is its selector, and a field's current
// value is cut off the snapshot line. Recording is a few string ops, so the tools stay as fast as before.

export type TrailStep = { tool: string; url?: string; target?: string; detail?: string; ok: boolean; error?: string };
export type Served = { host: string; path: string; source: "local" | "team" | "public"; versionId?: string };
type Trail = { url?: string; snapshot?: string; steps: TrailStep[]; served: Served[] };

const MAX_STEPS = 80;
const trails = new Map<string, Trail>();

function trailOf(cardId: string): Trail {
  let trail = trails.get(cardId);
  if (!trail) {
    trail = { steps: [], served: [] };
    trails.set(cardId, trail);
  }
  return trail;
}

export function noteUrl(cardId: string | undefined, url: string) {
  if (cardId && url) trailOf(cardId).url = url;
}

export function noteSnapshot(cardId: string | undefined, snapshot: string) {
  if (!cardId) return;
  const trail = trailOf(cardId);
  trail.snapshot = snapshot;
  const url = /^URL: (\S+)/m.exec(snapshot)?.[1];
  if (url) trail.url = url;
}

// `textbox "Email" [ref=e14]: "me@x.com"` → `textbox "Email"`: the role and label, without the value.
export function labelFor(snapshot: string | undefined, ref: string): string | undefined {
  if (!snapshot) return undefined;
  const line = snapshot.split("\n").find((l) => l.includes(`[ref=${ref}]`));
  if (!line) return undefined;
  const label = line.slice(0, line.indexOf(`[ref=${ref}]`)).replace(/^[\s-]+/, "").trim();
  return label.length > 100 ? `${label.slice(0, 99)}…` : label || undefined;
}

export type StepArgs = { ref?: string; selector?: string; text?: string; keys?: string; submit?: boolean; values?: string[]; direction?: string };

function detailOf(tool: string, args: StepArgs): string | undefined {
  if (tool === "type_text") return `typed ${args.text?.length ?? 0} characters${args.submit ? " and pressed Enter" : ""}`;
  if (tool === "press_key") return args.keys;
  if (tool === "select_option") return `chose ${args.values?.length ?? 0} option(s)`;
  if (tool === "fill_field") return "filled from the vault";
  if (tool === "scroll") return args.direction;
  return undefined;
}

export function recordStep(cardId: string | undefined, tool: string, args: StepArgs, ok: boolean, error?: string) {
  if (!cardId) return;
  const trail = trailOf(cardId);
  const target = (args.ref && labelFor(trail.snapshot, args.ref)) || args.selector || args.ref;
  const step: TrailStep = { tool, ok, ...(trail.url ? { url: trail.url } : {}), ...(target ? { target } : {}) };
  const detail = detailOf(tool, args);
  if (detail) step.detail = detail;
  if (error) step.error = error.slice(0, 200);
  trail.steps.push(step);
  if (trail.steps.length > MAX_STEPS) trail.steps.splice(0, trail.steps.length - MAX_STEPS);
}

export function recordServed(cardId: string | undefined, served: Served) {
  if (!cardId) return;
  const list = trailOf(cardId).served;
  if (!list.some((s) => s.host === served.host && s.path === served.path && s.source === served.source)) list.push(served);
}

export function wasServed(cardId: string | undefined, host: string, path: string): boolean {
  return !!cardId && !!trails.get(cardId)?.served.some((s) => s.host === host && s.path === path);
}

// The turn's trail, handed to the capture and cleared; the page the card is on carries into the next turn.
export function takeTrail(cardId: string): { steps: TrailStep[]; served: Served[] } {
  const trail = trails.get(cardId);
  if (!trail) return { steps: [], served: [] };
  const taken = { steps: trail.steps, served: trail.served };
  trails.set(cardId, { ...(trail.url ? { url: trail.url } : {}), ...(trail.snapshot ? { snapshot: trail.snapshot } : {}), steps: [], served: [] });
  return taken;
}

export function forgetTrail(cardId: string) {
  trails.delete(cardId);
}
