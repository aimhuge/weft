import { platformLinks, downloadLink } from "@/lib/home";
import { latestRelease } from "@/lib/home-release";
import { HERO } from "@/lib/home-story";
import { testflightPublicUrl } from "@/lib/testflight";
import CardDemo from "./CardDemo";
import Downloads from "./Downloads";
import FaqTeaser from "./FaqTeaser";
import Game from "./Game";
import { HomeFooter, HomeNav } from "./HomeChrome";
import MiniBoard from "./MiniBoard";
import OpenSource from "./OpenSource";
import Plans from "./Plans";
import Tour from "./Tour";
import Why from "./Why";
import "./home.css";
import "./story.css";

// The weft.zip home page (lib/home.ts and lib/home-story.ts hold what it says and links to). It leads with the thing
// no other agent board has, an open card whose pane shows what the thread made (CardDemo), then says why that matters
// (Why), shows the board small and moving (MiniBoard), the game and public profiles (Game), the source (OpenSource),
// the narrated tour, the plans, a short FAQ and the downloads once more. Everything on it is drawn in CSS, so no
// screenshot goes stale. A server component with no client JS. Fraunces for display, Instrument Sans for text.
export default async function Home() {
  const release = await latestRelease();
  const download = downloadLink(release);
  const links = platformLinks(release, testflightPublicUrl());
  return (
    <div className="wz-root">
      <HomeNav />

      <header className="wz-top">
        <div className="wz-wrap wz-heroInner">
          <p className="wz-eyebrow wz-rise">{HERO.eyebrow}</p>
          <h1 className="wz-h1 wz-rise">
            {HERO.title}
            <br /> <em>{HERO.titleEm}</em>
          </h1>
          <p className="wz-lede wz-rise wz-d1">{HERO.lede}</p>
          <Downloads links={links} />
          <p className="wz-note wz-rise wz-d2">{release ? HERO.note : download.note}</p>
        </div>
        <div className="wz-wrap wz-rise wz-d3">
          <CardDemo />
        </div>
      </header>

      <Why />

      <MiniBoard />

      <Game />

      <OpenSource />

      <Tour />

      <Plans download={{ label: download.label, href: download.href }} />

      <FaqTeaser />

      <section className="wz-wrap wz-closing" aria-labelledby="wz-closingTitle">
        <h2 id="wz-closingTitle" className="wz-h2">
          Give it one idea. <em>Watch it show you.</em>
        </h2>
        <Downloads links={links} />
      </section>

      <HomeFooter />
    </div>
  );
}
