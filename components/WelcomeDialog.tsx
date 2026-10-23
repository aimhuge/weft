"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "@/lib/client";
import { openNewThread, selectCard } from "@/lib/onboarding-events";
import { useStepVoice } from "@/lib/use-welcome-tour";
import { answerFor, answerWelcome, defaultTicks, loadWelcome, REPLAY_EVENT, TEST_EVENT, type WelcomePreview } from "@/lib/welcome-client";
import Modal from "./Modal";
import { FirstThreadStep, STARTERS } from "./WelcomeFirst";
import { WelcomeFooter, welcomeNote, type WelcomeStep } from "./WelcomeFooter";
import { CLIS, ReadyStep, readyCli, useCliStatus } from "./WelcomeIntro";
import { ProjectsStep } from "./WelcomeSteps";

// First launch's welcome, for everyone, history or not (lib/welcome.ts). Do, don't tell: screen 1 is what Weft is, as a
// loop of the board at work with your project names, with the agent CLIs and Log in right there; screen 2 the projects to bring in, with the switch that counts
// your Claude Code history on your Wefter Profile (left out when there's no history); screen 3 starts your first thread.
// The answer is saved on leaving screen 2 (or 1 with no history), so the import runs while you write the first prompt;
// the session sync adds no cards until then. The board explains the rest in place, once, as cards move.
// Settings → General's "Replay the welcome" shows it again as a preview that saves nothing (Start still starts a
// thread: you asked for that one); its "Test it" shows the real one, answered for real. It draws over the whole window.

export default function WelcomeDialog({ onError }: { onError?: (err: unknown) => void }) {
  const [preview, setPreview] = useState<WelcomePreview | null>(null);
  const [step, setStep] = useState<WelcomeStep>("ready");
  const [countHistory, setCountHistory] = useState(true);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [cwd, setCwd] = useState("");
  const [prompt, setPrompt] = useState(STARTERS[0]?.text ?? "");
  const [busy, setBusy] = useState(false);
  const [replay, setReplay] = useState(false);
  const ok = useRef<HTMLButtonElement>(null);
  // Screen 1 polls each agent CLI's login while the welcome shows, so a login finished in the browser ticks itself.
  const cliStatus = useCliStatus(preview !== null);
  // Step 1's tour ends on "Now let's get started"; the next steps say what to do (lib/use-welcome-tour.ts).
  useStepVoice(preview ? step : "closed");
  // The board hands a new onError on every render; the loading effect shouldn't rerun for that.
  const report = useRef(onError);
  useEffect(() => {
    report.current = onError;
  });

  useEffect(() => {
    let live = true;
    const show = (view: WelcomePreview, isReplay: boolean) => {
      const ticks = defaultTicks(view.projects);
      setReplay(isReplay);
      setStep("ready");
      setPreview(view);
      setTicked(ticks);
      setCwd(view.projects.find((p) => ticks.has(p.cwd))?.cwd ?? "");
    };
    const load = () =>
      void loadWelcome()
        .then((view) => {
          if (live && !view.welcome && view.preview) show(view.preview, false);
        })
        .catch(() => {});
    load();
    const onReplay = () =>
      void loadWelcome(true)
        .then((view) => {
          if (live && view.preview) show(view.preview, true);
        })
        .catch((err: unknown) => report.current?.(err));
    window.addEventListener(REPLAY_EVENT, onReplay);
    window.addEventListener(TEST_EVENT, load);
    return () => {
      live = false;
      window.removeEventListener(REPLAY_EVENT, onReplay);
      window.removeEventListener(TEST_EVENT, load);
    };
  }, []);

  useEffect(() => ok.current?.focus(), [preview, step]);

  if (!preview) return null;

  const hasHistory = preview.projects.length > 0;
  const steps: WelcomeStep[] = hasHistory ? ["ready", "projects", "first"] : ["ready", "first"];
  const folders = preview.projects.filter((p) => ticked.has(p.cwd));
  const cli = readyCli(cliStatus);

  const fail = (err: unknown) => {
    setBusy(false);
    report.current?.(err);
  };
  // Saves the answer (not in a replay) and moves on to the first thread.
  const answer = (fresh: boolean) => {
    if (replay) {
      setStep("first");
      return;
    }
    setBusy(true);
    answerWelcome(answerFor(countHistory, preview.projects, ticked, fresh))
      .then(() => {
        setBusy(false);
        setStep("first");
      })
      .catch(fail);
  };
  const next = () => {
    if (hasHistory) setStep("projects");
    else answer(false);
  };
  // Start: the thread runs and its card opens; with no folder picked, the New thread dialog takes over with the prompt.
  const start = () => {
    const text = prompt.trim();
    if (!cwd) {
      setPreview(null);
      openNewThread({ prompt: text });
      return;
    }
    if (!text) return;
    setBusy(true);
    api
      .create({ prompt: text, cwd, backend: cli, start: true })
      .then(({ card }) => {
        setBusy(false);
        setPreview(null);
        selectCard(card.id);
      })
      .catch(fail);
  };
  const toggle = (folder: string) =>
    setTicked((prev) => {
      const nextTicks = new Set(prev);
      if (nextTicks.has(folder)) nextTicks.delete(folder);
      else nextTicks.add(folder);
      return nextTicks;
    });
  // ↵ is the primary wherever focus is, except on another button (which presses itself) and in the prompt, where ⌘↵ is.
  const onKeyDown = (e: React.KeyboardEvent) => {
    const tag = (e.target as HTMLElement).tagName;
    if (e.key !== "Enter" || tag === "BUTTON" || tag === "SELECT" || (tag === "TEXTAREA" && !(e.metaKey || e.ctrlKey))) return;
    e.preventDefault();
    ok.current?.click();
  };

  const cliReady = cliStatus === null ? null : CLIS.some((c) => cliStatus[c.id]?.loggedIn);
  return createPortal(
    <Modal label="Welcome to Weft" onClose={() => {}} keepOnBackdrop className="w-full max-w-[760px]">
      <div onKeyDown={onKeyDown} className="flex flex-col">
        <div className="flex items-center justify-between border-b border-line px-5 py-2.5 text-[12px] text-muted">
          <span>{replay ? "Replay · saves nothing" : `Step ${steps.indexOf(step) + 1} of ${steps.length}`}</span>
          <span className="flex gap-1.5" aria-label={`Step ${steps.indexOf(step) + 1} of ${steps.length}`}>
            {steps.map((s) => (
              <span key={s} className={`h-1.5 rounded-full transition-all ${step === s ? "w-4 bg-accent" : "w-1.5 bg-line"}`} />
            ))}
          </span>
        </div>
        <div className="max-h-[72vh] overflow-auto px-5 py-4">
          {step === "ready" && <ReadyStep status={cliStatus} projects={preview.projects.filter((p) => !p.scratch).map((p) => p.name)} />}
          {step === "projects" && <ProjectsStep projects={preview.projects} ticked={ticked} toggle={toggle} history={{ on: countHistory, set: setCountHistory, preview }} />}
          {step === "first" && (
            <FirstThreadStep folders={folders} cwd={cwd} setCwd={setCwd} prompt={prompt} setPrompt={setPrompt} cliLabel={CLIS.find((c) => c.id === cli)?.label ?? cli} />
          )}
        </div>
        <WelcomeFooter
          step={step}
          note={welcomeNote(step, cliReady, cwd)}
          busy={busy}
          okRef={ok}
          bringing={folders.length}
          cwd={cwd}
          canStart={!cwd || Boolean(prompt.trim())}
          onNext={next}
          onAnswer={answer}
          onSkip={() => setPreview(null)}
          onStart={start}
        />
      </div>
    </Modal>,
    document.body,
  );
}
