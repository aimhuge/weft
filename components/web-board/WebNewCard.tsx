"use client";

// New thread on the weft.zip board (docs/architecture/new-card-parity.md). Not a lookalike: at desktop widths it is the
// desktop's own NewCardDialog, at phone widths the phone app's design (PhoneNewCard), both over the same state. What the
// browser can't do itself comes from two transports: the new-card one names the places a card can start (your synced
// folders on each Mac or worker) and its note, and the thread one carries the composer's uploads, people and "/"
// skills, read from a card already in the chosen project. Nothing runs here: the machine that owns the folder gets a
// `new_card` command (lib/cloud-inbox-cards.ts on a Mac, lib/worker-kinds.ts on a worker) and the card turns up by itself.
import { useMemo, useState } from "react";
import type { NewCardInput } from "@/lib/client-api";
import type { CloudCardRow } from "@/lib/cloud-sync-types";
import type { NewCardForm } from "@/lib/cloud-commands";
import type { SupabaseClient } from "@supabase/supabase-js";
import { firstPlace, NewCardTransportContext, skillsCardFor, startModeFor, webNewCard, type NewCardTransport } from "@/lib/new-card-transport";
import { useStartModes } from "@/lib/web-start-modes";
import { ThreadTransportContext, useThreadTransport } from "@/lib/thread-transport";
import { usePhoneWidth } from "@/lib/use-phone-width";
import type { WebTarget } from "@/lib/web-commands";
import { track } from "@/lib/analytics";
import NewCardDialog from "../NewCardDialog";
import { PhoneNewCard } from "./PhoneNewCard";

const ON = "The Mac or worker has to be on and running Weft. A thread that needs a yes waits for you in Needs you.";
const NONE = "No folder to start it in yet. Turn on Sync for a project in the Weft desktop app (Settings → Sync) and let it sync a card, then it shows up here.";

export interface WebNewCardProps {
  places: WebTarget[];
  // The project chip selected on the board, if it is one of the places.
  folder: string | null;
  // The board's synced cards, for the "/" list's project.
  rows: CloudCardRow[];
  // Resolves to why it couldn't be sent, or null once it is.
  onStart: (target: WebTarget, form: NewCardForm) => Promise<string | null>;
  onClose: () => void;
  // For each Mac's published start mode (lib/web-start-modes.ts).
  client: SupabaseClient;
  orgId: string;
}

export function WebNewCard({ places, folder, rows, onStart, onClose, client, orgId }: WebNewCardProps) {
  const phone = usePhoneWidth();
  const thread = useThreadTransport();
  const [plan, setPlan] = useState(false);
  const modes = useStartModes(client, orgId);
  const host: NewCardTransport = useMemo(
    () => ({ local: false, places, note: places.length ? ON : NONE, plan: { on: plan, set: setPlan }, startMode: startModeFor(modes) }),
    [places, plan, modes],
  );
  // The "/" list for a card that doesn't exist yet: the project's skills, as a card in it lists them.
  const composing = useMemo(() => {
    const list = thread.listSkills;
    if (!list) return thread;
    return {
      ...thread,
      listSkills: (cardId: string | undefined, cwd: string | undefined) => {
        const proxy = cardId ?? (cwd ? skillsCardFor(rows, cwd) : undefined);
        return proxy ? list(proxy, cwd) : Promise.resolve([]);
      },
    };
  }, [thread, rows]);
  const create = async (input: NewCardInput) => {
    const picked = webNewCard(input, places, plan);
    if (typeof picked === "string") throw new Error(picked);
    const problem = await onStart(picked.target, picked.form);
    if (problem) throw new Error(problem);
    if (input.start) track("thread_started", { backend: input.backend, model: input.model || "default", effort: input.effort || "default" });
  };
  const defaultCwd = firstPlace(places, folder);
  return (
    <NewCardTransportContext.Provider value={host}>
      <ThreadTransportContext.Provider value={composing}>
        {phone ? (
          <PhoneNewCard places={places} defaultCwd={defaultCwd} note={host.note} onCreate={create} onClose={onClose} />
        ) : (
          <div role="dialog" aria-label="New thread" className="fixed inset-y-0 right-0 z-40 flex w-[min(620px,100vw)] border-l border-line shadow-2xl">
            <NewCardDialog home="" defaultCwd={defaultCwd} onCreate={create} onClose={onClose} />
          </div>
        )}
      </ThreadTransportContext.Provider>
    </NewCardTransportContext.Provider>
  );
}
