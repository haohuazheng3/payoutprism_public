import { CalculatorPage, calculatorMetadata } from "@/components/page/CalculatorPage";
import Ui from "./ui";

export const metadata = calculatorMetadata("turo-plans");

export default function Page() {
  return (
    <CalculatorPage slug="turo-plans">
      <Ui />
    </CalculatorPage>
  );
}
