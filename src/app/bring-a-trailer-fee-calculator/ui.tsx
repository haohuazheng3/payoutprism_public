"use client";

import def from "@/fees/platforms/bring-a-trailer";
import { CalculatorApp } from "@/components/calculator/CalculatorApp";

export default function Ui() {
  return <CalculatorApp def={def} compareHref />;
}
