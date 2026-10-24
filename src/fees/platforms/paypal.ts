/*
 * PayPal fees for getting paid. Every number is from PayPal's own fee pages (see `sources`),
 * re-checked against the live pages on 2026-10-23. Research notes with verbatim quotes:
 * research/fees/paypal-us.md and research/fees/paypal-intl.md.
 *
 * How a PayPal fee is computed (what this module reproduces):
 *  - One fee per payment: a percentage of the whole payment plus a fixed fee in the currency
 *    received. "The whole payment" is everything the payer sends: item, shipping, handling and any
 *    sales tax (AU CFSGPDS 17.4: "Fees for receiving Commercial Transactions are taken from the
 *    total transaction amount"; no market's fee page excludes shipping or tax).
 *  - International payments: the domestic rate plus extra percentage points that depend on where
 *    the payer's PayPal account is registered (not the shipping address). The fixed fee is the same.
 *    Canada publishes some international card rates as totals; those are stored as totals.
 *  - Rounding: PayPal publishes no rule. Its own 2022 example ($225.00 × 2.99% = $6.7275 → $6.73)
 *    matches rounding the fee to the cent, half up, which is what pct() does.
 *  - Currency conversion is built into PayPal's exchange rate. We show it as its own line at the
 *    published spread so the cost is visible.
 *  - Withdrawals: standard bank transfers are free; instant transfers (US, Canada) and card
 *    withdrawals (Australia, Germany) are a percentage of the amount moved, with a minimum and
 *    sometimes a maximum. Shown as a payout line, on what this payment leaves in the balance.
 *  - Friends and family: free to receive. Card-funded sends cost the sender, shown as a buyer-side
 *    line that doesn't reduce the payout.
 */
import { M } from "../markets";
import { assemble, bool, costLines, formatRate, moneyFor, num, pct, str, toCents } from "../money";
import type { CalculatorDef, FeeChange, Inputs, Line, Market, ScheduleRow, SelectOption, Source } from "../types";

const MARKETS: Market[] = [M.us, M.uk, M.ca, M.au, M.de];

const S = {
  usBiz: "pp-us-merchant",
  usConsumer: "pp-us-consumer",
  usUa: "pp-us-ua",
  usPast: "pp-us-past",
  usPricing: "pp-us-pricing",
  usNews2022: "pp-us-news-2022",
  ukBiz: "pp-uk-merchant",
  ukConsumer: "pp-uk-consumer",
  ukUpdates: "pp-uk-updates",
  caBiz: "pp-ca-merchant",
  caConsumer: "pp-ca-consumer",
  caPast: "pp-ca-past",
  auBiz: "pp-au-merchant",
  auConsumer: "pp-au-consumer",
  auPds: "pp-au-cfsgpds",
  auPast: "pp-au-past",
  deBiz: "pp-de-merchant",
  deConsumer: "pp-de-consumer",
  dePast: "pp-de-past",
} as const;

const sources: Source[] = [
  { id: S.usBiz, title: "PayPal Merchant Fees", url: "https://www.paypal.com/us/business/paypal-business-fees", publisher: "PayPal US", checked: "2026-10-23" },
  { id: S.usConsumer, title: "PayPal Consumer Fees", url: "https://www.paypal.com/us/digital-wallet/paypal-consumer-fees", publisher: "PayPal US", checked: "2026-10-23" },
  { id: S.usUa, title: "PayPal User Agreement", url: "https://www.paypal.com/us/legalhub/paypal/useragreement-full", publisher: "PayPal US", checked: "2026-10-23" },
  { id: S.usPricing, title: "PayPal Business Pricing", url: "https://www.paypal.com/us/business/fees", publisher: "PayPal US", checked: "2026-10-23" },
  { id: S.usPast, title: "Past Policy Updates", url: "https://www.paypal.com/us/legalhub/paypal/archive-policies-full", publisher: "PayPal US", checked: "2026-10-23" },
  {
    id: S.usNews2022,
    title: "Upcoming Changes to Goods & Services Payments on PayPal",
    url: "https://newsroom.paypal-corp.com/2022-06-Upcoming-Changes-to-PayPals-Pricing-Structure",
    publisher: "PayPal Newsroom",
    checked: "2026-10-23",
  },
  { id: S.ukBiz, title: "PayPal Merchant Fees", url: "https://www.paypal.com/uk/business/paypal-business-fees", publisher: "PayPal UK", checked: "2026-10-23" },
  { id: S.ukConsumer, title: "PayPal Consumer Fees", url: "https://www.paypal.com/uk/digital-wallet/paypal-consumer-fees", publisher: "PayPal UK", checked: "2026-10-23" },
  { id: S.ukUpdates, title: "Policy Updates", url: "https://www.paypal.com/uk/legalhub/paypal/upcoming-policies-full", publisher: "PayPal UK", checked: "2026-10-23" },
  { id: S.caBiz, title: "PayPal Merchant Fees", url: "https://www.paypal.com/ca/business/paypal-business-fees", publisher: "PayPal Canada", checked: "2026-10-23" },
  { id: S.caConsumer, title: "PayPal Consumer Fees", url: "https://www.paypal.com/ca/digital-wallet/paypal-consumer-fees", publisher: "PayPal Canada", checked: "2026-10-23" },
  { id: S.caPast, title: "Past Policy Updates", url: "https://www.paypal.com/ca/legalhub/paypal/archive-policies-full?locale.x=en_CA", publisher: "PayPal Canada", checked: "2026-10-23" },
  { id: S.auBiz, title: "PayPal Merchant Fees", url: "https://www.paypal.com/au/business/paypal-business-fees", publisher: "PayPal Australia", checked: "2026-10-23" },
  { id: S.auConsumer, title: "PayPal Consumer Fees", url: "https://www.paypal.com/au/digital-wallet/paypal-consumer-fees", publisher: "PayPal Australia", checked: "2026-10-23" },
  {
    id: S.auPds,
    title: "Combined Financial Services Guide and Product Disclosure Statement",
    url: "https://www.paypal.com/au/legalhub/paypal/cfsgpds-full?locale.x=en_AU",
    publisher: "PayPal Australia",
    checked: "2026-10-23",
  },
  { id: S.auPast, title: "Past Policy Updates", url: "https://www.paypal.com/au/legalhub/paypal/archive-policies-full", publisher: "PayPal Australia", checked: "2026-10-23" },
  { id: S.deBiz, title: "PayPal Händler- und Verkäufergebühren", url: "https://www.paypal.com/de/business/paypal-business-fees", publisher: "PayPal Deutschland", checked: "2026-10-23" },
  { id: S.deConsumer, title: "PayPal-Gebühren für Privatkunden", url: "https://www.paypal.com/de/digital-wallet/paypal-consumer-fees", publisher: "PayPal Deutschland", checked: "2026-10-23" },
  {
    id: S.dePast,
    title: "Zurückliegende Aktualisierungen der Richtlinien",
    url: "https://www.paypal.com/de/legalhub/paypal/archive-policies-full?locale.x=de_DE",
    publisher: "PayPal Deutschland",
    checked: "2026-10-23",
  },
];

/* ---------------------------------------------------------------------------------------------
 * Payment types, per market. Rates are percentages, fixed fees are cents of the market currency.
 * ------------------------------------------------------------------------------------------- */

/** Extra percentage points by payer region. A region missing from the map adds nothing. */
type Surcharge = Partial<Record<string, number>>;

interface PayType {
  id: string;
  /** What the option says, in the user's words. */
  label: string;
  group: string;
  /** The fee line on the result (what PayPal calls the payment type). */
  line: string;
  /** Official name on the fee page, for the schedule. */
  official: string;
  rate: number;
  fixed: number;
  /** Payments of `max` cents or less pay a different rate and fixed fee (QR codes in the UK, Canada, Germany). */
  small?: { max: number; rate: number; fixed: number };
  /** Maximum for the domestic percentage, cents (US invoices paid by bank). */
  cap?: number;
  /** International: extra percentage points by payer region. Undefined = the question doesn't apply. */
  intl?: Surcharge;
  /** International rates PayPal publishes as totals (Canada's card processing, charity, micropayments). */
  intlTotal?: Surcharge;
  /** US Dynamic Micropayments: PayPal charges whichever of the two rates is lower. */
  dynamicWith?: string;
  /** Friends and family: not a sale (no shipping, no tax, free to receive). */
  personal?: boolean;
  /** Card-funded friends-and-family send: the fee is the sender's. */
  senderPays?: boolean;
  /** UK: counted towards (and priced by) the optional tiered rate plan. */
  tierEligible?: boolean;
  /** When this rate applies, for the schedule. */
  when: string;
  explain: string;
  source: string;
}

const US_INTL: Surcharge = { intl: 1.5 };
const UK_INTL: Surcharge = { eea: 1.29, other: 1.99 };
const CA_INTL: Surcharge = { us: 0.8, other: 1 };
const AU_INTL: Surcharge = { intl: 1 };
const DE_INTL: Surcharge = { uk: 1.29, usca: 1.99, other: 1.99 };
const DE_INTL_GS: Surcharge = { uk: 1.29, usca: 1.99, other: 2.99 };
/** German donations use PayPal's region groups: UK is in "Europe I" (+2), US/Canada +2, rest of the world +3.3. */
const DE_INTL_DONATION: Surcharge = { uk: 2, usca: 2, other: 3.3 };

const ON_ALL = "Everything the payer sends (incl. shipping & tax)";

const TYPES: Record<string, PayType[]> = {
  us: [
    {
      id: "checkout",
      group: "Online sales",
      label: "PayPal Checkout (buyer pays with PayPal)",
      line: "PayPal Checkout fee",
      official: "PayPal Checkout, Guest Checkout, All Other Commercial Transactions",
      rate: 3.49,
      fixed: 49,
      intl: US_INTL,
      when: "Online sales paid through PayPal Checkout or a PayPal button",
      explain: "The standard rate when a buyer pays you through PayPal Checkout, a PayPal button or guest checkout.",
      source: S.usBiz,
    },
    {
      id: "gs",
      group: "Online sales",
      label: "Goods & services payment sent to you",
      line: "Goods and services fee",
      official: "Send/Receive Money for Goods and Services",
      rate: 2.99,
      fixed: 0,
      intl: US_INTL,
      when: "The buyer sends money and marks it as goods or services",
      explain: "When the buyer sends you money with “Goods and services” selected: 2.99% with no fixed fee, for personal and business accounts.",
      source: S.usBiz,
    },
    {
      id: "card",
      group: "Online sales",
      label: "Debit or credit card (standard card payment)",
      line: "Card payment fee",
      official: "Standard Credit and Debit Card Payments",
      rate: 2.99,
      fixed: 49,
      intl: US_INTL,
      when: "The buyer pays by card in PayPal Checkout",
      explain: "When the buyer pays by credit or debit card inside PayPal Checkout. Card fields on your own site (Expanded Checkout) cost 2.89% + $0.29 instead.",
      source: S.usPricing,
    },
    {
      id: "paylater",
      group: "Online sales",
      label: "Pay Later (Pay in 4, Pay Monthly)",
      line: "Pay Later fee",
      official: "PayPal Pay Later options",
      rate: 4.99,
      fixed: 49,
      intl: US_INTL,
      when: "The buyer chooses Pay in 4 or Pay Monthly",
      explain:
        "Since January 13, 2025, Pay Later costs sellers 4.99% + $0.49 instead of the Checkout rate. You can turn Pay Later off in your account settings. (Through a PayPal Point of Sale payment link it's charged at 3.49% + $0.49.)",
      source: S.usBiz,
    },
    {
      id: "venmo",
      group: "Online sales",
      label: "Venmo via PayPal (Pay with Venmo)",
      line: "Pay with Venmo fee",
      official: "Pay with Venmo",
      rate: 3.49,
      fixed: 49,
      when: "The buyer picks Venmo at PayPal checkout",
      explain: "Same rate as PayPal Checkout when the buyer pays with Venmo at your PayPal checkout or invoice.",
      source: S.usBiz,
    },
    {
      id: "crypto",
      group: "Online sales",
      label: "Crypto (Pay with Crypto)",
      line: "Pay with Crypto fee",
      official: "Pay With Crypto",
      rate: 1.5,
      fixed: 0,
      when: "You let customers pay in cryptocurrency at checkout",
      explain: "1.5% of the transaction amount since August 1, 2026 (it was 0.99%), with no fixed fee.",
      source: S.usBiz,
    },
    {
      id: "invoice",
      group: "Invoices",
      label: "Invoice paid with PayPal or Venmo",
      line: "Invoice fee",
      official: "Invoicing: PayPal Checkout, Pay with Venmo, or PayPal Guest Checkout",
      rate: 3.49,
      fixed: 49,
      intl: US_INTL,
      when: "Client pays your PayPal invoice with PayPal or Venmo",
      explain: "Sending a PayPal invoice is free; you pay this when the client pays it with PayPal, Venmo or guest checkout.",
      source: S.usBiz,
    },
    {
      id: "invoiceCard",
      group: "Invoices",
      label: "Invoice paid by card or Apple Pay",
      line: "Invoice fee (card)",
      official: "Invoicing: Standard Credit and Debit Card Payments, Apple Pay, or other third-party wallets",
      rate: 2.99,
      fixed: 49,
      intl: US_INTL,
      when: "Client pays your invoice by card, Apple Pay or another wallet",
      explain: "The invoice rate when the client pays by credit or debit card, Apple Pay or another third-party wallet.",
      source: S.usBiz,
    },
    {
      id: "invoicePayLater",
      group: "Invoices",
      label: "Invoice paid with Pay Later",
      line: "Invoice fee (Pay Later)",
      official: "Invoicing: PayPal Pay Later options",
      rate: 4.99,
      fixed: 49,
      intl: US_INTL,
      when: "Client pays your invoice with Pay in 4 or Pay Monthly",
      explain: "The invoice rate when the client uses Pay in 4 or Pay Monthly.",
      source: S.usBiz,
    },
    {
      id: "invoiceBank",
      group: "Invoices",
      label: "Invoice paid by bank (ACH)",
      line: "Invoice fee (Pay by Bank)",
      official: "Invoicing: Pay by Bank (ACH)",
      rate: 1,
      fixed: 0,
      cap: 1000,
      intl: US_INTL,
      when: "Client pays your invoice straight from their bank account",
      explain: "1% of the invoice, never more than $10.00 per payment: the cheapest way to get a large invoice paid through PayPal.",
      source: S.usBiz,
    },
    {
      id: "qr",
      group: "In person",
      label: "QR code",
      line: "QR code fee",
      official: "QR code Transactions",
      rate: 2.29,
      fixed: 9,
      intl: US_INTL,
      when: "The buyer scans your PayPal QR code",
      explain: "The rate for payments made by scanning your PayPal or Venmo QR code, at any amount (the old under-$10 rate ended in 2023).",
      source: S.usBiz,
    },
    {
      id: "pos",
      group: "In person",
      label: "Card reader or Tap to Pay (PayPal POS)",
      line: "Card present fee",
      official: "PayPal Point of Sale: Card Present Transactions",
      rate: 2.29,
      fixed: 9,
      when: "Card tapped, inserted or swiped in person",
      explain: "Card-present payments through PayPal Point of Sale, such as a card reader or Tap to Pay: 2.29% + $0.09 per payment.",
      source: S.usBiz,
    },
    {
      id: "posKeyed",
      group: "In person",
      label: "Card number keyed in (PayPal POS)",
      line: "Manual card entry fee",
      official: "PayPal Point of Sale: Manual Card Entry Transactions",
      rate: 3.49,
      fixed: 9,
      when: "You type the card number into PayPal Point of Sale",
      explain: "Typing the card number in by hand costs more than tapping the card.",
      source: S.usBiz,
    },
    {
      id: "acdc",
      group: "Card processing",
      label: "Cards on your own site (Advanced card payments)",
      line: "Advanced card payment fee",
      official: "Advanced Credit and Debit Card Payments",
      rate: 2.89,
      fixed: 29,
      intl: US_INTL,
      when: "Card fields built into your own checkout (Expanded Checkout)",
      explain: "Card processing on your own checkout page (Expanded Checkout). This is the “starting at 2.89% + $0.29” rate PayPal advertises; cards paid inside PayPal Checkout cost 2.99% + $0.49.",
      source: S.usBiz,
    },
    {
      id: "vt",
      group: "Card processing",
      label: "Virtual Terminal (card details typed in)",
      line: "Virtual Terminal fee",
      official: "Virtual Terminal",
      rate: 3.39,
      fixed: 29,
      intl: US_INTL,
      when: "You key in a card online, e.g. for phone orders",
      explain: "For card payments you enter yourself in PayPal's Virtual Terminal.",
      source: S.usBiz,
    },
    {
      id: "donation",
      group: "Donations",
      label: "Donations (Donate button)",
      line: "Donation fee",
      official: "Donate Button, PayPal Checkout for Donations",
      rate: 2.89,
      fixed: 49,
      intl: US_INTL,
      when: "Money received through a Donate button or Checkout for Donations",
      explain: "The rate for donations received through a PayPal Donate button or Checkout for Donations.",
      source: S.usBiz,
    },
    {
      id: "charity",
      group: "Donations",
      label: "Confirmed charity",
      line: "Charity rate fee",
      official: "Charity Transactions",
      rate: 1.99,
      fixed: 49,
      intl: US_INTL,
      when: "Charities PayPal has approved for the charity rate",
      explain: "The reduced rate for organizations PayPal has confirmed as charities (you apply for it).",
      source: S.usBiz,
    },
    {
      id: "micro",
      group: "Small payments",
      label: "Micropayments rate (approved accounts)",
      line: "Micropayments fee",
      official: "Micropayments",
      rate: 4.99,
      fixed: 9,
      intl: US_INTL,
      dynamicWith: "checkout",
      when: "Accounts PayPal has approved for micropayments pricing",
      explain:
        "With Dynamic Micropayments PayPal charges whichever is lower for each payment: 4.99% + $0.09 or the standard 3.49% + $0.49. The micropayments rate wins below about $26.67.",
      source: S.usBiz,
    },
    {
      id: "ff",
      group: "Friends & family",
      label: "Friends & family, from balance or bank",
      line: "Receiving fee",
      official: "Friends and family, from PayPal balance or a bank account",
      rate: 0,
      fixed: 0,
      personal: true,
      when: "Personal payments within the US",
      explain: "Receiving money from friends and family is free, and so is sending it from a PayPal balance or bank account (unless PayPal converts currency).",
      source: S.usConsumer,
    },
    {
      id: "ffCard",
      group: "Friends & family",
      label: "Friends & family, paid by card",
      line: "Receiving fee",
      official: "Friends and family, paid by card",
      rate: 2.9,
      fixed: 30,
      personal: true,
      senderPays: true,
      when: "Personal payment the sender funds with a credit or debit card (sender pays)",
      explain: "When a friend pays you with a card, they pay 2.90% + $0.30 on top. You receive the full amount.",
      source: S.usConsumer,
    },
  ],
  uk: [
    {
      id: "checkout",
      group: "Online sales",
      label: "PayPal Checkout or goods & services payment",
      line: "PayPal fee",
      official: "All Other Commercial Transactions",
      rate: 2.9,
      fixed: 30,
      intl: UK_INTL,
      tierEligible: true,
      when: "Online sales, goods and services payments and money requests",
      explain: "PayPal's standard UK rate for receiving a payment for goods or services.",
      source: S.ukBiz,
    },
    {
      id: "invoice",
      group: "Online sales",
      label: "Invoice or payment request",
      line: "PayPal fee (invoice)",
      official: "Invoices (charged as commercial transactions)",
      rate: 2.9,
      fixed: 30,
      intl: UK_INTL,
      tierEligible: true,
      when: "Client pays your PayPal invoice or money request",
      explain: "Sending a PayPal invoice is free; when it's paid you pay the standard commercial rate.",
      source: S.ukBiz,
    },
    {
      id: "guestCard",
      group: "Online sales",
      label: "Card payment from a buyer without a PayPal account",
      line: "Guest card payment fee",
      official: "Card funded payment from a user of our Terms for Payments without a PayPal account",
      rate: 1.2,
      fixed: 30,
      intl: UK_INTL,
      when: "The buyer pays by card as a guest, without logging in",
      explain: "Card payments from buyers checking out without a PayPal account cost 1.2% + £0.30.",
      source: S.ukBiz,
    },
    {
      id: "paylater",
      group: "Online sales",
      label: "Pay in 3 or Pay in 30 (Buy Now Pay Later)",
      line: "Buy Now Pay Later fee",
      official: "Buy Now Pay Later Transactions (excludes PayPal Credit)",
      rate: 3.9,
      fixed: 30,
      intl: UK_INTL,
      when: "The buyer chooses Pay in 3 or Pay in 30",
      explain: "Since October 1, 2026, Pay in 3 and Pay in 30 cost sellers 3.9% + £0.30 (PayPal Credit excluded).",
      source: S.ukBiz,
    },
    {
      id: "qr",
      group: "In person",
      label: "QR code",
      line: "QR code fee",
      official: "QR Code Transactions",
      rate: 1.5,
      fixed: 10,
      small: { max: 1000, rate: 2, fixed: 5 },
      intl: UK_INTL,
      when: "The buyer scans your PayPal QR code",
      explain: "QR code payments of £10.01 and above cost 1.5% + £0.10; £10.00 and below, 2% + £0.05.",
      source: S.ukBiz,
    },
    {
      id: "pos",
      group: "In person",
      label: "Card reader (PayPal POS)",
      line: "Card present fee",
      official: "PayPal Point of Sale: Card Present Transactions",
      rate: 1.75,
      fixed: 0,
      when: "Card tapped, inserted or swiped in person",
      explain: "PayPal Point of Sale (formerly Zettle): 1.75% per card payment, no fixed fee.",
      source: S.ukBiz,
    },
    {
      id: "posKeyed",
      group: "In person",
      label: "Card number keyed in (PayPal POS)",
      line: "Manual card entry fee",
      official: "PayPal Point of Sale: Manual Card Entry Transactions",
      rate: 3.4,
      fixed: 20,
      when: "You type the card number into PayPal Point of Sale",
      explain: "Typing the card number in by hand costs 3.4% + £0.20.",
      source: S.ukBiz,
    },
    {
      id: "acdc",
      group: "Card processing",
      label: "Cards on your own site (Advanced card payments)",
      line: "Advanced card payment fee",
      official: "Advanced Credit and Debit Card Payments (Blended Pricing)",
      rate: 1.2,
      fixed: 30,
      intl: UK_INTL,
      when: "Card fields on your own checkout (Visa, Mastercard and others; Amex is 3.5%)",
      explain: "Blended pricing for Visa, Mastercard, CUP, Diners and Discover cards on your own checkout. American Express is 3.5%.",
      source: S.ukBiz,
    },
    {
      id: "vt",
      group: "Card processing",
      label: "Virtual Terminal (card details typed in)",
      line: "Virtual Terminal fee",
      official: "Virtual Terminal (Blended Pricing)",
      rate: 2.9,
      fixed: 30,
      intl: UK_INTL,
      when: "You key in a card online, e.g. for phone orders",
      explain: "Raised from 1.2% to 2.9% + fixed fee on October 1, 2026. A £20 monthly fee for Website Payments Pro may also apply.",
      source: S.ukBiz,
    },
    {
      id: "donation",
      group: "Donations",
      label: "Donations",
      line: "Donation fee",
      official: "Donation",
      rate: 2.9,
      fixed: 30,
      intl: UK_INTL,
      when: "Money received as a donation",
      explain: "Donations cost the same as a sale unless PayPal has approved you for the charity rate.",
      source: S.ukBiz,
    },
    {
      id: "charity",
      group: "Donations",
      label: "Approved charity",
      line: "Charity rate fee",
      official: "Charity transactions",
      rate: 1.4,
      fixed: 20,
      intl: UK_INTL,
      when: "Charities PayPal has approved for the charity rate",
      explain: "The reduced rate for approved charities: 1.4% + £0.20.",
      source: S.ukBiz,
    },
    {
      id: "micro",
      group: "Small payments",
      label: "Micropayments rate (approved accounts)",
      line: "Micropayments fee",
      official: "Micropayments",
      rate: 5,
      fixed: 5,
      intlTotal: { eea: 6, other: 6 },
      when: "Accounts approved for micropayments (applies to every payment)",
      explain: "5% + £0.05 (6% for international payments). Once approved it applies to every commercial payment you receive; PayPal suggests it for payments under £5.",
      source: S.ukBiz,
    },
    {
      id: "ff",
      group: "Friends & family",
      label: "Friends & family",
      line: "Receiving fee",
      official: "Friends and family (domestic)",
      rate: 0,
      fixed: 0,
      personal: true,
      when: "Personal payments within the UK",
      explain: "Sending and receiving money from friends and family in the UK is free, however it's funded, unless PayPal converts currency.",
      source: S.ukConsumer,
    },
  ],
  ca: [
    {
      id: "checkout",
      group: "Online sales",
      label: "PayPal Checkout or goods & services payment",
      line: "PayPal fee",
      official: "Commercial Transactions",
      rate: 2.9,
      fixed: 30,
      intl: CA_INTL,
      when: "Online sales, goods and services payments and money requests",
      explain: "PayPal's standard Canadian rate for receiving a payment for goods or services.",
      source: S.caBiz,
    },
    {
      id: "invoice",
      group: "Online sales",
      label: "Invoice or payment request",
      line: "PayPal fee (invoice)",
      official: "Invoices (charged as commercial transactions)",
      rate: 2.9,
      fixed: 30,
      intl: CA_INTL,
      when: "Client pays your PayPal invoice or money request",
      explain: "Sending a PayPal invoice is free; when it's paid you pay the standard commercial rate.",
      source: S.caBiz,
    },
    {
      id: "paylater",
      group: "Online sales",
      label: "Pay Later (Pay in 4)",
      line: "Pay Later fee",
      official: "PayPal Pay Later options",
      rate: 4.9,
      fixed: 30,
      intl: CA_INTL,
      when: "The buyer chooses Pay in 4",
      explain: "Since October 9, 2025, Pay Later costs sellers 4.9% + C$0.30. You can turn Pay Later off in your account settings.",
      source: S.caBiz,
    },
    {
      id: "qr",
      group: "In person",
      label: "QR code",
      line: "QR code fee",
      official: "QR code Transactions",
      rate: 1.9,
      fixed: 10,
      small: { max: 1000, rate: 2.4, fixed: 5 },
      intl: CA_INTL,
      when: "The buyer scans your PayPal QR code",
      explain: "QR code payments of C$10.01 and above cost 1.90% + C$0.10; C$10.00 and below, 2.40% + C$0.05.",
      source: S.caBiz,
    },
    {
      id: "acdc",
      group: "Card processing",
      label: "Cards on your own site (Advanced card payments)",
      line: "Advanced card payment fee",
      official: "Advanced Credit and Debit Card Payments",
      rate: 2.7,
      fixed: 30,
      intlTotal: { us: 3.5, other: 3.7 },
      when: "Card fields on your own checkout (Amex is 3.50%)",
      explain: "Card processing on your own checkout: 2.70% domestic, 3.50% for US cards, 3.70% for other international cards, plus C$0.30.",
      source: S.caBiz,
    },
    {
      id: "vt",
      group: "Card processing",
      label: "Virtual Terminal (card details typed in)",
      line: "Virtual Terminal fee",
      official: "Virtual Terminal",
      rate: 3.1,
      fixed: 30,
      intlTotal: { us: 3.9, other: 4.1 },
      when: "You key in a card online, e.g. for phone orders",
      explain: "3.10% domestic, 3.90% for US cards, 4.10% for other international cards, plus C$0.30.",
      source: S.caBiz,
    },
    {
      id: "donation",
      group: "Donations",
      label: "Donations",
      line: "Donation fee",
      official: "All other Donations",
      rate: 2.9,
      fixed: 30,
      intl: CA_INTL,
      when: "Money received as a donation",
      explain: "Donations cost the same as a sale unless PayPal has approved you for the charity rate.",
      source: S.caBiz,
    },
    {
      id: "charity",
      group: "Donations",
      label: "Approved charity",
      line: "Charity rate fee",
      official: "Charity Transactions",
      rate: 1.6,
      fixed: 30,
      intlTotal: { us: 1.6, other: 2.6 },
      when: "Charities PayPal has approved for the charity rate",
      explain: "1.60% + C$0.30 for payments from Canada and the US, 2.60% from other countries.",
      source: S.caBiz,
    },
    {
      id: "micro",
      group: "Small payments",
      label: "Micropayments rate (approved accounts)",
      line: "Micropayments fee",
      official: "Micropayments",
      rate: 5,
      fixed: 5,
      intlTotal: { us: 5, other: 6 },
      when: "Accounts approved for micropayments (applies to every payment)",
      explain: "5.0% + C$0.05 for payments from Canada and the US, 6.0% from elsewhere. Once approved it applies to every commercial payment you receive; PayPal suggests it under C$12.",
      source: S.caBiz,
    },
    {
      id: "ff",
      group: "Friends & family",
      label: "Friends & family, from balance or bank",
      line: "Receiving fee",
      official: "Friends and family, from PayPal balance or a bank account",
      rate: 0,
      fixed: 0,
      personal: true,
      when: "Personal payments within Canada",
      explain: "Receiving money from friends and family is free, and so is sending it from a PayPal balance or bank account (unless PayPal converts currency).",
      source: S.caConsumer,
    },
    {
      id: "ffCard",
      group: "Friends & family",
      label: "Friends & family, paid by card",
      line: "Receiving fee",
      official: "Friends and family, paid by card",
      rate: 2.9,
      fixed: 30,
      personal: true,
      senderPays: true,
      when: "Personal payment the sender funds with a card (sender pays)",
      explain: "When a friend pays you with a card, they pay 2.90% + C$0.30 on top. You receive the full amount.",
      source: S.caConsumer,
    },
  ],
  au: [
    {
      id: "checkout",
      group: "Online sales",
      label: "PayPal Checkout or goods & services payment",
      line: "PayPal fee",
      official: "Commercial Transactions",
      rate: 2.9,
      fixed: 30,
      intl: AU_INTL,
      when: "Online sales, goods and services payments and money requests",
      explain: "PayPal's standard Australian rate since May 27, 2025 (it was 2.6%).",
      source: S.auBiz,
    },
    {
      id: "invoice",
      group: "Online sales",
      label: "Invoice or payment request",
      line: "PayPal fee (invoice)",
      official: "Invoices (charged by payment type)",
      rate: 2.9,
      fixed: 30,
      intl: AU_INTL,
      when: "Client pays your PayPal invoice with PayPal",
      explain: "Sending a PayPal invoice is free; the payment is charged at the rate for how the client pays, usually the standard 2.90% + A$0.30.",
      source: S.auPds,
    },
    {
      id: "qr",
      group: "In person",
      label: "QR code",
      line: "QR code fee",
      official: "QR Code Transactions",
      rate: 1.2,
      fixed: 0,
      intl: AU_INTL,
      when: "The buyer scans your PayPal QR code",
      explain: "QR code payments cost 1.20% with no fixed fee.",
      source: S.auBiz,
    },
    {
      id: "acdc",
      group: "Card processing",
      label: "Cards on your own site (Advanced card payments)",
      line: "Advanced card payment fee",
      official: "Advanced Credit and Debit Card Payments",
      rate: 1.5,
      fixed: 30,
      intl: { intl: 2.1 },
      when: "Card fields on your own checkout",
      explain: "Card processing on your own checkout: 1.50% + A$0.30, plus 2.10% for international cards.",
      source: S.auBiz,
    },
    {
      id: "vt",
      group: "Card processing",
      label: "Virtual Terminal (card details typed in)",
      line: "Virtual Terminal fee",
      official: "Virtual Terminal",
      rate: 3.6,
      fixed: 30,
      intl: AU_INTL,
      when: "You key in a card online, e.g. for phone orders",
      explain: "3.60% + A$0.30 for cards you key in yourself; a A$25 monthly fee may also apply.",
      source: S.auBiz,
    },
    {
      id: "donation",
      group: "Donations",
      label: "Donations",
      line: "Donation fee",
      official: "Donation (other than PayPal Fundraisers donations)",
      rate: 2.9,
      fixed: 30,
      intl: AU_INTL,
      when: "Money received as a donation",
      explain: "Donations cost the same as a sale unless PayPal has approved you for the charity rate.",
      source: S.auBiz,
    },
    {
      id: "charity",
      group: "Donations",
      label: "Approved charity or not-for-profit",
      line: "Charity rate fee",
      official: "Charity transactions",
      rate: 1.1,
      fixed: 30,
      intl: AU_INTL,
      when: "Organizations PayPal has approved for the charity rate",
      explain: "The reduced rate for approved charities and not-for-profits: 1.10% + A$0.30.",
      source: S.auBiz,
    },
    {
      id: "micro",
      group: "Small payments",
      label: "Micropayments rate (approved accounts)",
      line: "Micropayments fee",
      official: "Micropayments",
      rate: 5,
      fixed: 5,
      intlTotal: { intl: 6 },
      when: "Accounts approved for micropayments (applies to every payment)",
      explain: "5.00% + A$0.05 (6.00% international). Once approved it applies to every commercial payment you receive; PayPal suggests it under A$10.",
      source: S.auBiz,
    },
    {
      id: "ff",
      group: "Friends & family",
      label: "Friends & family, from balance or bank",
      line: "Receiving fee",
      official: "Friends and family, from PayPal balance or an AU bank account",
      rate: 0,
      fixed: 0,
      personal: true,
      when: "Personal payments within Australia",
      explain: "Receiving money from friends and family is free, and so is sending it from a PayPal balance or Australian bank account (unless PayPal converts currency).",
      source: S.auConsumer,
    },
    {
      id: "ffCard",
      group: "Friends & family",
      label: "Friends & family, paid by card",
      line: "Receiving fee",
      official: "Friends and family, paid by card",
      rate: 2.6,
      fixed: 30,
      personal: true,
      senderPays: true,
      when: "Personal payment the sender funds with a card (sender pays)",
      explain: "When a friend pays you with a card, they pay 2.60% + A$0.30 on top. You receive the full amount.",
      source: S.auConsumer,
    },
  ],
  de: [
    {
      id: "checkout",
      group: "Online sales",
      label: "PayPal Checkout (business account)",
      line: "PayPal Checkout fee",
      official: "PayPal Checkout, Zahlungen ohne PayPal-Konto, alle anderen geschäftlichen Transaktionen",
      rate: 2.99,
      fixed: 39,
      intl: DE_INTL,
      when: "Online sales through PayPal Checkout on a business account",
      explain: "The standard rate for a business account receiving a payment through PayPal Checkout, including card payments from guests.",
      source: S.deBiz,
    },
    {
      id: "gs",
      group: "Online sales",
      label: "Goods & services payment, or selling from a personal account",
      line: "Goods and services fee",
      official: "Geld für Waren und Dienstleistungen senden/empfangen; private Verkäufe",
      rate: 2.49,
      fixed: 35,
      intl: DE_INTL_GS,
      when: "Buyer sends money as “Waren und Dienstleistungen”, or you sell from a personal account",
      explain: "2.49% + €0.35 when the buyer sends money as goods and services, and for every sale received into a personal (private) account.",
      source: S.deBiz,
    },
    {
      id: "invoice",
      group: "Online sales",
      label: "Invoice (business account)",
      line: "PayPal fee (invoice)",
      official: "Alle anderen geschäftlichen Transaktionen",
      rate: 2.99,
      fixed: 39,
      intl: DE_INTL,
      when: "Client pays your PayPal invoice",
      explain: "Sending a PayPal invoice is free; when it's paid, a business account pays the standard 2.99% + €0.39.",
      source: S.deBiz,
    },
    {
      id: "ratepay",
      group: "Online sales",
      label: "Pay upon invoice (Rechnungskauf with Ratepay)",
      line: "Rechnungskauf fee",
      official: "Rechnungskauf mit Ratepay",
      rate: 2.99,
      fixed: 39,
      when: "The buyer chooses to pay after delivery by invoice",
      explain: "PayPal's pay-after-delivery option costs a business account the same 2.99% + €0.39.",
      source: S.deBiz,
    },
    {
      id: "qr",
      group: "In person",
      label: "QR code (business account)",
      line: "QR code fee",
      official: "QR-Code-Transaktionen (Geschäftskonto)",
      rate: 0.9,
      fixed: 0,
      intl: DE_INTL,
      when: "The buyer scans your PayPal QR code",
      explain: "Business accounts pay 0.90% on QR code payments, with no fixed fee.",
      source: S.deBiz,
    },
    {
      id: "qrPrivate",
      group: "In person",
      label: "QR code (personal account)",
      line: "QR code fee",
      official: "QR-Code-Transaktionen (Privatkonto)",
      rate: 0.5,
      fixed: 10,
      small: { max: 1000, rate: 1, fixed: 5 },
      intl: DE_INTL_GS,
      when: "The buyer scans the QR code of a personal account",
      explain: "Personal accounts pay 0.5% + €0.10 on QR payments of €10.01 and above, 1% + €0.05 up to €10.",
      source: S.deConsumer,
    },
    {
      id: "pos",
      group: "In person",
      label: "Card reader (PayPal POS)",
      line: "Card present fee",
      official: "Transaktionen mit präsenter Karte",
      rate: 1.39,
      fixed: 0,
      when: "Card tapped, inserted or swiped in person",
      explain: "PayPal Point of Sale (formerly Zettle): 1.39% per card payment, no fixed fee.",
      source: S.deBiz,
    },
    {
      id: "posKeyed",
      group: "In person",
      label: "Card number keyed in (PayPal POS)",
      line: "Manual card entry fee",
      official: "Manuelle Karteneingabetransaktion",
      rate: 2.9,
      fixed: 35,
      when: "You type the card number into PayPal Point of Sale",
      explain: "Typing the card number in by hand costs 2.9% + €0.35.",
      source: S.deBiz,
    },
    {
      id: "acdc",
      group: "Card processing",
      label: "Cards on your own site (Advanced card payments)",
      line: "Advanced card payment fee",
      official: "Zahlungen mit Kredit- und Debitkarten mit erweiterten Funktionen",
      rate: 2.99,
      fixed: 39,
      intl: DE_INTL,
      when: "Card fields on your own checkout",
      explain: "Card processing on your own checkout: 2.99% + €0.39.",
      source: S.deBiz,
    },
    {
      id: "vt",
      group: "Card processing",
      label: "eTerminal (card details typed in)",
      line: "eTerminal fee",
      official: "eTerminal-Zahlungen",
      rate: 3.39,
      fixed: 39,
      intl: DE_INTL,
      when: "You key in a card online, e.g. for phone orders",
      explain: "For card payments you enter yourself in PayPal's eTerminal.",
      source: S.deBiz,
    },
    {
      id: "donation",
      group: "Donations",
      label: "Donations",
      line: "Donation fee",
      official: "Spende",
      rate: 2.49,
      fixed: 35,
      intl: DE_INTL_DONATION,
      when: "Money received as a donation",
      explain:
        "Donations cost 2.49% + €0.35. From outside the EEA PayPal adds 2 percentage points (UK, US, Canada) or 3.3 from the rest of the world (3 from non-EEA countries in “Europe II” such as Switzerland, which this calculator counts as elsewhere).",
      source: S.deBiz,
    },
    {
      id: "charity",
      group: "Donations",
      label: "Approved charity",
      line: "Charity rate fee",
      official: "Gemeinnützige Organisationen",
      rate: 1.5,
      fixed: 35,
      intl: DE_INTL_GS,
      when: "Organizations PayPal has approved for the charity rate",
      explain: "The reduced rate for approved charities: 1.50% + €0.35.",
      source: S.deBiz,
    },
    {
      id: "micro",
      group: "Small payments",
      label: "Micropayments rate (approved accounts)",
      line: "Micropayments fee",
      official: "Inländische Mikrozahlungen",
      rate: 4.99,
      fixed: 9,
      intl: DE_INTL,
      when: "Accounts approved for micropayments (applies to every payment)",
      explain: "4.99% + €0.09. Once approved it applies to every commercial payment you receive.",
      source: S.deBiz,
    },
    {
      id: "ff",
      group: "Friends & family",
      label: "Friends & family",
      line: "Receiving fee",
      official: "Freunde und Familie (Inland)",
      rate: 0,
      fixed: 0,
      personal: true,
      when: "Personal payments within the EEA",
      explain: "Sending and receiving money from friends and family is free, however it's funded, unless PayPal converts currency.",
      source: S.deConsumer,
    },
  ],
};

/* ------------------------------------------------- payer region, conversion, withdrawals */

interface RegionChoice {
  value: string;
  label: string;
  /** For explanations: "outside the US", "in the EEA". */
  phrase: string;
  /** For the field's help, before the surcharge: "Abroad", "EU/EEA", "elsewhere". */
  short: string;
}

/** The "Is the payer outside your country?" field for each market (each has its own options). */
const PAYER_FIELD: Record<string, { id: string; label: string; help: string; options: RegionChoice[] }> = {
  us: {
    id: "payerUs",
    label: "Is the payer outside the US?",
    help: "Payments from PayPal accounts registered in another country cost 1.5% more.",
    options: [
      { value: "domestic", label: "No", phrase: "in the US", short: "" },
      { value: "intl", label: "Yes", phrase: "outside the US", short: "Abroad" },
    ],
  },
  uk: {
    id: "payerUk",
    label: "Is the payer outside the UK?",
    help: "+1.29% from the EU/EEA, +1.99% from anywhere else. What counts is where their PayPal account is registered.",
    options: [
      { value: "domestic", label: "No", phrase: "in the UK", short: "" },
      { value: "eea", label: "Yes · EU/EEA", phrase: "in the EEA", short: "EU/EEA" },
      { value: "other", label: "Yes · elsewhere", phrase: "outside the UK and EEA", short: "elsewhere" },
    ],
  },
  ca: {
    id: "payerCa",
    label: "Is the payer outside Canada?",
    help: "+0.80% from the US, +1.00% from anywhere else. What counts is where their PayPal account is registered.",
    options: [
      { value: "domestic", label: "No", phrase: "in Canada", short: "" },
      { value: "us", label: "Yes · US", phrase: "in the US", short: "US" },
      { value: "other", label: "Yes · elsewhere", phrase: "outside Canada and the US", short: "elsewhere" },
    ],
  },
  au: {
    id: "payerAu",
    label: "Is the payer outside Australia?",
    help: "Payments from PayPal accounts registered in another country cost 1% more.",
    options: [
      { value: "domestic", label: "No", phrase: "in Australia", short: "" },
      { value: "intl", label: "Yes", phrase: "outside Australia", short: "Abroad" },
    ],
  },
  de: {
    id: "payerDe",
    label: "Where is the payer's PayPal account?",
    help: "Payments from anywhere in the EU/EEA count as domestic. UK +1.29%; US/Canada and the rest of the world cost more.",
    options: [
      { value: "domestic", label: "EU/EEA", phrase: "in the EEA", short: "EU/EEA" },
      { value: "uk", label: "UK", phrase: "in the UK", short: "UK" },
      { value: "usca", label: "US/Canada", phrase: "in the US or Canada", short: "US/Canada" },
      { value: "other", label: "Elsewhere", phrase: "outside the EEA, UK, US and Canada", short: "elsewhere" },
    ],
  },
};

/** Spread PayPal builds into its exchange rate when it converts a payment you receive. */
const FX: Record<string, { rate: number; source: string; text: string }> = {
  us: { rate: 3, source: S.usBiz, text: "3.00% for converting money you receive (“all other transactions”); buyers paying in another currency pay 4.00%." },
  uk: { rate: 3, source: S.ukBiz, text: "3% above the base exchange rate when a business account converts a balance or agrees to bear the conversion." },
  ca: { rate: 4, source: S.caBiz, text: "At least 4.00% when PayPal converts a commercial payment; 3.00% for other conversions, such as a balance you convert later." },
  au: { rate: 3, source: S.auBiz, text: "3.0% for this kind of conversion; 4.0% applies to paying in another currency, late refunds, personal payments and Payouts." },
  de: { rate: 3, source: S.deBiz, text: "3% above the base exchange rate when a business account converts a balance or agrees to bear the conversion." },
};

/** Fixed fee for the main rate when the payment arrives in another currency (cents of that currency). */
const FIXED_BY_CURRENCY: Record<string, string> = {
  us: "€0.39, £0.39, C$0.59, A$0.59",
  uk: "€0.35, US$0.30, C$0.30, A$0.30",
  ca: "US$0.30, €0.35, £0.20, A$0.30",
  au: "US$0.30, €0.35, £0.20, C$0.30",
  de: "US$0.49, £0.29, C$0.59, A$0.59",
};

interface Withdrawal {
  id: string;
  label: string;
  line: string;
  rate: number;
  min: number;
  max?: number;
  explain: string;
  source: string;
}

const WITHDRAW: Record<string, { standard: string; options: Withdrawal[] }> = {
  us: {
    standard: "Standard transfer to my bank (free)",
    options: [
      {
        id: "instantBiz",
        label: "Instant transfer · business account",
        line: "Instant transfer fee",
        rate: 1.5,
        min: 50,
        explain: "Business accounts pay 1.5% to move money instantly to a bank or debit card, at least $0.50 and with no maximum. Standard transfers are free.",
        source: S.usBiz,
      },
      {
        id: "instantPersonal",
        label: "Instant transfer · personal account",
        line: "Instant transfer fee",
        rate: 1.75,
        min: 25,
        max: 2500,
        explain: "Personal accounts pay 1.75% for an instant transfer, at least $0.25 and at most $25. Standard transfers are free.",
        source: S.usConsumer,
      },
    ],
  },
  ca: {
    standard: "Standard transfer to my bank (free)",
    options: [
      {
        id: "instantBiz",
        label: "Instant transfer · business account",
        line: "Instant transfer fee",
        rate: 1.5,
        min: 50,
        explain: "Business accounts pay 1.50% to move money instantly to a debit card, at least C$0.50. Standard bank transfers are free.",
        source: S.caBiz,
      },
      {
        id: "instantPersonal",
        label: "Instant transfer · personal account",
        line: "Instant transfer fee",
        rate: 1.75,
        min: 25,
        max: 2500,
        explain: "Personal accounts pay 1.75% for an instant transfer, at least C$0.25 and at most C$25. Standard bank transfers are free.",
        source: S.caConsumer,
      },
    ],
  },
  au: {
    standard: "Transfer to my Australian bank",
    options: [
      {
        id: "card",
        label: "Withdraw to a debit card",
        line: "Card withdrawal fee",
        rate: 1,
        min: 25,
        max: 1000,
        explain: "Withdrawing to a linked card costs 1% of the amount, at least A$0.25 and at most A$10.",
        source: S.auBiz,
      },
    ],
  },
  de: {
    standard: "Bank transfer, standard or instant (free)",
    options: [
      {
        id: "card",
        label: "Withdraw to a debit or credit card",
        line: "Card withdrawal fee",
        rate: 1,
        min: 25,
        max: 1000,
        explain: "Withdrawing to a card costs 1% of the amount, at least €0.25 and at most €10. Transfers to a bank account, including instant ones, are free.",
        source: S.deBiz,
      },
    ],
  },
  uk: { standard: "Bank or card (free)", options: [] },
};

/** International friends-and-family sending fees (paid by the sender), for notes and the schedule. */
const FF_INTL: Record<string, { text: string; source: string }> = {
  us: { text: "5% of the amount (at least $0.99, at most $4.99), plus 2.90% + $0.30 if paid by card", source: S.usConsumer },
  uk: { text: "5% of the amount (at least £0.99, at most £2.99)", source: S.ukConsumer },
  ca: { text: "C$2.99 to the US and Europe, C$4.99 elsewhere, plus 2.90% + C$0.30 if paid by card", source: S.caConsumer },
  au: { text: "5% of the amount (at least A$0.99, at most A$5.99), plus 2.6% + A$0.30 if paid by card", source: S.auConsumer },
  de: { text: "5% of the amount (at least €0.99, at most €3.99)", source: S.deConsumer },
};

/** How each market is named in a sentence ("from the US"). */
const IN_TEXT: Record<string, string> = { us: "the US", uk: "the UK", ca: "Canada", au: "Australia", de: "Germany" };

/** International surcharge as the schedule states it, and who counts as international. */
const INTL_TEXT: Record<string, { amount: string; when: string }> = {
  us: { amount: "+1.50%", when: "The payer's PayPal account is registered outside the US" },
  uk: { amount: "+1.29% EEA, +1.99% elsewhere", when: "The payer's PayPal account is registered outside the UK" },
  ca: { amount: "+0.80% US, +1.00% elsewhere", when: "The payer's PayPal account is registered outside Canada" },
  au: { amount: "+1.00%", when: "The payer's PayPal account is registered outside Australia" },
  de: {
    amount: "UK +1.29%, US/Canada +1.99%, elsewhere +1.99% (Checkout) or +2.99% (goods & services)",
    when: "The payer's PayPal account is registered outside the EEA",
  },
};

/** Dispute and chargeback fees, for the schedule. */
const DISPUTES: Record<string, { dispute?: string; chargeback: string; when: string }> = {
  us: { dispute: "$15 ($30 high volume)", chargeback: "$20", when: "Standard fee not charged on payments under $30, if you win, or if Seller Protection covers it" },
  uk: { dispute: "£12 (£24 high volume)", chargeback: "£14", when: "Standard fee not charged on payments under £24, if you win, or if Seller Protection covers it" },
  ca: { dispute: "C$20 (C$40 high volume)", chargeback: "C$20", when: "Standard fee not charged on payments under C$40, if you win, or if Seller Protection covers it" },
  au: { chargeback: "A$15", when: "Not charged if the payment is eligible for Seller Protection" },
  de: { dispute: "€14", chargeback: "€16", when: "Business accounts only; not charged on payments under €28, if you win, or if Seller Protection covers it" },
};

const TAX_MARKETS = new Set(["us", "ca"]);

/* ---------------------------------------------------------------------------- the engine */

function typesFor(market: Market): PayType[] {
  return TYPES[market.id] ?? TYPES.us;
}

function typeOf(inputs: Inputs, market: Market): PayType {
  const list = typesFor(market);
  const id = str(inputs, "payType", "checkout");
  return list.find((t) => t.id === id) ?? list[0];
}

function intlApplies(t: PayType): boolean {
  return Boolean(t.intl || t.intlTotal);
}

function regionOf(inputs: Inputs, market: Market, t: PayType): RegionChoice {
  const f = PAYER_FIELD[market.id] ?? PAYER_FIELD.us;
  const v = intlApplies(t) ? str(inputs, f.id, "domestic") : "domestic";
  return f.options.find((o) => o.value === v) ?? f.options[0];
}

interface Fee {
  amount: number;
  detail: string;
  /** The rate that applied, for explanations. */
  rateText: string;
  /** The fixed fee that applied (cents). */
  fixed: number;
}

/** The fee for one payment type on a gross amount, from a given payer region. */
function feeFor(t: PayType, gross: number, region: string, money: (c: number) => string, tierRate?: number): Fee {
  const small = t.small && gross <= t.small.max ? t.small : null;
  const base = small ? small.rate : tierRate ?? t.rate;
  const fixed = small ? small.fixed : t.fixed;
  const total = t.intlTotal?.[region];
  const add = total === undefined ? t.intl?.[region] ?? 0 : 0;
  const rate = total ?? base;
  const fixedText = fixed ? ` + ${money(fixed)}` : "";
  const rateText = add ? `${formatRate(rate)} + ${formatRate(add)}` : formatRate(rate);
  if (t.cap !== undefined) {
    const raw = pct(gross, rate);
    const capped = Math.min(raw, t.cap);
    const extra = pct(gross, add);
    const head = raw > t.cap ? `${formatRate(rate)} × ${money(gross)} = ${money(raw)}, capped at ${money(t.cap)}` : `${formatRate(rate)} × ${money(gross)}`;
    return { amount: capped + extra + fixed, detail: add ? `${head} + ${formatRate(add)} × ${money(gross)}` : head, rateText, fixed };
  }
  const pctPart = pct(gross, rate + add);
  const detail = `${add ? `(${rateText})` : rateText} × ${money(gross)}${fixedText}${small ? ` (${money(small.max)} or less)` : ""}`;
  return { amount: pctPart + fixed, detail, rateText, fixed };
}

interface Figures {
  gross: number;
  /** What this payment leaves in the PayPal balance (the base for a withdrawal fee). */
  balance: number;
  result: ReturnType<typeof assemble>;
}

function compute(inputs: Inputs, market: Market): Figures {
  const money = moneyFor(market);
  const t = typeOf(inputs, market);
  const region = regionOf(inputs, market, t);
  const amount = toCents(num(inputs, "amount"));
  const shipping = t.personal ? 0 : toCents(num(inputs, "shipping"));
  const taxRate = !t.personal && TAX_MARKETS.has(market.id) ? Math.min(100, Math.max(0, num(inputs, "salesTax"))) : 0;
  const sale = amount + shipping;
  const tax = pct(sale, taxRate);
  const gross = sale + tax;

  const fees: Line[] = [];
  const buyerFees: Line[] = [];
  const notes: string[] = [];
  const onWhat = shipping || tax ? `the whole payment of ${money(gross)}, including ${[shipping ? "shipping" : "", tax ? "sales tax" : ""].filter(Boolean).join(" and ")}` : "the whole payment, including any shipping and tax the payer sends";
  const where = region.value === "domestic" ? "" : ` Includes PayPal's extra charge for a payer ${region.phrase}.`;

  let txFee = 0;
  let fixedApplied = 0;
  if (t.personal) {
    fees.push({ id: "transaction", label: t.line, amount: 0, kind: "payment", detail: "Free to receive", explain: t.explain, source: t.source });
    if (t.senderPays) {
      const sender = pct(amount, t.rate) + t.fixed;
      buyerFees.push({
        id: "sender-card",
        label: "Sender's card fee",
        amount: sender,
        kind: "payment",
        detail: `${formatRate(t.rate)} × ${money(amount)} + ${money(t.fixed)}`,
        explain: "Charged to your friend for paying by card, on top of what they send. It doesn't come out of what you receive.",
        source: t.source,
      });
    }
  } else {
    const tier = market.id === "uk" && t.tierEligible ? Number(str(inputs, "ukTier", "standard")) : NaN;
    const tierRate = tier === 2.4 || tier === 2.1 ? tier : undefined;
    let fee = feeFor(t, gross, region.value, money, tierRate);
    let note = "";
    if (t.dynamicWith) {
      const std = typesFor(market).find((x) => x.id === t.dynamicWith)!;
      const alt = feeFor(std, gross, region.value, money);
      if (alt.amount < fee.amount) {
        fee = alt;
        note = " Here the standard rate is lower, so PayPal charges that.";
      } else note = " Here the micropayments rate is lower.";
    }
    txFee = fee.amount;
    fixedApplied = fee.fixed;
    fees.push({
      id: "transaction",
      label: tierRate ? `${t.line} (tiered plan ${formatRate(tierRate)})` : t.line,
      amount: fee.amount,
      kind: "payment",
      detail: fee.detail,
      explain: `${t.explain}${note} Charged on ${onWhat}.${where}`,
      source: t.source,
    });
  }

  const fx = FX[market.id] ?? FX.us;
  let fxFee = 0;
  if (bool(inputs, "currencyConversion")) {
    const base = gross - txFee;
    fxFee = pct(base, fx.rate);
    fees.push({
      id: "fx",
      label: "Currency conversion spread",
      amount: fxFee,
      kind: "payment",
      detail: `${formatRate(fx.rate)} × ${money(base)}`,
      explain: `PayPal builds this into its exchange rate rather than listing it as a fee: ${fx.text} Receiving in your own currency avoids it.`,
      source: fx.source,
    });
  }

  const balance = gross - txFee - fxFee;
  const w = (WITHDRAW[market.id]?.options ?? []).find((o) => o.id === str(inputs, "withdraw", "standard"));
  if (w) {
    const raw = pct(Math.max(0, balance), w.rate);
    const amt = Math.max(w.min, w.max !== undefined ? Math.min(raw, w.max) : raw);
    const detail =
      raw < w.min
        ? `${formatRate(w.rate)} × ${money(balance)} = ${money(raw)}, minimum ${money(w.min)}`
        : w.max !== undefined && raw > w.max
          ? `${formatRate(w.rate)} × ${money(balance)} = ${money(raw)}, capped at ${money(w.max)}`
          : `${formatRate(w.rate)} × ${money(balance)}`;
    fees.push({ id: "withdrawal", label: w.line, amount: amt, kind: "payout", detail, explain: w.explain, source: w.source });
  }

  // Notes: at most three, the ones that change a decision.
  if (tax) notes.push(`Your PayPal balance also receives the ${money(tax)} sales tax, which you pass on; PayPal's percentage is charged on it too.`);
  if (t.personal) {
    notes.push("Friends and family is for personal payments only. PayPal's terms define it as money that isn't for goods or services, so use goods and services for a sale.");
    notes.push(`Sending to someone in another country costs the sender extra (from ${IN_TEXT[market.id]}: ${FF_INTL[market.id].text}). Receiving stays free unless PayPal converts the currency.`);
  } else if (t.id !== "pos" && t.id !== "posKeyed") {
    // The refund and surcharge rules on the fee pages cover commercial and invoicing payments;
    // PayPal Point of Sale card payments run under their own terms, so no claim is made for them.
    if (market.id === "de") {
      if (fixedApplied) notes.push(`If you refund this payment, PayPal keeps the ${money(fixedApplied)} fixed part of the fee and returns the rest.`);
    } else if (txFee) {
      notes.push(`If you refund this payment, PayPal keeps the whole ${money(txFee)} fee, even on a partial refund.`);
    }
    if (bool(inputs, "currencyConversion") && fixedApplied)
      notes.push(`PayPal charges the fixed fee in the currency you receive, so it can differ slightly from the ${money(fixedApplied)} used here (standard rate: ${FIXED_BY_CURRENCY[market.id]}).`);
    else if (notes.length < 3 && t.group !== "Card processing")
      notes.push("You can't add a surcharge for paying with PayPal. To cover the fee, raise your price: “What to charge” finds the amount.");
  }

  const result = assemble({
    market,
    buyerPays: gross + buyerFees.reduce((s, l) => s + l.amount, 0),
    saleAmount: sale,
    fees,
    buyerFees,
    costs: costLines(inputs, market),
    notes: notes.slice(0, 3),
  });
  return { gross, balance, result };
}

function calculate(inputs: Inputs, market: Market) {
  return compute(inputs, market).result;
}

/** Smallest amount (cents) for which `test` holds, assuming it is monotonic in the amount. */
function firstAmount(inputs: Inputs, market: Market, test: (f: Figures) => boolean): number | null {
  const at = (c: number) => compute({ ...inputs, amount: c / 100 }, market);
  let lo = 0;
  let hi = 100_000_000;
  if (!test(at(hi))) return null;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (test(at(mid))) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

function breakpoints(inputs: Inputs, market: Market): number[] {
  const t = typeOf(inputs, market);
  const out: (number | null)[] = [];
  if (t.small) out.push(firstAmount(inputs, market, (f) => f.gross > t.small!.max));
  if (t.cap !== undefined) out.push(firstAmount(inputs, market, (f) => pct(f.gross, t.rate) >= t.cap!));
  if (t.dynamicWith) {
    const std = typesFor(market).find((x) => x.id === t.dynamicWith)!;
    // Where 4.99% + $0.09 stops being cheaper than 3.49% + $0.49 (the international points cancel out).
    const cross = Math.ceil(((std.fixed - t.fixed) * 100) / (t.rate - std.rate));
    out.push(firstAmount(inputs, market, (f) => f.gross >= cross));
  }
  const w = (WITHDRAW[market.id]?.options ?? []).find((o) => o.id === str(inputs, "withdraw", "standard"));
  if (w) {
    out.push(firstAmount(inputs, market, (f) => pct(f.balance, w.rate) >= w.min));
    if (w.max !== undefined) out.push(firstAmount(inputs, market, (f) => pct(f.balance, w.rate) >= w.max!));
  }
  return out.filter((x): x is number => x !== null && x > 0);
}

/* -------------------------------------------------------------------------- the schedule */

function rateLabel(t: PayType, money: (c: number) => string): string {
  if (t.personal) return t.senderPays ? `Sender pays ${formatRate(t.rate)} + ${money(t.fixed)}` : "Free";
  const main = `${formatRate(t.rate)}${t.fixed ? ` + ${money(t.fixed)}` : ""}`;
  if (t.small) return `${main} (${money(t.small.max)} or less: ${formatRate(t.small.rate)} + ${money(t.small.fixed)})`;
  if (t.cap !== undefined) return `${main}, max ${money(t.cap)}`;
  return main;
}

function schedule(market: Market): ScheduleRow[] {
  const money = moneyFor(market);
  const rows: ScheduleRow[] = typesFor(market).map((t) => ({
    fee: t.official,
    amount: rateLabel(t, money),
    appliesTo: t.personal ? "The amount sent" : t.group === "In person" ? "The payment amount" : ON_ALL,
    when: t.when,
    source: t.source,
  }));
  const intl = INTL_TEXT[market.id];
  rows.push({ fee: "International payment", amount: intl.amount, appliesTo: "Added to the rate above", when: intl.when, source: typesFor(market)[0].source });
  rows.push({ fee: "Fixed fee in other currencies", amount: FIXED_BY_CURRENCY[market.id], appliesTo: "Each payment, by the currency you receive", when: "Main rate, payment in another currency", source: typesFor(market)[0].source });
  const fx = FX[market.id];
  rows.push({ fee: "Currency conversion", amount: `${formatRate(fx.rate)} spread`, appliesTo: "The amount converted (built into the exchange rate)", when: "PayPal converts a payment into your currency", source: fx.source });
  const wd = WITHDRAW[market.id];
  if (wd.options.length) {
    for (const w of wd.options) rows.push({ fee: w.label, amount: `${formatRate(w.rate)}, min ${money(w.min)}${w.max !== undefined ? `, max ${money(w.max)}` : ", no max"}`, appliesTo: "The amount withdrawn", when: "Only if you choose it", source: w.source });
  }
  if (market.id !== "au") rows.push({ fee: "Standard withdrawal to your bank", amount: "Free", appliesTo: "The amount withdrawn", when: "No currency conversion", source: typesFor(market)[0].source });
  rows.push({ fee: "Friends and family abroad", amount: FF_INTL[market.id].text, appliesTo: "The amount sent (paid by the sender)", when: "Personal payment to another country", source: FF_INTL[market.id].source });
  rows.push({
    fee: "Refunds",
    amount: market.id === "de" ? "Fixed fee kept" : "Fee kept",
    appliesTo: "The original payment",
    when: market.id === "de" ? "PayPal keeps the fixed part and returns the percentage" : "Full or partial refund: the original fee isn't returned",
    source: typesFor(market)[0].source,
  });
  const d = DISPUTES[market.id];
  if (d.dispute) rows.push({ fee: "Dispute fee", amount: d.dispute, appliesTo: "Each buyer claim or chargeback", when: d.when, source: typesFor(market)[0].source });
  rows.push({ fee: "Chargeback fee", amount: d.chargeback, appliesTo: "Each card chargeback", when: market.id === "au" ? d.when : "Card payments not made through a PayPal account or guest checkout", source: typesFor(market)[0].source });
  return rows;
}

/* --------------------------------------------------------------------------- changes */

const changes: FeeChange[] = [
  {
    date: "2026-10-01",
    text: "UK: Pay in 3 and Pay in 30 now cost sellers 3.9% + £0.30 (they were charged the standard 2.9% before); Virtual Terminal rose from 1.2% to 2.9% + fixed fee; an optional tiered plan (2.9%, 2.4% or 2.1% by last month's sales) is available on request.",
    source: S.ukUpdates,
  },
  { date: "2026-08-01", text: "US: Pay with Crypto rose from 0.99% to 1.5% of the transaction amount.", source: S.usBiz },
  { date: "2025-10-09", text: "Canada: Pay Later (Pay in 4) launched for sellers at 4.90% + C$0.30, above the 2.90% standard rate. Sellers can turn it off.", source: S.caPast },
  { date: "2025-07-17", text: "Germany: card-present payments with PayPal's card reader (then Zettle by PayPal) set to 1.39%; Payment Links launched at the standard transaction rates.", source: S.dePast },
  {
    date: "2025-05-27",
    text: "Australia: the standard rate rose from 2.6% to 2.9% + A$0.30 (international from 3.6% to 3.9%); cards on your own site fell from 1.75% to 1.50%.",
    source: S.auPast,
  },
  {
    date: "2025-01-13",
    text: "US: Pay Later moved from the 3.49% Checkout rate to 4.99% + $0.49; Advanced Credit and Debit Card Payments went from 2.59% + $0.49 to 2.89% + $0.29; Virtual Terminal from 3.09% + $0.49 to 3.39% + $0.29.",
    source: S.usPast,
  },
  { date: "2025-01-09", text: "Germany: instant withdrawals to a bank account in the EEA (SEPA Instant) became free.", source: S.dePast },
  { date: "2023-10-23", text: "US: QR code payments changed from 1.90% + $0.10 (2.40% + $0.05 up to $10) to a single 2.29% + $0.09.", source: S.usPast },
];

/* ---------------------------------------------------------------------------- the def */

function typeOptions(market: Market): SelectOption[] {
  const money = moneyFor(market);
  return typesFor(market).map((t) => ({ value: t.id, label: t.label, hint: rateLabel(t, money), group: t.group }));
}

/**
 * The payer field's help, from the selected payment type's own surcharges (they differ by type:
 * Australian card processing adds 2.10%, Canadian charity payments from the US add nothing,
 * German donations use PayPal's region groups). Falls back to the market's general sentence.
 */
function payerHelp(i: Inputs, m: Market): string {
  const f = PAYER_FIELD[m.id] ?? PAYER_FIELD.us;
  const t = typeOf(i, m);
  if (!intlApplies(t)) return f.help;
  const parts = f.options
    .filter((o) => o.value !== "domestic" || m.id === "de")
    .map((o) => {
      const total = t.intlTotal?.[o.value];
      const add = o.value === "domestic" ? 0 : total !== undefined ? total - t.rate : t.intl?.[o.value] ?? 0;
      return `${o.short} +${formatRate(Math.max(0, add))}`;
    });
  const text = parts.join(", ");
  return `${text.charAt(0).toUpperCase()}${text.slice(1)} on top of the rate, by the payer's country as PayPal records it (not the shipping address).`;
}

const payerFields = Object.entries(PAYER_FIELD).map(([marketId, f]) => ({
  id: f.id,
  kind: "segmented" as const,
  label: f.label,
  section: "sale" as const,
  help: payerHelp,
  options: f.options.map((o) => ({ value: o.value, label: o.label })),
  showIf: (i: Inputs, m: Market) => m.id === marketId && intlApplies(typeOf(i, m)),
}));

export const paypal: CalculatorDef = {
  slug: "paypal",
  name: "PayPal",
  path: "/paypal-fee-calculator",
  category: "payments",
  priceNoun: "amount to charge",
  /** The default heading would read "Charge this amount to charge". */
  reverseHead: "Charge this amount",
  sellerNoun: "seller",
  blurb: "3.49% + $0.49 Checkout, 2.99% goods & services, +1.5% international (US)",
  markets: MARKETS,
  defaultMarket: "us",
  priceField: "amount",
  fields: [
    {
      id: "amount",
      kind: "money",
      label: "Amount you charge",
      section: "sale",
      help: (i, m) =>
        typeOf(i, m).personal
          ? "The amount your friend or family member sends you."
          : TAX_MARKETS.has(m.id)
            ? "The item or service price, or your invoice total. Shipping and sales tax the payer adds on top go below."
            : `The item or service price including any ${m.id === "au" ? "GST" : "VAT"}, or your invoice total. Shipping goes below.`,
    },
    {
      id: "payType",
      kind: "select",
      label: "How are you being paid?",
      section: "sale",
      options: (_i, m) => typeOptions(m),
      help: "Each way of getting paid has its own rate. Not sure? PayPal Checkout is the standard rate for online sales.",
    },
    ...payerFields,
    {
      id: "salesTax",
      kind: "percent",
      label: "Sales tax you add",
      section: "sale",
      advanced: true,
      max: 25,
      help: "PayPal charges its percentage on the tax too, even though you pass the tax on.",
      showIf: (i, m) => TAX_MARKETS.has(m.id) && !typeOf(i, m).personal,
    },
    {
      id: "shipping",
      kind: "money",
      label: "Shipping you charge",
      section: "shipping",
      help: "PayPal's percentage applies to shipping too, so it costs the same as building it into the price.",
      showIf: (i, m) => !typeOf(i, m).personal,
    },
    {
      id: "currencyConversion",
      kind: "toggle",
      label: "PayPal converts this payment to my currency",
      section: "options",
      advanced: true,
      help: "The spread is built into PayPal's exchange rate: 3% in most markets, 4% in Canada.",
    },
    {
      id: "withdraw",
      kind: "select",
      label: "How will you withdraw it?",
      section: "options",
      advanced: true,
      options: (_i, m) => {
        const wd = WITHDRAW[m.id] ?? WITHDRAW.us;
        const money = moneyFor(m);
        return [
          { value: "standard", label: wd.standard },
          ...wd.options.map((w) => ({ value: w.id, label: w.label, hint: `${formatRate(w.rate)}, min ${money(w.min)}${w.max !== undefined ? `, max ${money(w.max)}` : ""}` })),
        ];
      },
      help: (_i, m) =>
        m.id === "au"
          ? "Withdrawing to a card costs 1% (A$0.25 to A$10). PayPal's Australian fee pages list no fee for an Australian bank account."
          : m.id === "de"
            ? "Withdrawing to a card costs 1% (€0.25 to €10). Bank transfers, including instant ones, are free."
            : "Instant transfers cost a percentage of what you move. Standard transfers to your bank are free.",
      showIf: (_i, m) => (WITHDRAW[m.id]?.options.length ?? 0) > 0,
    },
    {
      id: "ukTier",
      kind: "select",
      label: "PayPal tiered rate plan",
      section: "options",
      advanced: true,
      options: [
        { value: "standard", label: "Not enrolled, or up to £4,000 last month (2.9%)" },
        { value: "2.4", label: "Over £4,000 up to £8,000 last month (2.4%)" },
        { value: "2.1", label: "Over £8,000 last month (2.1%)" },
      ],
      help: "Only if PayPal has confirmed your enrolment (you have to ask). Your rate depends on last month's eligible sales.",
      showIf: (i, m) => m.id === "uk" && Boolean(typeOf(i, m).tierEligible),
    },
    { id: "itemCost", kind: "money", label: "What the item cost you", section: "costs", help: "Or your cost to deliver the service." },
    { id: "shippingCost", kind: "money", label: "Postage / label you pay", section: "costs" },
    { id: "otherCost", kind: "money", label: "Packaging & other", section: "costs" },
  ],
  defaults: () => ({
    amount: 100,
    payType: "checkout",
    payerUs: "domestic",
    payerUk: "domestic",
    payerCa: "domestic",
    payerAu: "domestic",
    payerDe: "domestic",
    salesTax: 0,
    shipping: 0,
    currencyConversion: false,
    withdraw: "standard",
    ukTier: "standard",
    itemCost: 0,
    shippingCost: 0,
    otherCost: 0,
  }),
  calculate,
  breakpoints,
  verifiedAt: "2026-10-23",
  sources,
  changes,
  schedule,
  compare: {
    group: "pay",
    map: (c) => ({ amount: c.price, shipping: c.shipping, itemCost: c.itemCost, shippingCost: c.shippingCost }),
    note: "US PayPal Checkout, US buyer, standard bank transfer",
  },
};

export default paypal;
