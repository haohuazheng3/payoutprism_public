import { CalculatorPage, calculatorMetadata } from "@/components/page/CalculatorPage";
import Ui from "./ui";

export const metadata = calculatorMetadata("craft-pricing");

export default function Page() {
  return (
    <CalculatorPage slug="craft-pricing">
      <Ui />
    </CalculatorPage>
  );
}
