// The one place that knows the board's fetch header.
//
// lib/guard.ts refuses every route — reads included — once the desktop app has written a launch token, and a
// client fetch that forgets the header gets a 403 whose body it usually swallows into an empty default. That
// silence is how the limits chart lost its history, how the uncommitted counter and the quality, streak and
// league chips disappeared, and how an open thread came back empty instead of erroring.
//
// So: one constant, one function, and every board-side fetch goes through it. A call site that needs a JSON body
// still sets its own content-type; apiFetch only adds the token.

/** The header lib/guard.ts checks. A plain "1" is enough for reads and non-elevated writes. */
export const API_TOKEN_HEADER = "x-weft-token";

/** The header every board-side request carries. */
export const API_HEADERS: Record<string, string> = { [API_TOKEN_HEADER]: "1" };

// fetch with the token on it. `init` wins on a header it sets itself, so a call site can override the token
// (it never should) or add its own content-type.
export function apiFetch(url: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  if (!headers.has(API_TOKEN_HEADER)) headers.set(API_TOKEN_HEADER, "1");
  return fetch(url, { ...init, headers });
}
