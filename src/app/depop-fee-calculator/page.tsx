import { CalculatorPage, calculatorMetadata } from "@/components/page/CalculatorPage";
import Ui from "./ui";

export const metadata = calculatorMetadata("depop");

export default function Page() {
  return (
    <CalculatorPage slug="depop">
      <Ui />
    </CalculatorPage>
  );
}
