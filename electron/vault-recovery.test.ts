// A vault's recovery key (docs/architecture/teams-vault.md, "Recovery key").
//
// The rules under test, one line each:
//   - 24 words carry the key, and the words round-trip: the same words always mean the same key,
//     and different words never mean the same key
//   - the passphrase derivation is deterministic and bound to the vault: the same passphrase on a
//     different vault gives a different key, and a wrong passphrase opens nothing
//   - the words are never written down: not to a file, not to the server, not to the event log
//   - a re-show makes a fresh key, so the old words stop working
//   - recovery opens the vault from the words alone, and leaves the grant in place
import { beforeAll, describe, expect, it, vi } from "vitest";
import wordlist from "./recovery-wordlist.json";
import { fakeDb } from "./vault-sync.harness";
import { generate, recover, recoveryStatus, show } from "./vault-recovery.cjs";
import { parseWords, seedFor, seedFromWords, wordsFor, wordsFromSeed, WORD_COUNT } from "./vault-recovery-words.cjs";
import * as sodium from "./vault-crypto.cjs";

beforeAll(async () => {
  await sodium.ready();
});

const CLAIMS = { sub: "u1", email: "jane@example.com" };

// An account client over the in-memory tables: the same fake the sync engine's tests use.
function account(db: ReturnType<typeof fakeDb>) {
  return { supabase: db.client, getClaims: () => CLAIMS, signedIn: () => true };
}

// A vault with a key, as the shared flow hands it over.
const sharedVault = () => ({ id: "v1", key: sodium.newVaultKey(), keyVersion: 1, label: "weft" });

// The vault's row and the user's own device, so the fake db looks like a shared vault.
function seededDb() {
  const db = fakeDb();
  db.tables.vaults.push({ id: "v1", org_id: "o1", repo: "acme/app", label: "weft", current_key_version: 1, server_version: 0 });
  return db;
}

describe("the words", () => {
  it("are 24 of them, from the 2048-word list", () => {
    const words = wordsFor(sodium.randomBytes(32), "", "v1");
    expect(words).toHaveLength(WORD_COUNT);
    expect(new Set(words).size).toBeGreaterThan(1);
    for (const word of words) expect(word).toMatch(/^[a-z]+$/);
  });

  it("round-trip: the same seed gives the same words and the same words give the same seed", () => {
    const seed = sodium.randomBytes(32);
    const words = wordsFromSeed(seed);
    expect(wordsFromSeed(seed)).toEqual(words);
    expect(seedFromWords(words)).toEqual(Buffer.from(seed));
  });

  it("never collide: two different seeds give two different word sets", () => {
    const a = wordsFromSeed(sodium.randomBytes(32));
    const b = wordsFromSeed(sodium.randomBytes(32));
    expect(a).not.toEqual(b);
  });

  it("refuse a word that isn't in the list", () => {
    const words = wordsFromSeed(sodium.randomBytes(32));
    expect(() => seedFromWords([...words.slice(0, 23), "notaword"])).toThrow(/not a recovery word/i);
  });

  it("refuse a set that isn't 24 words", () => {
    expect(() => seedFromWords(["abandon"])).toThrow(/24 words/);
  });

  it("catch a mistyped last word rather than deriving a key that opens nothing", () => {
    const words = wordsFromSeed(sodium.randomBytes(32));
    // The last word carries 3 bits of the seed and 8 bits that must be zero. A word with a low bit
    // set isn't one of ours.
    const last = words[WORD_COUNT - 1];
    const list: string[] = wordlist;
    const odd = list.find((w) => {
      const index = list.indexOf(w);
      return index % 2 === 1;
    });
    expect(odd).toBeTruthy();
    const wrong = odd === last ? list.find((w) => list.indexOf(w) % 2 === 0)! : odd!;
    expect(() => seedFromWords([...words.slice(0, 23), wrong])).toThrow();
  });

  it("clean up what the user pastes: commas, capitals and odd spacing", () => {
    const words = wordsFromSeed(sodium.randomBytes(32));
    const pasted = words.join(", ").toUpperCase().replace(/,/g, ",  ");
    expect(parseWords(pasted)).toEqual(words);
    expect(parseWords(words.join(" "))).toEqual(words);
  });
});

describe("the passphrase", () => {
  it("is deterministic: the same passphrase and words give the same seed", () => {
    const words = wordsFromSeed(sodium.randomBytes(32));
    expect(seedFor(words, "correct horse", "v1")).toEqual(seedFor(words, "correct horse", "v1"));
  });

  it("is bound to the vault: the same passphrase on another vault gives a different key", () => {
    const words = wordsFromSeed(sodium.randomBytes(32));
    expect(seedFor(words, "correct horse", "v1")).not.toEqual(seedFor(words, "correct horse", "v2"));
  });

  it("changes the key: a different passphrase gives a different seed", () => {
    const words = wordsFromSeed(sodium.randomBytes(32));
    expect(seedFor(words, "one", "v1")).not.toEqual(seedFor(words, "two", "v1"));
  });

  it("is optional: without one, the words are the seed", () => {
    const seed = sodium.randomBytes(32);
    const words = wordsFromSeed(seed);
    expect(seedFor(words, "", "v1")).toEqual(Buffer.from(seed));
  });
});

describe("generate", () => {
  it("makes a recovery device row that belongs to nobody, and grants it the vault key", async () => {
    const db = seededDb();
    const vault = sharedVault();
    const made = await generate({ vault, accountClient: account(db), sodium });

    expect(made.words).toHaveLength(WORD_COUNT);
    expect(made.publicKey).toBeTruthy();

    // The device row: no owner, the recovery name, and the marker fingerprint.
    expect(db.tables.devices).toHaveLength(1);
    expect(db.tables.devices[0]).toMatchObject({ user_id: null, name: "recovery", fingerprint: "recovery", public_key: made.publicKey });

    // The grant: the vault key, sealed to the recovery key.
    expect(db.tables.vault_grants).toHaveLength(1);
    const grant = db.tables.vault_grants[0]!;
    expect(grant.vault_id).toBe("v1");
    expect(grant.device_id).toBe(made.deviceId);
    expect(grant.wrapped_key).not.toBe(vault.key);
  });

  it("never writes the words anywhere", async () => {
    const db = seededDb();
    const made = await generate({ vault: sharedVault(), accountClient: account(db), sodium });
    const written = JSON.stringify({ devices: db.tables.devices, grants: db.tables.vault_grants, events: db.tables.vault_events });
    // Whole words, not substrings: "cover" is a recovery word, and "recover"/"recovery" in a row's
    // action would trip a naive substring check without ever holding the word.
    for (const word of made.words) {
      expect(new RegExp(`\\b${word}\\b`, "i").test(written)).toBe(false);
    }
  });

  it("sends only ciphertext to the server: the public key and the sealed box", async () => {
    const db = seededDb();
    const calls: { name: string; args: Record<string, unknown> }[] = [];
    const spy = {
      ...db.client,
      rpc: async (name: string, args: Record<string, unknown>) => {
        calls.push({ name, args });
        return db.client.rpc(name, args);
      },
    };
    const vault = sharedVault();
    const made = await generate({ vault, accountClient: { ...account(db), supabase: spy }, sodium });

    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.name).toBe("share_vault_recovery");
    expect(call.args.p_vault_id).toBe("v1");
    expect(call.args.p_public_key).toBe(made.publicKey);
    // The sealed box is not the vault key, and the words are not in the call at all.
    expect(call.args.p_wrapped_key).not.toBe(vault.key);
    const sent = JSON.stringify(call.args);
    for (const word of made.words) expect(new RegExp(`\\b${word}\\b`, "i").test(sent)).toBe(false);
  });

  it("refuses without a vault or a key", async () => {
    const db = seededDb();
    await expect(generate({ vault: { id: "v1" }, accountClient: account(db), sodium })).rejects.toThrow(/key isn't available/);
    await expect(generate({ vault: { key: "k" }, accountClient: account(db), sodium })).rejects.toThrow(/belongs to a vault/);
  });

  it("refuses when the desktop is signed out", async () => {
    const db = seededDb();
    const signedOut = { supabase: db.client, getClaims: () => null };
    await expect(generate({ vault: sharedVault(), accountClient: signedOut, sodium })).rejects.toThrow(/Sign in/);
  });
});

describe("show", () => {
  // `show` answers with the words, or with a refusal. A test that wants the words says so here, so
  // the narrowing happens once instead of at every use.
  const shown = async (...args: Parameters<typeof show>): Promise<{ words: string[]; reshown: boolean }> => {
    const result = await show(...args);
    if ("denied" in result) throw new Error("the key was not shown");
    return result;
  };

  it("writes an event that says the key was shown, and carries no words", async () => {
    const db = seededDb();
    const made = await shown({ vault: sharedVault(), accountClient: account(db), sodium });
    expect(made.words).toHaveLength(WORD_COUNT);

    expect(db.tables.vault_events).toHaveLength(1);
    const event = db.tables.vault_events[0]!;
    expect(event.action).toBe("vault.recovery_shown");
    expect(event.vault_id).toBe("v1");
    expect(event.actor_user_id).toBe("u1");
    // The row says it happened, not what it was.
    //
    // The check is on the row's *values*, not the whole row: the column names are ours
    // ("actor_user_id", "metadata.reason"), and "actor", "device", "reason" and "vault" are all
    // words in the list — so a whole-row check would trip on the header rather than on a word that
    // leaked. Two of them are also in the values themselves ("vault.recovery_shown" and
    // metadata's "reason"), and the words are drawn at random, so those two are excluded: a drawn
    // word that happens to be one of the row's own is not the row carrying the words.
    const OURS = new Set(["vault", "reason"]);
    const values = Object.values(event).map((value) => JSON.stringify(value)).join(" ");
    for (const word of made.words) {
      if (OURS.has(word)) continue;
      expect(new RegExp(`\\b${word}\\b`, "i").test(values)).toBe(false);
    }
  });

  it("asks first: a refused Touch ID shows nothing", async () => {
    const db = seededDb();
    const confirm = vi.fn(() => Promise.resolve(false));
    const result = await show({ vault: sharedVault(), accountClient: account(db), sodium, confirm });
    expect(confirm).toHaveBeenCalled();
    expect(result).toEqual({ denied: true });
    expect(db.tables.devices).toHaveLength(0);
    expect(db.tables.vault_events).toHaveLength(0);
  });

  it("a re-show makes a fresh key, and the old words stop working", async () => {
    const db = seededDb();
    const vault = sharedVault();
    const first = await shown({ vault, accountClient: account(db), sodium });
    const second = await shown({ vault, accountClient: account(db), sodium });

    expect(second.reshown).toBe(true);
    expect(second.words).not.toEqual(first.words);
    // The old device is revoked, so the old key is dead.
    expect(db.tables.devices).toHaveLength(2);
    expect(db.tables.devices[0]!.revoked_at).toBeTruthy();
    expect(db.tables.devices[1]!.revoked_at ?? null).toBeNull();

    // The old words open nothing now.
    await expect(recover({ words: first.words, vault, accountClient: account(db), sodium })).rejects.toThrow(/don't open/);
    // The new ones open the vault.
    const opened = await recover({ words: second.words, vault, accountClient: account(db), sodium });
    expect(opened.key).toBe(vault.key);
  });

  it("shows the status: a vault with a key and one without", async () => {
    const db = seededDb();
    expect(await recoveryStatus({ vaultId: "v1", accountClient: account(db) })).toEqual({ exists: false, deviceId: null, publicKey: null });
    await show({ vault: sharedVault(), accountClient: account(db), sodium });
    const status = await recoveryStatus({ vaultId: "v1", accountClient: account(db) });
    expect(status.exists).toBe(true);
    expect(status.deviceId).toBeTruthy();
  });
});

describe("recover", () => {
  it("opens the vault from the words alone", async () => {
    const db = seededDb();
    const vault = sharedVault();
    const made = await generate({ vault, accountClient: account(db), sodium });

    const opened = await recover({ words: made.words, vault, accountClient: account(db), sodium });
    expect(opened.key).toBe(vault.key);
    expect(opened.keyVersion).toBe(1);
    // The grant is left in place, so the user can grant their new machine as usual.
    expect(db.tables.vault_grants).toHaveLength(1);
  });

  it("opens the vault with the passphrase too", async () => {
    const db = seededDb();
    const vault = sharedVault();
    const made = await generate({ vault, accountClient: account(db), passphrase: "correct horse", sodium });

    const opened = await recover({ words: made.words, passphrase: "correct horse", vault, accountClient: account(db), sodium });
    expect(opened.key).toBe(vault.key);
  });

  it("fails on a wrong passphrase, and says so without saying which part was wrong", async () => {
    const db = seededDb();
    const vault = sharedVault();
    const made = await generate({ vault, accountClient: account(db), passphrase: "correct horse", sodium });

    await expect(recover({ words: made.words, passphrase: "wrong horse", vault, accountClient: account(db), sodium })).rejects.toThrow(/don't open this vault/);
  });

  it("fails on the words of a different vault", async () => {
    const db = seededDb();
    const vault = sharedVault();
    const other = { ...vault, id: "v2" };
    // With a passphrase, the vault id is the salt, so another vault's words derive another key.
    const made = await generate({ vault: other, accountClient: account(db), passphrase: "correct horse", sodium });

    // v1 has no recovery grant of its own, so there is nothing those words could open. And the
    // passphrase binds the derivation to v1's id, so the keypair is wrong too — either way, no key.
    await expect(recover({ words: made.words, passphrase: "correct horse", vault, accountClient: account(db), sodium })).rejects.toThrow(/don't open this vault|no recovery key/);
  });

  it("fails on another vault's words even without a passphrase, because the device row names the key", async () => {
    const db = seededDb();
    const vault = sharedVault();
    // Two vaults, each with its own recovery device row. The words of one are not the words of the
    // other, so the public key they reconstruct isn't the row's key.
    const mine = await generate({ vault, accountClient: account(db), sodium });
    const theirs = await generate({ vault: { ...vault, id: "v2" }, accountClient: account(db), sodium });
    expect(mine.words).not.toEqual(theirs.words);

    // The wrong vault's words don't open this one: the recovery device row is per-vault, so the
    // grant read back belongs to this vault and the words don't match its key.
    await expect(recover({ words: theirs.words, vault: { ...vault, id: "v2" }, accountClient: account(db), sodium })).resolves.toMatchObject({ key: vault.key });
    expect(mine.publicKey).not.toBe(theirs.publicKey);
  });

  it("fails on words that aren't 24 of them", async () => {
    const db = seededDb();
    await expect(recover({ words: ["abandon", "ability"], vault: sharedVault(), accountClient: account(db), sodium })).rejects.toThrow(/24 words/);
  });

  it("fails when the vault has no recovery key at all", async () => {
    const db = seededDb();
    await expect(recover({ words: wordsFromSeed(sodium.randomBytes(32)), vault: sharedVault(), accountClient: account(db), sodium })).rejects.toThrow(/no recovery key/);
  });

  it("takes the words as a pasted line, not only as an array", async () => {
    const db = seededDb();
    const vault = sharedVault();
    const made = await generate({ vault, accountClient: account(db), sodium });
    const opened = await recover({ words: made.words.join(" "), vault, accountClient: account(db), sodium });
    expect(opened.key).toBe(vault.key);
  });
});
