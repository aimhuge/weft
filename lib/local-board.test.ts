import { describe, expect, it } from "vitest";
import { isLocalBoard } from "./local-board";

const at = (hostname: string, weft?: unknown) => ({ location: { hostname } as Location, weft });

describe("isLocalBoard", () => {
  it("is the desktop app when the Electron bridge is there, whatever the host", () => {
    expect(isLocalBoard(at("weft.zip", {}))).toBe(true);
  });

  it("is the board opened in a browser on this Mac", () => {
    expect(isLocalBoard(at("localhost"))).toBe(true);
    expect(isLocalBoard(at("127.0.0.1"))).toBe(true);
    expect(isLocalBoard(at("[::1]"))).toBe(true);
  });

  it("is never weft.zip or a preview deploy", () => {
    expect(isLocalBoard(at("weft.zip"))).toBe(false);
    expect(isLocalBoard(at("weft-git-main.vercel.app"))).toBe(false);
  });
});
