import { describe, expect, it } from "vitest";
import { bangCommand, isBang } from "./bang";

describe("bangCommand", () => {
  it("reads the command after a leading !", () => {
    expect(bangCommand("!git status")).toBe("git status");
    expect(bangCommand("  ! ls -la  ")).toBe("ls -la");
  });

  it("reads the escaped \\! Markdown writes", () => {
    expect(bangCommand("\\!pwd")).toBe("pwd");
    expect(isBang("\\!pwd")).toBe(true);
  });

  it("keeps a command over several lines", () => {
    expect(bangCommand("!echo a\necho b")).toBe("echo a\necho b");
  });

  it("gives an empty command for a bare !", () => {
    expect(bangCommand("!")).toBe("");
  });

  it("is null for a reply that starts with a pasted picture", () => {
    expect(bangCommand("![screenshot](/Users/me/.weft/attachments/a.png) what's wrong here?")).toBeNull();
    expect(isBang("![clip](<path with spaces.mov>)")).toBe(false);
  });

  it("is null for a message that doesn't start with !", () => {
    expect(bangCommand("run git status!")).toBeNull();
    expect(isBang("hello")).toBe(false);
  });
});
