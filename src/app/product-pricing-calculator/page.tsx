import { CalculatorPage, calculatorMetadata } from "@/components/page/CalculatorPage";
import Ui from "./ui";

export const metadata = calculatorMetadata("product-pricing");

export default function Page() {
  return (
    <CalculatorPage slug="product-pricing">
      <Ui />
    </CalculatorPage>
  );
}
