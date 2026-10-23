import { CalculatorPage, calculatorMetadata } from "@/components/page/CalculatorPage";
import Ui from "./ui";

export const metadata = calculatorMetadata("stripe");

export default function Page() {
  return (
    <CalculatorPage slug="stripe">
      <Ui />
    </CalculatorPage>
  );
}
