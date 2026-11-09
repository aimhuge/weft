// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AccountView } from "@/lib/types";
import "./test-utils";
import AccountSettings from "./AccountSettings";

const api = vi.hoisted(() => ({
  account: vi.fn<() => Promise<AccountView>>(),
  signIn: vi.fn(() => Promise.resolve({ url: "https://github.com/login/oauth" })),
  magicLink: vi.fn(() => Promise.resolve({ ok: true })),
  signOut: vi.fn(() => Promise.resolve({ ok: true })),
  billingStatus: vi.fn(() => Promise.resolve(null)),
}));
vi.mock("@/lib/client", () => ({ api }));

const ada = { id: "u1", email: "ada@b.co", name: "Ada", avatar: null, provider: "github" };
const openExternal = vi.fn();

function setup() {
  render(<AccountSettings titleClass="" hintClass="" />);
}

beforeEach(() => {
  vi.clearAllMocks();
  window.weft = { openExternal } as unknown as typeof window.weft;
});

describe("AccountSettings", () => {
  it("says when sign-in isn't set up", async () => {
    api.account.mockResolvedValue({ configured: false, user: null });
    setup();
    expect(await screen.findByText(/isn.t set up in this build/)).toBeInTheDocument();
  });

  it("shows a load error", async () => {
    api.account.mockRejectedValue(new Error("server down"));
    setup();
    expect(await screen.findByText(/server down/)).toBeInTheDocument();
  });

  it("opens the provider in the system browser, then shows you once signed in", async () => {
    api.account.mockResolvedValue({ configured: true, user: null });
    setup();
    await userEvent.click(await screen.findByRole("button", { name: "Continue with GitHub" }));
    expect(api.signIn).toHaveBeenCalledWith("github", "/");
    expect(openExternal).toHaveBeenCalledWith("https://github.com/login/oauth");
    expect(screen.getByText(/Finish signing in with GitHub/)).toBeInTheDocument();

    api.account.mockResolvedValue({ configured: true, user: ada });
    expect(await screen.findByText("Ada", {}, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.getByText("ada@b.co · via GitHub")).toBeInTheDocument();
  });

  it("emails a magic link", async () => {
    api.account.mockResolvedValue({ configured: true, user: null });
    setup();
    await userEvent.type(await screen.findByLabelText("Email for a sign-in link"), "ada@b.co");
    await userEvent.click(screen.getByRole("button", { name: "Email me a link" }));
    expect(api.magicLink).toHaveBeenCalledWith("ada@b.co");
    expect(screen.getByText(/Sent a link to ada@b.co/)).toBeInTheDocument();
  });

  it("shows a sign-in error", async () => {
    api.account.mockResolvedValue({ configured: true, user: null });
    api.signIn.mockRejectedValueOnce(new Error("GitHub is off"));
    setup();
    await userEvent.click(await screen.findByRole("button", { name: "Continue with GitHub" }));
    expect(await screen.findByText("GitHub is off")).toBeInTheDocument();
    expect(openExternal).not.toHaveBeenCalled();
  });

  it("signs out", async () => {
    api.account.mockResolvedValue({ configured: true, user: { ...ada, name: null } });
    setup();
    expect(await screen.findByText("ada@b.co")).toBeInTheDocument();
    api.account.mockResolvedValue({ configured: true, user: null });
    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(api.signOut).toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole("button", { name: "Continue with GitHub" })).toBeInTheDocument());
  });
});
