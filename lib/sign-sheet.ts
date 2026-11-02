// The approval sheet on sign.weft.zip (docs/architecture/mobile-security.md, "Passkey approvals"), drawn with plain DOM
// so the page needs no framework and no inline script. Everything it shows comes out of the message the passkey signs
// (SignAsk.signed): the decision, the tool, the folder, the card, and the whole input with invisible characters and
// long blank runs marked (lib/passkey-display.ts). Allow stays off until a long input has been scrolled to its end.
import { displayInput, displayPieces, inputStats } from "./passkey-display";
import type { SignAsk } from "./sign-approve";

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// A page with a title and one line of text: loading, a refusal, done.
export function showNote(root: HTMLElement, title: string, text: string, warn = false) {
  root.replaceChildren(el("h1", "", title), el("p", warn ? "warn" : "muted", text));
}

function inputBlock(input: Record<string, unknown>): HTMLPreElement {
  const pre = el("pre", "input");
  pre.setAttribute("aria-label", "Everything it signs");
  pre.tabIndex = 0;
  for (const piece of displayPieces(displayInput(input))) pre.append("mark" in piece ? el("span", "mark", piece.mark) : document.createTextNode(piece.text));
  return pre;
}

// Whether the user has seen the end of the input: always, when it fits.
const seenEnd = (pre: HTMLElement) => pre.scrollHeight <= pre.clientHeight + 2 || pre.scrollTop + pre.clientHeight >= pre.scrollHeight - 2;

export function showSheet(root: HTMLElement, ask: SignAsk, actions: { sign: () => Promise<string | null>; cancel: () => void }) {
  const { signed } = ask;
  const what = el("div", "what");
  what.append(
    el("div", "head", `${signed.decision === "allow" ? "Allow" : "Deny"} ${signed.tool}`),
    el("div", "meta", `In ${signed.folder ?? "an unnamed folder"} · card ${signed.card}`),
    el("div", "meta", inputStats(signed.input)),
  );
  const pre = inputBlock(signed.input);
  what.append(pre);
  const error = el("p", "warn");
  error.setAttribute("role", "alert");
  error.hidden = true;
  const hint = el("p", "muted", "Scroll to the end of the request to allow it.");
  const allow = el("button", "primary", "Allow with Touch ID");
  const cancel = el("button", "", "Cancel");
  const row = el("div", "row");
  row.append(cancel, allow);
  root.replaceChildren(el("h1", "", "Approve on your Mac"), el("p", "muted", "Your passkey signs exactly this, all of it, and your Mac checks it before it runs:"), what, hint, error, row);

  const update = () => {
    const seen = seenEnd(pre);
    allow.disabled = !seen;
    hint.hidden = seen;
  };
  pre.addEventListener("scroll", update);
  update();
  cancel.addEventListener("click", () => actions.cancel());
  allow.addEventListener("click", () => {
    allow.disabled = true;
    allow.textContent = "Waiting for Touch ID…";
    error.hidden = true;
    void actions.sign().then((problem) => {
      if (!problem) return;
      allow.textContent = "Allow with Touch ID";
      error.textContent = problem;
      error.hidden = false;
      update();
    });
  });
}
