// The TestFlight invite's shapes, on their own so the board's client code can name them: a client file naming a type
// from lib/testflight.ts would make Turbopack resolve node:crypto into a browser chunk.

// What GET /api/testflight answers: the QR code's link, and whether this deployment can email invites.
export type TestflightInfo = { url: string | null; invites: boolean };

export type InviteAnswer = { ok: true; email: string; already: boolean } | { ok: false; error: string };
