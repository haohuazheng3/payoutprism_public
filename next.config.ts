import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";
const indexable = process.env.VERCEL_ENV === "production" && process.env.SITE_INDEXABLE === "1";
const adsense = /^ca-pub-\d{10,20}$/.test(process.env.NEXT_PUBLIC_ADSENSE_CLIENT ?? "");

// FlowGlance loads from flowglance.com and posts to collect.flowglance.com (a blocked collector silently loses all analytics).
const FLOWGLANCE = ["https://flowglance.com", "https://*.flowglance.com"];
// Google AdSense (only once a publisher id is configured): script, ad frames, measurement.
const ADS = adsense
  ? [
      "https://pagead2.googlesyndication.com",
      "https://*.googlesyndication.com",
      "https://googleads.g.doubleclick.net",
      "https://*.doubleclick.net",
      "https://www.google.com",
      "https://*.google.com",
      "https://*.adtrafficquality.google",
      "https://fundingchoicesmessages.google.com",
      "https://*.gstatic.com",
    ]
  : [];

// Pages are statically generated (no per-request nonce), so Next's inline bootstrap needs 'unsafe-inline'.
const csp = [
  ["default-src", "'self'"],
  ["script-src", "'self'", "'unsafe-inline'", ...(isDev ? ["'unsafe-eval'"] : []), ...FLOWGLANCE, ...ADS],
  ["style-src", "'self'", "'unsafe-inline'"],
  ["img-src", "'self'", "data:", "blob:", ...FLOWGLANCE, ...ADS],
  ["font-src", "'self'", "data:"],
  ["connect-src", "'self'", ...FLOWGLANCE, ...ADS, ...(isDev ? ["ws:", "http://localhost:*"] : [])],
  ["frame-src", "'self'", ...ADS],
  ["worker-src", "'self'", "blob:"],
  ["object-src", "'none'"],
  ["base-uri", "'self'"],
  ["form-action", "'self'"],
  ["frame-ancestors", "'none'"],
  ...(isDev ? [] : [["upgrade-insecure-requests"]]),
]
  .map((d) => d.join(" "))
  .join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), browsing-topics=(), payment=()" },
  // Until launch every environment says noindex at the header level as well as in <meta>.
  ...(indexable ? [] : [{ key: "X-Robots-Tag", value: "noindex, nofollow" }]),
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  // Most visitors arrive once from search: ship the small CSS inside the HTML instead of a render-blocking request.
  experimental: { inlineCss: true },
  images: { formats: ["image/avif", "image/webp"] },
  outputFileTracingIncludes: {
    "/blog/**": ["./content/blog/**/*"],
    "/sitemap.xml": ["./content/blog/**/*"],
    "/llms.txt": ["./content/blog/**/*"],
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      { source: "/brand/:file*", headers: [{ key: "Cache-Control", value: "public, max-age=604800, stale-while-revalidate=86400" }] },
    ];
  },
};

export default nextConfig;
