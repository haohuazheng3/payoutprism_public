import { CalculatorPage, calculatorMetadata } from "@/components/page/CalculatorPage";
import Ui from "./ui";

export const metadata = calculatorMetadata("amazon");

export default function Page() {
  return (
    <CalculatorPage slug="amazon">
      <Ui />
    </CalculatorPage>
  );
}
