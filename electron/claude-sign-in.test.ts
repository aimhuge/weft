import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { besideClick, pastedCode, signInEnv, tokenIn, urlIn } = require("./claude-sign-in.cjs") as typeof import("./claude-sign-in.cjs");

const TOKEN = ["sk-ant", "oat01", "AbCdEfGhIjKlMnOpQrStUvWxYz_0123456789-xyz"].join("-");

describe("tokenIn", () => {
  it("finds the token in the CLI's colored output", () => {
    expect(tokenIn(`\x1b[32m✓ Long-lived token created\x1b[0m\n\x1b[1m${TOKEN}\x1b[22m\nStore this token securely.`)).toBe(TOKEN);
  });

  it("finds nothing before the token is printed", () => {
    expect(tokenIn("Paste code here if prompted > ")).toBeNull();
    expect(tokenIn("sk-ant-api03-short")).toBeNull();
  });
});

describe("urlIn", () => {
  it("finds Claude's approval URL and stops at whitespace", () => {
    const url = "https://claude.ai/oauth/authorize?code=true&client_id=abc&state=xyz";
    expect(urlIn(`Browser didn't open? Use the url below to sign in\n\x1b[2m${url}\x1b[0m  \n`)).toBe(url);
  });

  it("ignores other links", () => {
    expect(urlIn("see https://evil.example/oauth/authorize?x=1")).toBeNull();
  });

  it("reads the claude.com/cai URL newer CLIs print inside an OSC 8 link", () => {
    const url = "https://claude.com/cai/oauth/authorize?code=true&client_id=abc&state=xyz";
    expect(urlIn(`Use the url below to sign in\r\r\n\x1b]8;id=1a;${url}\x07${url}\x1b]8;;\x07\r\r\n`)).toBe(url);
  });
});

describe("pastedCode", () => {
  it("reads code#state off Claude's code page", () => {
    expect(pastedCode("https://console.anthropic.com/oauth/code/callback?code=C0DE&state=ST8")).toBe("C0DE#ST8");
  });

  it("leaves the CLI's own localhost callback alone, and a page with no code", () => {
    expect(pastedCode("http://localhost:54545/callback?code=C&state=S")).toBeNull();
    expect(pastedCode("https://claude.ai/oauth/authorize?code=true")).toBeNull();
    expect(pastedCode("https://console.anthropic.com/oauth/code/callback?code=C")).toBeNull();
    expect(pastedCode("not a url")).toBeNull();
  });
});

describe("signInEnv", () => {
  it("drops what a Claude session would lend it and points BROWSER at the script", () => {
    const env = signInEnv({ HOME: "/h", PATH: "/bin", CLAUDECODE: "1", CLAUDE_CODE_OAUTH_TOKEN: "x", ANTHROPIC_BASE_URL: "http://proxy" }, "/t/open-url", "/t/url");
    expect(env).toEqual({ HOME: "/h", PATH: "/bin", BROWSER: "/t/open-url", WEFT_SIGN_IN_URL_FILE: "/t/url", TERM: "xterm-256color" });
  });
});

describe("besideClick", () => {
  const work = { x: 0, y: 25, width: 1280, height: 775 };
  const size = { width: 480, height: 720 };

  it("sits to the right of the click when it fits, pulled up to stay on screen", () => {
    expect(besideClick({ x: 300, y: 400 }, work, size)).toEqual({ x: 316, y: 80 });
    expect(besideClick({ x: 300, y: 60 }, work, { width: 480, height: 400 })).toEqual({ x: 316, y: 25 });
  });

  it("flips to the left near the screen's right edge, and stays on screen", () => {
    expect(besideClick({ x: 1100, y: 100 }, work, size)).toEqual({ x: 604, y: 25 });
    expect(besideClick({ x: 200, y: 400 }, { x: 0, y: 0, width: 600, height: 800 }, size).x).toBe(0);
  });
});
