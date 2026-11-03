// weft.zip's session lines (lib/web-lines.ts): the browser seals the offer to the worker's published key itself and
// inserts the `line` row as the visitor, and the worker opens it as one this Mac's server sealed (lib/worker-seal.ts).
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { LINE_PURPOSE, STUN, type LineOffer } from "@weft/client";
import { open, newSealKeys, type Sealed } from "./worker-seal";
import { FakePc } from "./session-line.harness";
import { webClientHint, webLineOffer, webLines, webSealCrypto } from "./web-lines";

const WORKER = "1b4e28ba-2fa1-11d2-883f-0016d3cca427";
const offer: LineOffer = { sdp: "v=0", key: "k", topic: "worker-line:ab", ice: [{ urls: STUN }] };

type Row = { org_id: string; kind: string; target_device: string; payload: { sealed: Sealed; client?: unknown } };

// The two reads the offer makes, as supabase-js chains them.
function fakeClient(publicKey: string | null, insertError: string | null = null) {
  const rows: Row[] = [];
  const asked: string[] = [];
  const client = {
    from(table: string) {
      if (table === "cloud_workers") {
        return { select: () => ({ eq: (_: string, id: string) => ({ maybeSingle: () => (asked.push(id), Promise.resolve({ data: publicKey === null ? null : { public_key: publicKey } })) }) }) };
      }
      return {
        insert: (row: Row) => ({
          select: () => ({ single: () => (rows.push(row), Promise.resolve(insertError ? { data: null, error: { message: insertError } } : { data: { id: "cmd-9" }, error: null })) }),
        }),
      };
    },
  } as unknown as Pick<SupabaseClient, "from">;
  return { client, rows, asked };
}

afterEach(() => vi.unstubAllGlobals());

describe("webLineOffer", () => {
  it("seals to the worker's key in the browser and inserts the row as the visitor, saying it's weft.zip", async () => {
    const keys = newSealKeys();
    const { client, rows, asked } = fakeClient(keys.publicKey);
    await expect(webLineOffer(client, "org-1")(WORKER, offer)).resolves.toEqual({ commandId: "cmd-9" });
    expect(asked).toEqual([WORKER]);
    const row = rows[0]!;
    expect(row).toMatchObject({ org_id: "org-1", kind: "line", target_device: `worker:${WORKER}`, payload: { client: { app: "web" } } });
    expect(JSON.parse(open(keys, row.payload.sealed, LINE_PURPOSE))).toEqual(offer);
  });

  it("stops at a worker with no key, or a refused insert", async () => {
    await expect(webLineOffer(fakeClient(null).client, "org-1")(WORKER, offer)).rejects.toThrow("hasn't published its key");
    const refused = fakeClient(newSealKeys().publicKey, "new row violates row-level security policy");
    await expect(webLineOffer(refused.client, "org-1")(WORKER, offer)).rejects.toThrow("row-level security");
  });
});

describe("webLines", () => {
  it("makes the desktop's own session line over the browser's RTCPeerConnection, STUN only, sealing here", async () => {
    const keys = newSealKeys();
    const { client, rows } = fakeClient(keys.publicKey);
    const made: { servers: unknown }[] = [];
    vi.stubGlobal(
      "RTCPeerConnection",
      class extends FakePc {
        constructor(config: { iceServers: unknown }) {
          super();
          made.push({ servers: config.iceServers });
        }
      },
    );
    const line = webLines(client, "org-1", { listen: () => () => {} })(WORKER);
    await vi.waitFor(() => expect(rows).toHaveLength(1));
    expect(made).toEqual([{ servers: [{ urls: STUN }] }]);
    const sealed = JSON.parse(open(keys, rows[0]!.payload.sealed, LINE_PURPOSE)) as LineOffer;
    expect(sealed.ice).toEqual([{ urls: STUN }]);
    expect(sealed.topic).toMatch(/^worker-line:[0-9a-f]{32}$/);
    expect(line.route()).toEqual({ kind: "connecting" });
    line.close();
  });
});

describe("the browser's own pieces", () => {
  it("says it's the web, and seals with libsodium and Web Crypto", async () => {
    expect(webClientHint().app).toBe("web");
    const c = await webSealCrypto();
    expect(typeof c.sodium.crypto_scalarmult).toBe("function");
    expect(c.subtle).toBe(globalThis.crypto.subtle);
  });

  it("leaves the time zone out when the browser has none", async () => {
    vi.resetModules();
    vi.doMock("@weft/client", async (real) => ({ ...(await real<typeof import("@weft/client")>()), ownTimeZone: () => undefined }));
    const { webClientHint: hint } = await import("./web-lines");
    expect(hint()).toEqual({ app: "web" });
    vi.doUnmock("@weft/client");
  });
});
