import { CalculatorPage, calculatorMetadata } from "@/components/page/CalculatorPage";
import Ui from "./ui";

export const metadata = calculatorMetadata("paypal-invoice");

export default function Page() {
  return (
    <CalculatorPage slug="paypal-invoice">
      <Ui />
    </CalculatorPage>
  );
}
