import { CalculatorPage, calculatorMetadata } from "@/components/page/CalculatorPage";
import Ui from "./ui";

export const metadata = calculatorMetadata("chrono24");

export default function Page() {
  return (
    <CalculatorPage slug="chrono24">
      <Ui />
    </CalculatorPage>
  );
}
