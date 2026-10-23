// weft.zip's Suspense fallbacks, each in the shape of the page it stands in for, so a slow load reads as
// "the page is coming" and the swap doesn't jump (components/web-states/web-states.css). Server components
// with no JS: they're what a visitor sees before anything has run. Each carries its page's own wrapper
// (.wz-app.wz-profile, .wz-desk) and stylesheets, since a fallback can paint before the page's imports do.
import "@/components/team/team.css";
import "@/components/profile/profile.css";
import "@/components/share-view/share-view.css";
import "./web-states.css";

type BarProps = { w: string; size?: "title" | "big"; round?: boolean; h?: number };

function Bar({ w, size, round, h }: BarProps) {
  return (
    <span
      className={round ? "wzs-bar wzs-round" : "wzs-bar"}
      data-size={size}
      style={{ width: w, ...(h ? { height: h } : {}) }}
    />
  );
}

// What a screen reader hears, and what a sighted visitor reads once the load has taken a beat.
function Note({ children }: { children: string }) {
  return (
    <p className="wzs-note" role="status">
      {children}
    </p>
  );
}

// weft.zip/@username: the top bar, the hero (avatar, name, handle, facts), four number tiles, two sections.
export function ProfileSkeleton() {
  return (
    <div className="wz-app wz-profile" aria-busy="true">
      <header className="wz-profileTop">
        <span className="wz-profileHome">Weft</span>
      </header>
      <main className="wz-profileMain">
        <div className="wzs-profileHero">
          <Bar w="112px" h={112} round />
          <div className="wzs-stack">
            <Bar w="46%" size="big" />
            <Bar w="22%" />
            <Bar w="64%" />
          </div>
        </div>
        <div className="wzs-tiles">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="wzs-tile">
              <Bar w="40%" size="big" />
              <Bar w="70%" />
            </div>
          ))}
        </div>
        <div className="wzs-section">
          <Bar w="28%" size="title" />
          <Bar w="100%" h={80} />
        </div>
        <div className="wzs-section">
          <Bar w="22%" size="title" />
          <Bar w="90%" />
          <Bar w="76%" />
        </div>
        <Note>Loading the profile…</Note>
      </main>
    </div>
  );
}

// The share header: a title bar and the brand link's place.
function ShareHeader({ glyph }: { glyph: boolean }) {
  return (
    <header className="wz-shareHeader">
      {glyph && <Bar w="22px" h={22} />}
      <Bar w="200px" size="title" />
      <Bar w="64px" h={20} />
      <div className="flex-1" />
      <Bar w="110px" />
    </header>
  );
}

function PageShape() {
  return (
    <div className="wzs-page">
      <Bar w="38%" size="big" />
      <Bar w="72%" />
      <Bar w="58%" />
      <span className="wzs-bar wzs-pageBlock" />
      <Bar w="64%" />
    </div>
  );
}

// weft.zip/s/<id>: a shared card, its thread beside its pane.
export function SharedCardSkeleton() {
  return (
    <div className="wz-desk" data-theme="dark" aria-busy="true">
      <div className="wz-share">
        <ShareHeader glyph={false} />
        <div className="wz-shareMain">
          <section className="wz-shareThread" data-hidden="false">
            <div className="wzs-thread">
              <div className="wzs-bubble" data-who="user">
                <Bar w="90%" />
                <Bar w="60%" />
              </div>
              <div className="wzs-bubble">
                <Bar w="94%" />
                <Bar w="88%" />
                <Bar w="52%" />
              </div>
              <div className="wzs-bubble">
                <Bar w="80%" />
                <Bar w="66%" />
              </div>
              <Note>Loading the shared thread…</Note>
            </div>
          </section>
          <section className="wz-sharePane" data-hidden="true">
            <PageShape />
          </section>
        </div>
      </div>
    </div>
  );
}

// weft.zip/@user/apps/<slug>, /<org>/apps/<slug> and /a/<id>: a mini app's header over its full-window page.
export function SharedAppSkeleton() {
  return (
    <div className="wz-desk" data-theme="dark" aria-busy="true">
      <div className="wz-share">
        <ShareHeader glyph />
        <PageShape />
        <div style={{ padding: "0 28px 20px" }}>
          <Note>Loading the app…</Note>
        </div>
      </div>
    </div>
  );
}

const BOARD_COLUMNS = [3, 2, 2, 1, 2];

// weft.zip/<org>/board: the project bar and five columns of cards.
export function BoardSkeleton() {
  return (
    <div className="wz-desk" data-theme="dark" aria-busy="true">
      <div className="wzs-boardBar">
        <Bar w="70px" h={22} />
        <Bar w="70px" h={22} />
        <Bar w="70px" h={22} />
        <div className="flex-1" />
        <Bar w="120px" h={22} />
      </div>
      <div className="wzs-board">
        {BOARD_COLUMNS.map((cards, c) => (
          <div key={c} className="wzs-column">
            <Bar w="45%" />
            {Array.from({ length: cards }, (_, i) => (
              <div key={i} className="wzs-card">
                <Bar w="85%" />
                <Bar w="55%" />
                <Bar w="30%" h={8} />
              </div>
            ))}
          </div>
        ))}
      </div>
      <div style={{ padding: "0 16px 14px" }}>
        <Note>Loading the board…</Note>
      </div>
    </div>
  );
}
