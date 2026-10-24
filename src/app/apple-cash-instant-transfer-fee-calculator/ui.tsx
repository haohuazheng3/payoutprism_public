"use client";

import def from "@/fees/platforms/apple-cash-instant-transfer";
import { CalculatorApp } from "@/components/calculator/CalculatorApp";

export default function Ui() {
  return <CalculatorApp def={def} compareHref />;
}
