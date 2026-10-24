import { CalculatorPage, calculatorMetadata } from "@/components/page/CalculatorPage";
import Ui from "./ui";

export const metadata = calculatorMetadata("cash-app");

export default function Page() {
  return (
    <CalculatorPage slug="cash-app">
      <Ui />
    </CalculatorPage>
  );
}
