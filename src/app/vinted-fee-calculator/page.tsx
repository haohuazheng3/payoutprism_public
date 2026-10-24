import { CalculatorPage, calculatorMetadata } from "@/components/page/CalculatorPage";
import Ui from "./ui";

export const metadata = calculatorMetadata("vinted");

export default function Page() {
  return (
    <CalculatorPage slug="vinted">
      <Ui />
    </CalculatorPage>
  );
}
