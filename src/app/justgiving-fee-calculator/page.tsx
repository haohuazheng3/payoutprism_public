import { CalculatorPage, calculatorMetadata } from "@/components/page/CalculatorPage";
import Ui from "./ui";

export const metadata = calculatorMetadata("justgiving");

export default function Page() {
  return (
    <CalculatorPage slug="justgiving">
      <Ui />
    </CalculatorPage>
  );
}
