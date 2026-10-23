import { z } from "zod";
import { waitUntil } from "@vercel/functions";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { contactMessages } from "@/lib/db/schema";
import { clientIp, ipHash, rateLimit, tooMany } from "@/lib/ratelimit";
import { captureError } from "@/lib/errors";
import { notifyOwner } from "@/lib/notify";
import { newId } from "@/lib/ids";
import { SITE } from "@/lib/site";
import { CONTACT_TOPIC_VALUES } from "@/content/contact";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  name: z.string().trim().max(120).optional().default(""),
  email: z.string().trim().toLowerCase().email().max(254),
  topic: z.enum(CONTACT_TOPIC_VALUES).catch("other"),
  message: z.string().trim().min(10, "Please write at least a sentence.").max(5000),
  page: z.string().trim().max(300).optional(),
  website: z.string().optional(), // honeypot
});

export async function POST(req: Request) {
  try {
    const ip = clientIp(req.headers);
    const rl = await rateLimit(`contact:${ipHash(ip)}`, 5, 600);
    if (!rl.ok) return tooMany(rl);

    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      const msg = first?.path[0] === "email" ? "Please enter a valid email address." : (first?.message ?? "Please check the form.");
      return Response.json({ error: msg }, { status: 400 });
    }
    const d = parsed.data;
    if (d.website) return Response.json({ ok: true }); // bots get a quiet success

    const id = newId("msg");
    await db.insert(contactMessages).values({
      id,
      name: d.name || null,
      email: d.email,
      topic: d.topic,
      message: d.message,
      page: d.page ?? null,
      ipHash: ipHash(ip),
      userAgent: (req.headers.get("user-agent") ?? "").slice(0, 300),
    });

    const notify = notifyOwner({
      subject: `Contact (${d.topic}) from ${d.email}`,
      text: [`From: ${d.name || "(no name)"} <${d.email}>`, `Topic: ${d.topic}`, d.page ? `Page: ${d.page}` : "", "", d.message, "", `Admin: ${SITE.url}/admin/messages`]
        .filter(Boolean)
        .join("\n"),
      replyTo: d.email,
    }).then(async (ok) => {
      if (ok) await db.update(contactMessages).set({ notified: 1 }).where(eq(contactMessages.id, id));
    });
    try {
      waitUntil(notify);
    } catch {
      await notify;
    }
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    await captureError(err, { route: "/api/contact" });
    return Response.json({ error: `We couldn’t send your message. Please email ${SITE.email} instead.` }, { status: 500 });
  }
}
