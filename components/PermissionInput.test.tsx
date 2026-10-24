// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { EditPreview } from "@/lib/edit-preview";
import type { PendingPermission } from "@/lib/types";
import { FileLinkContext } from "./file-link-context";
import PermissionInput, { PermissionActions, REASONS, symbolLabel } from "./PermissionInput";
import "./test-utils";

const input = { file_path: "/p/lib/a.ts", old_string: "one\ntwo", new_string: "one\n2" };
const edit: EditPreview = {
  file: "lib/a.ts",
  symbols: ["setupGaps", "Board/useEffect#3"],
  added: 1,
  removed: 1,
  lines: [
    { kind: " ", text: "one" },
    { kind: "-", text: "two" },
    { kind: "+", text: "2" },
  ],
  more: 3,
};

describe("PermissionInput", () => {
  it("names an outside-project folder with its own chip", () => {
    render(<PermissionInput input={{ command: "ls ~/Downloads" }} why={{ category: "outside", detail: "~/Downloads isn't in this card's project folder" }} />);
    expect(screen.getByText("⚠ Outside project").parentElement?.title).toBe(REASONS.outside.tip);
  });

  it("shows a held edit as who asks, the file, its symbols, counts and a diff", () => {
    render(<PermissionInput input={input} edit={edit} askedBy="Fix login" why={{ category: "same-code", detail: "‘Restyle’ (running) has uncommitted edits to setupGaps" }} />);
    expect(screen.getByText("⚠ Same code").parentElement?.title).toBe(REASONS["same-code"].tip);
    expect(screen.getByText("‘Restyle’ (running) has uncommitted edits to setupGaps")).toBeTruthy();
    expect(screen.getByText("‘Fix login’", { exact: false })).toBeTruthy();
    expect(screen.getByText("lib/a.ts")).toBeTruthy();
    expect(screen.getByText("setupGaps, Board › useEffect #3")).toBeTruthy();
    expect(screen.getByText("+1")).toBeTruthy();
    expect(screen.getByText("−1")).toBeTruthy();
    const diff = screen.getByTestId("edit-diff");
    expect(diff.textContent).toContain("- two");
    expect(diff.textContent).toContain("+ 2");
    expect(diff.textContent).toContain("… 3 more lines");
    expect(diff.textContent).not.toContain("old_string");
  });

  it("keeps the raw JSON behind Raw", async () => {
    render(<PermissionInput input={input} edit={{ ...edit, symbols: undefined, more: 0, creates: true }} />);
    expect(screen.getByText(/creates/)).toBeTruthy();
    expect(screen.queryByText(/old_string/)).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Raw" }));
    expect(screen.getByText(/"old_string": "one\\ntwo"/)).toBeTruthy();
    expect(screen.queryByTestId("edit-diff")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Raw" }));
    expect(screen.getByTestId("edit-diff")).toBeTruthy();
  });

  it("shows any other tool's input as JSON", () => {
    render(<PermissionInput input={{ command: "ls" }} why={{ category: "mode", detail: "Ask me asks before Bash" }} />);
    expect(screen.getByText(/"command": "ls"/)).toBeTruthy();
    expect(screen.getByText("⚠ Permission mode")).toBeTruthy();
    expect(screen.getByText("Ask me asks before Bash")).toBeTruthy();
  });

  it("labels nested symbols readably", () => {
    expect(symbolLabel("Board/return/div#2/main")).toBe("Board › return › div #2 › main");
    expect(symbolLabel("one")).toBe("one");
  });

  it("shows a plan as a pane link instead of raw JSON", async () => {
    const open = vi.fn().mockResolvedValue(undefined);
    (window as unknown as { weft?: { browser: { open: typeof open } } }).weft = { browser: { open } };
    render(
      <FileLinkContext.Provider value="c1">
        <PermissionInput input={{ plan: "# Steps\n- One\n- Two" }} previewUrl="file:///show/c1-plan.html" />
      </FileLinkContext.Provider>,
    );
    expect(screen.getByText("Plan opened in the pane — read it there, then Allow or Deny below.")).toBeTruthy();
    expect(screen.queryByText(/"plan":/)).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Show in pane" }));
    expect(open).toHaveBeenCalledWith("file:///show/c1-plan.html", "c1");
    expect(open.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});

describe("PermissionActions", () => {
  const holder = { id: "h", title: "Fix login", claim: "/r/a.ts#one" };
  const base = { id: "p", toolName: "Edit", title: "t", input: {} };

  function setup(pending: PendingPermission) {
    const onAnswer = vi.fn();
    const onWait = vi.fn();
    render(<PermissionActions pending={pending} answered={false} onAnswer={onAnswer} onWait={onWait} />);
    return { onAnswer, onWait };
  }

  it("offers a retry for a call auto mode's classifier blocked, or keeping it denied", async () => {
    const { onAnswer } = setup({ ...base, why: { category: "classifier", detail: "Looks like a production deploy" } });
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual(["Allow once and retry", "Keep denied"]);
    await userEvent.click(screen.getByRole("button", { name: "Allow once and retry" }));
    expect(onAnswer).toHaveBeenLastCalledWith(true);
    await userEvent.click(screen.getByRole("button", { name: "Keep denied" }));
    expect(onAnswer).toHaveBeenLastCalledWith(false);
    expect(REASONS.classifier.label).toBe("Auto mode blocked");
  });

  it("offers Wait first when another card holds the code", async () => {
    const { onAnswer, onWait } = setup({ ...base, why: { category: "same-code", detail: "d", holder } });
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual(["Await resolution", "Go ahead", "Deny"]);
    await userEvent.click(screen.getByRole("button", { name: "Await resolution" }));
    expect(onWait).toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Go ahead" }));
    expect(onAnswer).toHaveBeenLastCalledWith(true);
  });

  it("while waiting, says who it waits for and still lets you go ahead or deny", async () => {
    const { onAnswer } = setup({ ...base, why: { category: "same-code", detail: "d", holder }, waiting: true });
    expect(screen.getByText("Waiting for ‘Fix login’ to finish…")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Go ahead now" }));
    expect(onAnswer).toHaveBeenLastCalledWith(true);
    await userEvent.click(screen.getByRole("button", { name: "Deny" }));
    expect(onAnswer).toHaveBeenLastCalledWith(false);
  });

  it("offers Allow once, This card and Always for a folder outside the project", async () => {
    const onAnswer = vi.fn();
    const onGrant = vi.fn();
    const pending = { ...base, why: { category: "outside" as const, detail: "~/Downloads isn't in this card's project folder" }, readScope: { directory: "/Users/me/Downloads", token: "~/Downloads" } };
    render(<PermissionActions pending={pending} answered={false} onAnswer={onAnswer} onWait={vi.fn()} onGrant={onGrant} />);
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual(["Allow once", "This card", "Always", "Deny"]);
    await userEvent.click(screen.getByRole("button", { name: "Allow once" }));
    expect(onAnswer).toHaveBeenLastCalledWith(true);
    await userEvent.click(screen.getByRole("button", { name: "This card" }));
    expect(onGrant).toHaveBeenLastCalledWith("card");
    await userEvent.click(screen.getByRole("button", { name: "Always" }));
    expect(onGrant).toHaveBeenLastCalledWith("always");
    await userEvent.click(screen.getByRole("button", { name: "Deny" }));
    expect(onAnswer).toHaveBeenLastCalledWith(false);
  });

  it("is plain Allow and Deny with no holder", () => {
    setup(base);
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual(["Allow", "Deny"]);
  });
});
