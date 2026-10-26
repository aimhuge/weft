import Image from "next/image";
import Link from "next/link";
import emblem from "@/electron/assets/emblem.png";
import { AIMHUGE, COFFEE, REPO } from "@/lib/home";

// The nav and footer the weft.zip pages share: the home (components/home/Home.tsx) and the FAQ (app/faq/page.tsx).
export function HomeNav() {
  return (
    <nav className="wz-wrap wz-nav">
      <Link href="/" className="wz-brand">
        <Image src={emblem} alt="" width={28} height={28} className="wz-emblem" /> Weft
      </Link>
      <div className="flex items-center gap-5">
        <Link href="/faq">FAQ</Link>
        <Link href="/login">Sign in</Link>
        <a href={REPO}>GitHub</a>
      </div>
    </nav>
  );
}

export function HomeFooter() {
  return (
    <footer className="wz-wrap wz-footer">
      Made with{" "}
      <a href={COFFEE} title="Buy me a coffee">
        ☕
      </a>{" "}
      by <a href={AIMHUGE}>aimhuge.com</a> · Weft™ is free, with its source on <a href={REPO}>GitHub</a> · <Link href="/faq">FAQ</Link> ·{" "}
      <Link href="/terms">Terms</Link> · <Link href="/privacy">Privacy</Link>
    </footer>
  );
}
