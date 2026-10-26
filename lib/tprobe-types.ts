// The shape the probe reads. Kept apart from lib/tprobe-server.ts so the client module never
// reaches that file's node:fs import — a type-only import still puts the module in the graph,
// and Turbopack then fails the client chunk with "the chunking context does not support
// external modules (request: node:fs)".
export interface TProbe {
  x: string;
}
