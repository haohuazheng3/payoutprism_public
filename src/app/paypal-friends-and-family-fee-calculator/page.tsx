import { CalculatorPage, calculatorMetadata } from "@/components/page/CalculatorPage";
import Ui from "./ui";

export const metadata = calculatorMetadata("paypal-friends-and-family");

export default function Page() {
  return (
    <CalculatorPage slug="paypal-friends-and-family">
      <Ui />
    </CalculatorPage>
  );
}
