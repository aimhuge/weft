// The reply box's pending sends live in @weft/client (packages/weft-client/src/pending-sends.ts), so every board draws a
// message the moment it's sent the same way.
export { pendingItem, unsent, type PendingSend } from "@weft/client";
