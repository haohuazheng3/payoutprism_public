import { ADMIN_COOKIE, ADMIN_SESSION_DAYS, createSessionValue, passwordMatches } from "@/lib/admin";
import { clientIp, ipHash, rateLimit, tooMany } from "@/lib/ratelimit";
import { captureError } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Password → signed session cookie. Five tries per 15 minutes per address. */
export async function POST(req: Request) {
  try {
    const rl = await rateLimit(`admin-login:${ipHash(clientIp(req.headers))}`, 5, 900);
    if (!rl.ok) return tooMany(rl);
    const form = await req.formData().catch(() => null);
    const password = typeof form?.get("password") === "string" ? String(form.get("password")) : "";
    const next = typeof form?.get("next") === "string" && String(form.get("next")).startsWith("/admin") ? String(form.get("next")) : "/admin";
    if (!passwordMatches(password)) {
      return new Response(null, { status: 303, headers: { Location: `/admin/login?error=1&next=${encodeURIComponent(next)}`, "Cache-Control": "no-store" } });
    }
    const value = createSessionValue();
    if (!value) return Response.json({ error: "ADMIN_SESSION_SECRET is not configured" }, { status: 503 });
    const cookie = `${ADMIN_COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${ADMIN_SESSION_DAYS * 86400}`;
    return new Response(null, { status: 303, headers: { Location: next, "Set-Cookie": cookie, "Cache-Control": "no-store" } });
  } catch (err) {
    await captureError(err, { route: "/api/admin/login" });
    return Response.json({ error: "login failed" }, { status: 500 });
  }
}
