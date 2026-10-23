import Link from "next/link";
import { Logo } from "./Logo";
import { NavMenu } from "./NavMenu";
import { CATALOG } from "@/fees/catalog";

/** A floating pill that stays in reach; the page itself stays quiet behind it. */
export function Header() {
  return (
    <header className="sticky top-0 z-40 px-3 pt-3 sm:px-5">
      <div className="pill mx-auto flex h-[58px] max-w-[1180px] items-center justify-between gap-2 !bg-[color-mix(in_oklab,var(--card)_86%,transparent)] px-1.5 backdrop-blur-xl backdrop-saturate-150">
        <Logo />
        <nav aria-label="Main" className="flex items-center gap-1">
          <Link href="/compare" className="btn btn-quiet btn-sm hidden sm:inline-flex">
            Compare
          </Link>
          <Link href="/fee-changes" className="btn btn-quiet btn-sm hidden md:inline-flex">
            Fee changes
          </Link>
          <NavMenu items={CATALOG} />
        </nav>
      </div>
    </header>
  );
}
