export const dynamic = "force-static";

/** IndexNow key file (keyLocation=<site>/indexnow.txt). */
export function GET() {
  const key = process.env.INDEXNOW_KEY?.trim() ?? "";
  if (!key) return new Response("not configured", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  return new Response(key, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
