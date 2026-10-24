import { CalculatorPage, calculatorMetadata } from "@/components/page/CalculatorPage";
import Ui from "./ui";

export const metadata = calculatorMetadata("paypal-goods-and-services");

export default function Page() {
  return (
    <CalculatorPage slug="paypal-goods-and-services">
      <Ui />
    </CalculatorPage>
  );
}
