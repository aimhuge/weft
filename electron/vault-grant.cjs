// Sealing a shared vault's key to a device, and opening it again (docs/architecture/teams-vault.md,
// "Granting a teammate's devices").
//
// The rule this file exists to keep: the server only ever stores a sealed box. The vault key is
// unwrapped in Electron main and never leaves it — not to Supabase, not to a file, not to a thread.
// The wrap is a libsodium `crypto_box_seal` (electron/vault-crypto.cjs's wrapKey): only the target
// device's private half opens it, and that half never leaves electron/device-key.cjs.
//
// Who wraps: strictly the granter. Their main holds the unwrapped vault key and the new device's
// public key, so it is the only place the two can be combined. The new device's machine can only
// unwrap, and only with its own private key.
//
// The AAD binds a ciphertext to its vault, name, environment and key version, so a row copied onto
// another name fails to open instead of decrypting. The sealed key itself carries no AAD (a
// libsodium sealed box is anonymous and ephemeral), so the binding is on the values it opens.

/** @typedef {{ publicKey: string, privateKey: string }} Keypair */
/** @typedef {{ id?: string, publicKey: string, privateKey?: string }} Device */

// The crypto module, ready to use. libsodium's ready() is a promise, so every async caller awaits
// this before it seals or opens anything; the module caches its own state, so waiting twice is cheap.
//
// The crypto module is injected rather than required (the way electron/vault-store.cjs takes it), so
// a caller and this module share one instance of it. A test that hands in the same module the test
// itself uses gets one ready() for both; requiring it here would load a second copy whose libsodium
// was never awaited.
let cryptoModule = null;

/**
 * The crypto module, awaited into readiness.
 * @param {any} [injected] The module to use; the first one given wins.
 * @returns {Promise<any>}
 */
async function cryptoReady(injected) {
  cryptoModule ??= injected ?? require("./vault-crypto.cjs");
  await cryptoModule.ready();
  return cryptoModule;
}

// The crypto module, for the calls that need it synchronously. Throws the same "Call ready()" the
// crypto module itself throws when nobody has awaited it yet.
function crypto() {
  if (!cryptoModule) throw new Error("Call ready() before using the vault's crypto.");
  return cryptoModule;
}

/**
 * The vault's key, sealed to one device.
 *
 * @param {{ vault: { id?: string, key?: string, keyVersion?: number }, granterDevice: Device, newDevice: { id?: string, publicKey: string } }} deps
 * @returns {{ wrappedKey: string, keyVersion: number, deviceId: string | null }}
 */
function wrapForDevice({ vault, granterDevice, newDevice }) {
  const key = vault?.key;
  if (typeof key !== "string" || !key) throw new Error("This vault's key isn't available, so it can't be shared.");
  const publicKey = newDevice?.publicKey;
  if (typeof publicKey !== "string" || !publicKey) throw new Error("That device has no public key, so the vault key can't be sealed to it.");
  // The granter seals with the key their own device holds. A granter that isn't the holder of the
  // vault key would seal a key nobody can open.
  if (!granterDevice?.publicKey) throw new Error("This device has no key to share.");
  return {
    wrappedKey: crypto().wrapKey(key, publicKey),
    keyVersion: Number(vault.keyVersion ?? 1),
    deviceId: typeof newDevice.id === "string" ? newDevice.id : null,
  };
}

/**
 * The vault's key, opened again on the device it was sealed to.
 *
 * @param {{ vault: { id?: string, key?: string, keyVersion?: number }, myDevice: Partial<Keypair>, wrappedKey: string }} deps
 * @returns {{ key: string, keyVersion: number }}
 */
function acceptGrant({ vault, myDevice, wrappedKey }) {
  if (typeof wrappedKey !== "string" || !wrappedKey) throw new Error("That grant carries no key.");
  if (!myDevice?.privateKey) throw new Error("This device has no private key, so the grant can't be opened.");
  return { key: crypto().unwrapKey(wrappedKey, myDevice), keyVersion: Number(vault?.keyVersion ?? 1) };
}

// The AAD a value under this vault is bound to. The vault id is the server's uuid for a shared vault
// and the local "github:owner/name" for a local one — the same string the ciphertext was made with.
function aadFor(vaultId, name, environment, keyVersion) {
  return crypto().aad(vaultId, name, environment, keyVersion);
}

/**
 * The accepting side, on the new device: fetch the grant the granter wrote, open it with this
 * device's own private key, and hand back the vault's key.
 *
 * The grant row is read from the server by (vault, device) — RLS only returns a grant for a device
 * the signed-in user owns, so a caller can't name somebody else's device and get a key. The wrapped
 * key is a sealed box; opening it needs this device's private half, which never leaves
 * electron/device-key.cjs.
 *
 * @param {{ accountClient: any, vaultId: string, myDevice: Partial<Keypair> & { id?: string }, sodium?: any }} deps
 * @returns {Promise<{ key: string, keyVersion: number, wrappedKey: string }>}
 */
async function openGrant({ accountClient, vaultId, myDevice, sodium }) {
  const deviceId = myDevice?.id;
  if (!deviceId) throw new Error("This device isn't registered, so the grant can't be opened.");
  await cryptoReady(sodium);
  const { data, error } = await accountClient.supabase
    .from("vault_grants")
    .select("key_version, wrapped_key")
    .eq("vault_id", vaultId)
    .eq("device_id", deviceId)
    .order("key_version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`That grant could not be read: ${error.message}`);
  if (!data) throw new Error("This device has no grant for that vault yet.");
  const { key, keyVersion } = acceptGrant({ vault: { id: vaultId, keyVersion: data.key_version }, myDevice, wrappedKey: data.wrapped_key });
  return { key, keyVersion, wrappedKey: data.wrapped_key };
}

module.exports = { wrapForDevice, acceptGrant, openGrant, aadFor, cryptoReady };
