"use client";

import type { BrowserState, NewCardInput } from "@/lib/client";
import type { Card, RestartStatus } from "@/lib/types";
import { guarded } from "./guarded";

const NewCardDialog = guarded(() => import("./NewCardDialog"), { what: "New thread dialog", className: "m-3 w-[360px] self-start" });
const BrowserPane = guarded(() => import("./BrowserPane"), { what: "browser pane", className: "m-3 w-[360px] self-start" });

interface NewThreadForm {
  cards: Card[];
  home: string;
  defaultCwd?: string;
  recentCwd?: string;
  restart?: RestartStatus | null;
  onCreate: (input: NewCardInput, opts?: { stay?: boolean }) => Promise<void>;
  // Opens Settings → Agents, from the Agent menu's "Manage agents…".
  onManageAgents?: () => void;
}

interface NewThreadBrowser {
  desktop: boolean;
  state: BrowserState;
  obscured: boolean;
  width: number;
  onWidth: (width: number) => void;
}

export default function NewThreadWindow({ form, browser, onClose }: { form: NewThreadForm; browser: NewThreadBrowser; onClose: () => void }) {
  return (
    <>
      <NewCardDialog {...form} onClose={onClose} />
      {browser.desktop && (
        <BrowserPane
          desktop
          state={browser.state}
          obscured={browser.obscured}
          expanded
          width={browser.width}
          onWidth={browser.onWidth}
          onClose={onClose}
        />
      )}
    </>
  );
}
