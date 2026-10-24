import { CalculatorPage, calculatorMetadata } from "@/components/page/CalculatorPage";
import Ui from "./ui";

export const metadata = calculatorMetadata("turo");

export default function Page() {
  return (
    <CalculatorPage slug="turo">
      <Ui />
    </CalculatorPage>
  );
}
