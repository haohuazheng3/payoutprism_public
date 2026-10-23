import Script from "next/script";
import { adsenseClient } from "@/lib/env";

/*
 * Google AdSense, off until NEXT_PUBLIC_ADSENSE_CLIENT (ca-pub-…) is set. Slots reserve their
 * height up front so ads never shift the page (CLS), and nothing renders while ads are off.
 */

export function AdSenseScript() {
  const client = adsenseClient();
  if (!client) return null;
  return <Script id="adsbygoogle-init" async strategy="afterInteractive" src={`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${client}`} crossOrigin="anonymous" />;
}

export function AdSlot({ slot, minHeight = 280, label = "Advertisement" }: { slot?: string; minHeight?: number; label?: string }) {
  const client = adsenseClient();
  if (!client || !slot) return null;
  return (
    <div className="my-8" style={{ minHeight }}>
      <div className="mb-1 text-center text-[0.68rem] uppercase tracking-[0.14em] text-ink-4">{label}</div>
      <ins className="adsbygoogle block" style={{ display: "block", minHeight }} data-ad-client={client} data-ad-slot={slot} data-ad-format="auto" data-full-width-responsive="true" />
      <Script id={`ad-${slot}`} strategy="afterInteractive">{`(window.adsbygoogle=window.adsbygoogle||[]).push({});`}</Script>
    </div>
  );
}
