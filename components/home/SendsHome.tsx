import { SENDS_HOME } from "@/lib/home-sends-home";
import "./sends-home.css";

// "What Weft sends home", under the plans: the analytics in five plain lines and a link to the privacy policy. The copy
// is lib/home-sends-home.ts. A server component like the rest of the home page.
export default function SendsHome() {
  return (
    <aside className="wz-sendsHome" aria-labelledby="wz-sendsHomeTitle">
      <h3 id="wz-sendsHomeTitle" className="wz-sendsHomeTitle">
        {SENDS_HOME.title}
      </h3>
      <ul className="wz-sendsHomeList">
        {SENDS_HOME.items.map((item) => (
          <li key={item.what}>
            <strong>{item.what}</strong> {item.detail}
          </li>
        ))}
      </ul>
      <a className="wz-sendsHomeLink" href={SENDS_HOME.privacy.href}>
        {SENDS_HOME.privacy.label} →
      </a>
    </aside>
  );
}
