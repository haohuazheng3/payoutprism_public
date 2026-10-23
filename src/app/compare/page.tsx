import { PageShell } from "@/components/PageShell";
import { CompareTool } from "@/components/CompareTool";
import { JsonLd } from "@/components/JsonLd";
import { ALL } from "@/fees/all";
import { compareAll } from "@/fees/compare";
import { calculatorLd, pageMetadata } from "@/lib/seo";
import { CONTENT_UPDATED } from "@/lib/site";

const sellCount = ALL.filter((d) => d.compare?.group === "sell").length;

export const metadata = pageMetadata({
  title: "Where Should I Sell? Compare Selling Fees on Every Platform",
  description: `Enter one price and see what you keep on ${sellCount} marketplaces side by side: Etsy, eBay, Amazon, Poshmark, Mercari and more, ranked, with every fee itemised.`,
  path: "/compare",
  absoluteTitle: true,
});

export default function ComparePage() {
  const initial = { price: 50, shipping: 6, itemCost: 0, shippingCost: 0 };
  const rows = { sell: compareAll(ALL, "sell", initial), pay: compareAll(ALL, "pay", initial) };
  return (
    <PageShell
      title="Compare platform fees"
      path="/compare"
      wide
      dek="One sale, every platform, ranked by what you keep. Change the price and the whole list re-ranks; open any platform to see its fees line by line with your numbers already filled in."
    >
      <JsonLd data={calculatorLd({ name: "Platform fee comparison", description: "Compare what you keep from the same sale on every major selling and payment platform.", path: "/compare", dateModified: CONTENT_UPDATED })} />
      <CompareTool initial={initial} initialRows={rows} />
    </PageShell>
  );
}
