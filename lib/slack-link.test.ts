import { beforeEach, describe, expect, it, vi } from "vitest";

// The link a Slack message carries to its card on weft.zip: only for a folder that syncs, and only with a
// workspace. The account's Supabase client, the workspace lookup and the synced folders are fakes.

interface FakeAccount {
  userId: string | undefined;
  slug: string | null;
  orgId: string | null;
  folders: string[];
  throwClient: boolean;
  queries: number;
}

const fake = vi.hoisted((): FakeAccount => ({
  userId: "u1",
  slug: "acme",
  orgId: "org-1",
  folders: [],
  throwClient: false,
  queries: 0,
}));

vi.mock("./account", () => ({
  accountClient: () => {
    if (fake.throwClient) throw new Error("Weft accounts aren't set up in this build yet.");
    return {
      auth: { getSession: () => Promise.resolve({ data: { session: fake.userId ? { user: { id: fake.userId } } : null } }) },
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: () => {
              fake.queries += 1;
              return Promise.resolve({ data: fake.slug ? { slug: fake.slug } : null });
            },
          }),
        }),
      }),
    };
  },
}));

vi.mock("./cloud-sync", () => ({ syncOrgId: () => Promise.resolve(fake.orgId) }));
vi.mock("./settings", () => ({ syncFolders: () => fake.folders }));

const link = await import("./slack-link");

beforeEach(() => {
  fake.userId = "u1";
  fake.slug = "acme";
  fake.orgId = "org-1";
  fake.folders = [];
  fake.throwClient = false;
  fake.queries = 0;
  link.resetSlugCache();
});

describe("webCardUrl", () => {
  it("points at the card on weft.zip", () => {
    expect(link.webCardUrl("acme", "card-1")).toBe("https://weft.zip/acme/board?card=card-1");
  });

  it("takes another origin when it is given one", () => {
    expect(link.webCardUrl("acme", "card-1", "http://localhost:3000")).toBe("http://localhost:3000/acme/board?card=card-1");
  });

  it("escapes the workspace and the card id", () => {
    expect(link.webCardUrl("a b/c", "card 1")).toBe("https://weft.zip/a%20b%2Fc/board?card=card%201");
  });
});

describe("cardLink", () => {
  it("has no link for a folder that doesn't sync", async () => {
    fake.folders = ["/dev/other"];
    expect(await link.cardLink("card-1", "/dev/app")).toBeNull();
  });

  it("links the card when its folder syncs", async () => {
    fake.folders = ["/dev/app"];
    expect(await link.cardLink("card-1", "/dev/app")).toBe("https://weft.zip/acme/board?card=card-1");
  });

  it("has no link when nobody is signed in", async () => {
    fake.folders = ["/dev/app"];
    fake.userId = undefined;
    expect(await link.cardLink("card-1", "/dev/app")).toBeNull();
  });

  it("has no link when there is no workspace", async () => {
    fake.folders = ["/dev/app"];
    fake.orgId = null;
    expect(await link.cardLink("card-1", "/dev/app")).toBeNull();
  });

  it("has no link when the workspace has no slug", async () => {
    fake.folders = ["/dev/app"];
    fake.slug = null;
    expect(await link.cardLink("card-1", "/dev/app")).toBeNull();
  });

  it("has no link when accounts aren't set up", async () => {
    fake.folders = ["/dev/app"];
    fake.throwClient = true;
    expect(await link.cardLink("card-1", "/dev/app")).toBeNull();
  });

  it("keeps the slug it found for the same user", async () => {
    fake.folders = ["/dev/app"];
    expect(await link.cardLink("card-1", "/dev/app")).toBe("https://weft.zip/acme/board?card=card-1");
    fake.slug = "renamed";
    expect(await link.cardLink("card-2", "/dev/app")).toBe("https://weft.zip/acme/board?card=card-2");
    expect(fake.queries).toBe(1);
  });

  it("looks the workspace up again for another user", async () => {
    fake.folders = ["/dev/app"];
    await link.cardLink("card-1", "/dev/app");
    fake.userId = "u2";
    fake.slug = "other";
    expect(await link.cardLink("card-2", "/dev/app")).toBe("https://weft.zip/other/board?card=card-2");
    expect(fake.queries).toBe(2);
  });
});
