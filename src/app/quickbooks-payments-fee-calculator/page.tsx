import { CalculatorPage, calculatorMetadata } from "@/components/page/CalculatorPage";
import Ui from "./ui";

export const metadata = calculatorMetadata("quickbooks-payments");

export default function Page() {
  return (
    <CalculatorPage slug="quickbooks-payments">
      <Ui />
    </CalculatorPage>
  );
}
