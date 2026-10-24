/*
 * Airbnb host fees for stays (homes). Every number is from Airbnb's own pages (see `sources`), re-read
 * on the live pages on 2026-10-23. Research notes with verbatim quotes: research/fees/airbnb.md.
 *
 * How a booking is computed (what this module reproduces):
 *  - Booking subtotal = nightly rate × nights + cleaning fee + any other fees the host adds (pet,
 *    extra guest…). Airbnb's service fees are a percentage of this subtotal and exclude the guest
 *    service fee and taxes (help 1857; resource 771: "applies to your nightly price and any fees you
 *    add, like a cleaning, pet, or extra guest fee").
 *  - Single (host-only) fee: "Most hosts pay 15.5%, remaining hosts typically pay 14%-16%", and 16%
 *    for listings in Brazil and Mexico (Mexico since June 2026). Guests pay no Airbnb service fee.
 *    Every remaining host was moved to it by Sept 15 (outside the EEA) / Oct 13, 2026 (EEA + CH).
 *  - Split fee (being phased out; bookings made before a host's switch keep it, even for later
 *    stays): host 3% ("some pay more"), 4% for listings in Brazil and Mexico; the guest pays 14.1%
 *    to 16.5% of the same subtotal (up to 16.5% on cross-currency bookings). The guest fee is a
 *    buyer-side line and never reduces the payout.
 *  - VAT/GST on Airbnb's fee by the host's country (help 436), added on top of the percentage
 *    (resource 771: "$17.83 x 20% = $3.57"). Registered businesses can avoid it in most countries;
 *    Ireland, Switzerland and Mexico are charged regardless of tax status.
 *  - Co-host payouts (help 3389): not an Airbnb fee. Paid first out of the host's potential earnings
 *    (subtotal − host fee − VAT) in Airbnb's fixed order; the host receives what remains.
 *  - Italy: Airbnb withholds 21% income tax ("cedolare secca") from non-professional hosts, on the
 *    gross amount before the host fee, VAT and co-host payouts, cleaning fee included (help 3527).
 *    A tax, not a fee, so it is an opt-in line.
 *  - Fast Pay (US only): 1.5% of each payout, at most US$15, tax included (help 3326).
 *  - Occupancy and other local taxes Airbnb collects are paid by the guest and "don't change the
 *    total payout you receive" (help 1036): shown as a guest line only when a rate is entered.
 *  - Rounding: Airbnb publishes no rule. Each line is rounded to the cent, half up (pct()), which
 *    reproduces Airbnb's own example ($115 × 15.5% = $17.83, VAT $17.83 × 20% = $3.57).
 */
import { M } from "../markets";
import { assemble, bool, formatRate, moneyFor, num, pct, str, toCents } from "../money";
import { fromUsd, FX_DATE } from "../fx";
import type { CalculatorDef, FeeChange, Inputs, Line, Market, ScheduleRow, SelectOption, Source } from "../types";

const MARKETS: Market[] = [M.us, M.uk, M.ca, M.au, M.nz, M.ie, M.de, M.fr, M.it, M.es, M.nl, M.at, M.pt, M.gr, M.ch, M.mx];

/** Single fee for most hosts; "remaining hosts typically pay 14%-16%" (help 1857). */
export const SINGLE_FEE = 15.5;
/** Split fee, host part: "Most hosts pay a 3% service fee, but some pay more." */
export const SPLIT_HOST_FEE = 3;
/** Listings in Brazil and Mexico: 16% single fee, 4% split host fee (Mexico since June 2026). */
export const HIGH_SINGLE_FEE = 16;
export const HIGH_SPLIT_HOST_FEE = 4;
/** Split fee, guest part: "ranging from 14.1% to 16.5% of the booking subtotal". */
export const GUEST_FEE_MIN = 14.1;
export const GUEST_FEE_MAX = 16.5;
/** Fast Pay: "1.5% fee is deducted from each payout, with a maximum fee of $15 USD, tax included". */
const FAST_PAY_RATE = 1.5;
const FAST_PAY_CAP_USD = 1500;
/** Italy: 21% withholding on non-professional hosts' gross earnings (help 3527). */
const IT_WITHHOLDING = 21;
/** Services: 15% with a minimum of US$6; Experiences: 20% (help 1604, 1857). */
const SERVICES_RATE = 15;
const SERVICES_MIN_USD = 600;
const EXPERIENCES_RATE = 20;

interface VatRule {
  rate: number;
  name: "VAT" | "GST";
  /** Charged "regardless of your tax status" (no way to opt out with a VAT number). */
  always?: boolean;
}

/** Tax on Airbnb's service fee for hosts in each country (help 436, rates as published there). */
const VAT: Record<string, VatRule> = {
  uk: { rate: 20, name: "VAT" },
  ca: { rate: 5, name: "GST" },
  au: { rate: 10, name: "GST" },
  nz: { rate: 15, name: "GST" },
  ie: { rate: 23, name: "VAT", always: true },
  de: { rate: 19, name: "VAT" },
  fr: { rate: 20, name: "VAT" },
  it: { rate: 22, name: "VAT" },
  es: { rate: 21, name: "VAT" },
  nl: { rate: 21, name: "VAT" },
  at: { rate: 20, name: "VAT" },
  pt: { rate: 23, name: "VAT" },
  gr: { rate: 24, name: "VAT" },
  ch: { rate: 8.1, name: "VAT", always: true },
  mx: { rate: 16, name: "VAT", always: true },
};

/** Realistic default stay per market: [nightly rate, cleaning fee] in the local currency. */
const DEFAULT_STAY: Record<string, [number, number]> = {
  us: [150, 80],
  uk: [120, 60],
  ca: [180, 100],
  au: [200, 120],
  nz: [180, 100],
  ch: [180, 100],
  mx: [1800, 450],
};
const EURO_STAY: [number, number] = [130, 60];

const isHighFeeMarket = (market: Market) => market.id === "mx";

export function standardRates(market: Market) {
  return isHighFeeMarket(market) ? { single: HIGH_SINGLE_FEE, splitHost: HIGH_SPLIT_HOST_FEE } : { single: SINGLE_FEE, splitHost: SPLIT_HOST_FEE };
}

/* ---------------- co-host payouts (help 3389) ---------------- */

export type CoHostType = "cleaning" | "cleaningPlus" | "pctExcl" | "pctIncl" | "fixed";
export interface CoHostSetup {
  type: CoHostType;
  /** Percent, for "cleaningPlus", "pctExcl" and "pctIncl". */
  pct?: number;
  /** Cents, for "fixed". */
  fixed?: number;
}

/** Airbnb's sharing order: cleaning fee only → cleaning fee + % → % excl. cleaning → % incl. cleaning → fixed. */
const CO_HOST_ORDER: CoHostType[] = ["cleaning", "cleaningPlus", "pctExcl", "pctIncl", "fixed"];

/**
 * Split the host's potential earnings (cents) between co-hosts the way help article 3389 describes:
 * co-hosts are paid first in the fixed order (within one type, highest amount first), each getting at
 * most what is left; the host receives the remainder. Percentages that exclude the cleaning fee are
 * taken of the potential earnings minus the cleaning fee set on the listing, as in Airbnb's examples.
 */
export function coHostPayouts(potential: number, cleaningFee: number, coHosts: CoHostSetup[]): { coHosts: number[]; host: number } {
  const exCleaning = Math.max(0, potential - cleaningFee);
  const asked = coHosts.map((c) => {
    switch (c.type) {
      case "cleaning":
        return cleaningFee;
      case "cleaningPlus":
        return cleaningFee + pct(exCleaning, c.pct ?? 0);
      case "pctExcl":
        return pct(exCleaning, c.pct ?? 0);
      case "pctIncl":
        return pct(Math.max(0, potential), c.pct ?? 0);
      case "fixed":
        return c.fixed ?? 0;
    }
  });
  const order = coHosts.map((_, i) => i).sort((a, b) => CO_HOST_ORDER.indexOf(coHosts[a].type) - CO_HOST_ORDER.indexOf(coHosts[b].type) || asked[b] - asked[a]);
  const paid = coHosts.map(() => 0);
  let remaining = Math.max(0, potential);
  for (const i of order) {
    paid[i] = Math.max(0, Math.min(asked[i], remaining));
    remaining -= paid[i];
  }
  return { coHosts: paid, host: potential - paid.reduce((s, x) => s + x, 0) };
}

/* ---------------- sources and changes ---------------- */

const S = {
  fees: "airbnb-service-fees",
  howMuch: "airbnb-how-much",
  simplify: "airbnb-simplifying-771",
  pms: "airbnb-simplifying-746",
  wave3: "airbnb-simplifying-761",
  wave1: "airbnb-simplifying-749",
  vat: "airbnb-vat",
  payout: "airbnb-payout",
  breakdown: "airbnb-price-breakdown",
  adjust: "airbnb-price-adjustment",
  coHost: "airbnb-co-host",
  italy: "airbnb-italy-withholding",
  taxes: "airbnb-tax-collection",
  fastPay: "airbnb-fast-pay",
  paypal: "airbnb-paypal",
  experiences: "airbnb-services-experiences",
  arch2024: "airbnb-fees-2024-11",
  arch2025: "airbnb-fees-2025-10",
  arch2026: "airbnb-fees-2026-04",
} as const;

const CHECKED = "2026-10-23";

const sources: Source[] = [
  { id: S.fees, title: "Airbnb service fees", url: "https://www.airbnb.com/help/article/1857", publisher: "Airbnb Help Center", checked: CHECKED },
  { id: S.howMuch, title: "How much does Airbnb charge hosts?", url: "https://www.airbnb.com/resources/hosting-homes/a/how-much-does-airbnb-charge-hosts-288", publisher: "Airbnb Resource Center", checked: CHECKED },
  { id: S.simplify, title: "Simplifying service fees on Airbnb", url: "https://www.airbnb.com/resources/hosting-homes/a/simplifying-service-fees-on-airbnb-771", publisher: "Airbnb Resource Center", checked: CHECKED },
  { id: S.pms, title: "Simplifying Airbnb service fees", url: "https://www.airbnb.com/resources/hosting-homes/a/simplifying-airbnb-service-fees-746", publisher: "Airbnb Resource Center", checked: CHECKED },
  { id: S.wave3, title: "Simplifying service fees (Peru, South Korea, Germany, UK)", url: "https://www.airbnb.com/resources/hosting-homes/a/simplifying-service-fees-761", publisher: "Airbnb Resource Center", checked: CHECKED },
  { id: S.wave1, title: "Simplifying service fees (Bolivia, Ecuador, El Salvador, Guatemala, Panama)", url: "https://www.airbnb.com/resources/hosting-homes/a/simplifying-service-fees-749", publisher: "Airbnb Resource Center", checked: CHECKED },
  { id: S.vat, title: "Value Added Tax (VAT) and how it applies to you", url: "https://www.airbnb.com/help/article/436", publisher: "Airbnb Help Center", checked: CHECKED },
  { id: S.payout, title: "Calculating your payout", url: "https://www.airbnb.com/help/article/459", publisher: "Airbnb Help Center", checked: CHECKED },
  { id: S.breakdown, title: "Preview your price breakdown", url: "https://www.airbnb.com/help/article/3638", publisher: "Airbnb Help Center", checked: CHECKED },
  { id: S.adjust, title: "Using the Airbnb price adjustment tool", url: "https://www.airbnb.com/help/article/4095", publisher: "Airbnb Help Center", checked: CHECKED },
  { id: S.coHost, title: "How co-host payouts work", url: "https://www.airbnb.com/help/article/3389", publisher: "Airbnb Help Center", checked: CHECKED },
  { id: S.italy, title: "Italy income tax withholding overview for hosts", url: "https://www.airbnb.com/help/article/3527", publisher: "Airbnb Help Center", checked: CHECKED },
  { id: S.taxes, title: "How tax collection and remittance by Airbnb works", url: "https://www.airbnb.com/help/article/1036", publisher: "Airbnb Help Center", checked: CHECKED },
  { id: S.fastPay, title: "Payouts by Fast Pay", url: "https://www.airbnb.com/help/article/3326", publisher: "Airbnb Help Center", checked: CHECKED },
  { id: S.paypal, title: "How to use PayPal for payouts", url: "https://www.airbnb.com/help/article/365", publisher: "Airbnb Help Center", checked: CHECKED },
  { id: S.experiences, title: "Why does Airbnb charge service fees for services and experiences?", url: "https://www.airbnb.com/help/article/1604", publisher: "Airbnb Help Center", checked: CHECKED },
  {
    id: S.arch2024,
    title: "Airbnb service fees (version of November 10, 2024)",
    url: "https://web.archive.org/web/20241110091912/https://www.airbnb.com/help/article/1857",
    publisher: "Airbnb Help Center, archived by the Internet Archive",
    checked: CHECKED,
  },
  {
    id: S.arch2025,
    title: "Airbnb service fees (version of October 31, 2025)",
    url: "https://web.archive.org/web/20251031065737/https://www.airbnb.com/help/article/1857",
    publisher: "Airbnb Help Center, archived by the Internet Archive",
    checked: CHECKED,
  },
  {
    id: S.arch2026,
    title: "Airbnb service fees (version of April 1, 2026)",
    url: "https://web.archive.org/web/20260401091225/https://www.airbnb.com/help/article/1857",
    publisher: "Airbnb Help Center, archived by the Internet Archive",
    checked: CHECKED,
  },
];

const changes: FeeChange[] = [
  {
    date: "2026-10-13",
    text: "Remaining hosts in the European Economic Area and Switzerland, and the last hosts using property management software, moved from the split fee (3% host + 14.1%–16.5% guest) to the 15.5% host-only fee. Airbnb now says it “moved from a split fee to a single fee structure in 2026”.",
    source: S.simplify,
  },
  { date: "2026-09-15", text: "Remaining hosts outside the European Economic Area moved from the split fee to the 15.5% host-only fee (deadline to adjust prices).", source: S.simplify },
  { date: "2026-06-22", text: "Hosts living in Germany and the UK moved from the split fee (3% host fee) to the 15.5% single fee.", source: S.wave3 },
  { date: "2026-06", text: "Listings in Mexico: host-only fee 15.5% → 16% and split host fee 3% → 4%, the same as Brazil.", source: S.arch2026 },
  { date: "2026-05-25", text: "Hosts living in Peru and South Korea moved from the split fee to the 15.5% single fee.", source: S.wave3 },
  { date: "2026-04-20", text: "Hosts living in Bolivia, Ecuador, El Salvador, Guatemala and Panama moved from the split fee to the 15.5% single fee.", source: S.wave1 },
  { date: "2025-12-01", text: "Hosts already on the host-only fee who don’t use property management software: typically 14–16% → 15.5% (listings in Brazil stay at 16%).", source: S.arch2025 },
  {
    date: "2025-10-27",
    text: "Most hosts using property management software were switched to the single fee, and those already on it moved from typically 14–16% to 15.5%.",
    source: S.arch2025,
  },
  { date: "2024-04-01", text: "Split fee: guests paying in a different currency from the listing’s pay an extra amount, for a guest service fee of up to 16.5% of the subtotal.", source: S.arch2024 },
];

/* ---------------- the calculation ---------------- */

type Structure = "single" | "split";

interface Computed {
  structure: Structure;
  nights: number;
  nightly: number;
  nightsTotal: number;
  cleaning: number;
  extra: number;
  subtotal: number;
  hostRate: number;
  hostFee: number;
  vat?: VatRule;
  vatOn: boolean;
  vatAmount: number;
  potential: number;
  coHostType: string;
  coHost: number;
  withholding: number;
  /** What the host would receive before any Fast Pay fee. */
  hostPayout: number;
  fastPay: number;
  fastPayCapped: boolean;
  guestRate: number;
  guestFee: number;
  taxRate: number;
  tax: number;
}

const CO_HOST_TYPES = new Set(["cleaning", "cleaningPlus", "pctExcl", "pctIncl", "fixed"]);

function structureOf(inputs: Inputs): Structure {
  return str(inputs, "feeStructure", "single") === "split" ? "split" : "single";
}

function vatApplies(inputs: Inputs, market: Market): boolean {
  const v = VAT[market.id];
  return Boolean(v && (v.always || bool(inputs, "vatOnFees")));
}

function compute(inputs: Inputs, market: Market): Computed {
  const structure = structureOf(inputs);
  const std = standardRates(market);
  const nights = Math.max(1, Math.round(num(inputs, "nights", 1)));
  const nightly = toCents(num(inputs, "nightlyRate"));
  const nightsTotal = nightly * nights;
  const cleaning = toCents(num(inputs, "cleaningFee"));
  const extra = toCents(num(inputs, "extraFees"));
  const subtotal = nightsTotal + cleaning + extra;

  const rawRate = structure === "single" ? num(inputs, "hostRate", std.single) : num(inputs, "splitHostRate", std.splitHost);
  const hostRate = Math.min(100, Math.max(0, rawRate));
  const hostFee = pct(subtotal, hostRate);

  const vat = VAT[market.id];
  const vatOn = vatApplies(inputs, market);
  const vatAmount = vat && vatOn ? pct(hostFee, vat.rate) : 0;
  const potential = subtotal - hostFee - vatAmount;

  const coHostType = str(inputs, "coHost", "none");
  let coHost = 0;
  if (CO_HOST_TYPES.has(coHostType)) {
    const setup: CoHostSetup = { type: coHostType as CoHostType, pct: Math.min(100, Math.max(0, num(inputs, "coHostPct"))), fixed: toCents(num(inputs, "coHostFixed")) };
    coHost = coHostPayouts(potential, cleaning, [setup]).coHosts[0];
  }

  const withholding = market.id === "it" && bool(inputs, "itWithholding") ? pct(subtotal, IT_WITHHOLDING) : 0;
  const hostPayout = potential - coHost - withholding;

  let fastPay = 0;
  let fastPayCapped = false;
  if (market.id === "us" && str(inputs, "payoutMethod", "standard") === "fastpay" && hostPayout > 0) {
    const raw = pct(hostPayout, FAST_PAY_RATE);
    fastPayCapped = raw > FAST_PAY_CAP_USD;
    fastPay = fastPayCapped ? FAST_PAY_CAP_USD : raw;
  }

  const guestRate = structure === "split" ? Math.min(100, Math.max(0, num(inputs, "guestFeeRate", GUEST_FEE_MIN))) : 0;
  const guestFee = pct(subtotal, guestRate);
  const taxRate = Math.min(100, Math.max(0, num(inputs, "occupancyTax")));
  const tax = pct(subtotal, taxRate);

  return { structure, nights, nightly, nightsTotal, cleaning, extra, subtotal, hostRate, hostFee, vat, vatOn, vatAmount, potential, coHostType, coHost, withholding, hostPayout, fastPay, fastPayCapped, guestRate, guestFee, taxRate, tax };
}

/** The factor to raise prices by to keep the payout the split fee gave (both fees with VAT where it applies). */
export function keepPayoutFactor(market: Market, withVat: boolean): number {
  const std = standardRates(market);
  const v = withVat && VAT[market.id] ? 1 + VAT[market.id].rate / 100 : 1;
  return (1 - (std.splitHost / 100) * v) / (1 - (std.single / 100) * v);
}

function subtotalText(c: Computed, money: (n: number) => string): string {
  const parts = [`${c.nights} night${c.nights === 1 ? "" : "s"} × ${money(c.nightly)}`];
  if (c.cleaning) parts.push(`${money(c.cleaning)} cleaning`);
  if (c.extra) parts.push(`${money(c.extra)} other fees`);
  return parts.join(" + ");
}

function calculate(inputs: Inputs, market: Market) {
  const money = moneyFor(market);
  const c = compute(inputs, market);
  const std = standardRates(market);
  const single = c.structure === "single";
  const fees: Line[] = [];

  const custom = single ? c.hostRate !== std.single : c.hostRate !== std.splitHost;
  fees.push({
    id: "service",
    label: single ? `Airbnb service fee (${formatRate(c.hostRate)})` : `Host service fee (${formatRate(c.hostRate)})`,
    amount: c.hostFee,
    kind: "platform",
    detail: `${formatRate(c.hostRate)} × ${money(c.subtotal)} (${subtotalText(c, money)})`,
    explain: single
      ? `The host-only (single) fee: ${formatRate(c.hostRate)} of your nightly rate × nights plus the cleaning fee and any other fees you add, never of taxes. Your guest pays no Airbnb service fee on top.${custom ? "" : isHighFeeMarket(market) ? " Listings in Brazil and Mexico pay 16%." : " Most hosts pay 15.5%; Airbnb says the rest typically pay 14%–16%."}`
      : `Your part of the split fee: ${formatRate(c.hostRate)} of the nightly rate × nights plus cleaning and other host fees, not of taxes or the guest’s fee. It only applies to bookings made before your account moved to the host-only fee.`,
    source: S.fees,
  });

  if (c.vat && c.vatOn) {
    fees.push({
      id: "vat",
      label: `${c.vat.name} on the service fee (${formatRate(c.vat.rate)})`,
      amount: c.vatAmount,
      kind: "tax",
      detail: `${formatRate(c.vat.rate)} × ${money(c.hostFee)}`,
      explain: c.vat.always
        ? `Airbnb adds ${formatRate(c.vat.rate)} ${c.vat.name} to its fee for hosts in ${market.label} regardless of your tax status. Your price breakdown shows one service fee line of ${money(c.hostFee + c.vatAmount)}, ${c.vat.name} included.`
        : `Airbnb adds ${formatRate(c.vat.rate)} ${c.vat.name} to its fee for hosts in ${market.label} unless you’ve added a ${c.vat.name} number to your account. Your price breakdown shows one service fee line of ${money(c.hostFee + c.vatAmount)}, ${c.vat.name} included.`,
      source: S.vat,
    });
  }

  if (c.coHost || CO_HOST_TYPES.has(c.coHostType)) {
    const what: Record<string, string> = {
      cleaning: "the cleaning fee",
      cleaningPlus: `the cleaning fee + ${formatRate(num(inputs, "coHostPct"))} of the rest`,
      pctExcl: `${formatRate(num(inputs, "coHostPct"))} of your earnings excluding the cleaning fee`,
      pctIncl: `${formatRate(num(inputs, "coHostPct"))} of your earnings`,
      fixed: `a fixed ${money(toCents(num(inputs, "coHostFixed")))}`,
    };
    fees.push({
      id: "cohost",
      label: "Co-host payout",
      amount: c.coHost,
      kind: "other",
      detail: `${what[c.coHostType] ?? "co-host share"}, from ${money(c.potential)} earnings`,
      explain: `Not an Airbnb fee: Airbnb pays your co-host first out of your earnings after its fee (${money(c.potential)} here), and you get what remains. Airbnb charges nothing extra for this.`,
      source: S.coHost,
    });
  }

  if (c.withholding) {
    fees.push({
      id: "withholding",
      label: "Italy income tax withheld (21%)",
      amount: c.withholding,
      kind: "tax",
      detail: `21% × ${money(c.subtotal)}`,
      explain:
        "Airbnb withholds 21% (“cedolare secca”) from non-professional hosts on stays of up to 30 nights, on the gross amount before its fee, VAT and co-host payouts, cleaning fee included. It is income tax paid in advance, not an Airbnb fee.",
      source: S.italy,
    });
  }

  if (market.id === "us" && str(inputs, "payoutMethod", "standard") === "fastpay") {
    fees.push({
      id: "fastpay",
      label: "Fast Pay fee",
      amount: c.fastPay,
      kind: "payout",
      detail: c.fastPayCapped ? `1.5% would be ${money(pct(c.hostPayout, FAST_PAY_RATE))}, capped at $15.00` : `1.5% × ${money(Math.max(0, c.hostPayout))}`,
      explain:
        "Fast Pay sends your payout to a US debit or prepaid card within 30 minutes for 1.5% of each payout, never more than $15 (tax included). Bank transfers and PayPal cost nothing from Airbnb.",
      source: S.fastPay,
    });
  }

  const buyerFees: Line[] = [];
  if (!single) {
    buyerFees.push({
      id: "guest-fee",
      label: `Guest service fee (${formatRate(c.guestRate)})`,
      amount: c.guestFee,
      kind: "platform",
      detail: `${formatRate(c.guestRate)} × ${money(c.subtotal)}`,
      explain: `Under the split fee your guest pays 14.1% to 16.5% of the same subtotal on top of your price (up to 16.5% when they pay in another currency). It doesn’t come out of your payout.`,
      source: S.fees,
    });
  }
  if (c.tax) {
    buyerFees.push({
      id: "occupancy-tax",
      label: `Occupancy taxes (${formatRate(c.taxRate)})`,
      amount: c.tax,
      kind: "tax",
      detail: `${formatRate(c.taxRate)} × ${money(c.subtotal)}`,
      explain: "Taxes Airbnb collects from the guest and pays to the city, state or country. They are not income for you and don’t change your payout. Some places tax a different base or charge per night.",
      source: S.taxes,
    });
  }

  const notes: string[] = [];
  if (single && c.hostRate === std.single) {
    const factor = keepPayoutFactor(market, c.vatOn);
    const pctUp = Number(((factor - 1) * 100).toFixed(1));
    notes.push(
      c.vatOn && c.vat
        ? `Moved from the split fee? To keep the payout your old ${formatRate(std.splitHost)} fee gave you, raise your nightly rate and cleaning fee by ${pctUp}% (${c.vat.name} on both fees included).`
        : `Moved from the split fee? To keep the payout your old ${formatRate(std.splitHost)} fee gave you, raise your nightly rate and cleaning fee by ${pctUp}%. Airbnb’s own example rounds this to $100 → $115.`,
    );
  }
  if (!single && c.nights >= 28) notes.push("For stays over a month Airbnb reduces the guest service fee, and again for stays over 3 months; it doesn’t publish by how much. Your payout is unaffected.");
  if (market.id === "it" && !c.withholding) notes.push(`Non-professional host? Airbnb also withholds 21% income tax on the gross ${money(c.subtotal)} (${money(pct(c.subtotal, IT_WITHHOLDING))} here). Turn it on above to see what reaches your bank.`);
  if (market.id === "mx") notes.push("In Mexico Airbnb may also collect VAT on the whole accommodation price and withhold income tax on your behalf, depending on your tax registration.");
  if (market.id === "us" && c.fastPay && c.nights >= 28) notes.push("Stays of 28 nights or more are paid out monthly, and the $15 Fast Pay cap applies to each payout.");
  if (!c.tax && notes.length < 2) notes.push("Occupancy taxes Airbnb collects are paid by the guest on top of your price. They are not income for you and never reduce your payout.");

  return assemble({
    market,
    buyerPays: c.subtotal + c.guestFee + c.tax,
    saleAmount: c.subtotal,
    fees,
    buyerFees,
    costs: costLinesFor(inputs),
    notes: notes.slice(0, 3),
  });
}

function costLinesFor(inputs: Inputs): Line[] {
  const out: Line[] = [];
  const cleaningCost = toCents(num(inputs, "cleaningCost"));
  const other = toCents(num(inputs, "otherCost"));
  if (cleaningCost) out.push({ id: "cleaningCost", label: "Cleaner & laundry", amount: cleaningCost, kind: "cost" });
  if (other) out.push({ id: "otherCost", label: "Supplies, utilities & other costs", amount: other, kind: "cost" });
  return out;
}

/* ---------------- breakpoints for the reverse solver ---------------- */

const CEILING = 100_000_000;

/** Lowest nightly rate (cents) where `pred` holds, assuming it is monotonic in the nightly rate. */
function firstRateWhere(inputs: Inputs, market: Market, pred: (c: Computed) => boolean): number | null {
  const at = (cents: number) => compute({ ...inputs, nightlyRate: cents / 100 }, market);
  if (!pred(at(CEILING))) return null;
  let lo = 0;
  let hi = CEILING;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (pred(at(mid))) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

function breakpoints(inputs: Inputs, market: Market): number[] {
  const out: number[] = [];
  // Fast Pay turns from 1.5% into a flat $15 once the payout reaches $1,000.
  if (market.id === "us" && str(inputs, "payoutMethod", "standard") === "fastpay") {
    const bp = firstRateWhere(inputs, market, (c) => pct(c.hostPayout, FAST_PAY_RATE) > FAST_PAY_CAP_USD);
    if (bp !== null) out.push(bp);
  }
  // A co-host takes everything until your earnings cover what they're owed.
  const type = str(inputs, "coHost", "none");
  if (CO_HOST_TYPES.has(type)) {
    const fixed = toCents(num(inputs, "coHostFixed"));
    const bp = firstRateWhere(inputs, market, (c) => {
      const owed = type === "fixed" ? fixed : type === "cleaning" || type === "cleaningPlus" ? c.cleaning : 0;
      return c.potential >= owed;
    });
    if (bp !== null) out.push(bp);
  }
  return out;
}

/* ---------------- fee table ---------------- */

function schedule(market: Market): ScheduleRow[] {
  const money = moneyFor(market);
  const std = standardRates(market);
  const vat = VAT[market.id];
  const rows: ScheduleRow[] = [
    {
      fee: "Host-only service fee",
      amount: isHighFeeMarket(market) ? "16%" : "15.5% (others 14%–16%)",
      appliesTo: "Nightly rate × nights + cleaning, pet and extra-guest fees (not taxes)",
      when: "Every booking since your account moved to the single fee (all hosts by October 13, 2026)",
      source: S.fees,
    },
    {
      fee: "Split fee: host part",
      amount: `${formatRate(std.splitHost)}${isHighFeeMarket(market) ? "" : " (some pay more)"}`,
      appliesTo: "The same booking subtotal",
      when: "Bookings made before your switch to the single fee",
      source: S.fees,
    },
    {
      fee: "Split fee: guest part",
      amount: `${formatRate(GUEST_FEE_MIN)}–${formatRate(GUEST_FEE_MAX)}, paid by the guest`,
      appliesTo: "The same booking subtotal",
      when: "Split-fee bookings; up to 16.5% when the guest pays in another currency",
      source: S.fees,
    },
  ];
  if (vat) {
    rows.push({
      fee: `${vat.name} on Airbnb’s fee`,
      amount: formatRate(vat.rate),
      appliesTo: "The host service fee",
      when: vat.always ? "Always, whatever your tax status" : `No ${vat.name} number on your Airbnb account`,
      source: S.vat,
    });
  }
  if (market.id === "it") {
    rows.push({ fee: "Income tax withheld (cedolare secca)", amount: "21%", appliesTo: "Gross booking amount incl. cleaning fee, before Airbnb’s fee", when: "Non-professional hosts, stays up to 30 nights", source: S.italy });
  }
  rows.push({ fee: "Co-host payouts", amount: "No Airbnb fee", appliesTo: "Paid from your earnings after Airbnb’s fee", when: "If you share payouts with a co-host", source: S.coHost });
  if (market.id === "us") {
    rows.push(
      { fee: "Fast Pay", amount: "1.5%, max $15", appliesTo: "Each payout", when: "Only if you choose Fast Pay to a debit card", source: S.fastPay },
      { fee: "Bank transfer (ACH) or PayPal payout", amount: "$0 from Airbnb", appliesTo: "Each payout", when: "PayPal may charge its own fees", source: S.paypal },
    );
  }
  const minService = fromUsd(SERVICES_MIN_USD, market.currency);
  rows.push(
    { fee: "Occupancy and local taxes", amount: "Set by your city, state or country", appliesTo: "Paid by the guest, not income for you", when: "Where Airbnb collects them", source: S.taxes },
    { fee: "Experiences", amount: formatRate(EXPERIENCES_RATE), appliesTo: "The price you set for the experience", when: "Experience bookings (no guest fee)", source: S.experiences },
    {
      fee: "Services",
      amount: market.currency === "USD" ? `${formatRate(SERVICES_RATE)}, min $6` : `${formatRate(SERVICES_RATE)}, min US$6 (≈ ${money(minService)})`,
      appliesTo: "The price you set for the service",
      when: market.currency === "USD" ? "Service bookings (no guest fee)" : `Service bookings; Airbnb converts US$6 at the day’s rate (≈ shown at the ECB rate of ${FX_DATE})`,
      source: S.experiences,
    },
  );
  return rows;
}

/* ---------------- fields ---------------- */

const STRUCTURE_OPTIONS = (_i: Inputs, market: Market): SelectOption[] => {
  const std = standardRates(market);
  return [
    { value: "single", label: `Host-only · ${formatRate(std.single)}` },
    { value: "split", label: `Split · ${formatRate(std.splitHost)} + guest fee` },
  ];
};

const CO_HOST_OPTIONS: SelectOption[] = [
  { value: "none", label: "No co-host payout" },
  { value: "pctIncl", label: "A % of my earnings, cleaning fee included" },
  { value: "pctExcl", label: "A % of my earnings, cleaning fee excluded" },
  { value: "cleaningPlus", label: "The cleaning fee plus a % of the rest" },
  { value: "cleaning", label: "The cleaning fee only" },
  { value: "fixed", label: "A fixed amount per booking" },
];

const hasVatToggle = (_i: Inputs, m: Market) => Boolean(VAT[m.id]) && !VAT[m.id].always;
const rateNow = (inputs: Inputs, market: Market) => {
  const std = standardRates(market);
  return structureOf(inputs) === "single" ? num(inputs, "hostRate", std.single) : num(inputs, "splitHostRate", std.splitHost);
};

export const airbnb: CalculatorDef = {
  slug: "airbnb",
  name: "Airbnb",
  path: "/airbnb-fee-calculator",
  category: "rentals",
  priceNoun: "nightly rate",
  sellerNoun: "host",
  saleNoun: "booking",
  buyerNoun: "guest",
  costsHint: "Cleaner, laundry, supplies per stay. Optional.",
  blurb: "15.5% host-only fee on nights + cleaning fee; guests pay no service fee",
  markets: MARKETS,
  defaultMarket: "us",
  priceField: "nightlyRate",
  fields: [
    { id: "nightlyRate", kind: "money", label: "Nightly rate", section: "sale", help: "Your price per night before Airbnb’s fee. Use the average after any weekly or monthly discount." },
    { id: "nights", kind: "number", label: "Nights", section: "sale", integer: true, min: 1, max: 365, unit: "nights", help: "How long the stay is." },
    {
      id: "cleaningFee",
      kind: "money",
      label: "Cleaning fee",
      section: "sale",
      help: (inputs, market) => `Airbnb takes its ${formatRate(rateNow(inputs, market))} from this too, so raise it along with your nightly rate.`,
    },
    {
      id: "extraFees",
      kind: "money",
      label: "Pet, extra-guest & other fees",
      section: "sale",
      advanced: true,
      help: "The total for the stay. Airbnb’s fee is charged on these too.",
    },
    {
      id: "feeStructure",
      kind: "segmented",
      label: "Which Airbnb fee applies?",
      section: "options",
      options: STRUCTURE_OPTIONS,
      help: "All hosts were moved to the host-only fee by October 13, 2026. Bookings made before your switch keep the split fee, even for later stays.",
    },
    {
      id: "vatOnFees",
      kind: "toggle",
      label: "Airbnb adds VAT/GST to my fee",
      section: "options",
      showIf: hasVatToggle,
      help: (_i, m) => {
        const v = VAT[m.id];
        return v ? `${formatRate(v.rate)} ${v.name} for hosts in ${m.label}, unless you’ve added a ${v.name} number to your Airbnb account.` : "";
      },
    },
    {
      id: "itWithholding",
      kind: "toggle",
      label: "Airbnb withholds 21% income tax (cedolare secca)",
      section: "options",
      showIf: (_i, m) => m.id === "it",
      help: "Non-professional hosts (fewer than 3 listings, no VAT number) on stays up to 30 nights. It’s tax, not a fee.",
    },
    {
      id: "hostRate",
      kind: "percent",
      label: "Your host-only fee rate",
      section: "options",
      advanced: true,
      min: 0,
      max: 30,
      step: 0.1,
      showIf: (i) => structureOf(i) === "single",
      help: (_i, m) => (isHighFeeMarket(m) ? "Listings in Mexico and Brazil pay 16%. Check the service fee on a recent booking." : "Most hosts pay 15.5%; Airbnb says the rest typically pay 14%–16%. Check a recent booking’s service fee."),
    },
    {
      id: "splitHostRate",
      kind: "percent",
      label: "Your split host fee rate",
      section: "options",
      advanced: true,
      min: 0,
      max: 30,
      step: 0.1,
      showIf: (i) => structureOf(i) === "split",
      help: (_i, m) => (isHighFeeMarket(m) ? "Listings in Mexico and Brazil pay 4%." : "Most hosts pay 3%; Airbnb says some pay more."),
    },
    {
      id: "guestFeeRate",
      kind: "percent",
      label: "Guest service fee rate",
      section: "options",
      advanced: true,
      min: 0,
      max: 30,
      step: 0.1,
      showIf: (i) => structureOf(i) === "split",
      help: "Airbnb sets it per booking: 14.1%–16.5% of the subtotal, the top end when the guest pays in another currency. It never comes out of your payout.",
    },
    {
      id: "occupancyTax",
      kind: "percent",
      label: "Occupancy tax the guest pays",
      section: "options",
      advanced: true,
      min: 0,
      max: 40,
      step: 0.1,
      help: "Only changes the guest’s total: Airbnb passes it to the city or state, and your payout stays the same.",
    },
    {
      id: "payoutMethod",
      kind: "segmented",
      label: "How do you get paid?",
      section: "options",
      advanced: true,
      showIf: (_i, m) => m.id === "us",
      options: [
        { value: "standard", label: "Bank or PayPal" },
        { value: "fastpay", label: "Fast Pay" },
      ],
      help: "Fast Pay reaches a US debit card in 30 minutes for 1.5% of the payout, max $15.",
    },
    {
      id: "coHost",
      kind: "select",
      label: "Do you share payouts with a co-host?",
      section: "options",
      advanced: true,
      options: CO_HOST_OPTIONS,
      help: "Airbnb pays the co-host first from your earnings after its fee; you get the rest.",
    },
    {
      id: "coHostPct",
      kind: "percent",
      label: "Co-host’s percentage",
      section: "options",
      advanced: true,
      min: 0,
      max: 100,
      step: 0.5,
      showIf: (i) => ["pctIncl", "pctExcl", "cleaningPlus"].includes(str(i, "coHost", "none")),
    },
    {
      id: "coHostFixed",
      kind: "money",
      label: "Co-host’s fixed amount per booking",
      section: "options",
      advanced: true,
      showIf: (i) => str(i, "coHost", "none") === "fixed",
    },
    { id: "cleaningCost", kind: "money", label: "Cleaner & laundry per stay", section: "costs", help: "What you pay to turn the place over." },
    { id: "otherCost", kind: "money", label: "Supplies, utilities & other per stay", section: "costs" },
  ],
  defaults: (market) => {
    const [nightly, cleaning] = DEFAULT_STAY[market.id] ?? EURO_STAY;
    const std = standardRates(market);
    return {
      nightlyRate: nightly,
      nights: 3,
      cleaningFee: cleaning,
      extraFees: 0,
      feeStructure: "single",
      vatOnFees: Boolean(VAT[market.id]),
      itWithholding: false,
      hostRate: std.single,
      splitHostRate: std.splitHost,
      guestFeeRate: GUEST_FEE_MIN,
      occupancyTax: 0,
      payoutMethod: "standard",
      coHost: "none",
      coHostPct: 20,
      coHostFixed: 0,
      cleaningCost: 0,
      otherCost: 0,
    };
  },
  calculate,
  breakpoints,
  verifiedAt: "2026-10-23",
  sources,
  changes,
  schedule,
};

export default airbnb;
