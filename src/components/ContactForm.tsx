"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CONTACT_TOPICS } from "@/content/contact";
import { SITE } from "@/lib/site";
import { track } from "@/lib/analytics";

type State = { status: "idle" } | { status: "sending" } | { status: "sent"; email: string } | { status: "error"; message: string };

/** Posts to /api/contact (stored, then emailed to the owner). Instant "sending" state on press. */
export function ContactForm() {
  const [state, setState] = useState<State>({ status: "idle" });
  const [topic, setTopic] = useState<string>("wrong-fee");
  // ?topic=new-calculator from links elsewhere preselects the topic (after hydration, never during).
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("topic");
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the URL can only be read after hydration
    if (t && CONTACT_TOPICS.some((x) => x.value === t)) setTopic(t);
  }, []);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (state.status === "sending") return;
    const form = e.currentTarget;
    const data = Object.fromEntries(new FormData(form).entries()) as Record<string, string>;
    setState({ status: "sending" });
    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...data, page: document.referrer ? new URL(document.referrer).pathname : undefined }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setState({ status: "error", message: body.error ?? (res.status === 429 ? "That’s a lot of messages in a row. Please wait a few minutes." : "Something went wrong. Please try again.") });
        return;
      }
      track("contact_submit", { topic: data.topic });
      setState({ status: "sent", email: data.email });
      form.reset();
    } catch {
      setState({ status: "error", message: `We couldn’t reach the server. Check your connection, or email ${SITE.email}.` });
    }
  }

  if (state.status === "sent") {
    return (
      <div className="float animate-rise p-7 sm:p-9" role="status">
        <p className="eyebrow !text-keep-text">Message received</p>
        <p className="display mt-3 text-[1.9rem] text-ink">Thanks, it’s in our inbox.</p>
        <p className="mt-2 text-[1rem] leading-relaxed text-ink-3">
          We’ll reply to <strong className="text-ink">{state.email}</strong>. {SITE.replyTime}
        </p>
        <button type="button" className="btn btn-ghost btn-sm mt-6" onClick={() => setState({ status: "idle" })}>
          Send another message
        </button>
      </div>
    );
  }

  const sending = state.status === "sending";
  return (
    <form onSubmit={onSubmit} className="float relative p-6 sm:p-9">
      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label htmlFor="c-name" className="mb-1.5 block text-[0.86rem] font-[560] text-ink-2">
            Name <span className="font-normal text-ink-4">(optional)</span>
          </label>
          <div className="field">
            <input id="c-name" name="name" autoComplete="name" maxLength={120} placeholder="Your name or shop" className="!text-[1rem] !font-normal" />
          </div>
        </div>
        <div>
          <label htmlFor="c-email" className="mb-1.5 block text-[0.86rem] font-[560] text-ink-2">
            Email
          </label>
          <div className="field">
            <input id="c-email" name="email" type="email" required autoComplete="email" maxLength={254} placeholder="you@example.com" className="!text-[1rem] !font-normal" />
          </div>
        </div>
      </div>
      <div className="mt-5">
        <label htmlFor="c-topic" className="mb-1.5 block text-[0.86rem] font-[560] text-ink-2">
          Topic
        </label>
        <div className="field">
          <select id="c-topic" name="topic" value={topic} onChange={(e) => setTopic(e.target.value)} className="cursor-pointer !text-[1rem] !font-normal">
            {CONTACT_TOPICS.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="mt-5">
        <label htmlFor="c-message" className="mb-1.5 block text-[0.86rem] font-[560] text-ink-2">
          Message
        </label>
        <textarea
          id="c-message"
          name="message"
          required
          minLength={10}
          maxLength={5000}
          rows={6}
          placeholder={topic === "wrong-fee" ? "Which calculator, which fee, and what your statement shows. A link to the platform's announcement helps us confirm it fast." : "How can we help?"}
          className="w-full resize-y rounded-[16px] bg-card-2 p-4 text-[1rem] text-ink outline-none ring-1 ring-line focus:bg-card focus:ring-2 focus:ring-focus"
        />
      </div>
      <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label htmlFor="c-website">Website</label>
        <input id="c-website" name="website" tabIndex={-1} autoComplete="off" />
      </div>
      {state.status === "error" && (
        <p role="alert" className="mt-5 rounded-[14px] bg-bad-soft px-4 py-3 text-[0.95rem] text-bad">
          {state.message}
        </p>
      )}
      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-[0.84rem] leading-snug text-ink-4">
          Stored and handled as described in our{" "}
          <Link href="/privacy" className="underline underline-offset-4 hover:text-ink-2">
            privacy policy
          </Link>
          .
        </p>
        <button type="submit" className="btn btn-ink shrink-0" disabled={sending}>
          {sending ? "Sending…" : "Send message"}
        </button>
      </div>
    </form>
  );
}
