import type { Metadata } from "next";
import { SITE } from "./site";

export function absoluteUrl(path: string): string {
  if (/^https?:\/\//.test(path)) return path;
  return `${SITE.url}${path.startsWith("/") ? path : `/${path}`}`;
}

export function pageMetadata(input: {
  title: string;
  description: string;
  path: string;
  image?: string;
  noindex?: boolean;
  type?: "website" | "article";
  absoluteTitle?: boolean;
  /** hreflang alternates (path per language-region), for pages with a regional twin. */
  languages?: Record<string, string>;
}): Metadata {
  const url = absoluteUrl(input.path);
  const image = input.image ?? "/og/default";
  return {
    title: input.absoluteTitle ? { absolute: input.title } : input.title,
    description: input.description,
    alternates: { canonical: url, ...(input.languages ? { languages: Object.fromEntries(Object.entries(input.languages).map(([k, v]) => [k, absoluteUrl(v)])) } : {}) },
    openGraph: {
      title: input.title,
      description: input.description,
      url,
      siteName: SITE.name,
      type: input.type === "article" ? "article" : "website",
      locale: SITE.locale,
      images: [{ url: absoluteUrl(image), width: 1200, height: 630, alt: input.title }],
    },
    twitter: {
      card: "summary_large_image",
      title: input.title,
      description: input.description,
      images: [absoluteUrl(image)],
    },
    ...(input.noindex ? { robots: { index: false, follow: true } } : {}),
  };
}

const ORG_ID = `${SITE.url}/#organization`;
const SITE_ID = `${SITE.url}/#website`;

export function organizationLd() {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": ORG_ID,
    name: SITE.name,
    url: SITE.url,
    logo: { "@type": "ImageObject", url: absoluteUrl("/brand/logo-512.png"), width: 512, height: 512 },
    email: SITE.email,
    description: SITE.description,
    foundingDate: String(SITE.foundingYear),
    contactPoint: [{ "@type": "ContactPoint", contactType: "customer support", email: SITE.email, availableLanguage: ["English"] }],
  };
}

export function websiteLd() {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": SITE_ID,
    name: SITE.name,
    url: SITE.url,
    description: SITE.description,
    publisher: { "@id": ORG_ID },
    inLanguage: "en-US",
  };
}

export function breadcrumbLd(items: { name: string; path: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((it, i) => ({ "@type": "ListItem", position: i + 1, name: it.name, item: absoluteUrl(it.path) })),
  };
}

export function faqLd(faq: { q: string; a: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faq.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
  };
}

/** A free calculator as a web application (no price, no rating: we never invent social proof). */
export function calculatorLd(input: { name: string; description: string; path: string; dateModified: string }) {
  return {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    "@id": `${absoluteUrl(input.path)}#app`,
    name: input.name,
    description: input.description,
    url: absoluteUrl(input.path),
    applicationCategory: "FinanceApplication",
    operatingSystem: "Any (web browser)",
    browserRequirements: "Requires JavaScript",
    isAccessibleForFree: true,
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
    dateModified: input.dateModified,
    publisher: { "@id": ORG_ID },
    inLanguage: "en-US",
  };
}

export function articleLd(input: { title: string; description: string; path: string; publishedAt: string; updatedAt?: string; image?: string }) {
  return {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: input.title,
    description: input.description,
    url: absoluteUrl(input.path),
    mainEntityOfPage: absoluteUrl(input.path),
    datePublished: input.publishedAt,
    dateModified: input.updatedAt ?? input.publishedAt,
    author: { "@type": "Organization", "@id": ORG_ID, name: SITE.name, url: SITE.url },
    publisher: { "@id": ORG_ID },
    image: input.image ? absoluteUrl(input.image) : absoluteUrl("/og/default"),
    inLanguage: "en-US",
  };
}

/** Serialize JSON-LD for an inline script: `<` is escaped so the payload can never close the tag. */
export function serializeLd(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
