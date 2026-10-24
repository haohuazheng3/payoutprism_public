import { CalculatorPage, calculatorMetadata } from "@/components/page/CalculatorPage";
import Ui from "./ui";

export const metadata = calculatorMetadata("clover");

export default function Page() {
  return (
    <CalculatorPage slug="clover">
      <Ui />
    </CalculatorPage>
  );
}
