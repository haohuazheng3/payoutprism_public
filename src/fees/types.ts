/**
 * The fee engine's contract. Every platform module (src/fees/platforms/<slug>.ts) exports a
 * `CalculatorDef`: the inputs it needs, a pure `calculate()` that turns those inputs into an
 * itemised `Result`, and the documentation the page renders (fee schedule, sources, changes).
 *
 * Money inside the engine is always integer cents of the market's currency. Inputs arrive as
 * decimal amounts (what people type) and are converted once with `toCents()`.
 */

export type CurrencyCode = "USD" | "GBP" | "EUR" | "CAD" | "AUD" | "INR" | "JPY" | "MXN" | "BRL" | "NZD" | "CHF" | "SEK" | "PLN" | "DKK" | "NOK";

export interface Market {
  /** Stable id used in URLs and inputs, e.g. "us", "uk", "ca". */
  id: string;
  /** What people call it: "United States". */
  label: string;
  currency: CurrencyCode;
  /** BCP 47 locale for number formatting. */
  locale: string;
  /** Emoji flag, shown next to the label. */
  flag: string;
}

export type CalculatorCategory = "marketplaces" | "payments" | "freelance" | "rentals" | "creators" | "fundraising";

export type InputValue = number | string | boolean;
export type Inputs = Record<string, InputValue>;

export type FieldSection = "sale" | "shipping" | "costs" | "options";

interface FieldBase {
  id: string;
  label: string;
  /** One short sentence under the field, in plain language. */
  help?: string;
  section: FieldSection;
  /** Hidden behind "More options" until opened (or until it holds a non-default value). */
  advanced?: boolean;
  /** Only shown (and only used) when this returns true. */
  showIf?: (inputs: Inputs, market: Market) => boolean;
}

export interface MoneyField extends FieldBase {
  kind: "money";
  min?: number;
  max?: number;
  placeholder?: string;
}

export interface PercentField extends FieldBase {
  kind: "percent";
  min?: number;
  max?: number;
  step?: number;
}

export interface NumberField extends FieldBase {
  kind: "number";
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
  integer?: boolean;
}

export interface SelectOption {
  value: string;
  label: string;
  /** Short hint shown in the option list, e.g. "13.6% up to $7,500". */
  hint?: string;
  group?: string;
}

export interface SelectField extends FieldBase {
  kind: "select";
  options: SelectOption[] | ((inputs: Inputs, market: Market) => SelectOption[]);
  /** Long lists (categories) get a searchable sheet instead of a native select. */
  searchable?: boolean;
}

export interface SegmentedField extends FieldBase {
  kind: "segmented";
  options: SelectOption[];
}

export interface ToggleField extends FieldBase {
  kind: "toggle";
}

export type FieldDef = MoneyField | PercentField | NumberField | SelectField | SegmentedField | ToggleField;

/** Who a line belongs to and how it is grouped in the "where your money goes" bar. */
export type LineKind = "platform" | "payment" | "ads" | "shipping" | "tax" | "payout" | "subscription" | "other" | "cost";

export interface Line {
  id: string;
  label: string;
  /** Cents. Positive = money out of the seller's pocket (or, for buyer lines, added to the buyer's total). */
  amount: number;
  kind: LineKind;
  /** The arithmetic, readable: "6.5% × $28.00". */
  detail?: string;
  /** Why this fee exists / when it applies, one or two sentences. */
  explain?: string;
  /** Id of an entry in the calculator's `sources`. */
  source?: string;
}

export interface Result {
  currency: CurrencyCode;
  /** What the buyer / client / guest pays in total (cents), including buyer-side fees and tax the platform collects. */
  buyerPays: number;
  /** The amount fees are measured against in the headline rate: usually item price + shipping charged. */
  saleAmount: number;
  /** Deductions from the seller's side. */
  fees: Line[];
  /** Fees charged to the buyer on top of the price (shown for transparency; they do not reduce the payout). */
  buyerFees: Line[];
  /** Sum of `fees` (cents). */
  totalFees: number;
  /** Money that reaches the seller's balance/bank from this sale, before their own costs (cents). */
  payout: number;
  /** The seller's own costs entered in the form (item cost, label, packaging…). */
  costs: Line[];
  totalCosts: number;
  /** payout − totalCosts, or null when no costs were entered. */
  profit: number | null;
  /** profit / saleAmount, or null. */
  margin: number | null;
  /** totalFees / saleAmount (0 when saleAmount is 0). */
  effectiveRate: number;
  /** Things the seller should know about this specific result (assumptions, caps hit). */
  notes: string[];
  /** Problems: a loss, a fee bigger than the sale, an input outside the platform's limits. */
  warnings: string[];
}

export interface Source {
  id: string;
  /** Page title as published. */
  title: string;
  url: string;
  publisher: string;
  /** ISO date we last read this page and confirmed the numbers. */
  checked: string;
  /**
   * Machine-readable twin of the page for the daily change watch, when the page itself blocks
   * plain HTTP (e.g. a help center's JSON API for the same article). Defaults to `url`.
   */
  watch?: string;
}

export interface FeeChange {
  /** ISO date the change took (or takes) effect. */
  date: string;
  /** What changed, with old → new values. */
  text: string;
  source?: string;
  /** True for an announced change that has not taken effect yet. */
  upcoming?: boolean;
}

export interface ScheduleRow {
  fee: string;
  amount: string;
  appliesTo: string;
  when?: string;
  source?: string;
}

export interface CalculatorDef {
  /** Platform slug, e.g. "etsy". */
  slug: string;
  /** "Etsy". */
  name: string;
  /** URL path of the calculator page, e.g. "/etsy-fee-calculator". */
  path: string;
  category: CalculatorCategory;
  /** Short noun for the main amount: "item price", "invoice amount", "nightly rate". */
  priceNoun: string;
  /** Who is selling/receiving: "seller", "freelancer", "host", "creator", "merchant". */
  sellerNoun: string;
  /** One line for menus and cards: "6.5% transaction + 3% + $0.25 processing". */
  blurb: string;
  markets: Market[];
  defaultMarket: string;
  fields: FieldDef[];
  /** Defaults for a market. Every field id must be present. */
  defaults: (market: Market) => Inputs;
  /** The input the reverse ("find my price") mode solves for. Must be a money field. */
  priceField: string;
  calculate: (inputs: Inputs, market: Market) => Result;
  /**
   * Prices (in cents) where the fee formula changes shape (flat fee → percentage, tier edges,
   * caps). The reverse solver treats each interval between breakpoints as monotonic.
   */
  breakpoints?: (inputs: Inputs, market: Market) => number[];
  /** ISO date every number in this module was last verified against the official sources. */
  verifiedAt: string;
  sources: Source[];
  changes: FeeChange[];
  /** The official fee schedule as a table, per market. */
  schedule: (market: Market) => ScheduleRow[];
  /** How this calculator joins the compare page (default market only). Omit to stay out of it. */
  compare?: CompareSpec;
}

/** The shared inputs of the compare page (US market, decimal amounts as typed). */
export interface CompareInputs {
  /** Item price, invoice amount or payment amount. */
  price: number;
  /** What the buyer pays for shipping on top of the price. */
  shipping: number;
  /** What the item cost the seller. */
  itemCost: number;
  /** What the seller pays for postage / the label. */
  shippingCost: number;
}

export interface CompareSpec {
  /** "sell" (marketplaces) or "pay" (getting paid: processors, invoices, P2P apps). */
  group: "sell" | "pay";
  /** Map the shared inputs onto this calculator's inputs (applied on top of the default market's defaults). */
  map: (c: CompareInputs) => Partial<Inputs>;
  /** One line on the assumptions used, e.g. "Buyer pays the prepaid label; most categories". */
  note: string;
}

export interface CalculatorSummary {
  slug: string;
  name: string;
  path: string;
  category: CalculatorCategory;
  /** One line for cards: "6.5% transaction + 3% + $0.25 processing". */
  blurb: string;
  verifiedAt: string;
}
