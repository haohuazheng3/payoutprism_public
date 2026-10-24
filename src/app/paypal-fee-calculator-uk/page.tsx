import { CalculatorPage, calculatorMetadata } from "@/components/page/CalculatorPage";
import Ui from "./ui";

export const metadata = calculatorMetadata("paypal-uk");

export default function Page() {
  return (
    <CalculatorPage slug="paypal-uk">
      <Ui />
    </CalculatorPage>
  );
}
