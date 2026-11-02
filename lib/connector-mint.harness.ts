// A worker ready to mint, for lib/connector-mint.test.ts and lib/connector-card.test.ts: paired, vouched for by a trusted
// Mac, with a signed grant, a signed start for card-1 and the user's GitHub chain, and helpers to ask and to check a
// refusal (and its ledger row).
import { expect } from "vitest";
import type { ConnectorDb, GrantRow, StartRow } from "./connector-db";
import { CFG, deps, fakeDb, fakeGithub, json, NOW, pair, pairedWorker, storeTokens, ticking } from "./connector.harness";
import { signedGrant, signedStart, trustedMac, vouch, type Mac } from "./connector-trust.harness";
import { mint } from "./connector-mint";

export const SCOPED = `POST /applications/${CFG.clientId}/token/scoped`;

export interface Setup {
  grant?: Parameters<typeof signedGrant>[2] | null;
  start?: Partial<StartRow> | null;
  worker?: Parameters<typeof pairedWorker>[1];
  mac?: Parameters<typeof trustedMac>[2];
  vouched?: boolean;
  step?: number;
}

export function setup(o: Setup = {}) {
  const clock = ticking(NOW, o.step);
  const { db, state } = fakeDb(clock);
  const w = pairedWorker(state, o.worker);
  const mac: Mac = trustedMac(state, "u1", o.mac);
  if (o.vouched !== false) vouch(state, mac, w.worker);
  const grant: GrantRow | null = o.grant === null ? null : signedGrant(state, mac, o.grant);
  if (o.start !== null) {
    signedStart(state, mac);
    Object.assign(state.starts[0] as StartRow, o.start);
  }
  storeTokens(state, "u1");
  const gh = fakeGithub({ [SCOPED]: () => json({ token: "ghu_narrow", expires_at: null }), "POST /login/oauth/access_token": () => pair("ghu_new", "ghr_new") });
  let n = 0;
  const body = (b: Partial<{ cardId: string; repo: string; ts: number; nonce: string }> = {}) =>
    w.signed({ connector: "github", cardId: "card-1", repo: "o/r", ts: clock(), nonce: (n++).toString(16).padStart(32, "0"), ...b });
  const ask = (b?: Parameters<typeof body>[0], dbOverride: Partial<ConnectorDb> = {}) => mint(deps({ ...db, ...dbOverride }, gh.fetch, clock), w.auth, body(b));
  return { db, state, gh, ask, body, w, mac, grant, clock };
}

export type MintSetup = ReturnType<typeof setup>;

export const refused = async (p: Promise<{ status: number; body: Record<string, unknown> }>, status: number, words: string) => {
  const a = await p;
  expect(a.status).toBe(status);
  expect(String(a.body.error)).toContain(words);
  return a;
};

// A refusal that reached the ledger, with its outcome and reason.
export const ledger = async (s: MintSetup, status: number, words: string, outcome = "refused") => {
  const a = await refused(s.ask(), status, words);
  expect(s.state.mints.at(-1)).toMatchObject({ outcome, reason: expect.stringContaining(words) as string });
  return a;
};
