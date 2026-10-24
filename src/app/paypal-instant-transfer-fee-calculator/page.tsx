import { CalculatorPage, calculatorMetadata } from "@/components/page/CalculatorPage";
import Ui from "./ui";

export const metadata = calculatorMetadata("paypal-instant-transfer");

export default function Page() {
  return (
    <CalculatorPage slug="paypal-instant-transfer">
      <Ui />
    </CalculatorPage>
  );
}
