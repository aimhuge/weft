import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { askHidden } from "./terminal-ask";

const real = Object.getOwnPropertyDescriptor(process, "stdin");

function fakeStdin(isTTY: boolean) {
  const stdin = Object.assign(new EventEmitter(), { isTTY, setRawMode: vi.fn(), resume: vi.fn(), pause: vi.fn() });
  stdin.resume.mockReturnValue(stdin);
  Object.defineProperty(process, "stdin", { value: stdin, configurable: true });
  return stdin;
}

afterEach(() => {
  if (real) Object.defineProperty(process, "stdin", real);
  vi.restoreAllMocks();
});

describe("askHidden", () => {
  it("reads one line in raw mode on a terminal, with backspace, and trims it", async () => {
    const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const stdin = fakeStdin(true);
    const answer = askHidden("Type m1mini: ");
    stdin.emit("data", Buffer.from(" m1minx\u007fi\r"));
    await expect(answer).resolves.toBe("m1mini");
    expect(write).toHaveBeenCalledWith("Type m1mini: ");
    expect(stdin.setRawMode.mock.calls).toEqual([[true], [false]]);
    expect(stdin.pause).toHaveBeenCalled();
  });

  it("reads a piped line without raw mode", async () => {
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const stdin = fakeStdin(false);
    const answer = askHidden("? ");
    stdin.emit("data", Buffer.from("tok"));
    stdin.emit("data", Buffer.from("en\n"));
    await expect(answer).resolves.toBe("token");
    expect(stdin.setRawMode).not.toHaveBeenCalled();
  });

  it("exits on ctrl-C", () => {
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    const stdin = fakeStdin(true);
    void askHidden("? ");
    stdin.emit("data", Buffer.from("\u0003"));
    expect(exit).toHaveBeenCalledWith(130);
  });
});
