import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { listOutbox, markLocalOutcome, publicSharingOn, queueOutbox, readHostNotes, readNote, setPublicSharing, takeOutbox, validKey, writeNote } from "./site-notes-store";

// Every call names its own directory: a fresh temp dir per test, never the real ~/.weft.
const dirs: string[] = [];
const tempDir = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-site-notes-store-"));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

const note = (host: string, notePath: string, body = "# Login\n\nThe sign-in form lives at /login on this site.") => ({ host, path: notePath, body });

describe("validKey", () => {
  it("takes a plain host and a general path", () => {
    expect(validKey("example.com", "/login")).toBe(true);
    expect(validKey("example.com", "/dashboard/project/:ref/settings")).toBe(true);
    expect(validKey("example.com", "/")).toBe(true);
  });

  it("rejects a host that is not one, or a path that is not general", () => {
    expect(validKey("Example.com", "/login")).toBe(false);
    expect(validKey("exa mple.com", "/login")).toBe(false);
    expect(validKey("", "/login")).toBe(false);
    expect(validKey("..", "/login")).toBe(false);
    expect(validKey("example.com", "login")).toBe(false);
    expect(validKey("example.com", "/login?a=b")).toBe(false);
  });
});

describe("writeNote / readHostNotes / readNote", () => {
  it("writes a note and reads it back", () => {
    const dir = tempDir();
    const file = writeNote(note("example.com", "/login"), dir);
    expect(file.startsWith(dir)).toBe(true);
    expect(file.endsWith(".md")).toBe(true);

    const notes = readHostNotes("example.com", dir);
    expect(notes).toHaveLength(1);
    expect(notes[0]?.host).toBe("example.com");
    expect(notes[0]?.path).toBe("/login");
    expect(notes[0]?.source).toBe("local");
    expect(notes[0]?.body).toContain("The sign-in form");
  });

  it("gives each general path its own file", () => {
    const dir = tempDir();
    writeNote(note("example.com", "/login", "Login page"), dir);
    writeNote(note("example.com", "/settings", "Settings page"), dir);
    const notes = readHostNotes("example.com", dir);
    expect(notes.map((n) => n.path).sort()).toEqual(["/login", "/settings"]);
  });

  it("keeps the optional fields", () => {
    const dir = tempDir();
    writeNote({ ...note("example.com", "/login"), lastSuccess: "2026-10-20", stale: true }, dir);
    const read = readNote("example.com", "/login", dir);
    expect(read?.lastSuccess).toBe("2026-10-20");
    expect(read?.stale).toBe(true);
  });

  it("finds one note by its path, or none", () => {
    const dir = tempDir();
    writeNote(note("example.com", "/login"), dir);
    expect(readNote("example.com", "/login", dir)?.path).toBe("/login");
    expect(readNote("example.com", "/missing", dir)).toBeNull();
    expect(readNote("other.com", "/login", dir)).toBeNull();
  });

  it("refuses a key that is not one", () => {
    const dir = tempDir();
    expect(() => writeNote(note("Example.com", "/login"), dir)).toThrow(/Not a note key/);
    expect(() => writeNote(note("example.com", "login"), dir)).toThrow(/Not a note key/);
  });

  it("is empty for a host with no notes, or an invalid host", () => {
    const dir = tempDir();
    expect(readHostNotes("example.com", dir)).toEqual([]);
    expect(readHostNotes("Example.com", dir)).toEqual([]);
    expect(readHostNotes("..", dir)).toEqual([]);
  });

  it("skips a file that is not a note, and one for another host", () => {
    const dir = tempDir();
    const hostDir = path.join(dir, "example.com");
    fs.mkdirSync(hostDir, { recursive: true });
    fs.writeFileSync(path.join(hostDir, "not-a-note.md"), "no front matter here");
    fs.writeFileSync(path.join(hostDir, "other-host.md"), "---\nhost: other.com\npath: /login\nupdated: 2026-10-20\n---\n\nBody\n");
    fs.writeFileSync(path.join(hostDir, "ignored.txt"), "not markdown");
    const notes = readHostNotes("example.com", dir);
    expect(notes).toEqual([]);
  });
});

describe("markLocalOutcome", () => {
  it("stamps the last success and clears a stale mark", () => {
    const dir = tempDir();
    writeNote({ ...note("example.com", "/login"), stale: true }, dir);
    markLocalOutcome("example.com", "/login", "success", dir, new Date("2026-10-26T12:00:00Z"));
    const read = readNote("example.com", "/login", dir);
    expect(read?.lastSuccess).toBe("2026-10-26");
    expect(read?.stale).toBeUndefined();
  });

  it("marks the note stale when a step failed", () => {
    const dir = tempDir();
    writeNote({ ...note("example.com", "/login"), lastSuccess: "2026-10-20" }, dir);
    markLocalOutcome("example.com", "/login", "failure", dir);
    const read = readNote("example.com", "/login", dir);
    expect(read?.stale).toBe(true);
    expect(read?.lastSuccess).toBe("2026-10-20");
  });

  it("does nothing for a note that is not there", () => {
    const dir = tempDir();
    markLocalOutcome("example.com", "/login", "success", dir);
    expect(readNote("example.com", "/login", dir)).toBeNull();
  });
});

describe("publicSharingOn / setPublicSharing", () => {
  it("is off until the user turns it on, and remembers the switch", () => {
    const dir = tempDir();
    expect(publicSharingOn(dir)).toBe(false);
    setPublicSharing(true, dir);
    expect(publicSharingOn(dir)).toBe(true);
    setPublicSharing(false, dir);
    expect(publicSharingOn(dir)).toBe(false);
  });

  it("is off when the settings file is missing or unreadable", () => {
    const dir = tempDir();
    expect(publicSharingOn(dir)).toBe(false);
    fs.writeFileSync(path.join(dir, "settings.json"), "not json");
    expect(publicSharingOn(dir)).toBe(false);
  });

  it("is off when the settings say anything but true", () => {
    const dir = tempDir();
    fs.writeFileSync(path.join(dir, "settings.json"), JSON.stringify({ public: "yes" }));
    expect(publicSharingOn(dir)).toBe(false);
  });
});

describe("listOutbox", () => {
  it("is empty when there is no outbox", () => {
    const dir = tempDir();
    expect(listOutbox(dir)).toEqual([]);
  });

  it("is empty when the outbox file is not a list", () => {
    const dir = tempDir();
    fs.writeFileSync(path.join(dir, "outbox.json"), JSON.stringify({ nope: true }));
    expect(listOutbox(dir)).toEqual([]);
  });

  it("is empty when the outbox file is unreadable", () => {
    const dir = tempDir();
    fs.writeFileSync(path.join(dir, "outbox.json"), "not json");
    expect(listOutbox(dir)).toEqual([]);
  });
});

describe("queueOutbox", () => {
  it("queues a draft with an id and the time it was queued", () => {
    const dir = tempDir();
    queueOutbox({ host: "example.com", path: "/login", body: "Login page" }, dir, new Date("2026-10-26T12:00:00Z"));
    const items = listOutbox(dir);
    expect(items).toHaveLength(1);
    expect(items[0]?.id).toBe("example.com/login");
    expect(items[0]?.queuedAt).toBe("2026-10-26T12:00:00.000Z");
    expect(items[0]?.body).toBe("Login page");
  });

  it("replaces a newer draft of the same note", () => {
    const dir = tempDir();
    queueOutbox({ host: "example.com", path: "/login", body: "First" }, dir);
    queueOutbox({ host: "example.com", path: "/login", body: "Second" }, dir);
    const items = listOutbox(dir);
    expect(items).toHaveLength(1);
    expect(items[0]?.body).toBe("Second");
  });

  it("keeps at most 50 drafts", () => {
    const dir = tempDir();
    for (let i = 0; i < 55; i++) queueOutbox({ host: "example.com", path: `/p${i}`, body: `Body ${i}` }, dir);
    const items = listOutbox(dir);
    expect(items).toHaveLength(50);
    expect(items[0]?.path).toBe("/p5");
    expect(items[49]?.path).toBe("/p54");
  });
});

describe("takeOutbox", () => {
  it("takes the named drafts and leaves the others", () => {
    const dir = tempDir();
    queueOutbox({ host: "example.com", path: "/login", body: "Login" }, dir);
    queueOutbox({ host: "example.com", path: "/settings", body: "Settings" }, dir);
    const taken = takeOutbox(["example.com/login"], dir);
    expect(taken).toHaveLength(1);
    expect(taken[0]?.id).toBe("example.com/login");
    expect(listOutbox(dir).map((i) => i.id)).toEqual(["example.com/settings"]);
  });

  it("takes them all when no ids are named", () => {
    const dir = tempDir();
    queueOutbox({ host: "example.com", path: "/login", body: "Login" }, dir);
    queueOutbox({ host: "example.com", path: "/settings", body: "Settings" }, dir);
    const taken = takeOutbox(undefined, dir);
    expect(taken).toHaveLength(2);
    expect(listOutbox(dir)).toEqual([]);
  });

  it("takes nothing when no id matches", () => {
    const dir = tempDir();
    queueOutbox({ host: "example.com", path: "/login", body: "Login" }, dir);
    expect(takeOutbox(["nothing"], dir)).toEqual([]);
    expect(listOutbox(dir)).toHaveLength(1);
  });
});
