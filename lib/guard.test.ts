import { beforeEach, describe, expect, it, vi } from "vitest";
import { elevated, fail, guard } from "./guard";

const token = vi.hoisted(() => ({ value: "" }));
vi.mock("./shell-token", () => ({ shellToken: () => token.value }));
beforeEach(() => {
  token.value = "";
});

const req = (headers: Record<string, string>) => new Request("http://x/api", { headers });

describe("guard", () => {
  it("lets localhost hosts through with the write header", () => {
    for (const host of ["127.0.0.1:3456", "localhost:3456", "localhost", "[::1]:3456"]) {
      expect(guard(req({ host, "x-weft-token": "1" }))).toBeNull();
    }
  });

  it("rejects other hosts with 403, even with the header", async () => {
    for (const host of ["evil.com", "evil.com:3456", "127.0.0.1.evil.com", "localhost.evil.com:80", "0.0.0.0:3456", ""]) {
      const res = guard(req({ host, "x-weft-token": "1" }));
      expect(res?.status, host).toBe(403);
      expect(((await res!.json()) as { error: string }).error).toBe("Forbidden host");
    }
  });

  it("requires x-weft-token: 1 for writes", async () => {
    const res = guard(req({ host: "localhost:3456" }));
    expect(res?.status).toBe(403);
    expect(((await res!.json()) as { error: string }).error).toBe("Missing x-weft-token header");
    expect(guard(req({ host: "localhost:3456", "x-weft-token": "0" }))?.status).toBe(403);
    expect(guard(req({ host: "localhost:3456", "x-weft-token": "true" }))?.status).toBe(403);
  });

  it("does not need the header for reads", () => {
    expect(guard(req({ host: "localhost:3456" }), { write: false })).toBeNull();
  });

  it("still checks the host for reads", () => {
    expect(guard(req({ host: "evil.com" }), { write: false })?.status).toBe(403);
  });
});

// A read that names no token used to pass on the Host header alone, so any process that reached the port could
// read the board: project paths, the profile, and the names of the secrets in the vault. Once the desktop app
// has launched a token, a read needs it.
describe("guard reads with the launch token", () => {
  const read = (headers: Record<string, string>) => guard(req({ host: "localhost:3456", ...headers }), { write: false });

  it("needs the token (or the board's own 1) once the desktop has one", async () => {
    token.value = "secret-token";
    const res = read({});
    expect(res?.status).toBe(403);
    expect(((await res!.json()) as { error: string }).error).toBe("Missing token");
    expect(read({ "x-weft-token": "wrong-token!" })?.status).toBe(403);
    expect(read({ "x-weft-token": "secret-token" })).toBeNull();
    // The board window sends 1 and Electron swaps it for the launch token, so this is the board's own path.
    expect(read({ "x-weft-token": "1" })).toBeNull();
  });

  it("asks nothing where there is no token (a browser, tests)", () => {
    expect(read({})).toBeNull();
    expect(read({ "x-weft-token": "1" })).toBeNull();
  });

  it("still checks the host first", () => {
    token.value = "secret-token";
    expect(guard(req({ host: "evil.com" }), { write: false })?.status).toBe(403);
  });
});

describe("fail", () => {
  it("wraps an Error message with a 400 by default", async () => {
    const res = fail(new Error("boom"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "boom" });
  });

  it("stringifies other values and honors the status", async () => {
    const res = fail("nope", 500);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "nope" });
  });
});

describe("guard without a Host header", () => {
  it("treats a missing Host as foreign", async () => {
    const res = guard(new Request("http://x/api"), { write: false });
    expect(res?.status).toBe(403);
    expect(await res!.json()).toEqual({ error: "Forbidden host" });
  });
});

describe("guard writes with the launch token", () => {
  const write = (headers: Record<string, string>) => guard(req({ host: "localhost:3456", ...headers }));

  it("accepts the launch token in place of 1, and nothing else", () => {
    token.value = "secret-token";
    expect(write({ "x-weft-token": "secret-token" })).toBeNull();
    expect(write({ "x-weft-token": "wrong-token!" })?.status).toBe(403);
  });

  it("does not take an arbitrary value where there is no token", () => {
    expect(write({ "x-weft-token": "secret-token" })?.status).toBe(403);
  });
});

describe("elevated writes", () => {
  const send = (headers: Record<string, string>) => elevated(req({ host: "localhost:3456", ...headers }));

  it("refuses the plain 1 a thread's curl sends once the desktop has a token", async () => {
    token.value = "secret-token";
    const res = send({ "x-weft-token": "1" });
    expect(res?.status).toBe(403);
    expect(((await res!.json()) as { error: string }).error).toBe("This change needs Weft's own window");
    expect(send({ "x-weft-token": "secret-token" })).toBeNull();
  });

  it("takes 1 where there is no token (a browser, tests)", () => {
    expect(send({ "x-weft-token": "1" })).toBeNull();
  });

  it("still checks the host and the header first", () => {
    token.value = "t";
    expect(elevated(req({ host: "evil.com", "x-weft-token": "t" }))?.status).toBe(403);
    expect(send({})?.status).toBe(403);
  });
});
