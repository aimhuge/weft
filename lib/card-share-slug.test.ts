// lib/card-share-slug.ts: a shared card's link gets an address under its sharer
// (weft.zip/@<username>/threads/<slug>). The slug comes from the card's title, the sharer's username
// comes from their profile, and the slug is claimed with the first free candidate.
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import { claimThreadSlug, isThreadSlug, sharerUsername, threadSlugFrom } from "./card-share-slug";

const DUP = { message: 'duplicate key value violates unique constraint "cloud_shares_user_slug"' };

// A client whose `.from(table).select(...).eq(...).maybeSingle()` answers with `row` (or null).
function clientWith(table: string, row: unknown) {
  const builder: Record<string, unknown> = {};
  builder.select = vi.fn(() => builder);
  builder.eq = vi.fn(() => builder);
  builder.maybeSingle = vi.fn(() => Promise.resolve({ data: row, error: null }));
  return { from: vi.fn((t: string) => (t === table ? builder : { select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: vi.fn(() => Promise.resolve({ data: null, error: null })) })) })) })) } as unknown as SupabaseClient;
}

describe("threadSlugFrom", () => {
  it("is the card's title as a slug", () => {
    expect(threadSlugFrom("Fix the login bug")).toBe("fix-the-login-bug");
    expect(threadSlugFrom("🐛 Fix the login bug")).toBe("fix-the-login-bug");
    expect(threadSlugFrom("Pricing  page")).toBe("pricing-page");
  });

  it("is 'thread' for a title with nothing usable in it", () => {
    expect(threadSlugFrom("")).toBe("thread");
    expect(threadSlugFrom("!!!")).toBe("thread");
    expect(threadSlugFrom("🐛")).toBe("thread");
  });

  it("keeps 'app' when the title really is about an app", () => {
    // "app" is the fallback appSlugFrom gives a title with nothing usable in it; a title that
    // really is about an app keeps it, and one that isn't becomes "thread".
    expect(threadSlugFrom("app")).toBe("app");
    expect(threadSlugFrom("App")).toBe("app");
    expect(threadSlugFrom("My App")).toBe("my-app");
    expect(threadSlugFrom("App redesign")).toBe("app-redesign");
  });
});

describe("isThreadSlug", () => {
  it("accepts a slug shaped like a link address", () => {
    expect(isThreadSlug("fix-the-login-bug")).toBe(true);
    expect(isThreadSlug("a")).toBe(true);
    expect(isThreadSlug("thread-2")).toBe(true);
  });

  it("refuses anything that isn't one", () => {
    expect(isThreadSlug("-leading")).toBe(false);
    expect(isThreadSlug("trailing-")).toBe(false);
    expect(isThreadSlug("Upper")).toBe(false);
    expect(isThreadSlug("has space")).toBe(false);
    expect(isThreadSlug("")).toBe(false);
    expect(isThreadSlug(42)).toBe(false);
    expect(isThreadSlug(null)).toBe(false);
    expect(isThreadSlug(undefined)).toBe(false);
  });
});

describe("sharerUsername", () => {
  it("is the sharer's username", async () => {
    expect(await sharerUsername(clientWith("profiles", { username: "alice" }), "u1")).toBe("alice");
  });

  it("is null before they've picked one", async () => {
    expect(await sharerUsername(clientWith("profiles", { username: null }), "u1")).toBeNull();
    expect(await sharerUsername(clientWith("profiles", null), "u1")).toBeNull();
  });
});

describe("claimThreadSlug", () => {
  // A client whose cloud_shares update answers with the error the test decides per slug.
  function clientAnswering(answer: (slug: string) => { message: string } | null) {
    const tried: string[] = [];
    const builder: Record<string, unknown> = {};
    builder.update = vi.fn((change: { slug: string }) => {
      tried.push(change.slug);
      return {
        eq: vi.fn(() => Promise.resolve({ error: answer(change.slug) })),
      };
    });
    return { client: { from: vi.fn(() => builder) } as unknown as SupabaseClient, tried };
  }

  it("gives the link the slug the title asks for", async () => {
    const { client, tried } = clientAnswering(() => null);
    expect(await claimThreadSlug(client, "sh1", "Fix the login bug")).toBe("fix-the-login-bug");
    expect(tried).toEqual(["fix-the-login-bug"]);
  });

  it("tries the next candidate past a taken one", async () => {
    const { client, tried } = clientAnswering((slug) => (slug === "fix-the-login-bug" ? DUP : null));
    expect(await claimThreadSlug(client, "sh1", "Fix the login bug")).toBe("fix-the-login-bug-2");
    expect(tried).toEqual(["fix-the-login-bug", "fix-the-login-bug-2"]);
  });

  it("gives up when every candidate is taken", async () => {
    const { client, tried } = clientAnswering(() => DUP);
    expect(await claimThreadSlug(client, "sh1", "Fix the login bug")).toBeNull();
    // The base and the eight numbered candidates.
    expect(tried).toHaveLength(9);
    expect(tried[tried.length - 1]).toBe("fix-the-login-bug-9");
  });

  it("stops at any other error", async () => {
    const { client, tried } = clientAnswering(() => ({ message: "denied" }));
    expect(await claimThreadSlug(client, "sh1", "Fix the login bug")).toBeNull();
    expect(tried).toEqual(["fix-the-login-bug"]);
  });
});
