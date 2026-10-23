import Link from "next/link";
import { Mark } from "./Logo";
import { ThemeToggle } from "./ThemeToggle";
import { CookieSettingsLink } from "./Consent";
import { SITE } from "@/lib/site";
import { CATALOG } from "@/fees/catalog";
import { CATEGORY_LABEL, CATEGORY_ORDER } from "@/fees/categories";

export function Footer() {
  const year = new Date().getFullYear();
  const popular = CATALOG.slice(0, 10);
  return (
    <footer className="mt-24 px-3 pb-8 sm:px-5">
      <div className="mx-auto max-w-[1180px] border-t border-line pt-12">
        <div className="grid gap-10 md:grid-cols-[1.3fr_1fr_1fr_1fr]">
          <div>
            <Link href="/" className="inline-flex items-center gap-2 text-ink" aria-label={`${SITE.name} home`}>
              <Mark size={26} />
              <span className="text-[1.05rem] font-[640] tracking-[-0.02em]">{SITE.name}</span>
            </Link>
            <p className="mt-3 max-w-xs text-[0.92rem] leading-relaxed text-ink-3">{SITE.tagline} Free fee calculators, checked against each platform’s own pages, with no sign-up.</p>
            <p className="mt-4 text-[0.88rem] text-ink-3">
              <a href={`mailto:${SITE.email}`} className="link">
                {SITE.email}
              </a>
            </p>
          </div>
          <div>
            <h2 className="eyebrow mb-3">Popular</h2>
            <ul className="space-y-2 text-[0.92rem]">
              {popular.map((c) => (
                <li key={c.slug}>
                  <Link href={c.path} className="text-ink-2 hover:text-ink">
                    {c.name} fees
                  </Link>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h2 className="eyebrow mb-3">Browse</h2>
            <ul className="space-y-2 text-[0.92rem]">
              {CATEGORY_ORDER.filter((c) => CATALOG.some((x) => x.category === c)).map((c) => (
                <li key={c}>
                  <Link href={`/#${c}`} className="text-ink-2 hover:text-ink">
                    {CATEGORY_LABEL[c]}
                  </Link>
                </li>
              ))}
              <li>
                <Link href="/compare" className="text-ink-2 hover:text-ink">
                  Compare platforms
                </Link>
              </li>
              <li>
                <Link href="/fee-changes" className="text-ink-2 hover:text-ink">
                  Fee changes log
                </Link>
              </li>
              <li>
                <Link href="/blog" className="text-ink-2 hover:text-ink">
                  Guides
                </Link>
              </li>
            </ul>
          </div>
          <div>
            <h2 className="eyebrow mb-3">Company</h2>
            <ul className="space-y-2 text-[0.92rem]">
              <li>
                <Link href="/about" className="text-ink-2 hover:text-ink">
                  About
                </Link>
              </li>
              <li>
                <Link href="/methodology" className="text-ink-2 hover:text-ink">
                  How we check fees
                </Link>
              </li>
              <li>
                <Link href="/contact" className="text-ink-2 hover:text-ink">
                  Contact
                </Link>
              </li>
              <li>
                <Link href="/privacy" className="text-ink-2 hover:text-ink">
                  Privacy policy
                </Link>
              </li>
              <li>
                <Link href="/terms" className="text-ink-2 hover:text-ink">
                  Terms of use
                </Link>
              </li>
              <li>
                <Link href="/cookie-policy" className="text-ink-2 hover:text-ink">
                  Cookie policy
                </Link>
              </li>
              <li>
                <CookieSettingsLink />
              </li>
            </ul>
          </div>
        </div>
        <div className="mt-12 flex flex-col gap-4 text-[0.84rem] text-ink-4 sm:flex-row sm:items-center sm:justify-between">
          <p>
            © {year} {SITE.name}. Independent and not affiliated with any platform listed. Estimates only: your platform statement is final.
          </p>
          <ThemeToggle />
        </div>
      </div>
    </footer>
  );
}
