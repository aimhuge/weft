// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { VaultConflict, VaultSecret } from "@/lib/vault-view";
import "./test-utils";
import { ConflictBanner, SecretRow } from "./SecretRow";

// A secret's row and the conflict banner on it (docs/architecture/teams-vault.md, "Push on change" and
// "What the 🔐 drawer shows"). The banner says who wrote the row and offers the two ways out; it never
// shows a value, and a row the server still holds as a blank shows no banner at all.

const secret = (over: Partial<VaultSecret> = {}): VaultSecret => ({
  name: "API_KEY",
  environment: "development",
  missing: false,
  tail: "1111",
  updatedAt: "2026-10-27T00:00:00.000Z",
  ...over,
});

const conflict = (over: Partial<VaultConflict> = {}): VaultConflict => ({
  name: "API_KEY",
  environment: "development",
  actor: "Sam",
  rowVersion: 4,
  blank: false,
  ...over,
});

describe("the conflict banner", () => {
  it("names who changed the secret, which one, and in which environment", () => {
    render(<ConflictBanner conflict={conflict()} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Sam changed API_KEY in development — keep your edit?");
  });

  it("offers the two ways out", async () => {
    const onKeepMine = vi.fn();
    const onKeepTheirs = vi.fn();
    render(<ConflictBanner conflict={conflict()} onKeepMine={onKeepMine} onKeepTheirs={onKeepTheirs} />);
    await userEvent.click(screen.getByRole("button", { name: "Keep your edit" }));
    await userEvent.click(screen.getByRole("button", { name: "Keep theirs" }));
    expect(onKeepMine).toHaveBeenCalledTimes(1);
    expect(onKeepTheirs).toHaveBeenCalledTimes(1);
  });

  it("shows nothing for a row the server still holds as a blank: the drawer keeps the new value silently", () => {
    const { container } = render(<ConflictBanner conflict={conflict({ blank: true })} />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("never shows a value, not even a tail", () => {
    const { container } = render(<ConflictBanner conflict={conflict()} />);
    expect(container.textContent).not.toContain("1111");
    expect(container.textContent).not.toContain("sk-");
  });
});

describe("SecretRow", () => {
  it("shows no banner when there is no conflict", () => {
    render(<SecretRow secret={secret()} value={undefined} spread={false} onAct={vi.fn()} onMenu={vi.fn()} />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows the banner on the secret that has the conflict, and not on another one", () => {
    const { rerender } = render(<SecretRow secret={secret()} value={undefined} spread={false} onAct={vi.fn()} onMenu={vi.fn()} />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    rerender(
      <SecretRow
        secret={secret()}
        value={undefined}
        spread={false}
        onAct={vi.fn()}
        onMenu={vi.fn()}
        conflict={conflict()}
        onKeepMine={vi.fn()}
        onKeepTheirs={vi.fn()}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Sam changed API_KEY in development — keep your edit?");
  });

  it("wires the banner's buttons to the two ways out", async () => {
    const onKeepMine = vi.fn();
    const onKeepTheirs = vi.fn();
    render(
      <SecretRow
        secret={secret()}
        value={undefined}
        spread={false}
        onAct={vi.fn()}
        onMenu={vi.fn()}
        conflict={conflict()}
        onKeepMine={onKeepMine}
        onKeepTheirs={onKeepTheirs}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Keep your edit" }));
    await userEvent.click(screen.getByRole("button", { name: "Keep theirs" }));
    expect(onKeepMine).toHaveBeenCalledTimes(1);
    expect(onKeepTheirs).toHaveBeenCalledTimes(1);
  });

  it("keeps the row's own behaviour: the name, the masked tail, and the hover actions", () => {
    render(<SecretRow secret={secret()} value={undefined} spread={false} onAct={vi.fn()} onMenu={vi.fn()} conflict={conflict()} />);
    expect(screen.getByText("API_KEY")).toBeInTheDocument();
    expect(screen.getByText("••••1111")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reveal API_KEY" })).toBeInTheDocument();
  });
});
