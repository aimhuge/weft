import { describe, expect, it } from "vitest";
import { UploadError, WafError, check, isRowError, isWafBlock, wafMessage, wafSafeJson } from "./cloud-sync-send";

const PAGE = '<!DOCTYPE html><html><head><title>Attention Required! | Cloudflare</title></head><body>Cloudflare Ray ID: <strong>a4f0d5779d1bd32a</strong></body></html>';

describe("wafSafeJson", () => {
  it("parses back to the same value with only letters and digits left bare in its strings", () => {
    const value = { "a-b": ["<script>", "x'; DROP TABLE t; --", 1.5, true, null, { nested: "rm -rf / && echo \u{1F600}" }], skip: undefined, list: [undefined] };
    const json = wafSafeJson(value);
    expect(JSON.parse(json)).toEqual(JSON.parse(JSON.stringify(value)));
    for (const s of json.match(/"(?:[^"\\]|\\.)*"/g)!) expect(s.slice(1, -1)).toMatch(/^(?:[A-Za-z0-9]|\\u[0-9a-f]{4})*$/);
  });
});

describe("isWafBlock and wafMessage", () => {
  it("tells Cloudflare's block page from other errors and names it in one line with its Ray ID", () => {
    expect(isWafBlock({ error: { message: PAGE } })).toBe(true);
    expect(isWafBlock({ error: { message: "<html><title>502 Bad Gateway</title> cloudflare</html>" } })).toBe(false);
    expect(isWafBlock({ error: { message: "Attention Required" } })).toBe(false);
    expect(isWafBlock({ error: null })).toBe(false);
    expect(wafMessage(PAGE, "t")).toBe("Cloudflare's firewall blocked an upload to t (Ray ID a4f0d5779d1bd32a)");
    expect(wafMessage("<html>blocked</html>", "t")).toBe("Cloudflare's firewall blocked an upload to t");
  });
});

describe("check", () => {
  it("throws Postgres errors with their code and names an HTML page by its title instead of dumping it", () => {
    expect(() => check({ error: null })).not.toThrow();
    expect(() => check({ error: { message: "bad", code: "22P05" } })).toThrow(expect.objectContaining({ message: "bad", code: "22P05" }));
    expect(() => check({ error: { message: "<html><title> 502 Bad Gateway </title></html>" } })).toThrow("The server answered with an HTML page: 502 Bad Gateway");
    expect(() => check({ error: { message: "<html>no title</html>" } })).toThrow(/^The server answered with an HTML page$/);
  });
});

describe("isRowError", () => {
  it("counts data exceptions and WAF blocks, not other failures", () => {
    expect(isRowError(new UploadError("x", "22P05"))).toBe(true);
    expect(isRowError(new WafError("x"))).toBe(true);
    expect(isRowError(new UploadError("x", "42501"))).toBe(false);
    expect(isRowError(new Error("x"))).toBe(false);
  });
});

describe("upsert", () => {
  // A client whose builders answer in turn from `answers`, through their own `fetch` like postgrest-js.
  const client = (answers: { error: { message: string; code?: string } | null }[]) =>
    ({
      from: () => ({
        upsert: () => {
          const builder = {
            fetch: (_url: string, init: { body: string }) => Promise.resolve(init.body),
            then: (ok: (v: unknown) => unknown) => builder.fetch("/", { body: "[]" }).then(() => ok(answers.shift())),
          };
          return builder;
        },
      }),
    }) as never;

  it("throws the escaped retry's own error when it fails for another reason", async () => {
    const { upsert } = await import("./cloud-sync-send");
    await expect(upsert(client([{ error: { message: PAGE } }, { error: { message: "fetch failed" } }]), "t", [{}])).rejects.toThrow("fetch failed");
    await expect(upsert(client([{ error: null }]), "t", [{}])).resolves.toBeUndefined();
    expect(wafSafeJson(undefined)).toBe("null");
  });
});
