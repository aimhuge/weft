import { describe, expect, it } from "vitest";
import { notesBlock, parseNote, serializeNote, today, UNTRUSTED_FRAME } from "./site-notes-format";

const NOTE = {
  host: "supabase.com",
  path: "/dashboard/project/:ref/settings/api",
  body: "The API keys live under Settings, in the top left of the page.",
  updated: "2026-10-26",
};

describe("today", () => {
  it("formats a date as YYYY-MM-DD", () => {
    expect(today(new Date("2026-10-26T13:45:00Z"))).toBe("2026-10-26");
  });

  it("defaults to now", () => {
    expect(today()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("serializeNote", () => {
  it("writes front matter and a trimmed body", () => {
    expect(serializeNote({ ...NOTE, body: "  body text  " })).toBe(
      ["---", "host: supabase.com", "path: /dashboard/project/:ref/settings/api", "updated: 2026-10-26", "---", "", "body text", ""].join(
        "\n",
      ),
    );
  });

  it("writes lastSuccess when there is one", () => {
    const text = serializeNote({ ...NOTE, lastSuccess: "2026-10-20" });
    expect(text).toContain("lastSuccess: 2026-10-20");
  });

  it("writes stale when the note is stale", () => {
    const text = serializeNote({ ...NOTE, stale: true });
    expect(text).toContain("stale: true");
  });

  it("omits lastSuccess and stale when they are not there", () => {
    const text = serializeNote(NOTE);
    expect(text).not.toContain("lastSuccess");
    expect(text).not.toContain("stale");
  });
});

describe("parseNote", () => {
  it("reads a note back", () => {
    const note = parseNote(serializeNote(NOTE));
    expect(note).toEqual({ ...NOTE, source: "local" });
  });

  it("reads lastSuccess and stale", () => {
    const note = parseNote(serializeNote({ ...NOTE, lastSuccess: "2026-10-20", stale: true }));
    expect(note?.lastSuccess).toBe("2026-10-20");
    expect(note?.stale).toBe(true);
  });

  it("takes the source it is given", () => {
    expect(parseNote(serializeNote(NOTE), "team")?.source).toBe("team");
    expect(parseNote(serializeNote(NOTE), "public")?.source).toBe("public");
  });

  it("reads windows line endings", () => {
    const text = serializeNote(NOTE).replace(/\n/g, "\r\n");
    expect(parseNote(text)?.host).toBe("supabase.com");
  });

  it("returns null without front matter", () => {
    expect(parseNote("just a body")).toBeNull();
    expect(parseNote("")).toBeNull();
  });

  it("returns null without a host", () => {
    expect(parseNote("---\npath: /a\n---\nbody")).toBeNull();
  });

  it("returns null without a path", () => {
    expect(parseNote("---\nhost: example.com\n---\nbody")).toBeNull();
  });

  it("ignores keys it does not know", () => {
    const note = parseNote("---\nhost: example.com\npath: /a\ncolour: blue\n---\nbody");
    expect(note?.host).toBe("example.com");
    expect(Object.keys(note ?? {})).not.toContain("colour");
  });

  it("ignores malformed front matter lines", () => {
    const note = parseNote("---\nhost: example.com\nnot a key value line\npath: /a\n---\nbody");
    expect(note?.path).toBe("/a");
  });

  it("defaults updated to an empty string", () => {
    expect(parseNote("---\nhost: example.com\npath: /a\n---\nbody")?.updated).toBe("");
  });

  it("does not set stale unless the value is true", () => {
    expect(parseNote("---\nhost: example.com\npath: /a\nstale: yes\n---\nbody")?.stale).toBeUndefined();
  });

  it("trims the body", () => {
    expect(parseNote("---\nhost: example.com\npath: /a\n---\n\n  body  \n")?.body).toBe("body");
  });
});

describe("notesBlock", () => {
  const note = {
    host: "supabase.com",
    path: "/dashboard/project/:ref/settings/api",
    body: "The API keys live under Settings.",
    updated: "2026-10-26",
    source: "local" as const,
  };

  it("is empty when there is nothing to show", () => {
    expect(notesBlock("supabase.com", [], [])).toBe("");
  });

  it("frames the notes as untrusted reference data", () => {
    const block = notesBlock("supabase.com", [note], []);
    expect(block).toContain("Site notes for supabase.com.");
    expect(block).toContain(UNTRUSTED_FRAME);
    expect(block).toContain('<site-note host="supabase.com"');
  });

  it("shows the note's source, confirmations and flags", () => {
    const block = notesBlock(
      "supabase.com",
      [{ ...note, source: "public", confirmations: 3, candidate: true, lastSuccess: "2026-10-20", stale: true }],
      [],
    );
    expect(block).toContain('source="public"');
    expect(block).toContain('confirmed-by="3"');
    expect(block).toContain('unconfirmed="true"');
    expect(block).toContain('last-success="2026-10-20"');
    expect(block).toContain('stale="true"');
  });

  it("leaves out the optional attributes when they are not there", () => {
    const block = notesBlock("supabase.com", [note], []);
    expect(block).not.toContain("confirmed-by");
    expect(block).not.toContain('unconfirmed="true"');
    expect(block).not.toContain("last-success");
    expect(block).not.toContain('stale="true"');
  });

  it("closes its own tag but never opens or closes a note tag from the body", () => {
    const block = notesBlock("supabase.com", [{ ...note, body: "A <site-note> and a </site-note> inside." }], []);
    expect(block).toContain("‹site-note>");
    expect(block).toContain("‹/site-note>");
    expect(block.endsWith("</site-note>")).toBe(true);
  });

  it("strips quotes and angle brackets from the attributes", () => {
    const block = notesBlock("supabase.com", [{ ...note, host: 'a"b<c>&d', path: "/x" }], []);
    expect(block).toContain('host="abcd"');
  });

  it("indexes the other pages, without repeats and at most twelve", () => {
    const others = Array.from({ length: 20 }, (_, i) => ({ ...note, path: `/p${i}` }));
    others.push({ ...note, path: "/p0" });
    const block = notesBlock("supabase.com", [], others);
    expect(block).toContain("Other pages on supabase.com with notes:");
    expect(block).toContain("/p0");
    expect(block).toContain("/p11");
    expect(block).not.toContain("/p12");
    // The duplicate path is listed once.
    expect(block.match(/\/p0\b/g)).toHaveLength(1);
  });

  it("strips quotes from the indexed paths", () => {
    const block = notesBlock("supabase.com", [], [{ ...note, path: '/a"b' }]);
    expect(block).toContain("/ab");
  });
});
