import Image from "next/image";
import twinSuns from "@/electron/assets/splash-speeder.jpg";
import { TAGLINE, downloadLink } from "@/lib/home";
import { latestRelease } from "@/lib/home-release";
import board from "@/public/brand/board.png";
import FaqTeaser from "./FaqTeaser";
import { HomeFooter, HomeNav } from "./HomeChrome";
import Pillars from "./Pillars";
import Plans from "./Plans";
import Tour from "./Tour";
import "./home.css";

// The weft.zip home page (lib/home.ts has what it says and links to): the name, one
// sentence, the download, a real screenshot of the board (public/brand/board.png) over the start screen's
// twin suns, the narrated tour video, the five pillars, then a short FAQ (the whole one is /faq). A server component with no client JS. Fraunces for display, Instrument Sans for text.
export default async function Home() {
  const release = await latestRelease();
  const download = downloadLink(release);
  return (
    <>
      <div className="wz-root">
        <HomeNav />

        <header className="wz-hero">
          <Image src={twinSuns} alt="" fill priority sizes="100vw" className="wz-photo" />
          <div className="wz-scrim" />
          <div className="wz-wrap wz-heroInner">
            <p className="wz-eyebrow wz-rise">Agentic engineering, on your Mac</p>
            <h1 className="wz-h1 wz-rise">
              {TAGLINE},<br /> <em>one thread at a time.</em>
            </h1>
            <p className="wz-lede wz-rise wz-d1">
              A Mac kanban board where every card is a Claude Code thread. You bring the idea; Weft plans it, builds it and shows it to you.
            </p>
            <div className="wz-ctas wz-rise wz-d2">
              {/* download_clicked in GA and PostHog (lib/analytics.ts trackClick); "github" before the first release. */}
              <a className="wz-btn wz-btnPrimary" href={download.href} data-track="download_clicked" data-track-version={release?.version ?? "github"}>
                {download.label}
              </a>
            </div>
            <p className="wz-note wz-rise wz-d2">{download.note}</p>
          </div>
        </header>

        <div className="wz-wrap wz-shotWrap wz-rise wz-d3">
          <div className="wz-shot">
            <Image src={board} alt="The Weft board: Backlog, Running, Needs you, Review and Done, each card a thread" priority sizes="(max-width: 1216px) 100vw, 1104px" />
          </div>
        </div>

        <Tour />

        <Pillars />

        <Plans />

        <FaqTeaser />

        <HomeFooter />
      </div>
    </>
  );
}
