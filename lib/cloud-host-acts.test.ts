// weft.zip's host verbs (lib/cloud-host-acts.ts): ↑ edit, Send fresh and Send later as `host` rows for the machine
// that runs the card, each followed to its result (a refusal rejects, one not taken yet is queued), and the "/" list
// read back from the row's result and kept a few minutes.
import { describe, expect, it, vi } from "vitest";
import type { NewCommand } from "./cloud-commands";
import { cloudHostActs, type CloudHostInput } from "./cloud-host-acts";
import type { CommandResult } from "./worker-command-wait";

const TARGET = { orgId: "org-1", device: "mac-1", folder: "/dev/app", cardId: "c1" };
// A clock that moves a tick per look, so a host that never answers gives up after a few reads.
const ticks = () => {
  let t = 0;
  return { sleep: () => Promise.resolve(), every: 1, unclaimed: 5, claimed: 5, now: () => t++ };
};

function setup(reads: CommandResult[] = [{ status: "done", error: null }], over: Partial<CloudHostInput> = {}) {
  const rows: NewCommand[] = [];
  const read = vi.fn(() => Promise.resolve(reads.length > 1 ? reads.shift()! : reads[0]!));
  const acts = cloudHostActs({
    target: (cardId) => (cardId === "gone" ? "That thread isn't on the board anymore." : { ...TARGET, cardId }),
    insert: (row) => (rows.push(row), Promise.resolve({ id: `cmd-${rows.length}` })),
    read,
    wait: ticks(),
    queuedWait: ticks(),
    ...over,
  });
  return { acts, rows, read };
}

const payloads = (rows: NewCommand[]) => rows.map((r) => r.payload);
const DONE: CommandResult = { status: "done", error: null };
const PENDING: CommandResult = { status: "pending", error: null };

describe("cloudHostActs", () => {
  it("sends ↑ edit, Send fresh and Send later as host rows for the card's machine, settled once they ran", async () => {
    const { acts, rows } = setup();
    await acts.editLast("c1", "better");
    await acts.fresh("c1", "again");
    await expect(acts.schedule("c1", "later", 9_000)).resolves.toBeUndefined();
    await acts.unschedule("c1", "m1");
    expect(rows.every((r) => r.kind === "host" && r.target_device === "mac-1" && r.folder === "/dev/app" && r.org_id === "org-1")).toBe(true);
    expect(payloads(rows)).toEqual([
      { verb: "card.message.edit", args: { text: "better", id: "c1" } },
      { verb: "card.fresh", args: { message: "again", id: "c1" } },
      { verb: "card.schedule", args: { text: "later", at: 9_000, id: "c1" } },
      { verb: "card.unschedule", args: { messageId: "m1", id: "c1" } },
    ]);
  });

  it("sends any verb through act, the card's id always the target's", async () => {
    const { acts, rows } = setup();
    await expect(acts.act("card.update", "c1", { body: { starred: true }, id: "other" })).resolves.toBeUndefined();
    expect(payloads(rows)).toEqual([{ verb: "card.update", args: { body: { starred: true }, id: "c1" } }]);
  });

  it("rejects with the machine's refusal, so the box can put the text back", async () => {
    await expect(setup([{ status: "failed", error: "That time has already passed." }]).acts.schedule("c1", "x", 1)).rejects.toThrow("That time has already passed.");
    await expect(setup([{ status: "failed", error: null }]).acts.editLast("c1", "x")).rejects.toThrow("Your Mac couldn't do that.");
  });

  it("answers { queued } for one the machine hasn't taken, settling when it runs or is refused", async () => {
    const ran = setup([PENDING, PENDING, PENDING, PENDING, PENDING, PENDING, PENDING, DONE]);
    const later = await ran.acts.schedule("c1", "x", 1);
    await expect(later!.queued).resolves.toBeUndefined();
    const refused = setup([PENDING, PENDING, PENDING, PENDING, PENDING, PENDING, PENDING, { status: "failed", error: "asleep too long" }]);
    const held = await refused.acts.schedule("c1", "x", 1);
    await expect(held!.queued).rejects.toThrow("asleep too long");
    // An edit doesn't hold the box for a machine that's away: it resolves, and a late refusal shows above the box.
    await expect(setup([PENDING]).acts.fresh("c1", "x")).resolves.toBeUndefined();
  });

  it("refuses a card it can't address, and an insert that fails", async () => {
    await expect(setup().acts.editLast("gone", "x")).rejects.toThrow("That thread isn't on the board anymore.");
    await expect(setup([DONE], { insert: () => Promise.resolve("permission denied") }).acts.fresh("c1", "x")).rejects.toThrow("permission denied");
  });

  it("reads the skills back off the row's result, and keeps a card's list for a while", async () => {
    const { acts, rows, read } = setup([{ status: "claimed", error: null }, { ...DONE, result: { ok: true, cardId: "c1", skills: [["ship", "Ship it", "user"]] } }]);
    await expect(acts.listSkills("c1")).resolves.toEqual([{ name: "ship", description: "Ship it", source: "user" }]);
    await acts.listSkills("c1");
    expect(payloads(rows)).toEqual([{ verb: "skills.list", args: { id: "c1" } }]);
    expect(read).toHaveBeenCalledWith("cmd-1");
  });

  it("has no list off a card, and says why when the host refused or never answered", async () => {
    const none = setup();
    await expect(none.acts.listSkills(undefined)).resolves.toEqual([]);
    expect(none.rows).toEqual([]);
    await expect(setup([{ status: "failed", error: "No such card." }]).acts.listSkills("c1")).rejects.toThrow("No such card.");
    await expect(setup([{ status: "failed", error: null }]).acts.listSkills("c1")).rejects.toThrow("Couldn't read the skills.");
    await expect(setup([PENDING]).acts.listSkills("c1")).rejects.toThrow("didn't answer");
  });
});
