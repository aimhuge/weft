import { ANYWHERE } from "@/lib/home-desktop";
import "./desktop.css";

// "Anywhere": the places the same board runs (ANYWHERE in lib/home-desktop.ts).
export default function Anywhere() {
  return (
    <section className="wz-wrap wz-anywhere" aria-labelledby="wz-anywhereTitle">
      <div className="wz-secHead">
        <h2 id="wz-anywhereTitle" className="wz-h2">
          Your desktop, <em>wherever you are.</em>
        </h2>
        <p className="wz-secLede">Start a card at your desk, check it on the train, and let a Worker finish it overnight.</p>
      </div>
      <div className="wz-placeGrid">
        {ANYWHERE.map((p) => (
          <article key={p.name} className="wz-place">
            <span className="wz-placeIcon" aria-hidden="true">
              {p.icon}
            </span>
            <h3>{p.name}</h3>
            <p>{p.body}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
