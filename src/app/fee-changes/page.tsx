import Link from "next/link";
import { PageShell } from "@/components/PageShell";
import { formatChangeDate as formatDate } from "@/components/page/content-blocks";
import { ALL } from "@/fees/all";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({
  title: "Platform Fee Changes: Etsy, eBay, PayPal, Amazon and More",
  description: "A dated log of fee changes on selling, payment and freelance platforms, with the old and new rates and a link to each official announcement.",
  path: "/fee-changes",
  absoluteTitle: true,
});


export default function FeeChanges() {
  const today = new Date().toISOString().slice(0, 10);
  const all = ALL.flatMap((d) =>
    d.changes.map((c) => ({ ...c, def: d, src: c.source ? d.sources.find((s) => s.id === c.source) : undefined, upcoming: c.date > today })),
  );
  const upcoming = all.filter((c) => c.upcoming).sort((a, b) => a.date.localeCompare(b.date));
  const past = all.filter((c) => !c.upcoming).sort((a, b) => b.date.localeCompare(a.date));
  const byYear = new Map<string, typeof past>();
  for (const c of past) byYear.set(c.date.slice(0, 4), [...(byYear.get(c.date.slice(0, 4)) ?? []), c]);

  const Item = ({ c }: { c: (typeof all)[number] }) => (
    <li className="float flex flex-col gap-2 px-5 py-4 sm:flex-row sm:gap-5">
      <div className="w-[150px] flex-none">
        <div className="tnum text-[0.88rem] font-[620] text-ink">{formatDate(c.date)}</div>
        <Link href={c.def.path} className="text-[0.84rem] text-ink-3 hover:text-ink">
          {c.def.name} →
        </Link>
      </div>
      <p className="text-[0.95rem] leading-relaxed text-ink-2">
        {c.text}
        {c.src && (
          <a href={c.src.url} target="_blank" rel="noopener noreferrer" className="link ml-1.5 text-[0.82rem] text-ink-3">
            source
          </a>
        )}
      </p>
    </li>
  );

  return (
    <PageShell
      title="Fee changes"
      path="/fee-changes"
      wide
      dek="Every fee change we track, newest first. Announced changes that haven’t started yet are at the top. Each calculator switches on the date the change takes effect."
    >
      {upcoming.length > 0 && (
        <section className="mb-12">
          <h2 className="eyebrow mb-4">Coming up</h2>
          <ul className="space-y-3">
            {upcoming.map((c) => (
              <Item key={`${c.def.slug}-${c.date}-${c.text.slice(0, 24)}`} c={c} />
            ))}
          </ul>
        </section>
      )}
      {[...byYear.entries()].map(([year, list]) => (
        <section key={year} className="mb-12">
          <h2 className="display mb-4 text-[1.8rem] text-ink">{year}</h2>
          <ul className="space-y-3">
            {list.map((c) => (
              <Item key={`${c.def.slug}-${c.date}-${c.text.slice(0, 24)}`} c={c} />
            ))}
          </ul>
        </section>
      ))}
    </PageShell>
  );
}
