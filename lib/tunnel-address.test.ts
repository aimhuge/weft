import { describe, expect, it } from "vitest";
import { handleAddress, type TunnelRow } from "./tunnel-address";
import { verifyEnter } from "./tunnel-ticket";

const ID = "11111111-1111-4111-8111-111111111111";
const NOW = Date.parse("2026-10-30T10:00:00Z");
const row: TunnelRow = { id: ID, user_id: "me", public_url: "https://a.trycloudflare.com", ticket_secret: "s", expires_at: "2026-10-30T11:00:00Z" };
const req = (path = `/t/${ID}`) => new Request(`https://weft.zip${path}`);
const deps = (over: Partial<Parameters<typeof handleAddress>[3]> = {}) => ({ tunnel: () => Promise.resolve(row), userId: () => Promise.resolve("me"), now: () => NOW, ...over });

describe("a tunnel's stable address", () => {
  it("sends its owner to the current URL with a ticket the gate accepts", async () => {
    const res = await handleAddress(req(), ID, "/page?x=1", deps());
    expect(res.status).toBe(302);
    const to = new URL(res.headers.get("location")!);
    expect(to.origin).toBe("https://a.trycloudflare.com");
    expect(to.pathname).toBe("/__weft/enter");
    expect(to.searchParams.get("next")).toBe("/page?x=1");
    expect(verifyEnter(to.searchParams.get("ticket")!, "s", ID, NOW)).toBe(true);
  });

  it("sends a signed-out visitor to sign in first, and reads nothing", async () => {
    let read = false;
    const res = await handleAddress(req(`/t/${ID}/a`), ID, "/a", deps({ userId: () => Promise.resolve(null), tunnel: () => ((read = true), Promise.resolve(row)) }));
    expect(res.headers.get("location")).toBe(`/login?next=${encodeURIComponent(`/t/${ID}/a`)}`);
    expect(read).toBe(false);
  });

  it("gives someone else the same 404 as an id that doesn't exist", async () => {
    const other = await handleAddress(req(), ID, "", deps({ userId: () => Promise.resolve("them") }));
    const none = await handleAddress(req(), ID, "", deps({ tunnel: () => Promise.resolve(null) }));
    expect([other.status, await other.text()]).toEqual([404, "Not found"]);
    expect([none.status, await none.text()]).toEqual([404, "Not found"]);
  });

  it("refuses an id that isn't a uuid", async () => {
    expect((await handleAddress(req(), "nope", "", deps())).status).toBe(404);
  });

  it("says closed once it has expired or been closed, and hands out no ticket", async () => {
    for (const closed of [{ ...row, expires_at: "2026-10-30T09:00:00Z" }, { ...row, public_url: null, ticket_secret: null, expires_at: null }]) {
      const res = await handleAddress(req(), ID, "", deps({ tunnel: () => Promise.resolve(closed) }));
      expect(res.status).toBe(503);
      expect(res.headers.get("location")).toBeNull();
    }
  });
});
