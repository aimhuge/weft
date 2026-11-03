// @vitest-environment happy-dom
// An open file on a source that pushes its changes (lib/use-file-watch.ts through lib/use-open-file.ts): a worker's,
// over its session line. A clean tab reloads, unsaved edits get the conflict banner, as with a local file's stat poll.
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OpenedFile } from "./client-files";
import { FilesSourceContext, type FilesSource } from "./files-source";
import { useOpenFile } from "./use-open-file";

const file = (over: Partial<OpenedFile> = {}): OpenedFile => ({ path: "a.ts", exists: true, text: "one", hash: "h1", mtime: 1, size: 3, ...over });

function source(reads: OpenedFile[]) {
  let push: ((hash: string | null) => void) | null = null;
  const stop = vi.fn();
  const read = vi.fn(() => Promise.resolve(reads.shift() ?? file()));
  const src = {
    read,
    stat: vi.fn(),
    head: vi.fn(),
    list: vi.fn(),
    write: vi.fn(() => Promise.resolve({ hash: "h-saved", mtime: 5 })),
    live: false,
    watch: vi.fn((_: string, __: string, changed: (hash: string | null) => void) => ((push = changed), stop)),
  } as unknown as FilesSource & { read: typeof read };
  const wrapper = ({ children }: { children: ReactNode }) => createElement(FilesSourceContext.Provider, { value: src }, children);
  return { src, read, stop, wrapper, push: (hash: string | null) => act(() => push?.(hash)) };
}

afterEach(cleanup);

describe("useOpenFile on a source that watches", () => {
  it("reloads a clean tab on a new hash, ignores its own, and stops on unmount", async () => {
    const s = source([file(), file({ text: "two", hash: "h2" })]);
    const { result, unmount } = renderHook(() => useOpenFile("c1", "a.ts", true), { wrapper: s.wrapper });
    await waitFor(() => expect(result.current.text).toBe("one"));
    s.push("h1");
    expect(s.read).toHaveBeenCalledTimes(1);
    s.push("h2");
    await waitFor(() => expect(result.current.text).toBe("two"));
    expect(result.current.conflict).toBeNull();
    unmount();
    expect(s.stop).toHaveBeenCalledOnce();
  });

  it("keeps unsaved edits and shows the disk's text as a conflict", async () => {
    const s = source([file(), file({ text: "theirs", hash: "h3" })]);
    const { result } = renderHook(() => useOpenFile("c1", "a.ts", true), { wrapper: s.wrapper });
    await waitFor(() => expect(result.current.text).toBe("one"));
    act(() => result.current.setText("mine"));
    s.push("h3");
    await waitFor(() => expect(result.current.conflict?.disk.text).toBe("theirs"));
    expect(result.current.text).toBe("mine");
  });

  it("takes no change when the read finds the loaded hash (its own save landed), a failed read, or a push before the load", async () => {
    const s = source([file(), file()]);
    const { result } = renderHook(() => useOpenFile("c1", "a.ts", true), { wrapper: s.wrapper });
    s.push("early");
    await waitFor(() => expect(result.current.text).toBe("one"));
    s.push("h-other");
    await waitFor(() => expect(s.read).toHaveBeenCalledTimes(2));
    s.read.mockRejectedValueOnce(new Error("down"));
    s.push("h-else");
    await waitFor(() => expect(s.read).toHaveBeenCalledTimes(3));
    expect(result.current.conflict).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("drops a read that lands after the tab closed, and watches nothing while disabled", async () => {
    let land: (f: OpenedFile) => void = () => {};
    const s = source([file()]);
    const { result, unmount } = renderHook(() => useOpenFile("c1", "a.ts", true), { wrapper: s.wrapper });
    await waitFor(() => expect(result.current.text).toBe("one"));
    s.read.mockImplementationOnce(() => new Promise((done) => (land = done)));
    s.push("h9");
    unmount();
    await act(async () => {
      land(file({ text: "late", hash: "h9" }));
      await Promise.resolve();
    });
    const off = source([]);
    renderHook(() => useOpenFile("c1", "a.ts", false), { wrapper: off.wrapper });
    expect(off.src.watch).not.toHaveBeenCalled();
  });
});
