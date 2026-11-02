// The "/" list as it travels in a host command's `result` (docs/architecture/project-hosts.md, H3b). The column is
// capped at 4 KB of stored jsonb (cloud_commands_result_small checks pg_column_size), so the list goes as
// [name, description, source] triples, the descriptions shortened until the whole fits, and, if the names alone are
// still too many, the list cut short with `more` saying how many were left out. The size is jsonb's, estimated from
// above (jsonbBytes), not JSON text's, which is about 12 bytes a triple smaller. readSkills is the board's side: only
// well-formed rows come back as SkillInfo; skillCache keeps a card's list for a few minutes on either board.
import type { SkillInfo } from "./types";

type Wire = [string, string, SkillInfo["source"]];
export interface SkillsOnWire {
  skills: Wire[];
  more?: number;
}

// Stored jsonb bytes for the skills part. The rest of `result` ({ ok, cardId }) is under 150 bytes, and the column's
// cap is 4,096, so this leaves over 300 bytes beyond the estimate's own slack.
export const SKILLS_BUDGET = 3_600;
const SOURCES = new Set<SkillInfo["source"]>(["weft", "user", "project"]);
// The description lengths tried in turn: what a typeahead row shows, then shorter, then none.
const CUTS = [120, 60, 30, 0];

const utf8 = (text: string) => new TextEncoder().encode(text).length;

// An upper bound on Postgres's binary jsonb size (src/backend/utils/adt/jsonb_util.c): a 4-byte varlena header, then
// per container a 4-byte header, a 4-byte JEntry per element (8 per key and value in an object) and up to 3 bytes of
// alignment padding before each nested container or number; a string is its UTF-8 bytes, a number at most 12.
export function jsonbBytes(value: unknown, root = true): number {
  const head = root ? 4 : 0;
  if (typeof value === "string") return head + utf8(value);
  if (typeof value === "number") return head + 12;
  if (value === null || typeof value === "boolean" || value === undefined) return head;
  const pad = (v: unknown) => (v !== null && typeof v === "object" ? 3 : 0);
  if (Array.isArray(value)) return head + 4 + value.reduce((n: number, v: unknown) => n + 4 + pad(v) + jsonbBytes(v, false), 0);
  const entries = Object.entries(value).filter(([, v]) => v !== undefined);
  return head + 4 + entries.reduce((n, [k, v]) => n + 8 + utf8(k) + pad(v) + jsonbBytes(v, false), 0);
}

const cut = (text: string, at: number) => (text.length <= at ? text : at ? `${text.slice(0, at - 1).trimEnd()}…` : "");

export function fitSkills(skills: SkillInfo[], budget = SKILLS_BUDGET): SkillsOnWire {
  for (const at of CUTS) {
    const wire: SkillsOnWire = { skills: skills.map((s): Wire => [s.name, cut(s.description, at), s.source]) };
    if (jsonbBytes(wire) <= budget) return wire;
  }
  const kept: Wire[] = [];
  for (const s of skills) {
    if (jsonbBytes({ skills: [...kept, [s.name, "", s.source]], more: skills.length }) > budget) break;
    kept.push([s.name, "", s.source]);
  }
  return { skills: kept, more: skills.length - kept.length };
}

const isWire = (row: unknown): row is Wire =>
  Array.isArray(row) && typeof row[0] === "string" && Boolean(row[0]) && typeof row[1] === "string" && SOURCES.has(row[2] as SkillInfo["source"]);

export function readSkills(result: unknown): SkillInfo[] {
  const rows = result && typeof result === "object" ? (result as { skills?: unknown }).skills : undefined;
  if (!Array.isArray(rows)) return [];
  return rows.filter(isWire).map(([name, description, source]) => ({ name, description, source }));
}

// A card's list is a round trip through a command, so it's kept for a few minutes per card and one on its way is
// shared; one that fails is asked again next time. `ask` answers with a command's result.
export const SKILLS_FRESH_MS = 5 * 60_000;

export interface SkillCache {
  get(cardId: string | undefined, now?: number): Promise<SkillInfo[]>;
  forget(): void;
}

export function skillCache(ask: (cardId: string) => Promise<unknown>): SkillCache {
  const lists = new Map<string, { at: number; list: Promise<SkillInfo[]> }>();
  return {
    get(cardId, now = Date.now()) {
      if (!cardId) return Promise.resolve([]);
      const known = lists.get(cardId);
      if (known && now - known.at < SKILLS_FRESH_MS) return known.list;
      const list = ask(cardId).then(readSkills);
      lists.set(cardId, { at: now, list });
      list.catch(() => lists.delete(cardId));
      return list;
    },
    forget: () => lists.clear(),
  };
}
