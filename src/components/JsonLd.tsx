import { serializeLd } from "@/lib/seo";

/** Inline JSON-LD block; `serializeLd` escapes `<` so the payload can never close the script tag. */
export function JsonLd({ data }: { data: unknown }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeLd(data) }} />;
}
