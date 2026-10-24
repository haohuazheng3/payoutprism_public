/*
 * Shared building blocks for the smaller calculators (files starting with "_" are not
 * calculators and are skipped by scripts/gen-registry.mjs).
 */
import { M } from "../markets";
import { assemble, clamp, formatRate, moneyFor, num, pct, str, toCents } from "../money";
import type { CalculatorCategory, CalculatorDef, FieldDef, Inputs, Line, Market, ScheduleRow, Source } from "../types";

export const CHECKED = "2026-10-24";

export function src(id: string, title: string, url: string, publisher: string, checked = CHECKED): Source {
  return { id, title, url, publisher, checked };
}

/** Standard optional cost fields, so any calculator can show profit. */
export const COSTS: FieldDef[] = [
  { id: "itemCost", kind: "money", label: "What it cost you", section: "costs" },
  { id: "otherCost", kind: "money", label: "Other costs", section: "costs" },
];

export function costs(inputs: Inputs): Line[] {
  const out: Line[] = [];
  const a = toCents(num(inputs, "itemCost"));
  const b = toCents(num(inputs, "otherCost"));
  if (a) out.push({ id: "itemCost", label: "What it cost you", amount: a, kind: "cost" });
  if (b) out.push({ id: "otherCost", label: "Other costs", amount: b, kind: "cost" });
  return out;
}

/** A percentage fee with an optional minimum and maximum, in cents. */
export function capped(base: number, rate: number, min?: number, max?: number) {
  return Math.min(base, clamp(pct(base, rate), min, max));
}

/** Where a percentage fee with a floor/cap stops being flat (dollars), for the reverse solver. */
export function capPoints(rate: number, min?: number, max?: number): number[] {
  const out: number[] = [];
  if (min) out.push(min / rate);
  if (max) out.push(max / rate);
  return out.map((x) => Math.round(x * 100) / 100);
}

export interface InstantTier {
  id: string;
  label: string;
  rate: number;
  /** Cents. */
  min?: number;
  max?: number;
  /** Plain-English rule, e.g. "1.75%, at least $0.25 and at most $25". */
  rule: string;
  source: string;
}

/**
 * "Move my balance to my bank": a free standard transfer or a percentage instant transfer with a
 * floor and a cap, deducted from the amount moved. Venmo, PayPal, Cash App and Apple Cash all
 * work this way; only the numbers and the wording differ.
 */
export function instantTransfer(o: {
  slug: string;
  name: string;
  path: string;
  brand: string;
  blurb: string;
  tiers: InstantTier[];
  tierLabel?: string;
  standard: string;
  standardSource: string;
  instantWhere: string;
  limits?: string;
  limitsSource?: string;
  defaultAmount: number;
  sources: Source[];
  extraNotes?: (amount: number, fee: number, tier: InstantTier, market: Market) => string[];
  category?: CalculatorCategory;
  /** Let the person type the rate their app shows (Cash App's varies). */
  customRate?: { min: number; max: number; minFee: [number, number] };
}): CalculatorDef {
  const tierOf = (inputs: Inputs) => o.tiers.find((t) => t.id === str(inputs, "tier", o.tiers[0].id)) ?? o.tiers[0];
  const rateOf = (inputs: Inputs, t: InstantTier) => {
    if (!o.customRate) return { rate: t.rate, min: t.min, max: t.max };
    const rate = Math.min(o.customRate.max, Math.max(o.customRate.min, num(inputs, "instantRate", t.rate)));
    const min = Math.round(Math.min(o.customRate.minFee[1], Math.max(o.customRate.minFee[0], num(inputs, "instantMin", (t.min ?? 0) / 100))) * 100);
    return { rate, min, max: t.max };
  };
  const fields: FieldDef[] = [
    { id: "amount", kind: "money", label: "Amount to transfer", section: "sale", help: `What you’re moving out of ${o.brand}. The fee comes out of this amount.` },
    {
      id: "speed",
      kind: "segmented",
      label: "How fast?",
      section: "sale",
      options: [
        { value: "instant", label: "Instant" },
        { value: "standard", label: "Standard · free" },
      ],
      help: `${o.instantWhere} Standard transfers are free.`,
    },
  ];
  if (o.tiers.length > 1) {
    fields.push({ id: "tier", kind: "segmented", label: o.tierLabel ?? "Account", section: "sale", options: o.tiers.map((t) => ({ value: t.id, label: t.label })), showIf: (i) => str(i, "speed", "instant") === "instant" });
  }
  if (o.customRate) {
    fields.push(
      { id: "instantRate", kind: "percent", label: "Instant rate your app shows", section: "options", min: o.customRate.min, max: o.customRate.max, step: 0.05, help: `${o.brand} shows the exact rate before you confirm; it ranges from ${o.customRate.min}% to ${o.customRate.max}%.`, showIf: (i) => str(i, "speed", "instant") === "instant" },
      { id: "instantMin", kind: "money", label: "Minimum fee your app shows", section: "options", advanced: true, help: `Between $${o.customRate.minFee[0].toFixed(2)} and $${o.customRate.minFee[1].toFixed(2)}.`, showIf: (i) => str(i, "speed", "instant") === "instant" },
    );
  }

  function calculate(inputs: Inputs, market: Market) {
    const money = moneyFor(market);
    const amount = toCents(num(inputs, "amount"));
    const instant = str(inputs, "speed", "instant") === "instant";
    const t = tierOf(inputs);
    const { rate, min, max } = rateOf(inputs, t);
    const fee = instant && amount > 0 ? capped(amount, rate, min, max) : 0;
    const raw = pct(amount, rate);
    const fees: Line[] = [
      instant
        ? {
            id: "instant",
            label: `Instant transfer fee (${formatRate(rate)})`,
            amount: fee,
            kind: "payment",
            detail: raw !== fee ? `${formatRate(rate)} × ${money(amount)} = ${money(raw)} → ${fee === min ? `minimum ${money(min ?? 0)}` : `capped at ${money(max ?? 0)}`}` : `${formatRate(rate)} × ${money(amount)}`,
            explain: `${o.brand} charges ${o.customRate ? `the rate shown in your app (here ${formatRate(rate)}, minimum ${money(min ?? 0)}${max ? `, maximum ${money(max)}` : ""})` : t.rule} for an instant transfer, taken from the amount you move.`,
            source: t.source,
          }
        : { id: "standard", label: "Standard transfer", amount: 0, kind: "payment", detail: "free", explain: o.standard, source: o.standardSource },
    ];
    const notes: string[] = [];
    if (instant && amount > 0) {
      notes.push(`A standard transfer would land the full ${money(amount)}, so speed costs you ${money(fee)} here (${formatRate(Math.round((fee / amount) * 10000) / 100)} of the amount).`);
      if (max && fee === max) notes.push(`You’ve hit the ${money(max)} cap: every dollar above ${money(Math.round((max / rate) * 100))} moves for free, so one big instant transfer beats several small ones.`);
      else if (min && fee === min) notes.push(`Below ${money(Math.round((min / rate) * 100))} you pay the ${money(min)} minimum, so small instant transfers cost proportionally more.`);
      notes.push(...(o.extraNotes?.(amount, fee, t, market) ?? []));
    }
    if (o.limits) notes.push(o.limits);
    return assemble({ market, buyerPays: amount, saleAmount: amount, fees, notes: notes.slice(0, 3) });
  }

  function schedule(): ScheduleRow[] {
    return [
      { fee: "Standard transfer", amount: "Free", appliesTo: "Amount moved", when: o.standard, source: o.standardSource },
      ...o.tiers.map((t) => ({ fee: o.tiers.length > 1 ? `Instant transfer · ${t.label}` : "Instant transfer", amount: t.rule, appliesTo: "Amount moved, deducted from it", when: o.instantWhere, source: t.source })),
      ...(o.limits && o.limitsSource ? [{ fee: "Limits", amount: "—", appliesTo: "Each transfer", when: o.limits, source: o.limitsSource }] : []),
    ];
  }

  const t0 = o.tiers[0];
  return {
    slug: o.slug,
    name: o.name,
    path: o.path,
    category: o.category ?? "payments",
    priceNoun: "amount to transfer",
    sellerNoun: "account holder",
    saleNoun: "transfer",
    buyerNoun: "you",
    reverseHead: "Transfer this much",
    keepHead: "Lands in your account",
    modes: ["What lands", "What to transfer"],
    receiveLabel: "Lands in your account",
    blurb: o.blurb,
    markets: [M.us],
    defaultMarket: "us",
    priceField: "amount",
    fields,
    defaults: () => ({ amount: o.defaultAmount, speed: "instant", tier: t0.id, ...(o.customRate ? { instantRate: t0.rate, instantMin: (t0.min ?? 0) / 100 } : {}) }),
    calculate,
    breakpoints: (inputs) => {
      const t = tierOf(inputs);
      const r = rateOf(inputs, t);
      return capPoints(r.rate, r.min, r.max);
    },
    verifiedAt: CHECKED,
    sources: o.sources,
    changes: [],
    schedule,
  };
}
