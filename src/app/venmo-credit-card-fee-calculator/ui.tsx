"use client";

import def from "@/fees/platforms/venmo-credit-card";
import { CalculatorApp } from "@/components/calculator/CalculatorApp";

export default function Ui() {
  return <CalculatorApp def={def} compareHref />;
}
