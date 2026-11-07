import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { showNotice, vaultRow } from "./vault-overview.cjs";
import { hashOf } from "./vault-sync-files.cjs";

const store = (shared = false) => ({
  exists: () => true,
  list: () => [{ name: "API_KEY", environment: "development" }],
  isShared: () => shared,
  queued: () => 2,
});

describe("vaultRow", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "overview-"));
  const base = { label: "acme/site", folder: "/w/site", dir, orgs: [{ id: "o1", slug: "acme", name: "Acme" }], nudge: null, managed: false };

  it("lists a local vault's names, with the team's join offer for its repo", () => {
    const join = { vaultId: "v1", orgId: "o1", repo: "acme/site", state: "none", fingerprint: "ab" };
    const row = vaultRow({ ...base, id: "github:acme/site", store: store(), team: { joins: new Map([["acme/site", join]]), requests: new Map() } });
    expect(row.secrets).toHaveLength(1);
    expect(row.join).toEqual(join);
    expect(row.shared).toBeUndefined();
    expect(row.folders).toEqual(["/w/site"]);
  });

  it("shows a shared vault's header, its waiting Macs and its queue", () => {
    const id = "github:acme/api";
    fs.writeFileSync(path.join(dir, `${hashOf(id)}.shared.json`), JSON.stringify({ orgId: "o1", vaultId: "v2", repo: "acme/api", keyVersion: 1 }));
    const requests = [{ id: "p1", person: "Sam", deviceName: "Mac", fingerprint: "cd" }];
    const row = vaultRow({ ...base, id, store: store(true), team: { joins: new Map(), requests: new Map([["v2", requests]]) } });
    expect(row.shared?.org.name).toBe("Acme");
    expect(row.requests).toEqual(requests);
    expect(row.queued).toBe(2);
    expect(row.join).toBeUndefined();
  });

  it("answers an empty list for a vault not on this Mac, with no team", () => {
    const row = vaultRow({ ...base, id: "folder:/w/x", store: null, team: null });
    expect(row.secrets).toEqual([]);
    expect(row.join).toBeUndefined();
  });
});

describe("showNotice", () => {
  it("shows a notification that brings the window forward", () => {
    const show = vi.fn();
    const win = { show: vi.fn() };
    let clicked: () => void = () => undefined;
    class Note {
      static isSupported = () => true;
      constructor(public opts: unknown) {}
      on(_: string, fn: () => void) {
        clicked = fn;
      }
      show = show;
    }
    showNotice(Note, { title: "t", body: "b" }, () => win);
    expect(show).toHaveBeenCalled();
    clicked();
    expect(win.show).toHaveBeenCalled();
  });

  it("does nothing where notifications aren't supported", () => {
    expect(() => {
      showNotice({ isSupported: () => false }, { title: "t", body: "b" }, () => null);
      showNotice(null, { title: "t", body: "b" }, () => null);
    }).not.toThrow();
  });
});
