// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TeamClientActions } from "@/lib/team-types";
import "../test-utils";
import { Projects } from "./Projects";

const projects = [{ repo: "aimhuge/weft", addedAt: "2026-10-01T00:00:00.000Z", addedBy: null, access: [] }];

function actions(over: Partial<TeamClientActions> = {}): TeamClientActions {
  return {
    addProject: vi.fn().mockResolvedValue({ ok: true }),
    removeProject: vi.fn().mockResolvedValue({ ok: true }),
    ...over,
  } as unknown as TeamClientActions;
}

function view(a: TeamClientActions, props: Partial<Parameters<typeof Projects>[0]> = {}) {
  return render(
    <Projects projects={projects} canManage actions={a} boardRepos={["aimhuge/weft", "aimhuge/other"]} {...props} />,
  );
}

afterEach(() => vi.restoreAllMocks());

describe("Projects", () => {
  it("suggests only board repos not yet linked and adds the pick", async () => {
    const a = actions();
    const { container } = view(a);
    const suggestions = [...container.querySelectorAll("datalist option")].map((o) => o.getAttribute("value"));
    expect(suggestions).toEqual(["aimhuge/other"]);
    const field = screen.getByLabelText("GitHub repo");
    expect(field).toHaveAttribute("placeholder", "aimhuge/other, or any owner/name");
    await userEvent.type(field, "aimhuge/other");
    await userEvent.click(screen.getByRole("button", { name: "Add project" }));
    await waitFor(() => expect(a.addProject).toHaveBeenCalledWith("aimhuge/other"));
    expect(await screen.findByRole("status")).toHaveTextContent("Added aimhuge/other.");
  });

  it("validates a typed repo and accepts a GitHub URL", async () => {
    const a = actions();
    view(a, { boardRepos: [] });
    expect(screen.getByLabelText("GitHub repo")).toHaveAttribute("placeholder", "owner/name, like aimhuge/weft");
    await userEvent.type(screen.getByLabelText("GitHub repo"), "nope");
    await userEvent.click(screen.getByRole("button", { name: "Add project" }));
    expect(screen.getByRole("alert")).toHaveTextContent("owner/name");
    expect(a.addProject).not.toHaveBeenCalled();
    await userEvent.clear(screen.getByLabelText("GitHub repo"));
    await userEvent.type(screen.getByLabelText("GitHub repo"), "https://github.com/a/b.git");
    await userEvent.click(screen.getByRole("button", { name: "Add project" }));
    await waitFor(() => expect(a.addProject).toHaveBeenCalledWith("a/b"));
  });

  it("shows a failed add's message", async () => {
    view(actions({ addProject: vi.fn().mockResolvedValue({ ok: false }) }), { boardRepos: [] });
    await userEvent.type(screen.getByLabelText("GitHub repo"), "a/b");
    await userEvent.click(screen.getByRole("button", { name: "Add project" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't add the project.");
  });

  it("removes after a confirm, and not when declined", async () => {
    const a = actions();
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    view(a);
    await userEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(a.removeProject).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(a.removeProject).toHaveBeenCalledWith("aimhuge/weft"));
    expect(confirm).toHaveBeenCalledTimes(2);
    // Unlinking stops new Macs joining the vault but can't take keys back: the confirm says so, and how to.
    expect(confirm).toHaveBeenCalledWith(expect.stringMatching(/keep its keys.*Rotate shared vaults/));
  });

  it("shows a failed remove's message", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    view(actions({ removeProject: vi.fn().mockResolvedValue({ ok: false, message: "Not allowed." }) }));
    await userEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Not allowed.");
  });

  it("members see the list only; an empty list says so", () => {
    view(actions(), { canManage: false });
    expect(screen.getByRole("link", { name: "aimhuge/weft" })).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("tells a member with no granted projects so", () => {
    view(actions(), { canManage: false, projects: [] });
    expect(screen.getByText("No projects shared with you yet.")).toBeInTheDocument();
  });

  it("empty list for managers invites an add", () => {
    view(actions(), { projects: [] });
    expect(screen.getByText(/No projects yet/)).toBeInTheDocument();
  });

  it("shows each project's cards on this board, and nothing for none", () => {
    view(actions(), { projects: [...projects, { ...projects[0]!, repo: "a/b" }, { ...projects[0]!, repo: "a/c" }], cards: { "aimhuge/weft": 12, "a/b": 1 } });
    expect(screen.getByText("12 cards")).toBeInTheDocument();
    expect(screen.getByText("1 card")).toBeInTheDocument();
    expect(screen.getAllByText(/cards?$/)).toHaveLength(2);
  });
});
