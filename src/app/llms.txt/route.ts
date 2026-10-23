import { ALL } from "@/fees/all";
import { CATEGORY_LABEL, CATEGORY_ORDER } from "@/fees/categories";
import { publishedPosts } from "@/lib/blog";
import { loadCalcContent } from "@/lib/calc-content";
import { SITE } from "@/lib/site";

export const dynamic = "force-static";

/** llms.txt: a plain map of the site for language models, in the format proposed at llmstxt.org. */
export function GET() {
  const lines = [`# ${SITE.name}`, "", `> ${SITE.description}`, ""];
  lines.push(
    "Every calculator lists the official fee pages it is built on and the date they were last checked. Results are estimates; the platform's statement is final.",
    "",
  );
  for (const cat of CATEGORY_ORDER) {
    const defs = ALL.filter((d) => d.category === cat);
    if (!defs.length) continue;
    lines.push(`## ${CATEGORY_LABEL[cat]}`, "");
    for (const d of defs) {
      const { front } = loadCalcContent(d.slug);
      lines.push(`- [${front.h1}](${SITE.url}${d.path}): ${front.description} (rates checked ${d.verifiedAt})`);
    }
    lines.push("");
  }
  lines.push("## Reference", "", `- [Compare platforms](${SITE.url}/compare): the same sale on every marketplace, ranked by what you keep`);
  lines.push(`- [Fee changes log](${SITE.url}/fee-changes): dated fee changes across platforms`, `- [How we check fees](${SITE.url}/methodology)`, "");
  const posts = publishedPosts();
  if (posts.length) {
    lines.push("## Guides", "");
    for (const p of posts) lines.push(`- [${p.title}](${SITE.url}/blog/${p.category}/${p.slug}): ${p.description}`);
    lines.push("");
  }
  return new Response(lines.join("\n"), { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600, s-maxage=86400" } });
}
