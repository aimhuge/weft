// sign.weft.zip's script (lib/sign-origin.ts): bundled by scripts/build-sign.mjs into public/sign/app.js and loaded by
// public/sign/pair.html and approve.html. Its own Supabase session (signed in on this origin; nothing is handed over
// from weft.zip), its own passkey (rp id sign.weft.zip), and the pages' only code. The logic lives in lib/ and is
// tested there; this file only wires it to the two pages.
import { createClient } from "@supabase/supabase-js";
import { parsePairingLink } from "../lib/pairing-link";
import { passkeyCode } from "../lib/passkey-code";
import { askIds, loadAsk, sendApproval } from "../lib/sign-approve";
import { showNote, showSheet } from "../lib/sign-sheet";
import { loadWidenCard, sendWiden, widenAskOf, widenToSign } from "../lib/sign-widen";
import { showWidenSheet } from "../lib/sign-widen-sheet";
import { SUPABASE_KEY, SUPABASE_URL } from "../lib/supabase-project";
import { createPasskey, signWithPasskey } from "../lib/web-passkey";
import { browserPasskey, pairThisBrowser } from "../lib/web-sync-key";

const LINK_KEY = "weft-sign-pair-link";
// The ask's ids, kept across a sign-in: the redirect comes back to the bare path (Supabase's redirect URLs list exactly
// /pair and /approve).
const ASK_KEY = "weft-sign-ask";
const root = document.getElementById("app") as HTMLElement;
const client = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { flowType: "pkce", persistSession: true, detectSessionInUrl: true, storageKey: "weft-sign" } });

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

function button(label: string, primary: boolean, onClick: () => void): HTMLButtonElement {
  const b = document.createElement("button");
  b.textContent = label;
  if (primary) b.className = "primary";
  b.addEventListener("click", onClick);
  return b;
}

function askSignIn(title: string) {
  showNote(root, title, "Sign in with the account your Mac uses. This page keeps its own session: weft.zip never hands one over.");
  const row = document.createElement("div");
  row.className = "row";
  row.append(button("Continue with GitHub", true, () => void client.auth.signInWithOAuth({ provider: "github", options: { redirectTo: `${window.location.origin}${window.location.pathname}` } })));
  root.append(row);
}

function pairPage(user: { id: string; name: string }) {
  const link = sessionStorage.getItem(LINK_KEY);
  if (!link || !parsePairingLink(link)) {
    showNote(root, "Pair a passkey", "This page needs the whole link from Settings → Sync → Pair a passkey on your Mac.", true);
    return;
  }
  showNote(root, "Pair a passkey with your Mac", "This makes a passkey for sign.weft.zip (Touch ID), so this browser can approve tool runs. Your Mac asks for Touch ID too before it trusts it.");
  const row = document.createElement("div");
  row.className = "row";
  row.append(
    button("Make a passkey and pair", true, () => {
      void (async () => {
        try {
          const passkey = await createPasskey({ id: user.id, name: user.name }, window.location.hostname);
          if (!passkey) {
            showNote(root, "No passkey", "This browser couldn't make a passkey, so it can't approve. Try Safari or Chrome on a Mac with Touch ID.", true);
            return;
          }
          // The Mac's Touch ID prompt names the same code: a claim someone else raced in would show another one.
          const code = await passkeyCode(passkey.publicKey);
          showNote(root, `Your code: ${code}`, `Your Mac asks for Touch ID and names a code. Confirm only if it says ${code}; if it names another, cancel there.`);
          const result = await pairThisBrowser(client, link, { ...user, passkey });
          sessionStorage.removeItem(LINK_KEY);
          const done = { paired: "Paired. Allow on weft.zip opens this page to sign.", refused: "Your Mac didn't pair it. Make a new link on your Mac.", expired: "The link ran out. Make a new one on your Mac." };
          showNote(root, result === "paired" ? "Paired" : "Not paired", done[result], result !== "paired");
        } catch (err) {
          showNote(root, "Not paired", message(err), true);
        }
      })();
    }),
  );
  root.append(row);
}

// A widening the board asked for (lib/sign-widen.ts): shown whole, signed, and sent as the host command.
async function widenPage(user: { id: string }, search: string): Promise<boolean> {
  const ask = widenAskOf(search);
  if (!ask) return false;
  // The card as this page reads it itself: refused when it isn't this account's on that host.
  const card = await loadWidenCard(client, ask, user.id);
  const w = typeof card === "string" ? card : widenToSign(ask, browserPasskey(user.id), Date.now(), undefined, card);
  if (typeof w === "string") {
    showNote(root, "Can't approve here", w, true);
    return true;
  }
  showWidenSheet(root, w, {
    sign: async () => {
      try {
        const problem = await sendWiden(client, w, await signWithPasskey(w.credId, w.message, window.location.hostname));
        if (!problem) showNote(root, "Sent", "The host checks the signature and makes the change. You can close this tab.");
        return problem;
      } catch (err) {
        return message(err);
      }
    },
    cancel: () => window.close(),
  });
  return true;
}

async function approvePage(user: { id: string }) {
  const search = window.location.search || (sessionStorage.getItem(ASK_KEY) ?? "");
  if (await widenPage(user, search)) {
    sessionStorage.removeItem(ASK_KEY);
    return;
  }
  const ids = askIds(window.location.search) ?? askIds(sessionStorage.getItem(ASK_KEY) ?? "");
  sessionStorage.removeItem(ASK_KEY);
  if (!ids) {
    showNote(root, "Nothing to approve", "Open this page from Allow on the weft.zip board.", true);
    return;
  }
  const ask = await loadAsk(client, ids, browserPasskey(user.id), Date.now());
  if (typeof ask === "string") {
    showNote(root, "Can't approve here", ask, true);
    return;
  }
  showSheet(root, ask, {
    sign: async () => {
      try {
        const sig = await signWithPasskey(ask.approval.credId, ask.approval.message, window.location.hostname);
        const problem = await sendApproval(client, ask, sig);
        if (!problem) showNote(root, "Sent to your Mac", "It checks the signature and runs it. You can close this tab.");
        return problem;
      } catch (err) {
        return message(err);
      }
    },
    cancel: () => window.close(),
  });
}

async function main() {
  const page = document.body.dataset.page;
  // The pairing secret rides in the #; keep it across a sign-in, then take it off the address bar.
  if (page === "pair" && parsePairingLink(window.location.href)) {
    sessionStorage.setItem(LINK_KEY, window.location.href);
    history.replaceState(null, "", window.location.pathname);
  }
  const { data } = await client.auth.getUser();
  const user = data.user;
  if (!user) {
    if (page === "approve" && window.location.search) sessionStorage.setItem(ASK_KEY, window.location.search);
    askSignIn(page === "pair" ? "Pair a passkey with your Mac" : "Approve on your Mac");
    return;
  }
  const name = String(user.user_metadata.full_name ?? user.email ?? "Weft");
  if (page === "pair") pairPage({ id: user.id, name: `${name} · passkey` });
  else await approvePage(user);
}

void main().catch((err: unknown) => showNote(root, "Something went wrong", message(err), true));
