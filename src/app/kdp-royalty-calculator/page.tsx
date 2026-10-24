import { CalculatorPage, calculatorMetadata } from "@/components/page/CalculatorPage";
import Ui from "./ui";

export const metadata = calculatorMetadata("kdp");

export default function Page() {
  return (
    <CalculatorPage slug="kdp">
      <Ui />
    </CalculatorPage>
  );
}
