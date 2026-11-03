// What rides beside an answer payload (cloud_commands.payload.auth) when a paired browser signed it with its passkey;
// the app's lib/approval-passkey.ts builds and checks the message. Every byte part base64url.
export interface PasskeyAuth {
  kind: "webauthn";
  // public.devices.id of the browser, and its passkey's credential id.
  device: string;
  credId: string;
  issuedAt: number;
  authenticatorData: string;
  clientDataJSON: string;
  signature: string;
}
