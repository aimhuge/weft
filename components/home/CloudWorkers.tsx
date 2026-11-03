import "./cloud.css";

// Weft Cloud Workers, under the plans: a Weft Worker we host, so cards keep running with the laptop shut and no
// server of your own (docs/architecture/weft-worker.md). Not built yet, so instead of a price it asks what you'd run
// on one, and the form posts to /api/cloud-workers/request (lib/cloud-worker-request.ts), which sends the answer to
// the team's Slack. A plain form with no client JS, like the rest of the page: the route redirects back to
// #wz-cloudSent or #wz-cloudFailed and CSS `:target` shows the matching line.

export const CLOUD_POINTS = [
  "Cards keep running with your laptop closed",
  "No VPS or Mac mini to set up: we run the machine",
  "Follow and steer it from the board or weft.zip",
  "iOS and Android simulators streamed live over WebRTC: tap through your app from any browser",
];

export default function CloudWorkers() {
  return (
    <article id="wz-cloud" className="wz-cloud">
      <div className="wz-cloudText">
        <p className="wz-cloudName">
          Weft Cloud Workers
          <span className="wz-cloudChip">Request early access</span>
        </p>
        <p className="wz-cloudHeadline">Your threads, on our machines</p>
        <ul className="wz-cloudPoints">
          {CLOUD_POINTS.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
        <p className="wz-cloudBody">
          Pricing is set with the first people in. Tell us what you&apos;d run on one and we&apos;ll be in touch.
        </p>
      </div>
      <form className="wz-cloudForm" method="post" action="/api/cloud-workers/request">
        <label className="wz-cloudLabel" htmlFor="wz-cloudUse">
          What would you use a cloud worker for?
        </label>
        <textarea
          id="wz-cloudUse"
          name="use"
          required
          maxLength={2000}
          rows={4}
          placeholder="Overnight refactors, a test suite that runs for an hour, agents on my phone while I travel…"
        />
        <label className="wz-cloudLabel" htmlFor="wz-cloudEmail">
          Email
        </label>
        <input id="wz-cloudEmail" name="email" type="email" required maxLength={200} autoComplete="email" placeholder="you@example.com" />
        <button type="submit" className="wz-cloudCta" data-track="cloud_worker_requested">
          Request a cloud worker
        </button>
        <p id="wz-cloudSent" className="wz-cloudReply">
          Thanks, we have it. We&apos;ll write when there&apos;s a worker for you.
        </p>
        <p id="wz-cloudFailed" className="wz-cloudReply wz-cloudReplyFailed">
          That didn&apos;t go through. Try again, or email hello@weft.zip.
        </p>
      </form>
    </article>
  );
}
