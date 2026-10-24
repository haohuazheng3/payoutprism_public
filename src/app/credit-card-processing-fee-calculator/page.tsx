import { CalculatorPage, calculatorMetadata } from "@/components/page/CalculatorPage";
import Ui from "./ui";

export const metadata = calculatorMetadata("credit-card-processing");

export default function Page() {
  return (
    <CalculatorPage slug="credit-card-processing">
      <Ui />
    </CalculatorPage>
  );
}
