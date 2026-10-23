import { ALL } from "./all";
import type { CalculatorSummary } from "./types";

/** Serializable summaries for menus, cards and the sitemap (no functions, safe to pass to client components). */
export const CATALOG: CalculatorSummary[] = ALL.map((d) => ({
  slug: d.slug,
  name: d.name,
  path: d.path,
  category: d.category,
  blurb: d.blurb,
  verifiedAt: d.verifiedAt,
}));
