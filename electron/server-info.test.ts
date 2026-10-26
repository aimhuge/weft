// The server accessor (electron/server-info.cjs): the one place that hands the local server's
// url and the launch token to the modules that need them.
//
// The test covers the thing that actually matters: the accessor reads fresh, because the server
// may not be up when main wires these modules, and the token is the one main holds.

import { describe, expect, it } from "vitest";
import { serverInfo } from "./server-info.cjs";

describe("serverInfo", () => {
  it("answers with the url and the token when the server is up", () => {
    const info = serverInfo(() => ({ url: "http://127.0.0.1:1024" }), "tok");
    expect(info()).toEqual({ url: "http://127.0.0.1:1024", token: "tok" });
  });

  it("answers with null when the server isn't up yet", () => {
    const info = serverInfo(() => null, "tok");
    expect(info()).toBeNull();
  });

  it("reads the server fresh on each call", () => {
    let server: { url: string } | null = null;
    const info = serverInfo(() => server, "tok");
    expect(info()).toBeNull();
    server = { url: "http://127.0.0.1:1024" };
    expect(info()).toEqual({ url: "http://127.0.0.1:1024", token: "tok" });
  });
});
