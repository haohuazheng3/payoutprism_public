import { CalculatorPage, calculatorMetadata } from "@/components/page/CalculatorPage";
import Ui from "./ui";

export const metadata = calculatorMetadata("stripe-uk");

export default function Page() {
  return (
    <CalculatorPage slug="stripe-uk">
      <Ui />
    </CalculatorPage>
  );
}
