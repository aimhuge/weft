import { BOARD } from "@/lib/home-story";
import "./demo.css";

// The board, drawn small and calm (the real one, full of a year's cards, read as noise): four columns, a handful of
// cards, and one card that travels Backlog → Running → Review → Done on a CSS loop while the others make room.
// Sized in em off a font-size that follows the viewport, so it stays a whole board on a phone.
export default function MiniBoard() {
  return (
    <section className="wz-wrap wz-boardSec" aria-labelledby="wz-boardTitle">
      <div className="wz-secHead">
        <h2 id="wz-boardTitle" className="wz-h2">
          Then run <em>a dozen at once.</em>
        </h2>
        <p className="wz-secLede">One card is a thread. The board is all of them, sorted by what they need from you.</p>
      </div>
      <figure className="wz-mb" aria-label="A Weft board with four columns. The Pricing page card moves from Backlog to Running, Review and Done by itself.">
        <div className="wz-mbCols">
          {BOARD.columns.map((col, i) => (
            <div key={col.name} className="wz-mbCol">
              <p className="wz-mbColName">
                {col.name} <span>{col.cards.length}</span>
              </p>
              <div className={`wz-mbStack wz-mbPhase${i + 1}`}>
                {col.cards.map((title) => (
                  <div key={title} className="wz-mbCard">
                    <span className="wz-mbTitle">{title}</span>
                    <span className="wz-mbMeta">{col.state}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
          <div className="wz-mbCard wz-mbTraveler">
            <span className="wz-mbTitle">{BOARD.traveler}</span>
            <span className="wz-mbStates">
              {BOARD.columns.map((col, i) => (
                <span key={col.name} className={`wz-mbMeta wz-mbPhase${i + 1}`}>
                  {col.state}
                </span>
              ))}
            </span>
          </div>
        </div>
      </figure>
      <div className="wz-points">
        {BOARD.points.map((p) => (
          <article key={p.title} className="wz-point">
            <h3>{p.title}</h3>
            <p>{p.body}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
