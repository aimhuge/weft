// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenedFile } from "./client-files";

const { filesApi, FileConflictError } = vi.hoisted(() => {
  // Re-export FileConflictError as a class so the production code under test catches with
  // `instanceof`. The class identity is per-module-load; tests recreate it via resetModules.
  class FileConflictErrorLocal extends Error {
    current: OpenedFile;
    constructor(current: OpenedFile) {
      super(`${current.path} changed on disk since you opened it.`);
      this.name = "FileConflictError";
      this.current = current;
    }
  }
  return {
    filesApi: {
      read: vi.fn(),
      stat: vi.fn(),
      head: vi.fn(),
      list: vi.fn(),
      write: vi.fn(),
    },
    FileConflictError: FileConflictErrorLocal,
  };
});

vi.mock("./client-files", () => ({ filesApi, FileConflictError }));

async function loadHook() {
  vi.resetModules();
  return (await import("./use-open-file")).useOpenFile;
}

function file(over: Partial<OpenedFile> = {}): OpenedFile {
  return {
    path: "lib/x.ts",
    exists: true,
    text: "hello",
    hash: "h1",
    mtime: 1000,
    size: 5,
    ...over,
  };
}

beforeEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  filesApi.read.mockResolvedValue(file());
  filesApi.stat.mockResolvedValue({ exists: true, mtime: 1000, size: 5 });
  filesApi.write.mockResolvedValue({ hash: "h2", mtime: 2000 });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("useOpenFile — load", () => {
  it("loads on mount and exposes text", async () => {
    const useOpenFile = await loadHook();
    const { result } = renderHook(() => useOpenFile("c1", "lib/x.ts", true));
    await waitFor(() => expect(result.current.loaded?.hash).toBe("h1"));
    expect(result.current.text).toBe("hello");
    expect(result.current.dirty).toBe(false);
  });

  it("records an error when the read fails", async () => {
    filesApi.read.mockRejectedValueOnce(new Error("boom"));
    const useOpenFile = await loadHook();
    const { result } = renderHook(() => useOpenFile("c1", "lib/x.ts", true));
    await waitFor(() => expect(result.current.error).toBe("boom"));
  });

  it("skips loading when disabled", async () => {
    const useOpenFile = await loadHook();
    const { result } = renderHook(() => useOpenFile("c1", "lib/x.ts", false));
    // No read happens. The result is empty.
    expect(filesApi.read).not.toHaveBeenCalled();
    expect(result.current.loaded).toBeNull();
  });
});

describe("useOpenFile — dirty / save", () => {
  it("flips dirty when the user edits the text", async () => {
    const useOpenFile = await loadHook();
    const { result } = renderHook(() => useOpenFile("c1", "lib/x.ts", true));
    await waitFor(() => expect(result.current.loaded?.hash).toBe("h1"));
    act(() => result.current.setText("hello there"));
    expect(result.current.dirty).toBe(true);
  });

  it("save() writes the text and clears dirty, with the hash from the server", async () => {
    const useOpenFile = await loadHook();
    const { result } = renderHook(() => useOpenFile("c1", "lib/x.ts", true));
    await waitFor(() => expect(result.current.loaded?.hash).toBe("h1"));
    act(() => result.current.setText("new text"));
    await act(async () => {
      await result.current.save();
    });
    expect(filesApi.write).toHaveBeenCalledWith("c1", "lib/x.ts", "new text", "h1");
    expect(result.current.dirty).toBe(false);
    expect(result.current.loaded?.hash).toBe("h2");
  });

  it("save() surfaces a FileConflictError as a conflict banner", async () => {
    const disk = file({ text: "their version", hash: "h9", mtime: 3000 });
    filesApi.write.mockRejectedValueOnce(new FileConflictError(disk));
    const useOpenFile = await loadHook();
    const { result } = renderHook(() => useOpenFile("c1", "lib/x.ts", true));
    await waitFor(() => expect(result.current.loaded?.hash).toBe("h1"));
    act(() => result.current.setText("mine"));
    await act(async () => {
      await result.current.save();
    });
    expect(result.current.conflict?.disk.text).toBe("their version");
    // The user's text is preserved.
    expect(result.current.text).toBe("mine");
  });

  it("overwrite() re-saves with no base hash and clears the conflict", async () => {
    const disk = file({ text: "their version", hash: "h9" });
    filesApi.write.mockRejectedValueOnce(new FileConflictError(disk));
    const useOpenFile = await loadHook();
    const { result } = renderHook(() => useOpenFile("c1", "lib/x.ts", true));
    await waitFor(() => expect(result.current.loaded?.hash).toBe("h1"));
    act(() => result.current.setText("mine"));
    await act(async () => {
      await result.current.save();
    });
    await act(async () => {
      await result.current.overwrite();
    });
    expect(filesApi.write).toHaveBeenLastCalledWith("c1", "lib/x.ts", "mine", undefined);
    expect(result.current.conflict).toBeNull();
    expect(result.current.dirty).toBe(false);
  });

  it("reload() drops the user's text and adopts the disk version", async () => {
    const disk = file({ text: "their version", hash: "h9", mtime: 3000, size: 13 });
    filesApi.write.mockRejectedValueOnce(new FileConflictError(disk));
    const useOpenFile = await loadHook();
    const { result } = renderHook(() => useOpenFile("c1", "lib/x.ts", true));
    await waitFor(() => expect(result.current.loaded?.hash).toBe("h1"));
    act(() => result.current.setText("mine"));
    await act(async () => {
      await result.current.save();
    });
    await act(async () => {
      await result.current.reload();
    });
    expect(result.current.text).toBe("their version");
    expect(result.current.conflict).toBeNull();
  });

  it("records non-conflict save errors", async () => {
    filesApi.write.mockRejectedValueOnce(new Error("denied"));
    const useOpenFile = await loadHook();
    const { result } = renderHook(() => useOpenFile("c1", "lib/x.ts", true));
    await waitFor(() => expect(result.current.loaded?.hash).toBe("h1"));
    act(() => result.current.setText("x"));
    await act(async () => {
      await result.current.save();
    });
    expect(result.current.error).toBe("denied");
  });

  it("writeWithText writes the merged text and adopts it as the new baseline", async () => {
    const useOpenFile = await loadHook();
    const { result } = renderHook(() => useOpenFile("c1", "lib/x.ts", true));
    await waitFor(() => expect(result.current.loaded?.hash).toBe("h1"));
    await act(async () => {
      await result.current.writeWithText("merged");
    });
    expect(filesApi.write).toHaveBeenCalledWith("c1", "lib/x.ts", "merged", "h1");
    expect(result.current.text).toBe("merged");
    expect(result.current.savedText).toBe("merged");
    expect(result.current.loaded?.hash).toBe("h2");
  });

  it("writeWithText surfaces a conflict on hash mismatch", async () => {
    const disk = file({ text: "their", hash: "h9" });
    filesApi.write.mockRejectedValueOnce(new FileConflictError(disk));
    const useOpenFile = await loadHook();
    const { result } = renderHook(() => useOpenFile("c1", "lib/x.ts", true));
    await waitFor(() => expect(result.current.loaded?.hash).toBe("h1"));
    await act(async () => {
      await result.current.writeWithText("mine");
    });
    expect(result.current.conflict?.disk.text).toBe("their");
  });

  it("refresh() re-reads the file", async () => {
    const useOpenFile = await loadHook();
    const { result } = renderHook(() => useOpenFile("c1", "lib/x.ts", true));
    await waitFor(() => expect(result.current.loaded?.hash).toBe("h1"));
    filesApi.read.mockResolvedValueOnce(file({ text: "new", hash: "h3" }));
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.text).toBe("new");
  });

  it("snapshotHash() returns the same value for the same text", async () => {
    const mod = await import("./use-open-file");
    const a = mod.snapshotHash("hello");
    const b = mod.snapshotHash("hello");
    expect(a).toBe(b);
    expect(mod.snapshotHash("hello")).not.toBe(mod.snapshotHash("world"));
  });
});

describe("useOpenFile — poll", () => {
  it("reloads clean text when the thread changes the file on disk", async () => {
    // Fake timers from the start so the poll's setTimeout is faked too.
    vi.useFakeTimers();
    filesApi.stat.mockResolvedValue({ exists: true, mtime: 1000, size: 5 });
    const useOpenFile = await loadHook();
    const { result } = renderHook(() => useOpenFile("c1", "lib/x.ts", true));
    // Drain the initial load (microtasks + initial setTimeout).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.loaded?.hash).toBe("h1");
    // Simulate the thread writing a new version.
    filesApi.stat.mockResolvedValueOnce({ exists: true, mtime: 2000, size: 8 });
    filesApi.read.mockResolvedValueOnce(file({ text: "hello!!", hash: "h2", mtime: 2000, size: 8 }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(result.current.text).toBe("hello!!");
  });

  it("flags a conflict (not silent overwrite) when the user is dirty and the file changes", async () => {
    vi.useFakeTimers();
    filesApi.stat.mockResolvedValue({ exists: true, mtime: 1000, size: 5 });
    const useOpenFile = await loadHook();
    const { result } = renderHook(() => useOpenFile("c1", "lib/x.ts", true));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.loaded?.hash).toBe("h1");
    act(() => result.current.setText("my edit"));
    // Disk changes.
    filesApi.stat.mockResolvedValueOnce({ exists: true, mtime: 2000, size: 8 });
    filesApi.read.mockResolvedValueOnce(file({ text: "disk's", hash: "h2", mtime: 2000, size: 5 }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(result.current.conflict?.disk.text).toBe("disk's");
    // The user's text survives.
    expect(result.current.text).toBe("my edit");
  });

  it("skips polling while the tab is hidden", async () => {
    vi.useFakeTimers();
    const useOpenFile = await loadHook();
    const { result } = renderHook(() => useOpenFile("c1", "lib/x.ts", true));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.loaded?.hash).toBe("h1");
    const callsBefore = filesApi.stat.mock.calls.length;
    // Mark the document hidden; the poll is supposed to skip work.
    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(filesApi.stat.mock.calls.length).toBe(callsBefore);
    Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
    expect(result.current.text).toBe("hello");
  });

  it("reads and saves through the open card's source, and doesn't poll one that can't afford it (a worker's)", async () => {
    vi.useFakeTimers();
    const useOpenFile = await loadHook();
    const { FilesSourceContext } = await import("./files-source");
    const remote = {
      read: vi.fn(() => Promise.resolve(file({ text: "on the worker" }))),
      stat: vi.fn(),
      head: vi.fn(),
      list: vi.fn(),
      write: vi.fn(() => Promise.resolve({ hash: "h9", mtime: 9 })),
      live: false,
    };
    const wrapper = ({ children }: { children: ReactNode }) => createElement(FilesSourceContext.Provider, { value: remote }, children);
    const { result } = renderHook(() => useOpenFile("w1", "lib/x.ts", true), { wrapper });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.text).toBe("on the worker");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(remote.stat).not.toHaveBeenCalled();
    expect(filesApi.read).not.toHaveBeenCalled();
    act(() => result.current.setText("edited"));
    await act(async () => {
      await result.current.save();
    });
    expect(remote.write).toHaveBeenCalledWith("w1", "lib/x.ts", "edited", "h1");
  });
});
