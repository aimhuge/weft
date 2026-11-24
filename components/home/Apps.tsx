import { APPS } from "@/lib/home-desktop";
import "./desktop.css";

// "On the desktop": everything your AI can reach from Weft, as a grid of app tiles (APPS in lib/home-desktop.ts).
export default function Apps() {
  return (
    <section className="wz-wrap wz-apps" aria-labelledby="wz-appsTitle">
      <div className="wz-secHead">
        <h2 id="wz-appsTitle" className="wz-h2">
          Everything your AI needs, <em>on one desktop.</em>
        </h2>
        <p className="wz-secLede">
          A chat window can only talk. On Weft your AI has a browser, a phone, your keys, your inbox and your stack, and it
          shows you what it did with each.
        </p>
      </div>
      <div className="wz-appGrid">
        {APPS.map((app) => (
          <article key={app.name} className="wz-app">
            <span className="wz-appIcon" aria-hidden="true">
              {app.icon}
            </span>
            <h3>{app.name}</h3>
            <p>{app.body}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
