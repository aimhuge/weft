// The web globals the package reads, declared here instead of pulling in lib.dom: browsers, Node 18+ and React
// Native (Hermes, with react-native-url-polyfill on older RN) all have them, and nothing else from the DOM may creep
// in. Only the members the package uses.
declare class URL {
  constructor(url: string, base?: string);
  readonly protocol: string;
  readonly host: string;
  readonly pathname: string;
  readonly hash: string;
}

declare class TextEncoder {
  encode(input?: string): Uint8Array;
}

declare class URLSearchParams {
  constructor(init?: string | Record<string, string>);
  get(name: string): string | null;
  set(name: string, value: string): void;
  toString(): string;
}
