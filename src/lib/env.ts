/**
 * Environment helpers. Values are read lazily (never at import time) so a missing optional
 * variable degrades one feature instead of crashing the whole app.
 */

export function env(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() !== "" ? v.trim() : undefined;
}

/** Which deployment this is, as Vercel labels it. Off Vercel there is no production deployment. */
export const VERCEL_ENV = process.env.VERCEL_ENV ?? "development";
export const IS_PRODUCTION_DEPLOY = process.env.VERCEL_ENV === "production";

/**
 * The site is indexable only on the production deployment AND once SITE_INDEXABLE=1.
 * Until launch every environment sends noindex at both the meta and the header level.
 */
export function isIndexable(): boolean {
  return IS_PRODUCTION_DEPLOY && process.env.SITE_INDEXABLE === "1";
}

/** Variables the site needs to be fully functional; /api/health reports which are missing (names only). */
export const REQUIRED_ENV = [
  "DATABASE_URL",
  "MAIL_WORKER_URL",
  "MAIL_WORKER_TOKEN",
  "CRON_SECRET",
  "ADMIN_PASSWORD",
  "ADMIN_SESSION_SECRET",
  "NEXT_PUBLIC_FLOWGLANCE_KEY",
] as const;

export function missingEnv(): string[] {
  const missing: string[] = REQUIRED_ENV.filter((n) => !env(n));
  if (process.env.NODE_ENV === "production" && !env("VERCEL_ENV")) missing.push("VERCEL_ENV");
  return missing;
}

/** Google AdSense publisher id (ca-pub-…); ads, ads.txt and the ad CSP turn on only when it is set. */
export function adsenseClient(): string | undefined {
  const v = process.env.NEXT_PUBLIC_ADSENSE_CLIENT?.trim();
  return v && /^ca-pub-\d{10,20}$/.test(v) ? v : undefined;
}
