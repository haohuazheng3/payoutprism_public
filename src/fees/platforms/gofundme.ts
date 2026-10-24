/*
 * GoFundMe fees. Every number is from GoFundMe's own pages (see `sources`), verified 2026-10-23.
 * Research notes with verbatim quotes: research/fees/gofundme.md.
 *
 * What this module reproduces:
 *  - No platform fee: starting and running a fundraiser is free (Terms of Service §11).
 *  - One transaction fee per donation, deducted before payout: a percentage of the donation plus
 *    a fixed amount in the fundraiser's currency (pricing page, per country). Certified charity
 *    fundraisers (US, CA, UK, IE, AU only) pay a lower rate. UK / euro / Nordic / Swiss rates
 *    include VAT and Australian rates include GST, so nothing is added on top.
 *  - The fee is charged on the donation only. The donor's optional tip to GoFundMe and the 5%
 *    recurring fee monthly donors pay are added on top of the donation and shown as donor-side
 *    lines (`buyerFees`); they never reduce the payout.
 *  - GoFundMe Pro (US nonprofits): custom contract. GoFundMe Pay processing (card up to 2.5% +
 *    $0.30, AmEx +1%, ACH 1% + $0.30, PayPal/Venmo 2.5% + $0.30) plus the contract's own Pro
 *    transaction fee, and the optional "donor covered fees" gross-up.
 *
 * Rounding: GoFundMe deducts the fee donation by donation but does not document how it rounds
 * each one. The calculator only knows the total and the number of donations, so it applies the
 * percentage to the total and rounds once, exactly as the calculator on GoFundMe's pricing page
 * does (fees = amount × percent + fixed × donors). A statement can differ by under a cent per
 * donation. Donor covered fees on Pro are truncated to the cent, as in GoFundMe's own example
 * ((100 + 0.30) / (1 − 0.03 − 0.024) = 106.0254… → $106.02).
 */
import { M } from "../markets";
import { assemble, bool, formatRate, moneyFor, num, pct, str, toCents } from "../money";
import type { CalculatorDef, CurrencyCode, FeeChange, Inputs, Line, Market, ScheduleRow, SelectOption, Source } from "../types";

const MARKETS: Market[] = [M.us, M.uk, M.ca, M.au, M.ie, M.de, M.fr, M.it, M.es, M.nl, M.be, M.at, M.pt, M.fi, M.ch, M.se, M.dk, M.no, M.mx];

interface Rate {
  /** Percent of each donation. */
  pct: number;
  /** Fixed fee per donation, in cents of the fundraiser's currency. */
  fixed: number;
}

/** Individual or business fundraisers (pricing page country table, page dated 2026-09-15). */
const PERSONAL: Record<string, Rate> = {
  us: { pct: 2.9, fixed: 30 },
  ca: { pct: 2.9, fixed: 30 },
  au: { pct: 2.2, fixed: 30 },
  uk: { pct: 2.9, fixed: 25 },
  ie: { pct: 2.9, fixed: 25 },
  de: { pct: 2.9, fixed: 25 },
  fr: { pct: 2.9, fixed: 25 },
  it: { pct: 2.9, fixed: 25 },
  es: { pct: 2.9, fixed: 25 },
  nl: { pct: 2.9, fixed: 25 },
  be: { pct: 2.9, fixed: 25 },
  at: { pct: 2.9, fixed: 25 },
  pt: { pct: 2.9, fixed: 25 },
  fi: { pct: 2.9, fixed: 25 },
  ch: { pct: 2.9, fixed: 30 },
  se: { pct: 2.9, fixed: 300 },
  dk: { pct: 2.9, fixed: 300 },
  no: { pct: 2.9, fixed: 300 },
  mx: { pct: 2.9, fixed: 500 },
};

/** Certified nonprofit (charity) fundraisers: only these five countries offer them. */
const CHARITY: Record<string, Rate> = {
  us: { pct: 2.2, fixed: 30 },
  ca: { pct: 2.2, fixed: 30 },
  au: { pct: 1.9, fixed: 30 },
  uk: { pct: 1.9, fixed: 20 },
  ie: { pct: 1.9, fixed: 35 },
};

/** The pricing page marks these rates "VAT incl." / "GST incl." (Canada and Mexico carry no tax label). */
const TAX_INCLUDED: Record<string, "VAT" | "GST"> = {
  au: "GST",
  uk: "VAT",
  ie: "VAT",
  de: "VAT",
  fr: "VAT",
  it: "VAT",
  es: "VAT",
  nl: "VAT",
  be: "VAT",
  at: "VAT",
  pt: "VAT",
  fi: "VAT",
  ch: "VAT",
  se: "VAT",
  dk: "VAT",
  no: "VAT",
};

/**
 * Minimum donation by currency, in cents ("How to make a donation"). Maximum is 100,000 in every
 * currency; US$250,000 only by ACH, which certified charity fundraisers don't accept ("Payment
 * options for donors": PayPal and DAF are their only digital payments), so they stay at $100,000.
 */
const MIN_DONATION: Partial<Record<CurrencyCode, number>> = { MXN: 2500, DKK: 5000, NOK: 5000, SEK: 5000 };
const minDonation = (m: Market) => MIN_DONATION[m.currency] ?? 500;
const achAllowed = (m: Market, type: FundraiserType) => m.id === "us" && type !== "charity";
const maxDonation = (m: Market, type: FundraiserType) => (achAllowed(m, type) ? 25_000_000 : 10_000_000);

/** Monthly (recurring) donations: "Fundraisers in Italy and Canada do not have recurring donations as an option." */
const RECURRING_RATE = 5;
const hasRecurring = (m: Market) => m.id !== "it" && m.id !== "ca";

/** GoFundMe Pay processing for GoFundMe Pro nonprofits (US). */
const PRO_METHODS: Record<string, { label: string; pct?: number; fixed: number }> = {
  card: { label: "Card", fixed: 30 },
  amex: { label: "AmEx", fixed: 30 },
  ach: { label: "Bank (ACH)", pct: 1, fixed: 30 },
  paypal: { label: "PayPal / Venmo", pct: 2.5, fixed: 30 },
};
const PRO_AMEX_EXTRA = 1;

type FundraiserType = "personal" | "charity" | "pro";

function fundraiserType(inputs: Inputs, market: Market): FundraiserType {
  const t = str(inputs, "fundraiserType", "personal");
  if (t === "charity" && CHARITY[market.id]) return "charity";
  if (t === "pro" && market.id === "us") return "pro";
  return "personal";
}

const S = {
  pricing: "gfm-pricing",
  fees: "gfm-fees",
  terms: "gfm-terms",
  tip: "gfm-tip",
  recurring: "gfm-recurring",
  donate: "gfm-donate",
  nonprofit: "gfm-nonprofit",
  npPayouts: "gfm-nonprofit-payouts",
  goal: "gfm-goal",
  transfers: "gfm-transfers",
  intl: "gfm-international",
  payOptions: "gfm-payment-options",
  countries: "gfm-countries",
  pay: "gfm-pro-pay",
  covered: "gfm-pro-covered",
  npPages: "gfm-pro-nonprofit-pages",
  proPricing: "gfm-pro-pricing",
  proIntro: "gfm-pro-intro",
} as const;

const help = (id: string, title: string, checked = "2026-10-23"): Source => ({
  id: "",
  title,
  url: `https://support.gofundme.com/hc/en-us/articles/${id}`,
  publisher: "GoFundMe Help Center",
  checked,
  watch: `https://support.gofundme.com/api/v2/help_center/en-us/articles/${id}.json`,
});
const proHelp = (id: string, title: string): Source => ({
  id: "",
  title,
  url: `https://prosupport.gofundme.com/hc/en-us/articles/${id}`,
  publisher: "GoFundMe Pro Help Center",
  checked: "2026-10-23",
  watch: `https://prosupport.gofundme.com/api/v2/help_center/en-us/articles/${id}.json`,
});

const sources: Source[] = [
  { id: S.pricing, title: "Pricing and Fees", url: "https://www.gofundme.com/c/pricing", publisher: "GoFundMe", checked: "2026-10-23" },
  { ...help("203604424", "Learn about GoFundMe fees"), id: S.fees },
  { id: S.terms, title: "GoFundMe Terms of Service", url: "https://www.gofundme.com/c/terms", publisher: "GoFundMe", checked: "2026-10-23" },
  { ...help("360051144952", "Choosing a tip amount"), id: S.tip },
  { ...help("26707416172059", "Provide ongoing support with recurring monthly donations"), id: S.recurring },
  { ...help("360001992827", "How to make a donation"), id: S.donate },
  { ...help("360056814271", "Raising funds for a nonprofit"), id: S.nonprofit },
  { ...help("360056093332", "Receiving nonprofit fundraiser payouts"), id: S.npPayouts },
  { ...help("4405145410331", "Choosing your goal amount"), id: S.goal },
  { ...help("360042184631", "Transferring money to your personal bank account"), id: S.transfers },
  { ...help("203604354", "International donations"), id: S.intl },
  { ...help("4402563115412", "Payment options for donors"), id: S.payOptions },
  { ...help("360001972748", "Countries supported on GoFundMe"), id: S.countries },
  { ...proHelp("37288767770395", "GoFundMe Pay"), id: S.pay },
  { ...proHelp("37288785080219", "Donor covered fees"), id: S.covered },
  { ...proHelp("37288767138075", "Nonprofit Pages on GoFundMe"), id: S.npPages },
  { id: S.proPricing, title: "GoFundMe Pro pricing: Find a plan that fits", url: "https://pro.gofundme.com/c/pricing/", publisher: "GoFundMe Pro", checked: "2026-10-23" },
  { ...proHelp("37288737656091", "Introducing GoFundMe Pro"), id: S.proIntro },
];

const changes: FeeChange[] = [
  {
    date: "2026-06-23",
    text: "New Terms of Service took effect: still no platform fee and no charge to start or run a fundraiser. The terms define the per-donation transaction fee and the recurring fee monthly donors pay on top, with the rates set on the pricing page.",
    source: S.terms,
  },
  {
    date: "2025-06-23",
    text: "Classy is now GoFundMe Pro: GoFundMe, Inc. took over all Classy contracts, and Classy’s terms became the GoFundMe Pro Terms of Service. GoFundMe said nothing changed with existing plans, pricing or fees.",
    source: S.proIntro,
  },
];

function rateFor(type: FundraiserType, market: Market): Rate {
  return type === "charity" ? CHARITY[market.id] : (PERSONAL[market.id] ?? PERSONAL.us);
}

function taxNote(market: Market): string {
  const t = TAX_INCLUDED[market.id];
  return t ? ` The rate already includes ${t}; nothing is added on top.` : "";
}

function calculate(inputs: Inputs, market: Market) {
  const money = moneyFor(market);
  const type = fundraiserType(inputs, market);
  const raised = toCents(num(inputs, "raised"));
  // No money raised means no donations (and no per-donation fees).
  const count = raised > 0 ? Math.max(1, Math.round(num(inputs, "donations", 1))) : 0;
  const plural = (n: number) => `${n.toLocaleString("en-US")} donation${n === 1 ? "" : "s"}`;
  const fees: Line[] = [];
  const buyerFees: Line[] = [];
  const notes: string[] = [];
  const warnings: string[] = [];

  const min = minDonation(market);
  const max = maxDonation(market, type);
  if (count > 0 && raised < count * min) {
    warnings.push(`${plural(count)} can’t add up to less than ${money(count * min)}: GoFundMe’s smallest donation is ${money(min)}.`);
  }
  if (count > 0 && raised > count * max) {
    warnings.push(`That’s more than ${money(max)} per donation, GoFundMe’s largest single donation${achAllowed(market, type) ? " (by bank transfer; $100,000 by card)" : ""}. Add more donations.`);
  }

  if (type === "pro") {
    const method = PRO_METHODS[str(inputs, "proMethod", "card")] ?? PRO_METHODS.card;
    const methodId = str(inputs, "proMethod", "card");
    const cardRate = Math.max(0, num(inputs, "proCardRate", 2.5));
    const procRate = method.pct ?? cardRate;
    const amex = methodId === "amex";
    const service = Math.max(0, num(inputs, "proServiceFee"));
    const fixedTotal = method.fixed * count;
    const covers = bool(inputs, "donorCovers");
    const totalRate = service + procRate + (amex ? PRO_AMEX_EXTRA : 0);
    // Donor covered fees: (donation + fixed) / (1 − service − processor − add-on), truncated to the cent.
    const charged = covers && raised > 0 && totalRate < 100 ? Math.floor(((raised + fixedTotal) * 100) / (100 - totalRate) + 1e-6) : raised;

    if (service > 0) {
      fees.push({
        id: "pro-service",
        label: `GoFundMe Pro transaction fee (${formatRate(service)})`,
        amount: pct(charged, service),
        kind: "platform",
        detail: `${formatRate(service)} × ${money(charged)}`,
        explain: "The per-donation fee set in your GoFundMe Pro contract. GoFundMe doesn’t publish it (its own example uses 3%).",
        source: S.covered,
      });
    }
    const procLabel = methodId === "ach" ? "ACH processing" : methodId === "paypal" ? "PayPal / Venmo processing" : "GoFundMe Pay card processing";
    fees.push({
      id: "processing",
      label: `${procLabel} (${formatRate(procRate)})`,
      amount: pct(charged, procRate),
      kind: "payment",
      detail: `${formatRate(procRate)} × ${money(charged)}`,
      explain:
        methodId === "ach"
          ? "GoFundMe Pay charges 1% + $0.30 on each ACH bank donation. A failed ACH payment costs $4.00."
          : methodId === "paypal"
            ? "GoFundMe Pay charges 2.5% + $0.30 on PayPal and Venmo donations, plus 1.5% on international PayPal payments."
            : "GoFundMe Pay charges up to 2.5% + $0.30 per card donation; your contract sets the exact rate (GoFundMe says typically 2.2%–2.5%).",
      source: S.pay,
    });
    if (amex) {
      fees.push({
        id: "amex",
        label: "American Express surcharge (1%)",
        amount: pct(charged, PRO_AMEX_EXTRA),
        kind: "payment",
        detail: `1% × ${money(charged)}`,
        explain: "GoFundMe Pay adds 1% to the card rate when the donor pays with American Express.",
        source: S.pay,
      });
    }
    fees.push({
      id: "per-donation",
      label: `${money(method.fixed)} per donation`,
      amount: fixedTotal,
      kind: "payment",
      detail: `${money(method.fixed)} × ${plural(count)}`,
      explain: "GoFundMe Pay’s fixed fee comes off every donation, whatever its size.",
      source: S.pay,
    });
    if (covers && charged > raised) {
      buyerFees.push({
        id: "covered",
        label: "Fees covered by donors",
        amount: charged - raised,
        kind: "other",
        detail: `(${money(raised)} + ${money(fixedTotal)}) ÷ (1 − ${formatRate(totalRate)}) − ${money(raised)}`,
        explain: "Donors who tick “cover fees” add this on top, so your nonprofit receives the full donation. GoFundMe Pro grosses the gift up the same way Stripe does.",
        source: S.covered,
      });
    }
    notes.push("Your annual GoFundMe Pro subscription is custom-priced and billed separately, so it isn’t included here. Your exact rates are under Settings → Billing.");
    return assemble({ market, buyerPays: charged, saleAmount: charged, fees, buyerFees, notes, warnings });
  }

  const rate = rateFor(type, market);
  fees.push({
    id: "platform",
    label: "Platform fee",
    amount: 0,
    kind: "platform",
    detail: "0%",
    explain: "GoFundMe charges nothing to start or run a fundraiser. The transaction fee below is the only thing taken from donations.",
    source: S.terms,
  });
  fees.push({
    id: "transaction",
    label: `Transaction fee (${formatRate(rate.pct)})`,
    amount: pct(raised, rate.pct),
    kind: "payment",
    detail: `${formatRate(rate.pct)} × ${money(raised)}`,
    explain:
      (type === "charity"
        ? `Certified charity fundraisers pay ${formatRate(rate.pct)} of each donation instead of ${formatRate(PERSONAL[market.id].pct)}. It’s deducted before the money reaches the nonprofit.`
        : `${formatRate(rate.pct)} of each donation, deducted automatically before the money reaches your bank. It’s charged on the donation only, never on a donor’s tip.`) + taxNote(market),
    source: S.pricing,
  });
  const singleMin = ((rate.fixed / min) * 100).toFixed(0);
  fees.push({
    id: "per-donation",
    label: `Transaction fee (${money(rate.fixed)} per donation)`,
    amount: rate.fixed * count,
    kind: "payment",
    detail: `${money(rate.fixed)} × ${plural(count)}`,
    explain: `The fixed part of the transaction fee comes off every donation, whatever its size: on a ${money(min)} donation it’s ${singleMin}% on its own. Many small gifts cost more than a few large ones.`,
    source: S.pricing,
  });

  let monthly = toCents(num(inputs, "monthly"));
  if (!hasRecurring(market)) monthly = 0;
  if (monthly > raised) {
    warnings.push("Monthly donations can’t be more than the total raised, so we counted all of it as monthly.");
    monthly = raised;
  }
  const single = raised - monthly;
  const tipPct = Math.max(0, num(inputs, "tipPct"));
  if (tipPct > 0 && single > 0) {
    buyerFees.push({
      id: "tips",
      label: `Optional tips to GoFundMe (${formatRate(tipPct)})`,
      amount: pct(single, tipPct),
      kind: "other",
      detail: `${formatRate(tipPct)} × ${money(single)}`,
      explain: "Donors who give once can add a tip for GoFundMe. It’s paid on top, goes to GoFundMe rather than to you, can be set to 0, and you can’t see who tipped. A tip left by mistake can be refunded.",
      source: S.tip,
    });
  }
  if (monthly > 0) {
    buyerFees.push({
      id: "recurring",
      label: `Recurring fee paid by monthly donors (${RECURRING_RATE}%)`,
      amount: pct(monthly, RECURRING_RATE),
      kind: "other",
      detail: `${RECURRING_RATE}% × ${money(monthly)}`,
      explain: "Monthly donors pay 5% of each monthly donation on top. It doesn’t come out of what you receive: the usual transaction fee is still taken from the donation itself.",
      source: S.recurring,
    });
  }

  if (type === "charity") {
    notes.push(
      `The money goes to the nonprofit, not to you: through PayPal Giving Fund at the end of each month (donations after the 15th are paid the following month)${market.id === "us" ? ", or directly if the nonprofit uses GoFundMe Pay" : ""}.`,
    );
  } else {
    notes.push("GoFundMe suggests setting your goal a little above what you need to cover these fees. Switch to “What to charge” to find the total that leaves you the amount you need.");
  }
  if (CHARITY[market.id] && type === "personal") {
    notes.push(`Raising for a certified charity? Charity fundraisers pay ${formatRate(CHARITY[market.id].pct)} + ${money(CHARITY[market.id].fixed)} per donation, and the money goes straight to the nonprofit.`);
  }

  const donorExtras = buyerFees.reduce((s, l) => s + l.amount, 0);
  return assemble({ market, buyerPays: raised + donorExtras, saleAmount: raised, fees, buyerFees, notes, warnings });
}

function schedule(market: Market): ScheduleRow[] {
  const money = moneyFor(market);
  const p = PERSONAL[market.id] ?? PERSONAL.us;
  const c = CHARITY[market.id];
  const tax = TAX_INCLUDED[market.id] ? ` (${TAX_INCLUDED[market.id]} incl.)` : "";
  const rows: ScheduleRow[] = [
    { fee: "Platform fee", amount: "0%", appliesTo: "Starting and running a fundraiser", when: "Never charged", source: S.terms },
    { fee: "Transaction fee", amount: `${formatRate(p.pct)} + ${money(p.fixed)}${tax}`, appliesTo: "Each donation (not the tip)", when: "Fundraisers paid to a personal or business bank account", source: S.pricing },
  ];
  if (c) {
    rows.push({ fee: "Transaction fee: certified charity", amount: `${formatRate(c.pct)} + ${money(c.fixed)}${tax}`, appliesTo: "Each donation", when: "Fundraisers paid straight to a certified nonprofit", source: S.pricing });
  }
  rows.push({ fee: "Tip to GoFundMe", amount: "Donor’s choice, can be 0", appliesTo: "Added on top of a one-time donation", when: "Optional; paid by the donor, never deducted", source: S.tip });
  if (hasRecurring(market)) {
    rows.push({ fee: "Recurring donation fee", amount: "5%", appliesTo: "Each monthly donation, on top", when: "Paid by monthly donors; doesn’t reduce your payout", source: S.recurring });
  }
  rows.push(
    { fee: "Currency conversion", amount: "None from GoFundMe", appliesTo: "Donations from another currency", when: "The donor’s bank may charge its own fee", source: S.donate },
    { fee: "Bank transfers to you", amount: "No fee", appliesTo: "Payouts to your bank account", when: "The transaction fee is the only deduction", source: S.fees },
  );
  if (market.id === "us") {
    rows.push(
      { fee: "Nonprofit Page donations (GoFundMe Pro)", amount: "2.2% + $0.30", appliesTo: "Each donation made via GoFundMe", when: "Nonprofits’ own pages on GoFundMe; no platform fee", source: S.npPages },
      { fee: "GoFundMe Pay: cards (Pro)", amount: "Up to 2.5% + $0.30", appliesTo: "Each card donation", when: "GoFundMe Pro campaigns; rate set by contract", source: S.pay },
      { fee: "GoFundMe Pay: American Express (Pro)", amount: "+1%", appliesTo: "AmEx donations", when: "On top of the card rate", source: S.pay },
      { fee: "GoFundMe Pay: ACH (Pro)", amount: "1% + $0.30", appliesTo: "Each bank donation", when: "$4.00 per failed ACH payment", source: S.pay },
      { fee: "GoFundMe Pay: PayPal & Venmo (Pro)", amount: "2.5% + $0.30", appliesTo: "Each PayPal or Venmo donation", when: "+1.5% on international PayPal payments", source: S.pay },
      { fee: "Disputes (Pro)", amount: "$4.00; $15.00 PayPal", appliesTo: "Each disputed payment", when: "No fee if resolved in your favor", source: S.pay },
      { fee: "GoFundMe Pro subscription", amount: "Custom", appliesTo: "Annual, paid upfront", when: "Plus a transaction fee per donation set by contract", source: S.proPricing },
    );
  }
  return rows;
}

function typeOptions(_inputs: Inputs, market: Market): SelectOption[] {
  const money = moneyFor(market);
  const p = PERSONAL[market.id] ?? PERSONAL.us;
  const opts: SelectOption[] = [{ value: "personal", label: "A personal or business bank account", hint: `${formatRate(p.pct)} + ${money(p.fixed)}` }];
  const c = CHARITY[market.id];
  if (c) opts.push({ value: "charity", label: "Straight to a certified charity", hint: `${formatRate(c.pct)} + ${money(c.fixed)}` });
  if (market.id === "us") opts.push({ value: "pro", label: "A nonprofit on GoFundMe Pro", hint: "Up to 2.5% + $0.30, by contract" });
  return opts;
}

const isPro = (i: Inputs, m: Market) => fundraiserType(i, m) === "pro";

export const gofundme: CalculatorDef = {
  slug: "gofundme",
  name: "GoFundMe",
  path: "/gofundme-fee-calculator",
  category: "fundraising",
  priceNoun: "amount raised",
  saleNoun: "fundraiser",
  sellerNoun: "organizer",
  blurb: "No platform fee; 2.9% + $0.30 per donation (US)",
  markets: MARKETS,
  defaultMarket: "us",
  priceField: "raised",
  fields: [
    { id: "raised", kind: "money", label: "Total donations raised", section: "sale", help: "What donors gave, before fees. Tips donors add for GoFundMe don’t count." },
    {
      id: "donations",
      kind: "number",
      label: "Number of donations",
      section: "sale",
      integer: true,
      min: 1,
      max: 1_000_000,
      help: "The fixed part of the fee is taken once per donation, so many small gifts cost more than a few big ones.",
    },
    {
      id: "fundraiserType",
      kind: "select",
      label: "Where does the money go?",
      section: "sale",
      options: typeOptions,
      help: "Charity fundraisers pay a lower rate, but the money goes to the nonprofit, not to you.",
      showIf: (_i, m) => Boolean(CHARITY[m.id]),
    },
    {
      id: "proMethod",
      kind: "segmented",
      label: "How did donors pay?",
      section: "options",
      options: Object.entries(PRO_METHODS).map(([value, o]) => ({ value, label: o.label })),
      help: "GoFundMe Pay charges a different rate for each payment method.",
      showIf: isPro,
    },
    {
      id: "proCardRate",
      kind: "percent",
      label: "Your GoFundMe Pay card rate",
      section: "options",
      min: 0,
      max: 10,
      step: 0.1,
      help: "Up to 2.5% + $0.30; your contract sets the exact rate.",
      showIf: (i, m) => isPro(i, m) && ["card", "amex"].includes(str(i, "proMethod", "card")),
    },
    {
      id: "proServiceFee",
      kind: "percent",
      label: "GoFundMe Pro transaction fee in your contract",
      section: "options",
      min: 0,
      max: 20,
      step: 0.1,
      help: "Not published; GoFundMe’s own example uses 3%. Leave at 0 if your contract has none.",
      showIf: isPro,
    },
    { id: "donorCovers", kind: "toggle", label: "Donors chose to cover the fees", section: "options", help: "Their gift is grossed up so your nonprofit receives the full donation.", showIf: isPro },
    {
      id: "monthly",
      kind: "money",
      label: "Of that, given as monthly donations",
      section: "options",
      advanced: true,
      help: "Monthly donors pay an extra 5% on top. It doesn’t come out of what you receive.",
      showIf: (i, m) => hasRecurring(m) && !isPro(i, m),
    },
    {
      id: "tipPct",
      kind: "percent",
      label: "Average tip donors added for GoFundMe",
      section: "options",
      advanced: true,
      min: 0,
      max: 100,
      step: 0.5,
      help: "Optional and paid on top of the donation. It goes to GoFundMe and never reduces what you receive.",
      showIf: (i, m) => !isPro(i, m),
    },
  ],
  defaults: (market) => ({
    raised: market.currency === "SEK" || market.currency === "DKK" || market.currency === "NOK" || market.currency === "MXN" ? 50000 : 5000,
    donations: 50,
    fundraiserType: "personal",
    proMethod: "card",
    proCardRate: 2.5,
    proServiceFee: 0,
    donorCovers: false,
    monthly: 0,
    tipPct: 0,
  }),
  calculate,
  // The fee is linear in the amount raised (a percentage plus a fixed amount per donation): no breakpoints.
  breakpoints: () => [],
  verifiedAt: "2026-10-23",
  sources,
  changes,
  schedule,
};

export default gofundme;
