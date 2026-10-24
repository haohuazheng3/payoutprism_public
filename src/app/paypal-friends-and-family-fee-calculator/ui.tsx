"use client";

import def from "@/fees/platforms/paypal-friends-and-family";
import { CalculatorApp } from "@/components/calculator/CalculatorApp";

export default function Ui() {
  return <CalculatorApp def={def} compareHref />;
}
