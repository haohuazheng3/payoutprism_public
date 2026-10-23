import Link from "next/link";
import { ALL } from "@/fees/all";
import { CATALOG } from "@/fees/catalog";
import { CATEGORY_DEK, CATEGORY_LABEL, CATEGORY_ORDER } from "@/fees/categories";
import { compareAll } from "@/fees/compare";
import { CompareTool } from "@/components/CompareTool";
import { RecentStrip } from "@/components/RecentStrip";
import { pageMetadata } from "@/lib/seo";
import { SITE } from "@/lib/site";

export const metadata = pageMetadata({
  title: `${SITE.name}: Fee Calculators for Etsy, eBay, PayPal, Amazon & More`,
  description: `Free fee calculators for ${ALL.length} selling, payment and freelance platforms. Every fee itemised, checked against official pages and dated. See what you keep, or what to charge.`,
  path: "/",
  absoluteTitle: true,
});

function formatDate(iso: string) {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default function Home() {
  const initial = { price: 50, shipping: 6, itemCost: 0, shippingCost: 0 };
  const rows = { sell: compareAll(ALL, "sell", initial), pay: compareAll(ALL, "pay", initial) };
  const newestCheck = ALL.map((d) => d.verifiedAt).sort().pop() ?? "";
  const today = new Date().toISOString().slice(0, 10);
  const changes = ALL.flatMap((d) => d.changes.map((c) => ({ ...c, def: d })))
    .filter((c) => c.date >= "2025-01-01")
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 4);
  const popular = CATALOG.slice(0, 8);

  return (
    <div className="mx-auto max-w-[1180px] px-3 sm:px-5">
      <section className="grid gap-10 pb-6 pt-10 sm:pt-16 lg:grid-cols-12 lg:items-center lg:gap-12">
        <div className="lg:col-span-6">
          <p className="eyebrow">
            Free · no sign-up · {ALL.length} platforms · checked {formatDate(newestCheck)}
          </p>
          <h1 className="display mt-4 text-[3rem] text-ink sm:text-[4.4rem]">
            See every fee
            <br />
            before you sell.
          </h1>
          <p className="mt-5 max-w-xl text-[1.1rem] leading-relaxed text-ink-3 sm:text-[1.18rem]">
            Precise fee calculators for Etsy, eBay, PayPal, Amazon and {Math.max(0, ALL.length - 4)} more. Every rate is checked against the platform’s own pages, dated, and explained line
            by line, so you know what you keep, or exactly what to charge.
          </p>
          <ul className="mt-7 flex flex-wrap gap-2" aria-label="Popular calculators">
            {popular.map((c) => (
              <li key={c.slug}>
                <Link href={c.path} className="chip !min-h-[40px] !bg-card !px-4 hover:!bg-card-3">
                  {c.name}
                </Link>
              </li>
            ))}
          </ul>
        </div>
        <div className="lg:col-span-6">
          <div className="float p-5 sm:p-7">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="text-[1.05rem] font-[650] text-ink">Where does a sale leave you the most?</h2>
              <span className="text-[0.78rem] text-ink-4">US · live</span>
            </div>
            <div className="mt-4">
              <CompareTool initial={initial} initialRows={rows} compact />
            </div>
          </div>
        </div>
      </section>

      <RecentStrip title="Pick up where you left off" />

      {CATEGORY_ORDER.map((cat) => {
        const list = CATALOG.filter((c) => c.category === cat);
        if (!list.length) return null;
        return (
          <section key={cat} id={cat} className="scroll-mt-28 pt-16" aria-labelledby={`h-${cat}`}>
            <div className="max-w-2xl">
              <h2 id={`h-${cat}`} className="display text-[2rem] text-ink sm:text-[2.4rem]">
                {CATEGORY_LABEL[cat]}
              </h2>
              <p className="mt-2 text-[1rem] text-ink-3">{CATEGORY_DEK[cat]}</p>
            </div>
            <ul className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {list.map((c) => (
                <li key={c.slug}>
                  <Link href={c.path} className="float float-lift flex h-full flex-col px-5 py-4">
                    <span className="flex items-baseline justify-between gap-3">
                      <span className="text-[1.05rem] font-[650] text-ink">{c.name}</span>
                      <span className="text-[0.74rem] text-ink-4">checked {formatDate(c.verifiedAt)}</span>
                    </span>
                    <span className="mt-1 text-[0.88rem] leading-snug text-ink-3">{c.blurb}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        );
      })}

      <section className="pt-20" aria-labelledby="trust-h">
        <h2 id="trust-h" className="display max-w-2xl text-[2rem] text-ink sm:text-[2.4rem]">
          Numbers you can check
        </h2>
        <div className="mt-6 grid gap-3 md:grid-cols-3">
          {[
            { t: "Official sources only", d: "Every rate comes from the platform’s own fee pages and help center, listed on each calculator with the date we read them." },
            { t: "Watched every day", d: "An automated job re-reads every source page daily. When one changes, the calculator is reviewed and updated." },
            { t: "Every line explained", d: "Each fee shows its arithmetic and what it’s charged on, so you can match it to your statement line by line." },
          ].map((x) => (
            <div key={x.t} className="float px-5 py-5">
              <div className="text-[1rem] font-[650] text-ink">{x.t}</div>
              <p className="mt-1.5 text-[0.92rem] leading-relaxed text-ink-3">{x.d}</p>
            </div>
          ))}
        </div>
        <Link href="/methodology" className="link mt-5 inline-block text-[0.95rem]">
          How we check fees →
        </Link>
      </section>

      {changes.length > 0 && (
        <section className="pt-20" aria-labelledby="changes-h">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 id="changes-h" className="display text-[2rem] text-ink sm:text-[2.4rem]">
              Latest fee changes
            </h2>
            <Link href="/fee-changes" className="link text-[0.95rem]">
              All changes →
            </Link>
          </div>
          <ul className="mt-6 grid gap-3 md:grid-cols-2">
            {changes.map((c) => (
              <li key={`${c.def.slug}-${c.date}`}>
                <Link href={c.def.path} className="float float-lift block h-full px-5 py-4">
                  <span className="flex items-baseline justify-between gap-3">
                    <span className="text-[0.95rem] font-[650] text-ink">{c.def.name}</span>
                    <span className="tnum text-[0.8rem] text-ink-3">
                      {c.date > today ? "from " : ""}
                      {formatDate(c.date)}
                    </span>
                  </span>
                  <span className="mt-1.5 line-clamp-3 block text-[0.9rem] leading-relaxed text-ink-2">{c.text}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
