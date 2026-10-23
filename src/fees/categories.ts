import type { CalculatorCategory } from "./types";

export const CATEGORY_ORDER: CalculatorCategory[] = ["marketplaces", "payments", "freelance", "rentals", "creators", "fundraising"];

export const CATEGORY_LABEL: Record<CalculatorCategory, string> = {
  marketplaces: "Selling platforms",
  payments: "Payments & invoicing",
  freelance: "Freelance platforms",
  rentals: "Short-term rentals",
  creators: "Creator platforms",
  fundraising: "Fundraising",
};

export const CATEGORY_DEK: Record<CalculatorCategory, string> = {
  marketplaces: "What a sale really leaves you after marketplace, payment and ad fees.",
  payments: "What a payment, invoice or transfer costs you, and what to charge to receive a round number.",
  freelance: "What a job pays after the platform's cut and withdrawal fees.",
  rentals: "What a booking pays the host after service fees.",
  creators: "What members, buyers and backers leave you after platform and processing fees.",
  fundraising: "What reaches the organiser after processing fees and optional tips.",
};
