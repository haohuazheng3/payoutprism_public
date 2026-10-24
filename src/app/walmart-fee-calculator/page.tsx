import { CalculatorPage, calculatorMetadata } from "@/components/page/CalculatorPage";
import Ui from "./ui";

export const metadata = calculatorMetadata("walmart");

export default function Page() {
  return (
    <CalculatorPage slug="walmart">
      <Ui />
    </CalculatorPage>
  );
}
