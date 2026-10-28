// The shared vault's side of the board's IPC (docs/architecture/teams-vault.md, "How a local vault
// becomes a shared one" and "Granting a teammate's devices"). electron/vault-ipc.cjs calls into here.
//
// Two things happen here, both of which need the vault's unwrapped key and this device's keypair —
// things only Electron main holds:
//
//   grantPending  the granter's side of a TOFU handshake: seal this vault's key to the device that
//     accepted, and write the grant row (electron/vault-share.cjs).
//   shareLocal    the first time a local vault is shared: the vault row, the first grant, and the
//     local secrets imported as the server's rows.
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
 * The two shared-vault calls the board can make.
 *
 * @param {{ readVault: (folder: string) => Promise<{ id: string, label: string, key: string, keyVersion: number, secrets: Secret[] }>,
 *   device: { id?: string, publicKey: string, privateKey?: string }, sodium?: any,
 *   sync?: any, checkRepo?: (repo: string) => Promise<boolean> }} deps
 */
function createSharedApi({ readVault, device, sodium, sync = null, checkRepo }) {
  return {
    /**
     * The granter seals this vault's key to the device that accepted the pending grant.
     *
     * The pending row names the server's vault; the local file is that vault's shadow. The key
     * comes from the local file, because that is the only place it is.
     */
    /** @param {{ pendingId: string, accountClient: any }} opts */
    async grantPending({ pendingId, accountClient }) {
      const pending = await readPending(accountClient, pendingId);
      if (!pending) throw new Error("That grant isn't waiting any more.");
      const vault = await readVault(pending.vault_id);
      const granted = await grantPendingDevice({
        accountClient,
        pendingId,
        vault: { id: pending.vault_id, key: vault.key, keyVersion: vault.keyVersion },
        device,
        sodium,
      });
      // The device that just got the grant pulls the server's rows into its own shadow; the
      // granter's machine only has to write the grant.
      await sync?.pull?.(vault.localId ?? pending.vault_id).catch(() => null);
      return granted;
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
     * The accepting side, on the new device: open the grant the granter wrote and fill the local
     * shadow with the server's rows.
     */
    /** @param {{ vaultId: string, accountClient: any }} opts */
    async accept({ vaultId, accountClient }) {
      const { keyVersion } = await openGrant({ accountClient, vaultId, myDevice: device, sodium });
      const rows = await sync?.pull?.(vaultId).catch(() => null);
      return { keyVersion, opened: Boolean(rows) };
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

module.exports = { createSharedApi };
