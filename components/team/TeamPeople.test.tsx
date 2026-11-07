// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { TeamClientActions, TeamMember, TeamSnapshot } from "@/lib/team-types";
import "../test-utils";
import { TeamPeople } from "./TeamPeople";

const projectPeople = vi.fn();
vi.mock("./ProjectPeople", () => ({
  ProjectPeople: (props: { repos: string[]; org?: string }) => {
    projectPeople(props);
    return <div data-testid="project-people">{`${props.repos.join(",")}|${props.org ?? ""}`}</div>;
  },
}));

const member = (userId: string, role: TeamMember["role"], over: Partial<TeamMember> = {}): TeamMember => ({
  userId,
  role,
  name: null,
  email: null,
  joinedAt: "2026-10-01T00:00:00.000Z",
  ...over,
});

const roleLabels = { owner: "Owner", admin: "Admin", member: "Member" };
const roleOptions = [{ role: "member" as const, label: "Member", description: "View and publish." }];
const invite = (id: string, email: string) => ({ id, email, role: "member" as const, createdAt: "2026-10-01T00:00:00.000Z", expiresAt: "2026-12-01T00:00:00.000Z" });

function snapshot(over: Partial<TeamSnapshot> = {}): TeamSnapshot {
  return {
    user: { id: "u1", email: "ada@x.co", name: "Ada", avatar: null },
    org: { id: "o1", slug: "acme", name: "Acme" },
    role: "owner",
    orgs: [],
    canManage: true,
    members: [
      member("u1", "owner", { login: "ada", name: "Ada", email: "ada@x.co" }),
      member("u2", "member", { name: "Grace", email: "grace@x.co" }),
      member("u3", "member", { email: "linus@x.co" }),
    ],
    pending: [],
    projects: [],
    roleOptions,
    roleLabels,
    ...over,
  };
}

const actions = { invite: vi.fn().mockResolvedValue({ ok: true }), revoke: vi.fn() } as unknown as TeamClientActions;

const view = (team: TeamSnapshot, githubOrg: string | null = null) =>
  render(<TeamPeople team={team} actions={actions} roleOptions={roleOptions} githubOrg={githubOrg} />);

describe("TeamPeople", () => {
  it("lists members by @login with a GitHub avatar, else by name or email with an initial", () => {
    const { container } = view(snapshot());
    const people = screen.getByRole("list", { name: "People" });
    expect(people).toHaveTextContent("@ada");
    const img = container.querySelector("img");
    expect(img).toHaveAttribute("src", "https://github.com/ada.png?size=40");
    expect(container.querySelectorAll("img")).toHaveLength(1);
    const grace = screen.getByText("Grace").closest("li")!;
    expect(grace).toHaveTextContent(/^GGrace$/);
    expect(grace).toHaveAttribute("title", "grace@x.co");
    expect(screen.getByText("linus@x.co").closest("li")).toHaveTextContent(/^Llinus@x\.co$/);
  });

  it("marks you and the owner", () => {
    view(snapshot());
    expect(screen.getByText("(you, owner)")).toBeInTheDocument();
    view(snapshot({ user: { id: "u2", email: null, name: null, avatar: null } }));
    expect(screen.getByText("(owner)")).toBeInTheDocument();
    expect(screen.getByText("(you)")).toBeInTheDocument();
  });

  it("counts pending invites", () => {
    view(snapshot({ pending: [invite("i1", "a@x.co"), invite("i2", "b@x.co")] }));
    expect(screen.getByText("2 invited")).toBeInTheDocument();
  });

  it("shows no count without pending invites", () => {
    view(snapshot());
    expect(screen.queryByText(/invited/)).not.toBeInTheDocument();
  });

  it("offers Invite… only to those who manage the team", () => {
    view(snapshot({ canManage: false }));
    expect(screen.queryByRole("button", { name: "Invite…" })).not.toBeInTheDocument();
  });

  it("opens the invite form, the GitHub suggestions and the pending invites", async () => {
    const projects = [{ repo: "acme/app", addedAt: "t", addedBy: null, access: [] }];
    view(snapshot({ projects, pending: [invite("i1", "pending@x.co")] }), "acme");
    const button = screen.getByRole("button", { name: "Invite…" });
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("button", { name: "Send invite" })).not.toBeInTheDocument();
    await userEvent.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: "Send invite" })).toBeInTheDocument();
    expect(screen.getByTestId("project-people")).toHaveTextContent("acme/app|acme");
    expect(screen.getByText("pending@x.co")).toBeInTheDocument();
    await userEvent.click(button);
    expect(screen.queryByRole("button", { name: "Send invite" })).not.toBeInTheDocument();
  });

  it("suggests from the GitHub org alone when the team has no projects", async () => {
    view(snapshot(), "acme");
    await userEvent.click(screen.getByRole("button", { name: "Invite…" }));
    expect(screen.getByTestId("project-people")).toHaveTextContent("|acme");
  });

  it("leaves the suggestions out with no projects and no GitHub org", async () => {
    view(snapshot());
    await userEvent.click(screen.getByRole("button", { name: "Invite…" }));
    expect(screen.getByRole("button", { name: "Send invite" })).toBeInTheDocument();
    expect(screen.queryByTestId("project-people")).not.toBeInTheDocument();
  });
});
