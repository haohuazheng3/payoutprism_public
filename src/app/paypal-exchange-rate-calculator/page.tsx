import { CalculatorPage, calculatorMetadata } from "@/components/page/CalculatorPage";
import Ui from "./ui";

export const metadata = calculatorMetadata("paypal-exchange-rate");

export default function Page() {
  return (
    <CalculatorPage slug="paypal-exchange-rate">
      <Ui />
    </CalculatorPage>
  );
}
