import Image, { type StaticImageData } from "next/image";
import Link from "next/link";
import { GAME, LEVELS, xpRules } from "@/lib/home-story";
import bolt from "@/public/brand/levels/bolt.webp";
import loom from "@/public/brand/levels/loom.webp";
import strand from "@/public/brand/levels/strand.webp";
import tapestry from "@/public/brand/levels/tapestry.webp";
import thread from "@/public/brand/levels/thread.webp";
import yarn from "@/public/brand/levels/yarn.webp";
import "./story.css";

// The game and the public profile, which the old page gave one sentence: what earns XP (read from lib/game.ts), the six
// levels with their real art, and a drawn builder card as it shows at weft.zip/@you, linking to a real one.

const ART: Record<(typeof LEVELS)[number]["title"], StaticImageData> = { Thread: thread, Strand: strand, Yarn: yarn, Bolt: bolt, Loom: loom, Tapestry: tapestry };

// 26 weeks of made-up activity for the sample card: a fixed pattern (no randomness, so the page renders the same
// every time) that gets busier toward today, the way a real one does.
export function sampleCloth(weeks = 26): number[] {
  return Array.from({ length: weeks * 7 }, (_, i) => {
    const week = Math.floor(i / 7);
    const noise = (i * 37 + week * 11) % 9;
    const weekend = i % 7 > 4 ? 3 : 0;
    return Math.max(0, Math.min(4, Math.floor((noise + week / 4 - weekend) / 2.3)));
  });
}

function BuilderCard() {
  return (
    <figure className="wz-bc" aria-label="A sample builder card as it shows on a public Weft profile">
      <p className="wz-bcUrl">weft.zip/@you</p>
      <div className="wz-bcTop">
        <span className="wz-bcRing">
          <span className="wz-bcFace">Y</span>
          <span className="wz-bcLv">Lv 12</span>
        </span>
        <span className="wz-bcWho">
          <span className="wz-bcClass">Roaming Shipper · Yarn</span>
          <span className="wz-bcName">@you</span>
          <span className="wz-bcLeague">Silk league · #4 of 30 this week</span>
        </span>
      </div>
      <div className="wz-bcXp">
        <span style={{ width: "64%" }} />
      </div>
      <dl className="wz-bcStats">
        {[
          ["27", "day streak"],
          ["61", "cards shipped"],
          ["14 / 38", "badges"],
        ].map(([value, label]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <div className="wz-bcCloth" aria-hidden="true">
        {sampleCloth().map((heat, i) => (
          <i key={i} data-heat={heat} />
        ))}
      </div>
      <figcaption className="wz-bcNote">
        A sample. See a real one:{" "}
        <Link href={GAME.example.href} data-track="profile_example_clicked">
          weft.zip/@{GAME.example.handle} →
        </Link>
      </figcaption>
    </figure>
  );
}

export default function Game() {
  return (
    <section className="wz-wrap wz-game" aria-labelledby="wz-gameTitle">
      <div className="wz-gameText">
        <h2 id="wz-gameTitle" className="wz-h2">
          Shipping <em>levels you up.</em>
        </h2>
        <p className="wz-secLede">{GAME.body}</p>
        <ul className="wz-xp">
          {xpRules().map((rule) => (
            <li key={rule.what}>
              <span>{rule.what}</span>
              <b>{rule.xp} XP</b>
            </li>
          ))}
        </ul>
        <ol className="wz-levels">
          {LEVELS.map((level) => (
            <li key={level.title}>
              <Image src={ART[level.title]} alt="" width={72} height={72} sizes="72px" />
              <b>{level.title}</b>
              <span>Lv {level.from}</span>
            </li>
          ))}
        </ol>
      </div>
      <div className="wz-gameCard">
        <BuilderCard />
        <p className="wz-gameProfile">
          <b>Your GitHub, your @.</b> {GAME.profile}
        </p>
      </div>
    </section>
  );
}
