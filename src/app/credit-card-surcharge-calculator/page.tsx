import { CalculatorPage, calculatorMetadata } from "@/components/page/CalculatorPage";
import Ui from "./ui";

export const metadata = calculatorMetadata("credit-card-surcharge");

export default function Page() {
  return (
    <CalculatorPage slug="credit-card-surcharge">
      <Ui />
    </CalculatorPage>
  );
}
