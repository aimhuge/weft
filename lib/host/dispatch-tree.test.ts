// tree.snapshot through the host kind (docs/architecture/wip-sync.md): a worker runs it for its folder and answers with
// the snapshot; a Mac, which takes no host-level verb from the network, refuses.
import { describe, expect, it, vi } from "vitest";
import type { CloudCommandRow } from "../cloud-commands";
import type { Card } from "../types";
import { cardKinds, type CardRules } from "./dispatch";

const row = { id: "c1", kind: "host", folder: "", payload: { verb: "tree.snapshot", args: { folder: "weft" } } } as unknown as CloudCommandRow;
const base = { card: vi.fn<CardRules["card"]>(() => ({}) as Card), verb: vi.fn<CardRules["verb"]>(() => Promise.resolve({ ok: true })), grant: vi.fn<CardRules["grant"]>() };

describe("tree.snapshot on a host", () => {
  it("runs with its folder and no card, and sends the snapshot back as the value", async () => {
    const snap = { sha: "s1", mac: "m1mini", branch: "main", running: 0 };
    const hostVerb = vi.fn<NonNullable<CardRules["hostVerb"]>>(() => Promise.resolve(snap));
    expect(await cardKinds({ ...base, hostVerb }).host(row)).toEqual({ cardId: "", result: { ok: true, cardId: "", value: snap } });
    expect(hostVerb).toHaveBeenCalledWith("tree.snapshot", { folder: "weft", id: "" });
    expect(base.card).not.toHaveBeenCalled();
  });

  it("is refused by a host that takes no host-level verbs (a Mac)", async () => {
    await expect(cardKinds(base).host(row)).rejects.toThrow("only from its own window");
  });
});
