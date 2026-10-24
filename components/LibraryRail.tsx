"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { railPinned, setRailPinned, starredCount, toggleTag, type RailFilter, type RailPanel } from "@/lib/rail-view";
import type { RailContext } from "./rail-context";
import { useSlideOut } from "@/lib/use-slide-out";
import { useDrawerWidth } from "@/lib/use-drawer-width";
import { useSuperAdminGate } from "@/lib/use-admin-gate";
import { useVault } from "@/lib/use-vault";
import { filterVaults, railBadge } from "@/lib/vault-view";
import { useServices } from "@/lib/use-services";
import { filterServices, liveCount, servicesTitle } from "@/lib/services-view";
import { useWebhooks } from "@/lib/use-webhooks";
import { blankCount, failingCount, filterWebhooks, webhooksTitle } from "@/lib/webhooks-view";
import { useVercel } from "@/lib/use-vercel";
import { vercelTitle } from "@/lib/vercel-view";
import { useSupabase } from "@/lib/use-supabase";
import { pendingCount, supabaseTitle } from "@/lib/supabase-view";
import { useBlastcp } from "@/lib/use-blastcp";
import { blastcpTitle } from "@/lib/blastcp-view";
import { useCloudflare } from "@/lib/use-cloudflare";
import { cloudflareTitle } from "@/lib/cloudflare-view";
import { useGithub } from "@/lib/use-github";
import { githubTitle } from "@/lib/github-view";
import { useFeatureIntro } from "@/lib/use-feature-intro";
import { IntroButton, IntroFrame } from "./FeatureIntro";
import BlastcpDrawer from "./BlastcpDrawer";
import BlastcpLogo from "./BlastcpLogo";
import CloudflareDrawer from "./CloudflareDrawer";
import ServicesDrawer from "./ServicesDrawer";
import SkillsDrawer from "./SkillsDrawer";
import CloudflareLogo from "./CloudflareLogo";
import GithubDrawer from "./GithubDrawer";
import GithubLogo from "./GithubLogo";
import RailIconButton from "./RailIconButton";
import { StarRailButton, TagsRailButton, useRailCardDrag } from "./RailBoardButtons";
import CrashGuard from "./CrashGuard";
import Icon from "./Icon";
import VaultButton from "./VaultButton";
import VaultDrawer from "./VaultDrawer";
import VercelDrawer from "./VercelDrawer";
import WebhooksDrawer from "./WebhooksDrawer";
import SupabaseDrawer from "./SupabaseDrawer";
import SupabaseLogo from "./SupabaseLogo";
import TagsDrawer from "./TagsDrawer";
import AppsRail from "./AppsRail";
import type { TagCatalog } from "./use-tag-catalog";
import "./rail-drawer.css";

// The board's left edge: a 38px rail. ★ filters the board to starred cards (drop a card on it to star it),
// 🏷 opens the drawer of every tag (components/TagsDrawer.tsx; a tag there filters the board). The drawer
// slides out from under the board, which sits on it as a sheet (.board-sheet in ./rail-drawer.css), and slides
// back beneath it on close; pinned, Esc leaves it out. Below a divider, 🔐 opens the same drawer on the secrets
// vault of the board's project(s), 🪝 on the webhooks their code receives (its count is the ones still to register), and ▲ on their Vercel links, Supabase's bolt on their Supabase projects,
// Cloudflare's cloud on their Workers and Pages projects, BlastCP's rocket on the BlastCP property each one posts as,
// and GitHub's mark on the gh sign-in and each one's issue sync. Below 🖥 Services, the mini apps saved from the browser pane (components/AppsRail.tsx).
// The drawers under the divider, each with its icon, title and label.
const TOOLS = { vault: ["🔐", "Secrets", "Secrets vault"], webhooks: ["🪝", "Webhooks", "Webhooks"], vercel: ["▲", "Vercel", "Vercel"], supabase: [<SupabaseLogo key="supabase" />, "Supabase", "Supabase"], cloudflare: [<CloudflareLogo key="cloudflare" />, "Cloudflare", "Cloudflare"], blastcp: [<BlastcpLogo key="blastcp" />, "BlastCP", "BlastCP"], github: [<GithubLogo key="github" />, "GitHub", "GitHub"], services: ["🖥", "Services", "Services"], skills: ["✦", "Skills", "Skills"] } as const;
type Tool = keyof typeof TOOLS;
const DRAWER_SLIDE_MS = 200;
const isTool = (panel: RailPanel | null): panel is Tool => panel !== null && panel in TOOLS;

export default function SideRail({
  open,
  onOpen,
  ctx,
  filter,
  onFilter,
  onStarCard,
  onTagCard,
  catalog,
  onClosePane,
  paneUrl,
}: {
  // Which drawer is open, if any.
  open: RailPanel | null;
  onOpen: (panel: RailPanel | null) => void;
  // The board's project and cards and the actions every drawer shares (components/rail-context.ts).
  ctx: RailContext;
  // ★ and the tag the board is narrowed to (lib/rail-view.ts filterCards).
  filter: RailFilter;
  onFilter: (filter: RailFilter) => void;
  // A card dropped on ★, or on a tag in the drawer.
  onStarCard: (cardId: string) => void;
  onTagCard: (cardId: string, tag: string) => void;
  // Every tag with its colour and count, and the calls that change them (components/use-tag-catalog.ts).
  catalog: TagCatalog;
  // Hides the standalone browser pane (a second click on the active mini app, components/AppsRail.tsx).
  onClosePane: () => void;
  // The page the board's pane shows, which lights its mini app below Services (components/AppsRail.tsx); unset outside the desktop app.
  paneUrl?: string;
}) {
  const { project, folders, cards, onOpenUrl, onOpenCard, onStartCard, notify } = ctx;
  const [pinned, setPinned] = useState(() => typeof window !== "undefined" && railPinned());
  // A card is being dragged somewhere on the board: ★ and 🏷 light up to show they take drops.
  const cardDrag = useRailCardDrag();
  // The drawer to draw: the open one, or the one sliding back under the board (DRAWER_SLIDE_MS, as in rail-drawer.css).
  const { shown, closing } = useSlideOut(open, DRAWER_SLIDE_MS);
  const drawerWidth = useDrawerWidth();
  // The open tool drawer's intro video, played the first time it opens (lib/feature-intros.ts).
  const intro = useFeatureIntro(isTool(shown) && !closing ? shown : null);
  const router = useRouter();
  const isSuperAdmin = useSuperAdminGate();
  const vault = useVault(folders);
  const vaultBadge = railBadge(filterVaults(vault.overview?.vaults ?? [], project));
  const webhooks = useWebhooks(folders, open === "webhooks");
  const shownHooks = filterWebhooks(webhooks.hooks, project);
  const vercel = useVercel(folders, open === "vercel");
  const supabase = useSupabase(folders, open === "supabase");
  const cloudflare = useCloudflare(folders, open === "cloudflare");
  const blastcp = useBlastcp(folders, open === "blastcp");
  const github = useGithub(folders, open === "github");
  const services = useServices(open === "services");
  const liveServices = liveCount(filterServices(services.services, project));
  const starred = starredCount(cards);

  function pin(next: boolean) {
    setPinned(next);
    setRailPinned(next);
  }

  const onDropStar = (id: string) => {
    if (cards.some((c) => c.id === id)) onStarCard(id);
  };

  const drawerShell = ([icon, title, label]: readonly [React.ReactNode, string, string], body: React.ReactNode) => (
    <aside className="rail-drawer flex shrink-0 overflow-hidden bg-panel" data-drawer data-closing={closing || undefined} aria-label={label}>
      <div className="rail-drawer-body flex w-[calc(var(--rail-drawer-w)-12px)] shrink-0 flex-col">
        <div className="flex items-center gap-1.5 border-b border-line px-3 py-2">
          <span className="text-[14px]" aria-hidden>
            {icon}
          </span>
          <h2 className="flex-1 text-[13px] font-semibold text-ink">{title}</h2>
          <IntroButton intro={intro} />
          <button
            onClick={() => pin(!pinned)}
            title={pinned ? "Unpin: Esc slides it back under the board" : "Pin: keep it out, even on Esc"}
            aria-pressed={pinned}
            className={`rounded px-1.5 py-0.5 text-[11px] ${pinned ? "bg-accent-soft text-accent" : "text-muted hover:bg-sunken hover:text-ink"}`}
          >
            {pinned ? "Pinned" : "Pin"}
          </button>
          <button onClick={() => onOpen(null)} aria-label="Close" className="rounded p-1 text-muted hover:bg-sunken hover:text-ink">
            <Icon name="x" size={13} />
          </button>
        </div>
        <IntroFrame intro={intro} className="mt-2" />
        {/* A drawer that fails to draw keeps its header (Pin, ✕) and leaves the rail's icons working. */}
        <CrashGuard key={title} what="drawer" name={title} className="m-2">
          {body}
        </CrashGuard>
      </div>
    </aside>
  );

  const toolBodies: Record<Tool, React.ReactNode> = {
    vault: <VaultDrawer {...vault} project={project} notify={notify} />,
    webhooks: <WebhooksDrawer {...webhooks} project={project} folders={folders} notify={notify} />,
    vercel: <VercelDrawer {...vercel} project={project} onOpenUrl={onOpenUrl} notify={notify} />,
    supabase: <SupabaseDrawer {...supabase} project={project} cards={cards} onOpenCard={onOpenCard} onStart={onStartCard} onOpenUrl={onOpenUrl} notify={notify} />,
    cloudflare: <CloudflareDrawer {...cloudflare} project={project} onOpenUrl={onOpenUrl} notify={notify} />,
    blastcp: <BlastcpDrawer {...blastcp} project={project} onOpenUrl={onOpenUrl} notify={notify} />,
    github: <GithubDrawer {...github} project={project} onOpenUrl={onOpenUrl} notify={notify} />,
    skills: <SkillsDrawer project={project} folders={folders} notify={notify} />,
    services: <ServicesDrawer {...services} project={project} cards={cards} onOpenCard={onOpenCard} onOpenUrl={onOpenUrl} notify={notify} />,
  };
  const drawer = isTool(shown)
    ? drawerShell(TOOLS[shown], toolBodies[shown])
    : shown === "tags" &&
      drawerShell(
        ["🏷", "Tags", "Tags"],
        <TagsDrawer catalog={catalog} active={filter.tag} onFilter={(tag) => onFilter(toggleTag(filter, tag))} onDropCard={onTagCard} />,
      );
  const toggle = (panel: Tool) => () => onOpen(open === panel ? null : panel);

  return (
    <div className="relative flex shrink-0" data-rail style={{ "--rail-drawer-w": `${drawerWidth.width}px` } as React.CSSProperties}>
      <nav className="flex w-[38px] flex-col items-center gap-1 border-r border-line bg-panel pt-2" aria-label="Rail">
        <StarRailButton on={Boolean(filter.starred)} count={starred} cardDrag={cardDrag} onClick={() => onFilter({ ...filter, starred: !filter.starred })} onDropCard={onDropStar} />
        <TagsRailButton open={open === "tags"} tag={filter.tag} cardDrag={cardDrag} onOpen={(next) => onOpen(next ? "tags" : null)} />
        <span className="my-1 h-px w-5 bg-line" aria-hidden />
        <VaultButton open={open === "vault"} badge={vaultBadge} onClick={() => onOpen(open === "vault" ? null : "vault")} />
        <RailIconButton
          icon="🪝"
          label="Webhooks"
          open={open === "webhooks"}
          title={webhooksTitle({ blanks: blankCount(shownHooks), failing: failingCount(shownHooks) })}
          count={blankCount(shownHooks)}
          onClick={toggle("webhooks")}
        />
        <RailIconButton icon="▲" label="Vercel" open={open === "vercel"} title={vercelTitle(vercel.status, project)} onClick={toggle("vercel")} />
        <RailIconButton icon={<SupabaseLogo />} label="Supabase" open={open === "supabase"} title={supabaseTitle(supabase.status, project)} count={pendingCount(supabase.status, project)} tone="bad" onClick={toggle("supabase")} />
        <RailIconButton icon={<CloudflareLogo />} label="Cloudflare" open={open === "cloudflare"} title={cloudflareTitle(cloudflare.status, project)} onClick={toggle("cloudflare")} />
        <RailIconButton icon={<BlastcpLogo />} label="BlastCP" open={open === "blastcp"} title={blastcpTitle(blastcp.status, project)} onClick={toggle("blastcp")} />
        <RailIconButton icon={<GithubLogo />} label="GitHub" open={open === "github"} title={githubTitle(github.status, project)} onClick={toggle("github")} />
        <RailIconButton icon="✦" label="Skills" open={open === "skills"} title="Skills: what threads in this project get" onClick={toggle("skills")} />
        <RailIconButton icon="🖥" label="Services" open={open === "services"} title={servicesTitle(liveServices)} count={liveServices} tone="ok" onClick={toggle("services")} />
        {paneUrl !== undefined && <AppsRail current={paneUrl} onOpen={onOpenUrl} onClose={onClosePane} notify={notify} />}
        {isSuperAdmin ? (
          <>
            <span className="my-1 h-px w-5 bg-line" aria-hidden />
            <RailIconButton
              icon="🛡"
              label="Admin"
              open={false}
              title="Weft admin: users, billing, coupons, local install"
              onClick={() => {
                router.push("/admin/users");
              }}
            />
          </>
        ) : null}
      </nav>
      {cardDrag && !open && (
        <span className="pointer-events-none absolute left-full top-2 z-30 ml-1.5 whitespace-nowrap rounded-md bg-ink px-2 py-1 text-[11.5px] text-canvas shadow-lg">
          Drop on ☆ to star it · 🏷 to tag it
        </span>
      )}
      {drawer}
      {/* The board's edge over the drawer: drag it to resize the drawer, double-click for the default width. */}
      {drawer && !closing && (
        <div onPointerDown={drawerWidth.startDrag} onDoubleClick={drawerWidth.reset} title="Drag to resize · double-click to reset" className="absolute inset-y-0 left-[calc(22px+var(--rail-drawer-w))] z-20 w-2 cursor-col-resize hover:bg-accent/30" aria-hidden="true" />
      )}
    </div>
  );
}
