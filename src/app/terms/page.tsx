import Link from "next/link";
import { PageShell, TextModule } from "@/components/PageShell";
import { pageMetadata } from "@/lib/seo";
import { CONTENT_UPDATED, SITE } from "@/lib/site";

export const metadata = pageMetadata({
  title: "Terms of use",
  description: `The terms for using ${SITE.name}'s free fee calculators: estimates, not financial advice; your platform statement is final.`,
  path: "/terms",
});

export default function Terms() {
  return (
    <PageShell
      title="Terms of use"
      path="/terms"
      updated={CONTENT_UPDATED}
      dek="Plain terms for a free tool. The calculators are estimates built from each platform’s published fees; the platform’s own statement always decides what you are charged."
    >
      <TextModule>
        <h2>The service</h2>
        <p>
          {SITE.name} provides free calculators that estimate the fees charged by online marketplaces, payment processors and similar platforms, and the amount you would receive.
          There is no account and no charge. By using the site you agree to these terms.
        </p>

        <h2>Estimates, not advice</h2>
        <p>
          We build every calculator from the fee pages each platform publishes and record the date we last checked them. Platforms change fees, run promotions, apply
          account-specific rates and round differently, so a result can differ from what you are actually charged. Your platform’s statement, invoice or payout report is final.
          Nothing on this site is financial, tax, accounting or legal advice. For decisions that matter, check the platform’s current terms and, where needed, ask a qualified
          professional.
        </p>

        <h2>Independence and trademarks</h2>
        <p>
          {SITE.name} is independent. We are not affiliated with, endorsed by or sponsored by any platform we cover. Platform names are trademarks of their owners and are used only
          to identify the services our calculators describe.
        </p>

        <h2>Acceptable use</h2>
        <ul>
          <li>Use the calculators and content for your own information, personal or business.</li>
          <li>Don’t overload the site with automated requests, try to break its security, or use it to send spam through our forms.</li>
          <li>You may link to any page and quote short passages with a link back. Please don’t republish our tables or copy in bulk.</li>
        </ul>

        <h2>No warranty</h2>
        <p>
          The site is provided “as is” and “as available”, without warranties of any kind, express or implied, including accuracy, fitness for a particular purpose and
          non-infringement. We work to keep every number right and fix errors quickly when we learn of them, but we can’t promise the site is error-free or always online.
        </p>

        <h2>Limitation of liability</h2>
        <p>
          To the fullest extent the law allows, {SITE.name} is not liable for any indirect, incidental, special or consequential loss, or for lost profits or revenue, arising from
          your use of the site or reliance on its results. Where liability cannot be excluded, it is limited to the greater of zero and the amount you paid us, which is nothing.
          Some places don’t allow these limits; there, they apply only as far as the law permits.
        </p>

        <h2>Changes</h2>
        <p>
          We may update these terms; the date at the top shows the latest version. Questions: <a href={`mailto:${SITE.email}`}>{SITE.email}</a> or the{" "}
          <Link href="/contact">contact page</Link>. See also the <Link href="/privacy">privacy policy</Link>.
        </p>
      </TextModule>
    </PageShell>
  );
}
