import Link from "next/link";
import { PageShell, TextModule } from "@/components/PageShell";
import { pageMetadata } from "@/lib/seo";
import { CONTENT_UPDATED, SITE } from "@/lib/site";
import { ALL } from "@/fees/all";

export const metadata = pageMetadata({
  title: "About",
  description: `${SITE.name} makes free, precise fee calculators for sellers, freelancers and creators, checked against each platform's own pages.`,
  path: "/about",
});

export default function About() {
  return (
    <PageShell title={`About ${SITE.name}`} crumb="About" path="/about" updated={CONTENT_UPDATED} dek={SITE.tagline}>
      <TextModule>
        <h2>Why this exists</h2>
        <p>
          Selling online means paying several fees at once: a listing fee, a cut of the sale, a payment fee that is charged on shipping and sometimes on tax, an ad fee if the buyer
          came through an ad, a fee to move the money to your bank. Each one lives on a different help page, and they change. Most calculators online were built once and never
          checked again.
        </p>
        <p>
          {SITE.name} does one thing: shows you, line by line, what a sale or payment really leaves you, on {ALL.length} platforms, with the date every number was last checked
          against the platform’s own pages.
        </p>

        <h2>What we promise</h2>
        <ul>
          <li>
            <strong>Dated, sourced numbers.</strong> Every calculator links to its official sources and says when we last read them. See{" "}
            <Link href="/methodology">how we check fees</Link>.
          </li>
          <li>
            <strong>Free, no sign-up.</strong> No account, no email gate, no paid tier. The calculations run in your browser.
          </li>
          <li>
            <strong>Independent.</strong> We are not affiliated with any platform we cover, and no platform pays to be listed or ranked.
          </li>
          <li>
            <strong>No invented proof.</strong> You won’t find made-up user counts, ratings or testimonials here.
          </li>
        </ul>

        <h2>How the site is funded</h2>
        <p>
          The site is free to use. We plan to show a small number of clearly labelled ads (Google AdSense) to pay for running it. Ads will never change a number, a ranking or a
          recommendation.
        </p>

        <h2>Talk to us</h2>
        <p>
          Found a fee that changed, or want a calculator we don’t have? <Link href="/contact">Write to us</Link> or email <a href={`mailto:${SITE.email}`}>{SITE.email}</a>.{" "}
          {SITE.replyTime}
        </p>
      </TextModule>
    </PageShell>
  );
}
