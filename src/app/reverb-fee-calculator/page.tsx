import { CalculatorPage, calculatorMetadata } from "@/components/page/CalculatorPage";
import Ui from "./ui";

export const metadata = calculatorMetadata("reverb");

export default function Page() {
  return (
    <CalculatorPage slug="reverb">
      <Ui />
    </CalculatorPage>
  );
}
