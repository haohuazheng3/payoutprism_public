import Link from "next/link";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { getCalculator } from "@/fees/all";
import { CATALOG } from "@/fees/catalog";
import { CATEGORY_LABEL } from "@/fees/categories";
import { loadCalcContent } from "@/lib/calc-content";
import { renderMdx, type MdxComponents } from "@/lib/mdx";
import { breadcrumbLd, calculatorLd, faqLd, pageMetadata } from "@/lib/seo";
import { JsonLd } from "@/components/JsonLd";
import { AdSlot } from "@/components/ads";
import { RecentStrip } from "@/components/RecentStrip";
import { Callout, CalcLink, ChangeLog, Example, FeeSchedule, MarketTable, PayoutExamples, SourceList } from "./content-blocks";

export function calculatorMetadata(slug: string): Metadata {
  const def = getCalculator(slug);
  const { front } = loadCalcContent(slug);
  return pageMetadata({ title: front.title, description: front.description, path: def.path, image: `/og/${slug}`, absoluteTitle: true });
}

function formatDate(iso: string) {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

/** Everything around the interactive calculator: heading, article, FAQ, sources, related tools. */
export async function CalculatorPage({ slug, children }: { slug: string; children: ReactNode }) {
  const def = getCalculator(slug);
  const { front, body, toc } = loadCalcContent(slug);
  const bind = <P extends object>(C: (p: P & { def: typeof def }) => ReactNode) => ((p: P) => C({ ...p, def })) as unknown as MdxComponents[string];
  const components: MdxComponents = {
    FeeSchedule: bind(FeeSchedule),
    PayoutExamples: bind(PayoutExamples),
    MarketTable: bind(MarketTable),
    Example: bind(Example),
    ChangeLog: bind(ChangeLog),
    SourceList: bind(SourceList),
    Callout: Callout as unknown as MdxComponents[string],
    CalcLink: CalcLink as unknown as MdxComponents[string],
  };
  const autolink = CATALOG.filter((c) => c.slug !== slug).flatMap((c) => [{ phrase: `${c.name} fee calculator`, href: c.path }, { phrase: `${c.name} fees`, href: c.path }]);
  const article = await renderMdx(body, { format: "mdx", components, autolink, self: def.path });
  const related = front.related.map((s) => CATALOG.find((c) => c.slug === s)).filter((c): c is (typeof CATALOG)[number] => Boolean(c));
  const fallbackRelated = CATALOG.filter((c) => c.category === def.category && c.slug !== slug).slice(0, 6);
  const relatedList = related.length ? related : fallbackRelated;

  return (
    <div className="mx-auto max-w-[1180px] px-3 sm:px-5">
      <JsonLd data={calculatorLd({ name: front.h1, description: front.description, path: def.path, dateModified: front.updated })} />
      <JsonLd
        data={breadcrumbLd([
          { name: "Home", path: "/" },
          { name: CATEGORY_LABEL[def.category], path: `/#${def.category}` },
          { name: front.h1, path: def.path },
        ])}
      />
      {front.faq.length > 0 && <JsonLd data={faqLd(front.faq)} />}

      <nav aria-label="Breadcrumb" className="pt-6 text-[0.84rem] text-ink-3 sm:pt-8">
        <ol className="flex flex-wrap items-center gap-1.5">
          <li>
            <Link href="/" className="hover:text-ink">
              Home
            </Link>
          </li>
          <li aria-hidden>/</li>
          <li>
            <Link href={`/#${def.category}`} className="hover:text-ink">
              {CATEGORY_LABEL[def.category]}
            </Link>
          </li>
          <li aria-hidden>/</li>
          <li aria-current="page" className="text-ink-2">
            {def.name}
          </li>
        </ol>
      </nav>

      <header className="max-w-3xl pb-6 pt-4 sm:pb-10 sm:pt-5">
        <h1 className="display text-[2.1rem] text-ink sm:text-[3.4rem]">{front.h1}</h1>
        <p className="mt-3 max-w-2xl text-[1rem] leading-relaxed text-ink-3 sm:mt-4 sm:text-[1.15rem]">{front.dek}</p>
      </header>

      {children}

      <RecentStrip exclude={slug} />

      <AdSlot slot={process.env.NEXT_PUBLIC_ADSENSE_SLOT_CALC} />

      <div className="mt-20 grid gap-10 lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-14">
        <aside className="hidden lg:block">
          {toc.length > 2 && (
            <nav aria-label="On this page" className="sticky top-28">
              <div className="eyebrow mb-3">On this page</div>
              <ul className="space-y-2 border-l border-line text-[0.88rem]">
                {toc.map((t) => (
                  <li key={t.id}>
                    <a href={`#${t.id}`} className="-ml-px block border-l border-transparent pl-3 text-ink-3 hover:border-ink-3 hover:text-ink">
                      {t.text}
                    </a>
                  </li>
                ))}
                {front.faq.length > 0 && (
                  <li>
                    <a href="#faq" className="-ml-px block border-l border-transparent pl-3 text-ink-3 hover:border-ink-3 hover:text-ink">
                      Questions
                    </a>
                  </li>
                )}
                <li>
                  <a href="#sources" className="-ml-px block border-l border-transparent pl-3 text-ink-3 hover:border-ink-3 hover:text-ink">
                    Sources
                  </a>
                </li>
              </ul>
            </nav>
          )}
        </aside>

        <div className="min-w-0 max-w-[740px]">
          <article className="prose-quiet">{article}</article>

          {front.faq.length > 0 && (
            <section id="faq" className="mt-16" aria-labelledby="faq-h">
              <h2 id="faq-h" className="display text-[1.9rem] text-ink sm:text-[2.1rem]">
                Questions sellers ask
              </h2>
              <div className="mt-6 space-y-3">
                {front.faq.map((f) => (
                  <details key={f.q} className="float group px-5 py-1 [&_summary::-webkit-details-marker]:hidden">
                    <summary className="flex min-h-[56px] list-none items-center justify-between gap-4 py-3 text-[1rem] font-[600] text-ink">
                      {f.q}
                      <span aria-hidden className="grid h-7 w-7 flex-none place-items-center rounded-full bg-card-2 text-ink-3 transition-transform group-open:rotate-45">
                        +
                      </span>
                    </summary>
                    <p className="pb-4 text-[0.98rem] leading-relaxed text-ink-2">{f.a}</p>
                  </details>
                ))}
              </div>
            </section>
          )}

          <section id="sources" className="mt-16" aria-labelledby="sources-h">
            <h2 id="sources-h" className="display text-[1.9rem] text-ink sm:text-[2.1rem]">
              Sources
            </h2>
            <p className="mt-3 text-[0.98rem] leading-relaxed text-ink-2">
              Every rate above comes from {def.name}’s own pages, read on {formatDate(def.verifiedAt)}. Platforms change fees with little notice: we re-check these pages
              automatically and update the calculator when they move. Your {def.name} statement is the final word.{" "}
              <Link href="/methodology" className="link">
                How we check fees
              </Link>
            </p>
            <SourceList def={def} />
          </section>
        </div>
      </div>

      {relatedList.length > 0 && (
        <section className="mt-20" aria-labelledby="related-h">
          <h2 id="related-h" className="display text-[1.8rem] text-ink">
            Related calculators
          </h2>
          <ul className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {relatedList.map((c) => (
              <li key={c.slug}>
                <Link href={c.path} className="float float-lift flex h-full flex-col px-5 py-4">
                  <span className="text-[1.02rem] font-[640] text-ink">{c.name} fee calculator</span>
                  <span className="mt-1 text-[0.86rem] leading-snug text-ink-3">{c.blurb}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
