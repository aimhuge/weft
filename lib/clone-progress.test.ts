import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";

// spawn is a fake child whose stdout/stderr the tests write to, so no gh or git runs.
type FakeChild = EventEmitter & { stdout: EventEmitter; stderr: EventEmitter };
const children = vi.hoisted(() => [] as FakeChild[]);
const spawn = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ spawn }));

const { cloneProgress, parseCloneLine, runClone } = await import("./clone-progress");

function fakeChild() {
  const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter() });
  children.push(child);
  return child;
}

beforeEach(() => {
  children.length = 0;
  spawn.mockReset().mockImplementation(fakeChild);
});

describe("parseCloneLine", () => {
  it("weights each git phase onto one overall percent", () => {
    expect(parseCloneLine("remote: Enumerating objects: 1234, done.")).toEqual({ percent: 0, line: "Counting objects" });
    expect(parseCloneLine("remote: Counting objects: 100% (12/12), done.")).toEqual({ percent: 6, line: "Counting objects" });
    expect(parseCloneLine("remote: Compressing objects:  50% (6/12)")).toEqual({ percent: 8, line: "Compressing objects" });
    expect(parseCloneLine("Receiving objects:  50% (617/1234)")).toEqual({ percent: 45, line: "Receiving objects" });
    expect(parseCloneLine("Resolving deltas: 100% (400/400), done.")).toEqual({ percent: 95, line: "Resolving deltas" });
    expect(parseCloneLine("Updating files:  40% (40/100)")).toEqual({ percent: 97, line: "Checking out files" });
    expect(parseCloneLine("Checking out files: 100% (10/10)")).toEqual({ percent: 100, line: "Checking out files" });
  });

  it("keeps the size and speed while receiving", () => {
    expect(parseCloneLine("Receiving objects:  45% (555/1234), 1.20 MiB | 2.30 MiB/s")).toEqual({
      percent: 42,
      line: "Receiving objects · 1.20 MiB | 2.30 MiB/s",
    });
  });

  it("caps a percent over 100 and ignores anything that isn't progress", () => {
    expect(parseCloneLine("Receiving objects: 140%")?.percent).toBe(80);
    expect(parseCloneLine("Cloning into '/Users/me/dev/app'...")).toBeNull();
    expect(parseCloneLine("GraphQL: Could not resolve to a Repository")).toBeNull();
  });
});

describe("runClone", () => {
  it("runs gh with --progress for git and tracks the job until it's done", async () => {
    const done = runClone("Me/App", "/dev/app");
    expect(spawn).toHaveBeenCalledWith("gh", ["repo", "clone", "Me/App", "/dev/app", "--", "--progress"], { timeout: 600_000 });
    expect(cloneProgress("me/app")).toEqual({ status: "running", line: "Starting…", percent: 0 });
    const child = children[0]!;
    child.stderr.emit("data", Buffer.from("Cloning into '/dev/app'...\nReceiving objects:  10% (1/10)\rReceiving obj"));
    expect(cloneProgress("me/app")).toMatchObject({ percent: 17, line: "Receiving objects" });
    child.stderr.emit("data", Buffer.from("ects:  50% (5/10)\r"));
    expect(cloneProgress("me/app")?.percent).toBe(45);
    child.stdout.emit("data", Buffer.from("\n  \n"));
    child.emit("close", 0, null);
    await done;
    expect(cloneProgress("ME/APP")).toEqual({ status: "done", line: "Cloned", percent: 100 });
  });

  it("fails with the last thing gh said that wasn't progress", async () => {
    const done = runClone("me/missing", "/dev/missing");
    const child = children[0]!;
    child.stderr.emit("data", Buffer.from("GraphQL: Could not resolve to a Repository\nReceiving objects:  5%\r"));
    child.emit("close", 1, null);
    await expect(done).rejects.toThrow("GraphQL: Could not resolve to a Repository");
    expect(cloneProgress("me/missing")).toMatchObject({ status: "failed", line: "GraphQL: Could not resolve to a Repository" });
  });

  it("names a trailing line with no newline, an exit code, a timeout and a spawn error", async () => {
    let done = runClone("me/a", "/dev/a");
    children[0]!.stderr.emit("data", Buffer.from("fatal: no space left"));
    children[0]!.emit("close", 128, null);
    await expect(done).rejects.toThrow("fatal: no space left");

    done = runClone("me/b", "/dev/b");
    children[1]!.emit("close", 2, null);
    await expect(done).rejects.toThrow("gh exited with 2");

    done = runClone("me/c", "/dev/c");
    children[2]!.emit("close", null, "SIGTERM");
    await expect(done).rejects.toThrow("timed out after 10 minutes");

    done = runClone("me/d", "/dev/d");
    children[3]!.emit("error", Object.assign(new Error("spawn gh ENOENT"), { code: "ENOENT" }));
    await expect(done).rejects.toMatchObject({ code: "ENOENT" });
    expect(cloneProgress("me/d")).toMatchObject({ status: "failed", line: "spawn gh ENOENT" });
  });

  it("records a non-Error rejection as text", async () => {
    const done = runClone("me/e", "/dev/e");
    children[0]!.emit("error", "boom");
    await expect(done).rejects.toBe("boom");
    expect(cloneProgress("me/e")?.line).toBe("boom");
  });

  it("knows nothing about a repo it never cloned", () => {
    expect(cloneProgress("me/never")).toBeNull();
  });
});
