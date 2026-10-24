import { CalculatorPage, calculatorMetadata } from "@/components/page/CalculatorPage";
import Ui from "./ui";

export const metadata = calculatorMetadata("wholesale-price");

export default function Page() {
  return (
    <CalculatorPage slug="wholesale-price">
      <Ui />
    </CalculatorPage>
  );
}
