import { CalculatorPage, calculatorMetadata } from "@/components/page/CalculatorPage";
import Ui from "./ui";

export const metadata = calculatorMetadata("sumup");

export default function Page() {
  return (
    <CalculatorPage slug="sumup">
      <Ui />
    </CalculatorPage>
  );
}
