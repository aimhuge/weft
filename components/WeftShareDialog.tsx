"use client";

import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { CopyLinkButton, ShareDialog } from "@aimhuge/share/client";
import { useOverlay } from "@/lib/overlay";
import { useEscape } from "@/lib/use-escape";

// The frame every Share… dialog draws in (a card, an app, the board): the package's ShareDialog, on document.body over
// the whole window, with Copy link in its header and footer once there's a url. `footerExtra` goes after the footer's Copy.
//
// The package's dialog closes on Escape itself; the layer here only keeps Weft's own (the open thread, the browser, a
// drawer under it) from also closing, so one Escape closes just the dialog. It isn't a components/Modal.tsx, so it says
// itself that it's an overlay: the browser pane (a native view drawn above the page) steps aside while it's open.
export default function WeftShareDialog({
  title,
  url,
  onClose,
  footerExtra,
  children,
}: {
  title: string;
  url: string | null;
  onClose: () => void;
  footerExtra?: ReactNode;
  children: ReactNode;
}) {
  useEscape(true, () => {});
  useOverlay(true);

  return createPortal(
    <ShareDialog
      title={title}
      onClose={onClose}
      headerAction={url ? <CopyLinkButton size="sm" url={url} /> : undefined}
      footerStart={
        url ? (
          <span className="flex items-center gap-2">
            <CopyLinkButton url={url} />
            {footerExtra}
          </span>
        ) : undefined
      }
    >
      {children}
    </ShareDialog>,
    document.body,
  );
}
