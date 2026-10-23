import { eq, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { contactMessages, errorGroups, feedback, feeWatch } from "@/lib/db/schema";
import { withErrorCapture } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Admin actions (the proxy only lets a signed admin session through): resolve errors, mark items reviewed. */
async function handle(req: Request): Promise<Response> {
  const form = await req.formData();
  const action = String(form.get("action") ?? "");
  const id = String(form.get("id") ?? "");
  const back = String(form.get("back") ?? "/admin");
  if (action === "resolve" && id) await db.update(errorGroups).set({ resolvedAt: sql`now()` }).where(eq(errorGroups.id, id));
  else if (action === "resolve-all") await db.update(errorGroups).set({ resolvedAt: sql`now()` }).where(isNull(errorGroups.resolvedAt));
  else if (action === "message-done" && id) await db.update(contactMessages).set({ status: "replied" }).where(eq(contactMessages.id, id));
  else if (action === "feedback-done" && id) await db.update(feedback).set({ status: "reviewed" }).where(eq(feedback.id, id));
  else if (action === "watch-reviewed" && id) await db.update(feeWatch).set({ status: "ok", reviewedAt: sql`now()` }).where(eq(feeWatch.url, id));
  else return Response.json({ error: "unknown action" }, { status: 400 });
  return new Response(null, { status: 303, headers: { Location: back.startsWith("/admin") ? back : "/admin", "Cache-Control": "no-store" } });
}

export const POST = withErrorCapture("/api/admin/errors", handle);
