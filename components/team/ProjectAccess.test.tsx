// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { TeamClientActions, TeamMember } from "@/lib/team-types";
import "../test-utils";
import { ProjectAccess, accessLabel } from "./ProjectAccess";

const project = { repo: "aimhuge/weft", addedAt: "t", addedBy: null, access: ["m1"] };
const member = (userId: string, role: TeamMember["role"], name: string | null, email: string | null): TeamMember => ({
  userId,
  role,
  name,
  email,
  joinedAt: "t",
});
const owner = member("o1", "owner", "Olive", "o@x.com");
const members = [owner, member("m1", "member", "Max", "max@x.com"), member("m2", "member", null, "mo@x.com")];

function actions(setProjectAccess = vi.fn().mockResolvedValue({ ok: true })) {
  return { setProjectAccess } as unknown as TeamClientActions & { setProjectAccess: typeof setProjectAccess };
}

describe("ProjectAccess", () => {
  it("labels the count of members granted", () => {
    expect(accessLabel(1, 2)).toBe("Access · 1 of 2");
  });

  it("renders nothing when the team has no plain members", () => {
    const { container } = render(<ProjectAccess project={project} members={[owner]} actions={actions()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("opens a checklist of members only, ticked by their grants", async () => {
    render(<ProjectAccess project={project} members={members} actions={actions()} />);
    await userEvent.click(screen.getByRole("button", { name: "Access · 1 of 2" }));
    expect(screen.getByRole("checkbox", { name: /Max/ })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /mo@x.com/ })).not.toBeChecked();
    expect(screen.queryByText("Olive")).not.toBeInTheDocument();
    expect(screen.getByText("Owners and admins see every project.")).toBeInTheDocument();
  });

  it("grants and takes away access, updating the count", async () => {
    const a = actions();
    render(<ProjectAccess project={project} members={members} actions={a} />);
    await userEvent.click(screen.getByRole("button", { name: "Access · 1 of 2" }));
    await userEvent.click(screen.getByRole("checkbox", { name: /mo@x.com/ }));
    await waitFor(() => expect(a.setProjectAccess).toHaveBeenCalledWith("aimhuge/weft", "m2", true));
    expect(screen.getByRole("button", { name: "Access · 2 of 2" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("checkbox", { name: /Max/ }));
    await waitFor(() => expect(a.setProjectAccess).toHaveBeenCalledWith("aimhuge/weft", "m1", false));
  });

  it("puts the tick back and says why when the change is refused", async () => {
    const a = actions(vi.fn().mockResolvedValue({ ok: false, message: "Not allowed." }));
    render(<ProjectAccess project={project} members={members} actions={a} />);
    await userEvent.click(screen.getByRole("button", { name: /Access/ }));
    await userEvent.click(screen.getByRole("checkbox", { name: /mo@x.com/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Not allowed.");
    expect(screen.getByRole("checkbox", { name: /mo@x.com/ })).not.toBeChecked();
  });

  it("falls back to a generic error and a placeholder name", async () => {
    const a = actions(vi.fn().mockResolvedValue({ ok: false }));
    render(<ProjectAccess project={project} members={[member("m3", "member", null, null)]} actions={a} />);
    await userEvent.click(screen.getByRole("button", { name: /Access/ }));
    await userEvent.click(screen.getByRole("checkbox", { name: "Unnamed member" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't change access.");
  });
});
