/*
 * Upwork fees for freelancers. Every number is from Upwork's own pages (see `sources`), re-read on
 * 2026-10-23: help-center articles through their Zendesk JSON twins, the pricing pages and the Fee
 * and ACH Authorization Agreement (effective July 20, 2026), plus Upwork's own SEC filings for the
 * dates of the 2023 and 2025 service-fee changes. Research notes: research/fees/upwork.md.
 *
 * How one payment is computed (what this module reproduces):
 *  - Gross = what the freelancer bills the client: a fixed-price milestone, or hours × hourly rate
 *    (Upwork bills hourly work weekly). Bonuses and expense reimbursements are billed the same way.
 *  - Freelancer service fee = gross × the contract's rate, rounded to the cent per payment (Upwork's
 *    own examples: $26.664 → $26.66, $33.336 → $33.34). The rate depends on the contract:
 *      new Marketplace contracts since May 2025: 0%–15%, set by Upwork per contract, shown on the
 *      offer/proposal and fixed for the contract's life (the user enters it; default 10%, Upwork's
 *      own worked example); contracts formed before May 2025: flat 10%; Direct Contracts the
 *      freelancer brings: 5%, 0% for active Freelancer Plus members; Enterprise clients: typically
 *      10%; Any Hire, client-initiated Direct Contracts, Upwork Payroll: 0%.
 *  - Tax on Upwork's fees where the freelancer's country requires it and no VAT/GST number is on
 *    file: charged on the service fee and on Connects purchases (UK 20%, Australia 10%, India 18%,
 *    Canada by province). Each tax is its own line, rounded separately.
 *  - India: TDS withheld from the gross amount, before the service fee (0.1% with a verified PAN
 *    linked to Aadhaar, 5% without).
 *  - Connects spent to win the job (optional): $0.15 each. Not deducted from the payment itself.
 *  - Withdrawal: a flat US-dollar fee per withdrawal, shown as a payout line. Instant Pay moves at
 *    most $2,999 per transfer, so bigger balances take several $2.00 transfers.
 *  - The client side (marketplace or Business Plus fee on top of the payment, plus a one-time
 *    contract initiation fee) is shown in `buyerFees`; it never reduces the freelancer's payout.
 * Every Upwork amount is in US dollars, whatever the freelancer's country, so every market here is
 * a USD market; the market only changes the withdrawal options and the taxes.
 */
import { M } from "../markets";
import { assemble, bool, formatRate, moneyFor, num, pct, roundCents, str, toCents } from "../money";
import type { CalculatorDef, FeeChange, Inputs, Line, Market, ScheduleRow, SelectOption, Source } from "../types";

const USD = { currency: "USD", locale: "en-US" } as const;
const OTHER: Market = { id: "intl", label: "Other countries", currency: "USD", locale: "en-US", flag: "🌍" };
const MARKETS: Market[] = [M.us, { ...M.uk, ...USD }, { ...M.ca, ...USD }, { ...M.au, ...USD }, { ...M.in, ...USD }, OTHER];

const S = {
  fsf: "upwork-fsf",
  pricingFreelancer: "upwork-pricing-freelancer",
  pricingClient: "upwork-pricing-client",
  agreement: "upwork-fee-agreement",
  tenQ2026: "upwork-10q-2026q2",
  tenQ2024: "upwork-10q-2024q1",
  dc: "upwork-direct-contracts",
  plus: "upwork-freelancer-plus",
  connects: "upwork-connects",
  bonus: "upwork-bonus",
  usBank: "upwork-us-bank",
  localBank: "upwork-local-bank",
  wire: "upwork-wire",
  getPaid: "upwork-get-paid",
  instant: "upwork-instant-pay",
  paypal: "upwork-paypal",
  payoneer: "upwork-payoneer",
  wallet: "upwork-wallet",
  cmf: "upwork-client-marketplace-fee",
  cif: "upwork-contract-initiation-fee",
  bplus: "upwork-business-plus-fees",
  bplusPromo: "upwork-business-plus-promo",
  cidc: "upwork-client-direct-contracts",
  vatUk: "upwork-vat-uk",
  gstAu: "upwork-gst-au",
  gstIn: "upwork-gst-in",
  tdsIn: "upwork-tds-in",
  taxCa: "upwork-tax-ca",
  vatEu: "upwork-vat-eu",
} as const;

const help = (id: string, title: string, sourceId: string): Source => ({
  id: sourceId,
  title,
  url: `https://support.upwork.com/hc/en-us/articles/${id}`,
  publisher: "Upwork Help Center",
  checked: "2026-10-23",
  watch: `https://support.upwork.com/api/v2/help_center/en-us/articles/${id}.json`,
});

const sources: Source[] = [
  help("211062538", "Learn about the Freelancer Service Fee", S.fsf),
  { id: S.pricingFreelancer, title: "Upwork Pricing: Plans and Fees for Freelancers", url: "https://www.upwork.com/pricing/freelancer", publisher: "Upwork", checked: "2026-10-23" },
  { id: S.pricingClient, title: "Upwork Pricing: Plans and Fees for Clients", url: "https://www.upwork.com/pricing/client", publisher: "Upwork", checked: "2026-10-23" },
  { id: S.agreement, title: "Fee and ACH Authorization Agreement", url: "https://www.upwork.com/legal#fees", publisher: "Upwork", checked: "2026-10-23" },
  {
    id: S.tenQ2026,
    title: "Upwork Inc. Form 10-Q, quarter ended June 30, 2026",
    url: "https://www.sec.gov/Archives/edgar/data/1627475/000162747526000047/upwk-20260630.htm",
    publisher: "Upwork Inc. (SEC filing)",
    checked: "2026-10-23",
  },
  {
    id: S.tenQ2024,
    title: "Upwork Inc. Form 10-Q, quarter ended March 31, 2024",
    url: "https://www.sec.gov/Archives/edgar/data/1627475/000162747524000022/upwk-20240331.htm",
    publisher: "Upwork Inc. (SEC filing)",
    checked: "2026-10-23",
  },
  help("360025040794", "Direct Contracts (bring a client to Upwork)", S.dc),
  help("211062888", "What is Freelancer Plus?", S.plus),
  help("211062898", "Understanding and using Connects", S.connects),
  help("41471537743251", "How bonus, expense, and misc. payments work", S.bonus),
  help("227022468", "Direct to U.S. Bank: timing and fees explained", S.usBank),
  help("211060578", "What are the fees, limits, and timing of Direct to Local Bank payments?", S.localBank),
  help("211063898", "How do wire transfers work on Upwork?", S.wire),
  help("211060918", "How to get paid on Upwork", S.getPaid),
  help("360033794994", "How to set up Instant Pay for fast withdrawals", S.instant),
  help("211063978", "What are the PayPal fees and timing for withdrawals?", S.paypal),
  help("211064008", "How quickly Payoneer pays and what fees apply", S.payoneer),
  help("115001615787", "What are the fees and timing of Direct to Wallet payments?", S.wallet),
  help("4660220468499", "What is the Client Marketplace Fee?", S.cmf),
  help("26106318334611", "What is the Contract Initiation Fee on Upwork?", S.cif),
  help("30915724346387", "How Business Plus plan fees work on Upwork", S.bplus),
  help("50793925943699", "Try Upwork's Business Plus plan: Promo terms and conditions", S.bplusPromo),
  help("40649332431891", "Send a direct contract to a freelancer", S.cidc),
  help("31397998954259", "How VAT works for freelancers in the United Kingdom", S.vatUk),
  help("115008309168", "How GST works for freelancers in Australia", S.gstAu),
  help("360041114713", "How India GST works for freelancers", S.gstIn),
  help("360044709894", "How India's Tax Deducted at Source (TDS) works on Upwork", S.tdsIn),
  help("4401838411283", "How indirect taxes work for freelancers in Canada", S.taxCa),
  help("31396875091219", "How VAT works for freelancers in the European Union", S.vatEu),
];

const changes: FeeChange[] = [
  {
    date: "2026-09-01",
    text: "Direct to U.S. Bank withdrawals now cost $2.99 each for freelancers whose tax address is outside the US (they were free). They stay free with a US tax address.",
    source: S.usBank,
  },
  {
    date: "2026-04-07",
    text: "Upwork’s help center now describes the Basic-plan client marketplace fee as “up to 7.99%” (it had been 5%, or 3% by US bank account). Some client accounts pay a flat 7.99% whatever the payment method; the pricing page still shows 5%.",
    source: S.cmf,
  },
  {
    date: "2025-05-01",
    text: "From May 2025, new contracts pay a variable freelancer service fee of 0% to 15%, set per contract and fixed for its life (it had been a flat 10%). Contracts formed before May 2025 keep 10%.",
    source: S.tenQ2026,
  },
  {
    date: "2024-02-08",
    text: "Clients started paying a one-time contract initiation fee on each new contract (now $0.99 to $14.99).",
    source: S.cif,
  },
  {
    date: "2023-05-01",
    text: "The tiered freelancer service fee (20% / 10% / 5%) was replaced by a flat 10% for new contracts.",
    source: S.tenQ2024,
  },
];

/* ------------------------------------------------------------------ contracts */

type ContractKind = "variable" | "legacy" | "dc" | "enterprise" | "zero";

const CONTRACTS: SelectOption[] = [
  { value: "variable", label: "Upwork job, started May 2025 or later", hint: "0%–15%, shown on your offer" },
  { value: "legacy", label: "Upwork job, started before May 2025", hint: "10%" },
  { value: "dc", label: "Direct Contract with a client I brought", hint: "5%, or 0% with Freelancer Plus" },
  { value: "enterprise", label: "Enterprise client", hint: "usually 10%" },
  { value: "zero", label: "Any Hire, Upwork Payroll or a Direct Contract the client sent", hint: "0%" },
];

function contractKind(inputs: Inputs): ContractKind {
  const v = str(inputs, "contract", "variable");
  return (CONTRACTS.some((c) => c.value === v) ? v : "variable") as ContractKind;
}

/** The service-fee rate (percent) and whether a typed rate had to be clamped to Upwork's 0–15% range. */
function serviceRate(inputs: Inputs): { rate: number; clamped: boolean } {
  switch (contractKind(inputs)) {
    case "legacy":
    case "enterprise":
      return { rate: 10, clamped: false };
    case "dc":
      return { rate: bool(inputs, "plus") ? 0 : 5, clamped: false };
    case "zero":
      return { rate: 0, clamped: false };
    default: {
      const typed = num(inputs, "feeRate", 10);
      const rate = Math.min(15, Math.max(0, typed));
      return { rate, clamped: rate !== typed };
    }
  }
}

function serviceExplain(kind: ContractKind, plus: boolean): string {
  const base = "Charged on everything you bill this client (hourly invoices, milestones, bonuses and expense reimbursements), per payment, rounded to the cent. If the client is refunded, Upwork gives you back the fee on the refunded amount.";
  switch (kind) {
    case "legacy":
      return `Contracts formed before May 2025 keep Upwork’s flat 10% fee. ${base}`;
    case "dc":
      return plus
        ? "Direct Contracts you start for a client who is new to Upwork cost 0% while your Freelancer Plus membership is active (5% again from the day it ends, with no back-charge)."
        : `Direct Contracts you start from the Direct Contracts page, for a client who is new to Upwork, cost a flat 5%. Freelancer Plus members pay 0%. ${base}`;
    case "enterprise":
      return "Upwork says freelancers working with Enterprise clients typically pay 10%, but the exact rate depends on the terms that client agreed with Upwork. Check your contract details.";
    case "zero":
      return "Upwork charges no freelancer service fee on Any Hire contracts, Upwork Payroll, or Direct Contracts that the client sends you. The client pays Upwork instead.";
    default:
      return `Since May 2025 Upwork sets a rate between 0% and 15% for each new contract, based on things like client demand, freelancer supply and the job category. You see it on the offer or next to your proposal, and it doesn’t change for the life of the contract. ${base}`;
  }
}

/* ------------------------------------------------------------------ withdrawals */

interface Withdrawal {
  value: string;
  label: string;
  hint: string;
  /** Upwork's fee per withdrawal in cents; null when Upwork doesn't publish it (the user types it). */
  fee: number | null;
  /** Largest amount one transfer can move, cents. */
  maxPerTransfer?: number;
  explain: string;
  source?: string;
}

const W_NONE: Withdrawal = { value: "none", label: "Not withdrawing yet", hint: "no fee", fee: 0, explain: "" };
const W_OTHER = (us: boolean): Withdrawal => ({
  value: "other",
  label: us ? "PayPal" : "PayPal, Payoneer or a mobile wallet",
  hint: "fee shown in your settings",
  fee: null,
  explain: `Upwork charges “a small fee per transfer” to ${us ? "PayPal" : "PayPal, Payoneer and mobile wallets"} but doesn’t publish the amount; it’s listed under Settings › Withdrawals › Add a method. ${us ? "PayPal" : "The provider"} may charge its own fees on top.`,
  source: us ? S.paypal : S.payoneer,
});

const WITHDRAW_US: Withdrawal[] = [
  {
    value: "usbank",
    label: "Direct to U.S. Bank",
    hint: "free",
    fee: 0,
    explain: "Free for freelancers with a US tax address. Arrives in 2–5 business days.",
    source: S.usBank,
  },
  {
    value: "instant",
    label: "Instant Pay to a debit card",
    hint: "$2.00 per transfer",
    fee: 200,
    maxPerTransfer: 299900,
    explain: "$2.00 per transfer to an eligible Visa or Mastercard debit card, usually within minutes. US freelancers only, at most $2,999 per transfer.",
    source: S.getPaid,
  },
  W_OTHER(true),
  W_NONE,
];

const WITHDRAW_INTL: Withdrawal[] = [
  {
    value: "local",
    label: "Direct to Local Bank",
    hint: "$0.99 per withdrawal",
    fee: 99,
    explain: "$0.99 per withdrawal to a bank in your country, plus any incoming-payment fee your bank charges. Paid out in your currency at Upwork’s exchange rate.",
    source: S.localBank,
  },
  {
    value: "usbank",
    label: "Direct to U.S. Bank",
    hint: "$2.99 per withdrawal",
    fee: 299,
    explain: "$2.99 per withdrawal since September 1, 2026 when your tax address is outside the US (free with a US tax address).",
    source: S.usBank,
  },
  {
    value: "wire",
    label: "U.S. dollar wire transfer",
    hint: "$50 per wire",
    fee: 5000,
    explain: "$50 for each US-dollar wire. Your bank, and any intermediary bank, may take their own fees, and converting to another currency costs a spread.",
    source: S.wire,
  },
  W_OTHER(false),
  W_NONE,
];

function withdrawals(market: Market): Withdrawal[] {
  return market.id === "us" ? WITHDRAW_US : WITHDRAW_INTL;
}

function withdrawal(inputs: Inputs, market: Market): Withdrawal {
  const list = withdrawals(market);
  return list.find((w) => w.value === str(inputs, "withdraw")) ?? list[0];
}

/* ------------------------------------------------------------------ taxes on Upwork's fees */

interface TaxPart {
  id: string;
  name: string;
  rate: number;
  /** Still charged after a GST/HST/QST number is on file (PST in BC, SK, MB). */
  always?: boolean;
}

interface FeeTax {
  parts: (inputs: Inputs) => TaxPart[];
  explain: string;
  source: string;
}

/** Canada: Upwork's own province table (help article 4401838411283, edited 2025-11-13). */
const PROVINCES: { value: string; label: string; parts: TaxPart[] }[] = [
  { value: "AB", label: "Alberta", parts: [{ id: "gst", name: "GST", rate: 5 }] },
  { value: "BC", label: "British Columbia", parts: [{ id: "gst", name: "GST", rate: 5 }, { id: "pst", name: "PST", rate: 7, always: true }] },
  { value: "MB", label: "Manitoba", parts: [{ id: "gst", name: "GST", rate: 5 }, { id: "pst", name: "PST", rate: 7, always: true }] },
  { value: "NB", label: "New Brunswick", parts: [{ id: "hst", name: "HST", rate: 15 }] },
  { value: "NL", label: "Newfoundland and Labrador", parts: [{ id: "hst", name: "HST", rate: 15 }] },
  { value: "NT", label: "Northwest Territories", parts: [{ id: "gst", name: "GST", rate: 5 }] },
  // Upwork's table still lists 15% for Nova Scotia (the province cut its HST to 14% on 2025-04-01).
  { value: "NS", label: "Nova Scotia", parts: [{ id: "hst", name: "HST", rate: 15 }] },
  { value: "NU", label: "Nunavut", parts: [{ id: "gst", name: "GST", rate: 5 }] },
  { value: "ON", label: "Ontario", parts: [{ id: "hst", name: "HST", rate: 13 }] },
  { value: "PE", label: "Prince Edward Island", parts: [{ id: "hst", name: "HST", rate: 15 }] },
  { value: "QC", label: "Quebec", parts: [{ id: "gst", name: "GST", rate: 5 }, { id: "qst", name: "QST", rate: 9.975 }] },
  { value: "SK", label: "Saskatchewan", parts: [{ id: "gst", name: "GST", rate: 5 }, { id: "pst", name: "PST", rate: 6, always: true }] },
  { value: "YT", label: "Yukon", parts: [{ id: "gst", name: "GST", rate: 5 }] },
];

function province(inputs: Inputs) {
  return PROVINCES.find((p) => p.value === str(inputs, "province", "ON")) ?? PROVINCES.find((p) => p.value === "ON")!;
}

const FEE_TAX: Record<string, FeeTax> = {
  uk: {
    parts: () => [{ id: "vat", name: "VAT", rate: 20 }],
    explain: "UK VAT at 20% on Upwork’s fees (the service fee, Connects and membership), unless you’ve added a valid VAT number. Upwork can’t refund VAT it collected before you added one.",
    source: S.vatUk,
  },
  au: {
    parts: () => [{ id: "gst", name: "GST", rate: 10 }],
    explain: "Australian GST at 10% on Upwork’s fees (the service fee, Connects and membership). Upwork collects it unless you’ve added an ABN and confirmed you’re registered for GST.",
    source: S.gstAu,
  },
  in: {
    parts: () => [{ id: "gst", name: "GST", rate: 18 }],
    explain: "India GST at 18% on Upwork’s fees (the service fee, Connects and membership), unless you’ve added a valid GSTIN. It’s charged on Upwork’s fees, not on your earnings.",
    source: S.gstIn,
  },
  ca: {
    parts: (inputs) => province(inputs).parts,
    explain: "Canadian sales tax on Upwork’s fees (the service fee, Connects and membership) at your province’s rate. A GST/HST or QST number stops those taxes; PST in BC, Manitoba and Saskatchewan is charged regardless.",
    source: S.taxCa,
  },
};

/** Tax parts that apply, after the "I have a number" toggle. "Other countries" uses the typed rate. */
function feeTaxParts(inputs: Inputs, market: Market): TaxPart[] {
  if (market.id === OTHER.id) {
    const rate = Math.min(50, Math.max(0, num(inputs, "otherTax")));
    return rate ? [{ id: "vat", name: "VAT/GST", rate }] : [];
  }
  const t = FEE_TAX[market.id];
  if (!t) return [];
  const charged = bool(inputs, "taxOnFees");
  return t.parts(inputs).filter((p) => charged || p.always);
}

/* ------------------------------------------------------------------ client side */

interface ClientPlan {
  value: string;
  label: string;
  hint: string;
  rate: number;
  name: string;
  businessPlus: boolean;
  explain: string;
  source: string;
}

const CLIENT_PLANS: ClientPlan[] = [
  {
    value: "basic5",
    label: "Basic plan, card or PayPal",
    hint: "5%",
    rate: 5,
    name: "Marketplace fee",
    businessPlus: false,
    explain: "Clients on the free Basic plan pay a 5% marketplace fee on top of every payment to you. It isn’t taken from your earnings and isn’t refunded to the client.",
    source: S.pricingClient,
  },
  {
    value: "basic3",
    label: "Basic plan, US bank account",
    hint: "3%",
    rate: 3,
    name: "Marketplace fee",
    businessPlus: false,
    explain: "Eligible US clients paying from a US bank account (ACH) pay 3% instead of 5%. They need US billing, US$1,000 spent on Upwork in the past 12 months and an on-time payment record.",
    source: S.pricingClient,
  },
  {
    value: "flat799",
    label: "Basic plan, flat-fee account",
    hint: "7.99%",
    rate: 7.99,
    name: "Marketplace fee",
    businessPlus: false,
    explain: "Upwork’s help center describes the Basic fee as “up to 7.99%”; client accounts on its flat structure pay 7.99% whatever the payment method. The client sees which applies at checkout.",
    source: S.bplusPromo,
  },
  {
    value: "bplus10",
    label: "Business Plus",
    hint: "10%",
    rate: 10,
    name: "Business Plus fee",
    businessPlus: true,
    explain: "Business Plus clients pay up to 10% on top of every payment to you instead of the marketplace fee.",
    source: S.bplus,
  },
  {
    value: "bplus8",
    label: "Business Plus, US checking account",
    hint: "8%",
    rate: 8,
    name: "Business Plus fee",
    businessPlus: true,
    explain: "Eligible US Business Plus clients paying from a checking account pay 8% instead of 10%.",
    source: S.bplus,
  },
];

function clientPlan(inputs: Inputs): ClientPlan {
  return CLIENT_PLANS.find((p) => p.value === str(inputs, "clientPlan")) ?? CLIENT_PLANS[0];
}

/* ------------------------------------------------------------------ calculation */

const CONNECT_PRICE = 15; // cents

interface Amounts {
  gross: number;
  hourly: boolean;
  hours: number;
  rateCents: number;
  serviceFee: number;
  connects: number;
  connectsCost: number;
  taxes: { part: TaxPart; amount: number }[];
  tds: number;
  tdsRate: number;
  /** What reaches the Upwork balance from this payment before withdrawal (gross − service fee − taxes − TDS). */
  balance: number;
}

/** The arithmetic before the withdrawal step, without any formatting (the breakpoint search runs it thousands of times). */
function amounts(inputs: Inputs, market: Market): Amounts {
  const hourly = str(inputs, "billing", "fixed") === "hourly";
  const rateCents = toCents(num(inputs, "amount"));
  const hours = Math.max(0, num(inputs, "hours", 10));
  // Hourly invoice = hours × rate, to the cent (Upwork's example: 12 h × $22.22 = $266.64).
  const gross = hourly ? roundCents((rateCents * Math.round(hours * 100)) / 100) : rateCents;
  const serviceFee = pct(gross, serviceRate(inputs).rate);
  const connects = Math.max(0, Math.round(num(inputs, "connects")));
  const connectsCost = connects * CONNECT_PRICE;
  const taxes = feeTaxParts(inputs, market).map((part) => ({ part, amount: pct(serviceFee + connectsCost, part.rate) }));
  const tdsRate = market.id === "in" ? (bool(inputs, "panLinked") ? 0.1 : 5) : 0;
  const tds = tdsRate ? pct(gross, tdsRate) : 0;
  const balance = gross - serviceFee - taxes.reduce((s, t) => s + t.amount, 0) - tds;
  return { gross, hourly, hours, rateCents, serviceFee, connects, connectsCost, taxes, tds, tdsRate, balance };
}

/** Fee lines before the withdrawal step. */
function feeLines(a: Amounts, inputs: Inputs, market: Market): Line[] {
  const money = moneyFor(market);
  const kind = contractKind(inputs);
  const { rate } = serviceRate(inputs);
  const fees: Line[] = [];
  fees.push({
    id: "service",
    label: `Freelancer service fee (${formatRate(rate)})`,
    amount: a.serviceFee,
    kind: "platform",
    detail: a.hourly ? `${formatRate(rate)} × ${money(a.gross)} (${a.hours} h × ${money(a.rateCents)})` : `${formatRate(rate)} × ${money(a.gross)}`,
    explain: serviceExplain(kind, bool(inputs, "plus")),
    source: kind === "dc" ? S.dc : kind === "zero" ? S.agreement : kind === "legacy" ? S.tenQ2026 : S.fsf,
  });

  const t = FEE_TAX[market.id];
  for (const { part, amount } of a.taxes) {
    fees.push({
      id: `tax-${part.id}`,
      label: `${part.name} on Upwork fees (${formatRate(part.rate)})`,
      amount,
      kind: "tax",
      detail: a.connectsCost ? `${formatRate(part.rate)} × (${money(a.serviceFee)} fee + ${money(a.connectsCost)} Connects)` : `${formatRate(part.rate)} × ${money(a.serviceFee)}`,
      explain: t
        ? market.id === "ca" && part.always
          ? `${province(inputs).label} PST at ${formatRate(part.rate)} on Upwork’s fees. Upwork has to collect it even when your GST/HST number is on file.`
          : t.explain
        : "Upwork adds your country’s VAT or GST to its fees (the service fee, Connects and membership) unless you’ve given it a valid VAT/GST number.",
      source: t ? t.source : S.vatEu,
    });
  }

  if (a.tdsRate) {
    fees.push({
      id: "tds",
      label: `TDS withheld (${formatRate(a.tdsRate)})`,
      amount: a.tds,
      kind: "tax",
      detail: `${formatRate(a.tdsRate)} × ${money(a.gross)}`,
      explain:
        "Indian law makes Upwork withhold TDS from your earnings, worked out on the gross amount before the service fee: 0.1% once your PAN is verified and linked to Aadhaar, 5% otherwise. You can claim it against your income tax.",
      source: S.tdsIn,
    });
  }

  if (a.connectsCost) {
    fees.push({
      id: "connects",
      label: `Connects (${a.connects} × $0.15)`,
      amount: a.connectsCost,
      kind: "other",
      detail: `${a.connects} × ${money(CONNECT_PRICE)}`,
      explain:
        "Connects cost $0.15 each and you spend them to send proposals. They come out of your balance or card, not this payment, and aren’t refunded when the client hires someone else, so count every proposal it took to win the job.",
      source: S.connects,
    });
  }
  return fees;
}

function build(inputs: Inputs, market: Market, withNotes: boolean) {
  const money = moneyFor(market);
  const kind = contractKind(inputs);
  const service = serviceRate(inputs);
  const c = amounts(inputs, market);
  const fees = feeLines(c, inputs, market);

  const w = withdrawal(inputs, market);
  if (w.value !== "none") {
    let amount: number;
    let detail: string;
    if (w.fee === null) {
      amount = toCents(num(inputs, "withdrawOther"));
      detail = amount ? "Fee you entered from your withdrawal settings" : "Upwork doesn’t publish this fee: enter it under More options";
    } else if (w.maxPerTransfer && c.balance > w.maxPerTransfer) {
      const transfers = Math.ceil(c.balance / w.maxPerTransfer);
      amount = w.fee * transfers;
      detail = `${transfers} transfers × ${money(w.fee)} (max ${money(w.maxPerTransfer)} each)`;
    } else {
      amount = w.fee;
      detail = w.fee ? `${money(w.fee)} per withdrawal` : "Free";
    }
    fees.push({
      id: "withdrawal",
      label: `Withdrawal: ${w.label}`,
      amount,
      kind: "payout",
      detail,
      explain: `${w.explain} The fee is per withdrawal, not per payment: withdrawing several payments at once costs it once.`,
      source: w.source,
    });
  }

  // Client side: what the client pays on top. Not deducted from the freelancer.
  const buyerFees: Line[] = [];
  const clientPays = kind !== "enterprise" && kind !== "zero";
  const plan = clientPlan(inputs);
  if (clientPays) {
    buyerFees.push({
      id: "client-fee",
      label: `Client’s ${plan.name.toLowerCase()} (${formatRate(plan.rate)})`,
      amount: pct(c.gross, plan.rate),
      kind: "platform",
      detail: `${formatRate(plan.rate)} × ${money(c.gross)}`,
      explain: plan.explain,
      source: plan.source,
    });
    const cif = toCents(num(inputs, "cif"));
    if (cif) {
      buyerFees.push({
        id: "client-cif",
        label: "Client’s contract initiation fee (one-time)",
        amount: cif,
        kind: "platform",
        detail: "Amount you entered",
        explain:
          "A one-time fee the client pays on the first payment of each new contract: $0.99 to $14.99 on the Basic plan depending on contract type, account history and hiring activity; on Business Plus only fixed-price contracts of $100 or less, up to $4.99.",
        source: S.cif,
      });
    }
  }
  const buyerPays = c.gross + buyerFees.reduce((s, l) => s + l.amount, 0);

  const notes: string[] = [];
  const warnings: string[] = [];
  if (withNotes) {
    if (kind === "variable" && c.gross > 0) {
      const at15 = build({ ...inputs, feeRate: 15 }, market, false).payout;
      const at0 = build({ ...inputs, feeRate: 0 }, market, false).payout;
      notes.push(
        `Upwork only says a new contract’s fee is between 0% and 15%; we’ve used ${formatRate(service.rate)}. On ${money(c.gross)} you’d receive ${money(at15)} at 15% or ${money(at0)} at 0%, so enter the rate shown on your offer.`,
      );
    }
    if (clientPays && !toCents(num(inputs, "cif"))) {
      const cifText = plan.businessPlus
        ? c.hourly
          ? "Business Plus clients pay no contract initiation fee on hourly contracts."
          : "On a new fixed-price contract of $100 or less they also pay a one-time contract initiation fee of up to $4.99."
        : "On a new contract’s first payment they also pay a one-time contract initiation fee of $0.99 to $14.99; Upwork shows the exact amount at checkout.";
      notes.push(`Your client pays ${money(buyerPays)} (${formatRate(plan.rate)} ${plan.name.toLowerCase()} on top of your ${money(c.gross)}). ${cifText}`);
    } else if (kind === "zero") {
      notes.push("On these contracts the client pays Upwork instead of you, for example $49 a month for each active Direct Contract they send.");
    }
    if (w.fee === null && !toCents(num(inputs, "withdrawOther"))) {
      notes.push(
        `Upwork doesn’t publish its ${market.id === "us" ? "PayPal" : "PayPal, Payoneer or wallet"} withdrawal fee. Find it under Settings › Withdrawals › Add a method and enter it under More options.`,
      );
    }
    if (service.clamped) warnings.push("Upwork’s service fee is between 0% and 15%; we used the nearest of the two.");
    if (c.hourly && c.rateCents > 0 && c.rateCents < 300) warnings.push("Upwork’s minimum hourly rate is $3.00.");
    if (!c.hourly && c.gross > 0 && c.gross < 500) warnings.push("Upwork’s minimum for a fixed-price contract is $5.00.");
  }

  return assemble({ market, buyerPays, saleAmount: c.gross, fees, buyerFees, notes, warnings });
}

function calculate(inputs: Inputs, market: Market) {
  return build(inputs, market, true);
}

/**
 * Instant Pay moves at most $2,999 per transfer, so the payout drops by $2.00 each time this
 * payment's balance crosses a multiple of $2,999. Find the price (cents) at each crossing.
 */
function breakpoints(inputs: Inputs, market: Market): number[] {
  const w = withdrawal(inputs, market);
  if (!w.maxPerTransfer) return [];
  const max = w.maxPerTransfer;
  const balanceAt = (cents: number) => amounts({ ...inputs, amount: cents / 100 }, market).balance;
  const CEILING = 100_000_000; // the solver's search ceiling ($1,000,000)
  const top = balanceAt(CEILING);
  const out: number[] = [];
  // Past 1,000 transfers ($2.999M in one payment) Instant Pay is not a realistic choice; stop there.
  for (let k = 1; k <= 1000 && top > k * max; k++) {
    let lo = out.length ? out[out.length - 1] : 0;
    let hi = CEILING;
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (balanceAt(mid) > k * max) hi = mid;
      else lo = mid + 1;
    }
    out.push(lo);
  }
  return out;
}

/* ------------------------------------------------------------------ schedule */

function schedule(market: Market): ScheduleRow[] {
  const rows: ScheduleRow[] = [
    { fee: "Freelancer service fee", amount: "0%–15% per contract", appliesTo: "Everything you bill: hourly, fixed-price, bonuses, expenses", when: "Contracts formed from May 2025; rate shown on the offer", source: S.fsf },
    { fee: "Freelancer service fee", amount: "10%", appliesTo: "Everything you bill", when: "Contracts formed before May 2025", source: S.tenQ2026 },
    { fee: "Direct Contracts fee", amount: "5% (0% with Freelancer Plus)", appliesTo: "Everything you bill that client", when: "Clients you bring to Upwork", source: S.dc },
    { fee: "Enterprise contracts", amount: "Usually 10%", appliesTo: "Everything you bill", when: "Clients with an Enterprise badge", source: S.fsf },
    { fee: "Any Hire, Payroll, client-sent Direct Contracts", amount: "0%", appliesTo: "—", when: "The client pays Upwork instead", source: S.agreement },
    { fee: "Connects", amount: "$0.15 each", appliesTo: "Proposals, boosts, Availability Badge", when: "Each job you apply to (number varies by job)", source: S.connects },
    { fee: "Freelancer Plus", amount: "$19.99/month", appliesTo: "Membership (includes 100 Connects a month)", when: "Optional", source: S.pricingFreelancer },
  ];
  if (market.id === "in") {
    rows.push({ fee: "TDS withheld", amount: "0.1% (5% without linked PAN)", appliesTo: "Gross earnings, before the service fee", when: "Freelancers in India", source: S.tdsIn });
  }
  const t = FEE_TAX[market.id];
  if (market.id === "ca") {
    rows.push({ fee: "GST/HST/QST/PST on fees", amount: "5%–15% by province", appliesTo: "Service fee, Connects, membership", when: "No GST/HST or QST number (PST in BC, MB, SK always)", source: S.taxCa });
  } else if (t) {
    const p = t.parts({})[0];
    rows.push({ fee: `${p.name} on fees`, amount: formatRate(p.rate), appliesTo: "Service fee, Connects, membership", when: market.id === "au" ? "No ABN registered for GST" : `No ${p.name === "VAT" ? "VAT number" : "GSTIN"} on file`, source: t.source });
  } else if (market.id === OTHER.id) {
    rows.push({ fee: "VAT/GST on fees", amount: "Your country’s rate", appliesTo: "Service fee, Connects, membership", when: "Where your country requires it and no VAT/GST number is on file", source: S.vatEu });
  }
  for (const w of withdrawals(market)) {
    if (w.value === "none") continue;
    rows.push({
      fee: `Withdrawal: ${w.label}`,
      amount: w.fee === null ? "Not published (“a small fee”)" : w.fee === 0 ? "Free" : w.value === "instant" ? "$2.00 (max $2,999 each)" : moneyFor(market)(w.fee),
      appliesTo: "Each withdrawal",
      when: w.value === "usbank" ? (market.id === "us" ? "US tax address" : "Tax address outside the US, since Sep 1, 2026") : undefined,
      source: w.source,
    });
  }
  rows.push(
    { fee: "Client marketplace fee", amount: "5% (3% by US bank; up to 7.99%)", appliesTo: "Paid by the client on top of each payment", when: "Basic plan", source: S.cmf },
    { fee: "Client Business Plus fee", amount: "10% (8% by US checking)", appliesTo: "Paid by the client on top of each payment", when: "Business Plus plan", source: S.bplus },
    { fee: "Contract initiation fee", amount: "$0.99–$14.99", appliesTo: "Paid by the client, once per new contract", when: "Business Plus: up to $4.99, fixed-price ≤ $100 only", source: S.cif },
  );
  return rows;
}

/* ------------------------------------------------------------------ definition */

export const upwork: CalculatorDef = {
  slug: "upwork",
  name: "Upwork",
  path: "/upwork-fee-calculator",
  category: "freelance",
  priceNoun: "contract amount",
  sellerNoun: "freelancer",
  blurb: "0%–15% service fee per contract (10% before May 2025) + withdrawal fee; clients pay 5% on top",
  markets: MARKETS,
  defaultMarket: "us",
  priceField: "amount",
  fields: [
    {
      id: "amount",
      kind: "money",
      label: "What you bill the client",
      section: "sale",
      help: "Fixed price: the milestone or contract amount. Hourly: your hourly rate.",
    },
    {
      id: "billing",
      kind: "segmented",
      label: "How are you paid?",
      section: "sale",
      options: [
        { value: "fixed", label: "Fixed price" },
        { value: "hourly", label: "Hourly" },
      ],
    },
    {
      id: "hours",
      kind: "number",
      label: "Hours billed",
      section: "sale",
      unit: "h",
      min: 0,
      max: 744,
      step: 0.5,
      help: "Upwork bills hourly work weekly. Enter a week’s hours, or a month’s for a monthly total.",
      showIf: (i) => str(i, "billing", "fixed") === "hourly",
    },
    {
      id: "contract",
      kind: "select",
      label: "What kind of contract is it?",
      section: "sale",
      options: CONTRACTS,
      help: "The service fee depends on the contract, not on you: Upwork shows it on every offer and proposal.",
    },
    {
      id: "feeRate",
      kind: "percent",
      label: "Service fee on this contract",
      section: "sale",
      min: 0,
      max: 15,
      step: 0.5,
      help: "Between 0% and 15%. Copy it from the offer, your proposal or the contract details.",
      showIf: (i) => contractKind(i) === "variable",
    },
    {
      id: "plus",
      kind: "toggle",
      label: "I have Freelancer Plus ($19.99/month)",
      section: "sale",
      help: "Members pay 0% instead of 5% on Direct Contracts.",
      showIf: (i) => contractKind(i) === "dc",
    },
    {
      id: "withdraw",
      kind: "select",
      label: "How do you withdraw?",
      section: "options",
      options: (_i, m) => withdrawals(m).map((w) => ({ value: w.value, label: w.label, hint: w.hint })),
      help: "Upwork charges per withdrawal, so moving several payments at once costs the fee once.",
    },
    {
      id: "withdrawOther",
      kind: "money",
      label: "Withdrawal fee shown in your settings",
      section: "options",
      advanced: true,
      help: "Settings › Withdrawals › Add a method lists Upwork’s fee for each method.",
      showIf: (i, m) => withdrawal(i, m).fee === null,
    },
    {
      id: "province",
      kind: "select",
      label: "Province or territory",
      section: "options",
      options: PROVINCES.map((p) => ({ value: p.value, label: p.label, hint: p.parts.map((x) => `${x.name} ${formatRate(x.rate)}`).join(" + ") })),
      help: "Sets the sales tax Upwork adds to its fees.",
      showIf: (_i, m) => m.id === "ca",
    },
    {
      id: "taxOnFees",
      kind: "toggle",
      label: "Upwork adds tax to my fees (no VAT/GST number on file)",
      section: "options",
      help: "UK 20% VAT, Australia 10% GST, India 18% GST, Canada by province. Off if you’ve given Upwork a valid number.",
      showIf: (_i, m) => Boolean(FEE_TAX[m.id]),
    },
    {
      id: "panLinked",
      kind: "toggle",
      label: "My PAN is verified and linked to Aadhaar",
      section: "options",
      help: "Upwork withholds 0.1% TDS with a linked PAN, 5% without.",
      showIf: (_i, m) => m.id === "in",
    },
    {
      id: "otherTax",
      kind: "percent",
      label: "VAT/GST Upwork adds to its fees",
      section: "options",
      max: 30,
      help: "Many countries’ VAT or GST applies (in the EU, your country’s rate) unless you’ve given Upwork a valid VAT/GST number.",
      showIf: (_i, m) => m.id === OTHER.id,
    },
    {
      id: "connects",
      kind: "number",
      label: "Connects spent to win this job",
      section: "options",
      advanced: true,
      integer: true,
      min: 0,
      max: 5000,
      unit: "Connects",
      help: "$0.15 each. Count the proposals that didn’t win too: Connects aren’t refunded when the client picks someone else.",
    },
    {
      id: "clientPlan",
      kind: "select",
      label: "Client’s plan (what they pay on top)",
      section: "options",
      advanced: true,
      options: CLIENT_PLANS.map((p) => ({ value: p.value, label: p.label, hint: p.hint })),
      help: "Client fees don’t come out of your pay, but they raise what the job costs the client.",
      showIf: (i) => contractKind(i) !== "enterprise" && contractKind(i) !== "zero",
    },
    {
      id: "cif",
      kind: "money",
      label: "Client’s contract initiation fee",
      section: "options",
      advanced: true,
      max: 14.99,
      help: "One-time, $0.99–$14.99 on a new contract’s first payment. Leave at 0 for later payments.",
      showIf: (i) => contractKind(i) !== "enterprise" && contractKind(i) !== "zero",
    },
  ],
  defaults: (market) => ({
    amount: 500,
    billing: "fixed",
    hours: 10,
    contract: "variable",
    feeRate: 10,
    plus: false,
    withdraw: market.id === "us" ? "usbank" : "local",
    withdrawOther: 0,
    province: "ON",
    taxOnFees: Boolean(FEE_TAX[market.id]),
    panLinked: true,
    otherTax: 0,
    connects: 0,
    clientPlan: "basic5",
    cif: 0,
  }),
  calculate,
  breakpoints,
  verifiedAt: "2026-10-23",
  sources,
  changes,
  schedule,
};

export default upwork;
