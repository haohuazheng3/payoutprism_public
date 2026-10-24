import { CalculatorPage, calculatorMetadata } from "@/components/page/CalculatorPage";
import Ui from "./ui";

export const metadata = calculatorMetadata("kickstarter");

export default function Page() {
  return (
    <CalculatorPage slug="kickstarter">
      <Ui />
    </CalculatorPage>
  );
}
