import Link from "next/link";
import type { ReactNode } from "react";
import { JsonLd } from "./JsonLd";
import { breadcrumbLd } from "@/lib/seo";

function formatDate(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

/** Quiet heading in the open field, then the content. Used by every non-calculator page. */
export function PageShell({
  title,
  path,
  crumb,
  dek,
  updated,
  children,
  wide = false,
}: {
  title: string;
  path: string;
  crumb?: string;
  dek?: ReactNode;
  updated?: string;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <div className="mx-auto max-w-[1180px] px-3 sm:px-5">
      <JsonLd data={breadcrumbLd([{ name: "Home", path: "/" }, { name: crumb ?? title, path }])} />
      <nav aria-label="Breadcrumb" className="pt-8 text-[0.84rem] text-ink-3">
        <ol className="flex flex-wrap items-center gap-1.5">
          <li>
            <Link href="/" className="hover:text-ink">
              Home
            </Link>
          </li>
          <li aria-hidden>/</li>
          <li aria-current="page" className="text-ink-2">
            {crumb ?? title}
          </li>
        </ol>
      </nav>
      <header className={`pb-8 pt-5 ${wide ? "max-w-3xl" : "mx-auto max-w-[760px] lg:mx-0"}`}>
        <h1 className="display text-[2.35rem] text-ink sm:text-[3.2rem]">{title}</h1>
        {updated && (
          <p className="mt-3 text-[0.88rem] text-ink-4">
            Last updated <time dateTime={updated}>{formatDate(updated)}</time>
          </p>
        )}
        {dek && <p className="mt-4 max-w-2xl text-[1.08rem] leading-relaxed text-ink-3">{dek}</p>}
      </header>
      <div className={wide ? "" : "max-w-[760px]"}>{children}</div>
    </div>
  );
}

/** Long text inside one floating module (legal pages, methodology). */
export function TextModule({ children }: { children: ReactNode }) {
  return (
    <div className="float px-6 py-8 sm:px-10 sm:py-10">
      <div className="prose-quiet [&>h2:first-child]:mt-0">{children}</div>
    </div>
  );
}
