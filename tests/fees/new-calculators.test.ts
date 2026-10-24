import { describe, expect, it } from "vitest";
import { ALL, getCalculator } from "@/fees/all";
import { checkContract, line, run } from "./helpers";
import { receiveFor } from "@/fees/platforms/steam-market";
import { breakEven } from "@/fees/platforms/turo-plans";

const NEW = [
  "venmo-instant-transfer", "cash-app-instant-transfer", "paypal-instant-transfer", "apple-cash-instant-transfer", "paypal-friends-and-family", "paypal-exchange-rate",
  "venmo-credit-card", "paypal-goods-and-services", "paypal-invoice", "credit-card-processing", "credit-card-surcharge", "quickbooks-payments", "clover", "eventbrite",
  "tcgplayer", "kdp", "twitch-sub", "twitch-bits", "turo", "turo-plans", "vrbo", "rover", "chrono24", "bring-a-trailer", "cars-and-bids", "product-pricing",
  "wholesale-price", "craft-pricing", "app-store", "steam-market", "ko-fi", "ebay-uk", "paypal-uk", "stripe-uk", "etsy-uk", "sumup", "justgiving",
];

describe("new calculators: contract", () => {
  it("all 37 are registered with unique slugs and paths", () => {
    for (const s of NEW) expect(ALL.some((d) => d.slug === s)).toBe(true);
    expect(new Set(ALL.map((d) => d.path)).size).toBe(ALL.length);
  });
  for (const s of NEW) it(`${s} satisfies the module contract`, () => expect(checkContract(getCalculator(s))).toEqual([]));
});

describe("official examples and published rates", () => {
  it("TCGplayer: $65.31 + $0.99 shipping, 7% tax → $9.20 (help center example)", () => {
    const r = run(getCalculator("tcgplayer"), "us", { price: 65.31, shipping: 0.99, tax: 7 });
    expect([line(r, "commission"), line(r, "commissionShip"), line(r, "transaction")]).toEqual([702, 11, 207]);
    expect(r.totalFees).toBe(920);
  });
  it("TCGplayer: $260 + $8.82 shipping, 7% tax → $36.39", () => {
    expect(run(getCalculator("tcgplayer"), "us", { price: 260, shipping: 8.82, tax: 7 }).totalFees).toBe(3639);
  });
  it("TCGplayer Pro: $65.31 + $0.99, 7% tax → $9.85", () => {
    expect(run(getCalculator("tcgplayer"), "us", { price: 65.31, shipping: 0.99, tax: 7, level: "pro" }).totalFees).toBe(985);
  });
  it("TCGplayer caps commission at $75 per product", () => {
    expect(line(run(getCalculator("tcgplayer"), "us", { price: 1000, shipping: 0 }), "commission")).toBe(7500);
  });
  it("KDP: $15, 333-page black paperback on Amazon.com → $4.00 (KDP example)", () => {
    expect(run(getCalculator("kdp"), "us", { price: 15, pages: 333 }).payout).toBe(400);
  });
  it("KDP: 50% below $9.99, 60% from $9.99; 24–110 pages flat $2.30", () => {
    expect(run(getCalculator("kdp"), "us", { price: 9.98, pages: 100 }).payout).toBe(499 - 230);
    expect(run(getCalculator("kdp"), "us", { price: 9.99, pages: 100 }).payout).toBe(599 - 230);
  });
  it("KDP eBook: 70% of (list − delivery) inside $2.99–$12.99, else 35%", () => {
    expect(run(getCalculator("kdp"), "us", { format: "ebook", price: 4.99, delivery: 0.06 }).payout).toBe(345);
    expect(run(getCalculator("kdp"), "us", { format: "ebook", price: 14.99 }).payout).toBe(525);
  });
  it("JustGiving: £500 from 25 donors → charity £483, personal £476.75 (JustGiving example)", () => {
    expect(run(getCalculator("justgiving"), "uk", { total: 500, count: 25, type: "charity" }).payout).toBe(48300);
    expect(run(getCalculator("justgiving"), "uk", { total: 500, count: 25, type: "personal" }).payout).toBe(47675);
  });
  it("Eventbrite: $50 ticket, fees to buyer → buyer pays $55.20, organizer gets $50", () => {
    const r = run(getCalculator("eventbrite"), "us", { price: 50 });
    expect(r.buyerPays).toBe(5520);
    expect(r.payout).toBe(5000);
  });
  it("instant transfers: Venmo 1.75% with $0.25 floor and $25 cap; Apple 1.7%; PayPal business $0.50 floor", () => {
    const v = getCalculator("venmo-instant-transfer");
    expect(run(v, "us", { amount: 500 }).totalFees).toBe(875);
    expect(run(v, "us", { amount: 10 }).totalFees).toBe(25);
    expect(run(v, "us", { amount: 2000 }).totalFees).toBe(2500);
    expect(run(v, "us", { amount: 500, speed: "standard" }).totalFees).toBe(0);
    expect(run(getCalculator("apple-cash-instant-transfer"), "us", { amount: 100 }).totalFees).toBe(170);
    expect(run(getCalculator("paypal-instant-transfer"), "us", { amount: 10, tier: "business" }).totalFees).toBe(50);
    expect(run(getCalculator("cash-app-instant-transfer"), "us", { amount: 100, instantRate: 0.5, instantMin: 0.25 }).totalFees).toBe(50);
  });
  it("PayPal: G&S 2.99% (no fixed fee); invoice by bank capped at $10; F&F by card 2.90% + $0.30 paid by the sender", () => {
    expect(run(getCalculator("paypal-goods-and-services"), "us", { price: 100 }).totalFees).toBe(299);
    expect(run(getCalculator("paypal-invoice"), "us", { amount: 2000, method: "bank" }).totalFees).toBe(1000);
    const ff = run(getCalculator("paypal-friends-and-family"), "us", { amount: 100, funding: "card", where: "us" });
    expect([ff.buyerPays, ff.payout]).toEqual([10320, 10000]);
    expect(run(getCalculator("paypal-friends-and-family"), "us", { amount: 10, funding: "bank", where: "abroad" }).buyerPays).toBe(1099);
  });
  it("Venmo credit card: 3% on top", () => {
    expect(run(getCalculator("venmo-credit-card"), "us", { amount: 100 }).buyerPays).toBe(10300);
  });
  it("surcharge: exact cover vs Visa 3% / MDR cap", () => {
    const r = run(getCalculator("credit-card-surcharge"), "us", { amount: 100, rate: 2.9, fixed: 0.3 });
    expect(r.buyerPays).toBe(10290);
  });
  it("auctions: BaT 5% buyer fee, $99 listing; Cars & Bids $250 minimum", () => {
    const b = run(getCalculator("bring-a-trailer"), "us", { price: 40000 });
    expect([b.payout, b.buyerPays]).toEqual([3990100, 4200000]);
    expect(run(getCalculator("bring-a-trailer"), "us", { price: 200000 }).buyerPays).toBe(20750000);
    expect(run(getCalculator("cars-and-bids"), "us", { price: 3000 }).buyerPays).toBe(325000);
  });
  it("Steam: a $10.00 listing pays the seller $8.69", () => {
    expect(receiveFor(1000, 10)).toBe(869);
    expect(run(getCalculator("steam-market"), "us", { price: 10 }).payout).toBe(869);
  });
  it("rentals and services: Rover 80%, Vrbo 12%, Turo plan share", () => {
    expect(run(getCalculator("rover"), "us", { price: 300 }).payout).toBe(24000);
    expect(run(getCalculator("vrbo"), "us", {}).payout).toBe(80960);
    expect(run(getCalculator("turo"), "us", { daily: 60, days: 15, plan: "p80" }).payout).toBe(72000);
    expect(breakEven("p80", "p90")).toBe(1250000);
  });
  it("creators: Twitch 1¢ per Bit, App Store 15%, Ko-fi 5% shop fee", () => {
    expect(run(getCalculator("twitch-bits"), "us", { bits: 1000 }).payout).toBe(1000);
    expect(run(getCalculator("app-store"), "us", { price: 4.99, units: 1000, program: "small" }).totalFees).toBe(74850);
    expect(line(run(getCalculator("ko-fi"), "us", { amount: 25, type: "shop", plan: "free" }), "service")).toBe(125);
    expect(line(run(getCalculator("ko-fi"), "us", { amount: 25, type: "tip", plan: "free" }), "service")).toBe(0);
  });
  it("processors: Clover Starter, QuickBooks invoice, SumUp pay-as-you-go", () => {
    expect(run(getCalculator("clover"), "us", { amount: 50 }).totalFees).toBe(140);
    expect(run(getCalculator("quickbooks-payments"), "us", { amount: 1000 }).totalFees).toBe(2990);
    expect(run(getCalculator("sumup"), "uk", { amount: 25 }).totalFees).toBe(42);
  });
  it("product pricing matches the platform's own calculator", () => {
    const etsy = run(getCalculator("etsy"), "us", { price: 40, shippingCharged: 0, itemCost: 0, shippingCost: 0, otherCost: 0 });
    expect(run(getCalculator("product-pricing"), "us", { price: 40, unitCost: 0, labelCost: 0, otherCost: 0 }).payout).toBe(etsy.payout);
  });
  it("UK twins run on the UK market in pounds", () => {
    for (const s of ["ebay-uk", "paypal-uk", "stripe-uk", "etsy-uk"]) expect(run(getCalculator(s), "uk").currency).toBe("GBP");
  });
});
