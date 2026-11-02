import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { iso, NOW } from "./connector.harness";
import { signedStart, signedStartPayload, trustedMac } from "./connector-trust.harness";
import { ledger, refused, setup } from "./connector-mint.harness";

describe("the card a mint is for (lib/connector-card.ts)", () => {
  it("refuses a card with no owner-created start, or one another worker sent, or a run", async () => {
    await ledger(setup({ start: null }), 403, "a card you started");
    const other = setup();
    await refused(other.ask({}, { starts: () => Promise.resolve([{ kind: "host", folder: "r", payload: signedStartPayload(other.mac), created_by: "u2" }]) }), 403, "a card you started");
    const sent = setup();
    sent.state.starts[0]!.payload = { ...signedStartPayload(sent.mac), fromWorker: "w2" };
    await ledger(sent, 403, "a card you started");
    await ledger(setup({ start: { kind: "run", payload: { repo: "https://github.com/o/r.git" } } }), 403, "a card you started");
  });

  it("refuses a host command that isn't card.create", async () => {
    await ledger(setup({ start: { payload: { verb: "card.reply", repo: "o/r" } } }), 403, "a card you started");
    await ledger(setup({ start: { payload: null } }), 403, "a card you started");
  });

  it("refuses a start that named no repo", async () => {
    await ledger(setup({ start: { payload: { verb: "card.create" } } }), 403, "didn't name its GitHub repo");
  });

  it("refuses a start no trusted Mac signed: a session alone can queue one but not sign it", async () => {
    const unsigned = setup();
    unsigned.state.starts[0]!.payload = { verb: "card.create", repo: "o/r" };
    await ledger(unsigned, 403, "wasn't signed by a Mac");
    const otherRepo = setup();
    otherRepo.state.starts[0]!.payload = { ...(otherRepo.state.starts[0]!.payload as object), repo: "victim/any" };
    await refused(otherRepo.ask({ repo: "victim/any" }), 403, "start signature doesn't check");
    const otherCard = setup();
    otherCard.state.starts[0]!.payload = signedStartPayload(otherCard.mac, { cardId: "card-2" });
    const swapped = setup();
    swapped.state.starts[0]!.payload = { ...(swapped.state.starts[0]!.payload as { start: object }), start: { ...(swapped.state.starts[0]!.payload as { start: object }).start, nonce: "other" } };
    await ledger(swapped, 403, "start signature doesn't check");
    await ledger(otherCard, 403, "start signature doesn't check");
    const pending = setup();
    pending.state.starts[0]!.payload = signedStartPayload(trustedMac(pending.state, "u1", { trustedFrom: null }));
    await ledger(pending, 403, "isn't trusted now");
  });

  it("refuses a start sent at another time than it was signed: a replayed row", async () => {
    const late = setup();
    late.state.starts[0]!.created_at = iso(NOW + 10 * 60_000);
    await ledger(late, 403, "signed at another time");
    const none = setup();
    delete none.state.starts[0]!.created_at;
    await ledger(none, 403, "signed at another time");
  });

  it("pins a card to its start once: a start's signature can't pin another card", async () => {
    const s = setup();
    s.state.pinned.set("w9/card-1", { user_id: "u1", folder: "r", repo: "o/r", signer_id: s.mac.signer.id, start_sig: "" });
    expect((await s.ask()).status).toBe(200);
    const replay = setup();
    const sig = (replay.state.starts[0]!.payload as { start: { sig: string } }).start.sig;
    replay.state.pinned.set("w9/card-9", { user_id: "u1", folder: "r", repo: "o/r", signer_id: replay.mac.signer.id, start_sig: createHash("sha256").update(sig).digest("hex") });
    await ledger(replay, 403, "used for another card already");
  });

  it("takes a pin another mint made beside this one for the same start", async () => {
    const s = setup();
    const raced = { pinCard: async (...a: Parameters<typeof s.db.pinCard>) => (await s.db.pinCard(...a), false) };
    expect((await s.ask({}, raced)).status).toBe(200);
  });

  it("re-checks a pinned card's signer at every mint, and refuses a pin with none", async () => {
    const s = setup({ start: null });
    const laptop = trustedMac(s.state);
    signedStart(s.state, laptop);
    expect((await s.ask()).status).toBe(200);
    laptop.signer.revoked_at = iso(NOW);
    await refused(s.ask(), 403, "started from a Mac that isn't trusted now");
    const bare = setup();
    bare.state.pinned.set("w1/card-1", { user_id: "u1", folder: "r", repo: "o/r", signer_id: null, start_sig: null });
    await refused(bare.ask(), 403, "isn't trusted now");
  });

  it("refuses a repo the grant doesn't cover, whatever the checkout says", async () => {
    const s = setup({ grant: { repos: ["o/other"] } });
    await ledger(s, 403, "doesn't cover o/r");
  });

  it("closes a Done card's pin for good", async () => {
    const s = setup();
    expect((await s.ask()).status).toBe(200);
    s.state.cards.set("org1/card-1", { deleted: false, column: "done", owner_worker: "w1" });
    await refused(s.ask(), 403, "Done or deleted");
    expect(s.state.pinned.get("w1/card-1")?.closed_at).toBeTruthy();
    s.state.cards.set("org1/card-1", { deleted: false, column: "running", owner_worker: "w1" });
    await refused(s.ask(), 403, "Done or deleted");
  });

  it("refuses a card with more than one start", async () => {
    const two = setup();
    two.state.starts.push({ ...two.state.starts[0]! });
    await ledger(two, 403, "more than one start");
  });

  it("refuses a pinned card someone else started", async () => {
    const s = setup();
    s.state.pinned.set("w1/card-1", { user_id: "u2", folder: "r", repo: "o/r", signer_id: s.mac.signer.id, start_sig: "x" });
    await ledger(s, 403, "isn't one you started");
  });

  it("refuses this worker's Done or deleted card", async () => {
    const done = setup();
    done.state.cards.set("org1/card-1", { deleted: false, column: "done", owner_worker: "w1" });
    await ledger(done, 403, "Done or deleted");
    const deleted = setup();
    deleted.state.cards.set("org1/card-1", { deleted: true, column: "running" });
    await ledger(deleted, 403, "Done or deleted");
  });
});
