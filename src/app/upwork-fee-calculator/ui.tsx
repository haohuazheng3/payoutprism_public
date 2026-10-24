"use client";

import def from "@/fees/platforms/upwork";
import { CalculatorApp } from "@/components/calculator/CalculatorApp";

export default function Ui() {
  return <CalculatorApp def={def} />;
}
