import { CalculatorPage, calculatorMetadata } from "@/components/page/CalculatorPage";
import Ui from "./ui";

export const metadata = calculatorMetadata("square");

export default function Page() {
  return (
    <CalculatorPage slug="square">
      <Ui />
    </CalculatorPage>
  );
}
