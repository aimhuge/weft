// A shared vault's conflict, as the drawer sees it (docs/architecture/teams-vault.md, "Push on
// change"). A write that lost the row's optimistic-concurrency check comes back as
// { conflict: true, current } — the server's row — and the drawer offers the two ways out:
// keep your edit, or keep theirs.
//
// What crosses to the renderer is metadata only: who wrote the row, which name and environment,
// and the server's row_version (what a re-push expects). The row itself is a ciphertext row: it
// stays here, in main, and never reaches the page. A value never leaves main either.

// Who wrote the row a write lost against: the newest event for that name and environment, whose
// actor_email is denormalized on the row (docs/architecture/teams-vault.md, "vault_events"). The
// name is the email's local part, the same rule the event log uses (lib/vault-events.ts). A row
// the log doesn't know about says "A member" rather than blaming nobody.
async function conflictActor(db, vaultId, name, environment) {
  if (!vaultId || !db) return "A member";
  try {
    const { data, error } = await db
      .from("vault_events")
      .select("actor_email")
      .eq("vault_id", vaultId)
      .eq("target_name", name)
      .eq("target_environment", environment)
      .order("created_at", { ascending: false })
      .limit(1);
    if (error || !data?.length) return "A member";
    const email = typeof data[0].actor_email === "string" ? data[0].actor_email.trim() : "";
    if (!email) return "A member";
    return email.split("@")[0] || email;
  } catch {
    return "A member";
  }
}

// The conflict the drawer shows: who wrote the row, which name and environment, and the server's
// row_version. Only these fields are read out of the server's row, so no value or ciphertext
// crosses the IPC boundary.
/** @returns {Promise<{ name: string, environment: string, actor: string, rowVersion: number, blank: boolean }>} */
async function conflictOf({ db, vaultId, lost }) {
  const current = lost.current;
  return {
    name: lost.name,
    environment: lost.environment,
    actor: await conflictActor(db, vaultId, lost.name, lost.environment),
    rowVersion: current ? Number(current.row_version) : 0,
    blank: Boolean(current?.is_blank),
  };
}

// A write against a shared vault, and the conflict it answers with, if it lost.
//
// A local vault has no row_version and therefore can never conflict: the store answers nothing, as
// it always has. A shared vault answers { conflicts: [{ name, environment, current }], queued },
// where `current` is the server's row the write lost against.
//
// A row the server still holds as a blank holds no value on the other side, so there is nothing to
// resolve: the edit is written again against the row's current version and the drawer shows no
// banner (docs/architecture/teams-vault.md, "Push on change").
/** @returns {Promise<{ saved: true, queued?: boolean } | { saved: false, conflict: { name: string, environment: string, actor: string, rowVersion: number, blank: boolean } }>} */
async function writeValue({ store, id, label, entry, db, vaultId }) {
  let pushed = await store.set(id, label, [entry]);
  if (pushed?.conflicts?.[0]?.current?.is_blank) pushed = await store.set(id, label, [entry]);
  const lost = pushed?.conflicts?.[0];
  if (lost) return { saved: false, conflict: await conflictOf({ db, vaultId, lost }) };
  return { saved: true, ...(pushed?.queued && { queued: true }) };
}

module.exports = { conflictActor, conflictOf, writeValue };
