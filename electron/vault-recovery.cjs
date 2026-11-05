// A vault's recovery key (docs/architecture/teams-vault.md, "Recovery key"): the keypair nobody
// owns, that opens the vault when every machine is gone.
//
// The shape:
//
//   - The recovery key is a `devices` row with `user_id = null`, `name = 'recovery'` and
//     `fingerprint = 'recovery'`. It belongs to the vault, not to a person, and it is found by that
//     fingerprint rather than by a remembered uuid.
//   - Its private half is the 24 words the user writes down (electron/vault-recovery-words.cjs).
//     Weft never stores them: not in a file, not in the server, not in the event log, not in a
//     thread. The words are shown once and the user keeps them.
//   - The vault key is sealed to the recovery key's public half, so the recovery row's grant is
//     what a new machine opens.
//
// Two rules the code exists to keep:
//
//   1. The words are never persisted. `show()` returns them to the caller and forgets them; the
//      only thing it writes down is that the key was shown (`vault.recovery_shown`), with no words
//      in the row.
//   2. A re-show is a fresh key. The old words stop working the moment the user asks to see the
//      key again: a new keypair, a new device row, the old row revoked. That's the same shape as
//      Signal's safety-number re-roll, and it's what makes "shown once" mean something — a second
//      copy of the words can't be found by asking twice.
//
// The passphrase (Q2) sits between the words and the key: the words carry a seed, and
// scrypt(passphrase, vault_id) turns it into the seed the keypair is derived from. So the same
// words on a different vault, or the same words with a different passphrase, derive a different
// key and open nothing.
const { cryptoReady } = require("./vault-grant.cjs");
const { seedFor, wordsFromSeed, deriveSeed, parseWords, WORD_COUNT } = require("./vault-recovery-words.cjs");

// The recovery device's fingerprint: the marker the recovery card looks it up by.
const RECOVERY_FINGERPRINT = "recovery";
// The recovery device's name, the same on every vault.
const RECOVERY_NAME = "recovery";
// What the event log calls it when the key is shown. The row says it happened, not what it was.
const SHOWN_ACTION = "vault.recovery_shown";

/**
 * A shared vault, as the shared flow hands it over: the server's id, the unwrapped key, and the key
 * version that key is at. The key and the id are optional here only so the callers that *aren't*
 * supposed to have one can be written in a test — `makeKey` refuses a vault without them.
 * @typedef {{ id?: string, key?: string, keyVersion?: number, label?: string, orgId?: string, repo?: string }} SharedVault
 * @typedef {{ publicKey: string, privateKey?: string, id?: string }} Keypair
 */

/**
 * The signed-in user's id, from the JWT's claims — never from the caller, so a grant can't be written
 * in somebody else's name. The write itself is the RPC's job (it reads auth.uid() server-side); this
 * is the check that stops a signed-out desktop making the words at all.
 * @param {{ getClaims?: () => Record<string, unknown>|null }} accountClient
 * @returns {string}
 */
function actorId(accountClient) {
  const claims = accountClient?.getClaims?.() ?? null;
  const sub = claims && typeof claims.sub === "string" ? claims.sub : null;
  if (!sub) throw new Error("Sign in to Weft to use a vault's recovery key.");
  return sub;
}

// The recovery device, as the server holds it.
//
// The row is found by the marker fingerprint — not by a remembered uuid — but the fingerprint marks
// a *kind* of device, not a particular vault: every shared vault has one of its own. So the lookup
// goes through the vault's grants, each of which names the device that holds it. A vault with no
// live recovery grant has no recovery key, and another vault's recovery row is never mistaken for
// this one's.
//
// A re-show leaves the old grant in place with its device revoked, so the live grant is the one
// whose device isn't revoked — not simply the newest. (Both grants can share a key version: the
// vault's key didn't change, only which device holds it.)
async function readRecoveryDevice(client, vaultId) {
  const { data, error } = await client
    .from("vault_grants")
    .select("key_version, wrapped_key, device:devices(id, public_key, fingerprint, name, revoked_at)")
    .eq("vault_id", vaultId);
  if (error) throw new Error(`The recovery key could not be read: ${error.message}`);
  const rows = data ?? [];
  // The grant has to belong to a recovery device: a machine's grant is not the vault's key. The
  // newest live one is the current key.
  const live = rows
    .filter((row) => {
      const device = row.device;
      return device && device.fingerprint === RECOVERY_FINGERPRINT && !device.revoked_at;
    })
    .sort((a, b) => Number(a.key_version) - Number(b.key_version));
  const row = live[live.length - 1];
  if (!row) return null;
  return { ...row.device, keyVersion: Number(row.key_version), wrappedKey: row.wrapped_key };
}

/**
 * The keypair the words carry, as libsodium's base64 halves.
 *
 * The seed comes from the words (and the passphrase, when there is one), and libsodium turns the
 * seed into the keypair deterministically. The private half never leaves main: it is the seed's
 * whole job to be turned back into the same keypair on the machine that recovers.
 *
 * @param {{ words: string[]|string, passphrase?: string, vaultId: string, sodium?: any }} deps
 * @returns {Promise<Keypair>}
 */
async function keypairFromWords({ words, passphrase, vaultId, sodium }) {
  const sodiumModule = await cryptoReady(sodium);
  const parsed = parseWords(words);
  if (parsed.length !== WORD_COUNT) throw new Error(`A recovery key is ${WORD_COUNT} words — ${parsed.length} given.`);
  const seed = seedFor(parsed, passphrase ?? "", vaultId);
  return sodiumModule.seedKeypair(seed);
}

/**
 * Make a vault's recovery key material: the keypair, the sealed vault key, and the words.
 *
 * This is the pure crypto half — no network, no rows. The caller takes the result and writes it:
 * the device row and the grant go through the service client (the row has no owner, so the signed-in
 * user's own client may not create it), and the words go to the user.
 *
 * The words are returned and then forgotten. The server holds the public half (in the `devices`
 * row) and the sealed vault key (in the `vault_grants` row); the private half exists only in the
 * words.
 *
 * @param {{ vault: SharedVault, passphrase?: string, sodium?: any }} deps
 * @returns {Promise<{ words: string[], publicKey: string, wrappedKey: string, keyVersion: number }>}
 */
async function makeKey({ vault, passphrase = "", sodium }) {
  if (!vault?.id) throw new Error("A recovery key belongs to a vault.");
  if (!vault?.key) throw new Error("This vault's key isn't available, so a recovery key can't be made.");
  const sodiumModule = await cryptoReady(sodium);

  // The seed the words carry, and the keypair it means.
  //
  // The passphrase is applied *before* the keypair is made, not after: the words carry the
  // passphrase-derived seed, so the keypair the words reconstruct is the keypair whose public half
  // goes in the `devices` row. That is what makes the words the only copy of the private half —
  // there is no second seed anywhere, and the row on the server can't be used to derive the words.
  const raw = sodiumModule.randomBytes(32);
  const seed = deriveSeed(raw, passphrase, vault.id);
  const pair = sodiumModule.seedKeypair(seed);
  const publicKey = pair.publicKey;

  // The vault key, sealed to the recovery key. Only the words can open this.
  const keyVersion = Number(vault.keyVersion ?? 1);
  const wrappedKey = sodiumModule.wrapKey(vault.key, publicKey);

  // The words: the seed, as 24 words. This is the only copy of the private half.
  const words = wordsFromSeed(seed);

  return { words, publicKey, wrappedKey, keyVersion };
}

/**
 * Write a recovery key's rows: the device row (nobody owns it), the grant that seals the vault key to
 * it, and the event row that says the key was shown.
 *
 * All three happen in one transaction, inside `private.share_vault_recovery`. An ordinary client
 * cannot write them: the `devices` insert policy wants `auth.uid() = user_id` (and the recovery row
 * has no user id), and the `vault_grants` insert policy wants a device the caller owns (and the
 * recovery row belongs to nobody). The function runs as its owner and does the checks itself — the
 * caller has to be a member of the vault's workspace.
 *
 * A re-show is a fresh key: the function revokes the vault's old recovery row, so the old words
 * stop working the moment the new ones exist.
 *
 * What crosses this boundary is ciphertext: the public key and the sealed box. The words never
 * reach the database.
 *
 * @param {{ vault: SharedVault, client: any, publicKey: string, wrappedKey: string, keyVersion: number }} deps
 * @returns {Promise<{ deviceId: string }>}
 */
async function writeRecoveryRows({ vault, client, publicKey, wrappedKey, keyVersion }) {
  const { data: deviceId, error } = await client.rpc("share_vault_recovery", {
    p_vault_id: vault.id,
    p_public_key: publicKey,
    p_wrapped_key: wrappedKey,
    p_key_version: Number(keyVersion ?? 1),
  });
  if (error) throw new Error(`The recovery key could not be made: ${error.message}`);
  if (!deviceId) throw new Error("The recovery key could not be made.");
  return { deviceId };
}

/**
 * Make a vault's recovery key: the crypto, the rows, and the words.
 *
 * The words are returned and then forgotten — the caller shows them to the user and they go no
 * further. The server holds the public half (in the `devices` row) and the sealed vault key (in
 * the `vault_grants` row); the private half exists only in the words.
 *
 * @param {{ vault: SharedVault, accountClient: any, client?: any, passphrase?: string, sodium?: any }} deps
 * @returns {Promise<{ deviceId: string, words: string[], publicKey: string, keyVersion: number }>}
 */
async function generate({ vault, accountClient, client, passphrase = "", sodium }) {
  // A signed-out desktop has no business making the words: the write would fail anyway, and the
  // check comes first so nothing is derived for a request that can't land.
  if (accountClient) actorId(accountClient);
  const made = await makeKey({ vault, passphrase, sodium });
  const writer = client ?? accountClient?.supabase;
  if (!writer) throw new Error("Sign in to Weft to use a vault's recovery key.");
  const { deviceId } = await writeRecoveryRows({
    vault,
    client: writer,
    publicKey: made.publicKey,
    wrappedKey: made.wrappedKey,
    keyVersion: made.keyVersion,
  });
  return { deviceId, words: made.words, publicKey: made.publicKey, keyVersion: made.keyVersion };
}

/**
 * Show a vault's recovery key.
 *
 * A first show makes the key. A re-show makes a *fresh* one: the old words stop working, and the
 * old device row is revoked. That's the rule that makes "shown once" mean something — the user
 * can't quietly collect several live copies of the key by asking twice.
 *
 * The words are returned to the caller and go no further: not to a file, not to the server, not to
 * the event log. The event row says the key was shown, and carries no words.
 *
 * @param {{ vault: SharedVault, accountClient: any, client?: any, passphrase?: string, sodium?: any,
 *   reason?: string, confirm?: (reason: string) => Promise<boolean> }} deps
 * @returns {Promise<{ deviceId: string, words: string[], publicKey: string, keyVersion: number, shownAt: string, reshown: boolean }|{ denied: true }>}
 */
async function show({ vault, accountClient, client, passphrase = "", sodium, reason, confirm }) {
  if (!vault?.id) throw new Error("A recovery key belongs to a vault.");
  // The Touch ID gate. The user is about to see the key that opens their vault, so the gate is
  // here and not only in the caller: every path to the words goes through it.
  if (confirm && !(await confirm(reason ?? `show the recovery key for ${vault.label ?? vault.id}`))) {
    return { denied: true };
  }

  const writer = client ?? accountClient?.supabase;
  if (!writer) throw new Error("Sign in to Weft to use a vault's recovery key.");
  // A signed-out desktop has no business making the words: the check comes first so nothing is
  // derived for a request that can't land.
  if (accountClient) actorId(accountClient);
  await cryptoReady(sodium);

  // The old key, if there is one. The write below revokes it, so the old words stop working.
  const existing = await readRecoveryDevice(writer, vault.id);

  const made = await makeKey({ vault, passphrase, sodium });
  // One call: the device row, the grant and the event row, in one transaction.
  const { deviceId } = await writeRecoveryRows({
    vault,
    client: writer,
    publicKey: made.publicKey,
    wrappedKey: made.wrappedKey,
    keyVersion: made.keyVersion,
  });

  return {
    deviceId,
    words: made.words,
    publicKey: made.publicKey,
    keyVersion: made.keyVersion,
    shownAt: new Date().toISOString(),
    reshown: Boolean(existing),
  };
}

/**
 * Open a vault with the recovery words.
 *
 * The words are re-derived into the keypair, the keypair is matched against the vault's recovery
 * device row, the grant is fetched and unsealed, and the vault's key comes back. The grant row is
 * left in place — the user then grants their new machine from the team page as usual.
 *
 * A wrong passphrase, or words that were re-shown (so they no longer open anything), fail at the
 * unwrap: the sealed box doesn't open. The message says so without saying which of the two it was.
 *
 * @param {{ words: string[]|string, passphrase?: string, vault: SharedVault, client?: any, accountClient?: any, sodium?: any }} deps
 * @returns {Promise<{ key: string, keyVersion: number, deviceId: string }>}
 */
async function recover({ words, passphrase = "", vault, client, accountClient, sodium }) {
  if (!vault?.id) throw new Error("A recovery key belongs to a vault.");
  const sodiumModule = await cryptoReady(sodium);
  const reader = client ?? accountClient?.supabase;
  if (!reader) throw new Error("Sign in to Weft to use a vault's recovery key.");

  // The words are checked first: a malformed set is the user's typo, and saying "no recovery key"
  // for that would send them looking in the wrong place.
  const parsed = parseWords(words);
  if (parsed.length !== WORD_COUNT) throw new Error(`A recovery key is ${WORD_COUNT} words — ${parsed.length} given.`);

  // The recovery device row is the authority: the words have to match the key it holds.
  const device = await readRecoveryDevice(reader, vault.id);
  if (!device) throw new Error("That vault has no recovery key.");

  // Re-derive the keypair from the words, the passphrase and the vault's id.
  const keypair = await keypairFromWords({ words: parsed, passphrase, vaultId: vault.id, sodium: sodiumModule });
  if (keypair.publicKey !== device.public_key) {
    // The words are for a different key: either a re-shown set, a wrong passphrase, or a typo.
    throw new Error("Those words don't open this vault. Check them, and check the passphrase.");
  }

  const grant = { key_version: device.keyVersion, wrapped_key: device.wrappedKey };
  // The unwrap is the last check: a sealed box opens only with the right private half.
  let key;
  try {
    key = sodiumModule.unwrapKey(grant.wrapped_key, keypair);
  } catch {
    throw new Error("Those words don't open this vault. Check them, and check the passphrase.");
  }
  return { key, keyVersion: Number(grant.key_version), deviceId: device.id };
}

/**
 * Whether a vault has a recovery key yet, and when it was last shown. The drawer's chip and the
 * recovery page both ask.
 * @param {{ vaultId: string, client?: any, accountClient?: any }} deps
 * @returns {Promise<{ exists: boolean, deviceId: string|null, publicKey: string|null }>}
 */
async function recoveryStatus({ vaultId, client, accountClient }) {
  const reader = client ?? accountClient?.supabase;
  if (!reader) return { exists: false, deviceId: null, publicKey: null };
  const device = await readRecoveryDevice(reader, vaultId);
  return { exists: Boolean(device), deviceId: device?.id ?? null, publicKey: device?.public_key ?? null };
}

module.exports = { generate, makeKey, writeRecoveryRows, show, recover, recoveryStatus, keypairFromWords, RECOVERY_FINGERPRINT, RECOVERY_NAME, SHOWN_ACTION };
