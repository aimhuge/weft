// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { InviteAnswer } from "@/lib/testflight-types";
import { makeCard } from "./test-utils";

const prompt = vi.hoisted(() => ({ usePhonePrompt: vi.fn(), inviteMe: vi.fn() }));
vi.mock("@/lib/use-testflight", () => prompt);

const openExternal = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth/desktop", () => ({ openExternal }));

const { default: PhonePrompt, PhonePromptDialog } = await import("./PhonePrompt");

const URL_ = "https://testflight.apple.com/join/abc";

function setup(props: { invites?: boolean; invite?: () => Promise<InviteAnswer> } = {}) {
  const onClose = vi.fn();
  render(<PhonePromptDialog url={URL_} invites={props.invites ?? true} onClose={onClose} invite={props.invite} />);
  return { onClose };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("PhonePromptDialog", () => {
  it("shows the TestFlight link as a QR code", () => {
    setup();
    expect(screen.getByRole("img", { name: "TestFlight QR code" })).toBeInTheDocument();
    expect(screen.getByText("Weft on your phone")).toBeInTheDocument();
  });

  it("opens the link in the browser", async () => {
    setup();
    await userEvent.click(screen.getByRole("button", { name: "open the link" }));
    expect(openExternal).toHaveBeenCalledWith(URL_);
  });

  it("offers the invite button and 'Not now' when invites are on", async () => {
    const { onClose } = setup();
    expect(screen.getByRole("button", { name: "Email me an invite" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("without invites there is no invite button and the close reads Done", async () => {
    const { onClose } = setup({ invites: false });
    expect(screen.queryByRole("button", { name: "Email me an invite" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Not now" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("sends the invite and says where Apple is sending it", async () => {
    const invite = vi.fn().mockResolvedValue({ ok: true, email: "me@example.com", already: false });
    setup({ invite });
    await userEvent.click(screen.getByRole("button", { name: "Email me an invite" }));
    expect(invite).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(/Apple is sending your invite to/)).toBeInTheDocument();
    expect(screen.getByText("me@example.com")).toBeInTheDocument();
    expect(screen.getByText(/Open it on your iPhone\./)).toBeInTheDocument();
    // The invite button is gone and the close now reads Done.
    expect(screen.queryByRole("button", { name: "Email me an invite" })).toBeNull();
    expect(screen.getByRole("button", { name: "Done" })).toBeInTheDocument();
  });

  it("says so when the person was already on the beta list", async () => {
    setup({ invite: () => Promise.resolve({ ok: true, email: "me@example.com", already: true }) });
    await userEvent.click(screen.getByRole("button", { name: "Email me an invite" }));
    expect(await screen.findByText(/You're already on the beta list as/)).toBeInTheDocument();
    expect(screen.getByText("me@example.com")).toBeInTheDocument();
    expect(screen.getByText(/Look for Apple's TestFlight email, or scan the code\./)).toBeInTheDocument();
  });

  it("shows the error and keeps the button so it can be retried", async () => {
    const invite = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, error: "Apple said no." })
      .mockResolvedValueOnce({ ok: true, email: "me@example.com", already: false });
    setup({ invite });
    await userEvent.click(screen.getByRole("button", { name: "Email me an invite" }));
    expect(await screen.findByText(/Couldn't send the invite: Apple said no\./)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Not now" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Email me an invite" })).toBeEnabled());
    await userEvent.click(screen.getByRole("button", { name: "Email me an invite" }));
    expect(await screen.findByText(/Apple is sending your invite to/)).toBeInTheDocument();
    expect(screen.queryByText(/Couldn't send the invite/)).toBeNull();
  });

  it("disables the button while the invite is out", async () => {
    let release!: (a: InviteAnswer) => void;
    setup({ invite: () => new Promise<InviteAnswer>((res) => (release = res)) });
    await userEvent.click(screen.getByRole("button", { name: "Email me an invite" }));
    expect(screen.getByRole("button", { name: "Email me an invite" })).toBeDisabled();
    release({ ok: true, email: "me@example.com", already: false });
    expect(await screen.findByText(/Apple is sending your invite to/)).toBeInTheDocument();
  });

  it("uses the real inviteMe by default", async () => {
    prompt.inviteMe.mockResolvedValue({ ok: true, email: "me@example.com", already: false });
    setup();
    await userEvent.click(screen.getByRole("button", { name: "Email me an invite" }));
    expect(prompt.inviteMe).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(/Apple is sending your invite to/)).toBeInTheDocument();
  });
});

describe("PhonePrompt", () => {
  it("draws nothing without a link", () => {
    prompt.usePhonePrompt.mockReturnValue({ url: null, invites: false, close: vi.fn() });
    const { container } = render(<PhonePrompt cards={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("counts the finished threads for the hook and shows the dialog with its close", async () => {
    const close = vi.fn();
    prompt.usePhonePrompt.mockReturnValue({ url: URL_, invites: true, close });
    const cards = [makeCard({ id: "a", column: "review" }), makeCard({ id: "b", column: "done" }), makeCard({ id: "c", column: "running" })];
    render(<PhonePrompt cards={cards} />);
    expect(prompt.usePhonePrompt).toHaveBeenCalledWith(2);
    expect(screen.getByRole("img", { name: "TestFlight QR code" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(close).toHaveBeenCalledTimes(1);
  });
});
