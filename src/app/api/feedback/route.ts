import { z } from "zod";
import { waitUntil } from "@vercel/functions";
import { db } from "@/lib/db";
import { feedback } from "@/lib/db/schema";
import { clientIp, ipHash, rateLimit, tooMany } from "@/lib/ratelimit";
import { captureError } from "@/lib/errors";
import { notifyOwner } from "@/lib/notify";
import { newId } from "@/lib/ids";
import { SITE } from "@/lib/site";
import { ALL } from "@/fees/all";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SLUGS = ALL.map((d) => d.slug) as [string, ...string[]];

const Body = z.object({
  calculator: z.enum(SLUGS),
  market: z.string().max(10).optional(),
  helpful: z.boolean(),
  note: z.string().trim().max(1000).optional().default(""),
  inputs: z.record(z.string().max(40), z.union([z.number(), z.string().max(80), z.boolean()])).optional(),
});

/**
 * "Does this match your statement?" answers. A "something's off" report with a note emails the
 * owner right away: it is how a fee change the watcher missed gets caught.
 */
export async function POST(req: Request) {
  try {
    const ip = ipHash(clientIp(req.headers));
    const rl = await rateLimit(`feedback:${ip}`, 12, 600);
    if (!rl.ok) return tooMany(rl);
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return Response.json({ error: "Invalid feedback." }, { status: 400 });
    const d = parsed.data;
    const inputs = d.inputs && Object.keys(d.inputs).length <= 40 ? d.inputs : undefined;
    await db.insert(feedback).values({ id: newId("fbk"), calculator: d.calculator, market: d.market ?? null, helpful: d.helpful, note: d.note || null, inputs: inputs ?? null, ipHash: ip });
    if (!d.helpful && d.note) {
      const p = notifyOwner({
        subject: `Fee report: ${d.calculator}${d.market ? ` (${d.market})` : ""}`,
        text: [`Someone says the ${d.calculator} calculator looks off:`, "", d.note, "", `Inputs: ${JSON.stringify(inputs ?? {})}`, "", `Review: ${SITE.url}/admin/feedback`].join("\n"),
      });
      try {
        waitUntil(p);
      } catch {
        await p;
      }
    }
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    await captureError(err, { route: "/api/feedback" });
    return Response.json({ error: "Could not save feedback." }, { status: 500 });
  }
}
