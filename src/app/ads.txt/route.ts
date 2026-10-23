import { adsenseClient } from "@/lib/env";

export const dynamic = "force-static";

/** ads.txt: authorises Google to sell ads on this domain once a publisher id is configured. */
export function GET() {
  const client = adsenseClient();
  if (!client) return new Response("# No advertising sellers are authorised yet.\n", { headers: { "Content-Type": "text/plain; charset=utf-8" } });
  const pub = client.replace(/^ca-/, "");
  return new Response(`google.com, ${pub}, DIRECT, f08c47fec0942fa0\n`, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
