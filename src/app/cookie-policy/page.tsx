import { PageShell, TextModule } from "@/components/PageShell";
import { CookieSettingsLink } from "@/components/Consent";
import { pageMetadata } from "@/lib/seo";
import { CONTENT_UPDATED, SITE } from "@/lib/site";
import { adsenseClient } from "@/lib/env";

export const metadata = pageMetadata({
  title: "Cookie policy",
  description: `Every cookie and browser-storage item ${SITE.name} uses, what it is for, and how to change your choice.`,
  path: "/cookie-policy",
});

export default function CookiePolicy() {
  const ads = Boolean(adsenseClient());
  const rows: [string, string, string, string][] = [
    ["pp_consent (cookie)", SITE.domain, "Remembers your analytics choice", "180 days"],
    ["pp-theme (local storage)", SITE.domain, "Remembers light / dark / auto if you pick one", "Until you clear it"],
    ["pp:recent:v1 (local storage)", SITE.domain, "Your recent calculations, shown back to you; never sent to us", "Until you clear it"],
    ["FlowGlance cookies and storage", "flowglance.com", "Analytics: counts visits and records page activity, including form input (see the privacy policy)", "Up to 13 months"],
    ...(ads ? ([["Google AdSense cookies", "google.com, doubleclick.net", "Serving and measuring ads; personalisation where you allow it", "Up to 13 months"]] as [string, string, string, string][]) : []),
  ];
  return (
    <PageShell title="Cookie policy" path="/cookie-policy" updated={CONTENT_UPDATED} dek="A complete list, kept short on purpose. There is no sign-in, so there are no account cookies.">
      <div className="float mb-6 overflow-hidden">
        <div className="scroll-x">
          <table className="data-table min-w-[620px]">
            <thead>
              <tr>
                <th>Name</th>
                <th>Set by</th>
                <th>Purpose</th>
                <th>Lasts</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r[0]}>
                  {r.map((c) => (
                    <td key={c}>{c}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <TextModule>
        <h2>Your choice</h2>
        <p>
          In the EEA, the UK and Switzerland, analytics only start after you allow them. Elsewhere they start by default and you can opt out. Change your mind at any time:
        </p>
        <div className="not-prose my-4">
          <CookieSettingsLink />
        </div>
        <p>You can also block or delete cookies in your browser settings; the calculators keep working without any of them.</p>
        <h2>Strictly necessary</h2>
        <p>
          The site owner’s back office uses one session cookie (<code>admin_session</code>) that is only ever set for the owner. Visitors never receive it.
        </p>
      </TextModule>
    </PageShell>
  );
}
