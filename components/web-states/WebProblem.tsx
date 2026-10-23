// A weft.zip page that failed or isn't there: the brand's auth card on its backdrop, a title, a sentence and
// a way on. No "use client" and no hooks, so app/not-found.tsx draws it on the server and the error boundary
// (components/web-states/WebError.tsx) draws it in the browser.
import "@/components/team/team.css";
import "./web-states.css";

export function WebProblem({
  title,
  children,
  actions,
  code,
}: {
  title: string;
  children: React.ReactNode;
  actions: React.ReactNode;
  // A reference to quote when reporting it (an error's digest), shown small under the actions.
  code?: string;
}) {
  return (
    <div className="wz-app wzs-full">
      <main className="wz-auth">
        <div className="wz-authCard" role="alert">
          <h1 className="wz-authTitle">{title}</h1>
          <p className="wz-authSub">{children}</p>
          <div className="wzs-actions">{actions}</div>
          {code && <p className="wzs-code">Reference {code}</p>}
        </div>
      </main>
    </div>
  );
}
