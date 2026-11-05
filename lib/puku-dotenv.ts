import path from "node:path";
import { PLUGIN_DIR } from "./skills";

// Why a puku thread said "Not logged in" in one project while `puku-cli auth status` said you were logged in:
// puku-cli is a Bun binary, and Bun loads the .env files of the folder it starts in. A project that calls Puku's
// API itself keeps PUKU_AI_API_KEY in its .env.local, and puku-cli takes that app key as its sign-in, ahead of
// your login. Bun leaves a variable that's already set alone, even a blank one, so a puku thread starts with each
// sign-in variable you didn't set yourself as blank. The blank would reach the thread's Bash too, where Next and
// dotenv also keep a set-but-empty variable, so plugin/env/puku-bash-env.sh (PUKU_CLI_ENV_FILE, which puku-cli
// sources before each Bash command) unsets them again.
export const PUKU_SIGN_IN_VARS = ["PUKU_AI_API_KEY", "PUKU_API_KEY", "PUKU_AUTH_TOKEN", "PUKU_CLI_OAUTH_TOKEN", "PUKU_AI_BASE_URL", "PUKU_BASE_URL"] as const;
export const PUKU_BASH_ENV = path.join(PLUGIN_DIR, "env", "puku-bash-env.sh");

export function pukuDotenvShield(env: Partial<Record<string, string>> = process.env, bashEnv = PUKU_BASH_ENV): Record<string, string> {
  const blanks = Object.fromEntries(PUKU_SIGN_IN_VARS.filter((name) => !env[name]).map((name) => [name, ""]));
  if (!Object.keys(blanks).length) return {};
  // The script sources your own env file after it, so one you had keeps working.
  const own: Record<string, string> = env.PUKU_CLI_ENV_FILE ? { WEFT_PUKU_ENV_FILE: env.PUKU_CLI_ENV_FILE } : {};
  return { ...blanks, ...own, PUKU_CLI_ENV_FILE: bashEnv };
}
