// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GrantOutcome, ShareGrant } from "@/lib/share-grant-types";

// The ask before a mention lets someone into a shared card, and the line after it, with the grants API and team faked.

const grantApi = vi.hoisted(() => ({ list: vi.fn(), grant: vi.fn(), revoke: vi.fn(), people: vi.fn() }));
const loadTeam = vi.hoisted(() => vi.fn());
vi.mock("@/lib/share-grant-client", () => ({ grantApi }));
vi.mock("@/lib/team-cache", () => ({ loadTeam }));

const { MentionAskBar, useMentionSend } = await import("./MentionAsk");

const grant = (login: string): ShareGrant => ({ githubId: 7, login, via: "mention", createdAt: "", notifiedAt: null, openedAt: null });

afterEach(cleanup);

beforeEach(() => {
  Object.values(grantApi).forEach((fn) => fn.mockReset());
  loadTeam.mockReset().mockResolvedValue({ kind: "ok", team: { members: [{ login: "me", name: "Me" }] } });
  grantApi.list.mockResolvedValue({ shareId: "s1", grants: [{ ...grant("ada") }] });
});

function Harness({ shareId = "s1", enabled = true, onSend }: { shareId?: string | null; enabled?: boolean; onSend: (t: string) => Promise<void> }) {
  const card = { id: "c1", share: shareId ? { id: shareId, mode: "public" as const, hasPassword: false, url: "https://weft.zip/s/s1" } : undefined };
  const { send, bar } = useMentionSend(card, onSend, enabled);
  return (
    <div>
      {bar}
      <button type="button" onClick={() => void send(document.querySelector("input")?.value ?? "")}>send</button>
      <input defaultValue="" />
    </div>
  );
}

function type(text: string) {
  fireEvent.change(document.querySelector("input") as HTMLInputElement, { target: { value: text } });
  fireEvent.click(screen.getByText("send"));
}

describe("useMentionSend", () => {
  it("asks before a new mention lets someone in, grants on yes, then sends", async () => {
    const onSend = vi.fn().mockResolvedValue(undefined);
    grantApi.grant.mockResolvedValue([{ login: "octo", ok: true, grant: grant("octo"), notice: "no-email" }] satisfies GrantOutcome[]);
    render(<Harness onSend={onSend} />);
    type("hey @octo and @ada and @me, look");
    expect(await screen.findByText(/Give @octo access/)).toBeTruthy();
    expect(onSend).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Give access & send"));
    await waitFor(() => expect(onSend).toHaveBeenCalledWith("hey @octo and @ada and @me, look"));
    expect(grantApi.grant).toHaveBeenCalledWith("c1", { logins: ["octo"], via: "mention", note: "hey @octo and @ada and @me, look" });
    expect(await screen.findByText(/no email is on file/)).toBeTruthy();
    // Already in now: the next mention goes straight out.
    type("@octo again");
    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByLabelText("Dismiss"));
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("sends without granting on no, and doesn't ask again", async () => {
    const onSend = vi.fn().mockResolvedValue(undefined);
    render(<Harness onSend={onSend} />);
    type("@octo hi");
    fireEvent.click(await screen.findByText("Send without"));
    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1));
    expect(grantApi.grant).not.toHaveBeenCalled();
    type("@octo hi again");
    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(2));
    expect(screen.queryByText(/Give @octo/)).toBeNull();
  });

  it("shows a grant that failed, and still sends", async () => {
    const onSend = vi.fn().mockResolvedValue(undefined);
    grantApi.grant.mockRejectedValue(new Error("offline"));
    render(<Harness onSend={onSend} />);
    type("@octo");
    fireEvent.click(await screen.findByText("Give access & send"));
    expect(await screen.findByText("@octo: offline")).toBeTruthy();
    expect(onSend).toHaveBeenCalled();
  });

  it("never asks off a share, when off, with no @, or when it can't tell who's in", async () => {
    const onSend = vi.fn().mockResolvedValue(undefined);
    const { unmount } = render(<Harness shareId={null} onSend={onSend} />);
    type("@octo");
    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1));
    unmount();
    const second = render(<Harness enabled={false} onSend={onSend} />);
    type("@octo");
    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(2));
    second.unmount();
    grantApi.list.mockRejectedValue(new Error("down"));
    render(<Harness onSend={onSend} />);
    type("no mentions");
    type("@octo");
    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(4));
    expect(grantApi.grant).not.toHaveBeenCalled();
  });
});

describe("MentionAskBar", () => {
  it("says who was emailed and who failed", () => {
    render(
      <MentionAskBar
        ask={null}
        url={null}
        onDismiss={() => {}}
        outcomes={[
          { login: "ada", ok: true, grant: grant("ada"), notice: "emailed" },
          { login: "bob", ok: false, error: "No GitHub user @bob." },
        ]}
      />,
    );
    expect(screen.getByText("@ada can open it and got an email.")).toBeTruthy();
    expect(screen.getByText("@bob: No GitHub user @bob.")).toBeTruthy();
  });

  it("draws nothing with nothing to say", () => {
    const { container } = render(<MentionAskBar ask={null} outcomes={null} url={null} onDismiss={() => {}} />);
    expect(container.textContent).toBe("");
  });

  it("answers the ask", () => {
    const answer = vi.fn();
    render(<MentionAskBar ask={{ logins: ["a", "b"], answer }} outcomes={null} url={null} onDismiss={() => {}} />);
    expect(screen.getByText(/Give @a, @b access/)).toBeTruthy();
    fireEvent.click(screen.getByText("Send without"));
    expect(answer).toHaveBeenCalledWith(false);
  });
});
