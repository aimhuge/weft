import { afterEach, beforeEach, vi } from "vitest";

// The fake fetch the client-api tests share (lib/client-api.test.ts, lib/client-api-connectors.test.ts).
// Every api method is a thin wrapper over a fetch, so the tests are about the shape of the request it
// makes and the reply it turns into an answer.

// A fetch that answers every call with the same JSON body.
export const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>();

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(() => Promise.resolve(new Response("{}", { status: 200 })));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// The url and the init of the nth fetch. n defaults to the last one, so a test reads the request
// it just made.
export function callOf(n?: number): { url: string; init: RequestInit | undefined } {
  const i = n ?? fetchMock.mock.calls.length - 1;
  const entry = fetchMock.mock.calls[i];
  if (!entry) throw new Error(`fetch was not called ${i + 1} times`);
  return { url: entry[0], init: entry[1] };
}

// The body the request sent, parsed.
export function bodyOf(n?: number): unknown {
  const init = callOf(n).init;
  return init?.body ? JSON.parse(init.body as string) : undefined;
}
