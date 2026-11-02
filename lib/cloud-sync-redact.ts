// What leaves the Mac for Supabase: every free-text string in a synced card, thread item or tool output goes through
// the share redactor (lib/share-redact.ts) first, so a key that reached a thread (pasted, printed by a tool, echoed in
// an error) never lands in rows every workspace member can read (pentest 2026-10-20, P-2). The raw text stays local.
import { redactText } from "./share-redact";
import type { CloudCardRow, CloudThreadItemRow, CloudToolOutputRow } from "./cloud-sync-types";

// Identifiers and paths the rows and the web board key on. None of them is free text a key could be pasted into.
const KEEP = new Set(["id", "sessionId", "cwd", "thumb", "tool_id", "toolId", "pendingId"]);

// A worker's live screen as card.page names it (lib/share-types.ts). Its token is 32 hex characters, which the redactor
// takes for a key; but it's the channel's secret meant for whoever reads the row (weft-worker.md#the-live-screen), so
// it goes through as is and only the rest of the page is redacted.
const SCREEN_PAGE = /^(weft-screen:[0-9a-f]{32}\?)([^]*)$/;

function redactPage(page: string): string {
  const screen = SCREEN_PAGE.exec(page);
  return screen ? `${screen[1]}${redactText(screen[2] ?? "")}` : redactText(page);
}

export function redactValue<T>(value: T): T {
  if (typeof value === "string") return redactText(value) as T;
  if (Array.isArray(value)) return value.map(redactValue) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, KEEP.has(k) ? v : k === "page" && typeof v === "string" ? redactPage(v) : redactValue(v)]),
    ) as T;
  }
  return value;
}

export const redactCardRow = (row: CloudCardRow): CloudCardRow => ({ ...row, card: redactValue(row.card) });

export const redactItemRow = (row: CloudThreadItemRow): CloudThreadItemRow => ({ ...row, item: redactValue(row.item) });

export const redactOutputRow = (row: CloudToolOutputRow): CloudToolOutputRow => ({ ...row, result: redactText(row.result) });
