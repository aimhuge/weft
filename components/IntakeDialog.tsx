"use client";

import { useState, type ReactNode } from "react";
import { api } from "@/lib/client";
import { folderName } from "@/lib/format";
import { closeIntake, intakeActions, useOpenIntake } from "@/lib/intake-open";
import { INTAKE_CARD_TITLE, intakeHasWork, intakePrompt } from "@/lib/intake-view";
import type { RailPanel } from "@/lib/rail-view";
import Modal from "./Modal";
import { HintText } from "./SecretRow";

// What the project intake took in when a project opened (lib/project-intake.ts): the secrets it moved into 🔐, the
// blanks left to fill with where to get each, the webhooks to register and any committed .env file to rotate.
// "Set it up in a thread" starts a card that works through the list; nothing here ever shows a value.

const button = "rounded-md border border-line px-3 py-1.5 text-[12.5px] text-ink hover:bg-sunken disabled:opacity-40";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-faint">{title}</h3>
      {children}
    </section>
  );
}

const Name = ({ children }: { children: ReactNode }) => <code className="break-all rounded bg-sunken px-1 font-mono text-[11.5px] text-ink">{children}</code>;

export default function IntakeDialog() {
  const open = useOpenIntake();
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!open) return null;
  const { folder, result } = open;
  const d = result.details ?? { imported: [], blanks: [], hooks: [] };
  const files = [...new Set(d.imported.map((i) => i.file))];

  const drawer = (panel: RailPanel) => {
    closeIntake();
    intakeActions()?.openDrawer(panel);
  };
  const startThread = async () => {
    setStarting(true);
    setError(null);
    try {
      const { card } = await api.create({ title: INTAKE_CARD_TITLE, prompt: intakePrompt(folder, result), cwd: folder, backend: "claude", start: true });
      closeIntake();
      intakeActions()?.select(card.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setStarting(false);
    }
  };

  return (
    <Modal title={`📥 Weft took in ${folderName(folder)}`} onClose={closeIntake} placement="top" className="w-full max-w-[560px]">
      <div className="flex max-h-[65vh] flex-col gap-3 overflow-y-auto px-4 pb-2 pt-1 text-[12.5px]">
        {files.map((file) => (
          <Section key={file} title={`✓ Moved into 🔐 from ${file}`}>
            <p className="flex flex-wrap gap-1">
              {d.imported.filter((i) => i.file === file).map((i) => <Name key={i.name}>{i.name}</Name>)}
            </p>
          </Section>
        ))}
        {d.blanks.length > 0 && (
          <Section title={`Blanks to fill in · ${d.blanks.length}`}>
            <ul className="flex flex-col gap-1.5">
              {d.blanks.map((b) => (
                <li key={b.name}>
                  <Name>{b.name}</Name> <span className="text-[11px] text-faint">· {b.source}</span>
                  {b.hint && <HintText hint={b.hint} onOpen={closeIntake} />}
                </li>
              ))}
            </ul>
          </Section>
        )}
        {d.hooks.length > 0 && (
          <Section title={`🪝 Webhooks to register · ${d.hooks.length}`}>
            <ul className="flex flex-col gap-1.5">
              {d.hooks.map((h) => (
                <li key={h.target}>
                  <Name>{h.name}</Name> <span className="text-[11px] text-faint">{new URL(h.target, "http://localhost").pathname}</span>
                  {h.hint && <HintText hint={h.hint} onOpen={closeIntake} />}
                </li>
              ))}
            </ul>
          </Section>
        )}
        {result.tracked.length > 0 && (
          <Section title="⚠ Rotate these keys">
            <p className="text-warn">
              {result.tracked.join(", ")} {result.tracked.length > 1 ? "are committed to git, so their" : "is committed to git, so its"} keys are in the history.
              Weft didn&apos;t import them: make new ones at each provider and keep those in 🔐.
            </p>
          </Section>
        )}
        {error && <p className="text-[12px] text-danger">{error}</p>}
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-4 py-3">
        <button type="button" onClick={closeIntake} className={button}>
          Later
        </button>
        {(d.imported.length > 0 || d.blanks.length > 0) && (
          <button type="button" onClick={() => drawer("vault")} className={button}>
            Open 🔐
          </button>
        )}
        {d.hooks.length > 0 && (
          <button type="button" onClick={() => drawer("webhooks")} className={button}>
            Open 🪝
          </button>
        )}
        {intakeHasWork(result) && (
          <button type="button" autoFocus disabled={starting} onClick={() => void startThread()} className="rounded-md bg-accent px-3 py-1.5 text-[12.5px] font-medium text-on-accent disabled:opacity-60">
            {starting ? "Starting…" : "Set it up in a thread"}
          </button>
        )}
      </div>
    </Modal>
  );
}
