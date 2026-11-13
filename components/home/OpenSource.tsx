import { OPEN } from "@/lib/home-story";
import "./story.css";

// Where the source is and what that buys you (OPEN in lib/home-story.ts): four plain points, the two GitHub links and
// the license by its real name, since Weft's source is public under FSL rather than an OSI license.
export default function OpenSource() {
  return (
    <section className="wz-wrap wz-open" aria-labelledby="wz-openTitle">
      <div className="wz-openBox">
        <div className="wz-secHead">
          <h2 id="wz-openTitle" className="wz-h2">
            Built <em>in the open.</em>
          </h2>
          <p className="wz-secLede">Weft runs agents in your repo with your keys. You should be able to read what it does, so you can.</p>
        </div>
        <div className="wz-points">
          {OPEN.points.map((p) => (
            <article key={p.title} className="wz-point">
              <h3>{p.title}</h3>
              <p>{p.body}</p>
            </article>
          ))}
        </div>
        <p className="wz-openLinks">
          {OPEN.links.map((link, i) => (
            <a key={link.href} className={`wz-pill${i === 0 ? " wz-pillSolid" : ""}`} href={link.href} data-track="source_clicked" data-track-target={link.track}>
              {link.label}
            </a>
          ))}
          <a className="wz-openLicense" href={OPEN.license.href}>
            License: {OPEN.license.label}
          </a>
        </p>
      </div>
    </section>
  );
}
