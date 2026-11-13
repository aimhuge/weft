import { DEMO } from "@/lib/home-story";
import "./demo.css";

// The hero's picture: one open card, drawn, not a screenshot. The thread on the left takes a prompt and answers in
// three turns; the pane on the right shows what each turn made (a plan, the running app, the review tour). It loops
// on CSS keyframes alone (demo.css), so the page keeps its no-client-JS rule; with reduced motion it rests on the tour.

function PlanScene() {
  return (
    <div className="wz-cdPage wz-cdPlan">
      <p className="wz-cdPageKicker">Plan</p>
      <p className="wz-cdPageTitle">{DEMO.card}</p>
      <ol className="wz-cdSteps">
        {DEMO.planSteps.map((step, i) => (
          <li key={step} style={{ animationDelay: `${0.7 + i * 0.9}s` }}>
            <span className="wz-cdCheck" style={{ animationDelay: `${1.6 + i * 0.9}s` }} />
            {step}
          </li>
        ))}
      </ol>
    </div>
  );
}

// The page the thread built: three plan cards, the middle one featured.
function AppScene() {
  return (
    <div className="wz-cdPage wz-cdApp">
      <p className="wz-cdAppTitle">Simple pricing</p>
      <div className="wz-cdPlans">
        {["Free", "Pro", "Team"].map((name, i) => (
          <div key={name} className={`wz-cdPlanCard${i === 1 ? " wz-cdPlanHot" : ""}`}>
            <span className="wz-cdPlanName">{name}</span>
            <span className="wz-cdPlanPrice">{["$0", "$20", "$9"][i]}</span>
            <span className="wz-cdLine" />
            <span className="wz-cdLine wz-cdLineShort" />
            <span className="wz-cdPlanBtn" />
          </div>
        ))}
      </div>
    </div>
  );
}

function ReviewScene() {
  return (
    <>
      <AppScene />
      <div className="wz-cdRing" />
      <div className="wz-cdTour">
        <p className="wz-cdTourStep">{DEMO.review.step}</p>
        <p className="wz-cdTourTitle">{DEMO.review.title}</p>
        <p className="wz-cdTourLook">{DEMO.review.look}</p>
        <p className="wz-cdTourActions">
          <span className="wz-cdTourOk">Looks good</span>
          <span className="wz-cdTourReply">Reply…</span>
        </p>
      </div>
    </>
  );
}

const SCENES = { plan: PlanScene, app: AppScene, review: ReviewScene };

export default function CardDemo() {
  return (
    <figure className="wz-cd" aria-label={`An open Weft card, "${DEMO.card}": the thread on the left, and on the right the pane showing its plan, then the running app, then the review tour`}>
      <div className="wz-cdBar">
        <span className="wz-cdDots" aria-hidden="true" />
        <span className="wz-cdCardName">{DEMO.card}</span>
        <ol className="wz-cdTabs">
          {DEMO.scenes.map((s) => (
            <li key={s.id} className={`wz-cdTab wz-cd-${s.id}`}>
              {s.tab}
            </li>
          ))}
        </ol>
      </div>
      <div className="wz-cdBody">
        <div className="wz-cdThread">
          <p className="wz-cdLabel">Thread</p>
          <p className="wz-cdYou">{DEMO.prompt}</p>
          {DEMO.scenes.map((s) => (
            <p key={s.id} className={`wz-cdSays wz-cd-${s.id}`}>
              {s.says}
            </p>
          ))}
          <p className="wz-cdComposer" aria-hidden="true">
            Reply to the thread…
          </p>
        </div>
        <div className="wz-cdPane">
          <p className="wz-cdLabel">Browser pane</p>
          <div className="wz-cdStage">
            {DEMO.scenes.map((s) => {
              const Scene = SCENES[s.id];
              return (
                <div key={s.id} className={`wz-cdScene wz-cd-${s.id}`}>
                  <p className="wz-cdUrl">{s.url}</p>
                  <div className="wz-cdView">
                    <Scene />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </figure>
  );
}
