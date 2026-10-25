import { useCallback, useState } from "react";
import { apiFetch } from "./api-client";
import { FEEDBACK_OPENER, type FeedbackMessage, type FeedbackSummary, type FeedbackTurn } from "./feedback";

// The feedback dot's chat (components/FeedbackDot.tsx): the transcript, Haiku's summary once it's ready, and
// whether it reached the team. Starts with the opener so the chat never waits on Haiku to say hello.

export const opening = (): FeedbackMessage[] => [{ role: "assistant", text: FEEDBACK_OPENER }];

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await apiFetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status}).`);
  return data;
}

export function useFeedback() {
  const [messages, setMessages] = useState<FeedbackMessage[]>(opening);
  const [summary, setSummary] = useState<FeedbackSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // null until Send; then whether the deployed Weft took it (false: kept on the Mac only).
  const [sent, setSent] = useState<boolean | null>(null);

  const ask = useCallback(async (next: FeedbackMessage[], wrap: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const turn = await post<FeedbackTurn>("/api/feedback", { messages: next, wrap });
      setMessages([...next, { role: "assistant", text: turn.reply }]);
      setSummary(turn.summary);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }, []);

  const say = useCallback(
    (text: string) => {
      const clean = text.trim();
      if (!clean || busy) return;
      const next = [...messages, { role: "user" as const, text: clean }];
      setMessages(next);
      setSummary(null);
      void ask(next, false);
    },
    [ask, busy, messages],
  );

  const wrapUp = useCallback(() => {
    if (!busy) void ask(messages, true);
  }, [ask, busy, messages]);

  const send = useCallback(async () => {
    if (!summary || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await post<{ sent: boolean }>("/api/feedback/send", { messages, summary });
      setSent(res.sent);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }, [busy, messages, summary]);

  const reset = useCallback(() => {
    setMessages(opening());
    setSummary(null);
    setError(null);
    setSent(null);
  }, []);

  const answered = messages.some((m) => m.role === "user");
  return { messages, summary, busy, error, sent, answered, say, wrapUp, send, reset };
}
