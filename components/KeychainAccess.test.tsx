// @vitest-environment jsdom
// Settings → Security's Keychain access: the threads with standing access, the audit log newest first,
// the lines a Mac skipped, and where the log is kept.

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuditActivity, VaultGrant } from "@/lib/keychain-audit-view";
import KeychainAccess from "./KeychainAccess";
import "./test-utils";

const access = vi.hoisted(() => ({
  supported: true,
  activity: null as AuditActivity | null,
  record: null as { signedIn: boolean; owner: string | null; entries: unknown[] } | null,
  grants: [] as VaultGrant[],
  error: null as string | null,
  revoke: vi.fn(() => Promise.resolve()),
}));
vi.mock("@/lib/use-keychain-access", () => ({
  useKeychainAccess: () => ({
    supported: access.supported,
    activity: access.activity,
    record: access.record,
    grants: access.grants,
    error: access.error,
    revoke: access.revoke,
    reload: vi.fn(),
  }),
}));

beforeEach(() => {
  access.supported = true;
  access.activity = null;
  access.record = null;
  access.grants = [];
  access.error = null;
  vi.clearAllMocks();
});

afterEach(cleanup);

// A line in the log: a keychain item opened, by you.
const entry = (over: Record<string, unknown> = {}) => ({
  id: "e1",
  at: "2026-10-26T09:15:00.000Z",
  kind: "keychain" as const,
  action: "open",
  outcome: "ok",
  by: "you",
  what: "STRIPE_KEY",
  ...over,
});

describe("KeychainAccess", () => {
  it("says the log lives on the Mac when the shell doesn't have it", () => {
    access.supported = false;
    render(<KeychainAccess />);
    expect(screen.getByText(/The log lives in Weft's desktop app/)).toBeInTheDocument();
    expect(screen.queryByText("Keychain access")).not.toBeNull();
  });

  it("says no thread has standing access when none has", () => {
    render(<KeychainAccess />);
    expect(screen.getByText(/No thread has standing access/)).toBeInTheDocument();
  });

  it("lists the threads with standing access, and takes one back", () => {
    access.grants = [
      { card: "c1", thread: "Fix login", id: "g1", label: "STRIPE_KEY", at: 0, until: Date.now() + 3_600_000 },
      { card: "c2", id: "g2", label: "OPENAI_KEY", at: 0, until: Date.now() + 3_600_000 },
    ];
    render(<KeychainAccess />);
    expect(screen.getByText(/Fix login/)).toBeInTheDocument();
    expect(screen.getByText(/uses STRIPE_KEY/)).toBeInTheDocument();
    // A grant with no thread reads as "A thread".
    expect(screen.getByText(/A thread/)).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "Revoke" })[0]!);
    expect(access.revoke).toHaveBeenCalledWith(access.grants[0]);
  });

  it("shows the error when the log can't be read", () => {
    access.error = "the vault is locked";
    render(<KeychainAccess />);
    expect(screen.getByText("the vault is locked")).toBeInTheDocument();
  });

  it("says so when nothing has happened yet", () => {
    access.activity = { entries: [], waiting: 0, syncedAt: null };
    render(<KeychainAccess />);
    expect(screen.getByText("Nothing yet.")).toBeInTheDocument();
  });

  it("reads a line of the log as a sentence, with its small print", () => {
    access.activity = { entries: [entry({ via: "touch-id", detail: "the panel" })], waiting: 0, syncedAt: null };
    render(<KeychainAccess />);
    expect(screen.getByText(/opened the STRIPE_KEY in the Keychain/)).toBeInTheDocument();
    // The small print says how it was allowed and where the line stands.
    expect(screen.getByText(/Touch ID · waiting on this Mac/)).toBeInTheDocument();
  });

  it("says a denied line was denied, and a failed one failed", () => {
    access.activity = {
      entries: [entry({ id: "e1", outcome: "denied" }), entry({ id: "e2", outcome: "error", detail: "the key was gone" })],
      waiting: 0,
      syncedAt: null,
    };
    render(<KeychainAccess />);
    expect(screen.getByText(/^Denied:/)).toBeInTheDocument();
    expect(screen.getByText(/failed: the key was gone/)).toBeInTheDocument();
  });

  it("says a line that hasn't reached the account yet is waiting", () => {
    access.activity = { entries: [entry({ savedAt: undefined })], waiting: 1, syncedAt: null };
    render(<KeychainAccess />);
    expect(screen.getByText(/waiting on this Mac/)).toBeInTheDocument();
  });

  it("says a line that reached the account late says so", () => {
    access.activity = {
      entries: [entry({ at: "2026-10-26T09:00:00.000Z", savedAt: "2026-10-26T10:00:00.000Z" })],
      waiting: 0,
      syncedAt: null,
    };
    render(<KeychainAccess />);
    expect(screen.getByText(/reached your account 1 h later/)).toBeInTheDocument();
  });

  it("says where the log is kept, and how many lines wait to upload", () => {
    access.activity = { entries: [], waiting: 3, syncedAt: null };
    access.record = { signedIn: false, owner: null, entries: [] };
    render(<KeychainAccess />);
    expect(screen.getByText(/Sign in to Weft to keep this log in your account/)).toBeInTheDocument();
    expect(screen.getByText(/3 waiting to upload/)).toBeInTheDocument();
  });

  it("says the log is kept in the account once you're signed in", () => {
    access.activity = { entries: [], waiting: 0, syncedAt: "2026-10-26T09:00:00.000Z" };
    access.record = { signedIn: true, owner: "Alex", entries: [] };
    render(<KeychainAccess />);
    expect(screen.getByText(/Kept in your Weft account/)).toBeInTheDocument();
  });

  it("shows the lines a Mac skipped under the line they came before", () => {
    access.activity = {
      entries: [entry({ id: "e1", seq: 4, device: "mac" }), entry({ id: "e2", seq: 2, device: "mac" })],
      waiting: 0,
      syncedAt: null,
    };
    render(<KeychainAccess />);
    // Line 2 is the first of its Mac, so the gap is under line 4.
    expect(screen.getByText("1 line from this Mac never reached your account")).toBeInTheDocument();
  });

  it("shows more of the log when you ask for more", () => {
    const entries = Array.from({ length: 45 }, (_, i) => entry({ id: `e${i}`, what: `KEY_${i}` }));
    access.activity = { entries, waiting: 0, syncedAt: null };
    render(<KeychainAccess />);
    // The first page holds forty lines.
    expect(screen.getAllByRole("listitem")).toHaveLength(40);
    fireEvent.click(screen.getByRole("button", { name: "Show more" }));
    expect(screen.getAllByRole("listitem")).toHaveLength(45);
  });

  it("dates a line from another day, not just its time", () => {
    access.activity = { entries: [entry({ at: "2026-10-20T09:15:00.000Z" })], waiting: 0, syncedAt: null };
    render(<KeychainAccess />);
    expect(screen.getByText(/Oct 20/)).toBeInTheDocument();
  });

  it("says a line with no small print of its own", () => {
    access.activity = { entries: [entry({ savedAt: "2026-10-26T09:15:00.000Z" })], waiting: 0, syncedAt: null };
    render(<KeychainAccess />);
    // No via, and it reached the account on time: no small print.
    expect(screen.queryByText(/·/)).toBeNull();
  });

  it("says a gap of no lines under the line it belongs to", () => {
    access.activity = {
      entries: [entry({ id: "e1", seq: 1, device: "mac" })],
      waiting: 0,
      syncedAt: null,
    };
    render(<KeychainAccess />);
    // The only line is the first of its Mac, so there is no gap to say.
    expect(screen.queryByText(/never reached your account/)).toBeNull();
  });

  it("says a line of the vault's own", () => {
    access.activity = { entries: [entry({ id: "v1", kind: "vault", what: "STRIPE_KEY", action: "read" })], waiting: 0, syncedAt: null };
    render(<KeychainAccess />);
    expect(screen.getByText(/You read secrets/)).toBeInTheDocument();
  });
});
