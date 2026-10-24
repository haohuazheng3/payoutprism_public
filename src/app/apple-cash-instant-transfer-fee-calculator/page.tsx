import { CalculatorPage, calculatorMetadata } from "@/components/page/CalculatorPage";
import Ui from "./ui";

export const metadata = calculatorMetadata("apple-cash-instant-transfer");

export default function Page() {
  return (
    <CalculatorPage slug="apple-cash-instant-transfer">
      <Ui />
    </CalculatorPage>
  );
}
