import type { PlatformLink } from "@/lib/home";

// The hero's download row: one button per platform from platformLinks (lib/home.ts). Mac is the primary button;
// Windows and iPhone sit beside it as outlined ones, and iPhone is a quiet "coming soon" chip until the TestFlight
// link is set. Every link goes through a weft.zip redirect route, which counts it cookie-free (lib/download-track.ts),
// and is also a download_clicked in GA and PostHog for visitors who said yes to cookies (lib/analytics.ts trackClick).

const ICONS: Record<PlatformLink["platform"], React.ReactNode> = {
  mac: (
    <path d="M16.4 12.6c0-2.6 2.1-3.8 2.2-3.9-1.2-1.8-3.1-2-3.7-2-1.6-.2-3.1.9-3.9.9-.8 0-2-.9-3.4-.9-1.7 0-3.3 1-4.2 2.6-1.8 3.1-.5 7.7 1.3 10.2.9 1.2 1.9 2.6 3.2 2.6 1.3-.1 1.8-.8 3.3-.8 1.6 0 2 .8 3.4.8s2.2-1.3 3.1-2.5c1-1.4 1.4-2.8 1.4-2.9 0 0-2.7-1-2.7-4.1ZM13.9 5c.7-.9 1.2-2 1-3.2-1 0-2.3.7-3 1.6-.7.8-1.2 2-1.1 3.1 1.2.1 2.3-.6 3.1-1.5Z" />
  ),
  windows: <path d="M3 5.5 10.4 4.5v7H3v-6Zm8.3-1.1L21 3v8.5h-9.7V4.4ZM3 12.5h7.4v7L3 18.5v-6Zm8.3 0H21V21l-9.7-1.4v-7.1Z" />,
  ios: (
    <path d="M8 2h8a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Zm0 2v16h8V4H8Zm2.5 13.5h3v1.2h-3v-1.2Z" />
  ),
};

function Icon({ platform }: { platform: PlatformLink["platform"] }) {
  return (
    <svg className="wz-dlIcon" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
      {ICONS[platform]}
    </svg>
  );
}

function Label({ link }: { link: PlatformLink }) {
  return (
    <>
      <Icon platform={link.platform} />
      <span className="wz-dlText">
        <span className="wz-dlLabel">{link.label}</span>
        <span className="wz-dlSub">{link.sub}</span>
      </span>
    </>
  );
}

export default function Downloads({ links }: { links: PlatformLink[] }) {
  return (
    <div className="wz-ctas wz-downloads wz-rise wz-d2">
      {links.map((link) => {
        const cls = `wz-dl ${link.platform === "mac" ? "wz-btnPrimary" : "wz-dlGhost"}`;
        if (!link.href) {
          return (
            <span key={link.platform} className={`${cls} wz-dlSoon`}>
              <Label link={link} />
            </span>
          );
        }
        return (
          <span key={link.platform} className="wz-dlGroup">
            <a className={cls} href={link.href} data-track="download_clicked" data-track-version={link.track}>
              <Label link={link} />
            </a>
            {link.alt && (
              <a className="wz-dlAlt" href={link.alt.href} data-track="download_clicked" data-track-version={link.alt.track}>
                {link.alt.label}
              </a>
            )}
          </span>
        );
      })}
    </div>
  );
}
