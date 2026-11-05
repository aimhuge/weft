// The most a worker's build may weigh (docs/architecture/manual-qa.md). Apart from lib/device-build.ts, which reads the
// store, so a route and the worker's tools can import it alone.
export const MAX_BUILD_BYTES = 500 * 1024 * 1024;
