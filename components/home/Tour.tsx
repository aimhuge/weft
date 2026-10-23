// The section under the screenshot: the welcome's narrated tour (public/brand/weft-tour.mp4, rendered by
// `pnpm welcome:render`), with its first title card as the poster. Nothing loads until play, so the page stays light.
export default function Tour() {
  return (
    <section className="wz-wrap wz-tour" aria-labelledby="wz-tourTitle">
      <h2 id="wz-tourTitle" className="wz-h2">
        Take the tour, <em>sound on.</em>
      </h2>
      <div className="wz-tourFrame">
        <video
          className="wz-tourVideo"
          src="/brand/weft-tour.mp4"
          poster="/brand/weft-tour-poster.webp"
          width={1920}
          height={800}
          controls
          playsInline
          preload="none"
          aria-label="A narrated tour of Weft: the board, the browser pane, your tools, your profile and code quality"
        />
      </div>
    </section>
  );
}
