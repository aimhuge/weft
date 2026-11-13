// The deployed Weft's origin, on its own so client code can import it. lib/home.ts re-exports it, but importing it
// from there once pulled the home page into the client bundle (loadHome, now in lib/home-loader.ts, dynamically
// imports components/home/Home, which reaches lib/home-release.ts, whose "use cache" Next refuses in client code).
export const SITE = "https://weft.zip";
