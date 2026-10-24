"use client";

import def from "@/fees/platforms/goat";
import { CalculatorApp } from "@/components/calculator/CalculatorApp";

export default function Ui() {
  return <CalculatorApp def={def} compareHref />;
}
