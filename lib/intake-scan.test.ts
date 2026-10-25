import { describe, expect, it } from "vitest";
import { envReads, findHook, isTemplate, routePath, templateNames, wantsBlank } from "./intake-scan";

describe("envReads", () => {
  it("finds a dotted process.env read", () => {
    expect([...envReads("const key = process.env.STRIPE_SECRET_KEY")]).toEqual(["STRIPE_SECRET_KEY"]);
  });

  it("finds a bracketed process.env read", () => {
    expect([...envReads("const key = process.env['STRIPE_SECRET_KEY']")]).toEqual(["STRIPE_SECRET_KEY"]);
    expect([...envReads('const key = process.env["STRIPE_SECRET_KEY"]')]).toEqual(["STRIPE_SECRET_KEY"]);
    expect([...envReads("const key = process.env[`STRIPE_SECRET_KEY`]")]).toEqual(["STRIPE_SECRET_KEY"]);
  });

  it("finds an import.meta.env read", () => {
    expect([...envReads("const url = import.meta.env.PUBLIC_URL")]).toEqual(["PUBLIC_URL"]);
  });

  it("finds os.environ reads", () => {
    expect([...envReads('os.environ.get("HOME_DIR")')]).toEqual(["HOME_DIR"]);
    expect([...envReads('os.environ["HOME_DIR"]')]).toEqual(["HOME_DIR"]);
  });

  it("finds an os.getenv read", () => {
    expect([...envReads('os.getenv("HOME_DIR")')]).toEqual(["HOME_DIR"]);
  });

  it("finds a Deno.env.get read", () => {
    expect([...envReads('Deno.env.get("HOME_DIR")')]).toEqual(["HOME_DIR"]);
  });

  it("drops a name the code sets itself", () => {
    expect([...envReads("process.env.LOCAL_FLAG = 'yes'")]).toEqual([]);
  });

  it("keeps a name that is only compared", () => {
    expect([...envReads("if (process.env.LOCAL_FLAG === 'yes') {}")]).toEqual(["LOCAL_FLAG"]);
  });
});

describe("wantsBlank", () => {
  it.each(["NODE_ENV", "VERCEL_URL", "GITHUB_SHA", "npm_config_registry"])("rejects the runtime name %s", (name) => {
    expect(wantsBlank(name, false)).toBe(false);
  });

  it.each(["API_KEY", "CLIENT_SECRET", "AUTH_TOKEN", "DATABASE_URL"])("accepts the secret-shaped name %s", (name) => {
    expect(wantsBlank(name, false)).toBe(true);
  });

  it("accepts a known provider's URL or id, not its other settings", () => {
    expect(wantsBlank("NEXT_PUBLIC_SUPABASE_URL", true)).toBe(true);
    expect(wantsBlank("GOOGLE_CLIENT_ID", true)).toBe(true);
    expect(wantsBlank("CLAUDE_CONFIG_DIR", true)).toBe(false);
    expect(wantsBlank("SLACK_DEV", true)).toBe(false);
    expect(wantsBlank("APP_URL", false)).toBe(false);
  });

  it("rejects a plain feature flag", () => {
    expect(wantsBlank("FEATURE_FLAG", false)).toBe(false);
  });
});

describe("templateNames", () => {
  it("reads names with and without an export prefix", () => {
    expect(templateNames("export STRIPE_SECRET_KEY=sk_test\nDATABASE_URL=postgres://localhost")).toEqual(["STRIPE_SECRET_KEY", "DATABASE_URL"]);
  });

  it("ignores comments and blank lines", () => {
    expect(templateNames("# a comment\n\n  \nAPI_KEY=abc")).toEqual(["API_KEY"]);
  });
});

describe("isTemplate", () => {
  it("accepts templates at the root and in apps and packages", () => {
    expect(isTemplate(".env.example")).toBe(true);
    expect(isTemplate(".env.sample")).toBe(true);
    expect(isTemplate(".env.template")).toBe(true);
    expect(isTemplate(".env.dist")).toBe(true);
    expect(isTemplate(".env.defaults")).toBe(true);
    expect(isTemplate("apps/web/.env.example")).toBe(true);
    expect(isTemplate("packages/core/.env.sample")).toBe(true);
  });

  it("rejects a nested template, another extension and a local file", () => {
    expect(isTemplate("apps/web/nested/.env.example")).toBe(false);
    expect(isTemplate("other/.env.example")).toBe(false);
    expect(isTemplate(".env.local")).toBe(false);
  });
});

describe("routePath", () => {
  it("reads an app-router route", () => {
    expect(routePath("app/api/hello/route.ts")).toBe("/api/hello");
    expect(routePath("src/app/api/hello/route.ts")).toBe("/api/hello");
  });

  it("drops route groups and slots", () => {
    expect(routePath("app/(marketing)/about/route.ts")).toBe("/about");
    expect(routePath("app/@modal/(group)/settings/route.ts")).toBe("/settings");
  });

  it("returns null for a dynamic segment", () => {
    expect(routePath("app/items/[id]/route.ts")).toBeNull();
  });

  it("reads a pages-router API route", () => {
    expect(routePath("pages/api/hello.ts")).toBe("/api/hello");
    expect(routePath("pages/api/hello/index.ts")).toBe("/api/hello");
  });

  it("returns null for a file that is not a route", () => {
    expect(routePath("lib/hello.ts")).toBeNull();
  });
});

describe("findHook", () => {
  it("finds a Stripe hook with events, a secret and a hint", () => {
    const hook = findHook(
      "app/api/stripe/route.ts",
      [
        "const event = stripe.webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET);",
        'case "checkout.session.completed":',
        'if (type === "invoice.paid") {}',
      ].join("\n"),
    );
    expect(hook).toEqual({
      name: "stripe",
      provider: "stripe",
      target: "/api/stripe",
      secret: "STRIPE_WEBHOOK_SECRET",
      events: ["checkout.session.completed", "invoice.paid"],
      hint: "Stripe dashboard → Developers → Webhooks: https://dashboard.stripe.com/webhooks",
    });
  });

  it("finds a GitHub hook", () => {
    const hook = findHook("app/api/github/route.ts", 'if (req.headers["x-hub-signature"]) {}');
    expect(hook?.name).toBe("github");
    expect(hook?.provider).toBe("github");
    expect(hook?.hint).toContain("GitHub");
  });

  it("finds a Vercel hook", () => {
    const hook = findHook("app/api/vercel/route.ts", 'const sig = req.headers.get("x-vercel-signature");');
    expect(hook?.name).toBe("vercel");
    expect(hook?.provider).toBe("vercel");
  });

  it("names a Svix hook after Resend or Clerk", () => {
    expect(findHook("app/api/resend/route.ts", "const wh = new Svix({ secret });")?.name).toBe("resend");
    expect(findHook("app/api/clerk/route.ts", "const wh = new Svix({ secret });")?.name).toBe("clerk");
    expect(findHook("app/api/other/route.ts", "const wh = new Svix({ secret });")?.name).toBe("svix");
  });

  it("names an unsigned webhook route from the segment before webhook", () => {
    const hook = findHook("app/api/billing/webhook/route.ts", "export async function POST() {}");
    expect(hook?.name).toBe("billing");
    expect(hook?.provider).toBeUndefined();
  });

  it("names an unsigned webhook route from the segment after a generic one", () => {
    expect(findHook("app/api/webhooks/shopify/route.ts", "export async function POST() {}")?.name).toBe("shopify");
  });

  it("skips an unsigned route with only generic segments, like Weft's own /api/webhooks registry", () => {
    expect(findHook("app/api/webhooks/route.ts", "export async function POST() {}")).toBeNull();
    expect(findHook("app/api/webhook/route.ts", "export async function POST() {}")).toBeNull();
  });

  it("names a signed route with only generic segments by its signer", () => {
    expect(findHook("app/api/webhook/route.ts", "stripe.webhooks.constructEvent(body, sig, s)")?.name).toBe("stripe");
  });

  it("returns null for a non-webhook route", () => {
    expect(findHook("app/api/hello/route.ts", "export async function POST() {}")).toBeNull();
  });

  it("returns null for a dynamic route", () => {
    expect(findHook("app/api/[provider]/route.ts", "stripe.webhooks.constructEvent()")).toBeNull();
  });
});
