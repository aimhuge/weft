// The call to action an invitee sees right after joining (/<slug>/team?joined=1): Weft runs on their own computer
// with their own Claude, so the next move is to download it. Three numbered steps, the download first and loudest.
// /download and /download/windows always redirect to the newest installer (app/download), so nothing is fetched here.
// Plain markup, no hooks: it renders on the server inside the team page.

export const MAC_DOWNLOAD = "/download";
export const WINDOWS_DOWNLOAD = "/download/windows";

export function GetWeftSteps({ orgName }: { orgName: string }) {
  return (
    <section className="wz-getWeft" aria-labelledby="wz-getWeftTitle">
      <p className="wz-getWeftKicker">You&apos;re in {orgName}</p>
      <h2 id="wz-getWeftTitle" className="wz-getWeftTitle">
        Next: get Weft on your computer
      </h2>
      <p className="wz-getWeftSub">
        Weft runs on your own machine and prompts with your own Claude, so you pay with your plan, not anyone else&apos;s.
      </p>
      <ol className="wz-getWeftSteps">
        <li>
          <span className="wz-getWeftNum">1</span>
          <div>
            <strong>Download Weft</strong>
            <div className="wz-getWeftCtas">
              <a className="wz-btnPrimary" href={MAC_DOWNLOAD}>
                Download for Mac
              </a>
              <a className="wz-getWeftAlt" href={WINDOWS_DOWNLOAD}>
                Windows
              </a>
            </div>
          </div>
        </li>
        <li>
          <span className="wz-getWeftNum">2</span>
          <div>
            <strong>Connect your Claude</strong>
            <p>Open Weft and sign in to Claude when it asks. It uses your Claude subscription.</p>
          </div>
        </li>
        <li>
          <span className="wz-getWeftNum">3</span>
          <div>
            <strong>Sign in to Weft with GitHub and prompt</strong>
            <p>Use the same GitHub account you joined with. You land in {orgName}&apos;s workspace, ready to start a thread.</p>
          </div>
        </li>
      </ol>
    </section>
  );
}
