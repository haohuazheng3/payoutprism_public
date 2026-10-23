import type { Metadata } from "next";
import Link from "next/link";
import { desc, isNull, sql, count } from "drizzle-orm";
import { db } from "@/lib/db";
import { contactMessages, errorGroups, feedback, feeWatch } from "@/lib/db/schema";
import { ALL } from "@/fees/all";
import { missingEnv } from "@/lib/env";
import { AdminIdentify } from "./AdminIdentify";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Back office", robots: { index: false, follow: false } };

const TABS = [
  { id: "errors", label: "Errors" },
  { id: "messages", label: "Messages" },
  { id: "feedback", label: "Fee reports" },
  { id: "watch", label: "Fee watch" },
  { id: "calculators", label: "Calculators" },
] as const;

function when(d: Date | null) {
  return d ? new Date(d).toISOString().replace("T", " ").slice(0, 16) + "Z" : "—";
}

function Action({ action, id, back, label }: { action: string; id?: string; back: string; label: string }) {
  return (
    <form method="post" action="/api/admin/errors" className="inline">
      <input type="hidden" name="action" value={action} />
      {id && <input type="hidden" name="id" value={id} />}
      <input type="hidden" name="back" value={back} />
      <button type="submit" className="btn btn-ghost btn-sm">
        {label}
      </button>
    </form>
  );
}

export default async function Admin({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const tab = (await searchParams).tab ?? "errors";
  const back = `/admin?tab=${tab}`;
  const [errCount, msgCount, fbCount, changed] = await Promise.all([
    db.select({ n: count() }).from(errorGroups).where(isNull(errorGroups.resolvedAt)),
    db.select({ n: count() }).from(contactMessages).where(sql`${contactMessages.status} = 'new'`),
    db.select({ n: count() }).from(feedback).where(sql`${feedback.status} = 'new' and ${feedback.helpful} = false`),
    db.select({ n: count() }).from(feeWatch).where(sql`${feeWatch.status} in ('changed','unreachable')`),
  ]);
  const badge: Record<string, number> = { errors: errCount[0].n, messages: msgCount[0].n, feedback: fbCount[0].n, watch: changed[0].n };
  const missing = missingEnv();

  return (
    <div className="mx-auto max-w-[1180px] px-3 py-10 sm:px-5">
      <AdminIdentify email={process.env.OWNER_ANALYTICS_EMAIL} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="display text-[2.4rem] text-ink">Back office</h1>
        <form method="post" action="/api/admin/logout">
          <button className="btn btn-quiet btn-sm">Sign out</button>
        </form>
      </div>
      {missing.length > 0 && <p className="mt-3 rounded-[14px] bg-warn-soft px-4 py-2.5 text-[0.9rem] text-warn">Missing env: {missing.join(", ")}</p>}
      <nav className="mt-6 flex flex-wrap gap-2">
        {TABS.map((t) => (
          <Link key={t.id} href={`/admin?tab=${t.id}`} className="chip" data-on={tab === t.id}>
            {t.label}
            {badge[t.id] ? <span className="rounded-full bg-bad px-1.5 text-[0.72rem] text-white">{badge[t.id]}</span> : null}
          </Link>
        ))}
      </nav>
      <div className="float mt-6 overflow-hidden">
        {tab === "errors" && <Errors back={back} />}
        {tab === "messages" && <Messages back={back} />}
        {tab === "feedback" && <Feedback back={back} />}
        {tab === "watch" && <Watch back={back} />}
        {tab === "calculators" && <Calculators />}
      </div>
    </div>
  );
}

async function Errors({ back }: { back: string }) {
  const rows = await db.select().from(errorGroups).orderBy(desc(errorGroups.lastSeen)).limit(100);
  return (
    <div>
      <div className="flex justify-end p-4">
        <Action action="resolve-all" back={back} label="Resolve all" />
      </div>
      <ul className="divide-y divide-line">
        {rows.length === 0 && <li className="p-6 text-ink-3">No errors recorded.</li>}
        {rows.map((e) => (
          <li key={e.id} className="p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[0.95rem] font-[620] text-ink">
                  {e.name}: <span className="font-normal">{e.message.slice(0, 200)}</span>
                </div>
                <div className="mt-1 text-[0.8rem] text-ink-3">
                  {e.source} · {e.severity} · {e.route ?? "-"} · ×{e.count} · last {when(e.lastSeen)} · {e.resolvedAt ? `resolved ${when(e.resolvedAt)}` : "OPEN"}
                </div>
                {e.firstFrame && <code className="mt-1 block truncate text-[0.76rem] text-ink-4">{e.firstFrame}</code>}
              </div>
              {!e.resolvedAt && <Action action="resolve" id={e.id} back={back} label="Resolve" />}
            </div>
            {e.stack && (
              <details className="mt-2">
                <summary className="text-[0.8rem] text-ink-3">Stack</summary>
                <pre className="mt-2 overflow-x-auto rounded-xl bg-card-2 p-3 text-[0.74rem] leading-relaxed text-ink-2">{e.stack}</pre>
              </details>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

async function Messages({ back }: { back: string }) {
  const rows = await db.select().from(contactMessages).orderBy(desc(contactMessages.createdAt)).limit(100);
  return (
    <ul className="divide-y divide-line">
      {rows.length === 0 && <li className="p-6 text-ink-3">No messages yet.</li>}
      {rows.map((m) => (
        <li key={m.id} className="p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[0.95rem] font-[620] text-ink">
                {m.name || "(no name)"} &lt;{m.email}&gt; · <span className="font-normal text-ink-3">{m.topic}</span>
              </div>
              <div className="mt-1 text-[0.8rem] text-ink-3">
                {when(m.createdAt)} · {m.status} · notified {m.notified ? "yes" : "no"} {m.page ? `· from ${m.page}` : ""}
              </div>
              <p className="mt-2 whitespace-pre-wrap text-[0.92rem] text-ink-2">{m.message}</p>
            </div>
            {m.status === "new" && <Action action="message-done" id={m.id} back={back} label="Mark replied" />}
          </div>
        </li>
      ))}
    </ul>
  );
}

async function Feedback({ back }: { back: string }) {
  const rows = await db.select().from(feedback).orderBy(desc(feedback.createdAt)).limit(200);
  const summary = new Map<string, { up: number; down: number }>();
  for (const r of rows) {
    const s = summary.get(r.calculator) ?? { up: 0, down: 0 };
    if (r.helpful) s.up++;
    else s.down++;
    summary.set(r.calculator, s);
  }
  return (
    <div>
      <div className="flex flex-wrap gap-2 p-5">
        {[...summary.entries()].map(([k, v]) => (
          <span key={k} className="chip">
            {k}: 👍 {v.up} · 👎 {v.down}
          </span>
        ))}
      </div>
      <ul className="divide-y divide-line">
        {rows
          .filter((r) => !r.helpful)
          .map((r) => (
            <li key={r.id} className="p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[0.92rem] font-[620] text-ink">
                    {r.calculator} {r.market ? `(${r.market})` : ""} · <span className="font-normal text-ink-3">{when(r.createdAt)} · {r.status}</span>
                  </div>
                  {r.note && <p className="mt-1.5 whitespace-pre-wrap text-[0.92rem] text-ink-2">{r.note}</p>}
                  {r.inputs && <code className="mt-1.5 block truncate text-[0.76rem] text-ink-4">{JSON.stringify(r.inputs)}</code>}
                </div>
                {r.status === "new" && <Action action="feedback-done" id={r.id} back={back} label="Reviewed" />}
              </div>
            </li>
          ))}
      </ul>
    </div>
  );
}

async function Watch({ back }: { back: string }) {
  const rows = await db.select().from(feeWatch).orderBy(feeWatch.calculator, feeWatch.url);
  return (
    <div className="scroll-x">
      <table className="data-table min-w-[760px]">
        <thead>
          <tr>
            <th>Calculator</th>
            <th>Page</th>
            <th>Status</th>
            <th>Checked</th>
            <th>Changed</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={6} className="text-ink-3">
                The watcher has not run yet.
              </td>
            </tr>
          )}
          {rows.map((r) => (
            <tr key={r.url}>
              <td>{r.calculator}</td>
              <td className="max-w-[320px] truncate">
                <a href={r.url} className="link" target="_blank" rel="noopener noreferrer">
                  {r.url.replace(/^https?:\/\//, "")}
                </a>
              </td>
              <td className={r.status === "changed" ? "text-bad" : r.status === "unreachable" ? "text-warn" : ""}>
                {r.status} {r.httpStatus ? `(${r.httpStatus})` : ""}
              </td>
              <td className="tnum">{when(r.checkedAt)}</td>
              <td className="tnum">{when(r.changedAt)}</td>
              <td>{r.status === "changed" && <Action action="watch-reviewed" id={r.url} back={back} label="Reviewed" />}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Calculators() {
  return (
    <div className="scroll-x">
      <table className="data-table min-w-[640px]">
        <thead>
          <tr>
            <th>Calculator</th>
            <th>Verified</th>
            <th className="num">Sources</th>
            <th className="num">Changes logged</th>
          </tr>
        </thead>
        <tbody>
          {ALL.map((d) => (
            <tr key={d.slug}>
              <td>
                <Link href={d.path} className="link">
                  {d.name}
                </Link>
              </td>
              <td className="tnum">{d.verifiedAt}</td>
              <td className="num">{d.sources.length}</td>
              <td className="num">{d.changes.length}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
