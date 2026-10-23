import { CalculatorPage, calculatorMetadata } from "@/components/page/CalculatorPage";
import Ui from "./ui";

export const metadata = calculatorMetadata("amazon-fba");

export default function Page() {
  return (
    <CalculatorPage slug="amazon-fba">
      <Ui />
    </CalculatorPage>
  );
}
