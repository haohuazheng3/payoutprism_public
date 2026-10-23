/*
 * Client-side error capture: runs before hydration, reports uncaught errors and
 * unhandled rejections to the self-hosted error inbox (/api/errors). Our own bundle
 * errors are severity "error"; noise from extensions or third-party scripts is "warn"
 * so it is recorded without paging anyone.
 */

const sent = new Set<string>();
let budget = 6;

const IGNORE = [/ResizeObserver loop/i, /^Script error\.?$/i, /Non-Error promise rejection captured/i];

function report(payload: { name: string; message: string; stack?: string; source: string }) {
  try {
    if (budget <= 0) return;
    if (IGNORE.some((re) => re.test(payload.message))) return;
    const key = `${payload.name}:${payload.message}`.slice(0, 200);
    if (sent.has(key)) return;
    sent.add(key);
    budget--;
    const ours = (payload.stack ?? "").includes(`${location.origin}/_next/`) || (payload.stack ?? "").includes("/_next/static/");
    const fromExtension = /(chrome|moz|safari)-extension:\/\//.test(payload.stack ?? "");
    const body = JSON.stringify({
      ...payload,
      route: location.pathname,
      severity: ours && !fromExtension ? "error" : "warn",
      userAgent: navigator.userAgent,
    });
    const blob = new Blob([body], { type: "application/json" });
    if (!navigator.sendBeacon?.("/api/errors", blob)) {
      fetch("/api/errors", { method: "POST", body, headers: { "Content-Type": "application/json" }, keepalive: true }).catch(() => {});
    }
  } catch {
    /* never let the reporter throw */
  }
}

try {
  window.addEventListener("error", (event) => {
    const err = event.error as Error | undefined;
    report({
      name: err?.name ?? "Error",
      message: err?.message ?? event.message ?? "Unknown error",
      stack: err?.stack ?? (event.filename ? `at ${event.filename}:${event.lineno}:${event.colno}` : undefined),
      source: "window.onerror",
    });
  });
  window.addEventListener("unhandledrejection", (event) => {
    const r = event.reason as Error | string | undefined;
    report({
      name: typeof r === "object" && r ? (r.name ?? "UnhandledRejection") : "UnhandledRejection",
      message: typeof r === "object" && r ? (r.message ?? String(r)) : String(r),
      stack: typeof r === "object" && r ? r.stack : undefined,
      source: "unhandledrejection",
    });
  });
} catch {
  /* instrumentation must never break the page */
}

/** For client components that catch their own errors (upload, polling) and still want them in the inbox. */
export function reportClientError(err: unknown, source: string) {
  const e = err as Error;
  report({ name: e?.name ?? "Error", message: e?.message ?? String(err), stack: e?.stack, source });
}
