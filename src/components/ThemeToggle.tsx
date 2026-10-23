"use client";

import { useSyncExternalStore } from "react";

type Choice = "system" | "light" | "dark";
const KEY = "pp-theme";
const EVENT = "pp:theme";

function apply(choice: Choice) {
  const root = document.documentElement;
  if (choice === "system") delete root.dataset.theme;
  else root.dataset.theme = choice;
}

/** Inline, pre-paint: restores an explicit theme choice before the first frame (no flash). */
export const THEME_SCRIPT = `try{var t=localStorage.getItem('${KEY}');if(t==='light'||t==='dark'){document.documentElement.dataset.theme=t}}catch(e){}`;

function subscribe(cb: () => void) {
  window.addEventListener("storage", cb);
  window.addEventListener(EVENT, cb);
  return () => {
    window.removeEventListener("storage", cb);
    window.removeEventListener(EVENT, cb);
  };
}

function readChoice(): Choice {
  try {
    const t = localStorage.getItem(KEY);
    return t === "light" || t === "dark" ? t : "system";
  } catch {
    return "system"; // storage unavailable (private mode): the system theme applies
  }
}

export function ThemeToggle() {
  const choice = useSyncExternalStore(subscribe, readChoice, () => "system" as Choice);

  const select = (c: Choice) => {
    apply(c);
    try {
      if (c === "system") localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, c);
    } catch {
      /* the choice still applies for this page view */
    }
    window.dispatchEvent(new Event(EVENT));
  };

  const options: { id: Choice; label: string }[] = [
    { id: "system", label: "Auto" },
    { id: "light", label: "Light" },
    { id: "dark", label: "Dark" },
  ];

  return (
    <div role="radiogroup" aria-label="Color theme" className="inline-flex rounded-full bg-card-2 p-1 shadow-[inset_0_0_0_1px_var(--line)]">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={choice === o.id}
          onClick={() => select(o.id)}
          className={`min-h-[36px] rounded-full px-3.5 text-[0.85rem] font-medium transition-colors active:scale-95 ${
            choice === o.id ? "bg-card text-ink shadow-[0_0_0_1px_var(--line-2)]" : "text-ink-3 hover:text-ink"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
