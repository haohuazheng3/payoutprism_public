/*
 * FlowGlance is the only analytics on this site. The snippet loads after consent (see
 * src/components/Consent.tsx); `track()` queues business events until it is ready and is a
 * silent no-op when analytics are off.
 */

declare global {
  interface Window {
    fw?: (...args: unknown[]) => void;
    __fwLoaded?: boolean;
  }
}

export const ANALYTICS_LOADED_EVENT = "pp:analytics-loaded";

export function loadFlowGlance(): void {
  const key = process.env.NEXT_PUBLIC_FLOWGLANCE_KEY;
  if (!key || typeof document === "undefined" || window.__fwLoaded) return;
  window.__fwLoaded = true;
  const s = document.createElement("script");
  s.defer = true;
  s.src = "https://flowglance.com/fw.js";
  s.setAttribute("data-site", key);
  s.onload = () => window.dispatchEvent(new Event(ANALYTICS_LOADED_EVENT));
  document.head.appendChild(s);
}

function whenReady(send: () => void) {
  if (typeof window === "undefined") return;
  if (window.fw) return send();
  if (!window.__fwLoaded) return;
  window.addEventListener(ANALYTICS_LOADED_EVENT, send, { once: true });
}

export function track(name: string, props?: Record<string, unknown>): void {
  whenReady(() => {
    try {
      window.fw?.("event", name, props ?? {});
    } catch (e) {
      console.warn("[analytics] event failed", name, e);
    }
  });
}

/** Marks a visitor (used for the owner's own sessions so they can be excluded from reports). */
export function identify(userRef: string, email: string): void {
  whenReady(() => {
    try {
      window.fw?.("identify", { userRef, email });
    } catch (e) {
      console.warn("[analytics] identify failed", e);
    }
  });
}
