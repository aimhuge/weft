// The shared vault's side of the board's IPC (docs/architecture/teams-vault.md, "How a local vault
// becomes a shared one" and "Granting a teammate's devices"). electron/vault-ipc.cjs calls into here.
//
// These need the vault's unwrapped key or this device's keypair, things only Electron main holds:
//
//   shareLocal    the first time a local vault is shared: the vault row, the first grant, and the
//     local secrets imported as the server's rows.
//   requestJoin   a teammate's Mac asks for a vault its workspace already shares.
//   grantPending  an admin approves it: this vault's key sealed to that Mac (electron/vault-share.cjs).
//   join          the teammate's Mac opens the grant and adopts the shared key.
//
// The key is read from the vault store, passed to the wrap, and dropped. It is never written to a
// file, a log, a request or an IPC payload. The server only ever sees the sealed box.
//
// Everything the sync engine does is injected, not required: electron/vault-sync.cjs may not exist
// yet, and this file has to work without it. When it is there, a granted device pulls the server's
// rows into its local shadow right after the key opens.
const { grantPendingDevice, shareLocalVault, readPending } = require("./vault-share.cjs");
const { openGrant } = require("./vault-grant.cjs");
const { rotateForMember, writeRotate } = require("./vault-rotate.cjs");

/** @typedef {{ name: string, environment: string, ciphertext?: string, nonce?: string, keyVersion?: number, hint?: string }} Secret */

/**
 * The shared-vault calls the board can make.
 *
 * @param {{ readVault: (folder: string) => Promise<{ id: string, label: string, key: string, keyVersion: number, secrets: Secret[] }>,
 *   readServerVault?: (vaultId: string) => Promise<{ localId?: string, key: string, keyVersion: number, label: string }>,
 *   device: { id?: string, publicKey: string, privateKey?: string }, sodium?: any, prompt?: (reason: string) => Promise<boolean>,
 *   adopt?: (folder: string, grant: { key: string, keyVersion: number, wrappedKey: string }, shared: { orgId: string, vaultId: string, repo: string, keyVersion: number }) => Promise<unknown>,
 *   sync?: any, checkRepo?: (repo: string) => Promise<boolean> }} deps
 */
function createSharedApi({ readVault, readServerVault, device, sodium, prompt = async () => true, adopt, sync = null, checkRepo }) {
  return {
    /**
     * The granter seals this vault's key to the device that accepted the pending grant.
     *
     * The pending row names the server's vault; the local file is that vault's shadow. The key
     * comes from the local file, because that is the only place it is. One device gets every key
     * in the vault, so this takes Touch ID.
     */
    /** @param {{ pendingId: string, accountClient: any }} opts */
    async grantPending({ pendingId, accountClient }) {
      const pending = await readPending(accountClient, pendingId);
      if (!pending) throw new Error("That grant isn't waiting any more.");
      const vault = await readServerVault(pending.vault_id);
      if (!(await prompt(`give another Mac every key in ${vault.label}`))) return { denied: true };
      const granted = await grantPendingDevice({
        accountClient,
        pendingId,
        vault: { id: pending.vault_id, key: vault.key, keyVersion: vault.keyVersion },
        device,
        sodium,
      });
      return granted;
    },

    /** An admin says no, or the Mac's owner takes the request back. */
    /** @param {{ pendingId: string, accountClient: any }} opts */
    async declinePending({ pendingId, accountClient }) {
      const { error } = await accountClient.supabase.rpc("decline_vault_device", { p_pending_id: pendingId });
      if (error) throw new Error(`That request could not be declined: ${error.message}`);
      return { declined: true };
    },

    /** This Mac asks to join a vault its workspace already shares. Nothing is sealed yet. */
    /** @param {{ vaultId: string, accountClient: any }} opts */
    async requestJoin({ vaultId, accountClient }) {
      const { data, error } = await accountClient.supabase.rpc("request_vault_device", { p_vault_id: vaultId, p_device_id: device.id });
      if (error) throw new Error(`This Mac could not ask to join: ${error.message}`);
      return { pendingId: data };
    },

    /**
     * The first time a local vault is shared with a workspace.
     */
    /** @param {{ folder: string, orgId: string, repo: string, label?: string, accountClient: any }} opts */
    async shareLocal({ folder, orgId, repo, label, accountClient }) {
      const vault = await readVault(folder);
      const result = await shareLocalVault({
        accountClient,
        orgId,
        repo,
        label: label ?? vault.label,
        device,
        vault: { id: vault.id, key: vault.key, keyVersion: vault.keyVersion, secrets: vault.secrets },
        checkRepo,
        markShared: (localId, value) => sync?.markShared?.(localId, value),
        sodium,
      });
      // The vault row and the secrets are in; the shadow follows on the next pull.
      await sync?.pull?.(vault.id).catch(() => null);
      return result;
    },

    /**
     * The joining side, on the teammate's Mac, once an admin approved it: open the grant and make
     * the shared key this Mac's key for the vault. Touch ID, because it replaces the local key.
     */
    /** @param {{ folder: string, vaultId: string, orgId: string, repo: string, accountClient: any }} opts */
    async join({ folder, vaultId, orgId, repo, accountClient }) {
      if (!(await prompt(`open the shared vault for ${repo}`))) return { denied: true };
      const grant = await openGrant({ accountClient, vaultId, myDevice: device, sodium });
      await adopt(folder, grant, { orgId, vaultId, repo, keyVersion: grant.keyVersion });
      return { joined: true, keyVersion: grant.keyVersion };
    },

    /**
     * Rotate every vault a member's machines had a grant on, around those machines
     * (docs/architecture/teams-vault.md, "Removal and rotation").
     *
     * The crypto is here, in main: the new vault key is made here, sealed to the devices that stay,
     * and used to re-encrypt the values. The plan goes to weft.zip, which writes it — the server
     * never holds a key. The answer is the names to change at the providers: names only, never a
     * value.
     */
    /** @param {{ org: string, userId: string, accountClient: any, token?: string|null }} opts */
    async rotate({ org, userId, accountClient, token = null }) {
      const { plans, namesToRotate } = await rotateForMember({ orgId: org, userId, accountClient, device, sodium });
      const written = [];
      for (const plan of plans) {
        const result = await writeRotate({ plan, org, token });
        if (!result.ok) return { ok: false, error: result.error, namesToRotate, rotated: written.length };
        written.push(result.keyVersion);
      }
      // The machine that rotated pulls the new rows into its own shadow.
      for (const plan of plans) await sync?.pull?.(plan.vaultId).catch(() => null);
      return { ok: true, rotated: written.length, namesToRotate };
    },
  };
}

// The board's shared-vault calls, each on a fresh API: the device has to be read as the signed-in user.
function sharedHandlers(shared, token) {
  const call = (name, extra = () => ({})) => async (opts) => (await shared())[name]({ ...opts, ...extra() });
  return {
    grantPending: call("grantPending"),
    declinePending: call("declinePending"),
    requestJoin: call("requestJoin"),
    join: call("join"),
    shareLocal: call("shareLocal"),
    rotate: call("rotate", () => ({ token: token() })),
  };
}

module.exports = { createSharedApi, sharedHandlers };
