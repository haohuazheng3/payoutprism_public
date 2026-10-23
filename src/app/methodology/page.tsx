import Link from "next/link";
import { PageShell, TextModule } from "@/components/PageShell";
import { pageMetadata } from "@/lib/seo";
import { CONTENT_UPDATED, SITE } from "@/lib/site";
import { ALL } from "@/fees/all";

export const metadata = pageMetadata({
  title: "How we check fees",
  description: `How ${SITE.name} builds and maintains its fee calculators: official sources only, an independent second check, a daily watch on every fee page, and dated changes.`,
  path: "/methodology",
});

export default function Methodology() {
  const sources = ALL.reduce((n, d) => n + d.sources.length, 0);
  return (
    <PageShell
      title="How we check fees"
      path="/methodology"
      updated={CONTENT_UPDATED}
      dek="A fee calculator is only as good as its last check. Here is exactly how ours are built and kept current, including what they can’t know."
    >
      <TextModule>
        <h2>1. Official sources only</h2>
        <p>
          Every rate comes from the platform’s own pages: its fee schedule, help center, seller policies or official announcements. Blogs, forums and news only tell us where to
          look; a number never goes into a calculator from them. Each calculator lists the exact pages it is built on, with the date we last read them, at the bottom of its page.
          Across {ALL.length} calculators that is {sources} official pages today.
        </p>

        <h2>2. Two independent passes</h2>
        <p>
          One pass reads the official pages and writes down every fee: the rate, what it is charged on (the item, shipping, tax?), caps, minimums and country differences. A
          second, separate pass re-opens the same pages and tries to prove the first one wrong, and searches for announced changes that have not taken effect yet. Only the numbers
          that survive both go into the calculator, and the platform’s own worked examples, when it publishes any, become automated tests the calculator must pass.
        </p>

        <h2>3. A daily watch on every fee page</h2>
        <p>
          Platforms change fees with little notice. Every day an automated job downloads each source page and compares it with the last version. When a page changes, the
          calculator is flagged for review, a person reads the new page, and the calculator is updated before the flag is cleared. Changes that matter to sellers are dated in our{" "}
          <Link href="/fee-changes">fee changes log</Link> and on the calculator’s page.
        </p>

        <h2>4. Your reports</h2>
        <p>
          Under every result there is a “Does this match your statement?” question. A “Something’s off” answer reaches us immediately. If your statement disagrees with a
          calculator, please tell us what it shows: it is the fastest way we catch account-specific rates and quiet changes.
        </p>

        <h2>How the math works</h2>
        <ul>
          <li>Each fee is computed separately and rounded to the cent, half up, the way platforms show line items. A platform that rounds differently can differ by a cent.</li>
          <li>Fees are applied to exactly the base the platform names: some charge on shipping and sales tax, some don’t. Each line in a breakdown shows its arithmetic.</li>
          <li>“What to charge” mode searches for the lowest price that reaches your target, including across flat-fee thresholds, so it never suggests a price that pays less.</li>
        </ul>

        <h2>What the calculators can’t know</h2>
        <ul>
          <li>Account-specific or negotiated rates, promotions, and seller-performance surcharges unless you turn them on.</li>
          <li>Live exchange rates. Where a platform charges a fixed fee in another currency, we show the conversion we used.</li>
          <li>Income tax, VAT or GST you owe on your earnings. Sales tax and VAT collected by a platform are shown separately where they affect fees.</li>
          <li>Refunds, chargebacks and disputes after the sale.</li>
        </ul>
        <p>
          Your platform statement is always the final word. If you see a difference, <Link href="/contact?topic=wrong-fee">tell us</Link>.
        </p>
      </TextModule>
    </PageShell>
  );
}
