"use client";

import { isAnswered, summary, type AnswerState } from "@/lib/question-answers";
import type { PendingPermission, Question } from "@/lib/types";
import type { ReactNode } from "react";
import Icon from "./Icon";

// The pieces components/QuestionForm.tsx draws: the tabs, the options and the Submit tab's review.

const tabClass = (on: boolean) => `rounded px-1.5 py-px ${on ? "bg-accent text-on-accent" : "text-muted hover:bg-panel hover:text-ink"}`;

// A tab per question, ticked once answered, and Submit; one question gets a plain title instead.
// The chevron at the end minimizes the form to this row, so the thread above it can be read.
export function QuestionTabs({
  questions,
  state,
  onTab,
  collapsed,
  onCollapse,
}: {
  questions: Question[];
  state: AnswerState;
  onTab: (tab: number) => void;
  collapsed: boolean;
  onCollapse: (collapsed: boolean) => void;
}) {
  const only = questions.length === 1 ? questions[0] : undefined;
  return (
    <div className="flex shrink-0 items-center gap-1.5 text-[12px]">
      <Icon name="alert" size={13} className="shrink-0 text-warn" />
      {only ? (
        <span className="font-medium text-ink">
          {only.header && <span className="mr-1.5 rounded bg-panel px-1.5 py-px font-normal text-muted">{only.header}</span>}
          The agent has a question
        </span>
      ) : collapsed ? (
        <span className="font-medium text-ink">The agent has {questions.length} questions</span>
      ) : (
        <div className="flex min-w-0 flex-wrap items-center gap-1">
          {questions.map((question, i) => (
            <button key={question.question} onClick={() => onTab(i)} className={`flex items-center gap-1 ${tabClass(i === state.tab)}`}>
              <span aria-hidden>{isAnswered(state, i) ? "☑" : "☐"}</span>
              {question.header || `Question ${String(i + 1)}`}
            </button>
          ))}
          <button onClick={() => onTab(questions.length)} className={tabClass(state.tab === questions.length)}>
            ✔ Submit
          </button>
        </div>
      )}
      <button
        onClick={() => onCollapse(!collapsed)}
        aria-label={collapsed ? "Show the question" : "Minimize the question"}
        aria-expanded={!collapsed}
        title={collapsed ? "Show the question" : "Minimize, to read the thread"}
        className="ml-auto shrink-0 rounded p-0.5 text-muted hover:bg-panel hover:text-ink"
      >
        <Icon name="chevronDown" size={13} className={collapsed ? "rotate-180" : ""} />
      </button>
    </div>
  );
}

// The form's body, or once minimized just one line: the shown question, a click away from opening again.
export function Minimized({ collapsed, q, onOpen, children }: { collapsed: boolean; q?: Question; onOpen: () => void; children: ReactNode }) {
  if (!collapsed) return children;
  return (
    <button onClick={onOpen} className="mt-1 truncate text-left text-[12.5px] text-muted hover:text-ink">
      {q?.question ?? "Review your answers"}
    </button>
  );
}

// The shown question's options, numbered, with the highlight (❯) and, for multi-select, checkboxes.
export function Options({
  q,
  picked,
  cursor,
  sent,
  inlinePreview,
  onHover,
  onChoose,
  onType,
}: {
  q: Question;
  picked: string[];
  cursor: number;
  sent: boolean;
  inlinePreview?: string;
  onHover: (option: number) => void;
  onChoose: (option: number) => void;
  onType: () => void;
}) {
  return (
    <>
      <p className="text-[13px] font-medium leading-snug text-ink">{q.question}</p>
      <div role="listbox" aria-multiselectable={q.multiSelect || undefined} className="mt-1.5 flex flex-col">
        {q.options.map((option, i) => (
          <OptionRow
            key={option.label}
            number={i + 1}
            option={option}
            multi={Boolean(q.multiSelect)}
            on={picked.includes(option.label)}
            here={i === cursor}
            sent={sent}
            onHover={() => onHover(i)}
            onChoose={() => onChoose(i)}
          />
        ))}
        <button onClick={onType} className="flex items-start gap-2 rounded px-1.5 py-1 text-left text-[12.5px] text-muted hover:text-ink">
          <span className="w-3 shrink-0" />
          <span className="shrink-0 text-faint">{q.options.length + 1}.</span>
          <span>{picked.length ? "Add a note in the box below" : "Type something in the box below"}</span>
        </button>
      </div>
      {inlinePreview && (
        <pre className="mt-1.5 max-h-40 overflow-auto rounded border border-line-strong bg-panel px-2.5 py-2 font-mono text-[11.5px] text-ink">
          {inlinePreview}
        </pre>
      )}
    </>
  );
}

function OptionRow({
  number,
  option,
  multi,
  on,
  here,
  sent,
  onHover,
  onChoose,
}: {
  number: number;
  option: Question["options"][number];
  multi: boolean;
  on: boolean;
  here: boolean;
  sent: boolean;
  onHover: () => void;
  onChoose: () => void;
}) {
  return (
    <button
      role="option"
      aria-selected={on}
      onMouseEnter={onHover}
      onClick={onChoose}
      disabled={sent}
      className={`flex items-start gap-2 rounded px-1.5 py-1 text-left text-[12.5px] ${here ? "bg-panel" : ""}`}
    >
      <span className={`w-3 shrink-0 ${here ? "text-accent" : "text-transparent"}`} aria-hidden>
        ❯
      </span>
      <span className="shrink-0 text-faint">{number}.</span>
      {multi && <span className={`shrink-0 whitespace-pre ${on ? "text-accent" : "text-faint"}`}>{on ? "[✓]" : "[ ]"}</span>}
      <span className="min-w-0">
        <span className={`font-medium ${on || here ? "text-accent" : "text-ink"}`}>
          {option.label}
          {on && !multi && " ✓"}
        </span>
        {option.description && <span className="block text-[11.5px] text-muted">{option.description}</span>}
      </span>
    </button>
  );
}

// The Submit tab: what will be sent for each question; a click goes back to it.
export function Review({ questions, state, onTab }: { questions: Question[]; state: AnswerState; onTab: (tab: number) => void }) {
  return (
    <div className="flex flex-col gap-1 text-[12.5px]">
      <p className="font-medium text-ink">Review your answers</p>
      {summary(state, questions).map((line, i) => (
        <button key={`${line.label}-${String(i)}`} onClick={() => onTab(i)} className="text-left">
          <span className="text-muted">{line.label}: </span>
          {line.answer ? <span className="text-ink">{line.answer}</span> : <span className="text-warn">not answered</span>}
          {line.notes && <span className="block pl-3 text-[11.5px] text-muted">Note: {line.notes}</span>}
        </button>
      ))}
    </div>
  );
}

// Under the options: why a send didn't go (an error, or a send held as the question appeared), the keys,
// and the two ways out, Chat about this (the box's text instead of answers) and Skip.
export function FormFooter({ error, held, hint, onDecline }: { error: string | null; held: boolean; hint: string; onDecline?: (chat: boolean) => void }) {
  return (
    <>
      {error && <p className="mt-1.5 shrink-0 text-[12px] text-danger">{error}</p>}
      {held && !error && (
        <p className="mt-1.5 shrink-0 text-[12px] text-warn">This question just came in, so that send was held. Your text is still in the box.</p>
      )}
      <div className="mt-2 flex shrink-0 items-center gap-2 text-[11px]">
        <p className="min-w-0 flex-1 truncate text-faint">{hint}</p>
        {onDecline && (
          <>
            <button onClick={() => onDecline(true)} className="shrink-0 text-muted hover:text-ink">
              Chat about this
            </button>
            <button onClick={() => onDecline(false)} className="shrink-0 text-muted hover:text-ink">
              Skip
            </button>
          </>
        )}
      </div>
    </>
  );
}

// A folder outside the project that the question names: one click grants it as the answer (until it's sent).
export function ReadFrom({ readScope, sent, onClick }: { readScope?: PendingPermission["readScope"]; sent: boolean; onClick: () => void }) {
  if (!readScope || sent) return null;
  return (
    <button
      onClick={onClick}
      className="mt-2 shrink-0 rounded-md border border-accent bg-accent-soft px-3 py-1.5 text-left text-[12.5px] text-ink hover:bg-accent/30"
    >
      <span className="font-medium">Read from {readScope.token}</span>
      <span className="block text-[11.5px] text-muted">Grant this thread read access — no need to paste the file.</span>
    </button>
  );
}
