import { CalculatorPage, calculatorMetadata } from "@/components/page/CalculatorPage";
import Ui from "./ui";

export const metadata = calculatorMetadata("grailed");

export default function Page() {
  return (
    <CalculatorPage slug="grailed">
      <Ui />
    </CalculatorPage>
  );
}
