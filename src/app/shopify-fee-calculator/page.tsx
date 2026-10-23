import { CalculatorPage, calculatorMetadata } from "@/components/page/CalculatorPage";
import Ui from "./ui";

export const metadata = calculatorMetadata("shopify");

export default function Page() {
  return (
    <CalculatorPage slug="shopify">
      <Ui />
    </CalculatorPage>
  );
}
