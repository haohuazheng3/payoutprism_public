"use client";

import { useId, useState } from "react";
import type { FieldDef, Inputs, InputValue, Market, SelectOption } from "@/fees/types";
import { currencySymbol, fieldOptions, parseAmount, tidyMoney } from "./util";
import { Combobox } from "./Combobox";

interface FieldProps {
  field: FieldDef;
  value: InputValue | undefined;
  inputs: Inputs;
  market: Market;
  onChange: (id: string, value: InputValue) => void;
  /** Visually larger: the primary amount of the calculator. */
  hero?: boolean;
}

export function Field({ field, value, inputs, market, onChange, hero }: FieldProps) {
  const id = useId();
  const helpId = field.help ? `${id}-help` : undefined;
  const label = (
    <label htmlFor={id} className="mb-1.5 block text-[0.86rem] font-[560] text-ink-2">
      {field.label}
    </label>
  );

  if (field.kind === "toggle") {
    const on = value === true;
    return (
      <div className="flex items-start justify-between gap-4 py-1">
        <div className="min-w-0">
          <span id={`${id}-l`} className="block text-[0.94rem] font-[560] text-ink">
            {field.label}
          </span>
          {field.help && (
            <span id={helpId} className="mt-0.5 block text-[0.84rem] leading-snug text-ink-3">
              {field.help}
            </span>
          )}
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-labelledby={`${id}-l`}
          aria-describedby={helpId}
          className="switch mt-0.5"
          onClick={() => onChange(field.id, !on)}
        />
      </div>
    );
  }

  if (field.kind === "segmented") {
    const opts = fieldOptions(field, inputs, market);
    return (
      <div>
        <span id={`${id}-l`} className="mb-1.5 block text-[0.86rem] font-[560] text-ink-2">
          {field.label}
        </span>
        <div className="segmented" role="group" aria-labelledby={`${id}-l`} aria-describedby={helpId}>
          {opts.map((o) => (
            <button key={o.value} type="button" aria-pressed={value === o.value} onClick={() => onChange(field.id, o.value)}>
              {o.label}
            </button>
          ))}
        </div>
        {field.help && (
          <p id={helpId} className="mt-1.5 text-[0.82rem] leading-snug text-ink-3">
            {field.help}
          </p>
        )}
      </div>
    );
  }

  if (field.kind === "select") {
    const opts = fieldOptions(field, inputs, market);
    return (
      <div>
        {label}
        {field.searchable || opts.length > 12 ? (
          <Combobox id={id} options={opts} value={String(value ?? "")} onChange={(v) => onChange(field.id, v)} describedBy={helpId} label={field.label} />
        ) : (
          <NativeSelect id={id} options={opts} value={String(value ?? "")} onChange={(v) => onChange(field.id, v)} describedBy={helpId} />
        )}
        {field.help && (
          <p id={helpId} className="mt-1.5 text-[0.82rem] leading-snug text-ink-3">
            {field.help}
          </p>
        )}
      </div>
    );
  }

  const prefix = field.kind === "money" ? currencySymbol(market) : undefined;
  const suffix = field.kind === "percent" ? "%" : field.kind === "number" ? field.unit : undefined;
  return (
    <div>
      {label}
      <NumericInput
        id={id}
        value={typeof value === "number" ? value : Number(value ?? 0)}
        onChange={(n) => onChange(field.id, n)}
        prefix={prefix}
        suffix={suffix}
        money={field.kind === "money"}
        integer={field.kind === "number" && field.integer}
        min={field.min}
        max={field.max}
        describedBy={helpId}
        hero={hero}
        placeholder={field.kind === "money" ? field.placeholder ?? "0.00" : "0"}
      />
      {field.help && (
        <p id={helpId} className="mt-1.5 text-[0.82rem] leading-snug text-ink-3">
          {field.help}
        </p>
      )}
    </div>
  );
}

export function NumericInput(props: {
  id: string;
  value: number;
  onChange: (n: number) => void;
  prefix?: string;
  suffix?: string;
  money?: boolean;
  integer?: boolean;
  min?: number;
  max?: number;
  describedBy?: string;
  hero?: boolean;
  placeholder?: string;
  ariaLabel?: string;
}) {
  const { value, onChange, money, integer, min, max } = props;
  const [text, setText] = useState(() => (value ? String(value) : ""));
  const [focused, setFocused] = useState(false);
  const [seen, setSeen] = useState(value);

  // Follow outside changes (market switch, URL restore, ladder click) unless the person is typing:
  // adjust during render when the prop moved (React's "storing information from previous renders").
  if (value !== seen) {
    setSeen(value);
    if (!focused && parseAmount(text) !== value) setText(value ? (money ? tidyMoney(value) : String(value)) : "");
  }

  const commit = (raw: string) => {
    setText(raw);
    let n = parseAmount(raw) ?? 0;
    if (integer) n = Math.round(n);
    if (min !== undefined && n < min) n = min;
    if (max !== undefined && n > max) n = max;
    onChange(n);
  };

  return (
    <div className={`field ${props.hero ? "min-h-[62px]" : ""}`}>
      {props.prefix && <span className={`affix ${props.hero ? "text-[1.3rem]" : ""}`}>{props.prefix}</span>}
      <input
        id={props.id}
        type="text"
        inputMode={integer ? "numeric" : "decimal"}
        autoComplete="off"
        spellCheck={false}
        enterKeyHint="done"
        value={text}
        placeholder={props.placeholder}
        aria-describedby={props.describedBy}
        aria-label={props.ariaLabel}
        className={props.hero ? "!h-[60px] !text-[1.5rem] !font-[600] tracking-tight" : ""}
        onFocus={(e) => {
          setFocused(true);
          // Select the value so the first keystroke replaces it (thumbs, not backspaces).
          requestAnimationFrame(() => e.target.select());
        }}
        onBlur={() => {
          setFocused(false);
          const n = parseAmount(text);
          if (n === null) setText("");
          else if (money) setText(tidyMoney(n));
        }}
        onChange={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
      />
      {props.suffix && <span className="affix text-[0.92rem]">{props.suffix}</span>}
    </div>
  );
}

function NativeSelect(props: { id: string; options: SelectOption[]; value: string; onChange: (v: string) => void; describedBy?: string }) {
  const groups = new Map<string, SelectOption[]>();
  for (const o of props.options) groups.set(o.group ?? "", [...(groups.get(o.group ?? "") ?? []), o]);
  return (
    <div className="field relative pr-10">
      <select id={props.id} value={props.value} onChange={(e) => props.onChange(e.target.value)} aria-describedby={props.describedBy} className="appearance-none !font-[540] !text-[1rem] cursor-pointer">
        {[...groups.entries()].map(([g, opts]) =>
          g ? (
            <optgroup key={g} label={g}>
              {opts.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                  {o.hint ? ` — ${o.hint}` : ""}
                </option>
              ))}
            </optgroup>
          ) : (
            opts.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
                {o.hint ? ` — ${o.hint}` : ""}
              </option>
            ))
          ),
        )}
      </select>
      <svg aria-hidden className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-ink-3" width="14" height="14" viewBox="0 0 14 14">
        <path d="M3 5.5 7 9.5l4-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}
