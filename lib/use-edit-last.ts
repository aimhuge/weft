import { useState } from "react";
import { lastSent } from "./edit-last";
import type { Card, ThreadItem } from "./types";

// ↑ in a board thread's reply box: the message it pulls back (your last one), and while you edit it,
// the thread index to mark: that message, and after it the turn the edit will replace. A message that
// can't rewind goes out as a new one, so nothing is marked. The copilot's thread doesn't edit, and neither does one
// whose transport has no edit (lib/thread-transport.ts: weft.zip's).
// track: draws the edit in the thread while it's sent (lib/use-pending-sends.ts); `after` is the index after the
// message it replaces, where its own message lands.
type Track = (text: string, call: () => Promise<void>, after: number) => Promise<void>;

export function useEditLast(card: Card, items: ThreadItem[], edit: ((cardId: string, text: string) => Promise<void>) | undefined, onEdited: () => void, track?: Track) {
  // The card whose box is editing, so switching threads doesn't carry the marks over.
  const [editingId, setEditingId] = useState<string | null>(null);
  const onEditing = (on: boolean) => setEditingId(on ? card.id : null);
  const last = card.role === "copilot" || !edit ? undefined : lastSent(items);
  if (!last || !edit) return { editLast: undefined, editFrom: undefined, onEditing };
  const canRewind = Boolean(last.promptId);
  const onEdit = async (text: string) => {
    const send = () => edit(card.id, text);
    onEdited();
    await (track ? track(text, send, last.index + 1) : send());
  };
  return {
    editLast: { text: last.text, canRewind, fileEdits: last.fileEdits, onEdit },
    editFrom: editingId === card.id && canRewind ? last.index : undefined,
    onEditing,
  };
}
