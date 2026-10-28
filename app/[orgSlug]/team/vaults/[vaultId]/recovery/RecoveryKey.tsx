"use client";

// The recovery key's words, on the team's recovery page (docs/architecture/teams-vault.md,
// "Recovery key").
//
// The words come from the desktop, not from the server: the vault's key only exists in Electron
// main, so main is the only place that can derive them. The page asks for them behind Touch ID, and
// what it gets is 24 words and nothing else — no key, no sealed box, no passphrase.
//
// The rules the component keeps:
//   - the words are shown once, and live in this component's state and nowhere else
//   - "Copy words" puts them on the clipboard for a minute, then the clipboard is emptied
//   - the user ticks "I've saved these words somewhere safe." to finish
//
// Outside the desktop there is no bridge, so the component says so instead of pretending.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  RECOVERY_CLIPBOARD_MS,
  looksLikeRecoveryKey,
  passphraseHint,
  passphraseIsLongEnough,
  recoveryGrid,
  recoveryLine,
  shownNote,
  vaultRecoveryBridge,
  type RecoveryShowResult,
} from "@/lib/vault-recovery-view";

export function RecoveryKey({ vaultId, label, repo }: { vaultId: string; label: string; repo: string }) {
  const bridge = vaultRecoveryBridge();
  const [passphrase, setPassphrase] = useState("");
  const [shown, setShown] = useState<RecoveryShowResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);
  // The clipboard is emptied on a timer, so the words don't sit in it for good.
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (copyTimer.current) clearTimeout(copyTimer.current);
  }, []);

  const show = useCallback(async () => {
    if (!bridge) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const result = await bridge.show(vaultId, passphrase);
      if ("denied" in result) {
        setError("Cancelled — nothing was shown and nothing changed.");
        return;
      }
      const made: RecoveryShowResult = result;
      if (!looksLikeRecoveryKey(made.words)) {
        setError("The desktop didn't return a whole recovery key. Nothing was shown.");
        return;
      }
      setShown(made);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The recovery key couldn't be made.");
    } finally {
      setBusy(false);
    }
  }, [bridge, vaultId, passphrase]);

  const copy = useCallback(async () => {
    if (!shown) return;
    try {
      await navigator.clipboard.writeText(recoveryLine(shown.words));
      setCopied(true);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      // A minute, then the clipboard is emptied — the words are the user's to keep, not the
      // clipboard's.
      copyTimer.current = setTimeout(() => {
        void navigator.clipboard.writeText("").catch(() => {});
        setCopied(false);
      }, RECOVERY_CLIPBOARD_MS);
    } catch {
      setError("The clipboard wouldn't take the words. Write them down by hand instead.");
    }
  }, [shown]);

  if (!bridge) {
    return (
      <div className="wz-recoveryBox">
        <p className="wz-teamSub">
          The words are made in the desktop app, where your vault&apos;s key lives. Open this page in Weft — on the machine that holds the vault — and the words appear here.
        </p>
        <p className="wz-teamSub">This page is on weft.zip, where there is no vault key to derive them from.</p>
      </div>
    );
  }

  if (!shown) {
    return (
      <div className="wz-recoveryBox">
        <p className="wz-teamSub">
          Twenty-four words that open <strong>{label}</strong> when every machine is gone. Weft shows them once and keeps no copy: they are yours to write down.
        </p>
        <div className="wz-inviteField">
          <label htmlFor="recovery-passphrase">Passphrase (optional)</label>
          <input
            id="recovery-passphrase"
            name="passphrase"
            type="password"
            className="wz-inviteInput"
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            disabled={busy}
          />
          <p className="wz-inviteRoleDescription">{passphraseHint(passphrase)}</p>
        </div>
        <div>
          <button
            type="button"
            className="wz-inviteSubmit"
            onClick={() => void show()}
            disabled={busy || (passphrase !== "" && !passphraseIsLongEnough(passphrase))}
          >
            {busy ? "Waiting for Touch ID…" : `Show recovery key for ${label}`}
          </button>
        </div>
        {error ? (
          <p className="wz-inviteMessage wz-inviteMessageError" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="wz-recoveryBox">
      <p className="wz-teamSub">{shownNote(shown)}</p>
      <ol className="wz-recoveryGrid" aria-label="Recovery key words">
        {recoveryGrid(shown.words).map(({ index, word }) => (
          <li key={index} className="wz-recoveryWord">
            <span className="wz-recoveryIndex">{index}</span>
            <span className="wz-recoveryText">{word}</span>
          </li>
        ))}
      </ol>
      <div className="wz-recoveryActions">
        <button type="button" className="wz-inviteSubmit" onClick={() => void copy()}>
          {copied ? "Copied — a minute, then it's gone" : "Copy words"}
        </button>
        <label className="wz-recoverySaved">
          <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
          I&apos;ve saved these words somewhere safe.
        </label>
      </div>
      {error ? (
        <p className="wz-inviteMessage wz-inviteMessageError" role="alert">
          {error}
        </p>
      ) : null}
      <p className="wz-teamSub">
        A passphrase wasn&apos;t sent anywhere and isn&apos;t stored: the words alone are what open {repo}.
      </p>
    </div>
  );
}
