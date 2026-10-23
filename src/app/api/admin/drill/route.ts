import { captureError } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Owner-only alarm drill (the proxy requires the admin session). `kind=server` throws inside a
 * route handler so the real capture path runs: error inbox → /api/health red → owner email.
 * Resolve it afterwards in /admin (Errors → Resolve).
 */
export async function POST(req: Request) {
  const kind = new URL(req.url).searchParams.get("kind") ?? "server";
  if (kind !== "server") return Response.json({ error: "unknown kind" }, { status: 400 });
  try {
    throw new Error(`Alarm drill: deliberate server error (${new Date().toISOString()})`);
  } catch (err) {
    await captureError(err, { route: "/api/admin/drill", source: "server", context: { drill: true } });
    return Response.json({ ok: true, recorded: true }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
