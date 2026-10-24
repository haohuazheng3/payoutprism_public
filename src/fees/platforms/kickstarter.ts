/*
 * Kickstarter fees for creators. Every number is from Kickstarter's own pages (see `sources`),
 * re-checked against the live pages on 2026-10-23: the per-country fee page
 * (kickstarter.com/help/fees?country=XX, all 25 countries read in a browser because the page blocks
 * plain HTTP), the Terms of Use (effective 2025-02-11), the Pledge Manager Program Terms (effective
 * 2025-05-08) and the Help Center. Research notes with verbatim quotes: research/fees/kickstarter.md.
 *
 * How a successful campaign's fees are computed (what this module reproduces):
 *  - Kickstarter fee: 5% "of total funds raised", i.e. every pledge actually collected (reward,
 *    add-ons, bonus support and shipping charged at pledge). Only when the goal is reached; pledges
 *    that fail to collect (dropped) are neither paid nor charged.
 *  - Payment processing (Stripe), "per pledge", by the project's country/currency: a percentage plus
 *    a fixed fee on every pledge; pledges under a micropledge limit ($10, £10, €10, 100 DKK/NOK/SEK,
 *    30 PLN, MX$100) pay 5% plus a smaller fixed fee instead. Japan: 4.5% with no fixed fee.
 *    We don't know each pledge, so pledges are modeled as two groups (the micropledges the
 *    creator tells us about, and everyone else), each priced at its average. A group whose average
 *    is under the limit is charged the micropledge rate.
 *  - Pledge Over Time: no extra fee, but "fees are applied per charge" (Terms of Use), so each
 *    such pledge pays the fixed fee three times. The percentage is unchanged. The minimum pledge
 *    (US$125 etc.) keeps every installment above the micropledge limit.
 *  - Kickstarter's Pledge Manager: 5% on new money (Pledge Manager-only add-ons, shipping, upgrades),
 *    not on tax; processing on the whole payment including tax, with the fixed fee per payment.
 *    Tax Kickstarter collects is remitted by Kickstarter and never reaches the creator.
 *  - Rounding: not documented. Kickstarter's payout summary shows the fees as totals, so each line
 *    is rounded once (half away from zero) to the cent, or to the whole yen in Japan (where typed
 *    amounts are also taken as whole yen). Per-pledge rounding can differ by a few cents over many
 *    pledges.
 */
import { M } from "../markets";
import { assemble, formatMoney, formatRate, moneyFor, num, roundCents, str, toCents } from "../money";
import type { CalculatorDef, FeeChange, Inputs, Line, Market, ScheduleRow, Source } from "../types";

/** Projects from the eurozone countries on Kickstarter's list, and euro projects from CH/DK/NO/SE/PL. */
const EU: Market = { ...M.ie, id: "eu", label: "Euro countries (€)", flag: "🇪🇺" };
const JP: Market = { id: "jp", label: "Japan", currency: "JPY", locale: "en-JP", flag: "🇯🇵" };

const MARKETS: Market[] = [M.us, M.uk, EU, M.ca, M.au, M.nz, M.ch, M.dk, M.no, M.se, M.pl, M.mx, JP];

/** Markets whose creators may run the project in euros instead (Euro Currency Flexibility). */
const EURO_OPTION = new Set(["ch", "dk", "no", "se", "pl"]);

interface Rule {
  /** Processing percentage on pledges at or above the micropledge limit. */
  rate: number;
  /** Fixed processing fee per pledge, cents of the project currency. */
  fixed: number;
  /** Pledges strictly under `under` (cents) pay `rate` % + `fixed` instead. Absent in Japan. */
  micro?: { under: number; rate: number; fixed: number };
  /** Pledge Over Time minimum pledge, cents (Pledge Over Time FAQ). */
  potMin: number;
  /** Japan: amounts are whole yen. */
  wholeUnits?: boolean;
  /** Typical-case defaults in this currency (decimal amounts as typed). */
  d: { raised: number; small: number; pm: number };
}

/** Kickstarter fee page, per country (read 2026-10-23). */
const RULES: Record<string, Rule> = {
  us: { rate: 3, fixed: 30, micro: { under: 1000, rate: 5, fixed: 8 }, potMin: 12500, d: { raised: 10000, small: 5, pm: 2000 } },
  uk: { rate: 3, fixed: 30, micro: { under: 1000, rate: 5, fixed: 8 }, potMin: 10000, d: { raised: 10000, small: 5, pm: 2000 } },
  eu: { rate: 3, fixed: 30, micro: { under: 1000, rate: 5, fixed: 8 }, potMin: 12500, d: { raised: 10000, small: 5, pm: 2000 } },
  ca: { rate: 3, fixed: 40, micro: { under: 1000, rate: 5, fixed: 10 }, potMin: 17500, d: { raised: 10000, small: 5, pm: 2000 } },
  au: { rate: 3, fixed: 45, micro: { under: 1000, rate: 5, fixed: 12 }, potMin: 20000, d: { raised: 10000, small: 5, pm: 2000 } },
  nz: { rate: 3, fixed: 50, micro: { under: 1000, rate: 5, fixed: 12 }, potMin: 20000, d: { raised: 10000, small: 5, pm: 2000 } },
  ch: { rate: 3, fixed: 30, micro: { under: 1000, rate: 5, fixed: 8 }, potMin: 10000, d: { raised: 10000, small: 5, pm: 2000 } },
  dk: { rate: 3, fixed: 350, micro: { under: 10000, rate: 5, fixed: 150 }, potMin: 85000, d: { raised: 75000, small: 50, pm: 15000 } },
  no: { rate: 3, fixed: 350, micro: { under: 10000, rate: 5, fixed: 150 }, potMin: 130000, d: { raised: 100000, small: 50, pm: 20000 } },
  se: { rate: 3, fixed: 350, micro: { under: 10000, rate: 5, fixed: 150 }, potMin: 120000, d: { raised: 100000, small: 50, pm: 20000 } },
  pl: { rate: 3, fixed: 120, micro: { under: 3000, rate: 5, fixed: 40 }, potMin: 45000, d: { raised: 40000, small: 15, pm: 8000 } },
  mx: { rate: 4, fixed: 650, micro: { under: 10000, rate: 5, fixed: 350 }, potMin: 250000, d: { raised: 200000, small: 50, pm: 40000 } },
  jp: { rate: 4.5, fixed: 0, potMin: 1850000, wholeUnits: true, d: { raised: 800000, small: 0, pm: 200000 } },
};

const DEFAULT_BACKERS = 200;

const S = {
  fees: "ks-fees",
  hcFees: "ks-hc-fees",
  terms: "ks-terms",
  pmTerms: "ks-pm-terms",
  late: "ks-late-pledges",
  latePayout: "ks-late-payout",
  pot: "ks-pot-faq",
  potLaunch: "ks-pot-launch",
  pmLaunch: "ks-pm-launch",
  refund: "ks-refunds",
  drop: "ks-dropped",
  lower: "ks-final-amount",
  euro: "ks-euro",
  payout: "ks-payout",
  tax: "ks-pm-tax",
  goal: "ks-goal",
} as const;

const LEGAL_JSON = "https://legal.kickstarter.com/static/legal.kickstarter.com/privacyCenterPolicies-en.json";

const sources: Source[] = [
  // The fee page answers plain HTTP with a Cloudflare challenge (403) and has no machine-readable twin.
  // Its heading is "Fees"; the document title names the visitor's country ("Fees: United States").
  { id: S.fees, title: "Fees", url: "https://www.kickstarter.com/help/fees", publisher: "Kickstarter", checked: "2026-10-23" },
  { id: S.hcFees, title: "What are the fees?", url: "https://help.kickstarter.com/en-us/articles/16236674-what-are-the-fees", publisher: "Kickstarter Help Center", checked: "2026-10-23" },
  { id: S.terms, title: "Terms of Use", url: "https://legal.kickstarter.com/policies/en/?name=terms-of-use", publisher: "Kickstarter", checked: "2026-10-23", watch: LEGAL_JSON },
  { id: S.pmTerms, title: "Pledge Manager Program Terms", url: "https://legal.kickstarter.com/policies/en/?name=pledge-manager-program-terms", publisher: "Kickstarter", checked: "2026-10-23", watch: LEGAL_JSON },
  { id: S.late, title: "How do I add Late Pledges to my project?", url: "https://help.kickstarter.com/en-us/articles/16236699-how-do-i-add-late-pledges-to-my-project", publisher: "Kickstarter Help Center", checked: "2026-10-23" },
  {
    id: S.latePayout,
    title: "How will I be paid out for Late Pledges?",
    url: "https://help.kickstarter.com/en-us/articles/16236668-how-will-i-be-paid-out-for-late-pledges",
    publisher: "Kickstarter Help Center",
    checked: "2026-10-23",
  },
  { id: S.pot, title: "Pledge Over Time FAQ", url: "https://help.kickstarter.com/en-us/articles/16236386-pledge-over-time-faq", publisher: "Kickstarter Help Center", checked: "2026-10-23" },
  { id: S.potLaunch, title: "Introducing Pledge Over Time — Now Available to all Creators", url: "https://updates.kickstarter.com/introducing-pledge-over-time/", publisher: "Kickstarter (official blog)", checked: "2026-10-23" },
  { id: S.pmLaunch, title: "Bringing the Kickstarter Pledge Manager to all creators", url: "https://updates.kickstarter.com/bringing-the-kickstarter-pledge-manager-to-all-creators/", publisher: "Kickstarter (official blog)", checked: "2026-10-23" },
  { id: S.refund, title: "How do I issue a refund to one of my backers?", url: "https://help.kickstarter.com/en-us/articles/16236695-how-do-i-issue-a-refund-to-one-of-my-backers", publisher: "Kickstarter Help Center", checked: "2026-10-23" },
  {
    id: S.drop,
    title: "What happens when there is a problem with one of my backer's pledges?",
    url: "https://help.kickstarter.com/en-us/articles/16236454-what-happens-when-there-is-a-problem-with-one-of-my-backer-s-pledges",
    publisher: "Kickstarter Help Center",
    checked: "2026-10-23",
  },
  {
    id: S.lower,
    title: "What happens if the final funding amount is lower than the goal after a campaign has ended?",
    url: "https://help.kickstarter.com/en-us/articles/16236515-what-happens-if-the-final-funding-amount-is-lower-than-the-goal-after-a-campaign-has-ended",
    publisher: "Kickstarter Help Center",
    checked: "2026-10-23",
  },
  { id: S.euro, title: "What is Euro Currency Flexibility and who can use it?", url: "https://help.kickstarter.com/en-us/articles/16236801-what-is-euro-currency-flexibility-and-who-can-use-it", publisher: "Kickstarter Help Center", checked: "2026-10-23" },
  { id: S.payout, title: "If my project is successfully funded, how do I receive my funds?", url: "https://help.kickstarter.com/en-us/articles/16236545-if-my-project-is-successfully-funded-how-do-i-receive-my-funds", publisher: "Kickstarter Help Center", checked: "2026-10-23" },
  {
    id: S.tax,
    title: "Understanding Tax Collection in Kickstarter’s Pledge Manager",
    url: "https://help.kickstarter.com/en-us/articles/16236608-understanding-tax-collection-in-kickstarter-s-pledge-manager",
    publisher: "Kickstarter Help Center",
    checked: "2026-10-23",
  },
  {
    id: S.goal,
    title: "How to set the right funding goal for your Kickstarter campaign",
    url: "https://help.kickstarter.com/en-us/articles/16236709-how-to-set-the-right-funding-goal-for-your-kickstarter-campaign",
    publisher: "Kickstarter Help Center",
    checked: "2026-10-23",
  },
];

const changes: FeeChange[] = [
  {
    date: "2025-05-28",
    text: "Pledge Over Time launched: backers can split pledges into 3 payments. No added fee, but fees are applied per charge, so each such pledge pays the fixed processing fee 3 times instead of once.",
    source: S.potLaunch,
  },
  {
    date: "2025-05-08",
    text: "Kickstarter’s Pledge Manager opened to all creators with no access fee: 5% only on new money (Pledge Manager-only add-ons, shipping, upgrades), not on tax, and processing on the whole payment including tax.",
    source: S.pmTerms,
  },
  {
    date: "2025-02-11",
    text: "New Terms of Use: Kickstarter’s 5% and the processor’s fee are taken from each collected pledge, late pledges included. The April 2024 terms said only “our 5% fee” plus “any fees from our payment partners”.",
    source: S.terms,
  },
];

/**
 * Round an unrounded fee (in cents) once, half away from zero: to the cent, or to the whole yen
 * where the currency has no minor unit. Rounding to the cent first and then to the yen would turn
 * ¥45.495 into ¥45.50 and then ¥46.
 */
function feeRound(rawCents: number, rule: Rule): number {
  return rule.wholeUnits ? roundCents(rawCents / 100) * 100 : roundCents(rawCents);
}

/** A typed amount in cents; yen amounts are whole yen (a fraction of a yen can't be pledged). */
function amount(inputs: Inputs, id: string, rule: Rule): number {
  const c = toCents(num(inputs, id));
  return rule.wholeUnits ? Math.floor(c / 100) * 100 : c;
}

function plural(n: number, word: string) {
  return `${n.toLocaleString("en-US")} ${word}${n === 1 ? "" : "s"}`;
}

/** The micropledge limit as people write it: "$10", "£10", "100 kr.". */
function limitText(rule: Rule, market: Market): string {
  return rule.micro ? formatMoney(rule.micro.under, market.currency, market.locale, { whole: true }) : "";
}

interface Group {
  count: number;
  total: number;
  micro: boolean;
}

/** Split the campaign into the micropledges the creator told us about and everyone else. */
function groups(inputs: Inputs, rule: Rule, warnings: string[] | null, market: Market) {
  const money = moneyFor(market);
  const raised = amount(inputs, "raised", rule);
  const backers = Math.max(1, Math.round(num(inputs, "backers", DEFAULT_BACKERS)));
  let small = rule.micro ? Math.max(0, Math.round(num(inputs, "smallBackers"))) : 0;
  if (small > backers) {
    warnings?.push(`You entered more small pledges (${small}) than backers (${backers}); we’ve counted all ${backers} as small.`);
    small = backers;
  }
  let avg = Math.max(1, amount(inputs, "smallAverage", rule));
  if (rule.micro && small > 0 && avg >= rule.micro.under) {
    warnings?.push(`Micropledges are under ${limitText(rule, market)}, so their average can’t be ${money(avg)}; we’ve used ${money(rule.micro.under - 1)} instead.`);
    avg = rule.micro.under - 1;
  }
  const classify = (count: number, total: number): Group => ({ count, total, micro: Boolean(rule.micro) && count > 0 && total < rule.micro!.under * count });
  if (small === backers) return { raised, backers, small: classify(small, raised), rest: classify(0, 0), smallAvg: avg };
  let smallTotal = small * avg;
  if (smallTotal > raised) {
    if (raised > 0) warnings?.push(`${plural(small, "small pledge")} at ${money(avg)} add up to more than the ${money(raised)} raised; we’ve capped them at the total.`);
    smallTotal = raised;
  }
  return { raised, backers, small: classify(small, smallTotal), rest: classify(backers - small, raised - smallTotal), smallAvg: avg };
}

function processingLine(id: string, label: string, g: Group, rule: Rule, market: Market, explain: string, what = "pledge"): Line {
  const money = moneyFor(market);
  const rate = g.micro ? rule.micro!.rate : rule.rate;
  const fixed = g.micro ? rule.micro!.fixed : rule.fixed;
  return {
    id,
    label,
    amount: feeRound((g.total * rate) / 100 + fixed * g.count, rule),
    kind: "payment",
    detail: fixed ? `${formatRate(rate)} × ${money(g.total)} + ${money(fixed)} × ${plural(g.count, what)}` : `${formatRate(rate)} × ${money(g.total)}`,
    explain,
    source: S.fees,
  };
}

function calculate(inputs: Inputs, market: Market) {
  const money = moneyFor(market);
  const rule = RULES[market.id] ?? RULES.us;
  const warnings: string[] = [];
  const { raised, small, rest } = groups(inputs, rule, warnings, market);
  const limit = limitText(rule, market);
  const fixedText = money(rule.fixed);
  const fees: Line[] = [];

  fees.push({
    id: "platform",
    label: "Kickstarter fee",
    amount: feeRound((raised * 5) / 100, rule),
    kind: "platform",
    detail: `5% × ${money(raised)}`,
    explain:
      "Kickstarter’s 5% of everything collected from backers, including shipping and add-ons charged with the pledge. Taken only because the project reached its goal; pledges that fail to collect aren’t charged.",
    source: S.fees,
  });

  if (raised > 0) {
    const standardExplain = rule.fixed
      ? `Stripe’s processing fee, deducted before your payout: ${formatRate(rule.rate)} of each pledge plus ${fixedText} per pledge${rule.micro ? ` of ${limit} or more` : ""}. The fixed part is why many small pledges cost more than a few large ones.`
      : `Stripe’s processing fee for projects in ${market.label}: ${formatRate(rule.rate)} of the total, with no fixed fee per pledge.`;
    const microExplain = rule.micro
      ? `Pledges under ${limit} pay a discounted micropledge fee of ${formatRate(rule.micro.rate)} + ${money(rule.micro.fixed)} each, instead of ${formatRate(rule.rate)} + ${fixedText} per pledge.`
      : "";
    if (rest.count > 0) {
      fees.push(
        rest.micro
          ? processingLine("processing", "Payment processing (micropledges)", rest, rule, market, `${microExplain} The average pledge here is under ${limit}, so we’ve used that rate for all of them.`)
          : processingLine("processing", "Payment processing", rest, rule, market, standardExplain),
      );
    }
    if (small.count > 0) {
      fees.push(
        small.micro
          ? processingLine("micro", "Payment processing: micropledges", small, rule, market, microExplain)
          : processingLine("micro", "Payment processing", small, rule, market, standardExplain),
      );
    }
  }

  // Pledge Over Time: the fixed fee on charges 2 and 3. Only pledges at or above the minimum qualify.
  let pot = rule.fixed ? Math.max(0, Math.round(num(inputs, "potBackers"))) : 0;
  const eligible = rest.micro ? 0 : rest.count;
  if (pot > eligible) {
    warnings.push(
      eligible
        ? `Only ${plural(eligible, "backer")} pledged ${limit} or more, so at most ${eligible} can use Pledge Over Time.`
        : `Pledge Over Time needs a pledge of at least ${formatMoney(rule.potMin, market.currency, market.locale, { whole: true })}, so none of these backers can use it.`,
    );
    pot = eligible;
  }
  if (pot > 0) {
    if (pot * rule.potMin > rest.total)
      warnings.push(`Pledge Over Time is only offered on pledges of ${formatMoney(rule.potMin, market.currency, market.locale, { whole: true })} or more: ${plural(pot, "backer")} using it means at least ${money(pot * rule.potMin)} of your total.`);
    fees.push({
      id: "pot",
      label: "Pledge Over Time: extra fixed fees",
      amount: rule.fixed * 2 * pot,
      kind: "payment",
      detail: `${fixedText} × 2 more charges × ${plural(pot, "backer")}`,
      explain: `No added fee for Pledge Over Time itself, but Kickstarter applies fees per charge: each of the 3 payments pays the ${fixedText} fixed fee, two more than a pledge paid in full. The percentage is the same.`,
      source: S.terms,
    });
  }

  // Shipping and add-ons collected later in Kickstarter's Pledge Manager.
  const pm = str(inputs, "shippingWhen", "pledge") === "pm";
  const pmAmount = pm ? amount(inputs, "pmAmount", rule) : 0;
  const pmTax = pm && pmAmount > 0 ? amount(inputs, "pmTax", rule) : 0;
  if (pmAmount > 0) {
    const pmOrders = Math.max(1, Math.round(num(inputs, "pmOrders", 1)));
    fees.push({
      id: "pm-platform",
      label: "Kickstarter fee: Pledge Manager",
      amount: feeRound((pmAmount * 5) / 100, rule),
      kind: "platform",
      detail: `5% × ${money(pmAmount)}`,
      explain:
        "The same 5% on new money paid in Kickstarter’s Pledge Manager: shipping, Pledge Manager-only add-ons and upgrades. Not charged on sales tax or VAT, and not charged again on rewards already pledged.",
      source: S.pmTerms,
    });
    const g: Group = { count: pmOrders, total: pmAmount + pmTax, micro: Boolean(rule.micro) && pmAmount + pmTax < (rule.micro?.under ?? 0) * pmOrders };
    fees.push(
      processingLine(
        "pm-processing",
        "Payment processing: Pledge Manager",
        g,
        rule,
        market,
        `Each Pledge Manager payment is a new charge: ${g.micro ? `${formatRate(rule.micro!.rate)} + ${money(rule.micro!.fixed)}` : `${formatRate(rule.rate)}${rule.fixed ? ` + ${fixedText}` : ""}`} on the whole payment${pmTax ? ", including the tax" : ", tax included"}.`,
        "payment",
      ),
    );
    fees[fees.length - 1].source = S.hcFees;
  }

  const notes: string[] = [];
  if (market.id === "eu")
    notes.push("Covers projects from Austria, Belgium, France, Germany, Greece, Ireland, Italy, Luxembourg, the Netherlands, Slovenia and Spain, and euro projects from Switzerland, Denmark, Norway, Sweden and Poland.");
  if (EURO_OPTION.has(market.id)) notes.push("Running the project in euros instead? Pick “Euro countries (€)”: you pay the euro fees only, never both.");
  if (pmTax) notes.push(`The ${money(pmTax)} of tax goes to the tax authorities (Kickstarter collects and remits it), so it isn’t in your payout, but processing was charged on it.`);
  else if (!pm && rule.fixed)
    notes.push(`Charging shipping later in Kickstarter’s Pledge Manager costs the same 5% + processing, plus another ${fixedText} for each backer who pays there.`);
  if (pot > 0) notes.push("Pledge Over Time money arrives in three payouts: about 14 days, 8 weeks and 12 weeks after your deadline.");
  if (!rule.fixed) notes.push("Japan has no fixed fee per pledge, so the fee rate is the same 9.5% whatever your backers pledge.");

  return assemble({
    market,
    buyerPays: raised + pmAmount + pmTax,
    saleAmount: raised + pmAmount,
    fees,
    costs: costs(inputs),
    notes: notes.slice(0, 3),
    warnings,
  });
}

function costs(inputs: Inputs): Line[] {
  const out: Line[] = [];
  const add = (id: string, label: string) => {
    const c = toCents(num(inputs, id));
    if (c) out.push({ id, label, amount: c, kind: "cost" });
  };
  add("itemCost", "Making the rewards");
  add("shippingCost", "Shipping rewards to backers");
  add("otherCost", "Other project costs");
  return out;
}

function schedule(market: Market): ScheduleRow[] {
  const money = moneyFor(market);
  const rule = RULES[market.id] ?? RULES.us;
  const limit = limitText(rule, market);
  const proc = rule.fixed ? `${formatRate(rule.rate)} + ${money(rule.fixed)}` : formatRate(rule.rate);
  const rows: ScheduleRow[] = [
    { fee: "Kickstarter fee", amount: "5%", appliesTo: "Total funds raised: every collected pledge, incl. shipping and add-ons", when: "Only if the project reaches its goal", source: S.fees },
    { fee: "Payment processing", amount: proc, appliesTo: rule.fixed ? "Each pledge" : "Total amount", when: rule.micro ? `Pledges of ${limit} or more` : "Every pledge", source: S.fees },
  ];
  if (rule.micro)
    rows.push({ fee: "Micropledge processing", amount: `${formatRate(rule.micro.rate)} + ${money(rule.micro.fixed)}`, appliesTo: "Each pledge", when: `Pledges under ${limit}`, source: S.fees });
  rows.push(
    { fee: "Late pledges", amount: "Same 5% + processing", appliesTo: "Each late pledge", when: "Pledges after the campaign ends", source: S.late },
    {
      fee: "Pledge Over Time",
      amount: rule.fixed ? `No extra fee; ${money(rule.fixed)} on each of 3 charges` : "No extra fee",
      appliesTo: "Each of the 3 payments",
      when: `Pledges of ${formatMoney(rule.potMin, market.currency, market.locale, { whole: true })} or more, if you enable it`,
      source: S.pot,
    },
    { fee: "Pledge Manager: Kickstarter fee", amount: "5%", appliesTo: "New money only (shipping, Pledge Manager add-ons, upgrades), not tax", when: "Payments in Kickstarter’s Pledge Manager", source: S.pmTerms },
    { fee: "Pledge Manager: processing", amount: proc, appliesTo: "The whole payment, tax included", when: "Payments in Kickstarter’s Pledge Manager", source: S.hcFees },
    { fee: "Pledge Manager access", amount: "Free", appliesTo: "—", when: "Always", source: S.pmTerms },
    { fee: "Unsuccessful project or dropped pledge", amount: "No fees", appliesTo: "—", when: "Goal not reached, or a pledge that fails to collect", source: S.drop },
  );
  return rows;
}

export const kickstarter: CalculatorDef = {
  slug: "kickstarter",
  name: "Kickstarter",
  path: "/kickstarter-fee-calculator",
  category: "creators",
  priceNoun: "funding total",
  saleNoun: "campaign",
  sellerNoun: "creator",
  blurb: "5% of funds raised + 3% + $0.30 per pledge processing; 5% + $0.08 under $10 (US)",
  markets: MARKETS,
  defaultMarket: "us",
  priceField: "raised",
  fields: [
    {
      id: "raised",
      kind: "money",
      label: "Total raised",
      section: "sale",
      help: (i) =>
        str(i, "shippingWhen", "pledge") === "pm"
          ? "Everything collected from backers when the campaign ended, add-ons included (dropped pledges don’t count). Pledge Manager payments go below."
          : "Everything collected from backers, shipping and add-ons included (dropped pledges don’t count).",
    },
    {
      id: "backers",
      kind: "number",
      label: "Number of backers",
      section: "sale",
      integer: true,
      min: 1,
      max: 1_000_000,
      help: (_i, m) =>
        (RULES[m.id] ?? RULES.us).fixed
          ? "Processing adds a fixed fee to every pledge, so many small pledges cost more than a few large ones."
          : "Japan has no fixed fee per pledge, so the number of backers doesn’t change the fees.",
    },
    {
      id: "smallBackers",
      kind: "number",
      label: "Backers who pledged under the micropledge limit",
      section: "sale",
      integer: true,
      min: 0,
      max: 1_000_000,
      advanced: true,
      help: (_i, m) => {
        const r = RULES[m.id] ?? RULES.us;
        const money = moneyFor(m);
        return r.micro
          ? `Pledges under ${limitText(r, m)} pay ${formatRate(r.micro.rate)} + ${money(r.micro.fixed)} each, instead of ${formatRate(r.rate)} + ${money(r.fixed)} per pledge.`
          : "";
      },
      showIf: (_i, m) => Boolean(RULES[m.id]?.micro),
    },
    {
      id: "smallAverage",
      kind: "money",
      label: "Their average pledge",
      section: "sale",
      advanced: true,
      help: (_i, m) => `Under ${limitText(RULES[m.id] ?? RULES.us, m)} each; often a thank-you or digital-only tier.`,
      showIf: (i, m) => Boolean(RULES[m.id]?.micro) && num(i, "smallBackers") > 0,
    },
    {
      id: "potBackers",
      kind: "number",
      label: "Backers paying with Pledge Over Time",
      section: "sale",
      integer: true,
      min: 0,
      max: 1_000_000,
      advanced: true,
      help: (_i, m) => {
        const r = RULES[m.id] ?? RULES.us;
        return `Pledges of ${formatMoney(r.potMin, m.currency, m.locale, { whole: true })} or more can be split into 3 payments; the ${moneyFor(m)(r.fixed)} fixed fee is charged on each one.`;
      },
      showIf: (_i, m) => Boolean(RULES[m.id]?.fixed),
    },
    {
      id: "shippingWhen",
      kind: "segmented",
      label: "When do backers pay for shipping?",
      section: "shipping",
      options: [
        { value: "pledge", label: "With the pledge" },
        { value: "pm", label: "In the Pledge Manager" },
      ],
      help: "Kickstarter takes 5% + processing on shipping either way. Pledge Manager payments are separate charges.",
    },
    {
      id: "pmAmount",
      kind: "money",
      label: "Shipping & add-ons paid in the Pledge Manager",
      section: "shipping",
      help: "New money only, without tax. Rewards already pledged aren’t charged 5% again.",
      showIf: (i) => str(i, "shippingWhen", "pledge") === "pm",
    },
    {
      id: "pmOrders",
      kind: "number",
      label: "Backers who paid there",
      section: "shipping",
      integer: true,
      min: 1,
      max: 1_000_000,
      help: "Each payment has its own fixed processing fee.",
      showIf: (i) => str(i, "shippingWhen", "pledge") === "pm",
    },
    {
      id: "pmTax",
      kind: "money",
      label: "Sales tax or VAT collected on those payments",
      section: "shipping",
      help: "Tax Kickstarter collects and remits for you: no 5% on it, but processing is charged on it.",
      showIf: (i) => str(i, "shippingWhen", "pledge") === "pm",
    },
    { id: "itemCost", kind: "money", label: "Making the rewards", section: "costs", help: "Production cost of everything you’ll send backers." },
    { id: "shippingCost", kind: "money", label: "Shipping rewards to backers", section: "costs" },
    { id: "otherCost", kind: "money", label: "Other project costs", section: "costs", help: "Ads, design, packaging, tools." },
  ],
  defaults: (market) => {
    const r = RULES[market.id] ?? RULES.us;
    return {
      raised: r.d.raised,
      backers: DEFAULT_BACKERS,
      smallBackers: 0,
      smallAverage: r.d.small,
      potBackers: 0,
      shippingWhen: "pledge",
      pmAmount: r.d.pm,
      pmOrders: DEFAULT_BACKERS,
      pmTax: 0,
      itemCost: 0,
      shippingCost: 0,
      otherCost: 0,
    };
  },
  calculate,
  breakpoints: (inputs, market) => {
    // The funding total where an average pledge crosses the micropledge limit (the fee jumps from
    // 5% + small fixed to the standard rate + full fixed, so the payout drops by a few cents per
    // pledge), and where the small pledges stop absorbing the whole total.
    const rule = RULES[market.id] ?? RULES.us;
    if (!rule.micro) return [];
    const { backers, small, smallAvg } = groups({ ...inputs, raised: 0 }, rule, null, market);
    if (small.count >= backers) return [rule.micro.under * backers];
    const smallTotal = small.count * smallAvg;
    return [smallTotal, smallTotal + rule.micro.under * (backers - small.count)].filter((b) => b > 0);
  },
  verifiedAt: "2026-10-23",
  sources,
  changes,
  schedule,
};

export default kickstarter;
