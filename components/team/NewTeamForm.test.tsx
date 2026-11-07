// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { TeamClientActions } from "@/lib/team-types";
import "../test-utils";
import { NewTeamForm } from "./NewTeamForm";

function setup(result: Awaited<ReturnType<TeamClientActions["createTeam"]>>) {
  const actions = { createTeam: vi.fn().mockResolvedValue(result) } as unknown as TeamClientActions;
  const onCreated = vi.fn();
  const onCancel = vi.fn();
  render(<NewTeamForm actions={actions} onCreated={onCreated} onCancel={onCancel} />);
  return { actions, onCreated, onCancel };
}

describe("NewTeamForm", () => {
  it("creates the team and hands over its slug", async () => {
    const { actions, onCreated } = setup({ ok: true, slug: "new-co" });
    expect(screen.getByRole("button", { name: "Create" })).toBeDisabled();
    await userEvent.type(screen.getByLabelText("Team name"), "  New Co ");
    await userEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith("new-co"));
    expect(actions.createTeam).toHaveBeenCalledWith("New Co", undefined);
  });

  it("offers your GitHub orgs: a pick fills the name, keeps it editable and sends the org as the slug", async () => {
    const actions = { createTeam: vi.fn().mockResolvedValue({ ok: true, slug: "exitingcom" }) } as unknown as TeamClientActions;
    const onCreated = vi.fn();
    render(<NewTeamForm actions={actions} orgs={[{ login: "Exitingcom", avatarUrl: "" }, { login: "aimhuge", avatarUrl: "a.png" }]} onCreated={onCreated} onCancel={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Exitingcom" }));
    expect(screen.getByRole("button", { name: "Exitingcom" })).toHaveAttribute("aria-pressed", "true");
    const field = screen.getByLabelText("Team name");
    expect(field).toHaveValue("Exitingcom");
    await userEvent.clear(field);
    await userEvent.type(field, "Exiting.com");
    await userEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith("exitingcom"));
    expect(actions.createTeam).toHaveBeenCalledWith("Exiting.com", "Exitingcom");
  });

  it("creates from an org pick left as it is, and a second click on the pick unpicks it", async () => {
    const actions = { createTeam: vi.fn().mockResolvedValue({ ok: true, slug: "acme" }) } as unknown as TeamClientActions;
    render(<NewTeamForm actions={actions} orgs={[{ login: "acme", avatarUrl: "" }]} onCreated={vi.fn()} onCancel={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "acme" }));
    await userEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(actions.createTeam).toHaveBeenCalledWith("acme", "acme"));
    await userEvent.click(screen.getByRole("button", { name: "acme" }));
    expect(screen.getByLabelText("Team name")).toHaveValue("");
  });

  it("shows the failure message and stays open", async () => {
    const { onCreated } = setup({ ok: false, message: "Name taken." });
    await userEvent.type(screen.getByLabelText("Team name"), "X{Enter}");
    expect(await screen.findByRole("alert")).toHaveTextContent("Name taken.");
    expect(onCreated).not.toHaveBeenCalled();
  });

  it("reads a yes without a slug as a failure, since there's nothing to switch to", async () => {
    const { onCreated } = setup({ ok: true, message: "Odd." });
    await userEvent.type(screen.getByLabelText("Team name"), "X{Enter}");
    expect(await screen.findByRole("alert")).toHaveTextContent("Odd.");
    expect(onCreated).not.toHaveBeenCalled();
  });

  it("falls back to a default message", async () => {
    setup({ ok: false });
    await userEvent.type(screen.getByLabelText("Team name"), "X{Enter}");
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't create the team.");
  });

  it("Cancel and Escape close it", async () => {
    const { onCancel } = setup({ ok: true });
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await userEvent.type(screen.getByLabelText("Team name"), "{Escape}");
    expect(onCancel).toHaveBeenCalledTimes(2);
  });
});
