"use client";

import { useState } from "react";
import type { Inputs } from "@/fees/types";
import { track } from "@/lib/analytics";

/**
 * "Does this match your statement?" The fastest way we learn that a platform changed a fee.
 * Thumbs up is one tap; thumbs down asks what looks wrong. The answer is saved instantly
 * (optimistic) and sent in the background.
 */
export function Feedback({ calculator, market, inputs }: { calculator: string; market: string; inputs: Inputs }) {
  const [state, setState] = useState<"idle" | "up" | "down" | "sent" | "error">("idle");
  const [note, setNote] = useState("");

  const send = async (helpful: boolean, text?: string) => {
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ calculator, market, helpful, note: text ?? "", inputs }),
        keepalive: true,
      });
      if (!res.ok) throw new Error(String(res.status));
      return true;
    } catch {
      return false;
    }
  };

  return (
    <div className="mt-5 px-2 text-[0.88rem] text-ink-3">
      {state === "idle" && (
        <div className="flex flex-wrap items-center gap-2">
          <span>Does this match your statement?</span>
          <button
            type="button"
            className="chip"
            onClick={() => {
              setState("up");
              track("feedback", { calculator, helpful: true });
              void send(true);
            }}
          >
            Yes
          </button>
          <button
            type="button"
            className="chip"
            onClick={() => {
              setState("down");
              track("feedback", { calculator, helpful: false });
            }}
          >
            Something’s off
          </button>
        </div>
      )}
      {state === "up" && <p className="animate-fade">Thanks. That tells us the rates are still right.</p>}
      {state === "down" && (
        <form
          className="float animate-rise p-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setState("sent");
            const ok = await send(false, note.trim());
            if (!ok) setState("error");
          }}
        >
          <label htmlFor={`fb-${calculator}`} className="block text-[0.9rem] font-[560] text-ink">
            What looks wrong?
          </label>
          <textarea
            id={`fb-${calculator}`}
            value={note}
            onChange={(e) => setNote(e.target.value.slice(0, 1000))}
            rows={3}
            placeholder="e.g. my statement shows a different processing fee, or a fee is missing"
            className="mt-2 w-full resize-none rounded-[14px] bg-card-2 p-3 text-[0.95rem] text-ink outline-none ring-1 ring-line focus:ring-2 focus:ring-focus"
          />
          <div className="mt-2 flex gap-2">
            <button type="submit" className="btn btn-ink btn-sm">
              Send
            </button>
            <button type="button" className="btn btn-quiet btn-sm" onClick={() => setState("idle")}>
              Cancel
            </button>
          </div>
        </form>
      )}
      {state === "sent" && <p className="animate-fade">Got it. We re-check the official page and fix the calculator if a fee changed.</p>}
      {state === "error" && <p className="animate-fade text-bad">That didn’t send. Please try again, or use the contact page.</p>}
    </div>
  );
}
