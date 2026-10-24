// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import { rememberDeleteConfirm, shouldConfirmDelete } from "./delete-confirm";

beforeEach(() => localStorage.clear());

describe("delete-confirm", () => {
  it("asks before deleting by default", () => {
    expect(shouldConfirmDelete()).toBe(true);
  });

  it("stops asking once the user says not to", () => {
    rememberDeleteConfirm(true);
    expect(shouldConfirmDelete()).toBe(false);
  });

  it("asks again when the preference is cleared", () => {
    rememberDeleteConfirm(true);
    rememberDeleteConfirm(false);
    expect(shouldConfirmDelete()).toBe(true);
  });

  it("keeps the preference across a reload", () => {
    rememberDeleteConfirm(true);
    // localStorage survives a reload; a fresh read of the same store still sees it.
    expect(localStorage.getItem("weft.delete.skipConfirm")).toBe("1");
    expect(shouldConfirmDelete()).toBe(false);
  });
});
