// A worker CLI session's connector env (lib/connector-env.ts): the socket, a capability, gh's folder first on PATH and
// git's helper list, and nothing at all on a box with no connector.
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MAX_CAPS, cardForCap, helperCommand, setConnectorSetup, withConnectorEnv, type ConnectorSetup } from "./connector-env";

const KEY = "credential.https://github.com.helper";
const SETUP: ConnectorSetup = { socket: "/h/connector.sock", node: "/usr/bin/node", helper: "/w/scripts/weft-connector-helper.cjs", binDir: "/w/scripts/worker-bin", boxHelpers: ["!gh auth git-credential", "store"] };

afterEach(() => setConnectorSetup(null));

describe("withConnectorEnv", () => {
  it("leaves the env alone with no setup", () => {
    const env = { PATH: "/usr/bin" };
    expect(withConnectorEnv(env, () => "c1")).toBe(env);
  });

  it("adds the socket, a capability, the helper and gh's folder", () => {
    setConnectorSetup(SETUP);
    const out = withConnectorEnv({ PATH: "/usr/bin", KEEP: "1" }, () => "c1");
    expect(out).toMatchObject({ KEEP: "1", WEFT_CONNECTOR_SOCKET: SETUP.socket, WEFT_CONNECTOR_NODE: SETUP.node, WEFT_CONNECTOR_HELPER: SETUP.helper, PATH: ["/w/scripts/worker-bin", "/usr/bin"].join(path.delimiter) });
    expect(out.WEFT_CONNECTOR_CAP).toMatch(/^[0-9a-f]{48}$/);
    expect(out).toMatchObject({
      GIT_CONFIG_COUNT: "4",
      GIT_CONFIG_KEY_0: KEY,
      GIT_CONFIG_VALUE_0: "",
      GIT_CONFIG_KEY_1: KEY,
      GIT_CONFIG_VALUE_1: helperCommand(SETUP),
      GIT_CONFIG_KEY_2: KEY,
      GIT_CONFIG_VALUE_2: "!gh auth git-credential",
      GIT_CONFIG_KEY_3: KEY,
      GIT_CONFIG_VALUE_3: "store",
    });
  });

  it("puts its entries after the env's own git config, and makes a PATH when there was none", () => {
    setConnectorSetup({ ...SETUP, boxHelpers: [] });
    const out = withConnectorEnv({ GIT_CONFIG_COUNT: "2", GIT_CONFIG_KEY_0: "a", GIT_CONFIG_KEY_1: "b" }, () => "c1");
    expect(out).toMatchObject({ GIT_CONFIG_COUNT: "4", GIT_CONFIG_KEY_0: "a", GIT_CONFIG_KEY_1: "b", GIT_CONFIG_KEY_2: KEY, GIT_CONFIG_VALUE_2: "", GIT_CONFIG_VALUE_3: helperCommand(SETUP) });
    expect(out.GIT_CONFIG_KEY_4).toBeUndefined();
    expect(out.PATH).toBe("/w/scripts/worker-bin");
    expect(withConnectorEnv({ GIT_CONFIG_COUNT: "junk" }, () => "c1").GIT_CONFIG_COUNT).toBe("2");
  });
});

describe("cardForCap", () => {
  it("finds the session's card when asked, not when the env was made", () => {
    setConnectorSetup(SETUP);
    const ref: { card?: string } = {};
    const cap = withConnectorEnv({}, () => ref.card).WEFT_CONNECTOR_CAP;
    expect(cardForCap(cap)).toBeUndefined();
    ref.card = "c9";
    expect(cardForCap(cap)).toBe("c9");
    expect(cardForCap("nope")).toBeUndefined();
    expect(cardForCap(42)).toBeUndefined();
    setConnectorSetup(null);
    expect(cardForCap(cap)).toBeUndefined();
  });

  it("lets the oldest capability go past MAX_CAPS", () => {
    setConnectorSetup(SETUP);
    const first = withConnectorEnv({}, () => "first").WEFT_CONNECTOR_CAP;
    for (let i = 0; i < MAX_CAPS - 1; i++) withConnectorEnv({}, () => "x");
    expect(cardForCap(first)).toBe("first");
    const last = withConnectorEnv({}, () => "last").WEFT_CONNECTOR_CAP;
    expect(cardForCap(first)).toBeUndefined();
    expect(cardForCap(last)).toBe("last");
  });
});

describe("helperCommand", () => {
  it("quotes the paths and clears NODE_OPTIONS and NODE_PATH", () => {
    expect(helperCommand({ node: "/a b/node", helper: '/x/"$`\\.cjs' })).toBe('!/usr/bin/env -u NODE_OPTIONS -u NODE_PATH "/a b/node" "/x/\\"\\$\\`\\\\.cjs" git-credential');
  });
});
