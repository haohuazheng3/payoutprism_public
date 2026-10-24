import { CalculatorPage, calculatorMetadata } from "@/components/page/CalculatorPage";
import Ui from "./ui";

export const metadata = calculatorMetadata("vrbo");

export default function Page() {
  return (
    <CalculatorPage slug="vrbo">
      <Ui />
    </CalculatorPage>
  );
}
