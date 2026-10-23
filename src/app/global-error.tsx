"use client";

import { useEffect } from "react";

/** Last-resort boundary: replaces the root layout, so it carries its own minimal styles. */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    try {
      const body = JSON.stringify({ name: error.name, message: error.message, stack: error.stack, source: "global-error", route: location.pathname, severity: "error" });
      if (!navigator.sendBeacon?.("/api/errors", new Blob([body], { type: "application/json" }))) {
        fetch("/api/errors", { method: "POST", body, headers: { "Content-Type": "application/json" }, keepalive: true }).catch((e: unknown) => console.warn("[errors] report failed", e));
      }
    } catch (e) {
      console.warn("[errors] report failed", e);
    }
  }, [error]);
  return (
    <html lang="en">
      <body style={{ margin: 0, background: "#F2F3F0", color: "#0F1412", fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif", minHeight: "100vh", display: "grid", placeItems: "center", padding: 16 }}>
        <div style={{ maxWidth: 440, textAlign: "center", background: "#FFFFFF", borderRadius: 28, padding: "40px 28px", boxShadow: "0 0 0 1px rgba(15,20,18,.07), 0 30px 60px -32px rgba(15,20,18,.25)" }}>
          <h1 style={{ fontSize: 28, margin: "0 0 8px", fontFamily: "Georgia, serif", fontWeight: 500 }}>Something went wrong.</h1>
          <p style={{ color: "#3A423E", lineHeight: 1.6, margin: 0 }}>The error has been logged. Please try again.</p>
          <button type="button" onClick={() => reset()} style={{ marginTop: 24, minHeight: 44, padding: "0 20px", borderRadius: 999, border: 0, background: "#0F1412", color: "#fff", fontSize: 15, cursor: "pointer" }}>
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
