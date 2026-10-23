/**
 * Blog taxonomy. /blog is a navigation hub; every article lives at /blog/<category>/<slug>, and
 * each category page is a hub that can rank on its own (title, description, intro, breadcrumbs,
 * paginated archive). Empty hubs are noindex and stay out of the sitemap until they have posts.
 */
export interface BlogCategory {
  slug: string;
  name: string;
  title: string;
  description: string;
  intro: string;
}

export const BLOG_CATEGORIES: BlogCategory[] = [
  {
    slug: "selling-fees",
    name: "Selling fees explained",
    title: "Marketplace Selling Fees Explained",
    description: "Clear, sourced explanations of what Etsy, eBay, Amazon, Poshmark, Mercari and other marketplaces charge sellers, and how to lower each fee.",
    intro: "Each marketplace hides its fees in a different place and charges them on a different base. These guides take one platform or one fee at a time, show the arithmetic, and link to the official page.",
  },
  {
    slug: "payments",
    name: "Payments & payouts",
    title: "Payment Processing Fees and Payouts, Explained",
    description: "What PayPal, Stripe, Square, Venmo and Cash App charge to accept money and to move it to your bank, with worked examples.",
    intro: "Getting paid has its own fees: a percentage and a fixed amount per transaction, more for international cards and currency conversion, and sometimes a fee to withdraw. These guides compare them in real numbers.",
  },
  {
    slug: "pricing",
    name: "Pricing & profit",
    title: "Pricing for Profit After Platform Fees",
    description: "How to set prices that leave the profit you want once marketplace, payment, shipping and ad fees are taken.",
    intro: "A price that looks healthy can lose money once every fee is counted. These guides work backwards from the profit you want to the price to charge.",
  },
  {
    slug: "comparisons",
    name: "Platform comparisons",
    title: "Selling Platform Fee Comparisons",
    description: "Side-by-side fee comparisons of selling, payment and freelance platforms for the same sale.",
    intro: "Where does the same sale leave you the most? These comparisons run identical numbers through each platform’s current fees.",
  },
  {
    slug: "fee-news",
    name: "Fee changes & news",
    title: "Platform Fee Changes and News",
    description: "Dated write-ups of fee changes on major selling and payment platforms: what changed, when, and what it means for your payout.",
    intro: "When a platform changes its fees, we update the calculator first and then explain the change here, with the before and after numbers.",
  },
];

export function categoryBySlug(slug: string) {
  return BLOG_CATEGORIES.find((c) => c.slug === slug);
}
