import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// lib/billing/admin/route-gate.ts: the front door every admin billing route goes through — the localhost guard, the
// super-admin gate (before anything is read), the service client and the Stripe clients per mode — and adminAnswer,
// which turns an op's result or error into the JSON reply. The admin gate is mocked, so the test pins what the
// route answers to each kind of caller and each kind of error.

const { requireSuperAdminWeft, adminServiceClient } = vi.hoisted(() => ({
  requireSuperAdminWeft: vi.fn(),
  adminServiceClient: vi.fn(),
}));
vi.mock("@/lib/admin", () => ({ requireSuperAdminWeft, adminServiceClient }));

// AdminBillingError stays real: the refusals it carries are part of the contract.
vi.mock("./stripe-keys", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./stripe-keys")>();
  return { ...actual, adminStripe: vi.fn(() => ({ id: "stripe" })) };
});

import { AdminBillingError } from "./stripe-keys";
import { adminAnswer, adminError, adminGate } from "./route-gate";

const SERVICE = { svc: true };

// The gate reads a localhost host and the token header the desktop app sends.
const req = (headers: Record<string, string> = { host: "127.0.0.1:3457", "x-weft-token": "1" }) => new Request("http://127.0.0.1:3457/api/admin/billing", { headers });

beforeEach(() => {
  vi.clearAllMocks();
  requireSuperAdminWeft.mockResolvedValue({ email: "ada@b.co", user: { id: "u1", email: "ada@b.co", name: "Ada", avatar: null, provider: "github" } });
  adminServiceClient.mockResolvedValue(SERVICE);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("adminGate", () => {
  it("lets a super-admin through", async () => {
    const gate = await adminGate(req(), false);
    expect(gate).toEqual({ service: SERVICE, actorEmail: "ada@b.co", stripe: { id: "stripe" } });
  });

  it("refuses a host that isn't this machine", async () => {
    const res = await adminGate(req({ host: "evil.com", "x-weft-token": "1" }), false);
    expect(res).toBeInstanceOf(Response);
    expect((res as Response).status).toBe(403);
    expect(requireSuperAdminWeft).not.toHaveBeenCalled();
  });

  it("refuses a write without the token", async () => {
    const res = await adminGate(req({ host: "127.0.0.1:3457" }), true);
    expect((res as Response).status).toBe(403);
    expect(requireSuperAdminWeft).not.toHaveBeenCalled();
  });

  it("answers 400 when the caller isn't a super-admin", async () => {
    requireSuperAdminWeft.mockRejectedValueOnce(new Error("NEXT_NOT_FOUND"));
    const res = await adminGate(req(), false);
    expect((res as Response).status).toBe(400);
    expect(await (res as Response).json()).toEqual({ error: "NEXT_NOT_FOUND" });
  });

  it("answers 503 when there's no service client", async () => {
    adminServiceClient.mockResolvedValueOnce(null);
    const res = await adminGate(req(), false);
    expect((res as Response).status).toBe(503);
    const body = (await (res as Response).json()) as { error: string };
    expect(body.error).toMatch(/SUPABASE_SECRET_KEY/);
  });

  it("answers 400 when the gate itself throws", async () => {
    requireSuperAdminWeft.mockRejectedValueOnce(new Error("no session"));
    const res = await adminGate(req(), false);
    expect((res as Response).status).toBe(400);
  });
});

describe("adminError", () => {
  it("answers 400 for our own refusal", async () => {
    const res = adminError(new AdminBillingError("No such workspace."));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "No such workspace." });
  });

  it("answers 400 for a Stripe-typed error", async () => {
    const res = adminError(Object.assign(new Error("No such customer"), { type: "StripeInvalidRequestError" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "No such customer" });
  });

  it("answers 500 for anything else", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = adminError(new Error("the disk is on fire"));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "the disk is on fire" });
    expect(error).toHaveBeenCalledWith("Admin billing: the disk is on fire");
    error.mockRestore();
  });

  it("answers 500 for a thrown non-Error", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = adminError("just a string");
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "just a string" });
    expect(error).toHaveBeenCalledWith("Admin billing: just a string");
    error.mockRestore();
  });
});

describe("adminAnswer", () => {
  it("answers the work's result as JSON", async () => {
    const res = await adminAnswer(() => Promise.resolve({ ok: true }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("turns a refusal into a 400", async () => {
    const res = await adminAnswer(() => Promise.reject(new AdminBillingError("No such workspace.")));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "No such workspace." });
  });

  it("turns any other failure into a 500", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await adminAnswer(() => Promise.reject(new Error("boom")));
    expect(res.status).toBe(500);
    error.mockRestore();
  });
});
