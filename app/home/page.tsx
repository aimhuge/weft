import HomeErrorFallback from "@/components/HomeErrorFallback";
import { homeMetadata } from "@/lib/home";
import { loadHome } from "@/lib/home-loader";

// The weft.zip home page, reachable on any Weft at /home; on the deployed Weft, app/page.tsx serves it at / too.
// Loaded through loadHome() so a parse error in components/home/Home.tsx leaves the rest of the app reachable
// (this page shows a small fallback; the build error bar at the bottom shows the real error). See
// docs/bug-fixes/011-home-parse-error-took-board-down.md.
export const metadata = homeMetadata(process.env.NEXT_PUBLIC_APP_VERSION ?? "");

export default async function Page() {
  const result = await loadHome();
  if ("Home" in result) {
    const Home = result.Home as React.ComponentType;
    return <Home />;
  }
  return <HomeErrorFallback message={result.error.message} file={result.error.file} />;
}
