import { CalculatorPage, calculatorMetadata } from "@/components/page/CalculatorPage";
import Ui from "./ui";

export const metadata = calculatorMetadata("swappa");

export default function Page() {
  return (
    <CalculatorPage slug="swappa">
      <Ui />
    </CalculatorPage>
  );
}
