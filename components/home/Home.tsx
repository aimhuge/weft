import { platformLinks, downloadLink } from "@/lib/home";
import { CLOSING, DESKTOP_HERO } from "@/lib/home-desktop";
import { latestRelease } from "@/lib/home-release";
import { HERO } from "@/lib/home-story";
import { testflightPublicUrl } from "@/lib/testflight";
import Anywhere from "./Anywhere";
import Apps from "./Apps";
import CardDemo from "./CardDemo";
import DesktopScene from "./DesktopScene";
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

// The weft.zip home page (lib/home.ts, lib/home-desktop.ts and lib/home-story.ts hold what it says and links to). It
// leads with Weft as the ultimate AI desktop, drawn whole (DesktopScene), then what's on it (Apps), what one card does
// every turn (CardDemo), a dozen at once (MiniBoard), why this board (Why), where it runs (Anywhere), the game and
// public profiles (Game), the source (OpenSource), the narrated tour, the plans, a short FAQ and the downloads once
// more. Everything on it is drawn in CSS, so no screenshot goes stale. A server component with no client JS.
export default async function Home() {
  const release = await latestRelease();
  const download = downloadLink(release, "plans");
  const testflight = testflightPublicUrl();
  return (
    <div className="wz-root">
      <HomeNav />

      <header className="wz-top">
        <div className="wz-wrap wz-heroInner">
          <p className="wz-eyebrow wz-rise">{DESKTOP_HERO.eyebrow}</p>
          <h1 className="wz-h1 wz-rise">
            {DESKTOP_HERO.title}
            <br /> <em>{DESKTOP_HERO.titleEm}</em>
          </h1>
          <p className="wz-lede wz-rise wz-d1">{DESKTOP_HERO.lede}</p>
          <Downloads links={platformLinks(release, testflight, "hero")} />
          <p className="wz-note wz-rise wz-d2">{release ? HERO.note : download.note}</p>
        </div>
        <div className="wz-wrap wz-rise wz-d3">
          <DesktopScene />
        </div>
      </header>

      <Apps />

      <section className="wz-wrap wz-turns" aria-labelledby="wz-turnsTitle">
        <div className="wz-secHead">
          <h2 id="wz-turnsTitle" className="wz-h2">
            {HERO.title} <em>{HERO.titleEm}</em>
          </h2>
          <p className="wz-secLede">{HERO.lede}</p>
        </div>
        <CardDemo />
      </section>

      <MiniBoard />

      <Why />

      <Anywhere />

      <Game />

      <OpenSource />

      <Tour />

      <Plans download={{ label: download.label, href: download.href }} />

      <FaqTeaser />

      <section className="wz-wrap wz-closing" aria-labelledby="wz-closingTitle">
        <h2 id="wz-closingTitle" className="wz-h2">
          {CLOSING.title} <em>{CLOSING.titleEm}</em>
        </h2>
        <Downloads links={platformLinks(release, testflight, "closing")} />
      </section>

      <HomeFooter />
    </div>
  );
}
