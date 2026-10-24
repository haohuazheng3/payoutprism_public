"use client";

import def from "@/fees/platforms/cash-app";
import { CalculatorApp } from "@/components/calculator/CalculatorApp";

export default function Ui() {
  return <CalculatorApp def={def} />;
}
