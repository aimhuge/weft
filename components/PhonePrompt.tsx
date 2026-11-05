"use client";

// "Weft on your phone": once you're signed in, welcomed, a few threads have finished and no phone is signed in to your
// account yet, Weft shows the phone app's TestFlight link as a QR code once, with a button that emails you the invite
// (lib/phone-prompt.ts has the rules, docs/architecture/mobile.md#testflight). Settings → General → Reset tips brings it back.

import { useState } from "react";
import { openExternal } from "@/lib/auth/desktop";
import { finishedCount } from "@/lib/sync-prompt";
import type { InviteAnswer } from "@/lib/testflight-types";
import type { Card } from "@/lib/types";
import { inviteMe, usePhonePrompt } from "@/lib/use-testflight";
import { Spinner } from "./Icon";
import Modal from "./Modal";
import { QrCode } from "./QrCode";
import { BUTTON_PRIMARY as PRIMARY, BUTTON_SECONDARY as SECONDARY } from "./button-styles";

export function PhonePromptDialog({
  url,
  invites,
  onClose,
  invite = inviteMe,
}: {
  url: string;
  // weft.zip can email invites (the App Store Connect key is set there); without it the QR code is the only way in.
  invites: boolean;
  onClose: () => void;
  invite?: () => Promise<InviteAnswer>;
}) {
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<InviteAnswer | null>(null);
  const send = () => {
    setBusy(true);
    void invite().then((a) => {
      setBusy(false);
      setAnswer(a);
    });
  };
  const sent = answer?.ok ? answer : null;
  return (
    <Modal title="Weft on your phone" onClose={onClose} keepOnBackdrop className="w-full max-w-[440px]">
      <div className="flex flex-col gap-3 px-5 py-4">
        <div className="flex gap-4">
          <div className="shrink-0">
            <QrCode text={url} size={132} label="TestFlight QR code" />
          </div>
          <div className="flex min-w-0 flex-col gap-2 text-[13px] text-ink">
            <p>Your cards in your pocket: see the page each one last showed, answer questions, Allow with Face ID and reply by voice.</p>
            <p className="text-[12.5px] text-muted">
              Scan this with your iPhone camera to join the beta on TestFlight, or{" "}
              <button type="button" className="text-accent hover:underline" onClick={() => openExternal(url)}>
                open the link
              </button>
              .
            </p>
          </div>
        </div>
        {sent && (
          <p className="text-[12.5px] text-ink">
            {sent.already ? "You're already on the beta list as " : "Apple is sending your invite to "}
            <b>{sent.email}</b>. {sent.already ? "Look for Apple's TestFlight email, or scan the code." : "Open it on your iPhone."}
          </p>
        )}
        {answer && !answer.ok && <p className="text-[12.5px] text-danger">Couldn&apos;t send the invite: {answer.error}</p>}
        <div className="mt-1 flex items-center justify-end gap-2">
          <button type="button" onClick={onClose} className={SECONDARY}>
            {sent || !invites ? "Done" : "Not now"}
          </button>
          {!sent && invites && (
            <button type="button" onClick={send} disabled={busy} className={PRIMARY} autoFocus>
              {busy && <Spinner size={11} />}
              Email me an invite
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}

export default function PhonePrompt({ cards }: { cards: Card[] }) {
  const { url, invites, close } = usePhonePrompt(finishedCount(cards));
  if (!url) return null;
  return <PhonePromptDialog url={url} invites={invites} onClose={close} />;
}
