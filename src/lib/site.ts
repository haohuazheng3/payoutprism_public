/**
 * Brand constants. Everything user-facing that names the brand reads from here, so the entity
 * stays consistent across pages, schema.org data and notifications.
 */

function siteUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, "");
  const vercel = process.env.VERCEL_URL?.trim();
  if (vercel && process.env.VERCEL_ENV !== "production") return `https://${vercel.replace(/^https?:\/\//, "")}`;
  return "https://payoutprism.com";
}

export const SITE = {
  name: "PayoutPrism",
  legalName: "PayoutPrism",
  domain: "payoutprism.com",
  url: siteUrl(),
  tagline: "See every fee before you sell.",
  description:
    "Free, precise fee calculators for Etsy, eBay, PayPal, Stripe, Amazon, Poshmark, Mercari and 25 more platforms. Every rate is checked against the platform's own fee pages, with the date we checked it.",
  email: "contact@payoutprism.com",
  replyTime: "We read every message and reply within two business days.",
  foundingYear: 2026,
  locale: "en_US",
} as const;

/** Pages that must never be indexed or listed in the sitemap. */
export const PRIVATE_PATHS = ["/admin", "/api/"] as const;

/** Last substantive edit of the evergreen pages (legal, about, methodology); used as `dateModified`. */
export const CONTENT_UPDATED = "2026-10-23";
