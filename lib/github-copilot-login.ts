import { copilotSessionDefaults, githubCopilotClient } from "./github-copilot-client";
import { addCallback, emit, failRun, isCurrent, newRun, succeed } from "./login";
import { errMessage } from "./login-output";
import type { LoginView } from "./types";

export async function signInGitHubCopilot(signal: AbortSignal, showCode: (url: string, code: string) => void) {
  const client = await githubCopilotClient();
  const stop = () => { void client.forceStop().catch(() => {}); };
  signal.addEventListener("abort", stop, { once: true });
  const deadline = setTimeout(stop, 10 * 60_000);
  try {
    signal.throwIfAborted();
    await client.start();
    if ((await client.getAuthStatus()).isAuthenticated) return;
    const session = await client.createSession(copilotSessionDefaults);
    const login = session.rpc.accounts.login;
    const { flowId, step } = await login.begin({ kind: "githubDotCom", method: "device-code" });
    if (step.kind !== "device-code") throw new Error(step.kind === "error" ? step.message : "GitHub did not return a device code.");
    const uri = new URL(step.verificationUri);
    if (uri.origin !== "https://github.com" || uri.pathname !== "/login/device") {
      throw new Error("GitHub returned an unexpected sign-in address.");
    }
    signal.throwIfAborted();
    showCode(uri.href, step.userCode);
    const result = await login.advance({ flowId });
    if (result.kind !== "completed") {
      throw new Error(result.kind === "error" ? result.message : `GitHub Copilot sign-in stopped at ${result.kind}.`);
    }
    if (result.result.status === "needs-plaintext-consent") {
      throw new Error("GitHub authorized the device, but Copilot could not save the login in the system credential store.");
    }
    if (result.result.status !== "completed") {
      throw new Error(`GitHub Copilot sign-in did not complete (${result.result.status}).`);
    }
    if (!(await client.getAuthStatus()).isAuthenticated) throw new Error("GitHub Copilot still reports signed out.");
  } finally {
    clearTimeout(deadline);
    signal.removeEventListener("abort", stop);
    await client.forceStop();
  }
}

export function startCopilotLogin(onDone?: () => void): LoginView {
  const run = newRun("github-copilot", "running", onDone);
  const abort = new AbortController();
  run.abort = abort;
  const clearCode = () => {
    delete run.view.url;
    delete run.view.userCode;
  };
  const current = () => isCurrent(run) && run.view.state === "running" && !abort.signal.aborted;
  abort.signal.addEventListener("abort", clearCode, { once: true });
  emit(run);
  void signInGitHubCopilot(abort.signal, (url, code) => {
    if (!current()) return;
    run.view.url = url;
    run.view.userCode = code;
    emit(run);
  }).then(() => {
    if (!current()) return;
    clearCode();
    succeed(run);
  }, (error: unknown) => {
    if (!current()) return;
    clearCode();
    failRun(run, errMessage(error));
  });
  return addCallback(run);
}
