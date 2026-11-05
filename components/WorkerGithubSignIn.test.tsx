// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import "./test-utils";
import WorkerGithubSignIn, { githubLine } from "./WorkerGithubSignIn";

const TOKEN = `github_pat_${"a".repeat(30)}`;

describe("githubLine", () => {
  it("names the account, an expired sign-in and no sign-in", () => {
    expect(githubLine({ githubAccount: "octocat", githubState: "signed_in" })).toEqual({ text: "GitHub: octocat", warn: false });
    expect(githubLine({ githubAccount: "octocat", githubState: "expired" })).toEqual({ text: "GitHub sign-in expired (octocat)", warn: true });
    expect(githubLine({ githubAccount: null, githubState: "expired" })).toEqual({ text: "GitHub sign-in expired", warn: true });
    expect(githubLine({ githubAccount: null, githubState: "none" })).toEqual({ text: "Not signed in to GitHub", warn: false });
    expect(githubLine({ githubAccount: null, githubState: null })).toBeNull();
  });
});

describe("WorkerGithubSignIn", () => {
  async function open(send = vi.fn(() => Promise.resolve({ status: "done" as const, error: null }))) {
    const user = userEvent.setup();
    render(<WorkerGithubSignIn name="m1mini" state="none" send={send} />);
    await user.click(screen.getByRole("button", { name: "Sign in to GitHub" }));
    return { user, send };
  }

  it("links to a token with the least scope, and says every card can use it", async () => {
    await open();
    const href = screen.getByRole("link", { name: "Make a token on GitHub" }).getAttribute("href") ?? "";
    expect(href).toContain("github.com/settings/personal-access-tokens/new?");
    expect(href).toContain("contents=write");
    expect(href).toContain("expires_in=90");
    expect(screen.getByText(/every card on m1mini can use it/)).toBeInTheDocument();
  });

  it("sends a token and returns to the button when it worked", async () => {
    const { user, send } = await open();
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
    await user.type(screen.getByLabelText("GitHub token for m1mini"), `${TOKEN}{Enter}`);
    expect(send).toHaveBeenCalledWith(TOKEN);
    expect(await screen.findByRole("button", { name: "Sign in to GitHub" })).toBeInTheDocument();
  });

  it("shows the worker's real failure and keeps the field", async () => {
    const send = vi.fn(() => Promise.reject(new Error("GitHub refused that token.")));
    const { user } = await open(send);
    await user.type(screen.getByLabelText("GitHub token for m1mini"), TOKEN);
    await user.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByText("GitHub refused that token.")).toBeInTheDocument();
    expect(screen.getByLabelText("GitHub token for m1mini")).toHaveValue(TOKEN);
  });

  it("says when an offline worker has it queued", async () => {
    const { user } = await open(vi.fn(() => Promise.resolve({ status: "pending", error: null })) as never);
    await user.type(screen.getByLabelText("GitHub token for m1mini"), `${TOKEN}{Enter}`);
    expect(await screen.findByText(/signs in when it's back online/)).toBeInTheDocument();
  });

  it("offers to sign in again when it has expired, and to change an account", () => {
    const { rerender } = render(<WorkerGithubSignIn name="m1mini" state="expired" send={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Sign in to GitHub again" })).toBeInTheDocument();
    rerender(<WorkerGithubSignIn name="m1mini" state="signed_in" send={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Change GitHub" })).toBeInTheDocument();
  });

  it("cancels back to the button", async () => {
    const { user } = await open();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("button", { name: "Sign in to GitHub" })).toBeInTheDocument();
  });
});
