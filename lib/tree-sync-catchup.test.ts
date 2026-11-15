// A synced folder across a commit (docs/architecture/folder-sync.md#catching-up): the end that is behind moves by
// itself, and when it can't, both ends say why.
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { follower } from "./tree-sync-follow";
import { treeFs } from "./tree-sync-fs";
import { createPeer, type SyncPeer, type SyncStatus } from "./tree-sync-peer";

const env = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8", env, stdio: ["ignore", "pipe", "ignore"] }).trim();

let tmp: string;
let mac: string;
let box: string;
const peers: SyncPeer[] = [];

beforeEach(() => {
  tmp = mkdtempSync(path.join(os.tmpdir(), "weft-catchup-"));
  const origin = path.join(tmp, "origin.git");
  git(tmp, "init", "-q", "--bare", "-b", "main", origin);
  mac = path.join(tmp, "mac");
  git(tmp, "clone", "-q", origin, mac);
  writeFileSync(path.join(mac, "a.ts"), "a\n");
  git(mac, "add", "-A");
  git(mac, "commit", "-q", "-m", "init");
  git(mac, "push", "-q", "origin", "main");
  box = path.join(tmp, "box");
  git(tmp, "clone", "-q", origin, box);
});

afterEach(() => {
  peers.splice(0).forEach((p) => p.stop());
  rmSync(tmp, { recursive: true, force: true });
});

// The Mac and the box wired to each other, each able to catch up. Timers are the test's to fire: `tick` runs one
// rescan on each end.
function link(o: { follow?: boolean } = {}) {
  const statuses: Record<"mac" | "box", SyncStatus[]> = { mac: [], box: [] };
  const sent: Record<"mac" | "box", string[]> = { mac: [], box: [] };
  const make = (me: "mac" | "box", root: string, other: () => SyncPeer) =>
    createPeer({
      fs: treeFs(root),
      self: { id: `id-${me}`, label: me === "mac" ? "Mac" : "m1mini" },
      other: { id: me === "mac" ? "id-box" : "id-mac", label: me === "mac" ? "m1mini" : "your Mac" },
      send: (text) => {
        sent[me].push(text);
        queueMicrotask(() => other().receive(text));
      },
      prio: () => 1,
      gitDir: path.join(root, ".git"),
      ...(o.follow === false ? {} : { follow: follower(root, me === "mac" ? "m1mini" : "your Mac") }),
      onStatus: (s) => statuses[me].push(s),
      checkMs: 200,
      rescanMs: 300,
    });
  const pm: SyncPeer = make("mac", mac, () => pb);
  const pb: SyncPeer = make("box", box, () => pm);
  peers.push(pm, pb);
  return { pm, pb, statuses, sent };
}

// Waits until `done` holds (the ends talk through real git, at their own pace), then lets the queues drain.
async function until(done: () => boolean, ms = 20_000) {
  const end = Date.now() + ms;
  while (!done() && Date.now() < end) await new Promise((r) => setTimeout(r, 20));
  await Promise.all(peers.map((p) => p.idle()));
}

const at = (root: string, p: string) => (existsSync(path.join(root, p)) ? readFileSync(path.join(root, p), "utf8") : null);
const head = (root: string) => git(root, "rev-parse", "HEAD");
// The latest status, read loosely: a paused one has a reason, and before the first there is none.
const last = (list: SyncStatus[]): { kind?: string; reason?: string } => list.at(-1) ?? {};
const synced = (list: SyncStatus[]) => list.at(-1)?.kind === "synced";
const pauses = (texts: string[]) => texts.filter((t) => t.includes('"t":"pause"'));

// Real git in two checkouts, on a Mac that may be running other cards' tests: each test gets room.
describe("a synced folder across a commit", { timeout: 30_000 }, () => {
  it("brings the end that is behind to the other's commit, then syncs", async () => {
    writeFileSync(path.join(mac, "a.ts"), "committed on the Mac\n");
    git(mac, "commit", "-qam", "the Mac moves on");
    git(mac, "push", "-q", "origin", "main");
    writeFileSync(path.join(box, "new.ts"), "the box's work\n");
    const { pm, pb, statuses } = link();
    await Promise.all([pm.start(), pb.start()]);
    await until(() => synced(statuses.mac) && synced(statuses.box) && at(mac, "new.ts") !== null);
    expect(head(box)).toBe(head(mac));
    expect(at(box, "a.ts")).toBe("committed on the Mac\n");
    expect(at(mac, "new.ts")).toBe("the box's work\n");
    expect(last(statuses.mac).kind).toBe("synced");
    expect(last(statuses.box).kind).toBe("synced");
  });

  it("follows a commit made while it syncs, the committed files already being there", async () => {
    const { pm, pb, statuses } = link();
    await Promise.all([pm.start(), pb.start()]);
    await until(() => synced(statuses.mac) && synced(statuses.box));
    writeFileSync(path.join(mac, "a.ts"), "edited, then committed\n");
    await pm.touched(["a.ts"]);
    await until(() => at(box, "a.ts") === "edited, then committed\n");
    expect(at(box, "a.ts")).toBe("edited, then committed\n");
    git(mac, "commit", "-qam", "commit what synced");
    git(mac, "push", "-q", "origin", "main");
    await until(() => head(box) === head(mac) && synced(statuses.box) && synced(statuses.mac));
    expect(head(box)).toBe(head(mac));
    expect(git(box, "status", "--porcelain")).toBe("");
    expect(last(statuses.box).kind).toBe("synced");
    expect(last(statuses.mac).kind).toBe("synced");
  });

  it("tells both ends why it can't, once, and syncs when the clash is gone", async () => {
    writeFileSync(path.join(mac, "a.ts"), "committed on the Mac\n");
    git(mac, "commit", "-qam", "the Mac moves on");
    git(mac, "push", "-q", "origin", "main");
    writeFileSync(path.join(box, "a.ts"), "the box's own\n");
    const { pm, pb, statuses, sent } = link();
    await Promise.all([pm.start(), pb.start()]);
    const told = "m1mini: 1 uncommitted file clashes with newer commits (a.ts)";
    await until(() => last(statuses.mac).reason === told);
    // A few more rescans go by: the reason still crossed once.
    await new Promise((r) => setTimeout(r, 900));
    expect(last(statuses.box)).toMatchObject({ kind: "paused", reason: "1 uncommitted file clashes with newer commits (a.ts)" });
    expect(last(statuses.mac)).toMatchObject({ kind: "paused", reason: told });
    expect(pauses(sent.box)).toHaveLength(1);
    expect(pauses(sent.mac)).toHaveLength(0);
    git(box, "checkout", "-q", "--", "a.ts");
    await until(() => synced(statuses.mac) && synced(statuses.box));
    expect(head(box)).toBe(head(mac));
    expect(last(statuses.box).kind).toBe("synced");
    expect(last(statuses.mac).kind).toBe("synced");
  });

  it("waits on the end that is ahead until the other says why it's stuck", async () => {
    writeFileSync(path.join(mac, "a.ts"), "committed, not pushed\n");
    git(mac, "commit", "-qam", "unpushed");
    const { pm, pb, statuses } = link();
    await Promise.all([pm.start(), pb.start()]);
    const told = `m1mini: Waiting for commit ${head(mac).slice(0, 7)} to be pushed`;
    await until(() => last(statuses.mac).reason === told);
    // Before the box said why, the Mac only knew it was ahead.
    expect(statuses.mac.map((s) => (s as { reason?: string }).reason)).toContain(`Waiting for m1mini to catch up to ${head(mac).slice(0, 7)}`);
    // The Mac's own rescans keep the box's reason rather than its own guess.
    await new Promise((r) => setTimeout(r, 700));
    expect(last(statuses.box)).toMatchObject({ kind: "paused", reason: `Waiting for commit ${head(mac).slice(0, 7)} to be pushed` });
    expect(last(statuses.mac)).toMatchObject({ kind: "paused", reason: told });
  });

  it("only pauses without a follower, and leaves another branch alone", async () => {
    writeFileSync(path.join(mac, "a.ts"), "committed on the Mac\n");
    git(mac, "commit", "-qam", "the Mac moves on");
    git(mac, "push", "-q", "origin", "main");
    let { pm, pb, statuses } = link({ follow: false });
    await Promise.all([pm.start(), pb.start()]);
    await until(() => last(statuses.box).kind === "paused" && last(statuses.mac).kind === "paused");
    expect(last(statuses.box).reason).toMatch(/your Mac is at [0-9a-f]{7} and this side at [0-9a-f]{7}/);
    expect(head(box)).not.toBe(head(mac));
    peers.splice(0).forEach((p) => p.stop());
    git(box, "checkout", "-q", "-b", "other");
    ({ pm, pb, statuses } = link());
    await Promise.all([pm.start(), pb.start()]);
    await until(() => last(statuses.box).kind === "paused");
    // A rescan while paused on the branch tries nothing.
    await new Promise((r) => setTimeout(r, 400));
    expect(last(statuses.box).reason).toMatch(/is on main and this side is on other/);
    expect(git(box, "rev-parse", "--abbrev-ref", "HEAD")).toBe("other");
  });
});
