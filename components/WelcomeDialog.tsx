"use client";

import { useEffect, useRef, useState } from "react";
import { setBoardMode } from "@/lib/board-prefs";
import { api } from "@/lib/client";
import { openNewThread, selectCard } from "@/lib/onboarding-events";
import { trackOnboarding } from "@/lib/telemetry-client";
import { useOnboardingStats } from "@/lib/use-onboarding-stats";
import { useStepVoice } from "@/lib/use-welcome-tour";
import { answerFor, answerWelcome, defaultTicks, loadWelcome, REPLAY_EVENT, TEST_EVENT, type WelcomePreview } from "@/lib/welcome-client";
import Modal from "./Modal";
import { AccountStep, useAccountStep } from "./WelcomeAccount";
import { FirstThreadStep, STARTERS } from "./WelcomeFirst";
import { WelcomeFooter, WelcomeStepBar, welcomeNote, welcomeSteps, type WelcomeStep } from "./WelcomeFooter";
import { CLIS, ReadyStep, useAgents } from "./WelcomeIntro";
import { ProjectsStep } from "./WelcomeSteps";

// First launch's welcome, for everyone, history or not (lib/welcome.ts). Do, don't tell: screen 1 is what Weft is, as a
// loop of the board at work with your project names, with the agent CLIs and Log in right there; screen 2 the projects to bring in, with the switch that counts
// your Claude Code history on your Wefter Profile (left out when there's no history); screen 3 starts your first thread.
// Signed out (with sign-in set up), a sign-in screen sits between 1 and 2 and you sign in with GitHub to go on
// (components/WelcomeAccount.tsx).
// The answer is saved on leaving screen 2 (or 1 with no history), so the import runs while you write the first prompt;
// the session sync adds no cards until then. The board explains the rest in place, once, as cards move.
// Settings → General's "Replay the welcome" shows it again as a preview that saves nothing (Start still starts a
// thread: you asked for that one); a replay is closeable — Escape, the backdrop or ✕ — while first launch stays put,
// since the answer only exists once you give it. Its "Test it" shows the real one, answered for real. It draws over
// the whole window.

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
  // Signed in to Weft with no agent logged in, the first thread runs on puku-cli's free trial (lib/welcome-trial.ts).
  const { status: cliStatus, trial, cli, ready: cliReady } = useAgents(preview !== null);
  // Step 1's tour ends on Weft's keyboard shortcuts; the next steps say what to do (lib/use-welcome-tour.ts).
  useStepVoice(preview ? step : "closed");
  // Anonymous setup stats, unless they're switched off in Settings → Security (lib/telemetry.ts).
  useOnboardingStats({ preview, replay, step, cliReady });
  const account = useAccountStep();
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
    const load = (firstLaunch: boolean) =>
      void loadWelcome()
        .then((view) => {
          if (!live || view.welcome || !view.preview) return;
          // A new install starts on the Regular board; Test it, the same screen on a used board, leaves it be.
          if (firstLaunch) setBoardMode("regular");
          show(view.preview, false);
        })
        .catch(() => {});
    load(true);
    const onTest = () => load(false);
    const onReplay = () =>
      void loadWelcome(true)
        .then((view) => {
          if (live && view.preview) show(view.preview, true);
        })
        .catch((err: unknown) => report.current?.(err));
    window.addEventListener(REPLAY_EVENT, onReplay);
    window.addEventListener(TEST_EVENT, onTest);
    return () => {
      live = false;
      window.removeEventListener(REPLAY_EVENT, onReplay);
      window.removeEventListener(TEST_EVENT, onTest);
    };
  }, []);

  useEffect(() => ok.current?.focus(), [preview, step]);

  if (!preview) return null;

  const hasHistory = preview.projects.length > 0;
  const steps = welcomeSteps(account.needed, hasHistory);
  const folders = preview.projects.filter((p) => ticked.has(p.cwd));

  const fail = (err: unknown) => {
    setBusy(false);
    report.current?.(err);
  };
  // Saves the answer (not in a replay) and moves on to the first thread.
  const answer = (fresh: boolean) => {
    // A replay answers nothing, so it records no answer — the event would read as a real first launch.
    if (replay) {
      setStep("first");
      return;
    }
    trackOnboarding("onboarding_projects_answered", { brought: fresh ? 0 : folders.length, count_history: countHistory, start_empty: fresh });
    setBusy(true);
    answerWelcome(answerFor(countHistory, preview.projects, ticked, fresh))
      .then(() => {
        setBusy(false);
        setStep("first");
      })
      .catch(fail);
  };
  // Next off the sign-in screen, and "Not now" past it without an account: both land on the projects, or straight on
  // the first thread when there's no history. The sign-in step stays in the list either way — the account is still
  // offered later, and the answer keeps its place.
  const next = () => {
    if (step === "ready" && account.needed) {
      account.show();
      setStep("account");
      return;
    }
    if (hasHistory) setStep("projects");
    else answer(false);
  };
  // "Not now" on the sign-in screen: past it without an account.
  const deferAccount = () => {
    trackOnboarding("onboarding_account_deferred");
    next();
  };
  // Start: the thread runs and its card opens; with no folder picked, the New thread dialog takes over with the prompt.
  const start = () => {
    const text = prompt.trim();
    trackOnboarding("onboarding_first_thread", { backend: cli, used_starter: STARTERS.some((s) => s.text === text), replay });
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
  // A replay is a preview you opened, so it dismisses the way any dialog does — Escape, the backdrop, the header's ✕.
  // First launch doesn't: you came here to answer, and nothing is remembered if you drift off it.
  const dismiss = () => {
    trackOnboarding("onboarding_skipped", { step, replay });
    setPreview(null);
  };
  // Nothing to close on first launch, so Modal gets a no-op close and a backdrop that swallows presses.
  const close = replay ? dismiss : () => {};
  // ↵ is the primary wherever focus is, except on another button (which presses itself) and in the prompt, where ⌘↵ is.
  const onKeyDown = (e: React.KeyboardEvent) => {
    const tag = (e.target as HTMLElement).tagName;
    if (e.key !== "Enter" || tag === "BUTTON" || tag === "SELECT" || (tag === "TEXTAREA" && !(e.metaKey || e.ctrlKey))) return;
    e.preventDefault();
    ok.current?.click();
  };

  return (
    <Modal label="Welcome to Weft" onClose={close} layer="top" keepOnBackdrop={!replay} className="w-full max-w-[760px]">
      <div onKeyDown={onKeyDown} className="flex flex-col">
        <WelcomeStepBar steps={steps} step={step} replay={replay} onDismiss={dismiss} />
        <div className="max-h-[72vh] overflow-auto px-5 py-4">
          {step === "ready" && <ReadyStep status={cliStatus} trial={trial} projects={preview.projects.filter((p) => !p.scratch).map((p) => p.name)} />}
          {step === "account" && <AccountStep />}
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
          // The sign-in screen doesn't block: Next moves on once you're signed in, and "Not now" moves on without.
          canNext={step !== "account" || account.signedIn}
          signedIn={account.signedIn}
          onNext={next}
          onAnswer={answer}
          onSkip={dismiss}
          onStart={start}
          onDefer={deferAccount}
        />
      </div>
    </Modal>
  );
}
