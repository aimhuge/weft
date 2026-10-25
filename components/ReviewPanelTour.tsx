"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { stepUrl } from "@/lib/review";
import { moveDraft, readDraft, replyDraftKey } from "@/lib/drafts";
import {
  feedbackKey,
  flushFeedback,
  unsentCount,
  writeFeedback,
} from "@/lib/review-feedback";
import { lastLocalUrl } from "@/lib/review-tour";
import type { ReviewPlan, ThreadItem } from "@/lib/types";
import Composer, { type ComposerHandle } from "./Composer";
import Icon from "./Icon";
import { ReviewPanelDevServer } from "./ReviewPanelDevServer";
import { ReviewPanelHeader } from "./ReviewPanelHeader";
import { ReviewPanelLookFor } from "./ReviewPanelLookFor";
import { ReviewPanelTourNav } from "./ReviewPanelTourNav";

// The tour a thread left for its Review card: one step at a time, with what to look for, the page
// opened in the browser pane when it's a web product, and a box to send feedback on that step.
export function ReviewPanelTour({
  cardId,
  cwd,
  plan: written,
  items,
  onSend,
}: {
  cardId: string;
  cwd: string;
  plan: ReviewPlan;
  items: ThreadItem[];
  onSend: (text: string) => Promise<void>;
}) {
  // A tour that left out its url still has an app to show: the one the thread talked about. Not when every
  // step names its own page (an HTML file, a full URL): the thread prompt leaves url out when there's no app.
  const needsApp = !written.url && written.steps.some((s) => !stepUrl(written, s));
  const guess = needsApp ? lastLocalUrl(items) : undefined;
  const plan = useMemo(() => (guess ? { ...written, url: guess } : written), [written, guess]);
  const [index, setIndex] = useState(0);
  const [approved, setApproved] = useState<Set<number>>(new Set());
  const composer = useRef<ComposerHandle>(null);
  const [empty, setEmpty] = useState(() => !readDraft(feedbackKey(cardId, 0)).trim());
  // The step the box belongs to, so a change saves under it even while go() is switching steps.
  const boxStep = useRef(0);
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  // Bumped to build the box afresh from its saved draft, when text arrives before its editor exists.
  const [boxKey, setBoxKey] = useState(0);

  const steps = plan.steps;
  const step = steps[Math.min(index, steps.length - 1)];
  const url = step ? stepUrl(plan, step) : undefined;

  // The steps that still hold feedback you haven't sent. Kept in state so the count follows what you
  // type, what you send and where you step to: feedback written on a step you step away from must
  // never become invisible.
  const [unsent, setUnsent] = useState(() => unsentCount(cardId, steps.map((_, i) => i)));

  // The tour takes the reply box's place when the card lands in Review, maybe mid-sentence: bring what you
  // were typing along into this step's box, focused at its end, so you keep typing. An effect, so it runs
  // after the reply box's unmount has written its last keystrokes. The box is built afresh rather than
  // written to: on the first mount its editor doesn't exist yet, and a write would vanish.
  useEffect(() => {
    const moved = moveDraft(replyDraftKey(cardId), feedbackKey(cardId, boxStep.current));
    if (!moved) return;
    setBoxKey((k) => k + 1);
    setEmpty(false);
    setUnsent((n) => Math.max(n, 1));
  }, [cardId]);

  // Show each step's page as you reach it.
  useEffect(() => {
    if (url) window.weft?.browser.open(url, cardId).catch(() => {});
  }, [url, cardId]);

  const last = index >= steps.length - 1;

  function refreshUnsent() {
    setUnsent(unsentCount(cardId, steps.map((_, i) => i)));
  }

  function go(to: number) {
    const next = Math.max(0, Math.min(steps.length - 1, to));
    setIndex(next);
    boxStep.current = next;
    const draft = readDraft(feedbackKey(cardId, next));
    if (draft) composer.current?.write(draft);
    else composer.current?.clear();
    setEmpty(!draft.trim());
    setError("");
  }

  // The feedback box is the same composer as the reply box: screenshots paste or drop right in.
  // Sends what every step holds, not just this one: a note written on step 1 must still go out from
  // step 3, rather than leave the button off over an empty box.
  async function sendFeedback() {
    const box = composer.current;
    if (sending || !box) return;
    // A screenshot still uploading, or one that failed, says so instead of going out without it.
    if (!box.isEmpty()) {
      try {
        box.read();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        return;
      }
    }
    setSending(true);
    try {
      if (await flushFeedback(cardId, steps, onSend)) {
        composer.current?.clear();
        setEmpty(true);
      }
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
    refreshUnsent();
  }

  // The last step's button wraps the thread up with Weft's done skill, as the Skills menu would.
  async function approve() {
    setApproved((prev) => new Set(prev).add(index));
    // Feedback you wrote on any step but never sent goes out with the approval: it was written for the
    // thread to act on, and stepping past a step must not swallow it.
    const pending = unsent;
    if (pending > 0) {
      setSending(true);
      try {
        await flushFeedback(cardId, steps, onSend);
        composer.current?.clear();
        setEmpty(true);
        setError("");
      } catch (err) {
        // Not sent, so not past this step: the feedback is still here to try again.
        setError(err instanceof Error ? err.message : String(err));
        return;
      } finally {
        setSending(false);
        refreshUnsent();
      }
    }
    if (!last) go(index + 1);
    else void onSend("/weft:done");
  }

  // A tour always has a step (lib/review.ts drops one without any).
  if (!step) return null;

  return (
    <section className="border-t border-line bg-accent-soft/40">
      <ReviewPanelHeader
        collapsed={collapsed}
        onToggle={() => setCollapsed((c) => !c)}
        index={index}
        total={steps.length}
        approved={approved.size}
        unsent={unsent}
      />
      {!collapsed && (
        <div className="px-4 pb-3">
          <div className="flex items-start gap-2">
            <h3 className="min-w-0 flex-1 text-[13.5px] font-medium leading-snug text-ink">
              {approved.has(index) && <Icon name="check" size={13} className="mr-1 inline text-ok" />}
              {step.title}
            </h3>
            <button
              onClick={() => void (url ? window.weft?.browser.open(url, cardId) : window.weft?.browser.setVisible(true))}
              title={url ?? "Show the browser pane"}
              className="flex shrink-0 items-center gap-1 rounded-md border border-line-strong px-2 py-0.5 text-[11.5px] text-ink hover:bg-sunken"
            >
              <Icon name="globe" size={11} /> Open browser
            </button>
          </div>
          {plan.dev && plan.url && <ReviewPanelDevServer cardId={cardId} plan={plan} />}
          {step.look && <ReviewPanelLookFor key={index} text={step.look} />}
          <div className="mt-2">
            <Composer
              key={boxKey}
              ref={composer}
              autoFocus={boxKey > 0}
              variant="reply"
              cwd={cwd}
              // It stands in for the reply box, so files dropped on this card or thread land here.
              dropTarget={cardId}
              initial={readDraft(feedbackKey(cardId, index))}
              placeholder="Anything wrong or missing here? Paste a screenshot to show it. (Enter to send)"
              onSubmit={() => void sendFeedback()}
              onChange={(markdown) => {
                writeFeedback(cardId, boxStep.current, markdown);
                // A screenshot still uploading has no Markdown yet, but the box isn't empty: Send says why it waits.
                setEmpty(!markdown.trim() && (composer.current?.isEmpty() ?? true));
                setError("");
                refreshUnsent();
              }}
              sizeClass="min-h-[44px] max-h-[30vh]"
            />
            {error && <p className="mt-1 text-[11.5px] text-danger">{error}</p>}
          </div>
          <ReviewPanelTourNav
            first={index === 0}
            last={last}
            sending={sending}
            canSend={!empty || unsent > 0}
            unsent={unsent}
            onPrev={() => go(index - 1)}
            onNext={() => go(index + 1)}
            onSend={() => void sendFeedback()}
            onApprove={() => void approve()}
          />
        </div>
      )}
    </section>
  );
}