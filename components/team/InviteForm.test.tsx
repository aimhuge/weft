// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { InviteForm, typedLogin, type RoleOption } from "./InviteForm";
import type { TeamActionResult, TeamClientActions, TeamRole } from "@/lib/team-types";
import "../test-utils";

const roleOptions: RoleOption[] = [
  { role: "owner", label: "Owner", description: "Full control." },
  { role: "admin", label: "Admin", description: "Manage the workspace." },
  { role: "member", label: "Member", description: "View and publish." },
];

function makeActions(): TeamClientActions & {
  invite: ReturnType<typeof vi.fn<(email: string, role: TeamRole) => Promise<TeamActionResult>>>;
} {
  return {
    invite: vi.fn<(email: string, role: TeamRole) => Promise<TeamActionResult>>().mockResolvedValue({ ok: true, message: "ok" }),
    changeRole: vi.fn<(userId: string, role: TeamRole) => Promise<TeamActionResult>>().mockResolvedValue({ ok: true }),
    remove: vi.fn<(userId: string) => Promise<TeamActionResult>>().mockResolvedValue({ ok: true }),
    revoke: vi.fn<(inviteId: string) => Promise<TeamActionResult>>().mockResolvedValue({ ok: true }),
    addProject: vi.fn<(repo: string) => Promise<TeamActionResult>>().mockResolvedValue({ ok: true }),
    removeProject: vi.fn<(repo: string) => Promise<TeamActionResult>>().mockResolvedValue({ ok: true }),
    setProjectAccess: vi.fn<(repo: string, userId: string, grant: boolean) => Promise<TeamActionResult>>().mockResolvedValue({ ok: true }),
    createTeam: vi.fn<(name: string) => Promise<TeamActionResult & { slug?: string }>>().mockResolvedValue({ ok: true }),
    renameTeam: vi.fn().mockResolvedValue({ ok: true }),
    deleteTeam: vi.fn().mockResolvedValue({ ok: true }),
  };
}

let actions: ReturnType<typeof makeActions>;

beforeEach(() => {
  actions = makeActions();
});

describe("InviteForm", () => {
  it("shows the role select with the first option pre-picked, plus its description", () => {
    render(<InviteForm roleOptions={roleOptions} actions={actions} />);
    expect(screen.getByRole("combobox", { name: "Role" })).toHaveValue("owner");
    expect(screen.getByText("Full control.")).toBeInTheDocument();
  });

  it("updates the description when the role select changes", async () => {
    render(<InviteForm roleOptions={roleOptions} actions={actions} />);
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Role" }), "admin");
    expect(screen.getByText("Manage the workspace.")).toBeInTheDocument();
  });

  it("disables the submit button until an email is entered", async () => {
    render(<InviteForm roleOptions={roleOptions} actions={actions} />);
    expect(screen.getByRole("button", { name: "Send invite" })).toBeDisabled();
    await userEvent.type(screen.getByRole("textbox", { name: "Email" }), "ada@b.co");
    expect(screen.getByRole("button", { name: "Send invite" })).toBeEnabled();
  });

  it("submits the email and role through actions.invite and shows a success message", async () => {
    actions.invite.mockImplementationOnce((email: string) =>
      Promise.resolve({ ok: true, message: `Invite sent to ${email}` }),
    );
    render(<InviteForm roleOptions={roleOptions} actions={actions} />);
    await userEvent.type(screen.getByRole("textbox", { name: "Email" }), "ada@b.co");
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Role" }), "admin");
    await userEvent.click(screen.getByRole("button", { name: "Send invite" }));
    await waitFor(() => expect(actions.invite).toHaveBeenCalled());
    expect(actions.invite).toHaveBeenCalledWith("ada@b.co", "admin");
    expect(await screen.findByText("Invite sent to ada@b.co")).toBeInTheDocument();
  });

  it("clears the email after a successful invite but keeps the role", async () => {
    actions.invite.mockResolvedValueOnce({ ok: true, message: "Sent." });
    render(<InviteForm roleOptions={roleOptions} actions={actions} />);
    await userEvent.type(screen.getByRole("textbox", { name: "Email" }), "ada@b.co");
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Role" }), "admin");
    await userEvent.click(screen.getByRole("button", { name: "Send invite" }));
    await waitFor(() => expect(screen.getByText("Sent.")).toBeInTheDocument());
    expect(screen.getByRole("textbox", { name: "Email" })).toHaveValue("");
    expect(screen.getByRole("combobox", { name: "Role" })).toHaveValue("admin");
  });

  it("shows the action's error message when the email is invalid", async () => {
    actions.invite.mockResolvedValueOnce({ ok: false, message: "Enter a valid email address." });
    render(<InviteForm roleOptions={roleOptions} actions={actions} />);
    await userEvent.type(screen.getByRole("textbox", { name: "Email" }), "not-an-email");
    await userEvent.click(screen.getByRole("button", { name: "Send invite" }));
    expect(await screen.findByText("Enter a valid email address.")).toBeInTheDocument();
  });

  it("disables both inputs and the submit while pending", async () => {
    let resolve!: (value: { ok: boolean; message?: string }) => void;
    actions.invite.mockImplementationOnce(() => new Promise<{ ok: boolean; message?: string }>((r) => (resolve = r)));
    render(<InviteForm roleOptions={roleOptions} actions={actions} />);
    await userEvent.type(screen.getByRole("textbox", { name: "Email" }), "ada@b.co");
    await userEvent.click(screen.getByRole("button", { name: "Send invite" }));
    expect(screen.getByRole("button", { name: /Sending|Send invite/ })).toBeDisabled();
    expect(screen.getByRole("textbox", { name: "Email" })).toBeDisabled();
    expect(screen.getByRole("combobox", { name: "Role" })).toBeDisabled();
    resolve({ ok: true, message: "Sent." });
  });
});
describe("typedLogin", () => {
  it("reads @ada or a bare ada as a GitHub login", () => {
    expect(typedLogin("@ada")).toBe("ada");
    expect(typedLogin("  ada ")).toBe("ada");
  });

  it("leaves emails, blanks, spaces and a lone @ alone", () => {
    expect(typedLogin("ada@b.co")).toBeNull();
    expect(typedLogin("")).toBeNull();
    expect(typedLogin("   ")).toBeNull();
    expect(typedLogin("ada lovelace")).toBeNull();
    expect(typedLogin("@")).toBeNull();
  });
});

describe("InviteForm with resolveLogin", () => {
  const field = () => screen.getByRole("textbox", { name: "Email or @GitHub login" });

  it("labels the field for an email or an @login", () => {
    render(<InviteForm roleOptions={roleOptions} actions={actions} resolveLogin={vi.fn()} />);
    expect(field()).toHaveAttribute("placeholder", "@login or teammate@example.com");
    expect(screen.queryByRole("textbox", { name: "Email" })).not.toBeInTheDocument();
  });

  it("resolves an @login and invites the email it finds", async () => {
    const resolveLogin = vi.fn().mockResolvedValue("ada@b.co");
    render(<InviteForm roleOptions={roleOptions} defaultRole="member" actions={actions} resolveLogin={resolveLogin} />);
    await userEvent.type(field(), "@ada");
    await userEvent.click(screen.getByRole("button", { name: "Send invite" }));
    await waitFor(() => expect(actions.invite).toHaveBeenCalledWith("ada@b.co", "member"));
    expect(resolveLogin).toHaveBeenCalledWith("ada");
  });

  it("says so and doesn't invite when the login hides its email", async () => {
    const resolveLogin = vi.fn().mockResolvedValue(null);
    render(<InviteForm roleOptions={roleOptions} actions={actions} resolveLogin={resolveLogin} />);
    await userEvent.type(field(), "@ada");
    await userEvent.click(screen.getByRole("button", { name: "Send invite" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("@ada hides their email on GitHub. Type their email instead.");
    expect(actions.invite).not.toHaveBeenCalled();
    expect(field()).toHaveValue("@ada");
  });

  it("invites an email directly without looking anything up", async () => {
    const resolveLogin = vi.fn();
    render(<InviteForm roleOptions={roleOptions} actions={actions} resolveLogin={resolveLogin} />);
    await userEvent.type(field(), "grace@b.co");
    await userEvent.click(screen.getByRole("button", { name: "Send invite" }));
    await waitFor(() => expect(actions.invite).toHaveBeenCalledWith("grace@b.co", "owner"));
    expect(resolveLogin).not.toHaveBeenCalled();
  });
});

describe("InviteForm without resolveLogin", () => {
  it("labels the field Email and invites a bare word as typed", async () => {
    render(<InviteForm roleOptions={roleOptions} actions={actions} />);
    expect(screen.getByRole("textbox", { name: "Email" })).toHaveAttribute("type", "email");
    await userEvent.type(screen.getByRole("textbox", { name: "Email" }), "@ada");
    await userEvent.click(screen.getByRole("button", { name: "Send invite" }));
    await waitFor(() => expect(actions.invite).toHaveBeenCalledWith("@ada", "owner"));
  });
});
