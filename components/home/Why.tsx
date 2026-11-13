import { WHY } from "@/lib/home-story";
import "./story.css";

// "A lot of people are making kanban": the section that says why this one. Each row strikes what the others leave
// you with and sets Weft's answer beside it (WHY in lib/home-story.ts).
export default function Why() {
  return (
    <section className="wz-wrap wz-why" aria-labelledby="wz-whyTitle">
      <div className="wz-secHead">
        <h2 id="wz-whyTitle" className="wz-h2">
          Plenty of boards run agents. <em>This one shows you.</em>
        </h2>
        <p className="wz-secLede">Starting ten agents is the easy part. Knowing what each one did is the work, so that is what Weft is built around.</p>
      </div>
      <div className="wz-whyGrid">
        {WHY.map((row) => (
          <article key={row.title} className="wz-whyRow">
            <p className="wz-whyThem">{row.them}</p>
            <h3 className="wz-whyTitle">{row.title}</h3>
            <p className="wz-whyBody">{row.body}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
