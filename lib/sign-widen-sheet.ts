// The widening sheet on sign.weft.zip (docs/architecture/project-hosts.md#signed-widening-as-built): plain DOM, like the
// answer's sheet (lib/sign-sheet.ts). Everything it shows comes out of what the passkey signs: the change in words, the
// host, the card, and the whole change as JSON with invisible characters and long blank runs marked
// (lib/passkey-display.ts). Approve stays off until a long change has been scrolled to its end.
import { displayInput, displayPieces } from "./passkey-display";
import type { WidenToSign } from "./sign-widen";
import { widenLabel } from "./widen";

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const seenEnd = (pre: HTMLElement) => pre.scrollHeight <= pre.clientHeight + 2 || pre.scrollTop + pre.clientHeight >= pre.scrollHeight - 2;

export function showWidenSheet(root: HTMLElement, w: WidenToSign, actions: { sign: () => Promise<string | null>; cancel: () => void }) {
  const what = el("div", "what");
  const where = w.target.device.startsWith("worker:") ? `worker ${w.host}` : `Mac ${w.host.slice(0, 12)}`;
  const card = w.card ? `“${w.card.title}” in ${w.card.folder}` : `card ${w.target.cardId}`;
  const at = typeof w.args.at === "number" ? ` · sent ${new Date(w.args.at).toLocaleString()}` : "";
  what.append(el("div", "head", widenLabel(w.change)), el("div", "meta", `${card} · on ${where}${at}`), el("div", "meta", `${w.verb} · ${w.target.cardId}`));
  const pre = el("pre", "input");
  pre.setAttribute("aria-label", "Everything it signs");
  pre.tabIndex = 0;
  // The args it sends, whole: rebuilt from the change (lib/sign-widen.ts argsFromChange), so nothing else rides along.
  const shown = Object.fromEntries(Object.entries(w.args).filter(([key]) => key !== "id"));
  for (const piece of displayPieces(displayInput(shown))) pre.append("mark" in piece ? el("span", "mark", piece.mark) : document.createTextNode(piece.text));
  what.append(pre);
  const error = el("p", "warn");
  error.setAttribute("role", "alert");
  error.hidden = true;
  const hint = el("p", "muted", "Scroll to the end of the change to approve it.");
  const approve = el("button", "primary", "Approve with Touch ID");
  const cancel = el("button", "", "Cancel");
  const row = el("div", "row");
  row.append(cancel, approve);
  root.replaceChildren(el("h1", "", "Approve a change"), el("p", "muted", "Your passkey signs exactly this change, for this card on this host, once, for two minutes:"), what, hint, error, row);
  const update = () => {
    const seen = seenEnd(pre);
    approve.disabled = !seen;
    hint.hidden = seen;
  };
  pre.addEventListener("scroll", update);
  update();
  cancel.addEventListener("click", () => actions.cancel());
  approve.addEventListener("click", () => {
    approve.disabled = true;
    approve.textContent = "Waiting for Touch ID…";
    error.hidden = true;
    void actions.sign().then((problem) => {
      if (!problem) return;
      approve.textContent = "Approve with Touch ID";
      error.textContent = problem;
      error.hidden = false;
      update();
    });
  });
}
