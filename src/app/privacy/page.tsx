import Link from "next/link";
import { PageShell, TextModule } from "@/components/PageShell";
import { pageMetadata } from "@/lib/seo";
import { CONTENT_UPDATED, SITE } from "@/lib/site";
import { adsenseClient } from "@/lib/env";

export const metadata = pageMetadata({
  title: "Privacy policy",
  description: `What ${SITE.name} collects (very little), why, who processes it, and how to have it deleted. No accounts, no selling of data.`,
  path: "/privacy",
});

export default function Privacy() {
  const ads = Boolean(adsenseClient());
  return (
    <PageShell
      title="Privacy policy"
      path="/privacy"
      updated={CONTENT_UPDATED}
      dek={`The short version: ${SITE.name} has no accounts and no payments. The calculators run in your browser. We learn how the site is used through one analytics tool, FlowGlance, which only loads when the law and your choice allow it, and we keep messages you send us so we can answer them.`}
    >
      <TextModule>
        <h2>Who we are</h2>
        <p>
          {SITE.name} ({SITE.domain}) publishes free fee calculators. In this policy “we” means {SITE.name}. Questions or requests about your data go to{" "}
          <a href={`mailto:${SITE.email}`}>{SITE.email}</a>.
        </p>

        <h2>What happens when you use a calculator</h2>
        <p>
          The arithmetic runs entirely in your browser. The numbers you type are not sent to our servers to produce a result. Two things do leave your device, and only in the cases
          below:
        </p>
        <ul>
          <li>
            <strong>The page address.</strong> Your inputs are written into the page URL (for example <code>?price=28</code>) so you can share or bookmark a calculation. Anyone
            you share the link with sees those numbers.
          </li>
          <li>
            <strong>Analytics, if allowed.</strong> When FlowGlance is active (see below), it records how the page is used, which includes the numbers and text you type into
            form fields.
          </li>
        </ul>
        <p>
          Your recent calculations are saved in your browser’s local storage so you can return to them. They never leave your device, and the “Clear” button next to them deletes
          them.
        </p>

        <h2>Analytics: FlowGlance</h2>
        <p>
          FlowGlance is the only analytics tool on this site. It helps us see which calculators people use, where they get stuck, and which pages need better explanations. When
          active, it records:
        </p>
        <ul>
          <li>pages viewed, time on page, scrolling, clicks and taps, and the page that sent you here;</li>
          <li>
            <strong>text and numbers you type into forms</strong>, including calculator inputs and anything you write in the contact or feedback forms;
          </li>
          <li>images you upload through a form (this site currently has no upload fields, so in practice none);</li>
          <li>browser and device type, screen size, language, and an approximate location derived from your IP address;</li>
          <li>errors that occur in the page.</li>
        </ul>
        <p>
          <strong>When it loads.</strong> In the European Economic Area, the United Kingdom and Switzerland (or when we cannot tell where you are), FlowGlance loads only after
          you choose “Allow analytics”. Elsewhere it loads by default and you can opt out at any time with the “Cookie settings” link in the footer. Your choice is stored in a
          cookie named <code>pp_consent</code> for 180 days.
        </p>

        <h2>Messages and fee reports you send us</h2>
        <p>
          The contact form stores your name (optional), email address, topic, message, the page you came from, your browser’s user-agent string and a salted one-way hash of
          your IP address (used only to stop spam). A copy is emailed to us so we can reply. The “Does this match your statement?” buttons store your answer, any note you write,
          the calculator inputs at that moment and the same IP hash. We keep messages for as long as we need them to handle your request and our records, then delete them; you can
          ask us to delete yours at any time.
        </p>

        <h2>Logs and security</h2>
        <p>
          Our host keeps standard server logs (IP address, time, page requested, browser) for security and reliability. When something breaks, we record the error, the page and
          the browser type so we can fix it. To prevent abuse we count requests per salted IP hash for a few minutes at a time.
        </p>

        {ads ? (
          <>
            <h2>Advertising: Google AdSense</h2>
            <p>
              The site shows ads served by Google AdSense, which keeps the calculators free. Google and its partners use cookies and similar technologies to serve ads based on
              your visits to this and other websites, and to measure them. You can turn off personalised ads at{" "}
              <a href="https://adssettings.google.com" target="_blank" rel="noopener noreferrer">
                Google’s Ad Settings
              </a>{" "}
              and learn more at{" "}
              <a href="https://policies.google.com/technologies/ads" target="_blank" rel="noopener noreferrer">
                How Google uses information from sites that use its services
              </a>
              . In the EEA, the UK and Switzerland, a consent message from Google asks for your choice before personalised ads are shown.
            </p>
          </>
        ) : (
          <>
            <h2>Advertising</h2>
            <p>
              There are no ads on the site today. If we add advertising (we plan to use Google AdSense to keep the calculators free), this policy will be updated before the first ad
              appears, describing what the ad provider collects and the choices you have.
            </p>
          </>
        )}

        <h2>Who processes data for us</h2>
        <ul>
          <li>
            <strong>Vercel</strong>: hosting and content delivery (United States and edge locations worldwide).
          </li>
          <li>
            <strong>Neon</strong>: our database for messages, feedback, error reports and rate-limit counters (hosted on AWS in the United States).
          </li>
          <li>
            <strong>Cloudflare</strong>: domain name service and email routing for {SITE.email}, plus the small service that sends us notifications.
          </li>
          <li>
            <strong>FlowGlance</strong>: analytics, as described above.
          </li>
          <li>
            <strong>Google</strong>: we use Google Search Console to see how our pages appear in Google Search (aggregated search data, not data about you)
            {ads ? ", and Google AdSense for advertising" : ""}. Email we receive is delivered to a Google mailbox.
          </li>
        </ul>
        <p>We do not sell or rent personal information, and we do not share it for cross-context behavioural advertising except as described in the advertising section.</p>

        <h2>Your rights</h2>
        <p>
          Wherever you live, you can ask us what we hold about you, ask for a copy, and ask us to correct or delete it. If you are in the EEA, the UK or Switzerland you can also
          object to processing, withdraw consent (the footer’s “Cookie settings” does this for analytics), and complain to your data protection authority. California residents
          have the right to know, delete and correct, and to opt out of sale or sharing (we do neither). Email {SITE.email}; we answer within 30 days.
        </p>
        <p>
          Our legal bases under the GDPR: consent for analytics in the EEA, UK and Switzerland; legitimate interests for security logs, spam prevention and answering messages you
          choose to send.
        </p>

        <h2>Children</h2>
        <p>The site is meant for adults who sell or get paid online. It is not directed at children under 16, and we do not knowingly collect their information.</p>

        <h2>Changes</h2>
        <p>
          When this policy changes we update the date at the top. Material changes are noted on this page. See also our <Link href="/cookie-policy">cookie policy</Link> and{" "}
          <Link href="/terms">terms of use</Link>.
        </p>
      </TextModule>
    </PageShell>
  );
}
