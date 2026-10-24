import { CalculatorPage, calculatorMetadata } from "@/components/page/CalculatorPage";
import Ui from "./ui";

export const metadata = calculatorMetadata("goat");

export default function Page() {
  return (
    <CalculatorPage slug="goat">
      <Ui />
    </CalculatorPage>
  );
}
