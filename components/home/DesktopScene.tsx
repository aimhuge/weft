import { SCENE } from "@/lib/home-desktop";
import "./desktop.css";

// The hero's picture: Weft's window drawn in CSS, not a screenshot. The rail of drawers and the stack, a board of
// cards, the open thread and the pane showing the checkout it built, with a Touch ID ask and a phone floating over
// the pane. One 14 s CSS loop lights the replies, the ask and the phone in turn (desktop.css); no client JS.
export default function DesktopScene() {
  return (
    <figure
      className="wz-ds"
      aria-label="Weft's window: a board of cards, an open thread building Stripe checkout, the running page in the browser pane, a Touch ID prompt filling the Stripe key, and the page on an iPhone."
    >
      <div className="wz-dsWin">
        <div className="wz-dsBar">
          <span className="wz-dsDots">
            <i />
            <i />
            <i />
          </span>
          <span className="wz-dsBarTitle">Weft</span>
          <span className="wz-dsBarSpace">⌃⌥Space copilot</span>
        </div>
        <div className="wz-dsBody">
          <div className="wz-dsRail" aria-hidden="true">
            {SCENE.rail.map((icon) => (
              <span key={icon}>{icon}</span>
            ))}
            <span className="wz-dsRailGap" />
            {SCENE.stack.map((name) => (
              <b key={name} title={name}>
                {name[0]}
              </b>
            ))}
          </div>
          <div className="wz-dsBoard">
            <p className="wz-dsKicker">Board</p>
            {SCENE.cards.map((c) => (
              <div key={c.title} className={`wz-dsCard${c.live ? " wz-dsCardOn" : ""}`}>
                <span className="wz-dsCardTitle">{c.title}</span>
                <span className="wz-dsCardState">{c.state}</span>
              </div>
            ))}
          </div>
          <div className="wz-dsThread">
            <p className="wz-dsKicker">{SCENE.card}</p>
            <p className="wz-dsYou">{SCENE.prompt}</p>
            <p className="wz-dsSays wz-dsSay1">{SCENE.says[0]}</p>
            <p className="wz-dsTool wz-dsSay1">
              <b>vault</b> fill_field {SCENE.vault.name}
            </p>
            <p className="wz-dsSays wz-dsSay2">{SCENE.says[1]}</p>
            <p className="wz-dsTool wz-dsSay2">
              <b>simulator</b> open_url iPhone 17
            </p>
            <p className="wz-dsStatus">[claude · opus-5-5] 5hr 18% · ready in 2s</p>
          </div>
          <div className="wz-dsPane">
            <div className="wz-dsUrl">{SCENE.url}</div>
            <div className="wz-dsPage">
              <p className="wz-dsPageTitle">Checkout</p>
              <p className="wz-dsPageSub">Pro plan · $20 a month</p>
              <div className="wz-dsCheckout">
                <div className="wz-dsField">you@example.com</div>
                <div className="wz-dsField">4242 4242 4242 4242</div>
                <div className="wz-dsPay">Pay $20</div>
              </div>
            </div>
            <div className="wz-dsVault">
              <span className="wz-dsFinger" aria-hidden="true">
                🔐
              </span>
              <p className="wz-dsVaultText">
                <b>{SCENE.vault.name}</b>
                {SCENE.vault.ask} Touch ID to allow.
              </p>
            </div>
          </div>
        </div>
      </div>
      <div className="wz-dsPhone" aria-hidden="true">
        <div className="wz-dsPhoneScreen">
          <span className="wz-dsTick">✓</span>
          <p className="wz-dsPhoneTitle">Payment complete</p>
          <p className="wz-dsPhoneSub">Welcome to Pro</p>
        </div>
      </div>
    </figure>
  );
}
