import { bearerMatches } from "@/lib/admin";
import { env } from "@/lib/env";
import { checkHealth } from "@/lib/health";
import { notifyOwner } from "@/lib/notify";
import { getAppState, setAppState } from "@/lib/app-state";
import { SITE } from "@/lib/site";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALERT_EVERY_MS = 3 * 60 * 60 * 1000;

interface ProbeState {
  failing: boolean;
  lastAlertAt: number;
  since: number;
}

/**
 * Vercel Cron, every 30 minutes (vercel.json). Emails the owner when health turns red (at most
 * every 3 hours while it stays red) and once more when it recovers. Outside monitoring of the
 * whole deployment is GitHub Actions' job (health.yml).
 */
export async function GET(req: Request) {
  if (!bearerMatches(req, env("CRON_SECRET"))) return Response.json({ error: "unauthorized" }, { status: 401 });
  const { ok, body } = await checkHealth(true);
  let state: ProbeState = { failing: false, lastAlertAt: 0, since: 0 };
  try {
    const s = await getAppState("health:probe");
    if (s?.value && typeof s.value === "object") state = s.value as ProbeState;
  } catch {
    /* the database may be the thing that's down; alert anyway */
  }
  const now = Date.now();
  let action = "none";
  if (!ok && (!state.failing || now - state.lastAlertAt > ALERT_EVERY_MS)) {
    await notifyOwner({ subject: `ALERT: ${SITE.domain} health check failing`, text: `${JSON.stringify(body, null, 2)}\n\nError inbox: ${SITE.url}/admin?tab=errors` });
    state = { failing: true, lastAlertAt: now, since: state.failing ? state.since : now };
    action = "alerted";
  } else if (ok && state.failing) {
    await notifyOwner({ subject: `Recovered: ${SITE.domain} health check passing`, text: `Green again after ${Math.round((now - state.since) / 60000)} minutes.` });
    state = { failing: false, lastAlertAt: 0, since: 0 };
    action = "recovered";
  }
  try {
    await setAppState("health:probe", state);
  } catch {
    /* recorded in the next successful run */
  }
  return Response.json({ ok, action }, { headers: { "Cache-Control": "no-store" } });
}
