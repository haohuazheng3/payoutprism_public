/*
 * FlowGlance is the only analytics on this site. The snippet loads after consent (see
 * src/components/Consent.tsx). Before it arrives, `window.fw` is a tiny stub that queues calls in
 * `fw.q`, which fw.js replays on start, so no early event is lost (even one fired before the
 * consent decision); when analytics never load, the queue is never sent.
 *
 * Note: fw.js uses `window.__fwLoaded` as its own "already running" guard, so our loader must
 * never set that name (doing so made fw.js exit immediately).
 */

type FwStub = ((...args: unknown[]) => void) & { q?: unknown[][] };

declare global {
  interface Window {
    fw?: FwStub;
    __ppAnalytics?: boolean;
  }
}

export function analyticsOn(): boolean {
  return typeof window !== "undefined" && Boolean(window.__ppAnalytics);
}

/** The queue fw.js replays on start. Calls made before the consent decision wait here; if analytics never load, they are simply dropped. */
function ensureQueue(): FwStub {
  if (!window.fw) {
    const stub: FwStub = (...args: unknown[]) => {
      (stub.q = stub.q ?? []).push(args);
    };
    window.fw = stub;
  }
  return window.fw;
}

export function loadFlowGlance(): void {
  const key = process.env.NEXT_PUBLIC_FLOWGLANCE_KEY;
  if (!key || typeof document === "undefined" || window.__ppAnalytics) return;
  window.__ppAnalytics = true;
  ensureQueue();
  const s = document.createElement("script");
  s.defer = true;
  s.src = "https://flowglance.com/fw.js";
  s.setAttribute("data-site", key);
  document.head.appendChild(s);
}

export function track(name: string, props?: Record<string, unknown>): void {
  if (typeof window === "undefined") return;
  try {
    ensureQueue()("event", name, props ?? {});
  } catch (e) {
    console.warn("[analytics] event failed", name, e);
  }
}

/** Marks a visitor (used for the owner's own sessions so they can be excluded from reports). */
export function identify(userRef: string, email: string): void {
  if (typeof window === "undefined") return;
  try {
    ensureQueue()("identify", { userRef, email });
  } catch (e) {
    console.warn("[analytics] identify failed", e);
  }
}
