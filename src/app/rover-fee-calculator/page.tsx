import { CalculatorPage, calculatorMetadata } from "@/components/page/CalculatorPage";
import Ui from "./ui";

export const metadata = calculatorMetadata("rover");

export default function Page() {
  return (
    <CalculatorPage slug="rover">
      <Ui />
    </CalculatorPage>
  );
}
