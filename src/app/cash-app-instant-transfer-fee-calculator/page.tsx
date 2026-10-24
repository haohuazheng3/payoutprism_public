import { CalculatorPage, calculatorMetadata } from "@/components/page/CalculatorPage";
import Ui from "./ui";

export const metadata = calculatorMetadata("cash-app-instant-transfer");

export default function Page() {
  return (
    <CalculatorPage slug="cash-app-instant-transfer">
      <Ui />
    </CalculatorPage>
  );
}
