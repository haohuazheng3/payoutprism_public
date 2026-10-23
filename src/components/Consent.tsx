"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { loadFlowGlance } from "@/lib/analytics";

const COOKIE = "pp_consent";
const OPEN_EVENT = "pp:open-consent";

type Consent = "all" | "essential";
type Mode = "hidden" | "optin" | "notice";

function readConsent(): Consent | null {
  if (typeof document === "undefined") return null;
  const m = document.cookie.match(/(?:^|;\s*)pp_consent=([^;]+)/);
  if (!m) return null;
  return m[1] === "essential" ? "essential" : "all";
}

function writeConsent(v: Consent) {
  const secure = location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${COOKIE}=${v}; Path=/; Max-Age=${60 * 60 * 24 * 180}; SameSite=Lax${secure}`;
}

/**
 * Region-aware consent. Visitors in the EU/EEA, UK and Switzerland (or anywhere we can't place)
 * opt in before FlowGlance loads. Elsewhere it loads by default with a clear notice and a
 * one-tap opt-out. The choice is remembered for 180 days and can be changed from the footer.
 */
export function ConsentManager() {
  const [mode, setMode] = useState<Mode>("hidden");

  useEffect(() => {
    const existing = readConsent();
    if (existing === "all") {
      loadFlowGlance();
      return;
    }
    if (existing === "essential") return;
    let cancelled = false;
    fetch("/api/geo", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { consentRequired: true }))
      .catch(() => ({ consentRequired: true }))
      .then((g: { consentRequired?: boolean }) => {
        if (cancelled) return;
        if (g.consentRequired === false) {
          loadFlowGlance();
          setMode("notice");
        } else setMode("optin");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const open = () => setMode(window.__ppAnalytics ? "notice" : "optin");
    window.addEventListener(OPEN_EVENT, open);
    return () => window.removeEventListener(OPEN_EVENT, open);
  }, []);

  const accept = useCallback(() => {
    writeConsent("all");
    loadFlowGlance();
    setMode("hidden");
  }, []);

  const essentialOnly = useCallback(() => {
    writeConsent("essential");
    setMode("hidden");
  }, []);

  if (mode === "hidden") return null;

  return (
    <div className="fixed inset-x-2 bottom-2 z-[60] sm:inset-x-auto sm:bottom-5 sm:right-5 sm:w-[400px]" role="region" aria-label="Cookie choices">
      <div className="float animate-rise p-4 sm:p-5">
        <p className="text-[0.95rem] font-[640] text-ink sm:text-[1rem]">{mode === "optin" ? "May we count your visit?" : "About analytics on this site"}</p>
        <p className="mt-1.5 text-[0.84rem] leading-snug text-ink-3 sm:mt-2 sm:text-[0.88rem] sm:leading-relaxed">
          FlowGlance, our only analytics, records page activity, including what you type into forms.{" "}
          {mode === "optin" ? "Nothing loads unless you agree." : "You can opt out any time."}{" "}
          <Link href="/cookie-policy" className="underline underline-offset-4 hover:text-ink">
            Details
          </Link>
        </p>
        <div className="mt-3 flex gap-2 sm:mt-4">
          <button type="button" className="btn btn-ink btn-sm flex-1" onClick={accept}>
            {mode === "optin" ? "Allow analytics" : "OK"}
          </button>
          <button type="button" className="btn btn-ghost btn-sm flex-1" onClick={essentialOnly}>
            {mode === "optin" ? "No thanks" : "Opt out"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function CookieSettingsLink() {
  return (
    <button type="button" onClick={() => window.dispatchEvent(new Event(OPEN_EVENT))} className="text-left text-[0.9rem] text-ink-3 hover:text-ink">
      Cookie settings
    </button>
  );
}
