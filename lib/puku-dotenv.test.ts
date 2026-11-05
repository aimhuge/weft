import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { PUKU_BASH_ENV, PUKU_SIGN_IN_VARS, pukuDotenvShield } from "./puku-dotenv";

describe("pukuDotenvShield", () => {
  it("blanks every Puku sign-in variable you didn't set, and points puku-cli's Bash at the script that unsets them", () => {
    const env = pukuDotenvShield({}, "/x/puku-bash-env.sh");
    for (const name of PUKU_SIGN_IN_VARS) expect(env[name]).toBe("");
    expect(env.PUKU_CLI_ENV_FILE).toBe("/x/puku-bash-env.sh");
    expect(env).not.toHaveProperty("WEFT_PUKU_ENV_FILE");
  });

  it("leaves a sign-in variable you set yourself alone", () => {
    const env = pukuDotenvShield({ PUKU_AI_API_KEY: "mine" });
    expect(env).not.toHaveProperty("PUKU_AI_API_KEY");
    expect(env.PUKU_AUTH_TOKEN).toBe("");
  });

  it("adds nothing when you set every one of them", () => {
    expect(pukuDotenvShield(Object.fromEntries(PUKU_SIGN_IN_VARS.map((n) => [n, "v"])))).toEqual({});
  });

  it("keeps your own PUKU_CLI_ENV_FILE running after the script", () => {
    expect(pukuDotenvShield({ PUKU_CLI_ENV_FILE: "/me/env.sh" })).toMatchObject({ WEFT_PUKU_ENV_FILE: "/me/env.sh", PUKU_CLI_ENV_FILE: PUKU_BASH_ENV });
  });
});

describe("plugin/env/puku-bash-env.sh", () => {
  const run = (env: Record<string, string>) =>
    execFileSync("/bin/sh", ["-c", `. "${PUKU_BASH_ENV}"; echo "\${PUKU_AI_API_KEY-unset}|\${PUKU_AI_BASE_URL-unset}"`], { env: { ...process.env, ...env }, encoding: "utf8" }).trim();

  it("unsets the blanks, so a project's tools read its own .env", () => {
    expect(run({ PUKU_AI_API_KEY: "", PUKU_AI_BASE_URL: "" })).toBe("unset|unset");
  });

  it("keeps a value that's really set", () => {
    expect(run({ PUKU_AI_API_KEY: "", PUKU_AI_BASE_URL: "https://trial" })).toBe("unset|https://trial");
  });
});
