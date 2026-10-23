import { CalculatorPage, calculatorMetadata } from "@/components/page/CalculatorPage";
import Ui from "./ui";

export const metadata = calculatorMetadata("paypal");

export default function Page() {
  return (
    <CalculatorPage slug="paypal">
      <Ui />
    </CalculatorPage>
  );
}
